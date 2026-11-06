import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  prepareMessage,
  previewMessage,
  sendMessage,
  messageProtection,
} from '../src/messages.mjs';
import { P } from '../src/permissions.mjs';
import { createHash } from 'node:crypto';
import { messagePreview } from '../src/messages.mjs';
import { validateMessageImage } from '../src/message-image.mjs';
import { sample, fakeServer, ID, BOT_ROLE, BOT, LEGACY, MEMBER } from './helpers/fake.mjs';
import { createTicketStore, ticketDefaults } from '../src/ticket-config.mjs';
import { ticketPanelCard, ticketPanelText, IS_COMPONENTS_V2 } from '../src/ticket-status.mjs';
import { createTicketEngine } from '../src/ticket-engine.mjs';

function temp(t) {
  const base = path.resolve(os.tmpdir()),
    dir = fs.mkdtempSync(path.join(base, 'cortex-message-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), base);
    assert.match(path.basename(dir), /^cortex-message-/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
const request = (s) => ({
  channelId: s.channels[1].id,
  content: 'أهلًا بالجميع 🎮 @everyone <@123456789012345678>',
});
const confirmation = (p) => ({
  confirmed: true,
  guildId: p.guildId,
  channelId: p.channelId,
  approvalHash: p.approvalHash,
});

function panelFixture(t, language = 'ar') {
  const root = temp(t),
    store = createTicketStore({ root }),
    server = fakeServer(sample());
  const saved = store.save({
    baseRevision: store.read().revision,
    confirmAutomatic: true,
    config: {
      version: 1,
      guilds: [
        {
          ...ticketDefaults(ID),
          enabled: true,
          panelChannelId: '777777777777777777',
          categoryId: '666666666666666666',
          staffRoleIds: [LEGACY],
          language,
        },
      ],
    },
  });
  return {
    root,
    store,
    server,
    saved,
    request: { kind: 'ticket-panel', settingsRevision: saved.revision },
    options: { ticketStore: store },
  };
}

test('reviewed ready-made support panels publish only to the saved channel and their button opens private language selection', async (t) => {
  for (const language of ['ar', 'en']) {
    const h = panelFixture(t, language),
      directory = path.join(h.root, 'review');
    const p = await previewMessage(h.server.api, ID, h.request, directory, h.options);
    assert.equal(h.server.calls.length, 0);
    assert.equal(p.kind, 'ticket-panel');
    assert.equal(p.channelId, h.saved.config.guilds[0].panelChannelId);
    assert.equal(messagePreview(p).panel.button, ticketPanelText.button);
    assert.equal(messagePreview(p).settingsRevision, h.saved.revision);
    assert.ok(messagePreview(p).summary.includes(ticketPanelText.button));
    const expected = ticketPanelCard();
    assert.deepEqual(p.body.components, expected.components);
    await sendMessage(h.server.api, ID, confirmation(p), directory, h.options);
    assert.equal(h.server.calls.length, 1);
    const sent = h.server.calls[0];
    assert.equal(sent.path, `/channels/${p.channelId}/messages`);
    assert.equal(sent.body.flags, IS_COMPONENTS_V2);
    assert.deepEqual(sent.body.allowed_mentions.parse, []);
    for (const legacy of ['content', 'embeds', 'poll', 'sticker_ids'])
      assert.ok(!Object.hasOwn(sent.body, legacy));
    const openButton = sent.body.components[0].components.find((c) => c.type === 1).components[0];
    const responses = [];
    const engine = createTicketEngine({
      api: h.server.api,
      responseAPI: { post: async (route, body) => responses.push({ route, body }) },
      config: h.saved.config,
      stateFile: path.join(h.root, 'state.json'),
    });
    await engine.handle({
      id: '123400000000000000',
      application_id: BOT,
      guild_id: ID,
      channel_id: p.channelId,
      token: 'mock-token',
      type: 3,
      member: { user: { id: MEMBER }, roles: [] },
      data: { custom_id: openButton.custom_id },
    });
    assert.equal(responses[0].body.data.flags, 64);
    assert.ok(
      responses[0].body.data.components[0].components.some((c) =>
        c.custom_id.startsWith('cortex:ticket:language:ar:'),
      ),
    );
    assert.ok(
      responses[0].body.data.components[0].components.some((c) =>
        c.custom_id.startsWith('cortex:ticket:language:en:'),
      ),
    );
    await assert.rejects(
      sendMessage(h.server.api, ID, confirmation(p), directory, h.options),
      /سبق بدء/,
    );
    assert.equal(h.server.calls.length, 1);
  }
});

test('support message previews reject custom destinations and stale settings; publishing rechecks saved configuration and permissions', async (t) => {
  const h = panelFixture(t),
    directory = path.join(h.root, 'review'),
    nonce = 'a'.repeat(24),
    s = sample();
  for (const extra of [
    { channelId: s.channels[0].id },
    { content: 'override' },
    { components: [] },
    { settingsRevision: '0'.repeat(64) },
  ])
    assert.throws(() =>
      prepareMessage(s, { ...h.request, ...extra }, nonce, { ticketSettings: h.saved }),
    );
  assert.throws(() => prepareMessage(s, h.request, nonce));
  const p = await previewMessage(h.server.api, ID, h.request, directory, h.options);
  h.store.save({
    baseRevision: h.saved.revision,
    confirmAutomatic: true,
    config: { version: 1, guilds: [{ ...h.saved.config.guilds[0], language: 'en' }] },
  });
  await assert.rejects(
    sendMessage(h.server.api, ID, confirmation(p), directory, h.options),
    /تغيّرت إعدادات/,
  );
  assert.equal(h.server.calls.length, 0);
  const fresh = await previewMessage(
    h.server.api,
    ID,
    { kind: 'ticket-panel', settingsRevision: h.store.read().revision },
    directory,
    h.options,
  );
  h.server.state.roles[0].permissions = '0';
  h.server.state.roles.find((r) => r.id === BOT_ROLE).permissions = '0';
  await assert.rejects(
    sendMessage(h.server.api, ID, confirmation(fresh), directory, h.options),
    /صلاحيت/,
  );
  assert.equal(h.server.calls.length, 0);
});

test('support message publication requires enabled settings and existing configured destinations and roles', (t) => {
  const h = panelFixture(t),
    nonce = 'a'.repeat(24);
  for (const mode of ['disabled', 'category', 'role', 'channel', 'guild']) {
    const s = sample(),
      saved = structuredClone(h.saved);
    if (mode === 'disabled') saved.config.guilds[0].enabled = false;
    if (mode === 'category') s.channels = s.channels.filter((c) => c.type !== 4);
    if (mode === 'role') s.roles = s.roles.filter((r) => r.id !== LEGACY);
    if (mode === 'channel') s.channels[1].type = 2;
    if (mode === 'guild') s.guild.id = '999999999999999990';
    assert.throws(
      () => prepareMessage(s, h.request, nonce, { ticketSettings: saved }),
      undefined,
      mode,
    );
  }
});

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZS8AAAAASUVORK5CYII=',
  'base64',
);
const image = () => ({
  type: 'image/png',
  data: png.toString('base64'),
  sha256: createHash('sha256').update(png).digest('hex'),
});
test('reviewed image upload binds exact bytes, requires Attach Files, and preview never exposes binary data', async (t) => {
  const s = sample(),
    server = fakeServer(s),
    directory = temp(t),
    req = { ...request(s), image: image() };
  const plan = await previewMessage(server.api, ID, req, directory);
  assert.equal(server.calls.length, 0);
  assert.deepEqual(plan.body.attachments, [{ id: 0, filename: 'cortex-image.png' }]);
  const preview = messagePreview(plan);
  assert.equal(preview.image.size, png.length);
  assert.equal(preview.image.sha256, req.image.sha256);
  assert.equal(preview.image.data, undefined);
  let files;
  const api = {
    ...server.api,
    call: (method, url, body, options) => {
      files = options.files;
      return server.api.call(method, url, body);
    },
  };
  await sendMessage(api, ID, confirmation(plan), directory);
  assert.deepEqual(files[0].bytes, png);
  assert.equal(files[0].type, 'image/png');
  assert.equal(server.calls.length, 1);
  await assert.rejects(sendMessage(api, ID, confirmation(plan), directory), /سبق بدء/);
  s.roles[0].permissions = '0';
  s.roles.find((r) => r.id === BOT_ROLE).permissions = String(P.ViewChannel | P.SendMessages);
  assert.throws(() => prepareMessage(s, req, 'a'.repeat(24)), /Attach Files/);
});
test('image validation rejects tampering, fake MIME, non-image files, unknown fields and oversize data', () => {
  assert.equal(validateMessageImage(image()).info.name, 'cortex-image.png');
  for (const bad of [
    { ...image(), sha256: '0'.repeat(64) },
    { ...image(), type: 'image/jpeg' },
    { ...image(), type: 'image/svg+xml' },
    { ...image(), data: '<svg/>' },
    { ...image(), data: 'A'.repeat(2800000) },
    { ...image(), path: 'C:/secret.png' },
  ])
    assert.throws(() => validateMessageImage(bad));
});

test('messages validate destination, size and fields and disable every automatic mention', () => {
  const s = sample(),
    nonce = 'a'.repeat(24),
    p = prepareMessage(s, request(s), nonce);
  assert.deepEqual(p.body.allowed_mentions, { parse: [], replied_user: false });
  assert.equal(p.body.enforce_nonce, true);
  assert.equal(p.body.nonce, nonce);
  for (const bad of [
    { ...request(s), channelId: s.channels[0].id },
    { ...request(s), channelId: '999999999999999999' },
    { ...request(s), content: ' ' },
    { ...request(s), content: 'x'.repeat(2001) },
    { ...request(s), allowed_mentions: { parse: ['everyone'] } },
  ])
    assert.throws(() => prepareMessage(s, bad, nonce));
});

test('message permissions use channel and member overwrites without requiring Manage Channels', () => {
  const s = sample();
  s.roles.find((r) => r.id === BOT_ROLE).permissions = String(
    P.ViewChannel | P.SendMessages | P.Connect,
  );
  assert.equal(messageProtection(s, s.channels[1]), null);
  s.channels[1].type = 2;
  assert.equal(messageProtection(s, s.channels[1]), null);
  s.channels[1].permission_overwrites = [
    { id: s.bot.id, type: 1, allow: '0', deny: String(P.SendMessages) },
  ];
  assert.match(messageProtection(s, s.channels[1]), /إرسال الرسائل/);
  s.channels[1].permission_overwrites = [];
  s.roles.find((r) => r.id === BOT_ROLE).permissions = String(P.ViewChannel | P.SendMessages);
  assert.match(messageProtection(s, s.channels[1]), /الاتصال/);
});

test('preview performs reads only and sending needs exact confirmation, writes one message and prevents replay', async (t) => {
  const s = sample(),
    server = fakeServer(s),
    directory = temp(t),
    p = await previewMessage(server.api, ID, request(s), directory);
  assert.equal(server.calls.length, 0);
  for (const bad of [
    { ...confirmation(p), confirmed: false },
    { ...confirmation(p), channelId: s.channels[0].id },
    { ...confirmation(p), approvalHash: 'wrong' },
  ])
    await assert.rejects(sendMessage(server.api, ID, bad, directory));
  assert.equal(server.calls.length, 0);
  const result = await sendMessage(server.api, ID, confirmation(p), directory);
  assert.equal(result.success, true);
  assert.deepEqual(
    server.calls.map((c) => [c.method, c.path]),
    [['POST', `/channels/${p.channelId}/messages`]],
  );
  assert.equal(server.calls[0].body.content, request(s).content);
  assert.deepEqual(server.calls[0].body.allowed_mentions.parse, []);
  await assert.rejects(sendMessage(server.api, ID, confirmation(p), directory), /سبق بدء/);
  assert.equal(server.calls.length, 1);
});

test('live permission loss and tampered content block sending, while unrelated chat activity does not', async (t) => {
  const s = sample(),
    server = fakeServer(s),
    directory = temp(t),
    p = await previewMessage(server.api, ID, request(s), directory);
  server.state.roles.find((r) => r.id === BOT_ROLE).permissions = '0';
  server.state.roles[0].permissions = '0';
  await assert.rejects(sendMessage(server.api, ID, confirmation(p), directory));
  assert.equal(server.calls.length, 0);
  server.state.roles.find((r) => r.id === BOT_ROLE).permissions = String(P.Administrator);
  const file = path.join(directory, 'message-plan.json'),
    original = fs.readFileSync(file, 'utf8'),
    changed = JSON.parse(original);
  changed.request.content = 'tampered';
  fs.writeFileSync(file, JSON.stringify(changed));
  await assert.rejects(sendMessage(server.api, ID, confirmation(p), directory));
  assert.equal(server.calls.length, 0);
  fs.writeFileSync(file, original);
  server.state.channels[1].last_message_id = '999999999999999999';
  const result = await sendMessage(server.api, ID, confirmation(p), directory);
  assert.equal(result.success, true);
});

test('ambiguous send failure is recorded and cannot be retried with the same approval', async (t) => {
  const s = sample(),
    server = fakeServer(s, {
      beforeCall() {
        throw new Error('Simulated transport loss');
      },
    }),
    directory = temp(t),
    p = await previewMessage(server.api, ID, request(s), directory);
  await assert.rejects(sendMessage(server.api, ID, confirmation(p), directory), /transport/);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(directory, 'message-result.json'))).status,
    'failed-or-unknown',
  );
  await assert.rejects(sendMessage(server.api, ID, confirmation(p), directory), /سبق بدء/);
  assert.equal(server.calls.length, 1);
});

