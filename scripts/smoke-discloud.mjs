import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyHostedFiles } from '../src/social-package.mjs';

// Launch the actual packaged entry point, with no production tokens or outbound
// network access. Only Discord's Gateway discovery/handshake is simulated.
const root = fileURLToPath(new URL('../', import.meta.url));
const archive = fs.readFileSync(path.join(root, 'out/discloud/cortex-manager.zip'));
const files = {};
for (let offset = 0; archive.readUInt32LE(offset) === 0x04034b50; ) {
  assert.equal(archive.readUInt16LE(offset + 8), 0, "Expected the builder's stored ZIP format.");
  const size = archive.readUInt32LE(offset + 18),
    length = archive.readUInt16LE(offset + 26);
  const start = offset + 30 + length + archive.readUInt16LE(offset + 28);
  const name = archive.subarray(offset + 30, offset + 30 + length).toString();
  assert.ok(!name.startsWith('/') && !name.includes('..') && !name.includes('\\'));
  files[name] = archive.subarray(start, start + size);
  offset = start + size;
}
assert.equal(verifyHostedFiles(files).archiveLayout, 'root');
assert.ok(
  !Object.hasOwn(files, 'src/credentials.mjs'),
  'The Windows credential vault must not be hosted.',
);
const subscription = JSON.parse(files['config/social-feeds.json']).feeds.find(
  (feed) => feed.id === '289ecf3c-1907-4566-95e8-ca45c419cb4c',
);
if (subscription)
  assert.equal(subscription.enabled, false, 'The broken Instagram feed must be disabled.');
const base = fs.mkdtempSync(path.join(root, 'out/discloud/smoke-'));
const preload = `
globalThis.fetch = async (url) => {
  if (String(url) === 'https://discord.com/api/v10/gateway/bot')
    return new Response(JSON.stringify({ url: 'wss://gateway.discord.gg', shards: 1 }));
  throw new Error('Smoke test: outbound network blocked (' + new URL(url).hostname + ')');
};
globalThis.WebSocket = class extends EventTarget {
  readyState = 1;
  constructor() {
    super();
    setImmediate(() => this.packet({ op: 10, d: { heartbeat_interval: 10000 } }));
  }
  packet(value) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
  send(value) {
    if (JSON.parse(value).op === 2) setImmediate(() => this.packet({ op: 0, t: 'READY', s: 1,
      d: { session_id: 'smoke', resume_gateway_url: 'wss://gateway.discord.gg', user: { username: 'mock' } } }));
  }
  close() { this.readyState = 3; }
};
`;
const states = {
  'social-deliveries': { version: 1, sources: {} },
  tickets: { version: 1, tickets: {}, seen: {} },
  'welcome-deliveries': { version: 1, seen: [] },
  'kick-deliveries': { version: 1, seen: [] },
};
const cases = [
  'missing-data',
  'empty-legacy-data',
  'corrupt-data',
  'invalid-settings',
  'missing-token',
  'missing-module',
];
for (const scenario of cases) {
  const directory = path.join(base, scenario);
  for (const [name, bytes] of Object.entries(files)) {
    const target = path.join(directory, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  if (scenario === 'empty-legacy-data' || scenario === 'corrupt-data') {
    fs.mkdirSync(path.join(directory, 'data'));
    for (const name of Object.keys(states)) {
      const filename =
        scenario === 'empty-legacy-data'
          ? ({ 'social-deliveries': 'social', 'welcome-deliveries': 'welcome' }[name] ?? name)
          : name;
      fs.writeFileSync(
        path.join(directory, 'data', filename + '.json'),
        scenario === 'corrupt-data' ? '{broken' : '',
      );
    }
  }
  if (scenario === 'invalid-settings')
    for (const name of ['social-feeds', 'tickets', 'welcome'])
      fs.writeFileSync(path.join(directory, 'config', name + '.json'), '');
  if (scenario === 'missing-module') fs.unlinkSync(path.join(directory, 'src/ticket-engine.mjs'));
  const hook = path.join(directory, 'offline-runtime.mjs');
  fs.writeFileSync(hook, preload);
  const env = { ...process.env, NODE_OPTIONS: '--import=' + pathToFileURL(hook).href };
  for (const key of Object.keys(env))
    if (/^(DISCORD_|KICK_|INSTAGRAM_|TIKTOK_)/i.test(key)) delete env[key];
  if (scenario !== 'missing-token') env.DISCORD_BOT_TOKEN = 'smoke-test-not-a-real-token';
  const child = spawn(process.execPath, ['src/hosted-bot.mjs'], {
    cwd: directory,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '',
    errorOutput = '',
    spawnError;
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    errorOutput += chunk;
  });
  child.on('error', (error) => {
    spawnError = error;
  });
  const expected =
    scenario === 'missing-token'
      ? 'MISSING_BOT_TOKEN'
      : scenario === 'missing-module'
        ? 'ERR_MODULE_NOT_FOUND'
        : '"status":"online"';
  try {
    const deadline = Date.now() + 8000;
    while (
      !(output + errorOutput).includes(expected) &&
      Date.now() < deadline &&
      child.exitCode === null &&
      !spawnError
    )
      await new Promise((resolve) => setTimeout(resolve, 25));
    assert.ifError(spawnError);
    assert.ok((output + errorOutput).includes(expected), scenario + '\n' + output + errorOutput);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(child.exitCode, null, scenario + ' exited during startup:\n' + errorOutput);
    if (!['missing-token', 'missing-module'].includes(scenario)) {
      assert.match(output, /"status":"ready"/);
      for (const [name, value] of Object.entries(states))
        assert.deepEqual(
          JSON.parse(fs.readFileSync(path.join(directory, 'data', name + '.json'))),
          value,
        );
      if (
        scenario !== 'invalid-settings' &&
        JSON.parse(files['config/tickets.json']).guilds.some((g) => g.enabled)
      )
        assert.match(output, /TICKET_REGISTRATION_FAILED/);
    }
    assert.ok(!errorOutput.includes('(rss.app)'), 'Disabled RSS was requested.');
    console.log('PASS ' + scenario + ': node src/hosted-bot.mjs stayed running.');
  } finally {
    fs.writeFileSync(path.join(directory, 'startup.log'), output + errorOutput);
    if (child.exitCode === null && !spawnError) {
      const closed = new Promise((resolve) => child.once('close', resolve));
      child.kill();
      await closed;
    }
  }
}
console.log(
  'Verified root layout, MAIN, import closure, disabled RSS and six extracted-package startup scenarios.',
);
console.log('Smoke logs: ' + base);
