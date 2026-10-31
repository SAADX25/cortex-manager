import { createHash } from 'node:crypto';

export const CONFIRMATION = 'DELETE_ALL_OLD_CHANNELS_AND_ROLES';

export function roleProtection(s, r) {
  if (r.id === s.guild.id) return '@everyone';
  if (
    r.managed ||
    r.tags?.bot_id ||
    r.tags?.integration_id ||
    'premium_subscriber' in (r.tags ?? {})
  )
    return 'Discord/integration-managed role';
  if (s.botMember.roles.includes(r.id)) return 'role assigned to Cortex Manager';
  const top = Math.max(
    0,
    ...s.roles.filter((x) => s.botMember.roles.includes(x.id)).map((x) => x.position),
  );
  if (r.position >= top) return 'role at or above the bot hierarchy';
  return null;
}

export function protectedChannelIds(s) {
  const ids = new Set(
    [
      s.guild.rules_channel_id,
      s.guild.public_updates_channel_id,
      s.guild.safety_alerts_channel_id,
      s.guild.system_channel_id,
      s.guild.afk_channel_id,
      s.guild.widget_channel_id,
      ...s.channels.filter((c) => ['rules', 'moderator-only'].includes(c.name)).map((c) => c.id),
    ].filter(Boolean),
  );
  return ids;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
export const digest = (value) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
const ordered = (xs) => [...xs].sort((a, b) => a.id.localeCompare(b.id));
export function configuration(s) {
  const guildKeys = [
    'id',
    'owner_id',
    'rules_channel_id',
    'public_updates_channel_id',
    'safety_alerts_channel_id',
    'system_channel_id',
    'afk_channel_id',
    'widget_channel_id',
    'features',
  ];
  const channelKeys = [
    'id',
    'name',
    'type',
    'parent_id',
    'position',
    'topic',
    'nsfw',
    'rate_limit_per_user',
    'user_limit',
    'bitrate',
    'flags',
  ];
  return {
    guild: Object.fromEntries(
      guildKeys.map((k) => [
        k,
        k === 'features' ? [...(s.guild.features ?? [])].sort() : (s.guild[k] ?? null),
      ]),
    ),
    bot: s.bot.id,
    botRoles: [...s.botMember.roles].sort(),
    roles: ordered(s.roles),
    channels: ordered(s.channels).map((c) => ({
      ...Object.fromEntries(channelKeys.map((k) => [k, c[k] ?? null])),
      permission_overwrites: ordered(c.permission_overwrites ?? []),
    })),
    membersComplete: s.membersComplete === true,
    members: ordered(s.members ?? []).map((m) => ({ id: m.id, roles: [...m.roles].sort() })),
  };
}
export const fingerprint = (s) => digest(configuration(s));

export function assertConfirmation(env, guildId) {
  if (!guildId || env.CONFIRM_GUILD_ID !== guildId || env.CONFIRM_DELETE !== CONFIRMATION) {
    throw new Error(`Rebuild requires the exact guild ID and ${CONFIRMATION}.`);
  }
}

// All rebuild writes pass through this allowlist. No kick, ban, full member edit,
// role reorder, guild edit/delete, or protected-role mutation is expressible.
export function guardedAPI(api, s, p) {
  const mutableRoles = new Set(Object.values(p.reusedRoles));
  const preservedChannels = new Set(p.keepChannels.map((c) => c.id));
  const mutableChannels = new Set(
    [
      ...Object.values(p.reusedCategories),
      ...Object.values(p.reusedChannels),
      ...p.oldChannels.map((c) => c.id),
    ].filter((id) => !preservedChannels.has(id)),
  );
  const deletableRoles = new Set(p.oldRoles.map((r) => r.id));
  const deletableChannels = new Set(p.oldChannels.map((c) => c.id));
  const prefix = `/guilds/${s.guild.id}`;
  return {
    get: (path) => api.get(path),
    async call(method, path, body) {
      let allowed = false;
      if (method === 'POST' && path === `${prefix}/roles`) allowed = true;
      if (method === 'POST' && path === `${prefix}/channels`) allowed = true;
      const role = path.match(/^\/guilds\/\d+\/roles\/(\d+)$/)?.[1];
      if (path === `${prefix}/roles/${role}`) {
        if (method === 'PATCH') allowed = mutableRoles.has(role);
        if (method === 'DELETE') allowed = deletableRoles.has(role);
        if (s.roles.some((r) => r.id === role && roleProtection(s, r))) allowed = false;
      }
      const channel = path.match(/^\/channels\/(\d+)$/)?.[1];
      if (channel)
        allowed =
          method === 'PATCH'
            ? mutableChannels.has(channel)
            : method === 'DELETE' && deletableChannels.has(channel);
      const messageChannel = path.match(/^\/channels\/(\d+)\/messages$/)?.[1];
      if (method === 'POST' && messageChannel && mutableChannels.has(messageChannel))
        allowed = true;
      const assignment = path.match(/^\/guilds\/(\d+)\/members\/(\d+)\/roles\/(\d+)$/);
      if (method === 'PUT' && assignment?.[1] === s.guild.id && mutableRoles.has(assignment[3]))
        allowed = true;
      if (!allowed) throw new Error(`Safety guard rejected ${method} ${path}`);
      const targetRole = role ?? assignment?.[3];
      if (targetRole) {
        const roles = await api.get(`${prefix}/roles`);
        const botMember = await api.get(`${prefix}/members/${s.bot.id}`);
        const current = roles.find((r) => r.id === targetRole);
        if (!current || roleProtection({ ...s, roles, botMember }, current))
          throw new Error(`Safety guard rejected protected role ${targetRole}`);
      }
      const result = await api.call(method, path, body);
      if (method === 'POST' && path === `${prefix}/roles`) mutableRoles.add(result.id);
      if (method === 'POST' && path === `${prefix}/channels`) mutableChannels.add(result.id);
      return result;
    },
  };
}
