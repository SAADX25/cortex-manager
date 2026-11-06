import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createSocialStore } from './social-config.mjs';
import { createWelcomeStore } from './welcome-config.mjs';
import { createTicketStore } from './ticket-config.mjs';
import { hostedPackage, HOSTED_FILES } from './social-package.mjs';
import { atomicJSON } from './social-config.mjs';
import { createWelcomeAssetStore, assetId } from './welcome-assets.mjs';

export const DEFAULT_DISCLOUD_APP = '1793358824529';
const appIdPattern = /^\d{5,22}$/;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const conflict = (message) => Object.assign(new Error(message), { status: 409 });
function savedSettings(root, demo = false) {
  return {
    social: createSocialStore({ root, demo }).read(),
    welcome: createWelcomeStore({ root, demo }).read(),
    tickets: createTicketStore({ root, demo }).read(),
  };
}
function sourceRevision(root, welcome) {
  const digest = createHash('sha256');
  for (const module of ['./deployment-package.mjs', './social-package.mjs'])
    digest.update(module).update(fs.readFileSync(new URL(module, import.meta.url)));
  for (const file of HOSTED_FILES)
    digest.update(file).update(fs.readFileSync(path.join(root, file)));
  const library = createWelcomeAssetStore({ root });
  for (const guild of welcome.guilds)
    for (const type of ['join', 'leave']) {
      const id = guild[type].card?.background;
      if (assetId(id)) digest.update(id).update(library.bytes(id, guild.guildId));
    }
  return digest.digest('hex');
}
const packageRevision = (saved, source) =>
  hash(
    JSON.stringify([saved.social.revision, saved.welcome.revision, saved.tickets.revision, source]),
  );
