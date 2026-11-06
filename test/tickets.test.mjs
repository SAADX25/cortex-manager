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
import { TICKET_COLORS, IS_COMPONENTS_V2, ticketCardIssue } from '../src/ticket-status.mjs';
import { P } from '../src/permissions.mjs';
import { sample, fakeServer, ID, BOT, BOT_ROLE, LEGACY, MEMBER, OWNER } from './helpers/fake.mjs';

const STAFF = '888888888888888889',
  PANEL = '777777777777777777',
  CATEGORY = '666666666666666666';
const cardContainer = (message) => message.components.find((c) => c.type === 17 && c.id === 1);
const cardText = (message, id) =>
  cardContainer(message).components.find((c) => c.type === 10 && c.id === id)?.content;
const cardButtons = (message) =>
  cardContainer(message).components.find((c) => c.type === 1)?.components ?? [];
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
  const registrations = [];
  let clock = Date.now();
  server.state.members.push({ id: STAFF, roles: [LEGACY] });
  const api = {
    async get(p) {
      trace.push(['get', p]);
      if (p === '/oauth2/applications/@me') return { id: BOT };
      const channelId = p.match(/^\/channels\/(\d+)$/)?.[1];
      if (channelId) {
        const channel = server.state.channels.find((c) => c.id === channelId);
        if (!channel) throw new Error(`Discord GET ${p}: HTTP 404, code 10003. Unknown Channel`);
        return { ...structuredClone(channel), guild_id: ID };
      }
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
      if (p.endsWith('/commands')) {
        registrations.push(structuredClone(b));
        return { id: '123456789012345678', ...b };
      }
      if (p.endsWith('/messages') && b.flags & IS_COMPONENTS_V2)
        for (const field of ['content', 'embeds', 'poll', 'sticker_ids'])
          assert.ok(!Object.hasOwn(b, field), 'V2 create must omit ' + field);
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
        const previous = messages.get(messageId);
        if (b.flags & IS_COMPONENTS_V2 && !(previous.flags & IS_COMPONENTS_V2)) {
          assert.equal(b.content, null);
          assert.deepEqual(b.embeds, []);
        } else if (b.flags & IS_COMPONENTS_V2) {
          assert.ok(!Object.hasOwn(b, 'content'));
          assert.ok(!Object.hasOwn(b, 'embeds'));
        }
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
  let bootstrap = Promise.resolve();
  const make = () => {
    const engine = createTicketEngine({
      api,
      responseAPI,
      config: config(extra),
      stateFile,
      onStatus: (event) => logs.push(event),
      now: () => clock,
    });
    return {
      ...engine,
      rawHandle: engine.handle,
      async handle(i) {
        if (i?.type !== 5 || i.data?.custom_id !== 'cortex:ticket:submit') return engine.handle(i);
        let work;
        const setup = bootstrap.then(async () => {
          const flow = await beginFlow(
            engine,
            i.member.user.id,
            i.channel_id,
            i.intakeLanguage ?? extra.language ?? 'ar',
            i.member,
          );
          if (!flow.modal) return;
          i.data.custom_id = flow.modal.custom_id;
          work = engine.handle(i);
        });
        bootstrap = setup.catch(() => {});
        await setup;
        return work;
      },
    };
  };
  let next = 123400000000000000n;
  function interaction(action = 'submit', userId = MEMBER, channelId = PANEL, language) {
    const type = action === 'submit' ? 5 : action.includes(':') ? 3 : 2;
    return {
      id: String(next++),
      application_id: BOT,
      guild_id: ID,
      channel_id: channelId,
      token: 'test-interaction-secret',
      type,
      ...(language ? { intakeLanguage: language } : {}),
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
                { type: 18, component: { type: 3, custom_id: 'gender', values: ['male'] } },
                { type: 18, component: { type: 4, custom_id: 'age', value: '24' } },
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
  const acknowledgement = (i) =>
    responses.findLast((r) => r.method === 'POST' && r.p.includes(`/interactions/${i.id}/`));
  async function beginFlow(engine, userId = MEMBER, channelId = PANEL, language = 'ar', member) {
    const raw = engine.rawHandle ?? engine.handle;
    const open = interaction('ticket', userId, channelId);
    if (member) open.member = structuredClone(member);
    await raw(open);
    const offered = acknowledgement(open)?.b;
    const choice = offered?.data?.components?.[0]?.components?.find((b) =>
      b.custom_id.startsWith(`cortex:ticket:language:${language}:`),
    );
    if (!choice) return { open, response: offered };
    const select = interaction('button:language', userId, channelId);
    if (member) select.member = structuredClone(member);
    select.data.custom_id = choice.custom_id;
    await raw(select);
    const result = acknowledgement(select)?.b;
    return { open, select, response: result, modal: result?.type === 9 ? result.data : undefined };
  }
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
    registrations,
    stateFile,
    make,
    interaction,
    read,
    created,
    beginFlow,
    acknowledgement,
    advance: (ms) => {
      clock += ms;
    },
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
  assert.deepEqual(
    h.registrations.map((c) => c.name),
    ['ticket', 'ticket-panel', 'ticket-claim', 'ticket-close', 'ticket-resolve'],
  );
  assert.ok(
    h.registrations.every(
      (c) => /[\u0600-\u06ff]/.test(c.description) && c.description.length <= 100,
    ),
  );
  assert.ok(h.registrations.every((c) => !Object.hasOwn(c, 'name_localizations')));
  const english = harness(t, { language: 'en' });
  await english.make().register();
  assert.ok(
    english.registrations.every(
      (c) => !/[\u0600-\u06ff]/.test(c.description) && c.description.length <= 100,
    ),
  );
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

test('slash command and public button offer a language before opening the complete form', async (t) => {
  const h = harness(t),
    engine = h.make();
  await engine.handle(h.interaction('ticket'));
  await engine.handle(h.interaction('button:open'));
  assert.equal(h.server.calls.length, 0);
  assert.equal(h.responses.length, 2);
  assert.ok(h.responses.every((r) => r.b.type === 4 && r.b.data.flags === 64));
  assert.deepEqual(
    h.responses[0].b.data.components[0].components.map((b) => b.label),
    ['العربية', 'English'],
  );
  const flow = await h.beginFlow(engine);
  assert.equal(flow.modal.components.length, 4);
  assert.deepEqual(
    flow.modal.components.map((c) => c.component.custom_id),
    ['gender', 'age', 'subject', 'description'],
  );
  assert.equal(flow.modal.components[3].component.max_length, 1500);
});

test('submitted ticket creates explicit private overwrites and pings only configured staff and requester', async (t) => {
  const h = harness(t),
    engine = h.make(),
    i = h.interaction();
  await engine.handle(i);
  const channel = h.created()[0].body;
  assert.equal(h.trace[0][0], 'ack');
  assert.equal(h.responses.find((r) => r.b.type === 5).b.data.flags, 64);
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

test('requests, copied panel buttons and panel publication are restricted to the exact configured channel', async (t) => {
  const h = harness(t),
    engine = h.make(),
    other = '999999999999999993';
  h.server.state.channels.push({
    id: other,
    type: 0,
    parent_id: CATEGORY,
    name: 'another-room',
    permission_overwrites: [],
  });
  for (const action of ['ticket', 'button:open', 'ticket-panel']) {
    const request = h.interaction(action, STAFF, other);
    await engine.rawHandle(request);
    const response = h.acknowledgement(request).b;
    assert.equal(response.type, 4);
    assert.equal(response.data.flags, 64);
    assert.ok(response.data.content.includes(`<#${PANEL}>`));
    assert.ok(!response.data.components?.length);
  }
  assert.equal(h.server.calls.length, 0);
  assert.ok(!h.trace.some(([method]) => method === 'get'));
});

test('language and form steps cannot be borrowed, relocated, forged or submitted without a valid flow', async (t) => {
  const h = harness(t),
    engine = h.make();
  const flow = await h.beginFlow(engine);
  for (const scenario of ['user', 'channel', 'language', 'nonce', 'legacy']) {
    const request = h.interaction(
      'submit',
      scenario === 'user' ? STAFF : MEMBER,
      scenario === 'channel' ? '999999999999999993' : PANEL,
    );
    request.data.custom_id = scenario === 'legacy' ? 'cortex:ticket:submit' : flow.modal.custom_id;
    if (scenario === 'language')
      request.data.custom_id = request.data.custom_id.replace(':ar:', ':en:');
    if (scenario === 'nonce') request.data.custom_id = 'cortex:ticket:submit:ar:' + '0'.repeat(24);
    await engine.rawHandle(request);
    assert.equal(h.acknowledgement(request).b.type, 4);
  }
  assert.equal(h.created().length, 0);
  const valid = h.interaction();
  valid.data.custom_id = flow.modal.custom_id;
  await engine.rawHandle(valid);
  assert.equal(h.created().length, 1);
  const duplicate = h.interaction();
  duplicate.data.custom_id = flow.modal.custom_id;
  await engine.rawHandle(duplicate);
  assert.equal(h.acknowledgement(duplicate).b.type, 4);
  assert.equal(h.created().length, 1);
});

test('selected language, gender and normalized age persist through staff actions and restart', async (t) => {
  const h = harness(t),
    engine = h.make();
  const flow = await h.beginFlow(engine, MEMBER, PANEL, 'en');
  assert.equal(flow.modal.title, 'New support request');
  assert.equal(flow.modal.components[0].component.options[1].label, 'Female');
  const submit = h.interaction();
  submit.data.custom_id = flow.modal.custom_id;
  submit.data.components.find((row) => row.component.custom_id === 'gender').component.values = [
    'female',
  ];
  submit.data.components.find((row) => row.component.custom_id === 'age').component.value = '٢٤';
  await engine.rawHandle(submit);
  const ticket = h.read().tickets[submit.id];
  assert.equal(ticket.language, 'en');
  assert.equal(ticket.age, 24);
  assert.equal(ticket.gender, 'female');
  assert.equal(h.created()[0].body.parent_id, CATEGORY);
  assert.match(h.responses.at(-1).b.content, /Your ticket was opened/);
  const card = () => h.messages.get(ticket.messageId);
  assert.match(cardText(card(), 8), /^🔴 \*\*Waiting for a staff member\*\*$/);
  assert.match(cardText(card(), 10), /Female/);
  assert.match(cardText(card(), 10), /24 years/);
  const restarted = h.make();
  await restarted.handle(h.interaction('ticket-claim', STAFF, ticket.channelId));
  assert.match(h.responses.at(-1).b.content, /Ticket claimed by/);
  await restarted.handle(h.interaction('button:confirm-close', STAFF, ticket.channelId));
  assert.equal(cardContainer(card()).accent_color, TICKET_COLORS.resolved);
  assert.match(cardText(card(), 10), /Female/);
  assert.match(cardText(card(), 10), /24 years/);
});

test('invalid required profile fields and duplicate form fields never create a ticket', async (t) => {
  const h = harness(t),
    engine = h.make();
  for (const [field, value] of [
    ['age', ''],
    ['age', 'abc'],
    ['age', '0'],
    ['age', '121'],
    ['age', '2.5'],
    ['gender', []],
    ['gender', ['other']],
    ['gender', ['male', 'female']],
    ['duplicate', null],
  ]) {
    const flow = await h.beginFlow(engine);
    const submit = h.interaction();
    submit.data.custom_id = flow.modal.custom_id;
    if (field === 'duplicate')
      submit.data.components[3] = structuredClone(submit.data.components[0]);
    else {
      const input = submit.data.components.find(
        (row) => row.component.custom_id === field,
      ).component;
      if (field === 'age') input.value = value;
      else input.values = value;
    }
    await engine.rawHandle(submit);
    assert.equal(h.created().length, 0, field + ':' + JSON.stringify(value));
  }
  assert.equal(Object.keys(h.read().tickets).length, 0);
  const flow = await h.beginFlow(engine);
  const valid = h.interaction();
  valid.data.custom_id = flow.modal.custom_id;
  valid.data.components.find((row) => row.component.custom_id === 'age').component.value = '۱۷';
  await engine.rawHandle(valid);
  assert.equal(h.read().tickets[valid.id].age, 17);
});

test('expired forms and forms from a previous runtime are rejected until language is chosen again', async (t) => {
  const h = harness(t),
    engine = h.make();
  const flow = await h.beginFlow(engine);
  h.advance(10 * 60 * 1000);
  const expired = h.interaction();
  expired.data.custom_id = flow.modal.custom_id;
  await engine.rawHandle(expired);
  assert.equal(h.acknowledgement(expired).b.type, 4);
  assert.equal(h.created().length, 0);
  const active = await h.beginFlow(engine);
  const stale = h.interaction();
  stale.data.custom_id = active.modal.custom_id;
  await h.make().rawHandle(stale);
  assert.equal(h.acknowledgement(stale).b.type, 4);
  assert.equal(h.created().length, 0);
});

test('staff actions on moved tickets are blocked and anomalous creation responses never receive support messages', async (t) => {
  const h = harness(t),
    engine = h.make(),
    submit = h.interaction();
  await engine.handle(submit);
  const ticket = h.read().tickets[submit.id];
  h.server.state.channels.find((channel) => channel.id === ticket.channelId).parent_id =
    '999999999999999994';
  const writes = h.server.calls.length;
  for (const action of ['ticket-claim', 'ticket-resolve', 'button:confirm-close'])
    await engine.handle(h.interaction(action, STAFF, ticket.channelId));
  assert.equal(h.server.calls.length, writes);
  assert.equal(h.read().tickets[submit.id].claimedBy, null);
  const bad = harness(t),
    post = bad.api.post;
  bad.api.post = async (route, body) => {
    const result = await post(route, body);
    return route === `/guilds/${ID}/channels`
      ? { ...result, parent_id: '999999999999999994' }
      : result;
  };
  await bad.make().handle(bad.interaction());
  assert.equal(bad.messages.size, 0);
  assert.equal(Object.values(bad.read().tickets)[0].status, 'unknown');
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
  assert.equal(cardContainer(card()).accent_color, TICKET_COLORS.waiting);
  assert.equal(cardText(card(), 8), '🔴 **بانتظار الاستلام**');
  assert.match(cardText(card(), 10), /لم يستلمها/);
  assert.equal(ticketCardIssue(card()).title, 'Help @everyone');
  const originalDescription = ticketCardIssue(card()).description;
  await Promise.all([
    engine.handle(h.interaction('ticket-claim', STAFF, ticket.channelId)),
    engine.handle(h.interaction('ticket-claim', OWNER, ticket.channelId)),
  ]);
  ticket = h.read().tickets[submitted.id];
  assert.equal(ticket.claimedBy, STAFF);
  assert.equal(cardContainer(card()).accent_color, TICKET_COLORS.claimed);
  assert.equal(ticket.claimedName, 'أحمد الدعم');
  assert.ok(cardText(card(), 10).includes(`<@${STAFF}>`));
  assert.equal(card().flags & IS_COMPONENTS_V2, IS_COMPONENTS_V2);
  assert.ok(!Object.hasOwn(card(), 'content'));
  assert.match(cardText(card(), 3), /^### /);
  assert.equal(ticketCardIssue(card()).description, originalDescription);
  assert.equal(cardButtons(card())[0].disabled, true);
  const restarted = h.make();
  await restarted.handle(h.interaction('ticket-resolve', OWNER, ticket.channelId));
  assert.equal(cardContainer(card()).accent_color, TICKET_COLORS.claimed);
  await restarted.handle(h.interaction('button:confirm-close', MEMBER, ticket.channelId));
  assert.equal(cardContainer(card()).accent_color, TICKET_COLORS.claimed);
  await restarted.handle(h.interaction('button:confirm-close', OWNER, ticket.channelId));
  ticket = h.read().tickets[submitted.id];
  assert.equal(ticket.messageId, messageId);
  assert.equal(ticket.resolvedBy, OWNER);
  assert.equal(ticket.claimedBy, STAFF);
  assert.equal(cardContainer(card()).accent_color, TICKET_COLORS.resolved);
  assert.equal(cardText(card(), 8), '🟢 **تم حل المشكلة**');
  assert.ok(cardText(card(), 10).includes(`<@${OWNER}>`));
  assert.ok(cardText(card(), 10).includes(`<@${STAFF}>`));
  assert.equal(ticketCardIssue(card()).description, originalDescription);
  assert.deepEqual(cardButtons(card()), []);
  assert.deepEqual(card().allowed_mentions, { parse: [] });
  assert.equal(h.messages.size, 1);
});

test('the same handler and resolver is shown once and completed cards have no repeated status control', async (t) => {
  const h = harness(t),
    submitted = h.interaction(),
    engine = h.make();
  await engine.handle(submitted);
  const ticket = h.read().tickets[submitted.id];
  await engine.handle(h.interaction('ticket-claim', STAFF, ticket.channelId));
  await engine.handle(h.interaction('button:confirm-close', STAFF, ticket.channelId));
  const card = h.messages.get(ticket.messageId);
  assert.equal(cardText(card, 10).split(`<@${STAFF}>`).length - 1, 1);
  assert.match(cardText(card, 10), /مسؤول الدعم/);
  assert.equal(ticketCardIssue(card).title, 'Help @everyone');
  assert.equal(ticketCardIssue(card).description, 'Details <@&999999999999999992>');
  assert.deepEqual(cardButtons(card), []);
  assert.deepEqual(card.allowed_mentions, { parse: [] });
});

test('legacy open tickets upgrade their original message on the next staff action', async (t) => {
  const h = harness(t),
    submitted = h.interaction();
  await h.make().handle(submitted);
  const state = h.read(),
    ticket = state.tickets[submitted.id];
  const oldMessageId = ticket.messageId;
  const legacy = h.messages.get(oldMessageId);
  delete legacy.flags;
  legacy.content = 'Old notification';
  legacy.embeds = [{ title: 'Help @everyone', description: 'Details <@&999999999999999992>' }];
  legacy.components = [
    {
      type: 1,
      components: [
        { type: 2, custom_id: 'cortex:ticket:claim' },
        { type: 2, custom_id: 'cortex:ticket:close' },
      ],
    },
  ];
  delete ticket.messageId;
  delete ticket.messageAttempt;
  delete ticket.language;
  delete ticket.gender;
  delete ticket.age;
  fs.writeFileSync(h.stateFile, JSON.stringify(state));
  await h.make().handle(h.interaction('ticket-claim', STAFF, ticket.channelId));
  assert.equal(h.read().tickets[submitted.id].messageId, oldMessageId);
  assert.equal(cardContainer(h.messages.get(oldMessageId)).accent_color, TICKET_COLORS.claimed);
  assert.equal(h.messages.get(oldMessageId).flags & IS_COMPONENTS_V2, IS_COMPONENTS_V2);
  assert.equal(
    ticketCardIssue(h.messages.get(oldMessageId)).description,
    'Details <@&999999999999999992>',
  );
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
  assert.equal(cardContainer(h.messages.get(ticket.messageId)).accent_color, TICKET_COLORS.waiting);
  assert.ok(h.logs.some((event) => event.code === 'TICKET_STATUS_UPDATE_FAILED'));
  assert.match(h.responses.at(-1).b.content, /تعذّر تحديث بطاقة/);
  h.api.patch = patch;
  await h.make().handle(h.interaction('ticket-claim', OWNER, ticket.channelId));
  assert.equal(h.read().tickets[submitted.id].claimedBy, STAFF);
  assert.equal(cardContainer(h.messages.get(ticket.messageId)).accent_color, TICKET_COLORS.claimed);
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
  assert.equal(
    cardContainer(h.messages.get(ticket.messageId)).accent_color,
    TICKET_COLORS.resolved,
  );
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
  assert.equal(
    cardContainer(h.messages.get(updated.messageId)).accent_color,
    TICKET_COLORS.claimed,
  );
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
  assert.equal(cardContainer(h.messages.get(ticket.messageId)).accent_color, TICKET_COLORS.closed);
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
  const panel = h.server.calls[0].body;
  assert.equal(cardText(panel, 2), '### Support');
  assert.equal(cardButtons(panel)[0].label, 'Open ticket');
  assert.deepEqual(panel.allowed_mentions, { parse: [] });
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

test('short references migrate old records, stay stable across updates and continue after historic numbers', async (t) => {
  const h = harness(t),
    submitted = h.interaction();
  await h.make().handle(submitted);
  const state = h.read(),
    ticket = state.tickets[submitted.id];
  assert.equal(ticket.number, 1);
  delete ticket.number;
  const historicalId = '999999999999999990';
  state.tickets[historicalId] = { ...ticket, number: 42, status: 'closed', channelId: null };
  state.tickets['999999999999999991'] = {
    ...ticket,
    guildId: '999999999999999992',
    number: 43,
    status: 'closed',
    channelId: null,
  };
  const message = h.messages.get(ticket.messageId);
  cardContainer(message).components.find((c) => c.id === 14).content =
    `-# Cortex • ${submitted.id} · <t:1234:f>`;
  cardContainer(message).components.find((c) => c.id === 3).content = '## Help @everyone';
  fs.writeFileSync(h.stateFile, JSON.stringify(state));
  await h.make().handle(h.interaction('ticket-claim', STAFF, ticket.channelId));
  const migrated = h.read().tickets[submitted.id];
  assert.equal(migrated.number, 43);
  assert.match(cardText(h.messages.get(ticket.messageId), 14), /Cortex · #0043 · فُتح/);
  assert.equal(ticketCardIssue(h.messages.get(ticket.messageId)).title, 'Help @everyone');
  await h.make().handle(h.interaction('button:confirm-close', STAFF, ticket.channelId));
  assert.equal(h.read().tickets[submitted.id].number, 43);
  const replacement = h.interaction();
  await h.make().handle(replacement);
  assert.equal(h.read().tickets[replacement.id].number, 44);
  await h.make().handle(h.interaction());
  assert.equal(h.created().length, 2);
});

test('invalid or duplicate per-guild ticket references fail without overwriting saved state', async (t) => {
  const h = harness(t),
    submitted = h.interaction();
  await h.make().handle(submitted);
  const initial = h.read();
  for (const number of [0, -1, 1.5, '42', Number.MAX_SAFE_INTEGER + 1, 'duplicate']) {
    const state = structuredClone(initial);
    if (number === 'duplicate')
      state.tickets['999999999999999990'] = { ...state.tickets[submitted.id] };
    else state.tickets[submitted.id].number = number;
    const bytes = JSON.stringify(state);
    fs.writeFileSync(h.stateFile, bytes);
    assert.throws(() => h.make(), /ticket number/i);
    assert.equal(fs.readFileSync(h.stateFile, 'utf8'), bytes);
  }
});

test('deleted ticket channels release only their reservation across restarts and concurrent requests', async (t) => {
  for (const language of ['ar', 'en']) {
    const h = harness(t, { language }),
      submitted = h.interaction();
    await h.make().handle(submitted);
    const oldTicket = h.read().tickets[submitted.id];
    await h.make().handle(h.interaction('ticket-claim', STAFF, oldTicket.channelId));
    h.server.state.channels = h.server.state.channels.filter((c) => c.id !== oldTicket.channelId);
    const engine = h.make(),
      first = h.interaction(),
      second = h.interaction();
    await Promise.all([engine.handle(first), engine.handle(second)]);
    assert.equal(h.created().length, 2, 'only one replacement channel is created');
    const state = h.read(),
      archived = state.tickets[submitted.id],
      replacement = state.tickets[first.id];
    assert.equal(archived.status, 'closed');
    assert.equal(archived.closedReason, 'channel-deleted');
    assert.ok(Number.isFinite(archived.deletedAt));
    assert.equal(archived.resolvedBy, undefined);
    assert.equal(archived.resolvedAt, undefined);
    assert.equal(archived.claimedBy, STAFF);
    assert.equal(archived.channelId, oldTicket.channelId);
    assert.equal(replacement.status, 'open');
    assert.notEqual(replacement.channelId, oldTicket.channelId);
    assert.equal(
      cardContainer(h.messages.get(replacement.messageId)).accent_color,
      TICKET_COLORS.waiting,
    );
    const response = h.responses.findLast(
      (r) => r.method === 'PATCH' && r.p.includes(`/${first.token}/`),
    );
    // The duplicate attempt may be the last webhook; inspect the replacement's own reply.
    assert.ok(response);
    assert.ok(
      h.responses.some((r) =>
        r.b.content?.includes(language === 'ar' ? 'لم تُسجَّل' : 'not marked resolved'),
      ),
    );
    await h.make().handle(h.interaction());
    assert.equal(h.created().length, 2, 'replacement remains reserved after restart');
    assert.ok(!h.server.calls.some((c) => c.method === 'DELETE'));
  }
});

test('channel access failures, ambiguous errors and moved channels never release a ticket', async (t) => {
  for (const failure of [
    'HTTP 403, code 50001. Missing Access',
    'HTTP 403, code 10003. Unknown Channel',
    'HTTP 404, code unknown. Request failed',
    'HTTP 404, code 10008. Unknown Message',
    'HTTP 503, code unknown. Request failed',
    'network disconnected',
    'moved',
    'marker-changed',
    'malformed-response',
  ]) {
    const h = harness(t),
      submitted = h.interaction();
    await h.make().handle(submitted);
    const oldTicket = h.read().tickets[submitted.id],
      get = h.api.get;
    const channel = h.server.state.channels.find((c) => c.id === oldTicket.channelId);
    if (failure === 'moved') channel.parent_id = '999999999999999994';
    else if (failure === 'marker-changed') channel.topic = 'unrelated';
    else {
      h.api.get = async (route) => {
        if (route === `/guilds/${ID}/channels`)
          return (await get(route)).filter((c) => c.id !== oldTicket.channelId);
        if (route === `/channels/${oldTicket.channelId}`) {
          if (failure === 'malformed-response')
            return { id: oldTicket.channelId, guild_id: '999999999999999994' };
          throw new Error(failure);
        }
        return get(route);
      };
    }
    await h.make().handle(h.interaction());
    assert.equal(h.created().length, 1, failure);
    assert.deepEqual(h.read().tickets[submitted.id], oldTicket, failure);
    assert.match(h.responses.at(-1).b.content, /طلب سابق قيد المراجعة/, failure);
  }
});

test('an existing channel omitted from inventory is checked directly and linked without a duplicate', async (t) => {
  const h = harness(t),
    submitted = h.interaction();
  await h.make().handle(submitted);
  const ticket = h.read().tickets[submitted.id],
    get = h.api.get;
  h.api.get = async (route) => {
    const result = await get(route);
    return route === `/guilds/${ID}/channels`
      ? result.filter((c) => c.id !== ticket.channelId)
      : result;
  };
  await h.make().handle(h.interaction());
  assert.equal(h.created().length, 1);
  assert.deepEqual(h.read().tickets[submitted.id], ticket);
  assert.ok(h.responses.at(-1).b.content.includes(`<#${ticket.channelId}>`));
});

test('a deleted known ticket does not clear another unresolved creation reservation', async (t) => {
  const h = harness(t),
    submitted = h.interaction();
  await h.make().handle(submitted);
  const state = h.read(),
    ticket = state.tickets[submitted.id],
    uncertainId = '999999999999999993';
  state.tickets[uncertainId] = {
    ...ticket,
    number: ticket.number + 1,
    channelId: null,
    status: 'unknown',
  };
  fs.writeFileSync(h.stateFile, JSON.stringify(state));
  h.server.state.channels = h.server.state.channels.filter((c) => c.id !== ticket.channelId);
  await h.make().handle(h.interaction());
  assert.equal(h.created().length, 1);
  assert.equal(h.read().tickets[submitted.id].closedReason, 'channel-deleted');
  assert.equal(h.read().tickets[uncertainId].status, 'unknown');
  assert.match(h.responses.at(-1).b.content, /طلب سابق قيد المراجعة/);
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
  const second = engine.handle(h.interaction('submit', STAFF));
  await setImmediate();
  assert.equal(h.responses.filter((r) => r.method === 'POST' && r.b.type === 5).length, 2);
  assert.equal(h.created().length, 0);
  release();
  await Promise.all([first, second]);
  assert.equal(h.created().length, 2);
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
  await engine.rawHandle({ ...h.interaction(), guild_id: undefined });
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
  const open = h.interaction('ticket');
  gateway.emit('interaction', open);
  await setImmediate();
  const choice = h.acknowledgement(open).b.data.components[0].components[0];
  const language = h.interaction('button:language');
  language.data.custom_id = choice.custom_id;
  gateway.emit('interaction', language);
  await setImmediate();
  const submit = h.interaction();
  submit.data.custom_id = h.acknowledgement(language).b.data.custom_id;
  gateway.emit('interaction', submit);
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
