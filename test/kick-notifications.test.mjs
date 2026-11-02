import { EventEmitter } from 'node:events';
import { startHostedBot } from '../src/hosted-bot.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKickNotifications } from '../src/kick-notifications.mjs';
import { createWelcomeEngine } from '../src/welcome-engine.mjs';
import { createWelcomeStore, welcomeDefaults, validateWelcome } from '../src/welcome-config.mjs';
import { GatewaySession } from '../src/gateway.mjs';
import { P } from '../src/permissions.mjs';
import { sample, fakeServer, ID, LEGACY, MEMBER, BOT_ROLE } from './helpers/fake.mjs';
const time = Date.parse('2026-11-01T17:00:00Z'),
  moderator = '555444333222111000',
  channel = '777777777777777777';
const entry = (extra = {}) => ({
  id: String((BigInt(time) - 1420070400000n) << 22n),
  guild_id: ID,
  target_id: MEMBER,
  user_id: moderator,
  action_type: 20,
  reason: 'Spam @everyone **links**',
  ...extra,
});
function harness(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-kick-log-'));
  t.after(() => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('cortex-kick-log-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const s = sample();
  s.roles.find((r) => r.id === BOT_ROLE).permissions = String(
    P.ViewChannel | P.SendMessages | P.EmbedLinks | P.ViewAuditLog,
  );
  const server = fakeServer(s),
    reads = [],
    statuses = [];
  const api = {
    ...server.api,
    get: async (p) => {
      reads.push(p);
      const id = p.match(/^\/users\/(\d+)$/)?.[1];
      if (id) return { id, username: id === moderator ? 'AdminSam' : 'MemberAlex' };
      return server.api.get(p);
    },
    post: (p, b) => server.api.call('POST', p, b),
  };
  const g = welcomeDefaults(ID);
  g.leave.enabled = true;
  g.leave.channelId = channel;
  g.kick = { enabled: true, channelId: channel, language: 'en' };
  const config = { version: 1, guilds: [g] },
    options = {
      api,
      config,
      stateFile: path.join(root, 'kick.json'),
      now: () => time,
      sleep: async () => {},
      onStatus: (x) => statuses.push(x),
    };
  return { root, s, server, api, config, options, reads, statuses };
}
test('confirmed kick events report the correct moderator/reason/time once, with no kick permission or member writes', async (t) => {
  const h = harness(t),
    engine = createKickNotifications(h.options);
  assert.equal(BigInt(h.s.roles.find((r) => r.id === BOT_ROLE).permissions) & P.KickMembers, 0n);
  await Promise.all([engine.handle(entry()), engine.handle(entry())]);
  assert.equal(h.server.calls.length, 1);
  const call = h.server.calls[0];
  assert.equal(call.method, 'POST');
  assert.equal(call.path, '/channels/' + channel + '/messages');
  assert.match(call.body.embeds[0].fields[0].value, /MemberAlex/);
  assert.match(call.body.embeds[0].fields[1].value, /AdminSam/);
  assert.ok(call.body.embeds[0].fields[1].value.includes(moderator));
  assert.equal(call.body.embeds[0].timestamp, new Date(time).toISOString());
  assert.ok(!call.body.embeds[0].fields[2].value.includes('@'));
  assert.deepEqual(call.body.allowed_mentions.parse, []);
  await createKickNotifications(h.options).handle(entry());
  assert.equal(h.server.calls.length, 1);
  assert.deepEqual(h.server.state.members, h.s.members);
});
test('unrelated events and bans never generate a kick report or guess an actor', async (t) => {
  const h = harness(t),
    engine = createKickNotifications(h.options);
  for (const e of [
    entry({ action_type: 21 }),
    entry({ action_type: 22 }),
    entry({ guild_id: '999999999999999999' }),
    entry({ id: 'bad' }),
    { guild_id: ID, target_id: MEMBER, type: 'GUILD_MEMBER_REMOVE' },
  ])
    await engine.handle(e);
  assert.equal(h.server.calls.length, 0);
  await engine.handle(entry({ id: String(BigInt(entry().id) + 1n), user_id: null, reason: '' }));
  assert.equal(h.server.calls.length, 1);
  assert.equal(h.server.calls[0].body.embeds[0].fields[1].value, 'Unavailable');
  assert.equal(h.server.calls[0].body.embeds[0].fields[2].value, 'No reason provided');
});
test('missing audit/channel permission prevents delivery and ambiguous sends are not retried across restart', async (t) => {
  const h = harness(t);
  h.server.state.roles.find((r) => r.id === BOT_ROLE).permissions = String(
    P.ViewChannel | P.SendMessages | P.EmbedLinks,
  );
  await createKickNotifications(h.options).checkPermissions();
  await createKickNotifications(h.options).handle(entry());
  assert.equal(h.server.calls.length, 0);
  assert.ok(h.statuses.some((s) => s.code === 'MISSING_VIEW_AUDIT_LOG'));
  h.server.state.roles.find((r) => r.id === BOT_ROLE).permissions = String(
    P.ViewChannel | P.SendMessages | P.ViewAuditLog,
  );
  await createKickNotifications(h.options).handle(entry());
  assert.equal(h.server.calls.length, 0);
  assert.ok(h.statuses.some((s) => s.code === 'KICK_LOG_DESTINATION_UNAVAILABLE'));
  h.server.state.roles.find((r) => r.id === BOT_ROLE).permissions = String(
    P.ViewChannel | P.SendMessages | P.EmbedLinks | P.ViewAuditLog,
  );
  let attempts = 0;
  const options = {
    ...h.options,
    api: {
      ...h.api,
      post: async () => {
        attempts++;
        throw Error('uncertain');
      },
    },
  };
  await createKickNotifications(options).handle(entry());
  await createKickNotifications(options).handle(entry());
  assert.equal(attempts, 1);
});
test('late audit events suppress the matching farewell without blocking ordinary leaves or later rejoins', async (t) => {
  const h = harness(t);
  let kick;
  let emit = true;
  kick = createKickNotifications({
    ...h.options,
    sleep: async () => {
      if (emit) {
        emit = false;
        await kick.handle(entry());
      }
    },
  });
  const welcome = createWelcomeEngine({
    api: h.api,
    config: h.config,
    stateFile: path.join(h.root, 'welcome.json'),
    suppressFarewell: kick.suppressFarewell,
  });
  const remove = {
    type: 'GUILD_MEMBER_REMOVE',
    guildId: ID,
    user: { id: MEMBER, username: 'MemberAlex' },
    session: 'session',
    sequence: 1,
  };
  await welcome.handle(remove);
  assert.equal(h.server.calls.length, 1);
  assert.match(h.server.calls[0].body.embeds[0].title, /kicked/);
  await welcome.handle({ ...remove, sequence: 2 });
  assert.equal(h.server.calls.length, 2);
  assert.ok(!h.server.calls[1].body.embeds[0].title.includes('kicked'));
  await kick.handle(entry());
  assert.equal(await kick.suppressFarewell(remove, h.s), false);
});
test('kick logging is opt-in, consent/revision protected and needs a destination even without welcome messages', (t) => {
  const h = harness(t),
    g = welcomeDefaults(ID);
  g.kick = { enabled: true, channelId: channel, language: 'ar' };
  const config = { version: 1, guilds: [g] },
    store = createWelcomeStore({ root: h.root }),
    current = store.read();
  assert.throws(() => store.save({ config, baseRevision: current.revision }), /Confirm/);
  const saved = store.save({ config, baseRevision: current.revision, confirmAutomatic: true });
  assert.equal(saved.config.guilds[0].kick.enabled, true);
  assert.equal(saved.config.guilds[0].join.enabled, false);
  for (const change of [
    { channelId: '' },
    { language: 'de' },
    { enabled: 'yes' },
    { kickMembers: true },
  ]) {
    const candidate = structuredClone(config);
    Object.assign(candidate.guilds[0].kick, change);
    assert.throws(() => validateWelcome(candidate));
  }
});
test('audit Gateway events are opt-in and remain separate from ordinary member events', () => {
  for (const intents of [0, 3, 7]) {
    const gateway = new GatewaySession('mock', { intents, Socket: class {} });
    gateway.session = 'session';
    let audits = 0,
      members = 0;
    gateway.on('audit-event', (e) => {
      audits++;
      assert.equal(e.user_id, moderator);
    });
    gateway.on('member-event', () => members++);
    gateway.receive({ op: 0, t: 'GUILD_AUDIT_LOG_ENTRY_CREATE', s: 1, d: entry() });
    gateway.receive({
      op: 0,
      t: 'GUILD_MEMBER_REMOVE',
      s: 2,
      d: { guild_id: ID, user: { id: MEMBER } },
    });
    assert.equal(audits, intents === 7 ? 1 : 0);
    assert.equal(members, intents ? 1 : 0);
  }
});

test('hosted kick-only configuration wires audit events and intent 7 without enabling farewell', async (t) => {
  const h = harness(t);
  h.config.guilds[0].leave.enabled = false;
  fs.mkdirSync(path.join(h.root, 'config'));
  fs.writeFileSync(
    path.join(h.root, 'config/social-feeds.json'),
    JSON.stringify({ version: 1, feeds: [] }),
  );
  fs.writeFileSync(path.join(h.root, 'config/welcome.json'), JSON.stringify(h.config));
  let instance, intents;
  class Gateway extends EventEmitter {
    constructor(token, options) {
      super();
      instance = this;
      intents = options.intents;
    }
    start() {
      this.running = true;
    }
    stop() {
      this.running = false;
    }
  }
  const bot = await startHostedBot({
    root: h.root,
    env: { DISCORD_BOT_TOKEN: 'mock-token' },
    api: h.api,
    Gateway,
    fetchItems: async () => [],
    log() {},
  });
  try {
    assert.equal(intents, 7);
    instance.emit('audit-event', entry());
    // drain the asynchronous notification before shutdown cancels queued work.
    for (let i = 0; i < 100 && !h.server.calls.length; i++)
      await new Promise((r) => setTimeout(r, 5));
    assert.equal(h.server.calls.length, 1);
    assert.match(h.server.calls[0].body.embeds[0].fields[1].value, /AdminSam/);
  } finally {
    await bot.stop();
  }
  assert.equal(instance.running, false);
});

test('kick PNG delivery retains the full reason and falls back to an embed on rendering failure', async (t) => {
  const h = harness(t);
  const role = h.server.state.roles.find((r) => r.id === BOT_ROLE);
  role.permissions = String(BigInt(role.permissions) | P.AttachFiles);
  let rendered, uploaded;
  const fullReason = 'Repeated spam '.repeat(65);
  const api = {
    ...h.api,
    post: async (p, b, o) => {
      uploaded = o;
      return h.server.api.call('POST', p, b);
    },
  };
  await createKickNotifications({
    ...h.options,
    api,
    fetchAvatar: async () => null,
    renderCard: async (d) => {
      rendered = d;
      return Buffer.from('mock-png');
    },
  }).handle(entry({ reason: fullReason }));
  assert.equal(rendered.reason, fullReason.trim());
  assert.equal(rendered.moderator, 'AdminSam · ' + moderator);
  assert.equal(uploaded.files[0].name, 'cortex-kick.png');
  assert.equal(h.server.calls[0].body.embeds, undefined);
  assert.ok(h.server.calls[0].body.content.includes(fullReason.trim()));
  assert.ok(h.server.calls[0].body.content.length <= 2000);
  await createKickNotifications({
    ...h.options,
    renderCard: async () => {
      throw Error('busy');
    },
    fetchAvatar: async () => null,
  }).handle(entry({ id: String(BigInt(entry().id) + 1n) }));
  assert.ok(h.server.calls[1].body.embeds);
  assert.ok(h.statuses.some((x) => x.code === 'KICK_CARD_RENDER_FAILED_FALLBACK'));
});

test('real kick cards render Arabic and English with bounded long reasons using the shared rounded layout', async () => {
  const { renderKickCard } = await import('../src/kick-card.mjs');
  for (const language of ['ar', 'en']) {
    const bytes = await renderKickCard({
      language,
      member: 'Alex · 123456789012345678',
      moderator: 'Sam · 234567890123456789',
      reason: 'Test reason '.repeat(80),
      server: 'Community',
    });
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16), 1000);
    assert.equal(bytes.readUInt32BE(20), 440);
    assert.ok(bytes.length < 2000000);
  }
});
