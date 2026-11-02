import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createDesktopServer,
  desktopDemoSnapshot,
  spawnDesktopWorker,
} from '../src/desktop-server.mjs';
import { CONFIRMATION } from '../src/safety.mjs';
import { diagnostics } from '../src/desktop-worker.mjs';
import { sample, ID } from './helpers/fake.mjs';
import { defaultDesign } from '../src/custom-design.mjs';

function controlledRunner() {
  const calls = [];
  const runner = (mode, config, options) => {
    let finish;
    const completion = new Promise((resolve) => {
      finish = resolve;
    });
    const call = {
      mode,
      config,
      options,
      stopped: false,
      finish(code = 0) {
        finish({ code });
      },
      output(value) {
        options.onOutput(typeof value === 'string' ? value : JSON.stringify(value));
      },
      error(message) {
        options.onError(message);
      },
    };
    calls.push(call);
    return {
      completion,
      async stop() {
        call.stopped = true;
        finish({ code: 0 });
      },
    };
  };
  return { runner, calls };
}
async function setup(t, options = {}) {
  const tempRoot = path.resolve(os.tmpdir()),
    root = fs.mkdtempSync(path.join(tempRoot, 'cortex-desktop-http-'));
  const web = path.join(root, 'desktop', 'web');
  fs.mkdirSync(web, { recursive: true });
  fs.writeFileSync(
    path.join(web, 'index.html'),
    '<!doctype html><html lang="ar"><title>Cortex 6</title></html>',
  );
  const control = controlledRunner();
  const bridge = await createDesktopServer({
    root,
    sessionDir: path.join(root, 'session'),
    runWorker: control.runner,
    ...options,
  });
  t.after(async () => {
    await bridge.close();
    const target = path.resolve(root);
    assert.equal(path.dirname(target), tempRoot);
    assert.ok(path.basename(target).startsWith('cortex-desktop-http-'));
    fs.rmSync(target, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${bridge.port}`;
  const request = (url = '/api/state', init = {}) =>
    fetch(base + url, { ...init, headers: { 'X-Cortex-Key': bridge.key, ...init.headers } });
  const state = async () => {
    const response = await request();
    assert.equal(response.status, 200);
    return response.json();
  };
  const action = (name, config = {}) =>
    request('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: name, config }),
    });
  const settled = async () => {
    for (let i = 0; i < 600; i++) {
      const value = await state();
      if (!value.busy) return value;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Mock operation never settled');
  };
  return { ...bridge, ...control, root, base, request, state, action, settled };
}
const credentials = { token: 'desktop-test-token-never-use', guildId: ID };

test('large image previews cross the authenticated bridge while ordinary actions keep their original size limit', async (t) => {
  const s = await setup(t, { demo: true }),
    png = Buffer.concat([
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZS8AAAAASUVORK5CYII=',
        'base64',
      ),
      Buffer.alloc(300000),
    ]),
    image = {
      type: 'image/png',
      data: png.toString('base64'),
      sha256: createHash('sha256').update(png).digest('hex'),
    },
    inventory = (await s.state()).inventory;
  const channel = inventory.channels.find((c) => c.type === 0),
    body = {
      channelId: channel.id,
      url: 'https://instagram.com/p/example/',
      caption: 'Review only',
      image,
    };
  const response = await s.request('/api/social/manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
  const request = (await response.json()).request;
  assert.equal(request.image.sha256, image.sha256);
  assert.equal(
    (
      await s.action('message-preview', {
        ...credentials,
        guildId: inventory.guildId,
        messageRequest: request,
      })
    ).status,
    202,
  );
  const state = await s.state();
  assert.equal(state.messagePreview.image.sha256, image.sha256);
  assert.equal(state.messagePreview.image.data, undefined);
  assert.equal(s.calls.length, 0);
  assert.equal(
    (await s.action('inventory', { ...credentials, padding: 'x'.repeat(300000) })).status,
    413,
  );
});

test('social routes require authentication, validate and persist nonsecret config without workers, and prepare manual previews without sending', async (t) => {
  const s = await setup(t),
    post = (url, body) =>
      s.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
  assert.equal((await fetch(s.base + '/api/social')).status, 401);
  assert.equal((await fetch(s.base + '/api/social/package')).status, 401);
  const first = await (await s.request('/api/social')).json(),
    feed = {
      id: 'youtube-1',
      guildId: ID,
      channelId: '777777777777777777',
      platform: 'youtube',
      source: 'UC' + 'a'.repeat(22),
      language: 'ar',
      enabled: true,
    },
    config = { version: 1, feeds: [feed] };
  assert.equal((await post('/api/social', { config, baseRevision: first.revision })).status, 400);
  assert.equal((await post('/api/social/validate', config)).status, 200);
  let r = await post('/api/social', {
    config,
    baseRevision: first.revision,
    confirmAutomatic: true,
  });
  assert.equal(r.status, 200);
  const saved = await r.json();
  assert.equal(saved.config.feeds[0].enabled, true);
  assert.equal(
    (await post('/api/social', { config, baseRevision: first.revision, confirmAutomatic: true }))
      .status,
    409,
  );
  assert.equal((await fetch(s.base + '/api/social/links')).status, 401);
  assert.deepEqual(await (await s.request('/api/social/links')).json(), { links: [] });
  assert.equal((await post('/api/social/link', {})).status, 404);
  r = await post('/api/social/manual', {
    channelId: feed.channelId,
    url: 'https://youtu.be/abcdefghijk',
    caption: 'Hello',
    language: 'en',
  });
  assert.equal(r.status, 200);
  assert.match((await r.json()).request.content, /Hello/);
  assert.equal(s.calls.length, 0);
  assert.equal(
    (
      await post('/api/social/manual', {
        channelId: feed.channelId,
        url: 'https://localhost/private',
      })
    ).status,
    400,
  );
  const demo = await setup(t, { demo: true });
  assert.equal((await demo.request('/api/social/package')).status, 403);
  const demoPreview = await demo.request('/api/social/manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channelId: feed.channelId,
      url: 'https://instagram.com/p/example/',
      captureThumbnail: true,
    }),
  });
  assert.equal(demoPreview.status, 200);
  const thumbnail = (await demoPreview.json()).thumbnail;
  assert.equal(thumbnail.status, 'unavailable');
  assert.equal(thumbnail.reason, 'demo');
  assert.equal(demo.calls.length, 0);
});

test('blueprint autosave uses a revision to reject overwriting a newer draft from another window', async (t) => {
  const s = await setup(t),
    url = '/api/design?guildId=' + ID,
    initial = await (await s.request(url)).json();
  const save = (body) =>
    s.request('/api/design', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const first = structuredClone(initial.design);
  first.categories[0].name = 'First window';
  const response = await save({ guildId: ID, design: first, baseRevision: initial.revision });
  assert.equal(response.status, 200);
  const updated = await response.json();
  assert.notEqual(updated.revision, initial.revision);
  const other = structuredClone(initial.design);
  other.categories[0].name = 'Old second window';
  assert.equal(
    (await save({ guildId: ID, design: other, baseRevision: initial.revision })).status,
    409,
  );
  assert.equal((await (await s.request(url)).json()).design.categories[0].name, 'First window');
  assert.equal(s.calls.length, 0);
});

test('workspace API authenticates, persists drafts without workers and invalidates a reviewed batch on changes', async (t) => {
  const s = await setup(t),
    post = (body) =>
      s.request('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
  assert.equal((await fetch(s.base + '/api/workspace?guildId=' + ID)).status, 401);
  const first = await (await s.request('/api/workspace?guildId=' + ID)).json(),
    snap = sample();
  const role = snap.roles.find((r) => r.id === '555555555555555555'),
    inv = diagnostics(snap).inventory;
  const request = {
    kind: 'role',
    action: 'update',
    id: role.id,
    revision: inv.roles.find((r) => r.id === role.id).revision,
    values: { name: 'Workspace role' },
    permissionChanges: {},
  };
  const entry = {
    key: 'role:' + role.id,
    request,
    tab: 'general',
    overwriteRole: '',
    staged: true,
  };
  let response = await post({ guildId: ID, baseRevision: first.revision, entries: [entry] });
  assert.equal(response.status, 200);
  let saved = await response.json();
  assert.equal(s.calls.length, 0);
  assert.equal(
    (await post({ guildId: ID, baseRevision: first.revision, entries: [] })).status,
    409,
  );
  assert.equal(
    (await post({ guildId: '../escape', baseRevision: first.revision, entries: [] })).status,
    400,
  );
  assert.equal(
    (
      await post({
        guildId: ID,
        baseRevision: saved.revision,
        entries: [{ ...entry, token: 'never persist' }],
      })
    ).status,
    400,
  );
  await s.action('batch-preview', { ...credentials, batchRequests: [request] });
  assert.equal(s.calls[0].mode, 'batch-preview');
  s.calls[0].output({ event: 'batch-preview', data: { guildId: ID, approvalHash: 'reviewed' } });
  s.calls[0].finish();
  await s.settled();
  assert.ok((await s.state()).batchPreview);
  response = await post({
    guildId: ID,
    baseRevision: saved.revision,
    entries: [{ ...entry, staged: false }],
  });
  assert.equal(response.status, 200);
  assert.equal((await s.state()).batchPreview, null);
  assert.equal(
    (
      await s.action('batch-apply', {
        ...credentials,
        batchConfirmation: { guildId: ID, confirmed: true, approvalHash: 'reviewed' },
      })
    ).status,
    400,
  );
});

test('demo reviews batches and simulates permissions without workers and refuses real batch execution', async (t) => {
  const s = await setup(t, { demo: true }),
    value = await s.state(),
    role = value.inventory.roles.find((r) => !r.readOnlyReason),
    channel = value.inventory.channels.find((c) => c.type === 0);
  const request = {
    kind: 'role',
    action: 'update',
    id: role.id,
    revision: role.revision,
    values: { name: 'Demo changed name' },
    permissionChanges: {},
  };
  assert.equal((await s.action('batch-preview', { batchRequests: [request] })).status, 202);
  assert.equal((await s.state()).batchPreview.count, 1);
  assert.equal(
    (await s.action('batch-apply', { batchConfirmation: { confirmed: true } })).status,
    403,
  );
  assert.equal(
    (
      await s.action('permission-simulate', {
        simulationRequest: { channelId: channel.id, memberId: '900000000000001005' },
      })
    ).status,
    202,
  );
  const p = (await s.state()).simulation;
  assert.equal(p.channelId, channel.id);
  assert.equal(p.memberId, '900000000000001005');
  assert.equal(s.calls.length, 0);
});

test('server bookmarks restore name and icon offline, switch without workers and invalidate old approvals', async (t) => {
  const s = await setup(t, {
    credentialStore: {
      async load() {
        return { ...credentials };
      },
    },
  });
  assert.equal((await s.state()).serverProfiles[0].id, ID);
  await s.action('inventory', credentials);
  const snap = sample();
  snap.guild.icon = 'a'.repeat(32);
  s.calls[0].output({ event: 'diagnostics', data: diagnostics(snap) });
  s.calls[0].finish();
  await s.settled();
  const remembered = (await s.state()).serverProfiles[0];
  assert.equal(remembered.name, snap.guild.name);
  assert.match(remembered.iconURL, /cdn\.discordapp\.com\/icons/);
  const other = '777777777777777777';
  assert.equal((await s.action('server-save', { guildId: other })).status, 202);
  assert.equal(
    (await s.action('server-save', { guildId: other, token: 'no secrets allowed' })).status,
    400,
  );
  assert.equal((await s.action('server-save', { guildId: '../escape' })).status, 400);
  await s.action('preview', credentials);
  fs.writeFileSync(path.join(s.sessionDir, 'out', 'preview.md'), 'Reviewed');
  fs.writeFileSync(
    path.join(s.sessionDir, 'out', 'plan.json'),
    JSON.stringify({ approvalHash: 'old-hash' }),
  );
  assert.equal((await s.action('server-select', { guildId: other })).status, 409);
  s.calls[1].finish();
  await s.settled();
  assert.ok((await s.state()).preview);
  assert.equal((await s.action('server-select', { guildId: other })).status, 202);
  let value = await s.state();
  assert.equal(value.guildId, other);
  assert.equal(value.inventory, null);
  assert.equal(value.preview, null);
  assert.equal(value.connected, false);
  assert.equal(value.hasCredentials, true);
  assert.equal(s.calls.length, 2);
  assert.equal((await s.action('server-select', { guildId: ID })).status, 202);
  await s.close();
  const restored = await createDesktopServer({
    root: path.dirname(s.sessionDir),
    credentialStore: {
      async load() {
        return { ...credentials, guildId: other };
      },
    },
  });
  t.after(() => restored.close());
  const response = await fetch(`http://127.0.0.1:${restored.port}/api/state`, {
    headers: { 'X-Cortex-Key': restored.key },
  });
  value = await response.json();
  assert.equal(value.guildId, ID);
  assert.equal(value.connected, false);
  assert.equal(value.inventory, null);
  assert.deepEqual(value.serverProfiles[0], remembered);
  assert.ok(!JSON.stringify(value).includes(credentials.token));
});

