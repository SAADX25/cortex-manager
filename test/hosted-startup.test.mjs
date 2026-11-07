import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { startHostedBot } from '../src/hosted-bot.mjs';
import { ticketDefaults } from '../src/ticket-config.mjs';
import { verifyHostedFiles } from '../src/social-package.mjs';

function temporary(t) {
  const base = path.resolve(os.tmpdir());
  const root = fs.mkdtempSync(path.join(base, 'cortex-startup-'));
  t.after(() => {
    assert.equal(path.dirname(root), base);
    assert.ok(path.basename(root).startsWith('cortex-startup-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}
class Gateway extends EventEmitter {
  start() {
    this.running = true;
  }
  stop() {
    this.running = false;
  }
}
const defaults = {
  'social-deliveries': { version: 1, sources: {} },
  tickets: { version: 1, tickets: {}, seen: {} },
  'welcome-deliveries': { version: 1, seen: [] },
  'kick-deliveries': { version: 1, seen: [] },
};
function start(root, log = () => {}, extra = {}) {
  return startHostedBot({
    root,
    env: { DISCORD_BOT_TOKEN: 'mock-token' },
    api: {},
    Gateway,
    fetchItems: async () => [],
    log,
    ...extra,
  });
}

test('hosted startup creates missing optional configuration and durable state', async (t) => {
  const root = temporary(t),
    bot = await start(root);
  t.after(() => bot.stop());
  for (const [name, value] of Object.entries(defaults))
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'data', name + '.json'))), value);
  for (const name of ['social-feeds', 'tickets', 'welcome'])
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'config', name + '.json'))).version, 1);
  assert.equal(bot.failed, false);
  await bot.stop();
});

test('empty, malformed and invalid-schema state is backed up and recovered without crashing', async (t) => {
  for (const contents of [
    '',
    '{broken',
    '{"version":1,"seen":false,"tickets":[],"sources":null}',
  ]) {
    const root = temporary(t),
      logs = [];
    fs.mkdirSync(path.join(root, 'data'));
    for (const name of Object.keys(defaults))
      fs.writeFileSync(path.join(root, 'data', name + '.json'), contents);
    const bot = await start(root, (event) => logs.push(event));
    t.after(() => bot.stop());
    for (const [name, value] of Object.entries(defaults)) {
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'data', name + '.json'))), value);
      const backup = fs
        .readdirSync(path.join(root, 'data'))
        .find((file) => file.startsWith(name + '.json.corrupt-'));
      assert.ok(backup);
      assert.equal(fs.readFileSync(path.join(root, 'data', backup), 'utf8'), contents);
    }
    assert.equal(logs.filter((event) => event.code === 'STATE_RECOVERED').length, 4);
    await bot.stop();
  }
});

test('legacy social.json and welcome.json are validated and migrated without changing the originals', async (t) => {
  const root = temporary(t);
  fs.mkdirSync(path.join(root, 'data'));
  for (const [legacy, name] of [
    ['social', 'social-deliveries'],
    ['welcome', 'welcome-deliveries'],
  ])
    fs.writeFileSync(path.join(root, 'data', legacy + '.json'), JSON.stringify(defaults[name]));
  const bot = await start(root);
  t.after(() => bot.stop());
  for (const [legacy, name] of [
    ['social', 'social-deliveries'],
    ['welcome', 'welcome-deliveries'],
  ])
    assert.deepEqual(
      fs.readFileSync(path.join(root, 'data', legacy + '.json')),
      fs.readFileSync(path.join(root, 'data', name + '.json')),
    );
  await bot.stop();
});

test('invalid optional settings disable affected features and preserve the original files', async (t) => {
  const root = temporary(t),
    logs = [];
  fs.mkdirSync(path.join(root, 'config'));
  for (const name of ['social-feeds', 'tickets', 'welcome'])
    fs.writeFileSync(path.join(root, 'config', name + '.json'), '{bad');
  const bot = await start(root, (event) => logs.push(event));
  t.after(() => bot.stop());
  assert.equal(logs.find((event) => event.status === 'ready').configuredSources, 0);
  assert.equal(logs.find((event) => event.status === 'ready').ticketsEnabled, false);
  assert.equal(fs.readFileSync(path.join(root, 'config/tickets.json'), 'utf8'), '{bad');
  await bot.stop();
});

test('ticket registration failure warns and does not block startup or the gateway', async (t) => {
  const root = temporary(t),
    logs = [],
    errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args));
  const guild = ticketDefaults('1415140960265961564');
  Object.assign(guild, {
    enabled: true,
    panelChannelId: '1565662524622377060',
    categoryId: '1565662524622377061',
    staffRoleIds: ['1565662524622377062'],
  });
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(
    path.join(root, 'config/tickets.json'),
    JSON.stringify({ version: 1, guilds: [guild] }),
  );
  const failure = new Error('mock network failure');
  const bot = await start(root, (event) => logs.push(event), {
    api: {
      get: async () => {
        throw failure;
      },
    },
  });
  t.after(() => bot.stop());
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(logs.some((event) => event.status === 'ready'));
  assert.ok(
    logs.some((event) => event.code === 'TICKET_REGISTRATION_FAILED' && event.status === 'warning'),
  );
  assert.equal(errors[0][1], failure);
  assert.equal(bot.failed, false);
  await bot.stop();
});

test('archive verification rejects a missing deferred dependency or a nested MAIN', () => {
  const files = {
    'discloud.config': 'MAIN=src/hosted-bot.mjs\n',
    'package.json': '{}',
    'src/hosted-bot.mjs': "await import('./engine.mjs');",
  };
  assert.throws(() => verifyHostedFiles(files), /Missing hosted dependency/);
  files['src/engine.mjs'] = 'export const ready = true;';
  assert.equal(verifyHostedFiles(files).importsVerified, true);
  files['discloud.config'] = 'MAIN=build/src/hosted-bot.mjs\n';
  assert.throws(() => verifyHostedFiles(files), /MAIN/);
});
