// Register before loading application modules, including their transitive dependencies.
// Keep the full Error/stack in the host logs so startup failures can be diagnosed.
process.on('uncaughtException', (error, origin) => {
  console.error('[runtime] uncaughtException', origin, error);
});
process.on('unhandledRejection', (reason) => {
  console.error('[runtime] unhandledRejection', reason);
});

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const STARTUP_ERRORS = {
  MISSING_BOT_TOKEN:
    'DISCORD_BOT_TOKEN is not available to the running process. Check the application variable name, save/apply it and recreate the runtime if necessary.',
  INVALID_TOKEN_FORMAT:
    'DISCORD_BOT_TOKEN must contain only the bot token, without a Bot prefix or KEY=value text.',
  INVALID_FEED_CONFIG:
    'config/social-feeds.json is invalid or unreadable. Export a fresh package from the desktop app.',
  UNSUPPORTED_RUNTIME: 'The runtime needs Node.js >=22.9 with its built-in WebSocket enabled.',
  STARTUP_FAILED:
    'Startup could not complete. See the error and stack below; startup will retry in 120 seconds.',
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
  responseAPI,
  Gateway,
  fetchItems,
  onFatal = () => {},
  log = (event) => process.stdout.write(JSON.stringify(event) + '\n'),
} = {}) {
  if (typeof env.DISCORD_BOT_TOKEN !== 'string' || !env.DISCORD_BOT_TOKEN.trim())
    throw startupFailure('MISSING_BOT_TOKEN');
  const token = env.DISCORD_BOT_TOKEN.trim();
  if (/^Bot\s|^DISCORD_BOT_TOKEN\s*=/i.test(token)) throw startupFailure('INVALID_TOKEN_FORMAT');
  // Dynamic imports are inside the caught startup boundary. A missing module now
  // produces a useful stack and a retry instead of failing before handlers exist.
  const [
    { createKickNotifications },
    { readTicketFile, emptyTickets },
    { createTicketEngine },
    { readWelcomeFile, emptyWelcome },
    { createWelcomeEngine },
    { DiscordAPI },
    { GatewaySession },
    { validateSocial, atomicJSON },
    { createSocialProviders },
    { createSocialEngine },
  ] = await Promise.all([
    import('./kick-notifications.mjs'),
    import('./ticket-config.mjs'),
    import('./ticket-engine.mjs'),
    import('./welcome-config.mjs'),
    import('./welcome-engine.mjs'),
    import('./api.mjs'),
    import('./gateway.mjs'),
    import('./social-config.mjs'),
    import('./social-providers.mjs'),
    import('./social-engine.mjs'),
  ]);
  Gateway ??= GatewaySession;
  const readOptionalConfig = (file, read, defaults, code) => {
    try {
      if (!fs.existsSync(file)) atomicJSON(file, defaults);
      return read();
    } catch (error) {
      log({ component: 'startup', status: 'warning', code, file: path.relative(root, file) });
      return structuredClone(defaults);
    }
  };
  const stateEngine = (name, defaults, create, disabled, legacy) => {
    const file = path.join(root, 'data', name + '.json');
    try {
      if (!fs.existsSync(file)) {
        const old = legacy && path.join(root, 'data', legacy + '.json');
        if (old && fs.existsSync(old)) fs.copyFileSync(old, file);
        else atomicJSON(file, defaults);
      }
      return create(file);
    } catch (error) {
      try {
        // Never discard a corrupt state file: operators can recover ticket IDs
        // and delivery history from this exact byte-for-byte backup.
        let backup;
        if (fs.existsSync(file)) {
          backup = file + '.corrupt-' + randomUUID();
          fs.renameSync(file, backup);
        }
        atomicJSON(file, defaults);
        const engine = create(file);
        log({
          component: name,
          status: 'warning',
          code: 'STATE_RECOVERED',
          ...(backup ? { backup: path.relative(root, backup) } : {}),
        });
        return engine;
      } catch (recoveryError) {
        log({ component: name, status: 'warning', code: 'STATE_UNAVAILABLE_FEATURE_DISABLED' });
        console.error('[startup] State recovery failed:', name, recoveryError);
        // Disable only this feature if persistence is unavailable. Sending with
        // volatile delivery state would risk duplicated or untracked messages.
        return disabled;
      }
    }
  };
  const configFile = path.join(root, 'config', 'social-feeds.json');
  const readConfig = () =>
    readOptionalConfig(
      configFile,
      () => {
        if (fs.statSync(configFile).size > 64000) throw startupFailure('INVALID_FEED_CONFIG');
        return validateSocial(JSON.parse(fs.readFileSync(configFile, 'utf8')));
      },
      { version: 1, feeds: [] },
      'INVALID_FEED_CONFIG_USING_EMPTY',
    );
  const initial = readConfig();
  responseAPI ??= api ?? new DiscordAPI(token);
  api ??= new DiscordAPI(token);
  if (Gateway === GatewaySession && typeof globalThis.WebSocket !== 'function')
    throw startupFailure('UNSUPPORTED_RUNTIME');
  const ticketFile = path.join(root, 'config', 'tickets.json');
  const ticketConfig = readOptionalConfig(
    ticketFile,
    () => readTicketFile(ticketFile),
    emptyTickets(),
    'INVALID_TICKET_CONFIG_USING_EMPTY',
  );
  const welcomeFile = path.join(root, 'config', 'welcome.json');
  const welcomeConfig = readOptionalConfig(
    welcomeFile,
    () => readWelcomeFile(welcomeFile),
    emptyWelcome(),
    'INVALID_WELCOME_CONFIG_USING_EMPTY',
  );
  const kickEnabled = welcomeConfig.guilds.some((g) => g.kick?.enabled);
  const welcomeEnabled =
    kickEnabled || welcomeConfig.guilds.some((g) => g.join.enabled || g.leave.enabled);
  const gateway = new Gateway(token, {
    api,
    intents: kickEnabled ? 7 : welcomeEnabled ? 3 : 0,
    receiveInteractions: true,
  });
  let stopped = false,
    timer = null,
    active = null,
    failed = false;
  let registrationTimer = null,
    registration = Promise.resolve();
  const background = (component, work) =>
    Promise.resolve()
      .then(work)
      .catch(() => log({ component, status: 'warning', code: 'BACKGROUND_TASK_FAILED' }));
  const noop = async () => {};
  const tickets = stateEngine(
    'tickets',
    { version: 1, tickets: {}, seen: {} },
    (stateFile) =>
      createTicketEngine({
        api,
        responseAPI,
        config: ticketConfig,
        stateFile,
        onStatus: log,
        isStopping: () => stopped,
      }),
    { handle: noop, drain: noop, register: noop },
  );
  gateway.on('interaction', (event) => {
    void background('tickets', () => tickets.handle(event));
  });
  const engine = stateEngine(
    'social-deliveries',
    { version: 1, sources: {} },
    (stateFile) =>
      createSocialEngine({
        api,
        fetchItems: fetchItems ?? createSocialProviders({ env }),
        stateFile,
        onStatus: log,
        isStopping: () => stopped,
      }),
    { tick: noop },
    'social',
  );
  const kick = stateEngine(
    'kick-deliveries',
    { version: 1, seen: [] },
    (stateFile) =>
      createKickNotifications({
        api,
        config: welcomeConfig,
        stateFile,
        onStatus: log,
        isStopping: () => stopped,
      }),
    { handle: noop, drain: noop, checkPermissions: noop, suppressFarewell: async () => false },
  );
  const welcome = stateEngine(
    'welcome-deliveries',
    { version: 1, seen: [] },
    (stateFile) =>
      createWelcomeEngine({
        api,
        config: welcomeConfig,
        suppressFarewell: kick.suppressFarewell,
        stateFile,
        onStatus: log,
        isStopping: () => stopped,
      }),
    { handle: noop, drain: noop },
    'welcome',
  );
  gateway.on('audit-event', (entry) => {
    void background('kick', () => kick.handle(entry));
  });
  gateway.on('member-event', (event) => {
    void background('welcome', () => welcome.handle(event));
  });
  async function cycle() {
    if (stopped) return;
    try {
      await engine.tick(readConfig());
    } catch (error) {
      log(
        error?.startupCode
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
    clearTimeout(registrationTimer);
    gateway.stop();
    await active;
    await welcome.drain();
    await kick.drain();
    await tickets.drain();
    await registration;
    await kickPermissionCheck;
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
      void background('lifecycle', async () => {
        try {
          await stop();
        } finally {
          await onFatal();
        }
      });
    }
  });
  async function registerTickets() {
    if (stopped) return;
    try {
      await tickets.register();
    } catch (error) {
      log({
        component: 'tickets',
        status: 'warning',
        code: 'TICKET_REGISTRATION_FAILED',
        retryMs: 120000,
      });
      console.error('[tickets] Command registration failed:', error);
      if (!stopped)
        registrationTimer = setTimeout(() => {
          registration = registerTickets();
        }, 120000);
    }
  }
  log({
    component: 'startup',
    status: 'ready',
    tokenConfigured: true,
    configuredSources: initial.feeds.length,
    welcomeEnabled,
    kickEnabled,
    ticketsEnabled: ticketConfig.guilds.some((g) => g.enabled),
    nodeVersion: process.versions.node,
  });
  const kickPermissionCheck = kickEnabled
    ? background('kick', () => kick.checkPermissions())
    : Promise.resolve();
  gateway.start();
  registration = registerTickets();
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
  let bot = null,
    retryTimer = null,
    stopping = false;
  installHostedShutdown({
    get failed() {
      return false;
    },
    async stop() {
      stopping = true;
      clearTimeout(retryTimer);
      await bot?.stop();
    },
  });
  function retry() {
    if (!stopping)
      retryTimer = setTimeout(() => {
        void boot();
      }, 120000);
  }
  async function boot() {
    try {
      bot = await startHostedBot({ onFatal: retry });
      if (stopping) await bot.stop();
    } catch (error) {
      console.error('[startup]', hostedStartupDiagnostic(error), error);
      retry();
    }
  }
  console.log(
    JSON.stringify({
      component: 'startup',
      status: 'booting',
      nodeVersion: process.versions.node,
      platform: process.platform,
      arch: process.arch,
    }),
  );
  void boot();
}
