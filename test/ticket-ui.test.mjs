import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import { loadLocaleCatalogs } from './helpers/locales.mjs';

test('ticket UI preserves role IDs and drafts across languages, and saves reviewed settings only', async () => {
  const guild = '111111111111111111',
    staff = '555555555555555555';
  let html = '',
    dialog = '',
    body,
    posts = 0;
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id))
      nodes.set(id, {
        value: '',
        checked: false,
        disabled: false,
        addEventListener() {},
        close() {},
      });
    return nodes.get(id);
  };
  const root = {
    set innerHTML(value) {
      html = value;
      nodes.clear();
    },
    get innerHTML() {
      return html;
    },
  };
  const listeners = {};
  const context = vm.createContext({
    structuredClone,
    window: {
      CortexI18n: { language: 'ar' },
      addEventListener: (name, fn) => (listeners[name] = fn),
    },
    model: { page: 'tickets', state: {} },
    guildId: () => guild,
    guildName: () => '<My Server>',
    busy: () => false,
    inventory: () => ({
      channels: [
        { id: '777777777777777777', name: '<help>', type: 0 },
        { id: '666666666666666666', name: 'Support', type: 4 },
      ],
      roles: [
        { id: guild, name: '@everyone' },
        { id: staff, name: '<Admins>' },
      ],
    }),
    icon: () => '',
    esc: (value) => String(value ?? '').replaceAll('<', '&lt;'),
    $: (s) => (s === '#main' ? root : node(s)),
    $$: () => [],
    showDialog: (value) => (dialog = value),
    toast() {},
    api: async (_url, candidate) => {
      if (candidate) {
        posts++;
        body = candidate;
      }
      return {
        revision: 'revision',
        config: candidate?.config ?? {
          version: 1,
          guilds: [
            {
              guildId: guild,
              enabled: true,
              panelChannelId: '777777777777777777',
              categoryId: '666666666666666666',
              staffRoleIds: [staff],
              requesterRoleIds: [],
              language: 'ar',
            },
          ],
        },
      };
    },
  });
  loadLocaleCatalogs(context);
  vm.runInContext(
    fs.readFileSync(new URL('../desktop/web/ticket-ui.js', import.meta.url), 'utf8'),
    context,
  );
  context.window.CortexTickets.render();
  await setImmediate();
  assert.ok(html.includes('&lt;Admins>'));
  assert.ok(html.includes('🔴 بانتظار الاستلام'));
  assert.ok(html.includes('🟡 تم الاستلام'));
  assert.ok(html.includes('🟢 تم حل المشكلة'));
  assert.ok(html.includes('/ticket-resolve'));
  assert.ok(!html.includes('<My Server>'));
  assert.ok(!html.includes('value="' + guild + '"'));
  node('#ticketLanguage').onchange({ target: { value: 'en' } });
  context.window.CortexI18n.language = 'en';
  listeners['cortex-language-changed']();
  assert.ok(html.includes('Support tickets'));
  assert.ok(html.includes('🟡 Claimed — in progress'));
  assert.ok(html.includes('<option value="en" selected>'));
  node('#saveTickets').onclick();
  assert.equal(posts, 0);
  assert.ok(dialog.includes('&lt;Admins>'));
  assert.ok(dialog.includes('/ticket-panel'));
  await node('#confirmTicketSave').onclick();
  assert.equal(posts, 1);
  assert.equal(body.config.guilds[0].language, 'en');
  assert.deepEqual(Array.from(body.config.guilds[0].staffRoleIds), [staff]);
  assert.equal(body.confirmAutomatic, true);
});
