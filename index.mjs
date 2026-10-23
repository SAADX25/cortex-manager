import { readFileSync } from 'node:fs';

/**
 * Cortex Manager: one-shot Discord server layout creation using only the
 * official HTTP REST API. No persistent gateway connection is required.
 * Default mode is preview; applying changes requires RUN_MODE=apply.
 */

const token = process.env.DISCORD_BOT_TOKEN?.trim();
const guildId = process.env.DISCORD_GUILD_ID?.trim();
const mode = (process.env.RUN_MODE ?? 'preview').trim().toLowerCase();

if (!token) throw new Error('Missing DISCORD_BOT_TOKEN GitHub Actions secret.');
if (!/^\d{16,22}$/.test(guildId ?? '')) {
  throw new Error('Missing or invalid DISCORD_GUILD_ID GitHub Actions variable.');
}
if (!['preview', 'apply'].includes(mode)) {
  throw new Error('RUN_MODE must be preview or apply.');
}

const layout = JSON.parse(readFileSync(new URL('./server-layout.json', import.meta.url), 'utf8'));
if (!Array.isArray(layout.roles) || !Array.isArray(layout.categories)) {
  throw new Error('Invalid server-layout.json: expected roles and categories arrays.');
}

const baseUrl = 'https://discord.com/api/v10';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const normalize = name => String(name ?? '').trim().toLocaleLowerCase();
const typeCode = type => type === 'voice' ? 2 : type === 'text' ? 0 : undefined;
const colorNumber = hex => {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`Invalid role color: ${hex}`);
  return Number.parseInt(hex.slice(1), 16);
};

async function discord(path, { method = 'GET', body } = {}) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
        'X-Audit-Log-Reason': 'Cortex Manager authorized server layout setup'
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000)
    });

    if (response.status === 429) {
      const rateLimit = await response.json().catch(() => ({}));
      const delay = Math.max(1000, Math.ceil(Number(rateLimit.retry_after ?? 1) * 1000));
      if (attempt === 6) throw new Error('Discord rate limit persisted after retries.');
      console.log(`Discord rate limit: retrying in ${delay}ms (attempt ${attempt}/6).`);
      await sleep(delay);
      continue;
    }
    if (response.status >= 500 && attempt < 6) {
      await sleep(Math.min(2000 * attempt, 10000));
      continue;
    }
    if (!response.ok) {
      const details = (await response.text()).slice(0, 700);
      throw new Error(`Discord API ${method} ${path} failed (${response.status}): ${details}`);
    }
    return response.status === 204 ? null : response.json();
  }
  throw new Error('Discord API request failed after retries.');
}

const info = await discord(`/guilds/${guildId}`);
const roles = await discord(`/guilds/${guildId}/roles`);
const channels = await discord(`/guilds/${guildId}/channels`);
console.log(`Server: ${info.name} (${guildId})`);
console.log(`Mode: ${mode === 'apply' ? 'APPLY (create missing items)' : 'PREVIEW (no changes)'}`);

const roleExists = name => roles.some(item => normalize(item.name) === normalize(name));
const channelExists = (name, type) => channels.some(item =>
  normalize(item.name) === normalize(name) && item.type === type
);

for (const role of layout.roles) {
  if (roleExists(role.name)) {
    console.log(`[SKIP] Role exists: ${role.name}`);
    continue;
  }
  if (mode === 'preview') {
    console.log(`[PLAN] Create role: ${role.name}, ${role.color} (no privileged permissions)`);
    continue;
  }
  const created = await discord(`/guilds/${guildId}/roles`, {
    method: 'POST',
    body: {
      name: role.name,
      colors: {
        primary_color: colorNumber(role.color),
        secondary_color: null,
        tertiary_color: null
      },
      permissions: '0',
      hoist: Boolean(role.hoist),
      mentionable: false
    }
  });
  roles.push(created);
  console.log(`[CREATED] Role: ${role.name}`);
  await sleep(300);
}

for (const category of layout.categories) {
  let parent = channels.find(item => item.type === 4 && normalize(item.name) === normalize(category.name));
  if (parent) {
    console.log(`[SKIP] Category exists: ${category.name}`);
  } else if (mode === 'preview') {
    console.log(`[PLAN] Create category: ${category.name}`);
  } else {
    parent = await discord(`/guilds/${guildId}/channels`, {
      method: 'POST',
      body: { name: category.name, type: 4 }
    });
    channels.push(parent);
    console.log(`[CREATED] Category: ${category.name}`);
    await sleep(300);
  }

  for (const channel of category.channels) {
    const type = typeCode(channel.type);
    if (type === undefined) throw new Error(`Unsupported channel type for ${channel.name}`);
    if (channelExists(channel.name, type)) {
      console.log(`[SKIP] Channel already exists somewhere in server: ${channel.name}`);
      continue;
    }
    if (mode === 'preview') {
      console.log(`[PLAN] Create ${channel.type} channel: ${category.name} / ${channel.name}`);
      continue;
    }
    const body = { name: channel.name, type, parent_id: parent.id };
    if (type === 0 && channel.topic) body.topic = channel.topic;
    const created = await discord(`/guilds/${guildId}/channels`, { method: 'POST', body });
    channels.push(created);
    console.log(`[CREATED] ${channel.type} channel: ${category.name} / ${channel.name}`);
    await sleep(300);
  }
}

console.log(mode === 'preview'
  ? 'Preview completed. No changes were made. Re-run workflow with mode=apply after checking the plan.'
  : 'Setup completed. Existing items were not modified or deleted.');
