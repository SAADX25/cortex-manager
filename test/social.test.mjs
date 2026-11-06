import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import {
  validateSocial,
  sourceId,
  mediaURL,
  manualSocialMessage,
  createSocialStore,
} from '../src/social-config.mjs';
import {
  youtubeItems,
  createSocialProviders,
  boundedFetch,
  ProviderError,
} from '../src/social-providers.mjs';
import { createSocialEngine } from '../src/social-engine.mjs';
import { hostedPackage, HOSTED_FILES } from '../src/social-package.mjs';
import {
  startHostedBot,
  hostedStartupDiagnostic,
  installHostedShutdown,
} from '../src/hosted-bot.mjs';
import { P } from '../src/permissions.mjs';
import { instagramRSSURL, instagramRSSItems } from '../src/instagram-rss.mjs';
import { sample, fakeServer, ID, BOT_ROLE } from './helpers/fake.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)),
  channelId = '777777777777777777',
  channel = 'UC' + 'a'.repeat(22);
const feed = (extra = {}) => ({
  id: 'source-1',
  guildId: ID,
  channelId,
  platform: 'youtube',
  source: channel,
  enabled: true,
  language: 'ar',
  ...extra,
});
const config = (feeds = [feed()]) => ({ version: 1, feeds });
function temp(t) {
  const base = path.resolve(os.tmpdir()),
    dir = fs.mkdtempSync(path.join(base, 'cortex-social-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), base);
    assert.match(path.basename(dir), /^cortex-social-/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
const item = (id, time) => ({
  id,
  title: 'hello @everyone <@123> **bold**',
  published: new Date(time).toISOString(),
  url: 'https://youtube.com/watch?v=abcdefghijk',
});
function harness(t, options = {}) {
  const dir = temp(t),
    server = fakeServer(sample()),
    api = { ...server.api, post: (p, b) => server.api.call('POST', p, b) };
  let now = Date.parse('2026-10-30T10:00:00Z'),
    items = [item('old', now - 1000)];
  const statuses = [],
    stateFile = path.join(dir, 'data.json');
  const make = () =>
    createSocialEngine({
      api,
      fetchItems: async () => items,
      stateFile,
      now: () => now,
      onStatus: (s) => statuses.push(s),
      ...options,
    });
  return {
    dir,
    server,
    api,
    statuses,
    stateFile,
    make,
    advance: () => {
      now += 120001;
    },
    newItem: (id) => {
      items.push(item(id, now - 1));
    },
    setItems: (value) => {
      items = value;
    },
  };
}
test('social configuration canonicalizes official sources, rejects duplicates, secrets, traversal and unknown platforms', () => {
  assert.equal(sourceId('youtube', 'https://www.youtube.com/channel/' + channel), channel);
  assert.equal(sourceId('kick', 'https://kick.com/MyCreator'), 'mycreator');
  assert.equal(sourceId('instagram', '@Creator'), 'creator');
  for (const bad of [
    feed({ source: 'https://youtube.com.evil.test/channel/' + channel }),
    feed({ source: 'https://user:pass@youtube.com/channel/' + channel }),
    feed({ platform: 'http' }),
    feed({ guildId: '../escape' }),
    { ...feed(), token: 'SECRET' },
  ])
    assert.throws(() => validateSocial(config([bad])));
  assert.throws(() => validateSocial(config([feed(), feed({ id: 'other' })])));
  assert.throws(() => validateSocial({ ...config(), token: 'SECRET' }));
});
test('manual links allow official media URLs and remove tracking, never accept arbitrary endpoints', () => {
  assert.equal(
    mediaURL('https://youtu.be/abcdefghijk?si=tracking'),
    'https://youtu.be/abcdefghijk',
  );
  assert.equal(
    mediaURL('https://www.instagram.com/reel/abc/?igsh=tracking'),
    'https://instagram.com/reel/abc/',
  );
  const request = manualSocialMessage({
    channelId,
    url: 'https://kick.com/creator',
    caption: 'hello',
    language: 'en',
  });
  assert.match(request.content, /hello/);
  assert.equal(request.channelId, channelId);
  for (const url of [
    'http://youtube.com/watch?v=abcdefghijk',
    'https://127.0.0.1/',
    'https://youtube.com.evil/watch?v=abcdefghijk',
    'https://youtube.com:443@evil/watch?v=abcdefghijk',
    'https://instagram.com/accounts/login/',
  ])
    assert.throws(() => mediaURL(url));
});
test('Kick recordings are accepted by manual preview while invalid paths and spoofed hosts are rejected', () => {
  const url = 'https://kick.com/xluffy-jo/videos/01a188fd-f478-7312-bf3f-5e20779747e2';
  assert.equal(mediaURL(url), url);
  assert.equal(mediaURL(url.replace('kick.com', 'www.kick.com') + '?utm_source=share'), url);
  assert.ok(manualSocialMessage({ channelId, url, caption: 'TEST' }).content.endsWith(url));
  for (const bad of [
    url.replace('kick.com', 'kick.com.evil.test'),
    url.replace('01a188fd-f478-7312-bf3f-5e20779747e2', 'invalid'),
    url + '/extra',
    url.replace('https:', 'http:'),
  ])
    assert.throws(() => mediaURL(bad));
});
test('TikTok accepts official profiles, full and short media links, rejects spoofed hosts and normalizes tracking', () => {
  assert.equal(sourceId('tiktok', 'https://www.tiktok.com/@Creator.Name'), 'creator.name');
  assert.equal(
    validateSocial(config([feed({ platform: 'tiktok', source: '@creator' })])).feeds[0].source,
    'creator',
  );
  assert.equal(
    mediaURL('https://www.tiktok.com/@creator/video/123456789?is_from_webapp=1'),
    'https://tiktok.com/@creator/video/123456789',
  );
  assert.equal(mediaURL('https://vm.tiktok.com/ABC123/'), 'https://vm.tiktok.com/ABC123/');
  assert.equal(
    mediaURL('https://www.tiktok.com/@creator/live'),
    'https://tiktok.com/@creator/live',
  );
  for (const value of [
    'https://tiktok.com.evil/@creator',
    'https://tiktok.com/@creator/video/123',
    '@invalid.',
  ])
    assert.throws(() => sourceId('tiktok', value));
  for (const value of [
    'https://tiktok.com.evil/@creator/video/123',
    'https://tiktok.com/login',
    'https://vm.tiktok.com/a/b',
    'http://tiktok.com/@creator/video/123',
  ])
    assert.throws(() => mediaURL(value));
});
test('TikTok API authenticates only to official host and binds videos to the configured creator', async () => {
  const calls = [],
    env = { TIKTOK_ACCESS_TOKEN: 'test-token' },
    f = feed({ platform: 'tiktok', source: 'creator' });
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return new Response(
      JSON.stringify({
        error: { code: 'ok' },
        data: {
          videos: [
            {
              id: '123456789',
              create_time: 1793354400,
              title: 'New clip',
              share_url: 'https://www.tiktok.com/@creator/video/123456789?tracking=1',
            },
          ],
        },
      }),
    );
  };
  const provider = createSocialProviders({ env, fetchImpl }),
    items = await provider(f);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
  assert.equal(new URL(calls[0].url).hostname, 'open.tiktokapis.com');
  assert.equal(JSON.parse(calls[0].options.body).max_count, 20);
  assert.equal(items[0].published, new Date(1793354400000).toISOString());
  assert.ok(!items[0].url.includes('?'));
  await assert.rejects(provider({ ...f, source: 'other_creator' }), /must match/);
  await assert.rejects(createSocialProviders({ env: {} })(f), /TIKTOK_ACCESS_TOKEN/);
  await assert.rejects(
    createSocialProviders({
      env,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ error: { code: 'access_token_invalid' }, data: { videos: [] } }),
        ),
    })(f),
    /authorization/,
  );
});
test('social store is revision protected and requires explicit automatic-post consent', (t) => {
  const store = createSocialStore({ root: temp(t) }),
    first = store.read();
  assert.throws(() => store.save({ config: config(), baseRevision: first.revision }), /Confirm/);
  const saved = store.save({
    config: config(),
    baseRevision: first.revision,
    confirmAutomatic: true,
  });
  assert.equal(store.read().revision, saved.revision);
  assert.throws(
    () => store.save({ config: config([]), baseRevision: first.revision }),
    (e) => e.status === 409,
  );
  assert.equal(
    store.save({ config: config([feed({ enabled: false })]), baseRevision: saved.revision }).config
      .feeds[0].enabled,
    false,
  );
});
test('YouTube parser accepts official Atom entries and rejects entity expansion, mismatched owners and malformed data', () => {
  const xml = `<feed><entry><yt:videoId>abcdefghijk</yt:videoId><yt:channelId>${channel}</yt:channelId><title>A &amp; B</title><published>2026-10-30T00:00:00Z</published></entry></feed>`;
  assert.equal(youtubeItems(xml, channel)[0].title, 'A & B');
  for (const bad of [
    '<!DOCTYPE feed>' + xml,
    xml.replace(channel, 'UC' + 'b'.repeat(22)),
    xml.replace('abcdefghijk', 'bad'),
    xml.replace('</feed>', ''),
  ])
    assert.throws(() => youtubeItems(bad, channel));
});
test('provider fetch bounds payloads, blocks redirects and backs off on 429 without logging bodies', async () => {
  let options;
  await assert.rejects(
    boundedFetch('https://www.youtube.com/', {
      fetchImpl: async (u, o) => {
        options = o;
        return new Response('sensitive', { status: 429, headers: { 'Retry-After': '600' } });
      },
    }),
    (e) => e.retryMs === 600000 && !e.message.includes('sensitive'),
  );
  assert.equal(options.redirect, 'error');
  await assert.rejects(
    boundedFetch('https://www.youtube.com/', {
      fetchImpl: async () => new Response('x'.repeat(1048577)),
    }),
    /too large/,
  );
});
test('Kick uses official OAuth and channel API, caches token, and emits only live session data', async () => {
  const calls = [];
  const fetchItems = createSocialProviders({
    env: { KICK_CLIENT_ID: 'id', KICK_CLIENT_SECRET: 'secret' },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(
        JSON.stringify(
          url.includes('oauth/token')
            ? { access_token: 'app-token', expires_in: 3600 }
            : {
                data: [
                  {
                    slug: 'creator',
                    stream_title: 'A stream',
                    stream: {
                      is_live: true,
                      start_time: '2026-10-30T10:00:00Z',
                      key: 'DO-NOT-EXPOSE',
                    },
                  },
                ],
              },
        ),
      );
    },
  });
  const f = feed({ platform: 'kick', source: 'creator' }),
    items = await fetchItems(f);
  await fetchItems(f);
  assert.equal(calls.length, 3);
  assert.match(calls[0].options.body, /grant_type=client_credentials/);
  assert.equal(items[0].url, 'https://kick.com/creator');
  assert.ok(!JSON.stringify(items).includes('DO-NOT-EXPOSE'));
  await assert.rejects(createSocialProviders({ env: {} })(f), /KICK_CLIENT_ID/);
});
test('Instagram checks the authorized account and accepts only valid official media', async () => {
  const urls = [],
    fetchItems = createSocialProviders({
      env: { INSTAGRAM_USER_ID: '123', INSTAGRAM_ACCESS_TOKEN: 'secret' },
      fetchImpl: async (url, options) => {
        urls.push(url);
        assert.equal(options.headers.Authorization, 'Bearer secret');
        return new Response(
          JSON.stringify(
            url.includes('/media?')
              ? {
                  data: [
                    {
                      id: '789',
                      caption: 'hi',
                      permalink: 'https://www.instagram.com/reel/abc/',
                      timestamp: '2026-10-30T00:00:00Z',
                    },
                  ],
                }
              : { username: 'creator' },
          ),
        );
      },
    });
  assert.equal((await fetchItems(feed({ platform: 'instagram', source: 'creator' })))[0].id, '789');
  assert.ok(urls.every((u) => u.startsWith('https://graph.instagram.com/v25.0/123')));
  await assert.rejects(
    fetchItems(feed({ platform: 'instagram', source: 'someone_else' })),
    /must match/,
  );
});
test('engine baselines silently, sends new items once with mentions disabled, and dedupes across restart', async (t) => {
  const h = harness(t),
    engine = h.make();
  await engine.tick(config());
  assert.equal(h.server.calls.length, 0);
  h.advance();
  h.newItem('new');
  await engine.tick(config());
  assert.equal(h.server.calls.length, 1);
  const call = h.server.calls[0];
  assert.equal(call.method, 'POST');
  assert.deepEqual(call.body.allowed_mentions, { parse: [], replied_user: false });
  assert.equal(call.body.enforce_nonce, true);
  assert.ok(!call.body.content.includes('@everyone'));
  h.advance();
  await h.make().tick(config());
  assert.equal(h.server.calls.length, 1);
  assert.equal(
    JSON.parse(fs.readFileSync(h.stateFile)).sources['source-1'].lastDelivery.status,
    'sent',
  );
});
test('unknown deliveries are durably consumed and never automatically retried', async (t) => {
  const h = harness(t),
    engine = h.make();
  h.api.post = async (p, b) => {
    await h.server.api.call('POST', p, b);
    throw new Error('ambiguous disconnect');
  };
  await engine.tick(config());
  h.advance();
  h.newItem('new');
  await engine.tick(config());
  assert.equal(h.server.calls.length, 1);
  assert.equal(
    JSON.parse(fs.readFileSync(h.stateFile)).sources['source-1'].lastDelivery.status,
    'unknown',
  );
  h.advance();
  h.advance();
  await h.make().tick(config());
  assert.equal(h.server.calls.length, 1);
});
test('missing permissions never sends; reenabled or retargeted sources baseline again', async (t) => {
  const h = harness(t),
    engine = h.make();
  await engine.tick(config());
  h.server.state.roles.find((r) => r.id === BOT_ROLE).permissions = '0';
  h.server.state.roles[0].permissions = '0';
  h.advance();
  h.newItem('new');
  await engine.tick(config());
  assert.equal(h.server.calls.length, 0);
  assert.match(h.statuses.at(-1).message, /lacks/);
  h.server.state.roles[0].permissions = String(P.ViewChannel | P.SendMessages);
  await engine.tick(config([feed({ enabled: false })]));
  h.advance();
  await engine.tick(config());
  assert.equal(h.server.calls.length, 0);
  assert.equal(h.statuses.at(-1).status, 'baseline');
});
test('provider errors back off and isolate destinations; concurrent ticks do not overlap', async (t) => {
  const h = harness(t);
  let calls = 0,
    release;
  const engine = h.make();
  const failed = createSocialEngine({
    api: h.api,
    stateFile: path.join(h.dir, 'failed.json'),
    now: () => 1000,
    fetchItems: async () => {
      calls++;
      throw new ProviderError('credentials required', 600000);
    },
  });
  await failed.tick(config());
  await failed.tick(config());
  assert.equal(calls, 1);
  const blocked = createSocialEngine({
    api: h.api,
    stateFile: path.join(h.dir, 'overlap.json'),
    fetchItems: async () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const pending = blocked.tick(config());
  assert.equal(await blocked.tick(config()), false);
  release([]);
  assert.equal(await pending, true);
  await engine.tick(config());
});
test('package contains only allowlisted source, nonsecret configuration and root startup files', () => {
  const zip = hostedPackage(root, config()),
    names = [],
    contents = new Map();
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const length = zip.readUInt32LE(offset + 18),
      n = zip.readUInt16LE(offset + 26),
      extra = zip.readUInt16LE(offset + 28),
      name = zip.subarray(offset + 30, offset + 30 + n).toString(),
      start = offset + 30 + n + extra;
    names.push(name);
    contents.set(name, zip.subarray(start, start + length).toString());
    offset = start + length;
  }
  const metadata = JSON.parse(contents.get('package.json'));
  assert.equal(metadata.scripts.start, 'node --env-file-if-exists=.env src/hosted-bot.mjs');
  assert.equal(metadata.engines.node, '>=22.9');
  assert.match(
    contents.get('discloud.config'),
    /START=node --env-file-if-exists=\.env src\/hosted-bot\.mjs/,
  );
  assert.deepEqual(JSON.parse(contents.get('config/social-feeds.json')), config());
  assert.deepEqual(
    names.sort(),
    [
      ...HOSTED_FILES,
      'package.json',
      'discloud.config',
      'config/social-feeds.json',
      'config/welcome.json',
      'config/tickets.json',
    ].sort(),
  );
  assert.ok(names.every((n) => !/(^|\/)(\.env|out|desktop|\.git|data)(\/|$)/.test(n)));
  for (const name of names.filter((n) => n.endsWith('.mjs'))) {
    const text = fs.readFileSync(path.join(root, name), 'utf8');
    for (const [, dependency] of text.matchAll(/from '(\.\/[^']+)'/g))
      assert.ok(
        names.includes(path.posix.normalize(path.posix.join(path.posix.dirname(name), dependency))),
        `${name} depends on missing ${dependency}`,
      );
  }
});
test('hosted lifecycle starts independently of stdin and stops without mutations or secret logging', async (t) => {
  const dir = temp(t);
  fs.mkdirSync(path.join(dir, 'config'));
  fs.writeFileSync(path.join(dir, 'config/social-feeds.json'), JSON.stringify(config([])));
  let instance;
  class Gateway extends EventEmitter {
    constructor() {
      super();
      instance = this;
    }
    start() {
      this.running = true;
      this.emit('status', { status: 'online', message: 'secret' });
    }
    stop() {
      this.running = false;
    }
  }
  const logs = [],
    bot = await startHostedBot({
      root: dir,
      env: { DISCORD_BOT_TOKEN: 'test-secret' },
      api: {},
      Gateway,
      fetchItems: async () => [],
      log: (e) => logs.push(e),
    });
  assert.ok(instance.running);
  assert.ok(!JSON.stringify(logs).includes('secret'));
  await bot.stop();
  assert.equal(instance.running, false);
});
test('startup diagnosis distinguishes missing token, missing config and invalid config without leaking credentials', async (t) => {
  const root = temp(t),
    secret = 'test-secret-never-log';
  await assert.rejects(
    startHostedBot({ root, env: {}, log() {} }),
    (error) => hostedStartupDiagnostic(error).code === 'MISSING_BOT_TOKEN',
  );
  await assert.rejects(
    startHostedBot({ root, env: { DISCORD_BOT_TOKEN: 'Bot ' + secret }, log() {} }),
    (error) =>
      hostedStartupDiagnostic(error).code === 'INVALID_TOKEN_FORMAT' &&
      !JSON.stringify(hostedStartupDiagnostic(error)).includes(secret),
  );
  await assert.rejects(
    startHostedBot({ root, env: { DISCORD_BOT_TOKEN: secret }, log() {} }),
    (error) => hostedStartupDiagnostic(error).code === 'MISSING_FEED_CONFIG',
  );
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config/social-feeds.json'), secret);
  await assert.rejects(
    startHostedBot({ root, env: { DISCORD_BOT_TOKEN: secret }, log() {} }),
    (error) =>
      hostedStartupDiagnostic(error).code === 'INVALID_FEED_CONFIG' &&
      !JSON.stringify(hostedStartupDiagnostic(error)).includes(secret),
  );
  assert.ok(!JSON.stringify(hostedStartupDiagnostic(new Error(secret))).includes(secret));
});

const rssURL = 'https://rss.app/feeds/0Jtxh0Ews2TCWbLm.xml';
const rss = (code = 'abc') =>
  `<?xml version="1.0"?><rss><channel><link>https://www.instagram.com/creator/</link><item><title><![CDATA[A &amp; B <b>clip</b>]]></title><link>https://www.instagram.com/p/${code}/</link><pubDate>Thu, 29 Oct 2026 21:27:37 GMT</pubDate></item></channel></rss>`;
test('Instagram RSS requires direct allowlisted XML and validates account, dates, links and bounded XML', () => {
  assert.equal(instagramRSSURL(rssURL), rssURL);
  assert.equal(instagramRSSItems(rss(), 'creator')[0].url, 'https://instagram.com/p/abc/');
  for (const url of [
    'https://rssviewer.app/' + encodeURIComponent(rssURL),
    rssURL + '?x=1',
    rssURL.replace('rss.app', 'evil.test'),
    'http://rss.app/feeds/12345678.xml',
  ])
    assert.throws(() => instagramRSSURL(url));
  for (const xml of [
    rss().replace('creator/', 'someone/'),
    rss().replace('www.instagram.com/p', 'evil.test/p'),
    rss().replace('Thu, 29 Oct 2026 21:27:37 GMT', 'invalid'),
    rss().replace('</item>', ''),
    '< !DOCTYPE rss>' + rss(),
    '<!DOCTYPE rss>' + rss(),
    rss().replace(
      '</channel>',
      '<item><link>https://instagram.com/p/abc/</link><pubDate>2026-10-30</pubDate></item></channel>',
    ),
  ])
    assert.throws(() => instagramRSSItems(xml, 'creator'));
  assert.throws(() => validateSocial(config([feed({ rssURL })])));
  assert.equal(
    validateSocial(config([feed({ platform: 'instagram', source: 'creator', rssURL })])).feeds[0]
      .rssURL,
    rssURL,
  );
});
test('Instagram RSS fetch uses no Meta credentials and no redirects', async () => {
  const calls = [],
    provider = createSocialProviders({
      env: {},
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return new Response(rss());
      },
    });
  assert.equal(
    (await provider(feed({ platform: 'instagram', source: 'creator', rssURL })))[0].id,
    'instagram:abc',
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, rssURL);
  assert.equal(calls[0].options.redirect, 'error');
  assert.ok(!calls[0].options.headers?.Authorization);
});
test('changing Instagram RSS establishes a fresh baseline without replaying posts', async (t) => {
  const h = harness(t),
    engine = h.make(),
    f = feed({ platform: 'instagram', source: 'creator' });
  await engine.tick(config([f]));
  h.advance();
  h.newItem('new-before-rss');
  await engine.tick(config([{ ...f, rssURL }]));
  assert.equal(h.server.calls.length, 0);
  assert.equal(h.statuses.at(-1).status, 'baseline');
  h.advance();
  h.newItem('new-after-rss');
  await engine.tick(config([{ ...f, rssURL }]));
  assert.equal(h.server.calls.length, 1);
});