test('embed cards validate Discord limits and require effective EmbedLinks permission', () => {
  const s = sample(),
    nonce = 'a'.repeat(24),
    embeds = [
      {
        title: '📜 قوانين',
        description: 'أهلًا بالجميع',
        color: 9274367,
        fields: [{ name: '🤝 الاحترام', value: 'Respect everyone', inline: false }],
        footer: { text: 'Gaming community' },
      },
    ],
    req = { channelId: s.channels[1].id, content: '', embeds };
  assert.deepEqual(prepareMessage(s, req, nonce).body.embeds, embeds);
  const bad = [
    [],
    Array(11).fill(embeds[0]),
    [{ title: 'x'.repeat(257) }],
    [{ description: 'x'.repeat(4097) }],
    [{ fields: [{ name: 'a', value: 'x'.repeat(1025) }] }],
    [{ title: 'x', color: '#123456' }],
    [{ title: 'x', url: 'https://example.com' }],
    [{ title: 'x', footer: { text: 'x', icon_url: 'file:///x' } }],
    [{ title: 'x', fields: [{ name: 'a', value: 'b', inline: 'yes' }] }],
    [{ description: 'a'.repeat(3100) }, { description: 'b'.repeat(3100) }],
    [{}],
  ];
  for (const value of bad) assert.throws(() => prepareMessage(s, { ...req, embeds: value }, nonce));
  s.roles[0].permissions = '0';
  s.roles.find((r) => r.id === BOT_ROLE).permissions = String(P.ViewChannel | P.SendMessages);
  assert.throws(() => prepareMessage(s, req, nonce), /Embed Links/);
  s.roles.find((r) => r.id === BOT_ROLE).permissions = String(
    P.ViewChannel | P.SendMessages | P.EmbedLinks,
  );
  assert.doesNotThrow(() => prepareMessage(s, req, nonce));
  s.channels[1].permission_overwrites = [
    { id: s.bot.id, type: 1, allow: '0', deny: String(P.EmbedLinks) },
  ];
  assert.throws(() => prepareMessage(s, req, nonce), /Embed Links/);
});

