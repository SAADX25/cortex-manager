import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { validateMessageImage } from './message-image.mjs';
import { instagramRSSURL } from './instagram-rss.mjs';

export const snowflake = (v) => typeof v === 'string' && /^\d{16,22}$/.test(v);
const fail = (message) => {
  throw new Error(message);
};
const keys = (v, allowed) => {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !allowed.includes(k))
  )
    fail('Invalid social configuration fields.');
};
export function sourceId(platform, value) {
  if (typeof value !== 'string' || value.length > 200) fail('Invalid source.');
  let id = value.trim();
  if (id.startsWith('https://')) {
    const u = new URL(id);
    if (u.username || u.password || u.port || u.search || u.hash)
      fail('Use a clean official profile URL.');
    if (
      platform === 'youtube' &&
      ['youtube.com', 'www.youtube.com'].includes(u.hostname) &&
      /^\/channel\/UC[\w-]{22}\/?$/.test(u.pathname)
    )
      id = u.pathname.split('/')[2];
    else if (
      platform === 'kick' &&
      ['kick.com', 'www.kick.com'].includes(u.hostname) &&
      /^\/[\w-]+\/?$/.test(u.pathname)
    )
      id = u.pathname.split('/')[1];
    else if (
      platform === 'instagram' &&
      ['instagram.com', 'www.instagram.com'].includes(u.hostname) &&
      /^\/[\w.]+\/?$/.test(u.pathname)
    )
      id = u.pathname.split('/')[1];
    else if (
      platform === 'tiktok' &&
      ['tiktok.com', 'www.tiktok.com'].includes(u.hostname) &&
      /^\/@[\w.]+\/?$/.test(u.pathname)
    )
      id = u.pathname.split('/')[1].slice(1);
    else
      fail(
        'Use a YouTube /channel/UC… URL, Kick profile, Instagram profile, or TikTok /@username profile.',
      );
  }
  if (platform === 'youtube') {
    if (!/^UC[\w-]{22}$/.test(id))
      fail('YouTube requires the channel ID starting with UC (24 characters).');
  } else if (platform === 'kick') {
    id = id.toLowerCase();
    if (!/^[a-z0-9_][a-z0-9_-]{0,24}$/.test(id)) fail('Invalid Kick account.');
  } else if (platform === 'instagram') {
    id = id.replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9_][a-z0-9_.]{0,29}$/.test(id)) fail('Invalid Instagram account.');
  } else if (platform === 'tiktok') {
    id = id.replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9_][a-z0-9_.]{1,23}$/.test(id) || id.endsWith('.'))
      fail('Invalid TikTok username.');
  } else fail('Unsupported platform.');
  return id;
}
export function mediaURL(value) {
  if (typeof value !== 'string' || value.length > 500) fail('Invalid media link.');
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash)
    fail('Use an official HTTPS media link.');
  const host = u.hostname.replace(/^www\./, '');
  let ok = false;
  if (host === 'youtube.com')
    ok =
      (u.pathname === '/watch' && /^[\w-]{11}$/.test(u.searchParams.get('v') ?? '')) ||
      /^\/(shorts|live)\/[\w-]{11}\/?$/.test(u.pathname);
  if (host === 'youtu.be') ok = /^\/[\w-]{11}\/?$/.test(u.pathname);
  if (host === 'kick.com')
    ok =
      /^\/[a-z0-9_][a-z0-9_-]{0,24}\/?$/i.test(u.pathname) ||
      /^\/[a-z0-9_-]+\/clips\/[^/]+\/?$/i.test(u.pathname) ||
      /^\/[a-z0-9_][a-z0-9_-]{0,24}\/videos\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/?$/i.test(
        u.pathname,
      );
  if (host === 'instagram.com') ok = /^\/(p|reel|tv)\/[\w-]+\/?$/.test(u.pathname);
  if (host === 'tiktok.com')
    ok =
      /^\/@[\w.]{2,24}\/(video\/\d{1,30}|live)\/?$/.test(u.pathname) ||
      /^\/t\/[a-zA-Z0-9]+\/?$/.test(u.pathname);
  if (['vm.tiktok.com', 'vt.tiktok.com'].includes(host))
    ok = /^\/[a-zA-Z0-9]+\/?$/.test(u.pathname);
  if (!ok)
    fail(
      'Supported links: YouTube videos, Kick streams/recordings/clips, Instagram posts/reels and TikTok videos/live links.',
    );
  const v = u.searchParams.get('v');
  u.search = '';
  if (host === 'youtube.com' && u.pathname === '/watch') u.searchParams.set('v', v);
  u.hostname = host;
  return u.href;
}
export function validateSocial(config) {
  keys(config, ['version', 'feeds']);
  if (config.version !== 1 || !Array.isArray(config.feeds) || config.feeds.length > 40)
    fail('At most 40 social sources are supported.');
  const ids = new Set(),
    destinations = new Set();
  const feeds = config.feeds.map((f) => {
    keys(f, ['id', 'guildId', 'channelId', 'platform', 'source', 'enabled', 'language', 'rssURL']);
    if (
      typeof f.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(f.id) ||
      ids.has(f.id) ||
      !snowflake(f.guildId) ||
      !snowflake(f.channelId) ||
      typeof f.enabled !== 'boolean' ||
      !['ar', 'en'].includes(f.language)
    )
      fail('Invalid social source settings.');
    const source = sourceId(f.platform, f.source),
      key = [f.guildId, f.channelId, f.platform, source].join(':');
    if (destinations.has(key)) fail('This source already targets this room.');
    if (f.rssURL !== undefined) {
      if (f.platform !== 'instagram') fail('RSS feeds are supported for Instagram only.');
      f = { ...f, rssURL: instagramRSSURL(f.rssURL) };
    }
    ids.add(f.id);
    destinations.add(key);
    return { ...f, source };
  });
  return { version: 1, feeds };
}
export const revision = (config) =>
  createHash('sha256').update(JSON.stringify(config)).digest('hex');
