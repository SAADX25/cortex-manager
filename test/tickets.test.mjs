import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { EventEmitter } from 'node:events';
import { createTicketEngine } from '../src/ticket-engine.mjs';
import { createTicketStore, ticketDefaults, validateTickets } from '../src/ticket-config.mjs';
import { startHostedBot, hostedStartupDiagnostic } from '../src/hosted-bot.mjs';
import { GatewaySession } from '../src/gateway.mjs';
import { DiscordAPI } from '../src/api.mjs';
import { TICKET_COLORS } from '../src/ticket-status.mjs';
import { P } from '../src/permissions.mjs';
import { sample, fakeServer, ID, BOT, BOT_ROLE, LEGACY, MEMBER, OWNER } from './helpers/fake.mjs';

const STAFF = '888888888888888889',
  PANEL = '777777777777777777',
  CATEGORY = '666666666666666666';
const settings = (extra = {}) => ({
  ...ticketDefaults(ID),
  enabled: true,
  panelChannelId: PANEL,
  categoryId: CATEGORY,
  staffRoleIds: [LEGACY],
  ...extra,
});
const config = (extra) => ({ version: 1, guilds: [settings(extra)] });
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-tickets-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.match(path.basename(dir), /^cortex-tickets-/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
function harness(t, extra = {}) {
  const dir = temp(t),
    server = fakeServer(sample()),
    trace = [],
    responses = [],
    logs = [];
  const messages = new Map();
  server.state.members.push({ id: STAFF, roles: [LEGACY] });
  const api = {
    async get(p) {
      trace.push(['get', p]);
      if (p === '/oauth2/applications/@me') return { id: BOT };
      const messageRoute = p.match(/^\/channels\/(\d+)\/messages(?:\/(\d+)|\?limit=100)$/);
      if (messageRoute) {
        if (messageRoute[2]) {
          const message = messages.get(messageRoute[2]);
          if (!message || message.channel_id !== messageRoute[1]) throw new Error('HTTP 404');
          return structuredClone(message);
        }
        return [...messages.values()]
          .filter((m) => m.channel_id === messageRoute[1])
          .reverse()
          .slice(0, 100)
          .map((m) => structuredClone(m));
      }
      const memberId = p.match(/^\/guilds\/\d+\/members\/(\d+)$/)?.[1];
      if (memberId) {
        const member = server.state.members.find((m) => m.id === memberId);
        if (!member) throw new Error('Missing member');
        return {
          user: {
            id: member.id,
            bot: member.id === BOT,
            username: member.id === STAFF ? 'Support Ali' : 'Member',
          },
          nick: member.nick,
          roles: [...member.roles],
        };
      }
      return server.api.get(p);
    },
    async post(p, b) {
      trace.push(['post', p]);
      if (p.endsWith('/commands')) return { id: '123456789012345678', ...b };
      const result = await server.api.call('POST', p, b);
      const channelId = p.match(/^\/channels\/(\d+)\/messages$/)?.[1];
      if (channelId)
        messages.set(result.id, {
          ...structuredClone(b),
          id: result.id,
          channel_id: channelId,
          author: { id: BOT },
        });
      return result;
    },
    async patch(p, b) {
      const messageId = p.match(/^\/channels\/\d+\/messages\/(\d+)$/)?.[1];
      if (messageId) {
        if (!messages.has(messageId)) throw new Error('HTTP 404');
        server.calls.push({ method: 'PATCH', path: p, body: structuredClone(b) });
        Object.assign(messages.get(messageId), structuredClone(b));
        return structuredClone(messages.get(messageId));
      }
      return server.api.call('PATCH', p, b);
    },
  };
  const responseAPI = {
    async post(p, b) {
      trace.push(['ack', p]);
      responses.push({ method: 'POST', p, b });
    },
    async patch(p, b) {
      responses.push({ method: 'PATCH', p, b });
    },
  };
  const stateFile = path.join(dir, 'tickets.json');
  const make = () =>
    createTicketEngine({
      api,
      responseAPI,
      config: config(extra),
      stateFile,
      onStatus: (event) => logs.push(event),
    });
  let next = 123400000000000000n;
  function interaction(action = 'submit', userId = MEMBER, channelId = PANEL) {
    const type = action === 'submit' ? 5 : action.includes(':') ? 3 : 2;
    return {
      id: String(next++),
      application_id: BOT,
      guild_id: ID,
      channel_id: channelId,
      token: 'test-interaction-secret',
      type,
      member: {
        user: { id: userId },
        roles: [...server.state.members.find((m) => m.id === userId).roles],
      },
      data:
        action === 'submit'
          ? {
              custom_id: 'cortex:ticket:submit',
              components: [
                {
                  type: 18,
                  component: { type: 4, custom_id: 'subject', value: 'Help @everyone' },
                },
                {
                  type: 18,
                  component: {
                    type: 4,
                    custom_id: 'description',
                    value: 'Details <@&999999999999999992>',
                  },
                },
              ],
            }
          : type === 3
            ? { custom_id: 'cortex:ticket:' + action.split(':')[1] }
            : { name: action },
    };
  }
  const read = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const created = () => server.calls.filter((c) => c.path === `/guilds/${ID}/channels`);
  return {
    dir,
    server,
    api,
    responseAPI,
    trace,
    responses,
    logs,
    messages,
    stateFile,
    make,
    interaction,
    read,
    created,
  };
}

test('ticket settings require explicit staff, validate IDs, reject unknown fields and protect revisions', (t) => {
  assert.deepEqual(validateTickets(config()), config());
  for (const extra of [
    { staffRoleIds: [] },
    { staffRoleIds: [ID] },
    { requesterRoleIds: [ID] },
    { staffRoleIds: [LEGACY, LEGACY] },
    { categoryId: '' },
    { language: 'x' },
    { panelChannelId: '../secret' },
    { token: 'secret' },
  ])
    assert.throws(() => validateTickets(config(extra)));
  const root = temp(t),
    store = createTicketStore({ root }),
    current = store.read();
  assert.throws(() => store.save({ baseRevision: current.revision, config: config() }), /Confirm/);
  const saved = store.save({
    baseRevision: current.revision,
    config: config(),
    confirmAutomatic: true,
  });
  assert.notEqual(saved.revision, current.revision);
  assert.throws(
    () => store.save({ baseRevision: current.revision, config: config(), confirmAutomatic: true }),
    (e) => e.status === 409,
  );
  assert.deepEqual(createTicketStore({ root, demo: true }).read().config.guilds, []);
});

test('registration upserts only ticket commands and Gateway interaction delivery is opt-in', async (t) => {
  const h = harness(t),
    engine = h.make();
  await engine.register();
  const calls = h.trace.filter(([m]) => m === 'post');
  assert.equal(calls.length, 5);
  assert.ok(calls.every(([, p]) => p === `/applications/${BOT}/guilds/${ID}/commands`));
  for (const enabled of [false, true]) {
    const gateway = new GatewaySession('test', { Socket: class {}, receiveInteractions: enabled });
    gateway.session = 'session';
    const events = [];
    gateway.on('interaction', (i) => events.push(i));
    gateway.receive({ op: 0, t: 'INTERACTION_CREATE', d: { id: 'event' }, s: 1 });
    assert.equal(events.length, Number(enabled));
  }
});

test('slash command and public button open the form without creating channels', async (t) => {
  const h = harness(t),
    engine = h.make();
  await engine.handle(h.interaction('ticket'));
  await engine.handle(h.interaction('button:open'));
  assert.equal(h.server.calls.length, 0);
  assert.equal(h.responses.length, 2);
  assert.ok(h.responses.every((r) => r.b.type === 9));
  assert.equal(h.responses[0].b.data.components[1].component.max_length, 1500);
});

test('submitted ticket creates explicit private overwrites and pings only configured staff and requester', async (t) => {
  const h = harness(t),
    engine = h.make(),
    i = h.interaction();
  await engine.handle(i);
  const channel = h.created()[0].body;
  assert.equal(h.trace[0][0], 'ack');
  assert.equal(h.responses[0].b.type, 5);
  assert.equal(h.responses[0].b.data.flags, 64);
  assert.equal(channel.parent_id, CATEGORY);
  assert.equal(channel.topic, `cortex-ticket:${i.id}:${MEMBER}`);
  assert.deepEqual(
    channel.permission_overwrites.map((o) => o.id),
    [ID, LEGACY, MEMBER, BOT],
  );
  assert.equal(BigInt(channel.permission_overwrites[0].deny), P.ViewChannel);
  assert.ok(BigInt(channel.permission_overwrites[1].allow) & P.ViewChannel);
  const notification = h.server.calls.find((c) => c.path.endsWith('/messages')).body;
  assert.deepEqual(notification.allowed_mentions, { parse: [], roles: [LEGACY], users: [MEMBER] });
  assert.equal(h.read().tickets[i.id].status, 'open');
  assert.ok(!fs.readFileSync(h.stateFile, 'utf8').includes(i.token));
  await engine.handle(i);
  assert.equal(h.created().length, 1);
});

test('requester restrictions are checked again against current membership on submit', async (t) => {
  const h = harness(t, { requesterRoleIds: [LEGACY] }),
    engine = h.make();
  const stale = h.interaction();
  stale.member.roles = [LEGACY];
  await engine.handle(stale);
  await engine.handle(h.interaction('ticket'));
  assert.equal(h.created().length, 0);
  assert.match(h.responses.find((r) => r.method === 'PATCH').b.content, /الرتبة/);
  assert.equal(h.responses.at(-1).b.type, 4);
});

test('one status card changes red to yellow to green, preserves the issue and records handler and resolver', async (t) => {
  const h = harness(t),
    engine = h.make();
  h.server.state.members.find((m) => m.id === STAFF).nick = 'أحمد الدعم';
  const submitted = h.interaction();
  await engine.handle(submitted);
  let ticket = h.read().tickets[submitted.id];
  const messageId = ticket.messageId;
  const card = () => h.messages.get(messageId);
  assert.equal(card().embeds[0].color, TICKET_COLORS.waiting);
  assert.match(card().embeds[0].fields[0].value, /🔴/);
  assert.match(card().embeds[0].fields[2].value, /لم يستلمها/);
  assert.equal(card().embeds[0].title, 'Help @everyone');
  const originalDescription = card().embeds[0].description;
  await Promise.all([
    engine.handle(h.interaction('ticket-claim', STAFF, ticket.channelId)),
    engine.handle(h.interaction('ticket-claim', OWNER, ticket.channelId)),
  ]);
  ticket = h.read().tickets[submitted.id];
  assert.equal(ticket.claimedBy, STAFF);
  assert.equal(card().embeds[0].color, TICKET_COLORS.claimed);
  assert.match(card().embeds[0].fields[2].value, /أحمد الدعم/);
  assert.ok(card().embeds[0].fields[2].value.includes(`<@${STAFF}>`));
  assert.equal(card().embeds[0].description, originalDescription);
  assert.equal(card().components[0].components[0].disabled, true);
  const restarted = h.make();
  await restarted.handle(h.interaction('ticket-resolve', OWNER, ticket.channelId));
  assert.equal(card().embeds[0].color, TICKET_COLORS.claimed);
  await restarted.handle(h.interaction('button:confirm-close', MEMBER, ticket.channelId));
  assert.equal(card().embeds[0].color, TICKET_COLORS.claimed);
  await restarted.handle(h.interaction('button:confirm-close', OWNER, ticket.channelId));
  ticket = h.read().tickets[submitted.id];
  assert.equal(ticket.messageId, messageId);
  assert.equal(ticket.resolvedBy, OWNER);
  assert.equal(ticket.claimedBy, STAFF);
  assert.equal(card().embeds[0].color, TICKET_COLORS.resolved);
  assert.match(card().embeds[0].fields[0].value, /🟢/);
  assert.ok(card().embeds[0].fields[3].value.includes(`<@${OWNER}>`));
  assert.equal(card().embeds[0].description, originalDescription);
  assert.ok(card().components[0].components.every((b) => b.disabled));
  assert.deepEqual(card().allowed_mentions, { parse: [] });
  assert.equal(h.messages.size, 1);
});

test('legacy open tickets upgrade their original message on the next staff action', async (t) => {
  const h = harness(t),
    submitted = h.interaction();
  await h.make().handle(submitted);
  const state = h.read(),
    ticket = state.tickets[submitted.id];
  const oldMessageId = ticket.messageId;
  delete h.messages.get(oldMessageId).embeds[0].footer;
  delete ticket.messageId;
  delete ticket.messageAttempt;
  fs.writeFileSync(h.stateFile, JSON.stringify(state));
  await h.make().handle(h.interaction('ticket-claim', STAFF, ticket.channelId));
  assert.equal(h.read().tickets[submitted.id].messageId, oldMessageId);
  assert.equal(h.messages.get(oldMessageId).embeds[0].color, TICKET_COLORS.claimed);
  assert.equal(h.messages.size, 1);
});

test('a failed card edit preserves the claim and can be repaired after restart without reassignment', async (t) => {
  const h = harness(t),
    submitted = h.interaction(),
    patch = h.api.patch;
  await h.make().handle(submitted);
  const ticket = h.read().tickets[submitted.id];
  h.api.patch = async (p, b) => {
    if (p.includes('/messages/')) throw new Error('HTTP 503');
    return patch(p, b);
  };
  await h.make().handle(h.interaction('ticket-claim', STAFF, ticket.channelId));
  assert.equal(h.read().tickets[submitted.id].claimedBy, STAFF);
  assert.equal(h.messages.get(ticket.messageId).embeds[0].color, TICKET_COLORS.waiting);
  assert.ok(h.logs.some((event) => event.code === 'TICKET_STATUS_UPDATE_FAILED'));
  assert.match(h.responses.at(-1).b.content, /تعذّر تحديث بطاقة/);
  h.api.patch = patch;
  await h.make().handle(h.interaction('ticket-claim', OWNER, ticket.channelId));
  assert.equal(h.read().tickets[submitted.id].claimedBy, STAFF);
  assert.equal(h.messages.get(ticket.messageId).embeds[0].color, TICKET_COLORS.claimed);
});

test('resolved card retries preserve the original solver and never repeat channel closure', async (t) => {
  const h = harness(t),
    submitted = h.interaction();
  await h.make().handle(submitted);
  const ticket = h.read().tickets[submitted.id],
    patch = h.api.patch;
  h.api.patch = async (p, b) => {
    if (p.includes('/messages/')) throw new Error('HTTP 503');
    return patch(p, b);
  };
  await h.make().handle(h.interaction('button:confirm-close', STAFF, ticket.channelId));
  assert.equal(h.read().tickets[submitted.id].resolvedBy, STAFF);
  const channelEdits = () =>
    h.server.calls.filter(
      (call) => call.path === `/channels/${ticket.channelId}` && call.method === 'PATCH',
    ).length;
  assert.equal(channelEdits(), 1);
  h.api.patch = patch;
  await h.make().handle(h.interaction('ticket-resolve', OWNER, ticket.channelId));
  assert.equal(channelEdits(), 1);
  assert.equal(h.read().tickets[submitted.id].resolvedBy, STAFF);
  assert.equal(h.messages.get(ticket.messageId).embeds[0].color, TICKET_COLORS.resolved);
});

test('lost message responses are recovered without posting a second status card', async (t) => {
  const h = harness(t),
    post = h.api.post,
    submitted = h.interaction();
  h.api.post = async (p, b) => {
    const result = await post(p, b);
    if (p.endsWith('/messages')) throw new Error('lost response');
    return result;
  };
  await h.make().handle(submitted);
  const ticket = h.read().tickets[submitted.id];
  assert.equal(ticket.messageAttempt, 'unknown');
  assert.equal(ticket.messageId, undefined);
  h.api.post = post;
  await h.make().handle(h.interaction('ticket-claim', STAFF, ticket.channelId));
  const updated = h.read().tickets[submitted.id];
  assert.equal(updated.messageAttempt, 'sent');
  assert.equal(h.messages.size, 1);
  assert.equal(h.messages.get(updated.messageId).embeds[0].color, TICKET_COLORS.claimed);
});

test('legacy closed tickets are not retroactively labelled resolved and foreign messages are never edited', async (t) => {
  const h = harness(t),
    submitted = h.interaction();
  await h.make().handle(submitted);
  const state = h.read(),
    ticket = state.tickets[submitted.id];
  ticket.status = 'closed';
  fs.writeFileSync(h.stateFile, JSON.stringify(state));
  await h.make().handle(h.interaction('ticket-resolve', STAFF, ticket.channelId));
  assert.equal(h.read().tickets[submitted.id].resolvedBy, undefined);
  assert.equal(h.messages.get(ticket.messageId).embeds[0].color, TICKET_COLORS.closed);
  const message = h.messages.get(ticket.messageId);
  message.author.id = MEMBER;
  const edits = h.server.calls.length;
  await h.make().handle(h.interaction('ticket-close', STAFF, ticket.channelId));
  assert.equal(h.server.calls.length, edits);
  assert.match(h.responses.at(-1).b.content, /تعذّر تحديث بطاقة/);
});

test('support commands deny ordinary members and unselected administrator roles; guild owner is allowed', async (t) => {
  const h = harness(t),
    engine = h.make();
  h.server.state.members.find((m) => m.id === MEMBER).roles = ['999999999999999991'];
  for (const action of ['ticket-panel', 'ticket-claim', 'ticket-close', 'button:confirm-close'])
    await engine.handle(h.interaction(action));
  assert.equal(h.server.calls.length, 0);
  await engine.handle(h.interaction('ticket-panel', OWNER));
  assert.equal(h.server.calls.length, 1);
  assert.equal(h.server.calls[0].path, `/channels/${PANEL}/messages`);
});

test('one open ticket survives concurrent requests and restarts; claim and confirmed close preserve history', async (t) => {
  const h = harness(t),
    engine = h.make();
  await Promise.all([engine.handle(h.interaction()), engine.handle(h.interaction())]);
  assert.equal(h.created().length, 1);
  const channelId = Object.values(h.read().tickets)[0].channelId;
  const restarted = h.make();
  await restarted.handle(h.interaction());
  assert.equal(h.created().length, 1);
  await restarted.handle(h.interaction('ticket-claim', STAFF, channelId));
  assert.equal(Object.values(h.read().tickets)[0].claimedBy, STAFF);
  await restarted.handle(h.interaction('ticket-claim', OWNER, channelId));
  assert.equal(Object.values(h.read().tickets)[0].claimedBy, STAFF);
  const before = h.server.calls.length;
  await restarted.handle(h.interaction('ticket-close', STAFF, channelId));
  assert.equal(h.server.calls.length, before);
  assert.equal(
    h.responses.at(-1).b.components[0].components[0].custom_id,
    'cortex:ticket:confirm-close',
  );
  await restarted.handle(h.interaction('button:confirm-close', MEMBER, channelId));
  assert.equal(h.server.calls.length, before);
  await restarted.handle(h.interaction('button:confirm-close', STAFF, channelId));
  assert.equal(Object.values(h.read().tickets)[0].status, 'closed');
  const channel = h.server.state.channels.find((c) => c.id === channelId);
  const member = channel.permission_overwrites.find((o) => o.id === MEMBER);
  assert.equal(BigInt(member.allow), P.ViewChannel | P.ReadMessageHistory);
  assert.ok(BigInt(member.deny) & P.SendMessages);
  assert.ok(!h.server.calls.some((c) => c.method === 'DELETE'));
  await restarted.handle(h.interaction());
  assert.equal(h.created().length, 2);
});

test('lost creation response reconciles the unique channel after restart without duplicate writes', async (t) => {
  const h = harness(t),
    original = h.api.post;
  h.api.post = async (p, b) => {
    const value = await original(p, b);
    if (p === `/guilds/${ID}/channels`) throw new Error('network disconnected');
    return value;
  };
  await h.make().handle(h.interaction());
  assert.equal(Object.values(h.read().tickets)[0].status, 'unknown');
  h.api.post = original;
  await h.make().handle(h.interaction());
  assert.equal(h.created().length, 1);
  assert.equal(Object.values(h.read().tickets)[0].status, 'open');
});

test('unresolved ambiguous creation blocks retries; conclusive rejection permits a new request', async (t) => {
  for (const [message, blocked] of [
    ['HTTP 503', true],
    ['HTTP 403', false],
  ]) {
    const h = harness(t),
      original = h.api.post;
    h.api.post = async (p, b) => {
      if (p === `/guilds/${ID}/channels`) throw new Error(message);
      return original(p, b);
    };
    await h.make().handle(h.interaction());
    h.api.post = original;
    await h.make().handle(h.interaction());
    assert.equal(h.created().length, blocked ? 0 : 1);
  }
});

test('missing permissions, removed roles and malformed submissions produce no channel writes', async (t) => {
  for (const scenario of ['permissions', 'role', 'subject']) {
    const h = harness(t),
      i = h.interaction();
    if (scenario === 'permissions')
      h.server.state.roles.find((r) => r.id === BOT_ROLE).permissions = String(P.ViewChannel);
    if (scenario === 'role')
      h.server.state.roles = h.server.state.roles.filter((r) => r.id !== LEGACY);
    if (scenario === 'subject') i.data.components[0].component.value = ' ';
    await h.make().handle(i);
    assert.equal(h.created().length, 0);
  }
});

test('interaction acknowledgements do not wait behind slow work; failed acknowledgements do not mutate Discord', async (t) => {
  const h = harness(t),
    original = h.api.get;
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  h.api.get = async (p) => {
    await blocked;
    return original(p);
  };
  const engine = h.make(),
    first = engine.handle(h.interaction());
  await setImmediate();
  const second = engine.handle(h.interaction());
  await setImmediate();
  assert.equal(h.responses.filter((r) => r.method === 'POST').length, 2);
  assert.equal(h.created().length, 0);
  release();
  await Promise.all([first, second]);
  assert.equal(h.created().length, 1);
  const denied = harness(t);
  denied.responseAPI.post = async () => {
    throw new Error('secret-token must not be logged');
  };
  await denied.make().handle(denied.interaction());
  assert.equal(denied.created().length, 0);
  assert.ok(!JSON.stringify(denied.logs).includes('secret-token'));
});

test('corrupt state is retained and fails closed; unrelated and foreign interactions are ignored', async (t) => {
  const h = harness(t),
    engine = h.make();
  await engine.handle({ ...h.interaction(), guild_id: undefined });
  await engine.handle(h.interaction('unrelated'));
  assert.equal(h.responses.length, 0);
  fs.writeFileSync(h.stateFile, '{broken');
  assert.throws(() => h.make());
  assert.equal(fs.readFileSync(h.stateFile, 'utf8'), '{broken');
});

test('callbacks bypass a blocked webhook response queue using the real REST transport', async (t) => {
  const h = harness(t),
    routes = [];
  const responses = new DiscordAPI('test-only', {
    fetchImpl: async (url) => {
      routes.push(url);
      return new Response(null, { status: 204 });
    },
    sleep: async () => {},
  });
  // An unrelated webhook response must not consume the initial response deadline.
  responses.queue = new Promise(() => {});
  const engine = createTicketEngine({
    api: h.api,
    responseAPI: responses,
    config: config(),
    stateFile: h.stateFile,
  });
  await engine.handle(h.interaction('ticket'));
  assert.equal(routes.length, 1);
  assert.match(routes[0], /\/interactions\/\d+\/test-interaction-secret\/callback$/);
  assert.equal(h.created().length, 0);
});

test('staff cannot claim or close a channel that was repurposed after ticket creation', async (t) => {
  const h = harness(t),
    engine = h.make();
  await engine.handle(h.interaction());
  const channel = h.server.state.channels.find((ch) => ch.topic?.startsWith('cortex-ticket:'));
  channel.topic = 'Repurposed by staff';
  const writes = h.server.calls.length;
  await engine.handle(h.interaction('ticket-claim', STAFF, channel.id));
  await engine.handle(h.interaction('button:confirm-close', STAFF, channel.id));
  assert.equal(h.server.calls.length, writes);
  assert.equal(Object.values(h.read().tickets)[0].status, 'open');
});

test('hosted runtime registers and receives tickets with mocked APIs and drains on shutdown', async (t) => {
  const h = harness(t);
  fs.mkdirSync(path.join(h.dir, 'config'));
  fs.writeFileSync(
    path.join(h.dir, 'config/social-feeds.json'),
    JSON.stringify({ version: 1, feeds: [] }),
  );
  fs.writeFileSync(path.join(h.dir, 'config/tickets.json'), JSON.stringify(config()));
  let gateway;
  class Gateway extends EventEmitter {
    constructor(_token, options) {
      super();
      gateway = this;
      assert.equal(options.receiveInteractions, true);
    }
    start() {
      this.running = true;
    }
    stop() {
      this.running = false;
    }
  }
  const bot = await startHostedBot({
    root: h.dir,
    env: { DISCORD_BOT_TOKEN: 'test-secret' },
    api: h.api,
    responseAPI: h.responseAPI,
    Gateway,
    fetchItems: async () => [],
    log() {},
  });
  gateway.emit('interaction', h.interaction());
  for (let attempts = 0; attempts < 30 && h.created().length === 0; attempts++)
    await setImmediate();
  await bot.stop();
  assert.equal(h.created().length, 1);
  assert.equal(gateway.running, false);
  fs.writeFileSync(path.join(h.dir, 'config/tickets.json'), '{broken');
  await assert.rejects(
    startHostedBot({
      root: h.dir,
      env: { DISCORD_BOT_TOKEN: 'test' },
      api: h.api,
      Gateway,
      log() {},
    }),
    (e) => hostedStartupDiagnostic(e).code === 'INVALID_TICKET_CONFIG',
  );
});
