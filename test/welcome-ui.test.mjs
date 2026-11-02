import { loadLocaleCatalogs } from './helpers/locales.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { setImmediate } from 'node:timers/promises';
test('welcome UI previews without sending and saves only after explicit confirmation', async () => {
  let html = '',
    dialog = '',
    posts = 0,
    savedBody;
  const actions = [];
  let channels = [
    { id: '777777777777777777', name: 'welcome', type: 0 },
    { id: '777777777777777778', name: 'استقبال الأعضاء', type: 2 },
    { id: '777777777777777779', name: 'announcements', type: '5' },
  ];
  const nodes = new Map(),
    node = (id) => {
      if (!nodes.has(id))
        nodes.set(id, {
          value: '',
          checked: false,
          disabled: false,
          innerHTML: '',
          addEventListener() {},
          attributes: {},
          setAttribute(k, v) {
            this.attributes[k] = v;
          },
          focus() {},
          scrollIntoView() {},
          close() {},
        });
      return nodes.get(id);
    };
  const root = {
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
    structuredClone,
    btoa: globalThis.btoa,
    console,
    window: { CortexI18n: { language: 'en' }, addEventListener() {} },
    model: { page: 'welcome' },
    guildId: () => '111111111111111111',
    guildName: () => 'Test Server',
    busy: () => false,
    action: async (name) => {
      actions.push(name);
      channels.push({ id: '777777777777777780', name: 'new-room', type: 0 });
      context.window.CortexWelcome.render();
    },
    inventory: () => ({ channels }),
    icon: () => '<svg></svg>',
    esc: (value) => String(value).replaceAll('<', '&lt;'),
    apiKey: 'test',
    $: (s) => (s === '#main' ? root : node(s)),
    $$: () => [],
    go() {},
    toast() {},
    showDialog(value) {
      dialog = value;
      for (const [, id] of value.matchAll(/\bid="([^"]+)"/g)) node('#' + id);
    },
    api: async (url, body) => {
      if (url.startsWith('/api/welcome/assets?'))
        return body
          ? {
              asset: { id: 'b'.repeat(64) },
              assets: [
                { id: 'a'.repeat(64), name: 'My background' },
                { id: 'b'.repeat(64), name: body.name },
              ],
            }
          : { assets: [{ id: 'a'.repeat(64), name: 'My background' }] };
      if (url === '/api/welcome/preview') return { type: 'image/png', data: 'aGVsbG8=' };
      assert.equal(url, '/api/welcome');
      if (!body) return { revision: 'one', config: { version: 1, guilds: [] } };
      posts++;
      savedBody = body;
      return { revision: 'two', config: body.config };
    },
  });
  loadLocaleCatalogs(context);
  vm.runInContext(
    fs.readFileSync(new URL('../desktop/web/welcome-ui.js', import.meta.url), 'utf8'),
    context,
  );
  context.window.CortexWelcome.render();
  await setImmediate();
  assert.ok(html.includes('Welcome & farewell'));
  assert.ok(!html.includes('Server Members Intent'));
  assert.equal(posts, 0);
  assert.ok(html.includes('استقبال الأعضاء'));
  assert.ok(html.includes('announcements'));
  node('#welcomeModejoin').value = 'image';
  node('#welcomeModejoin').onchange();
  assert.ok(html.includes('Title color'));
  assert.ok(html.includes('My background'));
  await node('#welcomeBackgroundFilejoin').onchange({
    target: {
      files: [
        {
          name: 'Uploaded.png',
          size: 4,
          arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
        },
      ],
    },
  });
  assert.ok(html.includes('Uploaded.png'));
  node('#welcomeBackgroundjoin').value = 'a'.repeat(64);
  node('#welcomeBackgroundjoin').onchange();
  node('#welcomeTitleColorjoin').value = '#123456';
  node('#welcomeTitleColorjoin').oninput();
  await node('#previewWelcomeImagejoin').onclick();
  assert.ok(node('#welcomePreviewjoin').innerHTML.includes('data:image/png;base64,aGVsbG8='));
  node('#welcomeLanguagejoin').value = 'ar';
  node('#welcomeLanguagejoin').onchange();
  assert.ok(html.includes('أهلًا بك في مجتمعنا'));
  assert.ok(node('#welcomePreviewjoin').innerHTML.includes('عضو جديد'));
  node('#welcomeLanguagejoin').value = 'en';
  node('#welcomeLanguagejoin').onchange();
  assert.ok(html.includes('Welcome to the community'));
  node('#welcomeTitlejoin').value = 'Hello {user}';
  node('#welcomeTitlejoin').oninput();
  assert.ok(node('#welcomePreviewjoin').innerHTML.includes('Hello New member'));
  node('#welcomeLanguagejoin').value = 'ar';
  node('#welcomeLanguagejoin').onchange();
  assert.ok(dialog.includes('Replace custom text'));
  node('#cancelWelcomePreset').onclick();
  assert.ok(node('#welcomePreviewjoin').innerHTML.includes('Hello New member'));
  node('#refreshWelcomeRooms').onclick();
  assert.deepEqual(actions, ['inventory']);
  assert.ok(html.includes('new-room'));
  assert.ok(node('#welcomePreviewjoin').innerHTML.includes('Hello New member'));
  node('#welcomeEnabledjoin').checked = true;
  node('#welcomeEnabledjoin').oninput();
  const oldDialog = dialog;
  node('#saveWelcome').onclick();
  assert.equal(posts, 0);
  assert.equal(dialog, oldDialog);
  assert.ok(html.includes('Choose a destination for this section'));
  assert.equal(node('#welcomeChanneljoin').attributes['aria-invalid'], 'true');
  assert.ok(html.includes('Uploaded.png'));
  assert.ok(html.includes('#123456'));
  node('#welcomeChanneljoin').value = '777777777777777777';
  node('#welcomeChanneljoin').oninput();
  node('#kickEnabled').checked = true;
  node('#kickEnabled').onchange();
  const beforeKick = dialog;
  node('#saveWelcome').onclick();
  assert.equal(dialog, beforeKick);
  assert.equal(posts, 0);
  assert.ok(html.includes('Choose a kick log channel'));
  node('#welcomeChannelkick').value = '777777777777777779';
  node('#welcomeChannelkick').onchange();
  node('#kickLanguage').value = 'en';
  node('#kickLanguage').onchange();
  node('#saveWelcome').onclick();
  assert.equal(posts, 0);
  assert.ok(dialog.includes('Approve & save'));
  await node('#confirmWelcomeSave').onclick();
  assert.equal(posts, 1);
  assert.equal(savedBody.config.guilds[0].kick.enabled, true);
  assert.equal(savedBody.config.guilds[0].kick.channelId, '777777777777777779');
  assert.equal(savedBody.config.guilds[0].kick.language, 'en');
  assert.equal(savedBody.confirmAutomatic, true);
  assert.equal(savedBody.config.guilds[0].join.channelId, '777777777777777777');
  assert.equal(savedBody.config.guilds[0].leave.enabled, false);
  assert.equal(savedBody.config.guilds[0].join.card.titleColor, '#123456');
  assert.equal(savedBody.config.guilds[0].join.card.background, 'a'.repeat(64));
});
