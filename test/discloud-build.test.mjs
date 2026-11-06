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
import { createTicketStore, ticketDefaults } from '../src/ticket-config.mjs';
import { deploymentStatus, readDeploymentArchive } from '../src/deployment-package.mjs';
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

test('ticket-only export includes settings and runtime, excluding local request state', (t) => {
  const root = temporary(t),
    project = fileURLToPath(new URL('../', import.meta.url));
  for (const file of HOSTED_FILES) {
    const output = path.join(root, file);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(path.join(project, file), output);
  }
  const store = createTicketStore({ root });
  const guild = {
    ...ticketDefaults('111111111111111111'),
    enabled: true,
    panelChannelId: '777777777777777777',
    categoryId: '666666666666666666',
    staffRoleIds: ['555555555555555555'],
  };
  store.save({
    baseRevision: store.read().revision,
    config: { version: 1, guilds: [guild] },
    confirmAutomatic: true,
  });
  fs.writeFileSync(path.join(root, 'out/desktop-modern/ticket-state.json'), 'private-ticket-state');
  const { zip, report } = buildDiscloud({ root });
  const bytes = fs.readFileSync(zip);
  assert.deepEqual(report.tickets, [guild]);
  assert.deepEqual(report.requiredEnvironment, ['DISCORD_BOT_TOKEN']);
  assert.equal(report.serverMembersIntent, false);
  assert.ok(bytes.includes(Buffer.from('config/tickets.json')));
  assert.ok(bytes.includes(Buffer.from('src/ticket-engine.mjs')));
  assert.ok(!bytes.includes(Buffer.from('private-ticket-state')));
  const status = deploymentStatus({ root });
  assert.equal(status.appId, '1793358824529');
  assert.equal(status.lastBuild.stale, false);
  assert.equal(status.features.find((f) => f.key === 'tickets').enabled, 1);
  assert.deepEqual(readDeploymentArchive({ root, sha256: report.sha256 }), bytes);
  assert.throws(() => readDeploymentArchive({ root, sha256: '../private' }), /fingerprint/);
  assert.throws(() => buildDiscloud({ root, appId: 'https://evil.example' }), /application ID/);
  const originalArchive = fs.readFileSync(zip);
  store.save({
    baseRevision: store.read().revision,
    config: { version: 1, guilds: [{ ...guild, enabled: false }] },
    confirmAutomatic: true,
  });
  assert.equal(deploymentStatus({ root }).lastBuild.stale, true);
  assert.throws(
    () => readDeploymentArchive({ root, sha256: report.sha256 }),
    (e) => e.status === 409,
  );
  assert.throws(
    () => buildDiscloud({ root, baseRevision: status.revision }),
    (e) => e.status === 409,
  );
  assert.deepEqual(fs.readFileSync(zip), originalArchive);
  const rebuilt = buildDiscloud({ root, appId: '1793358824529' });
  fs.appendFileSync(path.join(root, 'src/ticket-engine.mjs'), '\n// changed runtime\n');
  assert.equal(deploymentStatus({ root }).lastBuild.stale, true);
  assert.throws(
    () => readDeploymentArchive({ root, sha256: rebuilt.report.sha256 }),
    (e) => e.status === 409,
  );
  const newest = buildDiscloud({ root });
  fs.appendFileSync(zip, 'corrupt');
  assert.throws(
    () => readDeploymentArchive({ root, sha256: newest.report.sha256 }),
    (e) => e.status === 409,
  );
});
