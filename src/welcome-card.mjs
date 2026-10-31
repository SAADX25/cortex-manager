import fs from 'node:fs';
import { defaultCardStyle, validateCardStyle } from './welcome-card-style.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { welcomeMessage } from './welcome-config.mjs';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
let assets = null,
  rendering = false;
async function loadAssets() {
  if (!assets)
    assets = (async () => {
      const canvas = await import('@napi-rs/canvas');
      if (
        !canvas.GlobalFonts.registerFromPath(
          path.join(ROOT, 'assets/welcome/NotoSansArabic.ttf'),
          'Cortex Arabic',
        )
      )
        throw new Error('Welcome font unavailable.');
      if (
        !canvas.GlobalFonts.registerFromPath(
          path.join(ROOT, 'assets/welcome/NotoEmoji.ttf'),
          'Cortex Emoji',
        )
      )
        throw new Error('Emoji font unavailable.');
      if (
        !canvas.GlobalFonts.registerFromPath(
          path.join(ROOT, 'assets/welcome/NotoSans.ttf'),
          'Cortex Latin',
        )
      )
        throw new Error('Latin font unavailable.');
      return canvas;
    })();
  return assets;
}
function lines(ctx, text, width, max) {
  const output = [];
  let line = '';
  for (const part of String(text).split(/\s+/)) {
    if (ctx.measureText((line ? line + ' ' : '') + part).width <= width) {
      line += (line ? ' ' : '') + part;
      continue;
    }
    if (line) {
      output.push(line);
      line = '';
    }
    for (const c of part) {
      if (ctx.measureText(line + c).width > width) {
        output.push(line);
        line = '';
      }
      line += c;
    }
  }
  if (line) output.push(line);
  if (output.length > max) {
    output.length = max;
    while (ctx.measureText(output[max - 1] + '…').width > width)
      output[max - 1] = output[max - 1].slice(0, -1);
    output[max - 1] += '…';
  }
  return output;
}
export async function renderWelcomeCard(settings, details, { avatar, background } = {}) {
  details = {
    ...details,
    user: String(details.user ?? '').normalize('NFKC'),
    server: String(details.server ?? '').normalize('NFKC'),
  };
  if (rendering) throw new Error('Card preview is busy; try again.');
  rendering = true;
  let surface;
  try {
    const style = validateCardStyle(settings.card ?? defaultCardStyle()),
      a = await loadAssets(),
      canvas = a.createCanvas(1000, 440),
      ctx = canvas.getContext('2d'),
      embed = welcomeMessage(settings, {
        user: String(details.user ?? '').normalize('NFKC'),
        server: String(details.server ?? '').normalize('NFKC'),
      }).embeds[0];
    embed.title = embed.title.normalize('NFKC');
    embed.description = embed.description.normalize('NFKC');
    surface = canvas;
    ctx.fillStyle = '#141c30';
    ctx.fillRect(0, 0, 1000, 440);
    if (!background && /^[a-f0-9]{64}$/.test(style.background)) {
      const file = path.join(ROOT, 'assets/welcome/backgrounds', style.background + '.jpg');
      if (fs.statSync(file).size > 600000) throw new Error('Background too large.');
      background = fs.readFileSync(file);
    }
    if (background) {
      if (background.length > 600000) throw new Error('Background too large.');
      const image = await a.loadImage(background);
      const scale = Math.max(1000 / image.width, 440 / image.height);
      ctx.drawImage(
        image,
        (1000 - image.width * scale) / 2,
        (440 - image.height * scale) / 2,
        image.width * scale,
        image.height * scale,
      );
    }
    ctx.fillStyle = `rgba(6,10,23,${style.overlay})`;
    ctx.fillRect(0, 0, 1000, 440);
    const gradient = ctx.createLinearGradient(0, 0, 1000, 0);
    gradient.addColorStop(0, '#070c1e99');
    gradient.addColorStop(1, '#070c1e33');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1000, 440);
    ctx.strokeStyle = settings.color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(18, 18, 964, 404, 20);
    ctx.stroke();
    const rtl = /\p{Script=Arabic}/u.test(embed.title + ' ' + embed.description),
      cx = rtl ? 850 : 150,
      cy = 220;
    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.arc(cx, cy, 67, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = settings.color;
    ctx.lineWidth = 4;
    ctx.stroke();
    let photo = null;
    if (avatar)
      try {
        photo = await a.loadImage(avatar);
        if (photo.width > 512 || photo.height > 512) photo = null;
      } catch {}
    if (photo) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, 62, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(photo, cx - 62, cy - 62, 124, 124);
      ctx.restore();
    } else {
      ctx.font = '700 46px "Cortex Arabic", "Cortex Latin", "Cortex Emoji"';
      ctx.fillStyle = style.titleColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        Array.from(
          new Intl.Segmenter('ar', { granularity: 'grapheme' }).segment(
            String(details.user ?? '?').trim(),
          ),
        )[0]?.segment ?? '?',
        cx,
        cy,
      );
    }
    const x = rtl ? 740 : 260,
      width = 670,
      family = '"Cortex Arabic", "Cortex Latin", "Cortex Emoji"';
    ctx.direction = rtl ? 'rtl' : 'ltr';
    ctx.textAlign = rtl ? 'right' : 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = '#000000bb';
    ctx.shadowBlur = 5;
    ctx.font = '700 50px ' + family;
    const title = lines(ctx, embed.title, width, 2);
    ctx.font = '400 36px ' + family;
    const body = lines(ctx, embed.description, width, 4);
    const top = Math.max(28, (440 - (title.length * 70 + 24 + body.length * 53)) / 2);
    ctx.font = '700 50px ' + family;
    ctx.fillStyle = style.titleColor;
    title.forEach((line, i) => ctx.fillText(line, x, top + 54 + i * 70));
    ctx.font = '400 36px ' + family;
    ctx.fillStyle = style.textColor;
    body.forEach((line, i) => ctx.fillText(line, x, top + title.length * 70 + 64 + i * 53));
    const bytes = await canvas.encode('png');
    if (bytes.length > 2000000) throw new Error('Welcome card exceeds image size limit.');
    return bytes;
  } finally {
    if (surface) {
      surface.width = 1;
      surface.height = 1;
    }
    rendering = false;
  }
}
export async function fetchWelcomeAvatar(user, { fetchImpl = fetch } = {}) {
  if (!/^\d{16,22}$/.test(user?.id ?? '') || !/^(?:a_)?[a-f0-9]{16,64}$/i.test(user?.avatar ?? ''))
    return null;
  try {
    const r = await fetchImpl(
      `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256`,
      { redirect: 'error', signal: AbortSignal.timeout(5000) },
    );
    if (!r.ok || Number(r.headers.get('content-length')) > 524288) return null;
    const reader = r.body?.getReader();
    if (!reader) return null;
    let size = 0;
    const chunks = [];
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 524288) return null;
        chunks.push(Buffer.from(part.value));
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
    return bytes;
  } catch {
    return null;
  }
}
