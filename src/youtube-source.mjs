import { validateSocial, sourceId } from './social-config.mjs';
import { boundedFetch } from './social-providers.mjs';
const problem = () =>
  new Error(
    'تعذّر تحديد قناة YouTube؛ استخدم رابط /channel/UC… أو حاول مجددًا. / Could not resolve this YouTube channel; use its /channel/UC… URL or retry.',
  );
export function youtubeHandle(value) {
  if (typeof value !== 'string') throw problem();
  let handle = value.trim();
  if (handle.startsWith('https://')) {
    let url;
    try {
      url = new URL(handle);
    } catch {
      throw problem();
    }
    if (
      !['youtube.com', 'www.youtube.com'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    )
      throw problem();
    try {
      handle = decodeURIComponent(url.pathname.replace(/\/$/, ''));
    } catch {
      throw problem();
    }
    if (!handle.startsWith('/@')) throw problem();
    handle = handle.slice(1);
  }
  if (!/^@[\p{L}\p{M}\p{N}_.·-]{3,30}$/u.test(handle)) throw problem();
  return handle;
}
export function youtubeChannelFromHTML(html) {
  const ids = new Set();
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = Object.fromEntries(
      [...tag.matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map((m) => [m[1].toLowerCase(), m[2]]),
    );
    if (attributes.type !== 'application/rss+xml') continue;
    const match = attributes.href?.match(
      /^https:\/\/www\.youtube\.com\/feeds\/videos\.xml\?channel_id=(UC[\w-]{22})$/,
    );
    if (match) ids.add(match[1]);
  }
  if (ids.size !== 1) throw problem();
  return [...ids][0];
}
export function createYouTubeSourceResolver({ fetchImpl = fetch, now = Date.now } = {}) {
  const cache = new Map();
  let active = false;
  return async function resolve(config, { allowNetwork = true } = {}) {
    if (!Array.isArray(config?.feeds)) return validateSocial(config);
    const pending = [];
    const provisional = {
      ...config,
      feeds: config.feeds.map((f, index) => {
        if (f?.platform !== 'youtube') return f;
        try {
          sourceId('youtube', f.source);
          return f;
        } catch {}
        const handle = youtubeHandle(f.source);
        pending.push({ index, handle });
        return { ...f, source: 'UC' + String(index).padStart(22, '0') };
      }),
    };
    validateSocial(provisional);
    if (!pending.length) return validateSocial(config);
    if (!allowNetwork)
      throw new Error('YouTube handle lookup is disabled in demo mode. Use a UC channel ID.');
    if (pending.length > 4) throw new Error('Resolve at most four YouTube handles at a time.');
    if (active) throw new Error('YouTube lookup in progress. Try again shortly.');
    active = true;
    try {
      const feeds = config.feeds.map((f) => ({ ...f }));
      for (const { index, handle } of pending) {
        const cached = cache.get(handle);
        let id = cached?.expires > now() ? cached.id : null;
        if (!id) {
          try {
            id = youtubeChannelFromHTML(
              await boundedFetch(
                'https://www.youtube.com/@' + encodeURIComponent(handle.slice(1)),
                { fetchImpl },
              ),
            );
          } catch {
            throw problem();
          }
          if (cache.size >= 40) cache.delete(cache.keys().next().value);
          cache.set(handle, { id, expires: now() + 3600000 });
        }
        feeds[index].source = id;
      }
      return validateSocial({ ...config, feeds });
    } finally {
      active = false;
    }
  };
}
