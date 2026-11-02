import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSocialStore } from '../src/social-config.mjs';
import { createWelcomeStore } from '../src/welcome-config.mjs';
import { hostedPackage, HOSTED_FILES } from '../src/social-package.mjs';

/** Export a saved configuration snapshot. Never reads a vault or opens a network connection. */
export function buildDiscloud({ root = fileURLToPath(new URL('../', import.meta.url)) } = {}) {
  const socialStore = createSocialStore({ root }),
    welcomeStore = createWelcomeStore({ root });
  const social = socialStore.read(),
    welcome = welcomeStore.read();
  if (!social.config.feeds.length && !welcome.config.guilds.length)
    throw new Error('No saved settings. Save social or welcome settings in the desktop app first.');
  for (const file of HOSTED_FILES.filter((name) => name.endsWith('.mjs'))) {
    const check = spawnSync(process.execPath, ['--check', path.join(root, file)], {
      encoding: 'utf8',
    });
    if (check.status !== 0) throw new Error('Hosted source syntax failed: ' + file);
  }
  const bytes = hostedPackage(root, social.config, welcome.config);
  if (
    socialStore.read().revision !== social.revision ||
    welcomeStore.read().revision !== welcome.revision
  )
    throw new Error('Settings changed while building. Run the command again.');
  const enabled = social.config.feeds.filter((f) => f.enabled),
    environment = new Set(['DISCORD_BOT_TOKEN']);
  for (const feed of enabled) {
    if (feed.platform === 'kick') {
      environment.add('KICK_CLIENT_ID');
      environment.add('KICK_CLIENT_SECRET');
    }
    if (feed.platform === 'instagram' && !feed.rssURL) {
      environment.add('INSTAGRAM_USER_ID');
      environment.add('INSTAGRAM_ACCESS_TOKEN');
    }
    if (feed.platform === 'tiktok') environment.add('TIKTOK_ACCESS_TOKEN');
  }
  const report = {
    builtAt: new Date().toISOString(),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    socialRevision: social.revision,
    welcomeRevision: welcome.revision,
    feeds: social.config.feeds.map((f) => ({
      platform: f.platform,
      source: f.source,
      guildId: f.guildId,
      channelId: f.channelId,
      enabled: f.enabled,
    })),
    welcome: welcome.config.guilds.map((g) => ({
      guildId: g.guildId,
      joinEnabled: g.join.enabled,
      leaveEnabled: g.leave.enabled,
      joinChannel: g.join.channelId,
      leaveChannel: g.leave.channelId,
      kickEnabled: g.kick?.enabled ?? false,
      kickChannel: g.kick?.channelId ?? null,
    })),
    requiredEnvironment: [...environment],
    serverMembersIntent: welcome.config.guilds.some(
      (g) => g.kick?.enabled || g.join.enabled || g.leave.enabled,
    ),
    viewAuditLog: welcome.config.guilds.some((g) => g.kick?.enabled),
    pollIntervalSeconds: 120,
    firstCheck: 'silent-baseline',
    uploaded: false,
    liveDeliveryVerified: false,
  };
  const output = path.join(root, 'out', 'discloud');
  fs.mkdirSync(output, { recursive: true });
  const zip = path.join(output, 'cortex-manager.zip');
  fs.writeFileSync(zip, bytes);
  fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  return { zip, report };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { zip, report } = buildDiscloud();
    console.log('Ready: ' + zip);
    console.log('Size: ' + (report.bytes / 1024 / 1024).toFixed(2) + ' MB');
    console.log('Sources: ' + report.feeds.length + ' | Welcome servers: ' + report.welcome.length);
    console.log('Discloud environment: ' + report.requiredEnvironment.join(', '));
    console.log('No tokens included. Not uploaded. Preserve hosted data/ when updating.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
