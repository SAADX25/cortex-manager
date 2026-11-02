import { renderWelcomeCard, fetchWelcomeAvatar } from './welcome-card.mjs';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { snapshot } from './api.mjs';
import { atomicJSON, snowflake } from './social-config.mjs';
import { messageProtection } from './messages.mjs';
import { effectiveChannelPermissions, P, has } from './permissions.mjs';
import { welcomeMessage } from './welcome-config.mjs';
export function createWelcomeEngine({
  api,
  config,
  stateFile,
  onStatus = () => {},
  isStopping = () => false,
  renderCard = renderWelcomeCard,
  fetchAvatar = fetchWelcomeAvatar,
  suppressFarewell = async () => false,
}) {
  if (fs.existsSync(stateFile) && fs.statSync(stateFile).size > 128000)
    throw new Error('Welcome state too large.');
  let state = fs.existsSync(stateFile)
    ? JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    : { version: 1, seen: [] };
  if (
    state.version !== 1 ||
    !Array.isArray(state.seen) ||
    state.seen.length > 1000 ||
    state.seen.some((v) => typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v))
  )
    throw new Error('Invalid welcome delivery state.');
  let queue = Promise.resolve(),
    pending = 0;
  const handle = (event) => {
    if (isStopping()) return Promise.resolve();
    if (pending >= 100) {
      onStatus({ component: 'welcome', status: 'error', code: 'QUEUE_FULL' });
      return Promise.resolve();
    }
    pending++;
    queue = queue
      .then(async () => {
        if (isStopping()) return;
        const type =
          event.type === 'GUILD_MEMBER_ADD'
            ? 'join'
            : event.type === 'GUILD_MEMBER_REMOVE'
              ? 'leave'
              : null;
        if (
          !type ||
          !snowflake(event.guildId) ||
          !snowflake(event.user?.id) ||
          event.user.bot ||
          typeof event.session !== 'string' ||
          !event.session ||
          !Number.isSafeInteger(event.sequence)
        )
          return;
        const settings = config.guilds.find((g) => g.guildId === event.guildId)?.[type];
        if (!settings?.enabled) return;
        const key = createHash('sha256')
          .update(
            JSON.stringify([event.session, event.sequence, event.guildId, type, event.user.id]),
          )
          .digest('hex');
        if (state.seen.includes(key)) return;
        const s = await snapshot(api, event.guildId, { includeMembers: false }),
          channel = s.channels.find((c) => c.id === settings.channelId);
        if (type === 'leave' && (await suppressFarewell(event, s))) return;
        if (
          !channel ||
          ![0, 2, 5].includes(channel.type) ||
          messageProtection(s, channel) ||
          !has(effectiveChannelPermissions(s, channel), P.EmbedLinks)
        )
          throw new Error('PERMISSIONS');
        if (isStopping()) return;
        const body = welcomeMessage(settings, {
          user: event.user.global_name ?? event.user.username ?? event.user.id,
          server: s.guild.name,
        });
        if (/^[a-f0-9_]{1,80}$/i.test(event.user.avatar ?? ''))
          body.embeds[0].thumbnail = {
            url: `https://cdn.discordapp.com/avatars/${event.user.id}/${event.user.avatar}.png?size=256`,
          };
        let files;
        if (settings.card?.mode === 'image') {
          if (!has(effectiveChannelPermissions(s, channel), P.AttachFiles))
            onStatus({
              component: 'welcome',
              status: 'warning',
              code: 'MISSING_ATTACH_FILES_FALLBACK',
            });
          else
            try {
              const bytes = await renderCard(
                settings,
                {
                  user: event.user.global_name ?? event.user.username ?? event.user.id,
                  server: s.guild.name,
                },
                { avatar: await fetchAvatar(event.user) },
              );
              files = [{ name: 'cortex-welcome.png', type: 'image/png', bytes }];
              const alt = body.embeds[0].description;
              delete body.embeds;
              body.attachments = [
                { id: 0, filename: 'cortex-welcome.png', description: alt.slice(0, 1024) },
              ];
            } catch {
              onStatus({
                component: 'welcome',
                status: 'warning',
                code: 'CARD_RENDER_FAILED_FALLBACK',
              });
            }
        }
        if (isStopping()) return;
        state.seen = [...state.seen, key].slice(-1000);
        atomicJSON(stateFile, state);
        try {
          await api.post(
            `/channels/${settings.channelId}/messages`,
            { ...body, nonce: key.slice(0, 24), enforce_nonce: true },
            files ? { files } : undefined,
          );
          onStatus({ component: 'welcome', status: 'sent', type });
        } catch {
          onStatus({ component: 'welcome', status: 'unknown', type });
        }
      })
      .catch(() =>
        onStatus({ component: 'welcome', status: 'error', code: 'DELIVERY_OR_STORAGE_FAILED' }),
      )
      .finally(() => {
        pending--;
      });
    return queue;
  };
  return { handle, drain: () => queue };
}