test('all three notification platforms baseline and deliver independently to their configured destination', async (t) => {
  const h = harness(t);
  let fresh = false;
  const urls = {
    instagram: 'https://instagram.com/p/newpost/',
    kick: 'https://kick.com/creator',
    youtube: 'https://youtube.com/watch?v=abcdefghijk',
  };
  const feeds = ['instagram', 'kick', 'youtube'].map((platform) =>
    feed({
      id: platform,
      platform,
      source: platform === 'youtube' ? channel : 'creator',
      ...(platform === 'instagram' ? { rssURL } : {}),
    }),
  );
  const engine = createSocialEngine({
    api: h.api,
    stateFile: h.stateFile,
    now: () => (fresh ? Date.parse('2026-10-30T10:03:00Z') : Date.parse('2026-10-30T10:00:00Z')),
    fetchItems: async (f) =>
      fresh
        ? [
            {
              id: f.platform + '-new',
              title: f.platform,
              url: urls[f.platform],
              published: '2026-10-30T10:02:59Z',
            },
          ]
        : [],
  });
  await engine.tick(config(feeds));
  assert.equal(h.server.calls.length, 0);
  fresh = true;
  await engine.tick(config(feeds));
  assert.equal(h.server.calls.length, 3);
  for (const f of feeds) {
    const call = h.server.calls.find((c) => c.body.content.includes('· ' + f.platform));
    assert.ok(call);
    assert.equal(call.path, '/channels/' + channelId + '/messages');
    assert.deepEqual(call.body.allowed_mentions.parse, []);
  }
  await engine.tick(config(feeds));
  assert.equal(h.server.calls.length, 3);
});

