import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { createWelcomeAssetStore, normalizeWelcomeBackground } from '../src/welcome-assets.mjs';
import { welcomeDefaults } from '../src/welcome-config.mjs';
import { hostedPackage, HOSTED_FILES } from '../src/social-package.mjs';
import { fileURLToPath } from 'node:url';
const guildId = '111111111111111111',
  other = '999999999999999999';
function temp(t) {
  const base = path.resolve(os.tmpdir()),
    dir = fs.mkdtempSync(path.join(base, 'cortex-image-library-'));
  t.after(() => {
    assert.equal(path.dirname(dir), base);
    assert.match(path.basename(dir), /^cortex-image-library-/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
const image = async () => {
  const c = createCanvas(120, 60),
    ctx = c.getContext('2d');
  ctx.fillStyle = '#f19442';
  ctx.fillRect(0, 0, 120, 60);
  return c.encode('png');
};
test('uploaded backgrounds are normalized, deduplicated, scoped to a guild and protected while in use', async (t) => {
  const root = temp(t),
    store = createWelcomeAssetStore({ root }),
    data = (await image()).toString('base64');
  const a = await store.add({ guildId, name: 'My background', data });
  assert.equal((await store.add({ guildId, name: 'duplicate', data })).id, a.id);
  assert.equal(store.list(guildId).length, 1);
  assert.equal(store.list(other).length, 0);
  assert.throws(() => store.bytes(a.id, other));
  assert.ok(store.bytes(a.id, guildId).length < 600000);
  const g = welcomeDefaults(guildId);
  g.join.card = {
    mode: 'image',
    background: a.id,
    titleColor: '#ffffff',
    textColor: '#ffffff',
    overlay: 0.66,
  };
  assert.throws(() => store.remove({ guildId, id: a.id }, { version: 1, guilds: [g] }), /used/);
  store.remove({ guildId, id: a.id }, { version: 1, guilds: [] });
  assert.equal(store.list(guildId).length, 0);
  assert.throws(() => store.bytes(a.id, guildId));
});
test('background uploads reject SVG, traversal, oversize and oversized pixel dimensions before decoding', async (t) => {
  const store = createWelcomeAssetStore({ root: temp(t) });
  await assert.rejects(store.add({ guildId: '../escape', name: 'bad', data: 'eA==' }));
  await assert.rejects(normalizeWelcomeBackground(Buffer.from('<svg/>')));
  await assert.rejects(normalizeWelcomeBackground(Buffer.alloc(8 * 1024 * 1024 + 1)));
  const png = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(png);
  png.writeUInt32BE(65535, 16);
  png.writeUInt32BE(65535, 20);
  await assert.rejects(normalizeWelcomeBackground(png));
});

test('export includes only the selected library images and rejects images owned by another server', async (t) => {
  const root = temp(t),
    project = fileURLToPath(new URL('../', import.meta.url));
  for (const name of HOSTED_FILES) {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(project, name), target);
  }
  const store = createWelcomeAssetStore({ root }),
    a = await store.add({
      guildId,
      name: 'Chosen image',
      data: (await image()).toString('base64'),
    });
  const g = welcomeDefaults(guildId);
  g.join.card = {
    mode: 'image',
    background: a.id,
    titleColor: '#ffffff',
    textColor: '#ffffff',
    overlay: 0.66,
  };
  const zip = hostedPackage(root, { version: 1, feeds: [] }, { version: 1, guilds: [g] });
  assert.ok(zip.includes(Buffer.from('assets/welcome/backgrounds/' + a.id + '.jpg')));
  assert.ok(!zip.includes(Buffer.from('storm.jpg')));
  g.guildId = other;
  assert.throws(
    () => hostedPackage(root, { version: 1, feeds: [] }, { version: 1, guilds: [g] }),
    /not in this server library/,
  );
});
