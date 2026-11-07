import { sourceId, mediaURL } from './social-config.mjs';
import { instagramRSSURL, instagramRSSItems, InstagramRSSError } from './instagram-rss.mjs';

export class ProviderError extends Error {
  constructor(message, retryMs = 300000, { httpStatus, skip = false } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.retryMs = retryMs;
    this.httpStatus = httpStatus;
    this.skip = skip;
  }
}
// Fixed official endpoints only. Never follow a redirect with an API credential.
export async function boundedFetch(
  url,
  { fetchImpl = fetch, headers = {}, method = 'GET', body } = {},
) {
  let r;
  try {
    r = await fetchImpl(url, {
      headers,
      method,
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new ProviderError('Provider connection failed.');
  }
  const cancel = async () => {
    try {
      await r.body?.cancel();
    } catch {}
  };
  if (!r.ok) {
    await cancel();
    throw new ProviderError(
      `Provider returned HTTP ${r.status}.`,
      r.status === 429
        ? Math.min(3600000, Math.max(120000, (Number(r.headers.get('retry-after')) || 300) * 1000))
        : r.status === 402 || r.status === 403
          ? 3600000
          : 300000,
      { httpStatus: r.status, skip: [402, 403, 404, 410, 429].includes(r.status) },
    );
  }
  if (Number(r.headers.get('content-length')) > 1048576) {
    await cancel();
    throw new ProviderError('Provider response too large.');
  }
  const reader = r.body?.getReader();
  if (!reader) throw new ProviderError('Empty provider response.');
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1048576) throw new ProviderError('Provider response too large.');
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('Provider response interrupted.');
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString('utf8');
}
const unxml = (s) =>
  s.replace(
    /&(?:amp|lt|gt|quot|apos);/g,
    (e) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[e],
  );
export function youtubeItems(xml, channel) {
  sourceId('youtube', channel);
  if (
    typeof xml !== 'string' ||
    xml.length > 1048576 ||
    /<!DOCTYPE|<!ENTITY/i.test(xml) ||
    !/<feed\b/.test(xml) ||
    !/<\/feed>/.test(xml)
  )
    throw new ProviderError('Invalid YouTube feed.');
  const tag = (entry, name) =>
    unxml(entry.match(new RegExp(`<${name}>([^<]*)<\\/${name}>`))?.[1] ?? '');
  const entries = [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)];
  if (entries.length > 100) throw new ProviderError('Too many feed entries.');
  return entries.map(([, entry]) => {
    const id = tag(entry, 'yt:videoId'),
      owner = tag(entry, 'yt:channelId'),
      published = tag(entry, 'published');
    if (!/^[\w-]{11}$/.test(id) || owner !== channel || !Number.isFinite(Date.parse(published)))
      throw new ProviderError('Invalid YouTube entry.');
    return {
      id,
      title: tag(entry, 'title').slice(0, 200),
      url: `https://www.youtube.com/watch?v=${id}`,
      published,
    };
  });
}
export function createSocialProviders({
  env = process.env,
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  let kickToken = null,
    kickExpiry = 0;
  const get = async (url, headers = {}) => {
    try {
      return JSON.parse(await boundedFetch(url, { headers, fetchImpl }));
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw new ProviderError('Invalid provider JSON.');
    }
  };
  return async function fetchItems(feed) {
    const source = sourceId(feed.platform, feed.source);
    if (feed.platform === 'instagram' && feed.rssURL) {
      try {
        return instagramRSSItems(
          await boundedFetch(instagramRSSURL(feed.rssURL), { fetchImpl }),
          source,
        );
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        throw new ProviderError(
          error instanceof InstagramRSSError ? error.message : 'Invalid Instagram RSS response.',
          300000,
          { skip: true },
        );
      }
    }
    if (feed.platform === 'youtube')
      return youtubeItems(
        await boundedFetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${source}`, {
          fetchImpl,
        }),
        source,
      );
    if (feed.platform === 'tiktok') {
      if (!env.TIKTOK_ACCESS_TOKEN)
        throw new ProviderError(
          'Set TIKTOK_ACCESS_TOKEN for an authorized TikTok account with video.list permission.',
        );
      const raw = await boundedFetch(
        'https://open.tiktokapis.com/v2/video/list/?fields=id,title,create_time,share_url',
        {
          fetchImpl,
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.TIKTOK_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ max_count: 20 }),
        },
      );
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new ProviderError('Invalid TikTok response.');
      }
      if (
        data.error?.code !== 'ok' ||
        !Array.isArray(data.data?.videos) ||
        data.data.videos.length > 20
      )
        throw new ProviderError(
          'TikTok authorization or video list failed. Check video.list permission and token expiry.',
        );
      return data.data.videos.map((item) => {
        if (
          !/^\d{1,30}$/.test(item.id) ||
          !Number.isSafeInteger(item.create_time) ||
          item.create_time <= 0 ||
          item.create_time > 8640000000000
        )
          throw new ProviderError('Invalid TikTok video.');
        const url = mediaURL(item.share_url),
          u = new URL(url);
        if (
          u.hostname !== 'tiktok.com' ||
          (u.pathname.toLowerCase() !== `/@${source}/video/${item.id}` &&
            u.pathname.toLowerCase() !== `/@${source}/video/${item.id}/`)
        )
          throw new ProviderError('TikTok source must match the account authorized by the token.');
        return {
          id: item.id,
          title: String(item.title ?? source).slice(0, 200),
          url,
          published: new Date(item.create_time * 1000).toISOString(),
        };
      });
    }
    if (feed.platform === 'kick') {
      if (!env.KICK_CLIENT_ID || !env.KICK_CLIENT_SECRET)
        throw new ProviderError('Set KICK_CLIENT_ID and KICK_CLIENT_SECRET in Discloud.');
      if (!kickToken || now() >= kickExpiry) {
        let token;
        try {
          token = JSON.parse(
            await boundedFetch('https://id.kick.com/oauth/token', {
              fetchImpl,
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: env.KICK_CLIENT_ID,
                client_secret: env.KICK_CLIENT_SECRET,
              }).toString(),
            }),
          );
        } catch (error) {
          if (error instanceof ProviderError) throw error;
          throw new ProviderError('Kick application authentication failed.');
        }
        if (typeof token.access_token !== 'string' || !Number.isFinite(Number(token.expires_in)))
          throw new ProviderError('Invalid Kick access token response.');
        kickToken = token.access_token;
        kickExpiry = now() + Math.max(0, Number(token.expires_in) * 1000 - 60000);
      }
      let data;
      try {
        data = await get(
          `https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(source)}`,
          { Authorization: `Bearer ${kickToken}` },
        );
      } catch (e) {
        kickExpiry = 0;
        throw e;
      }
      const channel = data.data?.find((c) => c.slug?.toLowerCase() === source);
      if (!channel) throw new ProviderError('Kick account not found.');
      if (!channel.stream?.is_live) return [];
      const published = channel.stream.start_time;
      if (typeof published !== 'string' || !Number.isFinite(Date.parse(published)))
        throw new ProviderError('Kick live session has no valid start time.');
      return [
        {
          id: source + ':' + published,
          title: String(channel.stream_title ?? source).slice(0, 200),
          url: `https://kick.com/${source}`,
          published,
        },
      ];
    }
    if (!env.INSTAGRAM_ACCESS_TOKEN || !/^\d{1,30}$/.test(env.INSTAGRAM_USER_ID ?? ''))
      throw new ProviderError(
        'Instagram needs an authorized professional account: INSTAGRAM_USER_ID and INSTAGRAM_ACCESS_TOKEN.',
      );
    const version = env.INSTAGRAM_API_VERSION ?? 'v25.0';
    if (!/^v\d{2}\.0$/.test(version)) throw new ProviderError('Invalid Instagram API version.');
    const base = `https://graph.instagram.com/${version}/${env.INSTAGRAM_USER_ID}`,
      headers = { Authorization: `Bearer ${env.INSTAGRAM_ACCESS_TOKEN}` };
    const profile = await get(base + '?fields=username', headers);
    if (profile.username?.toLowerCase() !== source)
      throw new ProviderError('Instagram source must match the authorized professional account.');
    const data = await get(
      base + '/media?fields=id,caption,permalink,timestamp,media_type&limit=25',
      headers,
    );
    if (!Array.isArray(data.data) || data.data.length > 25)
      throw new ProviderError('Invalid Instagram media response.');
    return data.data.map((item) => {
      if (!/^\d{1,30}$/.test(item.id) || !Number.isFinite(Date.parse(item.timestamp)))
        throw new ProviderError('Invalid Instagram media.');
      return {
        id: item.id,
        title: String(item.caption ?? source).slice(0, 200),
        url: mediaURL(item.permalink),
        published: item.timestamp,
      };
    });
  };
}