test('host signals stop once, exit cleanly and distinguish fatal failures without leaking error details', async () => {
  const runtime = new EventEmitter(),
    logs = [];
  let stops = 0,
    release;
  const lifecycle = installHostedShutdown(
    {
      failed: false,
      stop() {
        stops++;
        return new Promise((resolve) => (release = resolve));
      },
    },
    { runtime, log: (e) => logs.push(e) },
  );
  runtime.emit('SIGTERM');
  await Promise.resolve();
  const pending = lifecycle.request('SIGINT');
  assert.equal(stops, 1);
  release();
  await pending;
  assert.equal(runtime.exitCode, 0);
  assert.deepEqual(
    logs.map((e) => e.status),
    ['stopping', 'stopped'],
  );
  assert.equal(logs[1].signal, 'SIGTERM');
  lifecycle.dispose();
  assert.equal(runtime.listenerCount('SIGINT'), 0);
  const fatal = installHostedShutdown(
    { failed: true, async stop() {} },
    { runtime, log: (e) => logs.push(e) },
  );
  await fatal.request('SIGTERM');
  assert.equal(runtime.exitCode, 1);
  fatal.dispose();
  const failed = installHostedShutdown(
    {
      failed: false,
      async stop() {
        throw new Error('SECRET never log');
      },
    },
    { runtime, log: (e) => logs.push(e) },
  );
  await failed.request('SIGTERM');
  assert.equal(runtime.exitCode, 1);
  assert.equal(logs.at(-1).code, 'SHUTDOWN_FAILED');
  assert.ok(!JSON.stringify(logs).includes('SECRET'));
  failed.dispose();
});

