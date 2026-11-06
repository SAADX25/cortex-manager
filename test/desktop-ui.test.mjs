import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { loadLocaleCatalogs } from './helpers/locales.mjs';
const source = fs.readFileSync(new URL('../desktop/web/desktop-ui.js', import.meta.url), 'utf8');
function run({ saved, blocked = false, language = 'en' } = {}) {
  const root = { dataset: {} },
    events = {},
    writes = [];
  let button;
  const context = vm.createContext({
    window: { CortexI18n: { language }, addEventListener: (name, fn) => (events[name] = fn) },
    localStorage: {
      getItem: () => {
        if (blocked) throw Error('Unavailable');
        return saved;
      },
      setItem: (k, v) => {
        if (blocked) throw Error('Unavailable');
        writes.push([k, v]);
      },
    },
    document: {
      documentElement: root,
      createElement: () => ({
        attrs: {},
        setAttribute(k, v) {
          this.attrs[k] = v;
        },
      }),
      querySelector: () => ({ prepend: (b) => (button = b) }),
    },
  });
  loadLocaleCatalogs(context);
  vm.runInContext(source, context);
  return { root, button, events, writes, context };
}
test('Windows density preference restores, toggles locally and updates bilingual accessible labels', () => {
  const h = run({ saved: 'compact' });
  assert.equal(h.root.dataset.density, 'compact');
  assert.equal(h.button.attrs['aria-pressed'], 'true');
  assert.match(h.button.title, /Compact/);
  h.button.onclick();
  assert.equal(h.root.dataset.density, 'comfortable');
  assert.deepEqual(h.writes, [['cortex.ui.density', 'comfortable']]);
  h.context.window.CortexI18n.language = 'ar';
  h.events['cortex-language-changed']();
  assert.match(h.button.title, /عرض مريح/);
});
test('Windows display preferences work without storage and reject unknown saved modes', () => {
  const h = run({ blocked: true });
  assert.equal(h.root.dataset.density, 'comfortable');
  h.button.onclick();
  assert.equal(h.root.dataset.density, 'compact');
  assert.equal(run({ saved: 'unexpected' }).root.dataset.density, 'comfortable');
});
