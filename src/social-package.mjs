import { createWelcomeAssetStore, assetId } from './welcome-assets.mjs';
import { validateWelcome, emptyWelcome } from './welcome-config.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { validateSocial } from './social-config.mjs';
import { validateTickets, emptyTickets } from './ticket-config.mjs';

// Explicit allowlist: no vault, .env, out, desktop bridge, .git or rebuild entry point.
export const HOSTED_FILES = [
  'src/ticket-config.mjs',
  'src/ticket-engine.mjs',
  'src/ticket-locales.mjs',
  'src/ticket-status.mjs',
  'src/ticket-intake.mjs',
  'src/welcome-card.mjs',
  'src/kick-notifications.mjs',
  'src/kick-card.mjs',
  'src/notification-locales.mjs',
  'src/welcome-card-style.mjs',
  'assets/welcome/NotoSans.ttf',
  'assets/welcome/OFL-Latin.txt',
  'assets/welcome/NotoSansArabic.ttf',
  'assets/welcome/OFL-Arabic.txt',
  'assets/welcome/NotoEmoji.ttf',
  'assets/welcome/OFL-Emoji.txt',
  'src/welcome-config.mjs',
  'src/welcome-engine.mjs',
  'src/hosted-bot.mjs',
  'src/social-config.mjs',
  'src/instagram-rss.mjs',
  'src/social-providers.mjs',
  'src/social-engine.mjs',
  'src/api.mjs',
  'src/gateway.mjs',
  'src/messages.mjs',
  'src/message-image.mjs',
  'src/permissions.mjs',
  'src/safety.mjs',
  'deploy/Discloud.md',
  'deploy/ENVIRONMENT.example',
];
const crc32 = (data) => {
  let n = 0xffffffff;
  for (const byte of data) {
    n ^= byte;
    for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  }
  return (n ^ 0xffffffff) >>> 0;
};
export function zipStored(files) {
  const blocks = [],
    central = [];
  let offset = 0;
  for (const [filename, value] of Object.entries(files)) {
    const name = Buffer.from(filename),
      data = Buffer.from(value),
      crc = crc32(data),
      local = Buffer.alloc(30),
      header = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    header.writeUInt32LE(0x02014b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x800, 8);
    header.writeUInt16LE(0x21, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    blocks.push(local, name, data);
    central.push(header, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...blocks, directory, end]);
}
export function hostedPackage(root, config, welcome = emptyWelcome(), tickets = emptyTickets()) {
  config = validateSocial(config);
  const files = Object.fromEntries(
    HOSTED_FILES.map((name) => [name, fs.readFileSync(path.join(root, name))]),
  );
  files['package.json'] = JSON.stringify(
    {
      name: 'cortex-social-bot',
      version: '1.0.0',
      private: true,
      type: 'module',
      engines: { node: '>=22.9' },
      dependencies: { '@napi-rs/canvas': '1.1.0' },
      scripts: { start: 'node --env-file-if-exists=.env src/hosted-bot.mjs' },
    },
    null,
    2,
  );
  files['discloud.config'] =
    'NAME=Cortex Social Bot\nTYPE=bot\nMAIN=src/hosted-bot.mjs\nRAM=100\nVERSION=latest\nSTART=node --env-file-if-exists=.env src/hosted-bot.mjs\n';
  welcome = validateWelcome(welcome);
  const library = createWelcomeAssetStore({ root });
  for (const guild of welcome.guilds)
    for (const type of ['join', 'leave']) {
      const id = guild[type].card?.background;
      if (assetId(id))
        files['assets/welcome/backgrounds/' + id + '.jpg'] = library.bytes(id, guild.guildId);
    }
  files['config/welcome.json'] = JSON.stringify(welcome, null, 2);
  files['config/tickets.json'] = JSON.stringify(validateTickets(tickets), null, 2);
  files['config/social-feeds.json'] = JSON.stringify(config, null, 2);
  return zipStored(files);
}