test('laith1x Kick provider-to-delivery flow announces a new live session once and survives restart', async (t) => {
  const h = harness(t);
  let clock = Date.parse('2026-11-01T10:00:00Z'),
    live = false;
  const started = new Date(clock + 30000).toISOString(),
    f = feed({ platform: 'kick', source: 'laith1x', language: 'en' });
  const fetchItems = createSocialProviders({
    env: { KICK_CLIENT_ID: 'mock-id', KICK_CLIENT_SECRET: 'mock-secret' },
    now: () => clock,
    fetchImpl: async (url) => {
      if (url === 'https://id.kick.com/oauth/token')
        return new Response(JSON.stringify({ access_token: 'mock-token', expires_in: 3600 }));
      assert.equal(url, 'https://api.kick.com/public/v1/channels?slug=laith1x');
      return new Response(
        JSON.stringify({
          data: [
            {
              slug: 'laith1x',
              stream_title: 'LAITH is live',
              stream: { is_live: live, start_time: live ? started : '' },
            },
          ],
        }),
      );
    },
  });
  const options = { api: h.api, stateFile: h.stateFile, fetchItems, now: () => clock };
  const engine = createSocialEngine(options);
  await engine.tick(config([f]));
  assert.equal(h.server.calls.length, 0);
  live = true;
  clock += 120001;
  await engine.tick(config([f]));
  assert.equal(h.server.calls.length, 1);
  assert.equal(h.server.calls[0].path, '/channels/' + f.channelId + '/messages');
  assert.match(h.server.calls[0].body.content, /https:\/\/kick.com\/laith1x/);
  clock += 120001;
  await engine.tick(config([f]));
  assert.equal(h.server.calls.length, 1);
  clock += 120001;
  await createSocialEngine(options).tick(config([f]));
  assert.equal(h.server.calls.length, 1);
});
