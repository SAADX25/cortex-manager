import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { P } from '../src/permissions.mjs';
import { simulatePermissions, readPermissionSimulation } from '../src/permission-simulator.mjs';
import { prepareBatch, previewBatch, applyBatch } from '../src/batch-editor.mjs';
import { createWorkspaceStore } from '../src/workspace-store.mjs';
import { revision } from '../src/editor.mjs';
import { sample, fakeServer, ID, LEGACY, MEMBER, OWNER } from './helpers/fake.mjs';
const nonce = 'a'.repeat(24);
function temp(t) {
  const base = path.resolve(os.tmpdir()),
    dir = fs.mkdtempSync(path.join(base, 'cortex-workbench-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), base);
    assert.match(path.basename(dir), /^cortex-workbench-/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
const roleEdit = (s) => ({
  kind: 'role',
  action: 'update',
  id: LEGACY,
  revision: revision(
    'role',
    s.roles.find((r) => r.id === LEGACY),
  ),
  values: { name: 'Updated role' },
  permissionChanges: { SendMessages: true },
});
const channelEdit = (s) => ({
  kind: 'channel',
  action: 'update',
  id: s.channels[1].id,
  revision: revision('channel', s.channels[1]),
  values: { name: 'updated-chat' },
  overwriteChanges: [],
});

test('simulator explains aggregate role allows, member overrides, hidden channels and sending dependencies without hierarchy shortcuts', () => {
  const s = sample(),
    channel = s.channels[1];
  s.roles.push({ id: '123456789012345678', name: 'allow role', position: 0, permissions: '0' });
  channel.permission_overwrites = [
    { id: LEGACY, type: 0, deny: String(P.ViewChannel), allow: '0' },
    { id: '123456789012345678', type: 0, allow: String(P.ViewChannel | P.EmbedLinks), deny: '0' },
  ];
  const member = { id: MEMBER, roles: [LEGACY, '123456789012345678'] },
    request = { channelId: channel.id, memberId: MEMBER };
  let p = simulatePermissions(s, request, member),
    view = p.results.find((r) => r.name === 'ViewChannel');
  assert.equal(view.allowed, true);
  assert.equal(view.trace.at(-1).stage, 'roles');
  assert.equal(view.trace.at(-1).deny[0].id, LEGACY);
  channel.permission_overwrites.push({
    id: MEMBER,
    type: 1,
    deny: String(P.SendMessages),
    allow: '0',
  });
  p = simulatePermissions(s, request, member);
  assert.equal(p.results.find((r) => r.name === 'SendMessages').allowed, false);
  assert.equal(
    p.results.find((r) => r.name === 'EmbedLinks').trace.at(-1).permission,
    'SendMessages',
  );
  channel.permission_overwrites.at(-1).deny = String(P.ViewChannel);
  p = simulatePermissions(s, request, member);
  assert.equal(
    p.results.find((r) => r.name === 'SendMessages').trace.at(-1).permission,
    'ViewChannel',
  );
});

test('simulator handles owner, administrator, timeout and role-only mode and only performs GET requests', async () => {
  const s = sample(),
    channel = s.channels[1],
    request = { channelId: channel.id, memberId: MEMBER };
  s.roles.find((r) => r.id === LEGACY).permissions = String(
    P.ViewChannel | P.SendMessages | P.Connect | P.Speak,
  );
  const member = {
    id: MEMBER,
    roles: [LEGACY],
    communication_disabled_until: '2099-01-01T00:00:00Z',
  };
  let p = simulatePermissions(s, request, member);
  assert.equal(p.timedOut, true);
  assert.equal(p.results.find((r) => r.name === 'SendMessages').allowed, false);
  p = simulatePermissions(
    s,
    { channelId: channel.id, memberId: OWNER },
    { id: OWNER, roles: [], communication_disabled_until: member.communication_disabled_until },
  );
  assert.equal(p.owner, true);
  assert.ok(p.results.every((r) => r.allowed));
  p = simulatePermissions(s, { channelId: channel.id, roleIds: ['999999999999999991'] });
  assert.equal(p.administrator, true);
  assert.ok(p.results.every((r) => r.allowed));
  channel.type = 2;
  channel.permission_overwrites = [{ id: ID, type: 0, allow: '0', deny: String(P.Connect) }];
  p = simulatePermissions(s, { channelId: channel.id, roleIds: [LEGACY] });
  assert.equal(p.results.find((r) => r.name === 'Speak').trace.at(-1).permission, 'Connect');
  assert.throws(() =>
    simulatePermissions(s, { channelId: channel.id, memberId: MEMBER, roleIds: [] }, member),
  );
  assert.throws(() => simulatePermissions(s, { channelId: channel.id, roleIds: ['1'] }));
  const server = fakeServer(s);
  await readPermissionSimulation(server.api, ID, { channelId: channel.id, memberId: MEMBER });
  assert.deepEqual(server.calls, []);
});

test('batch previews read only and exact confirmed execution patches only reviewed existing entities once', async (t) => {
  const dir = temp(t),
    s = sample(),
    server = fakeServer(s),
    requests = [roleEdit(s), channelEdit(s)];
  const p = await previewBatch(server.api, ID, requests, dir);
  assert.equal(server.calls.length, 0);
  assert.equal(p.items.length, 2);
  await assert.rejects(
    applyBatch(
      server.api,
      ID,
      { confirmed: false, guildId: ID, approvalHash: p.approvalHash },
      dir,
    ),
  );
  assert.equal(server.calls.length, 0);
  const result = await applyBatch(
    server.api,
    ID,
    { confirmed: true, guildId: ID, approvalHash: p.approvalHash },
    dir,
  );
  assert.equal(result.success, true);
  assert.equal(result.completed.length, 2);
  assert.ok(server.calls.every((c) => c.method === 'PATCH'));
  assert.deepEqual(server.state.members, s.members);
  assert.deepEqual(
    server.state.roles.find((r) => r.name === '★ OWNER ★'),
    s.roles.find((r) => r.name === '★ OWNER ★'),
  );
  await assert.rejects(
    applyBatch(server.api, ID, { confirmed: true, guildId: ID, approvalHash: p.approvalHash }, dir),
  );
  assert.equal(server.calls.length, 2);
});

test('batch rejects protected roles, duplicate entities, unsupported operations and drift before writing', async (t) => {
  const s = sample();
  assert.throws(() => prepareBatch(s, [{ ...roleEdit(s), action: 'create' }], nonce));
  assert.throws(() => prepareBatch(s, [roleEdit(s), roleEdit(s)], nonce));
  const owner = s.roles.find((r) => r.name === '★ OWNER ★');
  assert.throws(() =>
    prepareBatch(s, [{ ...roleEdit(s), id: owner.id, revision: revision('role', owner) }], nonce),
  );
  const server = fakeServer(s),
    dir = temp(t),
    p = await previewBatch(server.api, ID, [roleEdit(s)], dir);
  server.state.channels[1].name = 'external change';
  await assert.rejects(
    applyBatch(server.api, ID, { confirmed: true, guildId: ID, approvalHash: p.approvalHash }, dir),
  );
  assert.equal(server.calls.length, 0);
});

test('batch stops on a failed or uncertain write and records completed and remaining items without retrying the plan', async (t) => {
  const s = sample(),
    dir = temp(t),
    server = fakeServer(s, {
      beforeCall(method, route) {
        if (route.startsWith('/channels/')) throw new Error('Network lost');
      },
    }),
    p = await previewBatch(server.api, ID, [roleEdit(s), channelEdit(s)], dir);
  await assert.rejects(
    applyBatch(server.api, ID, { confirmed: true, guildId: ID, approvalHash: p.approvalHash }, dir),
    /Network lost/,
  );
  const result = JSON.parse(fs.readFileSync(path.join(dir, 'batch-result.json'), 'utf8'));
  assert.equal(result.completed.length, 1);
  assert.equal(result.remaining.length, 1);
  assert.equal(result.status, 'failed-or-unknown');
  assert.equal(result.uncertain.id, s.channels[1].id);
});

test('batch requires explicit Administrator acknowledgement and stops on external drift between writes', async (t) => {
  const s = sample(),
    dir = temp(t),
    server = fakeServer(s),
    request = roleEdit(s);
  request.permissionChanges.Administrator = true;
  const p = await previewBatch(server.api, ID, [request], dir);
  await assert.rejects(
    applyBatch(server.api, ID, { confirmed: true, guildId: ID, approvalHash: p.approvalHash }, dir),
    /Administrator/,
  );
  assert.equal(server.calls.length, 0);
  const driftDir = temp(t),
    drift = fakeServer(s, {
      beforeCall(method, route, body, state) {
        if (route.includes('/roles/')) state.channels[1].topic = 'Changed by another administrator';
      },
    }),
    q = await previewBatch(drift.api, ID, [roleEdit(s), channelEdit(s)], driftDir);
  await assert.rejects(
    applyBatch(
      drift.api,
      ID,
      { confirmed: true, guildId: ID, approvalHash: q.approvalHash },
      driftDir,
    ),
    /أثناء التنفيذ/,
  );
  assert.equal(drift.calls.length, 1);
  const result = JSON.parse(fs.readFileSync(path.join(driftDir, 'batch-result.json'), 'utf8'));
  assert.equal(result.status, 'partial');
  assert.equal(result.completed.length, 1);
});

test('an ambiguous first batch write consumes approval even if the server still looks unchanged', async (t) => {
  const s = sample(),
    dir = temp(t),
    server = fakeServer(s, {
      beforeCall() {
        throw new Error('Connection lost');
      },
    }),
    p = await previewBatch(server.api, ID, [roleEdit(s)], dir),
    confirmation = { confirmed: true, guildId: ID, approvalHash: p.approvalHash };
  await assert.rejects(applyBatch(server.api, ID, confirmation, dir), /Connection lost/);
  await assert.rejects(applyBatch(server.api, ID, confirmation, dir), /سبق بدء/);
  assert.equal(server.calls.length, 1);
});

test('workspace persists partial drafts independently per server, rejects credentials/approvals and detects concurrent saves', (t) => {
  const root = temp(t),
    store = createWorkspaceStore({ root }),
    first = store.read(ID),
    s = sample(),
    entry = {
      key: 'role:' + LEGACY,
      request: roleEdit(s),
      tab: 'permissions',
      overwriteRole: '',
      staged: true,
    };
  entry.request.values.name = '';
  const saved = store.save(ID, { baseRevision: first.revision, entries: [entry] });
  assert.deepEqual(createWorkspaceStore({ root }).read(ID).entries, [entry]);
  assert.equal(store.read(MEMBER).entries.length, 0);
  assert.equal(createWorkspaceStore({ root, demo: true }).read(ID).entries.length, 0);
  assert.throws(() => store.save(ID, { baseRevision: first.revision, entries: [] }), /نافذة أخرى/);
  for (const extra of [{ token: 'secret' }, { approval: { confirmed: true } }])
    assert.throws(() =>
      store.save(ID, { baseRevision: saved.revision, entries: [{ ...entry, ...extra }] }),
    );
  assert.throws(() => store.read('../escape'));
  assert.throws(() =>
    store.save(ID, {
      baseRevision: saved.revision,
      entries: [{ ...entry, request: { ...entry.request, action: 'delete' } }],
    }),
  );
});
