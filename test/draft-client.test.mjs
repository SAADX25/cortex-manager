import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(
  new URL('../desktop/web/workspace-drafts.js', import.meta.url),
  'utf8',
);
function create(api) {
  const context = { window: {}, structuredClone, setTimeout: () => 1, clearTimeout: () => {} };
  vm.runInNewContext(source, context);
  return context.window.CortexDrafts.create(api);
}
const entry = (name) => ({ key: 'role:111111111111111111', request: { values: { name } } });
test('autosave serializes writes and keeps edits made while a save is in flight', async () => {
  let finish,
    server = { entries: [], revision: 'r0', updatedAt: null },
    writes = 0;
  const api = async (url, body) => {
    if (!body) return structuredClone(server);
    assert.equal(body.baseRevision, server.revision);
    writes++;
    if (writes === 1) await new Promise((resolve) => (finish = resolve));
    server = { entries: structuredClone(body.entries), revision: 'r' + writes, updatedAt: 'now' };
    return structuredClone(server);
  };
  const client = create(api);
  await client.load('guild');
  client.put('guild', entry('first'));
  const first = client.flush('guild');
  await new Promise((resolve) => setImmediate(resolve));
  client.put('guild', entry('second'));
  finish();
  await first;
  await client.flush('guild');
  assert.equal(writes, 2);
  assert.equal(server.entries[0].request.values.name, 'second');
  assert.equal(client.info('guild').unsaved, false);
});
test('restoring server drafts never overwrites local typing and failed saves remain visibly unsaved', async () => {
  let restore;
  const api = async (url, body) => {
    if (!body) return new Promise((resolve) => (restore = resolve));
    throw new Error('Conflict');
  };
  const client = create(api),
    loading = client.load('guild');
  client.put('guild', entry('local'));
  restore({ entries: [entry('old')], revision: 'r0' });
  await loading;
  assert.equal(client.list('guild')[0].request.values.name, 'local');
  await assert.rejects(client.flush('guild'), /Conflict/);
  assert.equal(client.info('guild').status, 'error');
  assert.equal(client.info('guild').unsaved, true);
});

test('visiting a changed server entity never deletes or silently replaces an older persisted draft', () => {
  const source = fs.readFileSync(new URL('../desktop/web/app.js', import.meta.url), 'utf8'),
    fn = source.slice(
      source.indexOf('function persistEditorDraft('),
      source.indexOf('\nfunction restorePersistentEditor('),
    );
  const id = '111111111111111111',
    old = { request: { revision: 'old' } },
    editor = {
      workspaceGuildId: id,
      kind: 'role',
      item: { revision: 'fresh', name: 'Current name' },
      values: { name: 'Current name' },
    };
  const context = {
    model: { editor },
    guildId: () => id,
    editorRequest: (e) => ({ kind: 'role', id, revision: e.item.revision, values: e.values }),
    workspaceKey: () => id,
    draftStore: {
      get: () => old,
      put() {
        throw Error('Must not overwrite');
      },
      remove() {
        throw Error('Must not delete');
      },
    },
    requestDirty: (r, item) => r.values.name !== item.name,
    updateDraftIndicators() {},
    toast() {},
  };
  vm.createContext(context);
  vm.runInContext(fn, context);
  context.persistEditorDraft(editor);
  assert.equal(editor.draftConflict, false);
  editor.values.name = 'New local edit';
  context.persistEditorDraft(editor);
  assert.equal(editor.draftConflict, true);
  assert.equal(old.request.revision, 'old');
});
