import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { atomicJSON, snowflake } from './social-config.mjs';
export const assetId = (id) => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id);
function dimensions(b) {
  let w, h;
  if (b.length >= 24 && b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
    w = b.readUInt32BE(16);
    h = b.readUInt32BE(20);
  } else if (b.length > 12 && b[0] === 255 && b[1] === 216) {
    let i = 2;
    while (i + 4 < b.length) {
      if (b[i++] !== 255) throw new Error('Invalid JPEG.');
      while (b[i] === 255) i++;
      const marker = b[i++];
      if (marker === 217 || marker === 218) break;
      if (marker === 216 || marker === 1 || (marker >= 208 && marker <= 215)) continue;
      const len = b.readUInt16BE(i);
      if (len < 2 || i + len > b.length) break;
      if (
        [192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) &&
        len >= 7
      ) {
        h = b.readUInt16BE(i + 3);
        w = b.readUInt16BE(i + 5);
        break;
      }
      i += len;
    }
  } else if (
    b.length >= 30 &&
    b.toString('ascii', 0, 4) === 'RIFF' &&
    b.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8X') {
      w = b.readUIntLE(24, 3) + 1;
      h = b.readUIntLE(27, 3) + 1;
    } else if (kind === 'VP8L' && b[20] === 47) {
      const bits = b.readUInt32LE(21);
      w = (bits & 16383) + 1;
      h = ((bits >>> 14) & 16383) + 1;
    } else if (kind === 'VP8 ' && b.subarray(23, 26).toString('hex') === '9d012a') {
      w = b.readUInt16LE(26) & 16383;
      h = b.readUInt16LE(28) & 16383;
    }
  } else if (b.length >= 13 && ['GIF87a', 'GIF89a'].includes(b.toString('ascii', 0, 6))) {
    w = b.readUInt16LE(6);
    h = b.readUInt16LE(8);
  }
  if (!w || !h || w > 8192 || h > 8192 || w * h > 16000000)
    throw new Error('Use a PNG/JPEG/WebP/GIF image up to 8MB and 16 megapixels.');
  return { w, h };
}
export async function normalizeWelcomeBackground(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 8 * 1024 * 1024)
    throw new Error('Background image exceeds 8MB.');
  dimensions(bytes);
  const { createCanvas, loadImage } = await import('@napi-rs/canvas'),
    img = await loadImage(bytes);
  if (img.width * img.height > 16000000) throw new Error('Image dimensions too large.');
  const canvas = createCanvas(1200, 510),
    ctx = canvas.getContext('2d');
  try {
    const scale = Math.max(1200 / img.width, 510 / img.height);
    ctx.drawImage(
      img,
      (1200 - img.width * scale) / 2,
      (510 - img.height * scale) / 2,
      img.width * scale,
      img.height * scale,
    );
    const result = await canvas.encode('jpeg', 85);
    if (result.length > 600000) throw new Error('Background could not be compressed.');
    return result;
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}
export function createWelcomeAssetStore({ root, demo = false }) {
  const base = path.join(
      root,
      'out',
      'desktop-modern',
      demo ? 'demo-welcome-images' : 'welcome-images',
    ),
    indexFile = path.join(base, 'index.json');
  const read = () => {
    if (!fs.existsSync(indexFile)) return [];
    if (fs.statSync(indexFile).size > 128000) throw new Error('Image library index too large.');
    const value = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    if (
      value.version !== 1 ||
      !Array.isArray(value.assets) ||
      value.assets.length > 200 ||
      value.assets.some(
        (a) =>
          !assetId(a.id) ||
          !snowflake(a.guildId) ||
          typeof a.name !== 'string' ||
          a.name.length > 100,
      )
    )
      throw new Error('Invalid image library.');
    return value.assets;
  };
  const list = (guildId) => {
    if (!snowflake(guildId)) throw new Error('Choose a server.');
    return read().filter((a) => a.guildId === guildId);
  };
  const bytes = (id, guildId) => {
    if (!assetId(id) || !list(guildId).some((a) => a.id === id))
      throw new Error('Background image is not in this server library.');
    const file = path.join(base, id + '.jpg');
    if (fs.statSync(file).size > 600000) throw new Error('Background too large.');
    const data = fs.readFileSync(file);
    if (createHash('sha256').update(data).digest('hex') !== id)
      throw new Error('Background image changed.');
    return data;
  };
  let uploading = false;
  return {
    list,
    bytes,
    async add({ guildId, name, data }) {
      if (uploading) throw new Error('Another image is uploading.');
      if (
        !snowflake(guildId) ||
        typeof name !== 'string' ||
        !name.trim() ||
        name.length > 100 ||
        typeof data !== 'string' ||
        data.length > 11184812 ||
        /[^A-Za-z0-9+/=]/.test(data)
      )
        throw new Error('Invalid background upload.');
      const raw = Buffer.from(data, 'base64');
      if (raw.toString('base64') !== data) throw new Error('Invalid background image.');
      uploading = true;
      try {
        const normalized = await normalizeWelcomeBackground(raw),
          id = createHash('sha256').update(normalized).digest('hex'),
          assets = read(),
          found = assets.find((a) => a.id === id && a.guildId === guildId);
        if (found) return found;
        if (assets.length >= 200 || assets.filter((a) => a.guildId === guildId).length >= 20)
          throw new Error('Image library limit reached (20 per server).');
        const entry = {
          id,
          guildId,
          name: name.trim(),
          createdAt: new Date().toISOString(),
          bytes: normalized.length,
        };
        fs.mkdirSync(base, { recursive: true });
        fs.writeFileSync(path.join(base, id + '.jpg'), normalized);
        atomicJSON(indexFile, { version: 1, assets: [...assets, entry] });
        return entry;
      } finally {
        uploading = false;
      }
    },
    remove({ guildId, id }, welcome) {
      if (!assetId(id) || !snowflake(guildId)) throw new Error('Invalid image selection.');
      if (
        welcome.guilds.some(
          (g) =>
            g.guildId === guildId && ['join', 'leave'].some((t) => g[t].card?.background === id),
        )
      )
        throw new Error(
          'This image is used by saved settings. Choose another background and save before deleting.',
        );
      const assets = read();
      if (!assets.some((a) => a.guildId === guildId && a.id === id))
        throw new Error('Image not found.');
      const next = assets.filter((a) => a.guildId !== guildId || a.id !== id);
      atomicJSON(indexFile, { version: 1, assets: next });
      if (!next.some((a) => a.id === id)) fs.unlinkSync(path.join(base, id + '.jpg'));
      return list(guildId);
    },
  };
}
