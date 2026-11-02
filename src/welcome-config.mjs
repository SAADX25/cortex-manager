import { validateCardStyle } from './welcome-card-style.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { atomicJSON, snowflake } from './social-config.mjs';
export const emptyWelcome = () => ({ version: 1, guilds: [] });
export function welcomeDefaults(guildId) {
  return {
    guildId,
    join: {
      enabled: false,
      channelId: '',
      title: 'أهلًا بك في مجتمعنا 👋',
      message: 'مرحبًا {user}! سعداء بانضمامك إلى {server}. نتمنى لك وقتًا ممتعًا معنا.',
      color: '#9888ff',
    },
    leave: {
      enabled: false,
      channelId: '',
      title: 'إلى اللقاء 👋',
      message: 'غادر {user} مجتمع {server}. نتمنى له كل التوفيق.',
      color: '#f19b73',
    },
  };
}
const keys = (v, list) => {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !list.includes(k))
  )
    throw new Error('Invalid welcome configuration.');
};
export function validateWelcome(value) {
  keys(value, ['version', 'guilds']);
  if (value.version !== 1 || !Array.isArray(value.guilds) || value.guilds.length > 40)
    throw new Error('Invalid welcome configuration.');
  const seen = new Set();
  for (const g of value.guilds) {
    keys(g, ['guildId', 'join', 'leave', 'kick']);
    if (g.kick !== undefined) {
      keys(g.kick, ['enabled', 'channelId', 'language']);
      if (
        typeof g.kick.enabled !== 'boolean' ||
        typeof g.kick.channelId !== 'string' ||
        (g.kick.channelId !== '' && !snowflake(g.kick.channelId)) ||
        (g.kick.enabled && !snowflake(g.kick.channelId)) ||
        !['ar', 'en'].includes(g.kick.language)
      )
        throw new Error('Choose a valid kick notification channel and language.');
    }
    if (!snowflake(g.guildId) || seen.has(g.guildId))
      throw new Error('Invalid or duplicate welcome server.');
    seen.add(g.guildId);
    for (const type of ['join', 'leave']) {
      const v = g[type];
      if (v?.card !== undefined) validateCardStyle(v.card);
      keys(v, ['enabled', 'channelId', 'title', 'message', 'color', 'card']);
      const invalid = (field, message) => {
        throw Object.assign(
          new Error((type === 'join' ? 'Welcome' : 'Farewell') + ': ' + message),
          { welcomeType: type, field },
        );
      };
      if (typeof v.enabled !== 'boolean') invalid('enabled', 'enable state must be a boolean.');
      if (
        typeof v.channelId !== 'string' ||
        (v.channelId !== '' && !snowflake(v.channelId)) ||
        (v.enabled && !snowflake(v.channelId))
      )
        invalid('channelId', 'choose a destination channel before enabling automatic messages.');
      if (typeof v.title !== 'string' || !v.title.trim() || v.title.length > 100)
        invalid('title', 'enter a title of 1–100 characters.');
      if (typeof v.message !== 'string' || !v.message.trim() || v.message.length > 1200)
        invalid('message', 'enter a message of 1–1200 characters.');
      if (!/^#[a-f0-9]{6}$/i.test(v.color ?? '')) invalid('color', 'choose a valid card color.');
    }
  }
  return structuredClone(value);
}
export function readWelcomeFile(file) {
  if (!fs.existsSync(file)) return emptyWelcome();
  if (fs.statSync(file).size > 128000) throw new Error('Welcome settings too large.');
  return validateWelcome(JSON.parse(fs.readFileSync(file, 'utf8')));
}
const revision = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function createWelcomeStore({ root, demo = false }) {
  const file = path.join(
    root,
    'out',
    'desktop-modern',
    demo ? 'demo-welcome.json' : 'welcome.json',
  );
  const read = () => {
    const config = readWelcomeFile(file);
    return { config, revision: revision(config) };
  };
  return {
    read,
    save(body) {
      keys(body, ['config', 'baseRevision', 'confirmAutomatic']);
      const current = read();
      if (body.baseRevision !== current.revision)
        throw Object.assign(new Error('Welcome settings changed; reload before saving.'), {
          status: 409,
        });
      const config = validateWelcome(body.config);
      if (
        config.guilds.some((g) => g.kick?.enabled || ['join', 'leave'].some((t) => g[t].enabled)) &&
        body.confirmAutomatic !== true
      )
        throw new Error('Confirm automatic welcome messages.');
      atomicJSON(file, config);
      return { config, revision: revision(config) };
    },
  };
}
export function welcomeMessage(settings, { user, server }) {
  const safe = (v) =>
      String(v ?? '')
        .replace(/[@`*_~|<>\[\]\\]/g, '')
        .slice(0, 100),
    replace = (v) =>
      v.replace(/\{(user|server)\}/g, (_, key) => safe(key === 'user' ? user : server));
  return {
    embeds: [
      {
        title: replace(settings.title).slice(0, 256),
        description: replace(settings.message).slice(0, 4096),
        color: parseInt(settings.color.slice(1), 16),
      },
    ],
    allowed_mentions: { parse: [], replied_user: false },
  };
}