function requiredEnvironment(config) {
  const environment = new Set(['DISCORD_BOT_TOKEN']);
  for (const feed of config.feeds.filter((f) => f.enabled)) {
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
  return [...environment];
}
function readBuildReport(root) {
  const file = path.join(root, 'out', 'discloud', 'verification.json');
  if (!fs.existsSync(file)) return null;
  try {
    if (fs.statSync(file).size > 128000) return null;
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (
      !/^[a-f0-9]{64}$/.test(report.sha256) ||
      !/^[a-f0-9]{64}$/.test(report.packageRevision) ||
      !appIdPattern.test(report.appId) ||
      typeof report.builtAt !== 'string' ||
      !Number.isFinite(Date.parse(report.builtAt)) ||
      !Number.isSafeInteger(report.bytes) ||
      report.bytes <= 0
    )
      return null;
    return report;
  } catch {
    return null;
  }
}
export function deploymentStatus({ root, demo = false }) {
  const saved = savedSettings(root, demo);
  let source = null;
  try {
    source = sourceRevision(root, saved.welcome.config);
  } catch {}
  const revision = packageRevision(saved, source);
  const guilds = saved.welcome.config.guilds;
  const features = [
    {
      key: 'tickets',
      page: 'tickets',
      saved: saved.tickets.config.guilds.length,
      enabled: saved.tickets.config.guilds.filter((g) => g.enabled).length,
    },
    ...['join', 'leave', 'kick'].map((type) => ({
      key: type,
      page: 'welcome',
      saved: guilds.filter((g) => g[type]).length,
      enabled: guilds.filter((g) => g[type]?.enabled).length,
    })),
    {
      key: 'social',
      page: 'social',
      saved: saved.social.config.feeds.length,
      enabled: saved.social.config.feeds.filter((f) => f.enabled).length,
    },
  ];
  const report = demo ? null : readBuildReport(root);
  const zip = path.join(root, 'out', 'discloud', 'cortex-manager.zip');
  const appId = report?.appId ?? DEFAULT_DISCLOUD_APP;
  return {
    revision,
    appId,
    dashboardURL: `https://discloud.com/dashboard/app/${appId}`,
    features,
    canBuild: !demo && source !== null && features.some((f) => f.saved > 0),
    demo,
    runtimeAvailable: source !== null,
    requiredEnvironment: requiredEnvironment(saved.social.config),
    serverMembersIntent: guilds.some((g) => g.kick?.enabled || g.join.enabled || g.leave.enabled),
    viewAuditLog: guilds.some((g) => g.kick?.enabled),
    lastBuild:
      report && fs.existsSync(zip)
        ? {
            builtAt: report.builtAt,
            bytes: report.bytes,
            sha256: report.sha256,
            stale: report.packageRevision !== revision,
            appId: report.appId,
            downloadURL: '/api/deployment/download?sha256=' + report.sha256,
          }
        : null,
  };
}

export function readDeploymentArchive({ root, sha256 }) {
  if (!/^[a-f0-9]{64}$/.test(sha256 ?? '')) throw new Error('Invalid package fingerprint.');
  const report = readBuildReport(root);
  if (!report || report.sha256 !== sha256) throw conflict('Package changed; prepare a fresh ZIP.');
  if (deploymentStatus({ root }).revision !== report.packageRevision)
    throw conflict('Saved settings or bot source changed; prepare a fresh ZIP.');
  const bytes = fs.readFileSync(path.join(root, 'out', 'discloud', 'cortex-manager.zip'));
  if (bytes.length !== report.bytes || hash(bytes) !== sha256)
    throw conflict('Package verification failed; prepare a fresh ZIP.');
  return bytes;
}

/** Export a saved configuration snapshot. Never reads a vault or opens a network connection. */
export function buildDiscloud({
  root = fileURLToPath(new URL('../', import.meta.url)),
  appId = DEFAULT_DISCLOUD_APP,
  baseRevision,
} = {}) {
  if (typeof appId !== 'string' || !appIdPattern.test(appId))
    throw new Error('Enter a valid Discloud application ID.');
  const socialStore = createSocialStore({ root }),
    welcomeStore = createWelcomeStore({ root }),
    ticketStore = createTicketStore({ root });
  const social = socialStore.read(),
    welcome = welcomeStore.read(),
    tickets = ticketStore.read();
  const saved = { social, welcome, tickets };
  if (!social.config.feeds.length && !welcome.config.guilds.length && !tickets.config.guilds.length)
    throw new Error(
      'No saved settings. Save social, welcome or ticket settings in the desktop app first.',
    );
  const source = sourceRevision(root, welcome.config);
  const revision = packageRevision(saved, source);
  if (baseRevision !== undefined && baseRevision !== revision)
    throw conflict('Saved settings changed; refresh the package overview.');
  for (const file of HOSTED_FILES.filter((name) => name.endsWith('.mjs'))) {
    const check = spawnSync(process.execPath, ['--check', path.join(root, file)], {
      encoding: 'utf8',
    });
    if (check.status !== 0) throw new Error('Hosted source syntax failed: ' + file);
  }
  const bytes = hostedPackage(root, social.config, welcome.config, tickets.config);
  if (
    socialStore.read().revision !== social.revision ||
    welcomeStore.read().revision !== welcome.revision ||
    ticketStore.read().revision !== tickets.revision ||
    sourceRevision(root, welcome.config) !== source
  )
    throw new Error('Settings changed while building. Run the command again.');
  const report = {
    appId,
    packageRevision: revision,
    sourceRevision: source,
    builtAt: new Date().toISOString(),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    socialRevision: social.revision,
    welcomeRevision: welcome.revision,
    ticketRevision: tickets.revision,
    tickets: tickets.config.guilds,
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
    requiredEnvironment: requiredEnvironment(social.config),
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
  const temporary = zip + '.' + randomBytes(8).toString('hex') + '.tmp';
  try {
    fs.writeFileSync(temporary, bytes);
    fs.renameSync(temporary, zip);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  atomicJSON(path.join(output, 'verification.json'), report);
  return { zip, report };
}
