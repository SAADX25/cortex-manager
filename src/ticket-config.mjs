import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { atomicJSON, snowflake } from './social-config.mjs';

export const emptyTickets = () => ({ version: 1, guilds: [] });
export const ticketDefaults = (guildId) => ({
  guildId,
  enabled: false,
  panelChannelId: '',
  categoryId: '',
  staffRoleIds: [],
  requesterRoleIds: [],
  language: 'ar',
});
function keys(value, allowed) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new Error('Invalid ticket settings.');
}
export function validateTickets(value) {
  keys(value, ['version', 'guilds']);
  if (value.version !== 1 || !Array.isArray(value.guilds) || value.guilds.length > 40)
    throw new Error('Invalid ticket settings.');
  const seen = new Set();
  for (const g of value.guilds) {
    keys(g, Object.keys(ticketDefaults('')));
    if (
      !snowflake(g.guildId) ||
      seen.has(g.guildId) ||
      typeof g.enabled !== 'boolean' ||
      !['ar', 'en'].includes(g.language)
    )
      throw new Error('Invalid ticket server.');
    seen.add(g.guildId);
    for (const field of ['panelChannelId', 'categoryId'])
      if (
        typeof g[field] !== 'string' ||
        (g[field] !== '' && !snowflake(g[field])) ||
        (g.enabled && !snowflake(g[field]))
      )
        throw new Error('Choose a ticket panel channel and category.');
    for (const field of ['staffRoleIds', 'requesterRoleIds'])
      if (
        !Array.isArray(g[field]) ||
        g[field].length > 20 ||
        new Set(g[field]).size !== g[field].length ||
        g[field].some((id) => !snowflake(id) || id === g.guildId)
      )
        throw new Error('Choose valid ticket roles; @everyone cannot be a staff role.');
    if (g.enabled && !g.staffRoleIds.length)
      throw new Error('Choose at least one support staff role.');
  }
  return structuredClone(value);
}
export function readTicketFile(file) {
  if (!fs.existsSync(file)) return emptyTickets();
  if (fs.statSync(file).size > 64000) throw new Error('Ticket settings too large.');
  return validateTickets(JSON.parse(fs.readFileSync(file, 'utf8')));
}
const revision = (config) => createHash('sha256').update(JSON.stringify(config)).digest('hex');
export function createTicketStore({ root, demo = false }) {
  const file = path.join(
    root,
    'out',
    'desktop-modern',
    demo ? 'demo-tickets.json' : 'tickets.json',
  );
  const read = () => {
    const config = readTicketFile(file);
    return { config, revision: revision(config) };
  };
  return {
    read,
    save(body) {
      keys(body, ['config', 'baseRevision', 'confirmAutomatic']);
      const current = read();
      if (body.baseRevision !== current.revision)
        throw Object.assign(new Error('Ticket settings changed; reload before saving.'), {
          status: 409,
        });
      const config = validateTickets(body.config);
      if (config.guilds.some((g) => g.enabled) && body.confirmAutomatic !== true)
        throw new Error('Confirm ticket creation and the selected support roles.');
      atomicJSON(file, config);
      return { config, revision: revision(config) };
    },
  };
}
