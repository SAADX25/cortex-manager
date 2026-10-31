import test from 'node:test';
import assert from 'node:assert/strict';
import { GatewaySession, gatewayURL } from '../src/gateway.mjs';
import { diagnostics } from '../src/desktop-worker.mjs';
import { sample } from './helpers/fake.mjs';

function environment(
  info = { url: 'wss://gateway.discord.gg', shards: 1, session_start_limit: { remaining: 10 } },
) {
  let time = 20000,
    next = 1;
  const pending = new Map(),
    sockets = [],
    requests = [],
    states = [];
  const timers = {
    setTimeout(fn, ms) {
      const id = next++;
      pending.set(id, { fn, at: time + ms, ms });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
  };
  class Socket extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      this.sent = [];
      this.readyState = 1;
      sockets.push(this);
    }
    send(value) {
      this.sent.push(JSON.parse(value));
    }
    close(code) {
      this.readyState = 3;
      this.closeCode = code;
      const event = new Event('close');
      Object.defineProperty(event, 'code', { value: code });
      this.dispatchEvent(event);
    }
    packet(value) {
      this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) }));
    }
  }
  const session = new GatewaySession('test-secret', {
    api: {
      get: async (path) => {
        requests.push(path);
        return info;
      },
    },
    Socket,
    timers,
    random: () => 0.5,
    now: () => time,
  });
  session.on('status', (s) => states.push(s));
  const flush = async () => {
    await new Promise((resolve) => setImmediate(resolve));
  };
  const step = async () => {
    const [id, item] = [...pending].sort((a, b) => a[1].at - b[1].at)[0];
    pending.delete(id);
    time = item.at;
    item.fn();
    await flush();
  };
  const start = async () => {
    session.start();
    await flush();
    return sockets.at(-1);
  };
  const hello = (socket) => socket.packet({ op: 10, d: { heartbeat_interval: 1000 } });
  const ready = (socket) =>
    socket.packet({
      op: 0,
      t: 'READY',
      s: 42,
      d: {
        session_id: 'session-id',
        resume_gateway_url: 'wss://gateway-us-east1-c.discord.gg',
        user: { username: 'Cortex Manager' },
      },
    });
  return { session, sockets, requests, states, pending, start, step, hello, ready, flush };
}

test('Gateway only permits official secure Discord hosts', () => {
  assert.equal(
    gatewayURL('wss://gateway.discord.gg/'),
    'wss://gateway.discord.gg/?v=10&encoding=json',
  );
  assert.ok(gatewayURL('wss://gateway-us-east1-c.discord.gg').includes('v=10'));
  for (const value of [
    'ws://gateway.discord.gg',
    'wss://gateway.discord.gg.evil.test',
    'wss://evil.test',
    'wss://token@gateway.discord.gg',
    'wss://gateway.discord.gg:444',
  ])
    assert.throws(() => gatewayURL(value));
});
test('presence Identify uses zero intents, receives READY, and logs no token', async () => {
  const e = environment(),
    socket = await e.start();
  e.session.start();
  e.hello(socket);
  e.ready(socket);
  assert.equal(e.sockets.length, 1);
  const identify = socket.sent.find((p) => p.op === 2);
  assert.equal(identify.d.intents, 0);
  assert.equal(identify.d.presence.status, 'online');
  assert.ok(e.states.some((s) => s.status === 'online'));
  assert.ok(!JSON.stringify(e.states).includes('test-secret'));
  e.session.stop();
  assert.equal(socket.closeCode, 1000);
  assert.equal(e.pending.size, 0);
});
test('heartbeat sends last sequence, honors ACK and reconnects when ACK is missing', async () => {
  const e = environment(),
    socket = await e.start();
  e.hello(socket);
  e.ready(socket);
  await e.step();
  assert.deepEqual(socket.sent.at(-1), { op: 1, d: 42 });
  socket.packet({ op: 11 });
  await e.step();
  assert.equal(e.session.awaitingAck, true);
  await e.step();
  assert.equal(socket.closeCode, 4000);
  assert.ok(e.states.some((s) => s.status === 'reconnecting'));
  e.session.stop();
});
test('server reconnect resumes cached session on resume host instead of re-identifying', async () => {
  const e = environment(),
    socket = await e.start();
  e.hello(socket);
  e.ready(socket);
  socket.packet({ op: 7 });
  await e.step();
  const resumed = e.sockets.at(-1);
  assert.notEqual(resumed, socket);
  assert.ok(resumed.url.includes('gateway-us-east1-c'));
  e.hello(resumed);
  assert.equal(resumed.sent[0].op, 6);
  assert.equal(resumed.sent[0].d.seq, 42);
  resumed.packet({ op: 0, t: 'RESUMED', s: 43, d: {} });
  assert.equal(e.states.at(-1).status, 'online');
  assert.equal(e.requests.length, 1);
  e.session.stop();
});
test('invalid session waits at least the Identify interval before a fresh session', async () => {
  const e = environment(),
    socket = await e.start();
  e.hello(socket);
  e.ready(socket);
  socket.packet({ op: 9, d: false });
  await e.step();
  assert.equal(e.sockets.length, 1);
  await e.step();
  assert.equal(e.sockets.length, 2);
  e.hello(e.sockets.at(-1));
  assert.equal(e.sockets.at(-1).sent[0].op, 2);
  assert.equal(e.requests.length, 2);
  e.session.stop();
});
test('bad token/invalid intents fatal close does not reconnect', async () => {
  for (const code of [4004, 4013, 4014]) {
    const e = environment(),
      socket = await e.start();
    socket.close(code);
    assert.equal(e.session.running, false);
    assert.equal(e.pending.size, 0);
    assert.equal(e.states.at(-1).status, 'error');
    e.session.stop();
  }
});
test('exhausted Identify budget waits for its reset without opening a socket', async () => {
  const e = environment({
    url: 'wss://gateway.discord.gg',
    shards: 1,
    session_start_limit: { remaining: 0, reset_after: 120000 },
  });
  await e.start();
  assert.equal(e.sockets.length, 0);
  assert.equal([...e.pending.values()][0].ms, 120000);
  e.session.stop();
});
test('stop while gateway discovery is pending never opens a connection', async () => {
  let resolve;
  const e = environment();
  e.session.api = { get: () => new Promise((r) => (resolve = r)) };
  e.session.start();
  e.session.stop();
  resolve({ url: 'wss://gateway.discord.gg' });
  await e.flush();
  assert.equal(e.sockets.length, 0);
});
test('permission diagnostics report protected leadership and generate guild-scoped opt-in links', () => {
  const s = sample(),
    d = diagnostics(s),
    normal = new URL(d.inviteURL),
    admin = new URL(d.adminInviteURL);
  assert.equal(d.guildId, s.guild.id);
  assert.equal(normal.hostname, 'discord.com');
  assert.equal(normal.searchParams.get('guild_id'), s.guild.id);
  assert.equal(admin.searchParams.get('permissions'), '8');
  assert.notEqual(normal.searchParams.get('permissions'), '8');
  for (const name of ['★ OWNER ★', '★ CO_OWNER ★'])
    assert.ok(d.roles.find((r) => r.name === name).preserved);
  assert.ok(d.permissions.every((p) => p.granted));
});
