import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDiscloud } from '../scripts/build-discloud.mjs';
import { HOSTED_FILES } from '../src/social-package.mjs';
import { createSocialStore } from '../src/social-config.mjs';
import { createWelcomeStore, welcomeDefaults } from '../src/welcome-config.mjs';
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-export-'));
  t.after(() => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('cortex-export-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}
test('quick Discloud build includes saved settings and runtime only, reports requirements and never reads credentials', (t) => {
  const root = temporary(t),
    project = fileURLToPath(new URL('../', import.meta.url));
  for (const file of HOSTED_FILES) {
    const output = path.join(root, file);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(path.join(project, file), output);
  }
  const social = createSocialStore({ root }),
    welcome = createWelcomeStore({ root }),
    guildId = '1565398372867641545',
    channelId = '1566175275824447630';
  const config = {
    version: 1,
    feeds: [
      {
        id: 'kick-laith',
        platform: 'kick',
        source: 'laith1x',
        guildId,
        channelId,
        enabled: true,
        language: 'en',
      },
    ],
  };
  social.save({ config, baseRevision: social.read().revision, confirmAutomatic: true });
  const g = welcomeDefaults(guildId);
  g.join.enabled = true;
  g.join.channelId = channelId;
  welcome.save({
    config: { version: 1, guilds: [g] },
    baseRevision: welcome.read().revision,
    confirmAutomatic: true,
  });
  fs.writeFileSync(path.join(root, '.env'), 'NOT_A_REAL_TOKEN=must-not-be-read-or-exported');
  fs.writeFileSync(
    path.join(root, 'out/desktop-modern/credentials.json'),
    'this is not a vault or JSON',
  );
  const { zip, report } = buildDiscloud({ root }),
    bytes = fs.readFileSync(zip),
    contents = new Map();
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const size = bytes.readUInt32LE(offset + 18),
      length = bytes.readUInt16LE(offset + 26),
      extra = bytes.readUInt16LE(offset + 28),
      start = offset + 30 + length + extra;
    contents.set(
      bytes.subarray(offset + 30, offset + 30 + length).toString(),
      bytes.subarray(start, start + size),
    );
    offset = start + size;
  }
  assert.deepEqual(JSON.parse(contents.get('config/social-feeds.json')), config);
  assert.equal(JSON.parse(contents.get('config/welcome.json')).guilds[0].guildId, guildId);
  assert.ok(
    [...contents.keys()].every(
      (name) => !/(^|\/)(\.env|credentials|node_modules|data|out|desktop)(\/|\.|$)/.test(name),
    ),
  );
  assert.ok(!bytes.includes(Buffer.from('must-not-be-read-or-exported')));
  assert.deepEqual(report.requiredEnvironment, [
    'DISCORD_BOT_TOKEN',
    'KICK_CLIENT_ID',
    'KICK_CLIENT_SECRET',
  ]);
  assert.equal(report.serverMembersIntent, true);
  assert.equal(report.uploaded, false);
  assert.equal(report.liveDeliveryVerified, false);
  assert.equal(report.bytes, bytes.length);
  assert.match(report.sha256, /^[a-f0-9]{64}$/);
});
test('quick build refuses empty settings before replacing an existing archive', (t) => {
  const root = temporary(t),
    directory = path.join(root, 'out/discloud');
  fs.mkdirSync(directory, { recursive: true });
  const zip = path.join(directory, 'cortex-manager.zip');
  fs.writeFileSync(zip, 'previous');
  assert.throws(() => buildDiscloud({ root }), /No saved settings/);
  assert.equal(fs.readFileSync(zip, 'utf8'), 'previous');
});
