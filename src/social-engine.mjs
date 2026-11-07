import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { atomicJSON, validateSocial, mediaURL } from './social-config.mjs';
import { snapshot } from './api.mjs';
import { messageProtection } from './messages.mjs';
import { ProviderError } from './social-providers.mjs';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function notificationContent(feed, item) {
  const title = String(item.title ?? feed.source)
    .replace(/[@`*_~|<>\[\]\\]/g, '')
    .slice(0, 200);
  return `${feed.platform === 'kick' ? (feed.language === 'ar' ? '🔴 بدأ البث المباشر' : '🔴 Live now') : feed.language === 'ar' ? '🎬 محتوى جديد' : '🎬 New content'} · ${feed.platform}\n**${title}**\n${mediaURL(item.url)}`;
}
/** One serialized tick, durable reservations before POST; no historical flood or ambiguous resend. */
export function createSocialEngine({
  api,
  fetchItems,
  stateFile,
  now = Date.now,
  onStatus = () => {},
  isStopping = () => false,
}) {
  let state = { version: 1, sources: {} };
  if (fs.existsSync(stateFile)) {
    if (fs.statSync(stateFile).size > 4000000)
      throw new Error('Social delivery state too large; restore a valid backup.');
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (
      state.version !== 1 ||
      !state.sources ||
      typeof state.sources !== 'object' ||
      Array.isArray(state.sources)
    )
      throw new Error('Invalid social delivery state.');
    for (const entry of Object.values(state.sources))
      if (
        !entry ||
        !Array.isArray(entry.seen) ||
        entry.seen.length > 200 ||
        entry.seen.some((id) => typeof id !== 'string') ||
        !Number.isFinite(entry.since) ||
        !Number.isFinite(entry.nextAt) ||
        !Number.isInteger(entry.failures) ||
        typeof entry.signature !== 'string' ||
        typeof entry.active !== 'boolean'
      )
        throw new Error('Invalid social delivery state entry.');
  }
  let running = false;
  const initialRetries = new Map();
  const persist = () => atomicJSON(stateFile, state);
  async function tick(input) {
    if (running) return false;
    running = true;
    try {
      const config = validateSocial(input),
        active = new Set(config.feeds.filter((f) => f.enabled).map((f) => f.id));
      for (const [id, entry] of Object.entries(state.sources))
        if (!active.has(id) && entry.active) {
          entry.active = false;
          persist();
        }
      for (const feed of config.feeds.filter((f) => f.enabled)) {
        if (isStopping()) return false;
        const signature = hash([
          feed.guildId,
          feed.channelId,
          feed.platform,
          feed.source,
          ...(feed.rssURL ? [feed.rssURL] : []),
        ]);
        if ((initialRetries.get(signature) ?? 0) > now()) continue;
        let entry = state.sources[feed.id];
        if (entry?.signature !== signature || entry?.active === false) entry = null;
        if (entry && entry.nextAt > now()) continue;
        try {
          const items = await fetchItems(feed);
          if (isStopping()) return false;
          if (!Array.isArray(items) || items.length > 100)
            throw new Error('Invalid provider items.');
          for (const item of items)
            if (
              typeof item.id !== 'string' ||
              item.id.length > 200 ||
              !Number.isFinite(Date.parse(item.published))
            )
              throw new Error('Invalid provider item.');
          if (!entry) {
            // First successful response establishes a baseline, including current live sessions.
            entry = {
              signature,
              active: true,
              since: now(),
              seen: items.map((i) => i.id),
              nextAt: now() + 120000,
              failures: 0,
              lastStatus: 'baseline',
            };
            state.sources[feed.id] = entry;
            persist();
            initialRetries.delete(signature);
            onStatus({ id: feed.id, status: 'baseline' });
            continue;
          }
          const candidates = items
            .filter((i) => !entry.seen.includes(i.id) && Date.parse(i.published) > entry.since)
            .sort((a, b) => Date.parse(a.published) - Date.parse(b.published));
          // Bound catch-up after downtime: baseline older missed items, deliver only the latest five.
          const selected = candidates.slice(-5),
            s = selected.length
              ? await snapshot(api, feed.guildId, { includeMembers: false })
              : null;
          if (s) {
            const channel = s.channels.find((c) => c.id === feed.channelId);
            if (!channel || ![0, 5].includes(channel.type) || messageProtection(s, channel))
              throw new Error('Destination missing or bot lacks View Channel / Send Messages.');
          }
          for (const item of selected) {
            if (isStopping()) return false;
            const content = notificationContent(feed, item),
              nonce = hash([signature, item.id]).slice(0, 24);
            entry.seen = [...new Set([...entry.seen, item.id])].slice(-200);
            entry.lastDelivery = {
              itemId: item.id,
              status: 'reserved',
              at: new Date(now()).toISOString(),
            };
            persist();
            try {
              const message = await api.post(`/channels/${feed.channelId}/messages`, {
                content,
                allowed_mentions: { parse: [], replied_user: false },
                nonce,
                enforce_nonce: true,
              });
              entry.lastDelivery.status = 'sent';
              entry.lastDelivery.messageId = message.id;
            } catch {
              entry.lastDelivery.status = 'unknown';
              persist();
              throw new Error(
                'Delivery failed or is uncertain. Check Discord before reposting manually.',
              );
            }
            persist();
          }
          entry.seen = [...new Set([...entry.seen, ...items.map((i) => i.id)])].slice(-200);
          entry.nextAt = now() + 120000;
          entry.failures = 0;
          entry.lastStatus = 'checked';
          persist();
          onStatus({ id: feed.id, status: 'checked', delivered: selected.length });
        } catch (error) {
          const retryMs =
            Number.isFinite(error?.retryMs) && error.retryMs >= 0 ? error.retryMs : 300000;
          const skipped = error instanceof ProviderError && error.skip;
          const status = skipped ? 'skipped' : 'error';
          // Persist backoff even if the first provider request fails. Keep baseline unset until success.
          if (entry) {
            entry.failures++;
            entry.nextAt =
              now() +
              Math.max(retryMs, Math.min(3600000, 120000 * 2 ** Math.min(entry.failures, 5)));
            entry.lastStatus = status;
            persist();
          } else initialRetries.set(signature, now() + Math.max(300000, retryMs));
          onStatus({
            id: feed.id,
            platform: feed.platform,
            source: feed.source,
            provider: feed.rssURL ? 'rss.app' : feed.platform,
            status,
            ...(error instanceof ProviderError
              ? { level: 'warning', httpStatus: error.httpStatus }
              : {}),
            message:
              typeof error?.message === 'string' ? error.message : 'Subscription check failed.',
            ...(skipped
              ? {
                  hint: 'Provider unavailable; subscription skipped until the next retry. Update or disable it if this persists.',
                }
              : {}),
            retryMs: entry ? entry.nextAt - now() : initialRetries.get(signature) - now(),
          });
        }
      }
      return true;
    } finally {
      running = false;
    }
  }
  return { tick };
}
