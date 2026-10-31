const PROTECTED_ROLE_NAMES = ['★ OWNER ★', '★ CO_OWNER ★']; // Fixture names; protected here by hierarchy, not by name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rebuild } from '../src/rebuild.mjs';
import { plan } from '../src/plan.mjs';

import { ROLES, CATEGORIES } from '../src/design.mjs';
import { ID, BOT, LEGACY, MEMBER, sample, fakeServer } from './helpers/fake.mjs';
const run = (server, s, p = plan(s), extra = {}) =>
  rebuild(server.api, s, p, { capture: server.capture, inventory: server.inventory, ...extra });

test('full rebuild creates everything before deletion and preserves leadership, members and integrations', async () => {
  const s = sample(),
    server = fakeServer(s),
    result = await run(server, s);
  assert.ok(result.success);
  assert.equal(result.created.length, 11 + 7 + 31);
  assert.equal(result.deleted.length, 3);
  const firstDelete = server.calls.findIndex((c) => c.method === 'DELETE');
  const lastCreate = server.calls.findLastIndex((c) => c.method === 'POST');
  assert.ok(firstDelete > lastCreate);
  for (const r of s.roles.filter((r) => PROTECTED_ROLE_NAMES.includes(r.name))) {
    const current = server.state.roles.find((x) => x.id === r.id);
    assert.equal(current.name, r.name);
    assert.equal(current.permissions, r.permissions);
    assert.ok(!server.calls.some((c) => c.path.endsWith('/roles/' + r.id)));
  }
  assert.deepEqual(server.state.members, s.members);
  assert.ok(server.state.roles.some((r) => r.name === 'Cortex Manager'));
  const admin = server.state.roles.find((r) => r.name === ROLES[0].name),
    muted = server.state.roles.find((r) => r.name === ROLES.at(-1).name);
  assert.ok(admin.position > muted.position);
  const again = plan(server.state);
  assert.equal(again.totals.createRoles, 0);
  assert.equal(again.totals.createChannels, 0);
  assert.equal(again.oldRoles.length, 0);
  assert.equal(again.oldChannels.length, 0);
  const second = await run(server, structuredClone(server.state), again);
  assert.equal(second.created.length, 0);
  assert.equal(second.deleted.length, 0);
});
test('Community rules, updates and parents never receive writes or duplicate replacements', async () => {
  const s = sample();
  s.channels[1].name = 'rules';
  s.guild.rules_channel_id = s.channels[1].id;
  s.channels.push({
    id: '999999999999999994',
    name: 'moderator-only',
    type: 0,
    parent_id: s.channels[0].id,
  });
  s.guild.public_updates_channel_id = s.channels[2].id;
  const p = plan(s),
    server = fakeServer(s);
  await run(server, s, p);
  for (const c of s.channels) {
    assert.deepEqual(
      server.state.channels.find((x) => x.id === c.id),
      c,
    );
    assert.ok(!server.calls.some((x) => x.path === `/channels/${c.id}`));
  }
  assert.ok(
    !server.state.channels.some(
      (c) => c.name === CATEGORIES[0].channels.find((ch) => ch.key === 'rules').name,
    ),
  );
});
test('assigned legacy role is migrated additively and verified before deletion', async () => {
  const s = sample();
  s.members.find((m) => m.id === MEMBER).roles = [LEGACY, '999999999999999992'];
  const server = fakeServer(s),
    p = plan(s, { [LEGACY]: 'member' }),
    result = await run(server, s, p);
  const replacement = server.state.roles.find(
    (r) => r.name === ROLES.find((r) => r.key === 'member').name,
  );
  assert.deepEqual(server.state.members.find((m) => m.id === MEMBER).roles, [
    '999999999999999992',
    replacement.id,
  ]);
  assert.equal(result.migrated.length, 1);
  assert.ok(
    server.calls.findIndex((c) => c.method === 'PUT') <
      server.calls.findIndex((c) => c.method === 'DELETE'),
  );
});
test('unmapped member assignments stay unchanged and role is reported retained', async () => {
  const s = sample();
  s.members.find((m) => m.id === MEMBER).roles = [LEGACY];
  const server = fakeServer(s);
  const result = await run(server, s);
  assert.deepEqual(server.state.members, s.members);
  assert.ok(result.unmigrated.some((x) => x.roleId === LEGACY));
  assert.ok(server.state.roles.some((r) => r.id === LEGACY));
});
test('creation failure saves partial report and deletes nothing; rerun discovers created roles', async () => {
  const s = sample(),
    saved = {};
  const server = fakeServer(s, {
    beforeCall: (method, path) => {
      if (method === 'POST' && path.endsWith('/channels'))
        throw new Error('simulated create failure');
    },
  });
  await assert.rejects(
    run(server, s, plan(s), { save: (file, data) => (saved[file] = structuredClone(data)) }),
    /simulated/,
  );
  assert.ok(server.calls.every((c) => c.method !== 'DELETE'));
  assert.equal(saved['result.json'].success, false);
  assert.equal(saved['result.json'].created.length, 11);
  assert.equal(plan(server.state).totals.createRoles, 0);
});
test('migration failure stops before ANY old deletion and reports affected assignment', async () => {
  const s = sample();
  s.members.find((m) => m.id === MEMBER).roles = [LEGACY];
  const saved = {};
  const server = fakeServer(s, {
    beforeCall: (method) => {
      if (method === 'PUT') throw new Error('missing permission');
    },
  });
  await assert.rejects(
    run(server, s, plan(s, { [LEGACY]: 'member' }), {
      save: (file, data) => (saved[file] = structuredClone(data)),
    }),
    /no old structure deleted/,
  );
  assert.ok(server.calls.every((c) => c.method !== 'DELETE'));
  assert.ok(server.state.roles.some((r) => r.id === LEGACY));
  assert.ok(saved['result.json'].unmigrated.some((x) => x.memberIds.includes(MEMBER)));
});
test('same-ID permission drift since preview aborts before mutation', async () => {
  const s = sample(),
    server = fakeServer(s, {
      onCapture: (n, state) => {
        if (n === 1) state.roles.find((r) => r.id === LEGACY).permissions = '1024';
      },
    });
  await assert.rejects(run(server, s), /changed since preview/);
  assert.equal(server.calls.length, 0);
});
test('role becoming managed or changing its name during rebuild is skipped at deletion', async () => {
  for (const change of [(r) => (r.managed = true), (r) => (r.name = '★ OWNER ★')]) {
    const s = sample(),
      server = fakeServer(s, {
        onCapture: (n, state) => {
          if (n === 2) change(state.roles.find((r) => r.id === LEGACY));
        },
      });
    const result = await run(server, s);
    assert.ok(server.state.roles.some((r) => r.id === LEGACY));
    assert.ok(result.retainedRoles.some((r) => r.id === LEGACY));
    assert.ok(
      !server.calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/roles/' + LEGACY)),
    );
  }
});
test('new assignment during rebuild retains source role instead of silently losing access', async () => {
  const s = sample(),
    server = fakeServer(s, {
      onCapture: (n, state) => {
        if (n === 2) state.members.find((m) => m.id === MEMBER).roles.push(LEGACY);
      },
    });
  const result = await run(server, s);
  assert.ok(server.state.roles.some((r) => r.id === LEGACY));
  assert.ok(result.unmigrated.some((r) => r.roleId === LEGACY));
});
test('new Community protection prevents deletion and keeps its parent', async () => {
  const s = sample(),
    server = fakeServer(s, {
      onCapture: (n, state) => {
        if (n === 2) state.guild.rules_channel_id = s.channels[1].id;
      },
    });
  const result = await run(server, s);
  assert.equal(result.deleted.filter((e) => e.type === 'channel').length, 0);
});
test('protected role data change stops before deleting any old structure', async () => {
  const s = sample(),
    server = fakeServer(s, {
      onCapture: (n, state) => {
        if (n === 2) state.roles.find((r) => r.name === '★ CO_OWNER ★').permissions = '0';
      },
    });
  await assert.rejects(run(server, s), /Protected role changed/);
  assert.ok(server.calls.every((c) => c.method !== 'DELETE'));
});
test('missing member inventory allows channel rebuild but never deletes obsolete roles', async () => {
  const s = sample();
  s.membersComplete = false;
  const server = fakeServer(s);
  const result = await run(server, s);
  assert.ok(result.success);
  assert.ok(server.state.roles.some((r) => r.id === LEGACY));
  assert.ok(!result.deleted.some((e) => e.type === 'role'));
});

