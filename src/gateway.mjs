import { EventEmitter } from 'node:events';
import { DiscordAPI } from './api.mjs';

export function gatewayURL(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'wss:' ||
    !/^gateway(?:-[a-z0-9-]+)?\.discord\.gg$/i.test(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error('Invalid Discord Gateway address');
  url.search = 'v=10&encoding=json';
  return url.href;
}
const fatalCodes = new Set([4004, 4010, 4011, 4012, 4013, 4014]);

// Presence by default; member/audit events are opt-in. No moderation commands,
// and no dependency on the rebuild process staying active.
export class GatewaySession extends EventEmitter {
  constructor(
    token,
    {
      api = new DiscordAPI(token),
      Socket = WebSocket,
      random = Math.random,
      now = Date.now,
      timers = { setTimeout, clearTimeout },
      intents = 0,
    } = {},
  ) {
    super();
    if (![0, 3, 7].includes(intents)) throw new Error('Unsupported Gateway intents.');
    this.intents = intents;
    this.token = token;
    this.api = api;
    this.Socket = Socket;
    this.random = random;
    this.now = now;
    this.timers = timers;
    this.running = false;
    this.socket = null;
    this.session = null;
    this.sequence = null;
    this.resumeURL = null;
    this.retryTimer = null;
    this.heartbeatTimer = null;
    this.handshakeTimer = null;
    this.attempts = 0;
    this.nextIdentifyAt = 0;
  }
  state(status, message) {
    this.emit('status', { status, message });
  }
  start() {
    if (this.running) return;
    this.running = true;
    void this.connect();
  }
  clearConnectionTimers() {
    for (const key of ['heartbeatTimer', 'handshakeTimer']) {
      this.timers.clearTimeout(this[key]);
      this[key] = null;
    }
  }
  stop() {
    const active = this.running || this.socket || this.retryTimer !== null;
    this.running = false;
    this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.clearConnectionTimers();
    const socket = this.socket;
    this.socket = null;
    if (socket)
      try {
        socket.close(1000, 'Local app stopped');
      } catch {}
    this.session = null;
    this.sequence = null;
    this.resumeURL = null;
    if (active) this.state('offline', 'تم إيقاف اتصال البرنامج بالبوت.');
  }
  schedule(ms) {
    if (!this.running || this.retryTimer !== null) return;
    this.state('reconnecting', `إعادة الاتصال بعد ${Math.ceil(ms / 1000)} ثانية…`);
    this.retryTimer = this.timers.setTimeout(
      () => {
        this.retryTimer = null;
        void this.connect();
      },
      Math.min(ms, 2147483647),
    );
  }
  reconnect(ms = 1000) {
    this.clearConnectionTimers();
    const socket = this.socket;
    this.socket = null;
    if (socket)
      try {
        socket.close(4000, 'Reconnect');
      } catch {}
    this.schedule(ms);
  }
  send(op, d) {
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify({ op, d }));
  }
  heartbeat() {
    this.awaitingAck = true;
    this.send(1, this.sequence);
  }
  tick(interval) {
    this.heartbeatTimer = this.timers.setTimeout(() => {
      if (!this.running || !this.socket) return;
      if (this.awaitingAck) {
        this.reconnect();
        return;
      }
      this.heartbeat();
      this.tick(interval);
    }, interval);
  }
  async connect() {
    if (!this.running) return;
    if (!this.session && this.now() < this.nextIdentifyAt) {
      this.schedule(this.nextIdentifyAt - this.now());
      return;
    }
    try {
      let url = this.resumeURL;
      if (!this.session) {
        const info = await this.api.get('/gateway/bot');
        if (!this.running) return;
        if (info.shards > 1)
          throw new Error('هذا البوت يحتاج نظام Sharding؛ مشغل الحضور المحلي يدعم اتصالاً واحداً.');
        if (info.session_start_limit?.remaining === 0) {
          this.schedule(Math.max(60000, Number(info.session_start_limit.reset_after) || 60000));
          return;
        }
        url = info.url;
      }
      if (!this.running) return;
      this.state('connecting', 'جارٍ الاتصال الآمن بـ Discord…');
      const socket = new this.Socket(gatewayURL(url));
      this.socket = socket;
      this.awaitingAck = false;
      this.handshakeTimer = this.timers.setTimeout(() => {
        if (this.socket === socket) this.reconnect();
      }, 30000);
      socket.addEventListener('message', (event) => {
        if (this.socket !== socket || !this.running) return;
        try {
          this.receive(JSON.parse(event.data));
        } catch {
          this.state('error', 'وصل رد غير صالح من Gateway؛ جارٍ إعادة الاتصال.');
          this.reconnect(5000);
        }
      });
      socket.addEventListener('error', () => {
        if (this.socket === socket)
          this.reconnect(Math.min(30000, 1000 * 2 ** Math.min(++this.attempts, 5)));
      });
      socket.addEventListener('close', (event) => {
        if (this.socket !== socket || !this.running) return;
        this.socket = null;
        this.clearConnectionTimers();
        if (fatalCodes.has(event.code)) {
          this.running = false;
          this.state(
            'error',
            `أوقف Discord الاتصال (كود ${event.code}). تحقق من التوكن وإعدادات التطبيق قبل إعادة التشغيل.`,
          );
          return;
        }
        if ([4007, 4009].includes(event.code)) {
          this.session = null;
          this.sequence = null;
          this.resumeURL = null;
        }
        this.schedule(
          event.code === 4008 ? 60000 : Math.min(30000, 1000 * 2 ** Math.min(++this.attempts, 5)),
        );
      });
    } catch (error) {
      if (!this.running) return;
      if (/HTTP 40[13]|Sharding|Invalid Discord Gateway/.test(error.message)) {
        this.running = false;
        this.state('error', error.message);
        return;
      }
      this.state('error', 'تعذّر الاتصال؛ ستتم المحاولة مجدداً.');
      this.schedule(Math.min(30000, 1000 * 2 ** Math.min(++this.attempts, 5)));
    }
  }
  receive(packet) {
    if (packet.s !== null && packet.s !== undefined) this.sequence = packet.s;
    if (
      packet.op === 0 &&
      [3, 7].includes(this.intents) &&
      this.session &&
      ['GUILD_MEMBER_ADD', 'GUILD_MEMBER_REMOVE'].includes(packet.t)
    )
      this.emit('member-event', {
        type: packet.t,
        guildId: packet.d?.guild_id,
        user: packet.d?.user,
        session: this.session,
        sequence: packet.s,
      });
    if (
      packet.op === 0 &&
      this.intents === 7 &&
      this.session &&
      packet.t === 'GUILD_AUDIT_LOG_ENTRY_CREATE'
    )
      this.emit('audit-event', packet.d);
    if (packet.op === 10) {
      const interval = packet.d?.heartbeat_interval;
      if (!Number.isFinite(interval) || interval < 1000)
        throw new Error('Invalid heartbeat interval');
      this.clearConnectionTimers();
      this.awaitingAck = false;
      // Following heartbeats use the actual interval, not the initial jitter.
      this.heartbeatTimer = this.timers.setTimeout(
        () => {
          this.heartbeat();
          this.tick(interval);
        },
        Math.max(1, Math.floor(interval * this.random())),
      );
      if (this.session)
        this.send(6, { token: this.token, session_id: this.session, seq: this.sequence });
      else {
        this.nextIdentifyAt = this.now() + 5500;
        this.send(2, {
          token: this.token,
          intents: this.intents,
          properties: {
            os: 'windows',
            browser: 'CortexManagerDesktop',
            device: 'CortexManagerDesktop',
          },
          presence: {
            since: null,
            activities: [{ name: 'Cortex Manager', type: 0 }],
            status: 'online',
            afk: false,
          },
        });
      }
      this.handshakeTimer = this.timers.setTimeout(() => this.reconnect(5000), 30000);
    } else if (packet.op === 11) this.awaitingAck = false;
    else if (packet.op === 1) this.heartbeat();
    else if (packet.op === 7) this.reconnect(1000);
    else if (packet.op === 9) {
      if (!packet.d) {
        this.session = null;
        this.resumeURL = null;
        this.sequence = null;
      }
      this.reconnect(1000 + Math.floor(this.random() * 4000));
    } else if (packet.op === 0 && packet.t === 'READY') {
      this.session = packet.d.session_id;
      this.resumeURL = gatewayURL(packet.d.resume_gateway_url);
      this.attempts = 0;
      this.timers.clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
      this.state('online', `البوت Online — ${packet.d.user?.username ?? 'Cortex Manager'}`);
    } else if (packet.op === 0 && packet.t === 'RESUMED') {
      this.attempts = 0;
      this.timers.clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
      this.state('online', 'البوت Online — تم استئناف الاتصال.');
    }
  }
}
