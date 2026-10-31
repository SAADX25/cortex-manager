import { readWelcomeFile } from './welcome-config.mjs';
import { createWelcomeEngine } from './welcome-engine.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DiscordAPI } from './api.mjs';
import { GatewaySession } from './gateway.mjs';
import { validateSocial } from './social-config.mjs';
import { createSocialProviders } from './social-providers.mjs';
import { createSocialEngine } from './social-engine.mjs';

const STARTUP_ERRORS = {
  INVALID_WELCOME_CONFIG: 'Welcome settings are invalid; export a fresh package.',
  INVALID_WELCOME_STATE:
    'Welcome delivery state is invalid; restore its backup without resetting it.',
  MISSING_BOT_TOKEN:
    'DISCORD_BOT_TOKEN is not available to the running process. Check the application variable name, save/apply it and recreate the runtime if necessary.',
  INVALID_TOKEN_FORMAT:
    'DISCORD_BOT_TOKEN must contain only the bot token, without a Bot prefix or KEY=value text.',
  MISSING_FEED_CONFIG:
    'config/social-feeds.json is missing. Upload the complete Cortex Social Discloud package.',
  INVALID_FEED_CONFIG:
    'config/social-feeds.json is invalid or unreadable. Export a fresh package from the desktop app.',
  INVALID_DELIVERY_STATE:
    'data/social-deliveries.json is invalid or unreadable. Restore its backup; it was not reset.',
  UNSUPPORTED_RUNTIME: 'The runtime needs Node.js >=22.9 with its built-in WebSocket enabled.',
  STARTUP_FAILED:
    'Unexpected startup failure. Check runtime version and application logs. Credentials were not printed.',
};
const startupFailure = (code) =>
  Object.assign(new Error(STARTUP_ERRORS[code]), { startupCode: code });
export function hostedStartupDiagnostic(error) {
  const code = Object.hasOwn(STARTUP_ERRORS, error?.startupCode ?? '')
    ? error.startupCode
    : 'STARTUP_FAILED';
  return { component: 'startup', status: 'error', code, message: STARTUP_ERRORS[code] };
}