test('matching design role that is managed is preserved without patches or duplicates', async () => {
  const s = sample();
  s.roles.push({
    id: '999999999999999993',
    name: ROLES[0].name,
    position: 2,
    permissions: '0',
    managed: true,
  });
  const p = plan(s);
  assert.equal(p.blockers.length, 0);
  assert.equal(p.totals.createRoles, 10);
  const server = fakeServer(s);
  await run(server, s, p);
  assert.equal(server.state.roles.filter((r) => r.name === ROLES[0].name).length, 1);
  assert.ok(!server.calls.some((c) => c.path.endsWith('/roles/999999999999999993')));
});
test('missing replacement stops cleanup before any old deletion', async () => {
  const s = sample(),
    server = fakeServer(s, {
      onCapture: (n, state) => {
        if (n === 2)
          state.channels = state.channels.filter((c) => c.id !== state.channels.at(-1).id);
      },
    });
  await assert.rejects(run(server, s), /Replacement disappeared/);
  assert.ok(server.calls.every((c) => c.method !== 'DELETE'));
});
test('channel edited during creation is retained with its parent', async () => {
  const s = sample(),
    server = fakeServer(s, {
      onCapture: (n, state) => {
        if (n === 2) state.channels.find((c) => c.id === s.channels[1].id).topic = 'new topic';
      },
    });
  const result = await run(server, s);
  assert.ok(!result.deleted.some((e) => e.type === 'channel'));
  assert.ok(result.retainedChannels.some((c) => c.id === s.channels[1].id));
});
test('role newly needed by a Community overwrite is retained at cleanup', async () => {
  const s = sample(),
    server = fakeServer(s, {
      onCapture: (n, state) => {
        if (n === 2) {
          state.guild.rules_channel_id = s.channels[1].id;
          state.channels.find((c) => c.id === s.channels[1].id).permission_overwrites = [
            { id: LEGACY, type: 0, allow: '1024', deny: '0' },
          ];
        }
      },
    });
  const result = await run(server, s);
  assert.ok(server.state.roles.some((r) => r.id === LEGACY));
  assert.ok(
    result.retainedRoles.some((r) => r.id === LEGACY && r.reason.includes('preserved channel')),
  );
});

test('custom OWNER names below the bot can be deleted by a reviewed rebuild without touching guild ownership or members', async () => {
  const s = sample(),
    ids = s.roles.filter((r) => r.name.includes('OWNER')).map((r) => r.id);
  for (const r of s.roles.filter((r) => ids.includes(r.id))) r.position = 4;
  for (const m of s.members) m.roles = m.roles.filter((id) => !ids.includes(id));
  const p = plan(s);
  for (const id of ids) assert.ok(p.oldRoles.some((r) => r.id === id));
  const server = fakeServer(s),
    result = await run(server, s, p);
  assert.ok(result.success);
  for (const id of ids)
    assert.ok(
      server.calls.some(
        (c) => c.method === 'DELETE' && c.path === '/guilds/' + ID + '/roles/' + id,
      ),
    );
  assert.equal(server.state.guild.owner_id, s.guild.owner_id);
  assert.deepEqual(server.state.members, s.members);
  assert.ok(server.calls.every((c) => !['/bans', '/kick'].some((x) => c.path.includes(x))));
});
