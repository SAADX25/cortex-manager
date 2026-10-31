import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { loadLocaleCatalogs } from './helpers/locales.mjs';
import { sample, fakeServer, ID, LEGACY } from './helpers/fake.mjs';
import { serverInventory } from '../src/editor.mjs';
import { previewBatch, applyBatch } from '../src/batch-editor.mjs';
const source = fs.readFileSync(
  new URL('../desktop/web/role-translation.js', import.meta.url),
  'utf8',
);
function setup(extra = {}) {
  const context = vm.createContext({ window: { CortexI18n: { language: 'en' } }, ...extra });
  loadLocaleCatalogs(context);
  vm.runInContext(source, context);
  return context;
}
test('role name suggestions preserve decorations and exclude unknown, protected, conflicting and staged names', () => {
  const propose = setup().window.CortexRoleTranslation.propose;
  const roles = [
    { id: '1', name: '🛡️・الإدارة' },
    { id: '2', name: '⚔️・كبير المشرفين' },
    { id: '3', name: '🎯・منظّم فعاليات' },
    { id: '4', name: '⭐・رتبة خاصة' },
    { id: '5', name: 'عضو', readOnlyReason: 'managed' },
    { id: '6', name: '💎・مميز' },
    { id: '7', name: '💎・VIP' },
    { id: '8', name: 'مشرف' },
  ];
  const before = structuredClone(roles),
    rows = propose(roles, { blockedIds: ['8'] });
  assert.deepEqual(roles, before);
  assert.equal(rows[0].to, '🛡️・Administrator');
  assert.equal(rows[1].to, '⚔️・Head Moderator');
  assert.equal(rows[2].to, '🎯・Event Host');
  assert.deepEqual(
    Array.from(rows.slice(3), (r) => r.status),
    ['unknown', 'protected', 'duplicate', 'draft'],
  );
  assert.equal(propose(roles, { limit: 1 }).filter((r) => r.status === 'ready').length, 1);
});
test('translation UI queues name-only drafts for the existing review workflow without calling Discord', async () => {
  let roles = [{ id: LEGACY, name: '🛡️・الإدارة', revision: 'a'.repeat(64) }],
    entries = [],
    html = '',
    page,
    closed = false;
  const nodes = new Map(),
    node = (id) => {
      if (!nodes.has(id))
        nodes.set(id, {
          close() {
            closed = true;
          },
        });
      return nodes.get(id);
    };
  const context = setup({
    busy: () => false,
    inventory: () => ({ roles }),
    guildId: () => ID,
    persistEditorDraft() {},
    icon: () => '',
    esc: (s) => s,
    model: { editor: { item: { id: LEGACY } } },
    toast() {},
    showDialog: (value) => (html = value),
    $: node,
    go: (value) => (page = value),
    draftStore: {
      load: async () => {},
      list: () => entries,
      get: () => undefined,
      put: (id, e) => entries.push(e),
    },
  });
  await context.window.CortexRoleTranslation.open();
  assert.ok(html.includes('Administrator'));
  assert.equal(entries.length, 0);
  node('#queueRoleTranslation').onclick();
  assert.equal(page, 'changes');
  assert.ok(closed);
  assert.equal(context.model.editor, null);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].request.id, LEGACY);
  assert.deepEqual(Object.keys(entries[0].request.values), ['name']);
  assert.equal(entries[0].request.values.name, '🛡️・Administrator');
  entries = [];
  await context.window.CortexRoleTranslation.open();
  roles[0].revision = 'b'.repeat(64);
  node('#queueRoleTranslation').onclick();
  assert.equal(entries.length, 0);
});
test('reviewed role translation sends only a name PATCH and preserves members, colors, permissions and IDs', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-rename-'));
  t.after(() => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('cortex-rename-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const s = sample();
  s.roles.find((r) => r.id === LEGACY).name = '🛡️・الإدارة';
  const original = structuredClone(s),
    server = fakeServer(s);
  const rows = setup().window.CortexRoleTranslation.propose(serverInventory(s).roles),
    row = rows.find((r) => r.status === 'ready');
  const request = {
    kind: 'role',
    action: 'update',
    id: row.id,
    revision: row.revision,
    values: { name: row.to },
  };
  const preview = await previewBatch(server.api, ID, [request], root);
  assert.equal(server.calls.length, 0);
  const result = await applyBatch(
    server.api,
    ID,
    { confirmed: true, guildId: ID, approvalHash: preview.approvalHash },
    root,
  );
  assert.ok(result.success);
  assert.equal(server.calls.length, 1);
  assert.equal(server.calls[0].method, 'PATCH');
  assert.deepEqual(server.calls[0].body, { name: '🛡️・Administrator' });
  const expected = structuredClone(original.roles);
  expected.find((r) => r.id === LEGACY).name = '🛡️・Administrator';
  assert.deepEqual(server.state.roles, expected);
  assert.deepEqual(server.state.members, original.members);
});
