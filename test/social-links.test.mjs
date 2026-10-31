import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSocialStore } from '../src/social-config.mjs';
import { createSocialLinkReader } from '../src/social-links.mjs';
const guildId = '111111111111111111',
  channelId = '222222222222222222';
function setup(t) {
  const base = path.resolve(os.tmpdir()),
    root = fs.mkdtempSync(path.join(base, 'cortex-social-link-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), base);
    assert.match(path.basename(root), /^cortex-social-link-/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const socialStore = createSocialStore({ root }),
    current = socialStore.read();
  socialStore.save({
    baseRevision: current.revision,
    config: {
      version: 1,
      feeds: [
        {
          id: 'instagram-source',
          guildId,
          channelId,
          platform: 'instagram',
          source: 'creator',
          enabled: false,
          language: 'ar',
        },
      ],
    },
  });
  return {
    root,
    socialStore,
    store: createSocialLinkReader({ root, socialStore }),
    file: path.join(root, 'out', 'desktop-modern', 'social-links.json'),
  };
}
test('compatibility reader restores previous links without rewriting or exposing an obsolete save operation', (t) => {
  const { root, socialStore, store, file } = setup(t),
    link = {
      feedId: 'instagram-source',
      guildId,
      url: 'https://instagram.com/p/Example/',
      caption: 'تعليق محفوظ',
    },
    raw = JSON.stringify({ version: 1, links: [link] });
  fs.writeFileSync(file, raw);
  assert.deepEqual(store.read(), { links: [link] });
  assert.equal(fs.readFileSync(file, 'utf8'), raw);
  assert.equal(store.save, undefined);
  assert.deepEqual(createSocialLinkReader({ root, socialStore }).read(), { links: [link] });
  assert.equal(createSocialLinkReader({ root, socialStore, demo: true }).read().links.length, 0);
});
test('compatibility reader rejects corrupt and unsafe records and hides orphaned source links', (t) => {
  const { store, file } = setup(t),
    link = {
      feedId: 'instagram-source',
      guildId,
      url: 'https://instagram.com/reel/Example/',
      caption: '',
    };
  for (const bad of [
    { ...link, url: 'https://127.0.0.1/secret' },
    { ...link, token: 'never-read' },
    { ...link, caption: 'x'.repeat(1201) },
  ]) {
    fs.writeFileSync(file, JSON.stringify({ version: 1, links: [bad] }));
    assert.throws(() => store.read());
  }
  fs.writeFileSync(
    file,
    JSON.stringify({ version: 1, links: [{ ...link, feedId: 'removed-source' }] }),
  );
  assert.equal(store.read().links.length, 0);
});