export async function startHostedBot({
  env = process.env,
  root = fileURLToPath(new URL('../', import.meta.url)),
  api,
  Gateway = GatewaySession,
  fetchItems,
  onFatal = () => {},
  log = (event) => process.stdout.write(JSON.stringify(event) + '\n'),
} = {}) {
  if (typeof env.DISCORD_BOT_TOKEN !== 'string' || !env.DISCORD_BOT_TOKEN.trim())
    throw startupFailure('MISSING_BOT_TOKEN');
  const token = env.DISCORD_BOT_TOKEN.trim();
  if (/^Bot\s|^DISCORD_BOT_TOKEN\s*=/i.test(token)) throw startupFailure('INVALID_TOKEN_FORMAT');
  const configFile = path.join(root, 'config', 'social-feeds.json');
  const readConfig = () => {
    try {
      if (fs.statSync(configFile).size > 64000) throw startupFailure('INVALID_FEED_CONFIG');
      return validateSocial(JSON.parse(fs.readFileSync(configFile, 'utf8')));
    } catch (error) {
      throw startupFailure(error.code === 'ENOENT' ? 'MISSING_FEED_CONFIG' : 'INVALID_FEED_CONFIG');
    }
  };
  const initial = readConfig();
  api ??= new DiscordAPI(token);
  if (Gateway === GatewaySession && typeof globalThis.WebSocket !== 'function')
    throw startupFailure('UNSUPPORTED_RUNTIME');
  let welcomeConfig;
  try {
    welcomeConfig = readWelcomeFile(path.join(root, 'config', 'welcome.json'));
  } catch {
    throw startupFailure('INVALID_WELCOME_CONFIG');
  }
  const welcomeEnabled = welcomeConfig.guilds.some((g) => g.join.enabled || g.leave.enabled);
  const gateway = new Gateway(token, { api, intents: welcomeEnabled ? 3 : 0 });
  let stopped = false,
    timer = null,
    active = null,
    failed = false;
  let engine;
  try {
    engine = createSocialEngine({
      api,
      fetchItems: fetchItems ?? createSocialProviders({ env }),
      stateFile: path.join(root, 'data', 'social-deliveries.json'),
      onStatus: log,
      isStopping: () => stopped,
    });
  } catch {
    throw startupFailure('INVALID_DELIVERY_STATE');
  }
  let welcome;
  try {
    welcome = createWelcomeEngine({
      api,
      config: welcomeConfig,
      stateFile: path.join(root, 'data', 'welcome-deliveries.json'),
      onStatus: log,
      isStopping: () => stopped,
    });
  } catch {
    throw startupFailure('INVALID_WELCOME_STATE');
  }
  gateway.on('member-event', (event) => {
    void welcome.handle(event);
  });
  async function cycle() {
    if (stopped) return;
    try {
      await engine.tick(readConfig());
    } catch (error) {
      log(
        error.startupCode
          ? hostedStartupDiagnostic(error)
          : {
              status: 'config-or-storage-error',
              message: 'Check persistent data storage. No reset was performed.',
            },
      );
    } finally {
      if (!stopped)
        timer = setTimeout(() => {
          active = cycle();
        }, 120000);
    }
  }
  async function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    gateway.stop();
    await active;
    await welcome.drain();
  }
  gateway.on('status', (event) => {
    // Gateway descriptions can contain provider/server details: emit only the status enum.
    const code =
      event.status === 'error'
        ? String(event.message ?? '')
            .match(/(?:HTTP (40[13])|(?:كود |code )(4004|4010|4011|4012|4013|4014))/)
            ?.slice(1)
            .find(Boolean)
        : undefined;
    log({
      component: 'gateway',
      status: event.status,
      ...(code ? { code: Number(code) } : {}),
      ...(code === '4014' && welcomeEnabled ? { hint: 'ENABLE_SERVER_MEMBERS_INTENT' } : {}),
    });
    if (event.status === 'error' && !gateway.running) {
      failed = true;
      void stop().then(onFatal);
    }
  });
  log({
    component: 'startup',
    status: 'ready',
    tokenConfigured: true,
    configuredSources: initial.feeds.length,
    welcomeEnabled,
    nodeVersion: process.versions.node,
  });
  gateway.start();
  if (!stopped) active = cycle();
  return {
    stop,
    get failed() {
      return failed;
    },
  };
}
// Distinguish a host-requested stop from a startup/runtime failure, without logging credentials.
export function installHostedShutdown(
  bot,
  { runtime = process, log = (event) => process.stdout.write(JSON.stringify(event) + '\n') } = {},
) {
  let shutdown = null;
  const request = (signal) => {
    if (!['SIGINT', 'SIGTERM'].includes(signal)) throw new Error('Unsupported shutdown signal.');
    if (shutdown) return shutdown;
    log({ component: 'lifecycle', status: 'stopping', reason: 'host-signal', signal });
    shutdown = Promise.resolve()
      .then(() => bot.stop())
      .then(
        () => {
          runtime.exitCode = bot.failed ? 1 : 0;
          log({
            component: 'lifecycle',
            status: 'stopped',
            reason: 'host-signal',
            signal,
            exitCode: runtime.exitCode,
          });
        },
        () => {
          runtime.exitCode = 1;
          log({ component: 'lifecycle', status: 'error', code: 'SHUTDOWN_FAILED' });
        },
      );
    return shutdown;
  };
  const handlers = Object.fromEntries(
    ['SIGINT', 'SIGTERM'].map((signal) => [
      signal,
      () => {
        void request(signal);
      },
    ]),
  );
  for (const [signal, handler] of Object.entries(handlers)) runtime.once(signal, handler);
  return {
    request,
    dispose() {
      for (const [signal, handler] of Object.entries(handlers))
        runtime.removeListener(signal, handler);
    },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const bot = await startHostedBot({
      onFatal: () => {
        process.exitCode = 1;
      },
    });
    installHostedShutdown(bot);
  } catch (error) {
    process.stderr.write(JSON.stringify(hostedStartupDiagnostic(error)) + '\n');
    process.exitCode = 1;
  }
}
