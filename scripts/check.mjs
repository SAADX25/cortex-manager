import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
function files(directory) {
  return fs
    .readdirSync(path.join(root, directory), { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? files(path.join(directory, entry.name))
        : [path.join(directory, entry.name)],
    );
}
const sources = ['src', 'desktop/web', 'scripts', 'test']
  .flatMap(files)
  .filter((file) => /\.(mjs|js)$/.test(file));
for (const file of sources) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], {
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(file + '\n' + result.stderr);
}
const context = vm.createContext({ window: {} });
for (const file of ['ar.js', 'en.js', 'patterns.js'])
  vm.runInContext(fs.readFileSync(path.join(root, 'desktop/web/locales', file), 'utf8'), context);
const { ar, en } = context.window.CortexLocales;
assert.deepEqual(
  Object.keys(ar).sort(),
  Object.keys(en).sort(),
  'Arabic and English keys must match.',
);
for (const key of Object.keys(ar))
  for (const language of [ar, en])
    assert.ok(
      typeof language[key] === 'string' && language[key].trim(),
      'Empty translation: ' + key,
    );
for (const key of Object.keys(ar)) {
  const tokens = (value) => [...new Set(value.match(/\{[a-zA-Z][a-zA-Z0-9_]*\}/g) ?? [])].sort();
  assert.deepEqual(tokens(ar[key]), tokens(en[key]), 'Translation placeholders differ: ' + key);
}
for (const file of ['social-ui.js', 'welcome-ui.js']) {
  const code = fs.readFileSync(path.join(root, 'desktop/web', file), 'utf8');
  for (const match of code.matchAll(/\bt\(['"]([^'"]+)['"]\)/g))
    assert.ok(Object.hasOwn(ar, match[1]), 'Unknown translation key: ' + match[1]);
}
console.log(
  'Checked ' +
    sources.length +
    ' JavaScript files and ' +
    Object.keys(ar).length +
    ' bilingual messages. No bot was started.',
);
