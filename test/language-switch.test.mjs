import { loadLocaleCatalogs } from './helpers/locales.mjs';
import { designPresets } from '../src/design-presets.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { setImmediate } from 'node:timers/promises';
test('language segments restore preference, persist selection, ignore repeat clicks and roll back failed saves', async () => {
  const options = ['ar', 'en'].map((language) => ({
    dataset: { language },
    disabled: true,
    attributes: {},
    setAttribute(k, v) {
      this.attributes[k] = v;
    },
  }));
  const group = {
      attributes: {},
      querySelectorAll: () => options,
      setAttribute(k, v) {
        this.attributes[k] = v;
      },
    },
    events = [],
    calls = [];
  let fail = false,
    release;
  const document = {
    documentElement: {},
    body: {},
    querySelector: () => group,
    querySelectorAll: (selector) => (selector.startsWith('#languageSwitch') ? options : []),
    createTreeWalker: () => ({ nextNode: () => null }),
  };
  const context = vm.createContext({
    document,
    window: { dispatchEvent: (event) => events.push(event.type) },
    location: { hash: '#key=private-key' },
    URLSearchParams,
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: class {
      disconnect() {}
      observe() {}
    },
    CustomEvent: class {
      constructor(type) {
        this.type = type;
      }
    },
    fetch: async (url, request) => {
      calls.push(request);
      if (request.method === 'GET') return { ok: true, json: async () => ({ language: 'en' }) };
      await new Promise((resolve) => (release = resolve));
      return { ok: !fail, json: async () => ({}) };
    },
  });
  loadLocaleCatalogs(context);
  vm.runInContext(
    fs.readFileSync(new URL('../desktop/web/i18n.js', import.meta.url), 'utf8'),
    context,
  );
  await setImmediate();
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(document.documentElement.dir, 'ltr');
  assert.equal(options[1].attributes['aria-pressed'], 'true');
  assert.equal(options[0].disabled, false);
  for (const preset of designPresets()) {
    assert.equal(context.window.CortexI18n.translate(preset.ar), preset.en);
    const d = preset.templates.en,
      c = d.categories.length,
      ch = d.categories.flatMap((c) => c.channels).length,
      r = d.roles.length;
    assert.equal(
      context.window.CortexI18n.translate(c + ' أقسام · ' + ch + ' غرفة · ' + r + ' رتب'),
      c + ' categories · ' + ch + ' channels · ' + r + ' roles',
    );
  }
  const click = (option) => group.onclick({ target: { closest: () => option } });
  await click(options[1]);
  assert.equal(calls.length, 1);
  const save = click(options[0]);
  assert.equal(document.documentElement.dir, 'rtl');
  assert.equal(options[0].disabled, true);
  await click(options[1]);
  assert.equal(calls.length, 2);
  release();
  await save;
  assert.equal(JSON.parse(calls[1].body).language, 'ar');
  assert.equal(options[0].attributes['aria-pressed'], 'true');
  for (const preset of designPresets())
    assert.equal(context.window.CortexI18n.translate(preset.ar), preset.ar);
  fail = true;
  const failed = click(options[1]);
  release();
  await failed;
  assert.equal(document.documentElement.lang, 'ar');
  assert.equal(options[0].attributes['aria-pressed'], 'true');
  assert.equal(options[0].disabled, false);
  assert.ok(events.includes('cortex-language-error'));
});
