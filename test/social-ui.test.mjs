import { loadLocaleCatalogs } from './helpers/locales.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { setImmediate } from 'node:timers/promises';

test('social studio renders all four English platform names and keeps controls disabled during a pending save', async () => {
  const nodes = new Map(),
    listeners = {},
    feed = {
      id: 'one',
      guildId: '111111111111111111',
      channelId: '777777777777777777',
      platform: 'tiktok',
      source: 'creator',
      enabled: false,
      language: 'en',
    };
  let html = '',
    dialogHTML = '',
    resolveSave,
    posts = 0;
  const actions = [];
  let savedLink = {
    feedId: feed.id,
    guildId: feed.guildId,
    url: 'https://tiktok.com/@creator/video/123',
    caption: 'Keep this caption',
  };
  const node = (id) => {
    if (!nodes.has(id))
      nodes.set(id, {
        value: '',
        checked: false,
        disabled: false,
        addEventListener() {},
        reportValidity() {
          return true;
        },
        open: false,
        close() {
          this.open = false;
        },
      });
    return nodes.get(id);
  };
  const main = {
    set innerHTML(value) {
      html = value;
      nodes.clear();
      for (const [, id] of value.matchAll(/\bid="([^"]+)"/g)) node('#' + id);
    },
    get innerHTML() {
      return html;
    },
  };
  const context = vm.createContext({
    console,
    crypto: globalThis.crypto,
    btoa: globalThis.btoa,
    setTimeout,
    URL,
    window: {
      CortexI18n: { language: 'en' },
      addEventListener: (name, fn) => (listeners[name] = fn),
    },
    model: { page: 'social', state: { demo: false } },
    guildId: () => feed.guildId,
    inventory: () => ({ channels: [{ id: feed.channelId, name: 'test-room', type: 0 }] }),
    busy: () => false,
    guildName: () => 'Example',
    icon: (name) => `<svg data-icon="${name}"></svg>`,
    esc: (value) => String(value ?? '').replaceAll('<', '&lt;'),
    toast() {},
    showDialog(value) {
      dialogHTML = value;
      node('#confirmDialog').open = true;
      for (const [, id] of value.matchAll(/\bid="([^"]+)"/g)) node('#' + id);
    },
    action(name, extra) {
      actions.push(name);
      if (name === 'message-preview') {
        context.model.state.messagePreview = {
          ...extra.messageRequest,
          channelName: 'test-room',
          approvalHash: 'reviewed',
        };
        context.render();
      }
    },
    api: async (url, body) => {
      if (url === '/api/social/validate')
        return {
          config: {
            ...body,
            feeds: body.feeds.map((f) =>
              f.platform === 'youtube' ? { ...f, source: 'UC2kbSW84Vq-ytyAxlynZjog' } : f,
            ),
          },
        };
      if (url === '/api/social/links') return { revision: 'links-1', links: [{ ...savedLink }] };
      if (url === '/api/social/manual') {
        const image = body.captureThumbnail
          ? { type: 'image/png', data: 'iVBORw0KGgo=', sha256: 'thumbnail-hash' }
          : undefined;
        return {
          request: { channelId: body.channelId, content: body.url, ...(image ? { image } : {}) },
          thumbnail: { status: image ? 'ready' : 'not-requested' },
        };
      }
      if (!body)
        return {
          revision: 'first',
          config: {
            version: 1,
            feeds: [
              { ...feed },
              { ...feed, id: 'kick-source', platform: 'kick', source: 'xluffy-jo' },
              { ...feed, id: 'instagram-source', platform: 'instagram', source: 'luffygamingjo' },
              { ...feed, id: 'youtube-source', platform: 'youtube', source: 'UC' + 'a'.repeat(22) },
              { ...feed, id: 'other-tiktok', source: 'other_creator' },
            ],
          },
        };
      posts++;
      return new Promise((resolve) => {
        resolveSave = resolve;
      });
    },
    $: (selector) => (selector === '#main' ? main : node(selector)),
    $$: (selector) =>
      selector === '[data-social-rss]'
        ? [Object.assign(node('rss'), { dataset: { socialRss: 'instagram-source' } })]
        : selector === '[data-social-toggle]'
          ? [{ ...node('toggle'), dataset: { socialToggle: 'one' } }]
          : selector === '[data-social-remove]'
            ? [Object.assign(node('remove'), { dataset: { socialRemove: 'one' } })]
            : selector === '[data-social-platform]'
              ? Object.keys({ youtube: 1, kick: 1, instagram: 1, tiktok: 1 }).map((platform) =>
                  Object.assign(node(platform), { dataset: { socialPlatform: platform } }),
                )
              : selector.startsWith('input,')
                ? [node('#socialSource'), node('#socialChannel'), node('#socialCaption')]
                : [],
  });
  loadLocaleCatalogs(context);
  vm.runInContext(
    fs.readFileSync(new URL('../desktop/web/social-ui.js', import.meta.url), 'utf8'),
    context,
  );
  context.render = () => context.window.CortexSocial.render();
  context.render();
  await setImmediate();
  for (const name of ['YouTube', 'Kick', 'Instagram', 'TikTok']) assert.ok(html.includes(name));
  assert.ok(html.includes('Notification sources'));
  assert.ok(html.includes('data-social-platform="tiktok"'));
  assert.ok(html.includes('social-source-link tiktok'));
  assert.ok(html.includes('href="' + savedLink.url + '"'));
  assert.ok(html.includes('href="https://kick.com/xluffy-jo"'));
  assert.ok(html.includes('href="https://www.instagram.com/luffygamingjo/"'));
  assert.ok(html.includes('href="https://www.youtube.com/channel/UC' + 'a'.repeat(22) + '"'));
  assert.ok(html.includes('href="https://www.tiktok.com/@other_creator"'));
  assert.ok(html.includes('target="_blank" rel="noopener noreferrer"'));
  assert.ok(!html.includes('data-social-compose'));
  assert.ok(!html.includes('savedSourceURL'));
  assert.equal(posts, 0);
  assert.deepEqual(actions, []);
  node('rss').onclick();
  assert.ok(dialogHTML.includes('Connect Instagram via RSS'));
  node('#instagramRSSURL').value = 'https://rss.app/feeds/0Jtxh0Ews2TCWbLm.xml';
  node('#instagramRSSEnabled').checked = false;
  const rssSave = node('#saveInstagramRSS').onclick();
  assert.equal(posts, 1);
  assert.equal(node('#socialCaption').disabled, true);
  resolveSave({
    revision: 'rss-saved',
    config: {
      version: 1,
      feeds: [
        { ...feed },
        {
          ...feed,
          id: 'instagram-source',
          platform: 'instagram',
          source: 'luffygamingjo',
          enabled: false,
          rssURL: 'https://rss.app/feeds/0Jtxh0Ews2TCWbLm.xml',
        },
      ],
    },
  });
  await rssSave;
  assert.ok(html.includes('RSS · '));
  assert.equal(node('#socialCaption').disabled, false);
  posts = 0;
  node('remove').onclick();
  assert.ok(dialogHTML.includes('Do you want to delete this source?'));
  assert.ok(dialogHTML.includes('creator'));
  assert.ok(!html.includes('Unsaved changes'));
  node('#cancelSocialRemove').onclick();
  assert.ok(!html.includes('Unsaved changes'));
  assert.equal(posts, 0);
  context.window.CortexI18n.language = 'ar';
  context.render();
  node('remove').onclick();
  assert.ok(dialogHTML.includes('هل تريد حذف هذا المصدر؟'));
  assert.ok(dialogHTML.includes('إلغاء'));
  node('#confirmSocialRemove').onclick();
  context.window.CortexI18n.language = 'en';
  context.render();
  assert.ok(html.includes('Unsaved changes'));
  assert.equal(posts, 0);
  const pending = node('#saveSocial').onclick();
  assert.equal(posts, 1);
  assert.equal(node('#socialSource').disabled, true);
  assert.equal(node('#socialCaption').disabled, true);
  resolveSave({ revision: 'second', config: { version: 1, feeds: [] } });
  await pending;
  assert.equal(node('#socialSource').disabled, false);
  assert.ok(!html.includes('Unsaved changes'));
  assert.ok(!html.includes('type="file"'));
  assert.ok(html.includes('Automatically fetch the Instagram post thumbnail'));
  node('#socialManualChannel').value = feed.channelId;
  node('#socialURL').value = 'https://kick.com/creator';
  node('#socialManualForm').onsubmit({ preventDefault() {} });
  await setImmediate();
  assert.deepEqual(actions, ['message-preview']);
  assert.ok(html.includes('Preview ready — message not sent yet'));
  assert.ok(html.includes('Send to Discord'));
  assert.equal(node('#socialSend').disabled, false);
  node('#socialSend').onclick();
  assert.deepEqual(actions, ['message-preview']);
  node('#confirmSocialSend').onclick();
  assert.deepEqual(actions, ['message-preview', 'message-send']);
  node('#socialManualChannel').value = feed.channelId;
  node('#socialURL').value = 'https://instagram.com/p/example/';
  node('#socialAutoThumbnail').checked = true;
  node('#socialManualForm').onsubmit({ preventDefault() {} });
  await setImmediate();
  assert.ok(html.includes('data:image/png;base64,'));
  assert.ok(html.includes('Preview ready — message not sent yet'));
  assert.equal(node('#socialSend').disabled, false);
  context.window.CortexI18n.language = 'ar';
  context.render();
  assert.ok(html.includes('مصادر الإشعارات'));
  assert.ok(html.includes('TikTok'));
  node('#socialPlatform').value = 'youtube';
  node('#socialSource').value = 'https://www.youtube.com/@Luffy-Gaming-JO';
  node('#socialChannel').value = feed.channelId;
  node('#socialLanguage').value = 'en';
  node('#socialSourceForm').onsubmit({ preventDefault() {} });
  await setImmediate();
  assert.ok(html.includes('UC2kbSW84Vq-ytyAxlynZjog'));
  assert.ok(html.includes('تغييرات غير محفوظة'));
  assert.equal(node('#socialSource').disabled, false);
});