test('removing the last bookmark stays removed after restart and does not forget the bot token', async (t) => {
  const vault = {
      async load() {
        return { ...credentials };
      },
    },
    s = await setup(t, { credentialStore: vault });
  assert.equal((await s.action('server-remove', { guildId: ID })).status, 202);
  assert.deepEqual((await s.state()).serverProfiles, []);
  assert.equal(s.calls.length, 0);
  await s.close();
  const restored = await createDesktopServer({
    root: path.dirname(s.sessionDir),
    credentialStore: vault,
  });
  t.after(() => restored.close());
  const response = await fetch(`http://127.0.0.1:${restored.port}/api/state`, {
      headers: { 'X-Cortex-Key': restored.key },
    }),
    value = await response.json();
  assert.deepEqual(value.serverProfiles, []);
  assert.equal(value.guildId, '');
  assert.equal(value.hasCredentials, true);
});

test('blueprint storage validates and persists per guild without Discord writes, and invalidates approvals', async (t) => {
  const s = await setup(t),
    read = () => s.request('/api/design?guildId=' + ID),
    save = (body) =>
      s.request('/api/design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
  assert.equal((await fetch(s.base + '/api/design')).status, 401);
  const first = await (await read()).json();
  assert.equal(first.saved, false);
  assert.match(first.templates.en.categories[0].name, /Welcome/);
  const design = defaultDesign();
  design.roles[0].name = 'Custom edited staff';
  assert.equal((await save({ guildId: ID, design })).status, 200);
  assert.equal(s.calls.length, 0);
  assert.equal((await (await read()).json()).design.roles[0].name, 'Custom edited staff');
  assert.equal(
    (await (await s.request('/api/design?guildId=999999999999999999')).json()).saved,
    false,
  );
  assert.equal((await save({ guildId: '../escape', design })).status, 400);
  assert.equal((await save({ guildId: ID, design: { ...design, roles: [] } })).status, 400);
  await s.action('preview', credentials);
  const out = path.join(s.sessionDir, 'out');
  fs.writeFileSync(path.join(out, 'preview.md'), 'Reviewed');
  fs.writeFileSync(path.join(out, 'plan.json'), JSON.stringify({ approvalHash: 'hash' }));
  s.calls[0].finish();
  await s.settled();
  assert.ok((await s.state()).preview);
  await save({ guildId: ID, design });
  assert.equal((await s.state()).preview, null);
  const root = path.dirname(s.sessionDir);
  await s.close();
  const restored = await createDesktopServer({ root });
  t.after(() => restored.close());
  const response = await fetch(`http://127.0.0.1:${restored.port}/api/design?guildId=${ID}`, {
    headers: { 'X-Cortex-Key': restored.key },
  });
  assert.equal((await response.json()).design.roles[0].name, 'Custom edited staff');
});

test('role grant bridge binds member and role to confirmation and demo cannot grant', async (t) => {
  const s = await setup(t),
    p = {
      guildId: ID,
      roleId: '555555555555555555',
      memberId: '888888888888888888',
      approvalHash: 'reviewed',
      administrator: true,
    },
    c = { ...p, confirmed: true, acknowledgeAdmin: true };
  assert.equal(
    (await s.action('role-grant-apply', { ...credentials, roleGrantConfirmation: c })).status,
    400,
  );
  await s.action('role-grant-preview', {
    ...credentials,
    roleGrantRequest: { roleId: p.roleId, memberId: p.memberId },
  });
  s.calls[0].output({ event: 'role-grant-preview', data: p });
  s.calls[0].finish();
  await s.settled();
  for (const change of [
    { memberId: '999999999999999999' },
    { roleId: '999999999999999999' },
    { acknowledgeAdmin: false },
    { confirmed: false },
  ])
    assert.equal(
      (
        await s.action('role-grant-apply', {
          ...credentials,
          roleGrantConfirmation: { ...c, ...change },
        })
      ).status,
      400,
    );
  assert.equal(
    (await s.action('role-grant-apply', { ...credentials, roleGrantConfirmation: c })).status,
    202,
  );
  assert.equal((await s.state()).roleGrantPreview, null);
  s.calls[1].finish();
  await s.settled();
  assert.equal(
    (await s.action('role-grant-apply', { ...credentials, roleGrantConfirmation: c })).status,
    400,
  );
  const demo = await setup(t, { demo: true });
  assert.equal((await demo.action('role-grant-apply', { roleGrantConfirmation: c })).status, 403);
});

test('language preference is authenticated, strictly validated, persists across launches and never starts a worker', async (t) => {
  const s = await setup(t),
    send = (value) =>
      s.request('/api/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
  assert.deepEqual(await (await s.request('/api/preferences')).json(), { language: 'ar' });
  assert.equal((await fetch(s.base + '/api/preferences')).status, 401);
  for (const value of [{ language: 'fr' }, { language: 'en', token: 'secret' }, [], null])
    assert.equal((await send(value)).status, 400);
  assert.equal(
    (
      await s.request('/api/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'x'.repeat(129),
      })
    ).status,
    413,
  );
  assert.equal((await send({ language: 'en' })).status, 200);
  assert.deepEqual(await (await s.request('/api/preferences')).json(), { language: 'en' });
  assert.equal(s.calls.length, 0);
  const root = path.dirname(s.sessionDir);
  await s.close();
  const restored = await createDesktopServer({
    root,
    runWorker: () => {
      throw new Error('Must not start Discord');
    },
  });
  t.after(() => restored.close());
  const response = await fetch(`http://127.0.0.1:${restored.port}/api/preferences`, {
    headers: { 'X-Cortex-Key': restored.key },
  });
  assert.deepEqual(await response.json(), { language: 'en' });
  const demo = await createDesktopServer({ root, demo: true });
  t.after(() => demo.close());
  const demoResponse = await fetch(`http://127.0.0.1:${demo.port}/api/preferences`, {
    headers: { 'X-Cortex-Key': demo.key },
  });
  assert.deepEqual(await demoResponse.json(), { language: 'ar' });
});

test('saved credentials restore privately without starting workers, support explicit save and forget', async (t) => {
  let saved = { ...credentials };
  const vault = {
    async load() {
      return saved;
    },
    async save(value) {
      saved = { ...value };
    },
    async forget() {
      saved = null;
    },
  };
  const s = await setup(t, { credentialStore: vault });
  let state = await s.state();
  assert.equal(state.credentialsSaved, true);
  assert.equal(state.hasCredentials, true);
  assert.equal(state.guildId, ID);
  assert.equal(s.calls.length, 0);
  assert.ok(!JSON.stringify(state).includes(credentials.token));
  assert.equal(
    (await s.action('credentials-save', { ...credentials, guildId: '777777777777777777' })).status,
    202,
  );
  assert.equal(saved.guildId, '777777777777777777');
  assert.equal(s.calls.length, 0);
  assert.equal((await s.state()).credentialsSaved, true);
  assert.equal((await s.action('credentials-forget')).status, 202);
  assert.equal(saved, null);
  state = await s.state();
  assert.equal(state.credentialsSaved, false);
  assert.equal(state.hasCredentials, true);
  assert.equal(s.calls.length, 0);
  assert.ok(!JSON.stringify(state).includes(credentials.token));
});

test('demo never reads or writes a credential vault, and unreadable saved data does not block manual entry', async (t) => {
  const vault = {
    async load() {
      throw new Error('unavailable');
    },
    async save() {
      throw new Error('must not save');
    },
    async forget() {},
  };
  const demo = await setup(t, { demo: true, credentialStore: vault });
  assert.equal((await demo.state()).error, null);
  for (const name of ['credentials-save', 'credentials-forget'])
    assert.equal((await demo.action(name, credentials)).status, 403);
  const s = await setup(t, { credentialStore: vault });
  assert.match((await s.state()).error, /تعذّرت قراءة/);
  assert.equal((await s.action('check', credentials)).status, 202);
  s.calls[0].output({ event: 'diagnostics', data: diagnostics(sample()) });
  s.calls[0].finish();
  assert.equal((await s.settled()).error, null);
});

test('credential save serializes with forget and shutdown to prevent a late save restoring forgotten data', async (t) => {
  let release,
    forgot = false;
  const vault = {
    async load() {
      return null;
    },
    save() {
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    async forget() {
      forgot = true;
    },
  };
  const s = await setup(t, { credentialStore: vault });
  const saving = s.action('credentials-save', credentials);
  for (let i = 0; i < 50 && !release; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(typeof release, 'function');
  assert.equal((await s.state()).busy, true);
  assert.equal((await s.action('credentials-forget')).status, 409);
  assert.equal((await s.action('shutdown')).status, 409);
  release();
  assert.equal((await saving).status, 202);
  assert.equal((await s.action('credentials-forget')).status, 202);
  assert.equal(forgot, true);
  assert.equal((await s.state()).credentialsSaved, false);
});

test('desktop HTTP bridge authenticates every API, rejects foreign origins/hosts and limits assets', async (t) => {
  const s = await setup(t);
  assert.equal((await fetch(s.base + '/api/state')).status, 401);
  assert.equal(
    (await s.request('/api/state', { headers: { 'X-Cortex-Key': 'é'.repeat(64) } })).status,
    401,
  );
  assert.equal(
    (await s.request('/api/state', { headers: { Origin: 'https://evil.example' } })).status,
    403,
  );
  assert.equal((await s.request('/api/state', { headers: { Origin: 'null' } })).status, 403);
  const wrongHost = await new Promise((resolve, reject) => {
    const request = http.request(
      s.base + '/api/state',
      { headers: { Host: 'evil.example', 'X-Cortex-Key': s.key } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    request.on('error', reject);
    request.end();
  });
  assert.equal(wrongHost, 403);
  const response = await s.request();
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await fetch(s.base + '/')).status, 200);
  for (const file of [
    '/src/desktop-server.mjs',
    '/api/report/settings.json',
    '/api/report/..%2Fsettings.json',
    '/.env',
  ])
    assert.equal((await s.request(file)).status, 404);
  assert.equal(s.calls.length, 0);
});

test('desktop bridge accepts only bounded JSON actions and never executes unknown operations', async (t) => {
  const s = await setup(t);
  assert.equal((await s.action('exec', { command: 'anything' })).status, 400);
  assert.equal((await s.request('/api/action', { method: 'POST', body: '{}' })).status, 415);
  assert.equal(
    (
      await s.request('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{broken',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await s.request('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ padding: 'a'.repeat(270000) }),
      })
    ).status,
    413,
  );
  assert.equal(s.calls.length, 0);
});

test('desktop operations serialize, redact secrets and keep Unicode worker input intact', async (t) => {
  const s = await setup(t);
  assert.equal((await s.state()).hasCredentials, false);
  assert.equal((await s.action('check', credentials)).status, 202);
  assert.equal((await s.state()).busy, true);
  assert.equal((await s.state()).hasCredentials, true);
  assert.equal((await s.action('preview', credentials)).status, 409);
  assert.equal((await s.action('shutdown')).status, 409);
  const first = s.calls[0];
  assert.equal(first.mode, 'check');
  assert.equal(first.config.token, credentials.token);
  first.output({
    event: 'diagnostics',
    data: { ...diagnostics(sample()), botName: credentials.token },
  });
  first.error('Worker refused ' + credentials.token);
  first.finish(1);
  const state = await s.settled(),
    serialized = JSON.stringify(state);
  assert.equal(state.connected, true);
  assert.equal(state.busy, false);
  assert.equal(state.hasCredentials, true);
  assert.ok(!serialized.includes(credentials.token));
  assert.ok(!('token' in state));
  assert.match(serialized, /محجوب/);
  const request = {
    kind: 'role',
    action: 'create',
    values: { name: '🎮・مجتمع الألعاب', color: 0x5865f2 },
  };
  assert.equal(
    (await s.action('edit-preview', { ...credentials, editRequest: request, extraPath: 'ignored' }))
      .status,
    202,
  );
  assert.deepEqual(s.calls[1].config.editRequest, request);
  assert.ok(!('extraPath' in s.calls[1].config));
  s.calls[1].finish();
  await s.settled();
  assert.equal((await s.action('inventory', { guildId: ID })).status, 202);
  assert.equal(s.calls[2].config.token, credentials.token);
  s.calls[2].finish();
  await s.settled();
});

test('rebuild requires exact confirmations and a successful preview from the same session/server', async (t) => {
  const s = await setup(t),
    confirm = { ...credentials, confirmGuildId: ID, confirmDelete: CONFIRMATION };
  assert.equal((await s.action('rebuild', credentials)).status, 400);
  assert.equal((await s.action('rebuild', confirm)).status, 409);
  assert.equal(s.calls.length, 0);
  assert.equal((await s.action('preview', credentials)).status, 202);
  const out = path.join(s.sessionDir, 'out');
  fs.writeFileSync(path.join(out, 'preview.md'), 'Reviewed deletion and creation report');
  fs.writeFileSync(
    path.join(out, 'plan.json'),
    JSON.stringify({ approvalHash: 'reviewed-hash', totals: { deleteRoles: 1 } }),
  );
  s.calls[0].finish();
  const state = await s.settled();
  assert.equal(state.preview.ready, true);
  assert.equal((await s.action('rebuild', { ...confirm, confirmDelete: 'DELETE' })).status, 400);
  assert.equal((await s.action('rebuild', confirm)).status, 202);
  assert.equal(s.calls.length, 2);
  assert.equal(s.calls[1].mode, 'rebuild');
  assert.equal(s.calls[1].config.confirmDelete, CONFIRMATION);
  s.calls[1].finish();
  await s.settled();
  assert.equal((await s.action('rebuild', confirm)).status, 409);
});

test('edit apply requires the exact reviewed hash and explicit confirmation, then invalidates inventory', async (t) => {
  const s = await setup(t),
    confirmation = { confirmed: true, guildId: ID, approvalHash: 'reviewed-edit' };
  assert.equal(
    (await s.action('edit-apply', { ...credentials, editConfirmation: confirmation })).status,
    400,
  );
  await s.action('check', credentials);
  s.calls[0].output({ event: 'diagnostics', data: diagnostics(sample()) });
  s.calls[0].finish();
  await s.settled();
  await s.action('edit-preview', {
    ...credentials,
    editRequest: { kind: 'role', action: 'create', values: { name: '🎮・أعضاء' } },
  });
  s.calls[1].output({
    event: 'edit-preview',
    data: { approvalHash: confirmation.approvalHash, summary: 'تعديل للمراجعة', changes: [] },
  });
  s.calls[1].finish();
  await s.settled();
  assert.equal(
    (
      await s.action('edit-apply', {
        ...credentials,
        editConfirmation: { ...confirmation, confirmed: false },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await s.action('edit-apply', {
        ...credentials,
        editConfirmation: { ...confirmation, approvalHash: 'other' },
      })
    ).status,
    400,
  );
  assert.equal(
    (await s.action('edit-apply', { ...credentials, editConfirmation: confirmation })).status,
    202,
  );
  s.calls[2].output({ event: 'edit-applied', data: { success: true } });
  s.calls[2].finish();
  const state = await s.settled();
  assert.equal(state.editPreview, null);
  assert.equal(state.diagnostics, null);
  assert.equal(state.connected, false);
});

test('reports are complete beyond 16 KB, authenticated and returned without double JSON encoding', async (t) => {
  const s = await setup(t),
    large = 'قنوات ورتب كاملة 🎮\n'.repeat(2200),
    data = { report: large };
  const output = path.join(s.sessionDir, 'out');
  fs.writeFileSync(path.join(output, 'preview.md'), large);
  fs.writeFileSync(path.join(output, 'plan.json'), JSON.stringify(data));
  const markdown = await s.request('/api/report/preview.md');
  assert.equal(await markdown.text(), large);
  assert.match(markdown.headers.get('content-disposition'), /preview.md/);
  assert.deepEqual(await (await s.request('/api/report/plan.json')).json(), data);
  assert.equal((await fetch(s.base + '/api/report/preview.md')).status, 401);
  assert.equal((await s.state()).reports.files.length, 2);
});

test('presence worker can be stopped independently and service close stops its own children', async (t) => {
  const s = await setup(t);
  await s.action('online', credentials);
  assert.equal(s.calls[0].mode, 'online');
  assert.equal((await s.state()).busy, false);
  s.calls[0].output({ event: 'presence', status: 'online', message: 'جاهز' });
  assert.equal((await s.state()).online, true);
  assert.equal((await s.action('online', credentials)).status, 409);
  await s.action('check', credentials);
  assert.equal(s.calls.length, 2);
  await s.action('stop');
  assert.equal(s.calls[0].stopped, true);
  assert.equal(s.calls[1].stopped, false);
  await s.close();
  assert.equal(s.calls[1].stopped, true);
});

test('bot uptime starts on ready, survives reconnect and inventory reads, resets on stop and rejects stale presence', async (t) => {
  const s = await setup(t);
  assert.equal((await s.state()).presenceStartedAt, null);
  await s.action('online', credentials);
  assert.equal((await s.state()).presenceStartedAt, null);
  const before = Date.now();
  s.calls[0].output({ event: 'presence', status: 'online' });
  const started = (await s.state()).presenceStartedAt;
  assert.ok(started >= before && started <= Date.now());
  s.calls[0].output({ event: 'presence', status: 'reconnecting' });
  assert.equal((await s.state()).presenceStartedAt, started);
  s.calls[0].output({ event: 'presence', status: 'online' });
  assert.equal((await s.state()).presenceStartedAt, started);
  await s.action('inventory', credentials);
  s.calls[1].output({ event: 'diagnostics', data: diagnostics(sample()) });
  s.calls[1].finish();
  await s.settled();
  assert.equal((await s.state()).presenceStartedAt, started);
  await s.action('stop');
  assert.equal((await s.state()).presenceStartedAt, null);
  s.calls[0].output({ event: 'presence', status: 'online' });
  assert.equal((await s.state()).presenceStartedAt, null);
  await s.action('online', credentials);
  assert.equal((await s.state()).presenceStartedAt, null);
  s.calls[2].output({ event: 'presence', status: 'online' });
  assert.ok((await s.state()).presenceStartedAt >= started);
  s.calls[2].finish(1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal((await s.state()).presenceStartedAt, null);
});

test('combined connect loads the server before starting presence and reuses an existing connection', async (t) => {
  const s = await setup(t);
  assert.equal((await s.action('connect', credentials)).status, 202);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].mode, 'inventory');
  s.calls[0].output({ event: 'diagnostics', data: diagnostics(sample()) });
  s.calls[0].finish();
  await s.settled();
  assert.equal(s.calls.length, 2);
  assert.equal(s.calls[1].mode, 'online');
  assert.equal((await s.state()).presenceActive, true);
  s.calls[1].output({ event: 'presence', status: 'online', message: 'Connected' });
  await s.action('connect', credentials);
  assert.equal(s.calls[2].mode, 'inventory');
  s.calls[2].output({ event: 'diagnostics', data: diagnostics(sample()) });
  s.calls[2].finish();
  await s.settled();
  assert.equal(s.calls.length, 3);
  assert.equal((await s.state()).online, true);
});

test('combined connect never starts presence after failed inventory or an explicit stop', async (t) => {
  const s = await setup(t);
  await s.action('connect', credentials);
  s.calls[0].error('Inventory refused');
  s.calls[0].finish(1);
  await s.settled();
  assert.equal(s.calls.length, 1);
  await s.action('connect', credentials);
  await s.action('stop');
  s.calls[1].output({ event: 'diagnostics', data: diagnostics(sample()) });
  s.calls[1].finish();
  await s.settled();
  assert.equal(s.calls.length, 2);
  assert.equal((await s.state()).presenceActive, false);
});

test('explicit demo has rich Arabic inventory and refuses every real connection or mutation', async (t) => {
  const s = await setup(t, { demo: true }),
    state = await s.state();
  assert.equal(state.demo, true);
  assert.equal(state.online, false);
  assert.ok(state.inventory.channels.length > 30);
  assert.ok(state.inventory.roles.some((r) => r.name.includes('🎮')));
  assert.ok(
    state.inventory.roles.filter((r) => r.name.includes('OWNER')).every((r) => r.readOnlyReason),
  );
  for (const action of ['online', 'edit-apply', 'rebuild', 'message-send'])
    assert.equal((await s.action(action, credentials)).status, 403);
  assert.equal((await s.action('inventory')).status, 202);
  assert.equal((await s.action('preview')).status, 202);
  assert.equal((await s.state()).preview.ready, false);
  assert.equal(s.calls.length, 0);
  assert.ok(desktopDemoSnapshot().guild.rules_channel_id);
});

test('message sending requires an exact reviewed destination and confirmation and consumes approval', async (t) => {
  const s = await setup(t);
  assert.equal(
    (
      await s.action('message-send', {
        ...credentials,
        messageConfirmation: {
          confirmed: true,
          guildId: ID,
          channelId: '777777777777777777',
          approvalHash: 'hash',
        },
      })
    ).status,
    400,
  );
  await s.action('message-preview', {
    ...credentials,
    messageRequest: { channelId: '777777777777777777', content: 'Hello' },
  });
  s.calls[0].output({
    event: 'message-preview',
    data: { approvalHash: 'hash', channelId: '777777777777777777', content: 'Hello' },
  });
  s.calls[0].finish();
  await s.settled();
  assert.equal(
    (
      await s.action('message-send', {
        messageConfirmation: {
          confirmed: true,
          guildId: ID,
          channelId: '666666666666666666',
          approvalHash: 'hash',
        },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await s.action('message-send', {
        messageConfirmation: {
          confirmed: true,
          guildId: ID,
          channelId: '777777777777777777',
          approvalHash: 'hash',
        },
      })
    ).status,
    202,
  );
  assert.equal(s.calls[1].mode, 'message-send');
  s.calls[1].output({
    event: 'message-sent',
    data: { success: true, channelId: '777777777777777777', messageId: '999999999999999999' },
  });
  s.calls[1].finish();
  await s.settled();
  assert.equal(
    (
      await s.action('message-send', {
        messageConfirmation: {
          confirmed: true,
          guildId: ID,
          channelId: '777777777777777777',
          approvalHash: 'hash',
        },
      })
    ).status,
    400,
  );
});

test('HTTP bridge drives the real worker over stdin with mocked GET-only Discord for inventory and full preview', async (t) => {
  const repo = fileURLToPath(new URL('../', import.meta.url));
  const s = await setup(t, {
    runWorker: (mode, config, options) =>
      spawnDesktopWorker(mode, config, { ...options, root: repo }),
  });
  const mock = path.join(s.sessionDir, 'http-mock-fetch.mjs'),
    requests = path.join(s.sessionDir, 'requests.jsonl'),
    helper = new URL('./helpers/fake.mjs', import.meta.url).href;
  fs.writeFileSync(
    mock,
    `import fs from 'node:fs';import {sample,fakeServer} from ${JSON.stringify(helper)};
    const server=fakeServer(sample());globalThis.fetch=async(url,options)=>{if(options.method!=='GET')throw new Error('HTTP test forbids Discord writes');
    fs.appendFileSync(${JSON.stringify(requests)},JSON.stringify({method:options.method,url})+'\\n');const u=new URL(url);
    return new Response(JSON.stringify(await server.api.get(u.pathname.replace('/api/v10','')+u.search)));};`,
  );
  const prior = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = `--import=${pathToFileURL(mock).href}`;
  t.after(() => {
    if (prior === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = prior;
  });
  assert.equal((await s.action('inventory', credentials)).status, 202);
  const inventory = await s.settled();
  assert.equal(inventory.diagnostics.guildId, ID);
  assert.ok(inventory.inventory.channels.length > 0);
  assert.equal(inventory.inventory.memberStatistics.total, 3);
  assert.equal(inventory.inventory.roles.find((r) => r.name === '★ OWNER ★').memberCount, 1);
  const design = defaultDesign();
  design.roles[0].name = 'Custom reviewed administrator';
  design.categories[0].channels[0].name = 'custom-reviewed-welcome';
  assert.equal((await s.action('preview', { ...credentials, design })).status, 202);
  const state = await s.settled();
  assert.equal(state.preview.ready, true);
  assert.match(state.preview.summary, /PERMANENTLY DELETE/);
  assert.ok(state.reports.files.some((file) => file.name === 'approval.json'));
  assert.equal(state.preview.plan.design.roles[0].name, design.roles[0].name);
  assert.match(state.preview.summary, /custom-reviewed-welcome/);
  const reviewed = JSON.parse(
    fs.readFileSync(path.join(s.sessionDir, 'out', 'design.json'), 'utf8'),
  );
  assert.equal(reviewed.categories[0].channels[0].name, 'custom-reviewed-welcome');
  design.roles[0].color++;
  const changed = await s.action('rebuild', {
    ...credentials,
    design,
    confirmGuildId: ID,
    confirmDelete: CONFIRMATION,
  });
  assert.equal(changed.status, 400);
  assert.match((await changed.json()).error, /تغيّر القالب/);
  const calls = fs.readFileSync(requests, 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(calls.length > 10);
  assert.ok(calls.every((call) => call.method === 'GET'));
  assert.ok(!JSON.stringify(state).includes(credentials.token));
});

test('reviewing any edit invalidates a previous rebuild approval', async (t) => {
  const s = await setup(t);
  await s.action('preview', credentials);
  const out = path.join(s.sessionDir, 'out');
  fs.writeFileSync(path.join(out, 'preview.md'), 'Full reviewed report');
  fs.writeFileSync(path.join(out, 'plan.json'), JSON.stringify({ approvalHash: 'hash' }));
  s.calls[0].finish();
  assert.equal((await s.settled()).preview.ready, true);
  await s.action('edit-preview', {
    ...credentials,
    editRequest: { kind: 'role', action: 'create', values: { name: '🎮・أعضاء' } },
  });
  assert.equal((await s.state()).preview, null);
  s.calls[1].finish();
  await s.settled();
  assert.equal(
    (await s.action('rebuild', { ...credentials, confirmGuildId: ID, confirmDelete: CONFIRMATION }))
      .status,
    409,
  );
});

test('real worker lists role members and reviews grant/removal using only exact mocked role assignment endpoints', async (t) => {
  const repo = fileURLToPath(new URL('../', import.meta.url)),
    s = await setup(t, {
      runWorker: (mode, config, options) =>
        spawnDesktopWorker(mode, config, { ...options, root: repo }),
    });
  const mock = path.join(s.sessionDir, 'grant-mock.mjs'),
    calls = path.join(s.sessionDir, 'grant-calls.jsonl');
  fs.writeFileSync(
    mock,
    `import fs from 'node:fs';import {sample,fakeServer} from ${JSON.stringify(new URL('./helpers/fake.mjs', import.meta.url).href)};
 const storage=${JSON.stringify(path.join(s.sessionDir, 'member-state.json'))};const server=fakeServer(fs.existsSync(storage)?JSON.parse(fs.readFileSync(storage,'utf8')):sample());globalThis.fetch=async(url,options)=>{const parsed=new URL(url),route=parsed.pathname.replace('/api/v10','')+parsed.search;let result;
 if(options.method==='GET')result=await server.api.get(route);else {if(!['PUT','DELETE'].includes(options.method))throw new Error('Only role assignment operations allowed');fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({method:options.method,route})+'\\n');result=await server.api.call(options.method,route);fs.writeFileSync(storage,JSON.stringify(server.state));}
 return result===null?new Response(null,{status:204}):new Response(JSON.stringify(result));};`,
  );
  const prior = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = `--import=${pathToFileURL(mock).href}`;
  t.after(() => {
    if (prior === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = prior;
  });
  const roleId = '555555555555555555',
    memberId = '888888888888888888';
  await s.action('role-grant-preview', { ...credentials, roleGrantRequest: { roleId, memberId } });
  const preview = await s.settled();
  assert.equal(preview.error, null);
  assert.equal(fs.existsSync(calls), false);
  assert.equal(preview.roleGrantPreview.memberId, memberId);
  await s.action('role-grant-apply', {
    ...credentials,
    roleGrantConfirmation: {
      confirmed: true,
      guildId: ID,
      roleId,
      memberId,
      approvalHash: preview.roleGrantPreview.approvalHash,
    },
  });
  const result = await s.settled();
  assert.equal(result.error, null);
  assert.equal(result.result.success, true);
  assert.deepEqual(fs.readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse), [
    { method: 'PUT', route: `/guilds/${ID}/members/${memberId}/roles/${roleId}` },
  ]);
  await s.action('role-members', { ...credentials, roleMembersRequest: { roleId, after: '0' } });
  const roster = await s.settled();
  assert.equal(roster.error, null);
  assert.ok(roster.roleMembers.members.some((m) => m.id === memberId));
  await s.action('role-grant-preview', {
    ...credentials,
    roleGrantRequest: { roleId, memberId, operation: 'remove' },
  });
  const removal = await s.settled();
  assert.equal(removal.error, null);
  await s.action('role-grant-apply', {
    ...credentials,
    roleGrantConfirmation: {
      confirmed: true,
      guildId: ID,
      roleId,
      memberId,
      operation: 'remove',
      approvalHash: removal.roleGrantPreview.approvalHash,
    },
  });
  const removed = await s.settled();
  assert.equal(removed.error, null);
  assert.equal(removed.result.status, 'removed');
  const lines = fs.readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[1], {
    method: 'DELETE',
    route: '/guilds/' + ID + '/members/' + memberId + '/roles/' + roleId,
  });
  const persisted = JSON.parse(
    fs.readFileSync(path.join(s.sessionDir, 'member-state.json'), 'utf8'),
  );
  assert.deepEqual(persisted.members.find((m) => m.id === memberId).roles, []);
});

test('real worker can review, confirm and save role and voice edits, then create a channel over HTTP', async (t) => {
  const repo = fileURLToPath(new URL('../', import.meta.url));
  const s = await setup(t, {
    runWorker: (mode, config, options) =>
      spawnDesktopWorker(mode, config, { ...options, root: repo }),
  });
  const mock = path.join(s.sessionDir, 'edit-mock.mjs'),
    dataFile = path.join(s.sessionDir, 'discord-mock.json'),
    requests = path.join(s.sessionDir, 'edit-requests.jsonl');
  const initial = sample();
  initial.guild.features = ['COMMUNITY', 'SOUNDBOARD'];
  initial.channels[1].type = 2;
  initial.channels[1].user_limit = 5;
  fs.writeFileSync(dataFile, JSON.stringify(initial));
  fs.writeFileSync(
    mock,
    `import fs from 'node:fs';import {fakeServer} from ${JSON.stringify(new URL('./helpers/fake.mjs', import.meta.url).href)};
    const file=${JSON.stringify(dataFile)},requests=${JSON.stringify(requests)},server=fakeServer(JSON.parse(fs.readFileSync(file)));
    globalThis.fetch=async(url,options)=>{const u=new URL(url),route=u.pathname.replace('/api/v10','')+u.search;
      fs.appendFileSync(requests,JSON.stringify({method:options.method,route})+'\\n');
      let result;if(options.method==='GET'){result=await server.api.get(route);if(Array.isArray(result))result.reverse();if(result?.features&&fs.readFileSync(requests,'utf8').split('\\n').length%2)result.features.reverse();}
      else {if(!['POST','PATCH'].includes(options.method))throw new Error('Forbidden mock mutation');result=await server.api.call(options.method,route,JSON.parse(options.body));fs.writeFileSync(file,JSON.stringify(server.state));}
      return new Response(JSON.stringify(result));};`,
  );
  const prior = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = `--import=${pathToFileURL(mock).href}`;
  t.after(() => {
    if (prior === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = prior;
  });
  const load = async () => {
    assert.equal((await s.action('inventory', credentials)).status, 202);
    const state = await s.settled();
    assert.equal(state.error, null);
    return state.inventory;
  };
  const save = async (editRequest) => {
    assert.equal((await s.action('edit-preview', { ...credentials, editRequest })).status, 202);
    const review = await s.settled();
    assert.equal(review.error, null);
    assert.ok(review.editPreview.approvalHash);
    assert.equal(
      (
        await s.action('edit-apply', {
          ...credentials,
          editConfirmation: {
            confirmed: true,
            guildId: ID,
            approvalHash: review.editPreview.approvalHash,
          },
        })
      ).status,
      202,
    );
    const applied = await s.settled();
    assert.equal(applied.error, null);
    assert.equal(applied.result.success, true);
  };
  let inv = await load(),
    role = inv.roles.find((r) => r.name === 'legacy');
  await save({
    kind: 'role',
    action: 'update',
    id: role.id,
    revision: role.revision,
    values: { name: '🎮・لاعب محترف', color: 0xa78bfa },
    permissionChanges: { SendMessages: true },
  });
  inv = await load();
  assert.equal(inv.roles.find((r) => r.id === role.id).color, 0xa78bfa);
  const voice = inv.channels.find((c) => c.type === 2);
  await save({
    kind: 'channel',
    action: 'update',
    id: voice.id,
    revision: voice.revision,
    values: { name: '☕・استراحة', user_limit: 15 },
  });
  inv = await load();
  assert.equal(inv.channels.find((c) => c.id === voice.id).user_limit, 15);
  await save({
    kind: 'channel',
    action: 'create',
    values: { name: '💬・دردشة جديدة', type: 0, parent_id: initial.channels[0].id },
  });
  inv = await load();
  assert.ok(inv.channels.some((c) => c.name === '💬・دردشة جديدة'));
  const writes = fs
    .readFileSync(requests, 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse)
    .filter((r) => r.method !== 'GET');
  assert.deepEqual(
    writes.map((r) => r.method),
    ['PATCH', 'PATCH', 'POST'],
  );
  const destination = inv.channels.find((c) => c.type === 0);
  const embeds = [
    { title: '📜 قوانين المجتمع', description: 'احترم الجميع', color: 9274367 },
    { title: '📜 Community Rules', description: 'Respect everyone', color: 5025616 },
  ];
  assert.equal(
    (
      await s.action('message-preview', {
        messageRequest: { channelId: destination.id, content: '🎮 أهلًا بأعضاء المجتمع', embeds },
      })
    ).status,
    202,
  );
  const message = await s.settled();
  assert.equal(message.error, null);
  assert.equal(message.messagePreview.content, '🎮 أهلًا بأعضاء المجتمع');
  assert.deepEqual(message.messagePreview.embeds, embeds);
  assert.equal(
    (
      await s.action('message-send', {
        messageConfirmation: {
          confirmed: true,
          guildId: ID,
          channelId: destination.id,
          approvalHash: message.messagePreview.approvalHash,
        },
      })
    ).status,
    202,
  );
  const sent = await s.settled();
  assert.equal(sent.error, null);
  assert.equal(sent.messageResult.success, true);
  const allWrites = fs
    .readFileSync(requests, 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse)
    .filter((r) => r.method !== 'GET');
  assert.deepEqual(allWrites.at(-1), {
    method: 'POST',
    route: `/channels/${destination.id}/messages`,
  });
  assert.equal(allWrites.length, 4);
  await save({ kind: 'channel', action: 'create', values: { name: 'Move destination', type: 4 } });
  inv = await load();
  const moveCategory = inv.channels.find((c) => c.name === 'Move destination'),
    moveVoice = inv.channels.find((c) => c.id === voice.id);
  await save({
    kind: 'channel',
    action: 'move',
    id: moveVoice.id,
    revision: moveVoice.revision,
    values: { target_id: moveCategory.id, placement: 'inside' },
  });
  inv = await load();
  assert.equal(inv.channels.find((c) => c.id === voice.id).parent_id, moveCategory.id);
  const moveWrite = fs
    .readFileSync(requests, 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse)
    .filter((r) => r.method !== 'GET')
    .at(-1);
  assert.deepEqual(moveWrite, { method: 'PATCH', route: `/guilds/${ID}/channels` });
  const batchRole = inv.roles.find((r) => r.id === role.id),
    batchChannel = inv.channels.find((c) => c.id === voice.id);
  const batchRequests = [
    {
      kind: 'role',
      action: 'update',
      id: batchRole.id,
      revision: batchRole.revision,
      values: { name: 'Batch role' },
      permissionChanges: {},
    },
    {
      kind: 'channel',
      action: 'update',
      id: batchChannel.id,
      revision: batchChannel.revision,
      values: { user_limit: 12 },
      overwriteChanges: [],
    },
  ];
  assert.equal((await s.action('batch-preview', { batchRequests })).status, 202);
  const batch = await s.settled();
  assert.equal(batch.error, null);
  assert.equal(batch.batchPreview.count, 2);
  assert.equal(
    (
      await s.action('batch-apply', {
        batchConfirmation: {
          guildId: ID,
          confirmed: true,
          approvalHash: batch.batchPreview.approvalHash,
        },
      })
    ).status,
    202,
  );
  const batchResult = await s.settled();
  assert.equal(batchResult.error, null);
  assert.equal(batchResult.batchResult.success, true);
  assert.equal(batchResult.batchResult.completed.length, 2);
  assert.equal(
    (
      await s.action('permission-simulate', {
        simulationRequest: { channelId: voice.id, memberId: '888888888888888888' },
      })
    ).status,
    202,
  );
  const simulation = await s.settled();
  assert.equal(simulation.error, null);
  assert.equal(simulation.simulation.memberId, '888888888888888888');
  assert.ok(simulation.simulation.results.length > 0);
});

test('server without a loaded client exits after its startup grace period', async (t) => {
  const s = await setup(t, { startupTimeoutMs: 40 });
  await Promise.race([
    s.done,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Startup timeout failed')), 1000)),
  ]);
  assert.equal(s.server.listening, false);
  assert.equal(s.calls.length, 0);
});

test('a new presence session cannot race a previous session stopping', async (t) => {
  let finishStop,
    finishWorker,
    calls = 0;
  const s = await setup(t, {
    runWorker() {
      calls++;
      return {
        completion: new Promise((resolve) => {
          finishWorker = resolve;
        }),
        stop() {
          return new Promise((resolve) => {
            finishStop = () => {
              finishWorker({ code: 0 });
              resolve();
            };
          });
        },
      };
    },
  });
  await s.action('online', credentials);
  const stopping = s.action('stop');
  for (let i = 0; i < 30 && !finishStop; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(typeof finishStop, 'function');
  assert.equal((await s.action('online', credentials)).status, 409);
  assert.equal(calls, 1);
  finishStop();
  assert.equal((await stopping).status, 202);
  assert.equal((await s.state()).online, false);
});

test('authenticated YouTube handle validation resolves without persisting sources or starting Discord workers', async (t) => {
  const id = 'UC2kbSW84Vq-ytyAxlynZjog';
  let calls = 0;
  const s = await setup(t, {
    socialFetch: async () => {
      calls++;
      return new Response(
        '<head><link type="application/rss+xml" href="https://www.youtube.com/feeds/videos.xml?channel_id=' +
          id +
          '"></head>',
      );
    },
  });
  const body = {
    version: 1,
    feeds: [
      {
        id: 'yt',
        guildId: ID,
        channelId: '777777777777777777',
        platform: 'youtube',
        source: 'https://www.youtube.com/@Luffy-Gaming-JO',
        enabled: true,
        language: 'en',
      },
    ],
  };
  const request = () => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal((await fetch(s.base + '/api/social/validate', request())).status, 401);
  assert.equal(calls, 0);
  const response = await s.request('/api/social/validate', request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).config.feeds[0].source, id);
  assert.equal(calls, 1);
  assert.equal(s.calls.length, 0);
  assert.equal((await (await s.request('/api/social')).json()).config.feeds.length, 0);
});

test('welcome routes authenticate, enforce consent and revisions, isolate demo and include saved settings in export', async (t) => {
  const s = await setup(t),
    first = await (await s.request('/api/welcome')).json();
  assert.equal((await fetch(s.base + '/api/welcome')).status, 401);
  const { welcomeDefaults } = await import('../src/welcome-config.mjs');
  const guild = welcomeDefaults(ID);
  guild.join.enabled = true;
  guild.join.channelId = '777777777777777777';
  const body = { config: { version: 1, guilds: [guild] }, baseRevision: first.revision };
  const post = (value) =>
    s.request('/api/welcome', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
  assert.equal((await post(body)).status, 400);
  const saved = await post({ ...body, confirmAutomatic: true });
  assert.equal(saved.status, 200);
  assert.equal((await post({ ...body, confirmAutomatic: true })).status, 409);
  assert.equal(s.calls.length, 0);
  const demo = await setup(t, { demo: true });
  assert.equal((await (await demo.request('/api/welcome')).json()).config.guilds.length, 0);
});

test('welcome image preview is authenticated, validates settings and renders without workers or Discord writes', async (t) => {
  const s = await setup(t),
    { welcomeDefaults } = await import('../src/welcome-config.mjs'),
    settings = welcomeDefaults(ID).join;
  settings.card = {
    mode: 'image',
    background: 'storm',
    titleColor: '#ffffff',
    textColor: '#e4e9f4',
    overlay: 0.66,
  };
  const body = { settings, server: 'Test Server', language: 'ar' },
    options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    };
  assert.equal((await fetch(s.base + '/api/welcome/preview', options)).status, 401);
  const result = await s.request('/api/welcome/preview', options);
  assert.equal(result.status, 200);
  const image = await result.json();
  assert.equal(image.type, 'image/png');
  assert.equal(
    Buffer.from(image.data, 'base64').subarray(0, 8).toString('hex'),
    '89504e470d0a1a0a',
  );
  assert.equal(s.calls.length, 0);
  settings.card.background = 'https://evil.test';
  assert.equal(
    (await s.request('/api/welcome/preview', { ...options, body: JSON.stringify(body) })).status,
    400,
  );
});

test('welcome asset routes authenticate uploads, isolate server libraries and block deleting saved backgrounds', async (t) => {
  const s = await setup(t),
    { createCanvas } = await import('@napi-rs/canvas'),
    { welcomeDefaults } = await import('../src/welcome-config.mjs');
  const c = createCanvas(10, 10),
    ctx = c.getContext('2d');
  ctx.fillStyle = '#336699';
  ctx.fillRect(0, 0, 10, 10);
  const url = '/api/welcome/assets?guildId=' + ID,
    body = {
      guildId: ID,
      name: 'Custom picture.png',
      data: (await c.encode('png')).toString('base64'),
    },
    options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    };
  assert.equal((await fetch(s.base + url, options)).status, 401);
  const result = await s.request(url, options);
  assert.equal(result.status, 200);
  const uploaded = await result.json();
  assert.equal(uploaded.assets.length, 1);
  assert.equal(
    (await (await s.request('/api/welcome/assets?guildId=999999999999999999')).json()).assets
      .length,
    0,
  );
  const first = await (await s.request('/api/welcome')).json(),
    g = welcomeDefaults(ID);
  g.join.card = {
    mode: 'image',
    background: uploaded.asset.id,
    titleColor: '#ffffff',
    textColor: '#ffffff',
    overlay: 0.66,
  };
  const save = await s.request('/api/welcome', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseRevision: first.revision,
      config: { version: 1, guilds: [g] },
      confirmAutomatic: true,
    }),
  });
  assert.equal(save.status, 200);
  assert.equal(
    (
      await s.request(url, {
        ...options,
        method: 'DELETE',
        body: JSON.stringify({ guildId: ID, id: uploaded.asset.id }),
      })
    ).status,
    400,
  );
  const preview = await s.request('/api/welcome/preview', {
    ...options,
    body: JSON.stringify({
      settings: g.join,
      guildId: ID,
      language: 'en',
      server: '𝘈𝘣𝘰 𝘈𝘭𝘶𝘧 𝘚𝘦𝘳𝘷𝘦𝘳',
    }),
  });
  assert.equal(preview.status, 200);
  assert.equal(s.calls.length, 0);
});

test('language catalogs load from the fixed static allowlist without starting workers', async (t) => {
  const s = await setup(t),
    directory = path.join(s.root, 'desktop/web/locales');
  fs.mkdirSync(directory, { recursive: true });
  const html = fs.readFileSync(new URL('../desktop/web/index.html', import.meta.url), 'utf8');
  for (const name of ['ar.js', 'en.js', 'patterns.js']) {
    const source = fs.readFileSync(
      new URL('../desktop/web/locales/' + name, import.meta.url),
      'utf8',
    );
    fs.writeFileSync(path.join(directory, name), source);
    const response = await s.request('/locales/' + name);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /javascript/);
    assert.equal(await response.text(), source);
    assert.ok(html.indexOf('./locales/' + name) < html.indexOf('./i18n.js'));
  }
  const roleSource = fs.readFileSync(
    new URL('../desktop/web/role-translation.js', import.meta.url),
    'utf8',
  );
  fs.writeFileSync(path.join(s.root, 'desktop/web/role-translation.js'), roleSource);
  const roleResponse = await s.request('/role-translation.js');
  assert.equal(roleResponse.status, 200);
  assert.equal(await roleResponse.text(), roleSource);
  assert.equal((await s.request('/locales/unknown.js')).status, 404);
  assert.equal(s.calls.length, 0);
});

test('member roster is read-only and removal approval cannot be changed into a grant or reused', async (t) => {
  const s = await setup(t),
    credentials = { token: 'test-secret', guildId: ID };
  const roleId = '555555555555555555',
    memberId = '888888888888888888';
  await s.action('role-members', { ...credentials, roleMembersRequest: { roleId, after: '0' } });
  assert.equal(s.calls[0].mode, 'role-members');
  assert.equal(s.calls[0].config.roleMembersRequest.after, '0');
  s.calls[0].output({
    event: 'role-members',
    data: {
      guildId: ID,
      roleId,
      after: '0',
      next: null,
      members: [{ id: memberId, name: 'Alex', removable: true }],
    },
  });
  s.calls[0].finish();
  await s.settled();
  assert.equal((await s.state()).roleMembers.members[0].name, 'Alex');
  await s.action('role-grant-preview', {
    ...credentials,
    roleGrantRequest: { roleId, memberId, operation: 'remove' },
  });
  const plan = {
    guildId: ID,
    roleId,
    memberId,
    operation: 'remove',
    approvalHash: 'remove-reviewed',
    administrator: false,
  };
  s.calls[1].output({ event: 'role-grant-preview', data: plan });
  s.calls[1].finish();
  await s.settled();
  for (const operation of ['grant', undefined])
    assert.equal(
      (
        await s.action('role-grant-apply', {
          ...credentials,
          roleGrantConfirmation: { ...plan, operation, confirmed: true },
        })
      ).status,
      400,
    );
  const confirmation = { ...plan, confirmed: true };
  assert.equal(
    (await s.action('role-grant-apply', { ...credentials, roleGrantConfirmation: confirmation }))
      .status,
    202,
  );
  assert.equal(s.calls[2].config.roleGrantConfirmation.operation, 'remove');
  s.calls[2].finish();
  await s.settled();
  assert.equal(
    (await s.action('role-grant-apply', { ...credentials, roleGrantConfirmation: confirmation }))
      .status,
    400,
  );
  const demo = await setup(t, { demo: true });
  assert.equal(
    (await demo.action('role-grant-apply', { roleGrantConfirmation: confirmation })).status,
    403,
  );
});
