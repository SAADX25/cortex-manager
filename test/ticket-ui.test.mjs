import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import { loadLocaleCatalogs } from './helpers/locales.mjs';
import { ticketPanelText } from '../src/ticket-status.mjs';

test('ticket UI preserves role IDs and drafts across languages, and saves reviewed settings only', async () => {
  const guild = '111111111111111111',
    staff = '555555555555555555';
  let html = '',
    dialog = '',
    body,
    posts = 0,
    failSave = false;
  const nodes = new Map();
  const actions = [];
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
    action: async (name, extra) => actions.push({ name, extra }),
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
        if (failSave) throw new Error('Save failed');
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
  assert.ok(dialog.includes('section below'));
  await node('#confirmTicketSave').onclick();
  assert.equal(posts, 1);
  assert.equal(body.config.guilds[0].language, 'en');
  assert.deepEqual(Array.from(body.config.guilds[0].staffRoleIds), [staff]);
  assert.equal(body.confirmAutomatic, true);
  assert.ok(html.includes('Support request message'));
  node('#previewTicketPanel').onclick();
  assert.equal(actions[0].name, 'message-preview');
  assert.equal(actions[0].extra.messageRequest.kind, 'ticket-panel');
  assert.equal(actions[0].extra.messageRequest.settingsRevision, 'revision');
  context.model.state.messagePreview = {
    kind: 'ticket-panel',
    guildId: guild,
    settingsRevision: 'revision',
    approvalHash: 'approved-panel',
    channelId: '777777777777777777',
    channelName: '<help>',
    panel: { ...ticketPanelText },
  };
  context.window.CortexTickets.render();
  assert.ok(html.includes(ticketPanelText.title));
  node('#publishTicketPanel').onclick();
  assert.equal(actions.length, 1, 'opening review does not publish');
  assert.ok(dialog.includes('&lt;help>'));
  assert.ok(dialog.includes('below the current messages'));
  const oldConfirm = node('#confirmTicketPanel').onclick;
  node('#ticketLanguage').onchange({ target: { value: 'ar' } });
  oldConfirm();
  assert.equal(actions.length, 1, 'unsaved settings invalidate a captured confirmation');
  node('#ticketLanguage').onchange({ target: { value: 'en' } });
  node('#publishTicketPanel').onclick();
  await node('#confirmTicketPanel').onclick();
  assert.equal(actions[1].name, 'message-send');
  assert.deepEqual(JSON.parse(JSON.stringify(actions[1].extra.messageConfirmation)), {
    confirmed: true,
    guildId: guild,
    channelId: '777777777777777777',
    approvalHash: 'approved-panel',
  });

  // Preparing a disabled panel offers reviewed activation/save rather than a dead button.
  node('#ticketsEnabled').onchange({ target: { checked: false } });
  assert.ok(html.includes('Enable tickets, save and preview message'));
  assert.ok(!html.match(/id="previewTicketPanel"[^>]*disabled/));
  node('#previewTicketPanel').onclick();
  assert.equal(posts, 1);
  assert.equal(actions.length, 2);
  await node('#confirmTicketSave').onclick();
  assert.equal(body.config.guilds[0].enabled, true);
  assert.equal(actions.length, 3);
  assert.equal(actions[2].name, 'message-preview');
  assert.equal(actions[2].extra.messageRequest.settingsRevision, 'revision');

  node('#ticketLanguage').onchange({ target: { value: 'ar' } });
  assert.ok(html.includes('Save settings and preview message'));
  node('#previewTicketPanel').onclick();
  failSave = true;
  await node('#confirmTicketSave').onclick();
  assert.equal(actions.length, 3, 'failed saving cannot start a panel preview or send');
  failSave = false;
  node('#previewTicketPanel').onclick();
  const staleSave = node('#confirmTicketSave').onclick;
  node('#ticketLanguage').onchange({ target: { value: 'en' } });
  await staleSave();
  assert.equal(actions.length, 3, 'changing settings invalidates the captured save confirmation');

  node('#ticketCategory').onchange({ target: { value: '' } });
  assert.ok(html.match(/id="previewTicketPanel"[^>]*disabled/));
  node('#previewTicketPanel').onclick();
  assert.equal(actions.length, 3, 'missing ticket destinations cannot be previewed');
});
