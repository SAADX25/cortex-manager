import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  prepareRoleGrant,
  previewRoleGrant,
  applyRoleGrant,
  readRoleMembers,
} from '../src/role-grants.mjs';
import { sample, fakeServer, ID, LEGACY, MEMBER, BOT_ROLE } from './helpers/fake.mjs';
import { P } from '../src/permissions.mjs';
const req = { roleId: LEGACY, memberId: MEMBER },
  nonce = 'a'.repeat(24);
const confirmation = (p) => ({
  confirmed: true,
  guildId: ID,
  roleId: p.roleId,
  memberId: p.memberId,
  approvalHash: p.approvalHash,
});
function temp(t) {
  const root = path.resolve(os.tmpdir()),
    dir = fs.mkdtempSync(path.join(root, 'cortex-role-grant-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), root);
    assert.match(path.basename(dir), /^cortex-role-grant-/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
test('role grants reject protected, managed, bot-held, high and everyone roles, missing rights and bot targets', () => {
  const s = sample(),
    member = s.members.find((m) => m.id === MEMBER);
  assert.equal(prepareRoleGrant(s, req, member, nonce).roleId, LEGACY);
  for (const r of s.roles.filter((r) => r.id !== LEGACY))
    assert.throws(() => prepareRoleGrant(s, { ...req, roleId: r.id }, member, nonce));
  for (const change of [
    { managed: true },
    { position: 40 },
    { tags: { bot_id: '999999999999999999' } },
  ]) {
    const copy = structuredClone(s);
    Object.assign(
      copy.roles.find((r) => r.id === LEGACY),
      change,
    );
    assert.throws(() => prepareRoleGrant(copy, req, member, nonce));
  }
  for (const request of [
    { ...req, memberId: 'x' },
    { ...req, extra: true },
    { ...req, roleId: '999999999999999999' },
  ])
    assert.throws(() => prepareRoleGrant(s, request, member, nonce));
  assert.throws(() =>
    prepareRoleGrant(s, req, { ...member, user: { id: MEMBER, bot: true } }, nonce),
  );
  assert.throws(() => prepareRoleGrant(s, req, { ...member, id: '999999999999999999' }, nonce));
  s.roles.find((r) => r.id === BOT_ROLE).permissions = '0';
  assert.throws(() => prepareRoleGrant(s, req, member, nonce), /Manage Roles/);
});
test('grant preview is read-only; exact confirmed PUT adds only one role and preserves all existing roles', async (t) => {
  const s = sample();
  s.members.find((m) => m.id === MEMBER).roles = ['999999999999999992'];
  const server = fakeServer(s),
    dir = temp(t),
    p = await previewRoleGrant(server.api, ID, req, dir);
  assert.equal(server.calls.length, 0);
  for (const bad of [
    { ...confirmation(p), confirmed: false },
    { ...confirmation(p), memberId: s.bot.id },
    { ...confirmation(p), roleId: BOT_ROLE },
    { ...confirmation(p), approvalHash: 'bad' },
  ])
    await assert.rejects(applyRoleGrant(server.api, ID, bad, dir));
  assert.equal(server.calls.length, 0);
  const result = await applyRoleGrant(server.api, ID, confirmation(p), dir);
  assert.equal(result.success, true);
  assert.deepEqual(
    server.calls.map((c) => [c.method, c.path]),
    [['PUT', `/guilds/${ID}/members/${MEMBER}/roles/${LEGACY}`]],
  );
  assert.deepEqual(server.state.members.find((m) => m.id === MEMBER).roles, [
    '999999999999999992',
    LEGACY,
  ]);
  assert.deepEqual(server.state.roles, s.roles);
  await assert.rejects(applyRoleGrant(server.api, ID, confirmation(p), dir));
  assert.equal(server.calls.length, 1);
});
test('Administrator grant requires additional acknowledgement and permission/member drift aborts', async (t) => {
  const s = sample();
  s.roles.find((r) => r.id === LEGACY).permissions = String(P.Administrator);
  const server = fakeServer(s),
    dir = temp(t),
    p = await previewRoleGrant(server.api, ID, req, dir);
  assert.equal(p.administrator, true);
  await assert.rejects(applyRoleGrant(server.api, ID, confirmation(p), dir), /Administrator/);
  assert.equal(server.calls.length, 0);
  server.state.members.find((m) => m.id === MEMBER).roles.push('999999999999999992');
  await assert.rejects(
    applyRoleGrant(server.api, ID, { ...confirmation(p), acknowledgeAdmin: true }, dir),
    /تغيّرت/,
  );
  server.state.members.find((m) => m.id === MEMBER).roles = [];
  server.state.roles.find((r) => r.id === BOT_ROLE).permissions = '0';
  await assert.rejects(
    applyRoleGrant(server.api, ID, { ...confirmation(p), acknowledgeAdmin: true }, dir),
    /Manage Roles/,
  );
  server.state.roles.find((r) => r.id === BOT_ROLE).permissions = String(P.Administrator);
  await applyRoleGrant(server.api, ID, { ...confirmation(p), acknowledgeAdmin: true }, dir);
  assert.equal(server.calls.length, 1);
});
test('an already assigned role is not rewritten and ambiguous failures consume only that approval', async (t) => {
  const s = sample();
  s.members.find((m) => m.id === MEMBER).roles = [LEGACY];
  const server = fakeServer(s),
    dir = temp(t);
  await assert.rejects(previewRoleGrant(server.api, ID, req, dir), /بالفعل/);
  assert.equal(server.calls.length, 0);
  s.members.find((m) => m.id === MEMBER).roles = [];
  const failed = fakeServer(s, {
      beforeCall() {
        throw new Error('Transport lost');
      },
    }),
    p = await previewRoleGrant(failed.api, ID, req, dir);
  await assert.rejects(applyRoleGrant(failed.api, ID, confirmation(p), dir));
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(dir, 'role-grant-result.json'))).status,
    'failed-or-unknown',
  );
  await assert.rejects(applyRoleGrant(failed.api, ID, confirmation(p), dir), /سبق بدء/);
  assert.equal(failed.calls.length, 1);
});

test('role grants use manageability rather than OWNER or CO_OWNER names', () => {
  for (const name of ['★ OWNER ★', '★ CO_OWNER ★']) {
    const s = sample();
    s.roles.find((r) => r.id === LEGACY).name = name;
    const member = s.members.find((m) => m.id === MEMBER);
    assert.equal(prepareRoleGrant(s, req, member, nonce).roleId, LEGACY);
  }
});

test('role removal reviews an exact member-role pair and deletes only that assignment once', async (t) => {
  const s = sample();
  s.members.find((m) => m.id === MEMBER).roles = [LEGACY, '123456789012345678'];
  const server = fakeServer(s),
    dir = temp(t),
    request = { ...req, operation: 'remove' };
  const p = await previewRoleGrant(server.api, ID, request, dir);
  assert.equal(server.calls.length, 0);
  assert.equal(p.operation, 'remove');
  for (const bad of [
    { ...confirmation(p) },
    { ...confirmation(p), operation: 'grant' },
    { ...confirmation(p), operation: 'remove', memberId: s.bot.id },
  ])
    await assert.rejects(applyRoleGrant(server.api, ID, bad, dir));
  const result = await applyRoleGrant(
    server.api,
    ID,
    { ...confirmation(p), operation: 'remove' },
    dir,
  );
  assert.equal(result.status, 'removed');
  assert.deepEqual(
    server.calls.map((c) => [c.method, c.path]),
    [['DELETE', '/guilds/' + ID + '/members/' + MEMBER + '/roles/' + LEGACY]],
  );
  assert.deepEqual(server.state.members.find((m) => m.id === MEMBER).roles, ['123456789012345678']);
  assert.deepEqual(server.state.roles, s.roles);
  await assert.rejects(
    applyRoleGrant(server.api, ID, { ...confirmation(p), operation: 'remove' }, dir),
  );
  assert.equal(server.calls.length, 1);
});
test('role removal rejects protected roles, owners, peers, missing assignments, permission loss and drift', async (t) => {
  const s = sample(),
    member = s.members.find((m) => m.id === MEMBER);
  member.roles = [LEGACY];
  const request = { ...req, operation: 'remove' };
  for (const id of [ID, BOT_ROLE, '999999999999999991'])
    assert.throws(() => prepareRoleGrant(s, { ...request, roleId: id }, member, nonce));
  assert.throws(() => prepareRoleGrant(s, request, { ...member, roles: [] }, nonce));
  assert.throws(() =>
    prepareRoleGrant(s, request, { ...member, roles: [LEGACY, BOT_ROLE] }, nonce),
  );
  const owner = structuredClone(s);
  owner.guild.owner_id = MEMBER;
  assert.throws(() => prepareRoleGrant(owner, request, member, nonce));
  const server = fakeServer(s),
    dir = temp(t),
    p = await previewRoleGrant(server.api, ID, request, dir);
  server.state.members.find((m) => m.id === MEMBER).roles.push('123456789012345678');
  await assert.rejects(
    applyRoleGrant(server.api, ID, { ...confirmation(p), operation: 'remove' }, dir),
  );
  assert.equal(server.calls.length, 0);
  const noRights = structuredClone(s);
  noRights.roles.find((r) => r.id === BOT_ROLE).permissions = '0';
  assert.throws(() => prepareRoleGrant(noRights, request, member, nonce));
});
test('role member list filters one bounded page and exposes names/IDs with independent removal eligibility', async () => {
  const s = sample();
  s.members.find((m) => m.id === MEMBER).roles = [LEGACY];
  const server = fakeServer(s),
    reads = [];
  const api = {
    ...server.api,
    get: async (p) => {
      reads.push(p);
      if (p.includes('/members?'))
        return [
          { user: { id: MEMBER, username: 'Alex' }, roles: [LEGACY] },
          { user: { id: s.bot.id, username: 'Bot', bot: true }, roles: [LEGACY] },
          { user: { id: s.guild.owner_id, username: 'Owner' }, roles: [LEGACY] },
          { user: { id: '123456789012345678', username: 'Other' }, roles: [] },
        ];
      return server.api.get(p);
    },
  };
  const page = await readRoleMembers(api, ID, { roleId: LEGACY });
  assert.equal(page.members.length, 3);
  assert.equal(page.members[0].name, 'Alex');
  assert.equal(page.members[0].removable, true);
  assert.equal(page.members[1].removable, false);
  assert.equal(page.members[2].removable, false);
  assert.equal(page.next, null);
  assert.equal(server.calls.length, 0);
  assert.ok(reads.includes('/guilds/' + ID + '/members?limit=1000&after=0'));
  for (const request of [
    { roleId: 1 },
    { roleId: LEGACY, after: 'oops' },
    { roleId: LEGACY, url: 'bad' },
  ])
    await assert.rejects(readRoleMembers(api, ID, request));
  const many = Array.from({ length: 1000 }, (_, i) => ({
    user: { id: String(700000000000000000n + BigInt(i)) },
    roles: [],
  }));
  const paged = {
    ...api,
    get: (p) => (p.includes('/members?') ? Promise.resolve(many) : api.get(p)),
  };
  assert.equal((await readRoleMembers(paged, ID, { roleId: LEGACY })).next, many.at(-1).user.id);
  await assert.rejects(
    readRoleMembers(paged, ID, { roleId: LEGACY, after: many.at(-1).user.id }),
    /advance/,
  );
});
