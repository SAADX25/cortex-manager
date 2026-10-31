import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultDesign, designTemplate, validateCustomDesign } from '../src/custom-design.mjs';
import { plan, renderPreview } from '../src/plan.mjs';
import { rebuild } from '../src/rebuild.mjs';
import { P, createOverwrites } from '../src/permissions.mjs';
import { sample, fakeServer, ID, LEGACY, MEMBER } from './helpers/fake.mjs';
function custom() {
  return {
    version: 1,
    language: 'en',
    roles: [
      {
        key: 'staffnew',
        name: '🛡️・Custom Staff',
        color: 0x8055cc,
        permissions: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageMessages'],
        hoist: true,
      },
      {
        key: 'player',
        name: '🎮・Custom Player',
        color: 0x30aa99,
        permissions: ['ViewChannel', 'ReadMessageHistory', 'Connect', 'Speak'],
      },
    ],
    categories: [
      {
        key: 'lounge',
        name: '📁・Custom Lounge',
        access: 'public',
        channels: [
          {
            key: 'bulletin',
            name: '📜・Bulletin Board',
            type: 'text',
            readonly: true,
            readonlyWriters: ['staffnew'],
            topic: 'Custom topic',
            message: 'Custom opening message',
          },
          {
            key: 'privatevoice',
            name: 'Custom Voice',
            type: 'voice',
            private: true,
            accessKeys: ['player'],
            userLimit: 7,
          },
        ],
      },
      {
        key: 'office',
        name: 'Private Office',
        access: 'staff',
        staffKeys: ['staffnew'],
        channels: [{ key: 'staffonly', name: 'staff-chat', type: 'text' }],
      },
    ],
    migrations: {},
  };
}
test('Arabic and English presets are valid independent copies with translated channel and role names', () => {
  const ar = validateCustomDesign(designTemplate('ar')),
    en = validateCustomDesign(designTemplate('en'));
  assert.match(ar.roles[0].name, /الإدارة/);
  assert.match(en.categories[0].name, /Welcome/);
  assert.match(en.categories[0].channels[1].message, /Community Rules/);
  ar.roles[0].name = 'changed';
  assert.notEqual(defaultDesign().roles[0].name, 'changed');
  assert.equal(validateCustomDesign(custom()).categories[0].channels[0].name, '📜・bulletin-board');
});
test('custom validation rejects empty destructive templates, duplicates, unknown fields and dangling private access', () => {
  const mutations = [
    (d) => (d.roles = []),
    (d) => (d.categories = []),
    (d) => (d.roles[0].key = 'toString'),
    (d) => (d.roles[0].permissions = ['Anything']),
    (d) => d.roles.push({ ...d.roles[0], key: 'another' }),
    (d) => (d.categories[0].channels[1].accessKeys = []),
    (d) => (d.categories[1].staffKeys = ['missing']),
    (d) => (d.categories[0].channels[0].slowmode = 21601),
    (d) => (d.categories[0].channels[1].userLimit = 100),
    (d) => (d.categories[1].channels[0].name = d.categories[0].channels[0].name),
    (d) => (d.owner_id = '1'),
    (d) => (d.migrations = { [ID]: 'missing' }),
    (d) => (d.categories[0].channels[0].message = 'a'.repeat(2001)),
  ];
  for (const mutate of mutations) {
    const d = custom();
    mutate(d);
    assert.throws(() => validateCustomDesign(d));
  }
});
test('custom fields and mappings bind approval; reports describe actual customized channels and seed messages', () => {
  const s = sample(),
    d = custom(),
    first = plan(s, undefined, d),
    report = renderPreview(s, first);
  assert.match(report, /bulletin-board/);
  assert.match(report, /Custom opening message/);
  assert.match(report, /staffnew/);
  for (const change of [
    (d) => d.roles[0].color++,
    (d) => (d.categories[0].channels[0].message = 'new'),
    (d) => (d.categories[0].channels[1].accessKeys = ['staffnew']),
    (d) => (d.migrations = { [LEGACY]: 'player' }),
  ]) {
    const changed = custom();
    change(changed);
    assert.notEqual(plan(s, undefined, changed).approvalHash, first.approvalHash);
  }
  s.guild.rules_channel_id = s.channels[1].id;
  s.channels[1].name = 'rules';
  const protectedPlan = plan(s, undefined, d);
  assert.ok(protectedPlan.keepChannels.some((c) => c.id === s.channels[1].id));
  assert.equal(protectedPlan.totals.createChannels, 3);
});

test('private read-only access does not grant writing to every viewer', () => {
  const d = custom(),
    category = d.categories[1],
    channel = {
      type: 'text',
      readonly: true,
      private: true,
      accessKeys: ['staffnew', 'player'],
      readonlyWriters: ['staffnew'],
    };
  const rows = createOverwrites(
    category,
    { staffnew: 'staff', player: 'player', leadership: ['owner'] },
    'guild',
    'bot',
    channel,
  );
  assert.ok(BigInt(rows.find((w) => w.id === 'guild').deny) & P.ViewChannel);
  assert.ok(BigInt(rows.find((w) => w.id === 'guild').deny) & P.SendMessages);
  assert.ok(BigInt(rows.find((w) => w.id === 'player').allow) & P.ViewChannel);
  assert.equal(BigInt(rows.find((w) => w.id === 'player').allow) & P.SendMessages, 0n);
  assert.ok(BigInt(rows.find((w) => w.id === 'staff').allow) & P.SendMessages);
});
test('custom rebuild uses the reviewed blueprint, creates before deleting, migrates additively and preserves leadership', async () => {
  const s = sample();
  s.members.find((m) => m.id === MEMBER).roles = [LEGACY];
  const d = custom();
  d.migrations = { [LEGACY]: 'player' };
  const p = plan(s, undefined, d),
    server = fakeServer(s);
  const result = await rebuild(server.api, s, p, {
    capture: server.capture,
    inventory: server.inventory,
  });
  assert.equal(result.success, true);
  assert.equal(result.created.length, 7);
  assert.ok(
    server.calls.findIndex((c) => c.method === 'DELETE') >
      server.calls.findLastIndex((c) => c.method === 'POST'),
  );
  const player = server.state.roles.find((r) => r.name === '🎮・Custom Player'),
    staff = server.state.roles.find((r) => r.name === '🛡️・Custom Staff');
  assert.ok(server.state.members.find((m) => m.id === MEMBER).roles.includes(player.id));
  const voice = server.state.channels.find((c) => c.name === 'Custom Voice');
  assert.equal(voice.user_limit, 7);
  assert.ok(BigInt(voice.permission_overwrites.find((w) => w.id === ID).deny) & P.ViewChannel);
  assert.ok(
    BigInt(voice.permission_overwrites.find((w) => w.id === player.id).allow) & P.ViewChannel,
  );
  const text = server.state.channels.find((c) => c.name === '📜・bulletin-board');
  assert.ok(
    BigInt(text.permission_overwrites.find((w) => w.id === staff.id).allow) & P.SendMessages,
  );
  for (const role of s.roles.filter((r) => r.name.includes('OWNER')))
    assert.ok(!server.calls.some((c) => c.path.endsWith('/roles/' + role.id)));
  assert.equal(plan(server.state, undefined, d).totals.createChannels, 0);
});

test('custom blueprints may create roles with server-specific OWNER names', () => {
  const d = custom();
  d.roles[0].name = '★ OWNER ★';
  d.roles[1].name = '★ CO_OWNER ★';
  assert.doesNotThrow(() => validateCustomDesign(d));
});
