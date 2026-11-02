import { renderKickCard } from './kick-card.mjs';
import { fetchWelcomeAvatar } from './welcome-card.mjs';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { snapshot } from './api.mjs';
import { atomicJSON, snowflake } from './social-config.mjs';
import { botPermissions, effectiveChannelPermissions, P, has } from './permissions.mjs';
import { messageProtection } from './messages.mjs';
import { kickCopy } from './notification-locales.mjs';
const stamp = (id) => Number(BigInt(id) >> 22n) + 1420070400000;
const clean = (value) =>
  String(value ?? '')
    .replace(/[@`*_~|<>\[\]\\\u0000-\u001f\u007f]/g, '')
    .slice(0, 1000);
/** Consume authoritative audit events. This module has no member-removal API. */
export function createKickNotifications({
  api,
  config,
  stateFile,
  now = Date.now,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  onStatus = () => {},
  isStopping = () => false,
  renderCard = renderKickCard,
  fetchAvatar = fetchWelcomeAvatar,
}) {
  if (fs.existsSync(stateFile) && fs.statSync(stateFile).size > 128000)
    throw new Error('Kick notification state too large.');
  let state = fs.existsSync(stateFile)
    ? JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    : { version: 1, seen: [] };
  if (
    state.version !== 1 ||
    !Array.isArray(state.seen) ||
    state.seen.length > 1000 ||
    state.seen.some((id) => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))
  )
    throw new Error('Invalid kick notification state.');
  const recent = new Map(),
    queuedIds = new Set();
  let queue = Promise.resolve(),
    pending = 0;
  const setting = (id) => config.guilds.find((g) => g.guildId === id)?.kick;
  const notice = (status, code) => onStatus({ component: 'kick-log', status, code });
  function remember(entry) {
    const time = now();
    for (const [key, item] of recent) if (time - item.observed > 60000) recent.delete(key);
    if (Math.abs(time - stamp(entry.id)) <= 60000) {
      recent.set(entry.guild_id + ':' + entry.target_id, { observed: time });
      if (recent.size > 1000) recent.delete(recent.keys().next().value);
    }
  }
  async function destination(guildId, channelId) {
    const s = await snapshot(api, guildId, { includeMembers: false }),
      channel = s.channels.find((c) => c.id === channelId);
    if (!has(botPermissions(s), P.ViewAuditLog)) {
      notice('warning', 'MISSING_VIEW_AUDIT_LOG');
      return null;
    }
    if (
      !channel ||
      messageProtection(s, channel) ||
      !has(effectiveChannelPermissions(s, channel), P.EmbedLinks)
    ) {
      notice('warning', 'KICK_LOG_DESTINATION_UNAVAILABLE');
      return null;
    }
    return { s, channel };
  }
  async function checkPermissions() {
    for (const g of config.guilds.filter((g) => g.kick?.enabled)) {
      if (isStopping()) return;
      try {
        await destination(g.guildId, g.kick.channelId);
      } catch {
        notice('warning', 'KICK_LOG_CHECK_FAILED');
      }
    }
  }
  async function userLabel(id, fallback) {
    if (!snowflake(id)) return fallback;
    try {
      const user = await api.get('/users/' + id);
      if (user?.id === id)
        return clean(user.global_name ?? user.username ?? id).slice(0, 100) + ' · ' + id;
    } catch {}
    return id;
  }
  function handle(entry) {
    if (
      isStopping() ||
      !setting(entry?.guild_id)?.enabled ||
      !snowflake(entry?.id) ||
      !snowflake(entry?.guild_id) ||
      !snowflake(entry?.target_id) ||
      ![20, 22].includes(entry?.action_type)
    )
      return Promise.resolve();

    const key = createHash('sha256')
      .update(JSON.stringify([entry.guild_id, entry.id]))
      .digest('hex');
    if (state.seen.includes(key) || queuedIds.has(key)) return Promise.resolve();
    if (pending >= 100) {
      notice('warning', 'KICK_LOG_QUEUE_FULL');
      return Promise.resolve();
    }
    queuedIds.add(key);
    remember(entry);
    pending++;
    const copy = {
      action_type: entry.action_type,
      id: entry.id,
      guild_id: entry.guild_id,
      target_id: entry.target_id,
      user_id: snowflake(entry.user_id) ? entry.user_id : null,
      reason: typeof entry.reason === 'string' ? entry.reason.slice(0, 1000) : '',
    };
    queue = queue
      .then(async () => {
        if (isStopping() || state.seen.includes(key)) return;
        if (copy.action_type === 22) {
          state.seen = [...state.seen, key].slice(-1000);
          atomicJSON(stateFile, state);
          return;
        }
        const settings = setting(copy.guild_id),
          dest = await destination(copy.guild_id, settings.channelId);
        if (!dest || isStopping()) return;
        const words = kickCopy[settings.language],
          member = await userLabel(copy.target_id, words.unknown),
          moderator = await userLabel(copy.user_id, words.unknown);
        if (isStopping()) return;
        const body = {
          embeds: [
            {
              title: words.title,
              color: 0xed4245,
              fields: [
                { name: words.member, value: member, inline: true },
                { name: words.moderator, value: moderator, inline: true },
                { name: words.reason, value: clean(copy.reason).trim() || words.noReason },
              ],
              timestamp: new Date(stamp(copy.id)).toISOString(),
              footer: { text: words.footer },
            },
          ],
          allowed_mentions: { parse: [], replied_user: false },
          nonce: key.slice(0, 24),
          enforce_nonce: true,
        };
        let files;
        if (has(effectiveChannelPermissions(dest.s, dest.channel), P.AttachFiles)) {
          try {
            let user;
            try {
              user = await api.get('/users/' + copy.target_id);
            } catch {}
            const bytes = await renderCard(
              {
                language: settings.language,
                member,
                moderator,
                reason: clean(copy.reason).trim() || words.noReason,
                server: dest.s.guild.name,
                style: config.guilds.find((g) => g.guildId === copy.guild_id)?.leave,
              },
              { avatar: user?.id === copy.target_id ? await fetchAvatar(user) : null },
            );
            files = [{ name: 'cortex-kick.png', type: 'image/png', bytes }];
            body.content =
              words.title +
              '\n' +
              body.embeds[0].fields.map((f) => f.name + ': ' + f.value).join('\n') +
              '\n' +
              body.embeds[0].timestamp;
            body.attachments = [
              { id: 0, filename: 'cortex-kick.png', description: body.content.slice(0, 1024) },
            ];
            delete body.embeds;
          } catch {
            notice('warning', 'KICK_CARD_RENDER_FAILED_FALLBACK');
          }
        } else notice('warning', 'MISSING_ATTACH_FILES_FALLBACK');
        if (isStopping()) return;
        state.seen = [...state.seen, key].slice(-1000);
        atomicJSON(stateFile, state);
        try {
          await api.post(
            '/channels/' + settings.channelId + '/messages',
            body,
            files ? { files } : undefined,
          );
          notice('sent', 'MEMBER_KICK_CONFIRMED');
        } catch {
          notice('unknown', 'KICK_LOG_DELIVERY_UNKNOWN');
        }
      })
      .catch(() => notice('error', 'KICK_LOG_PROCESSING_FAILED'))
      .finally(() => {
        pending--;
        queuedIds.delete(key);
      });
    return queue;
  }
  async function suppressFarewell(event, s) {
    if (!setting(event.guildId)?.enabled || !has(botPermissions(s), P.ViewAuditLog) || isStopping())
      return false;
    const key = event.guildId + ':' + event.user.id;
    if (!recent.has(key)) await sleep(2500);
    const match = recent.get(key);
    recent.delete(key);
    return !!match && now() - match.observed <= 60000;
  }
  return { handle, checkPermissions, suppressFarewell, drain: () => queue };
}