test('reviewed bilingual embeds send once, preserve exact design and reject changed cards', async (t) => {
  const s = sample(),
    server = fakeServer(s),
    directory = temp(t),
    req = {
      channelId: s.channels[1].id,
      content: '',
      embeds: [
        { title: 'قوانين', description: 'احترم الجميع', color: 9274367 },
        { title: 'Rules', description: 'Respect everyone', color: 5025616 },
      ],
    };
  const p = await previewMessage(server.api, ID, req, directory);
  assert.equal(server.calls.length, 0);
  const file = path.join(directory, 'message-plan.json'),
    original = fs.readFileSync(file, 'utf8'),
    changed = JSON.parse(original);
  changed.request.embeds[0].description = 'changed';
  fs.writeFileSync(file, JSON.stringify(changed));
  await assert.rejects(sendMessage(server.api, ID, confirmation(p), directory));
  assert.equal(server.calls.length, 0);
  fs.writeFileSync(file, original);
  await sendMessage(server.api, ID, confirmation(p), directory);
  assert.equal(server.calls.length, 1);
  assert.deepEqual(server.calls[0].body.embeds, req.embeds);
  assert.deepEqual(server.calls[0].body.allowed_mentions.parse, []);
  await assert.rejects(sendMessage(server.api, ID, confirmation(p), directory), /سبق بدء/);
});