export function atomicJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + randomBytes(8).toString('hex') + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, file);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}
export function createSocialStore({ root, demo = false }) {
  const file = path.join(root, 'out', 'desktop-modern', demo ? 'demo-social.json' : 'social.json');
  const read = () => {
    if (fs.existsSync(file) && fs.statSync(file).size > 64000) fail('Social file too large.');
    const config = validateSocial(
      fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: 1, feeds: [] },
    );
    return { config, revision: revision(config) };
  };
  return {
    read,
    save(body) {
      keys(body, ['config', 'baseRevision', 'confirmAutomatic']);
      const current = read();
      if (body.baseRevision !== current.revision)
        throw Object.assign(
          new Error('Social settings changed in another window. Reload before saving.'),
          { status: 409 },
        );
      const config = validateSocial(body.config);
      if (
        config.feeds.some(
          (f) =>
            f.enabled &&
            !current.config.feeds.some(
              (old) => old.enabled && JSON.stringify(old) === JSON.stringify(f),
            ),
        ) &&
        body.confirmAutomatic !== true
      )
        fail('Confirm automatic posting for these destinations first.');
      atomicJSON(file, config);
      return { config, revision: revision(config) };
    },
  };
}
export function manualSocialMessage({ channelId, url, caption = '', language = 'ar', image }) {
  if (
    !snowflake(channelId) ||
    typeof caption !== 'string' ||
    caption.length > 1200 ||
    !['ar', 'en'].includes(language)
  )
    fail('Invalid manual message.');
  if (image !== undefined) validateMessageImage(image);
  const link = mediaURL(url);
  return {
    channelId,
    content: [
      language === 'ar' ? '🎬 محتوى جديد للمجتمع' : '🎬 New community content',
      caption.trim(),
      link,
    ]
      .filter(Boolean)
      .join('\n\n'),
    ...(image !== undefined ? { image } : {}),
  };
}
