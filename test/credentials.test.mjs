import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCredentialStore } from '../src/credentials.mjs';

function temp(t) {
  const base = path.resolve(os.tmpdir()),
    root = fs.mkdtempSync(path.join(base, 'cortex-vault-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), base);
    assert.match(path.basename(root), /^cortex-vault-/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}
const fixture = { token: 'fixture-token-not-real', guildId: '111111111111111111' };

test('credential store validates input and never falls back to plaintext after protection failure', async (t) => {
  const root = temp(t),
    store = createCredentialStore({
      root,
      protect: async () => {
        throw new Error('protection failed');
      },
    });
  assert.equal(await store.load(), null);
  await assert.rejects(store.save({ token: '', guildId: fixture.guildId }));
  await assert.rejects(store.save(fixture), /protection failed/);
  assert.equal(fs.existsSync(path.join(root, 'out', 'desktop-modern', 'credentials.json')), false);
});

test('corrupt credential files fail closed and can be forgotten', async (t) => {
  const root = temp(t),
    file = path.join(root, 'out', 'desktop-modern', 'credentials.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{"token":"never accept plaintext"}');
  const store = createCredentialStore({ root });
  await assert.rejects(store.load(), /غير صالح/);
  await store.forget();
  assert.equal(await store.load(), null);
});

test(
  'Windows DPAPI protects both credentials, restores across store instances and supports replacement/deletion',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const root = temp(t);
    fs.mkdirSync(path.join(root, 'desktop'));
    fs.copyFileSync(
      new URL('../desktop/CredentialVault.ps1', import.meta.url),
      path.join(root, 'desktop', 'CredentialVault.ps1'),
    );
    const store = createCredentialStore({ root });
    await store.save(fixture);
    const file = path.join(root, 'out', 'desktop-modern', 'credentials.json'),
      raw = fs.readFileSync(file, 'utf8');
    assert.ok(!raw.includes(fixture.token));
    assert.ok(!raw.includes(fixture.guildId));
    assert.deepEqual(await createCredentialStore({ root }).load(), fixture);
    const changed = { ...fixture, token: 'second-fixture-token' };
    await store.save(changed);
    assert.deepEqual(await store.load(), changed);
    await store.forget();
    assert.equal(await store.load(), null);
  },
);
