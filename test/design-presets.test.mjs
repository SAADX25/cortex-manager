import { createOverwrites, P } from '../src/permissions.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { designPresets } from '../src/design-presets.mjs';
import { validateCustomDesign } from '../src/custom-design.mjs';
import { plan } from '../src/plan.mjs';
import { sample } from './helpers/fake.mjs';
const context = { window: {}, location: { hash: '' }, structuredClone, URLSearchParams };
vm.runInNewContext(
  fs.readFileSync(new URL('../desktop/web/designer.js', import.meta.url), 'utf8'),
  context,
);
test('five numbered bilingual layouts validate, keep management private and preserve protected server resources', () => {
  const catalog = designPresets();
  assert.deepEqual(
    catalog.map((p) => p.id),
    ['01', '02', '03', '04', '05'],
  );
  for (const preset of catalog)
    for (const language of ['ar', 'en']) {
      const d = validateCustomDesign(preset.templates[language]);
      assert.equal(d.language, language);
      assert.ok(d.categories.some((c) => c.access === 'staff' && c.staffKeys.length));
      assert.equal(new Set(d.roles.map((r) => r.color)).size, d.roles.length);
      for (const c of d.categories.filter((c) => c.access === 'staff')) {
        const ids = Object.fromEntries(d.roles.map((r) => [r.key, r.key]));
        ids.leadership = ['owner'];
        const rows = createOverwrites(c, ids, 'guild', 'bot');
        assert.ok(BigInt(rows.find((w) => w.id === 'guild').deny) & P.ViewChannel);
        assert.ok(!rows.some((w) => w.id === 'member' && BigInt(w.allow) & P.ViewChannel));
        for (const role of c.staffKeys)
          assert.ok(BigInt(rows.find((w) => w.id === role).allow) & P.ViewChannel);
      }
      assert.ok(d.roles.every((r) => !r.permissions.includes('Administrator')));
      const s = sample();
      s.guild.rules_channel_id = s.channels[1].id;
      const p = plan(s, undefined, d);
      assert.ok(p.keepChannels.some((c) => c.id === s.channels[1].id));
      assert.ok(!p.oldRoles.some((r) => r.name.includes('OWNER') || r.managed));
    }
  assert.equal(new Set(catalog.map((p) => JSON.stringify(p.templates.en.categories))).size, 5);
});
test('preset translations retain custom names, access, ordering and edits; catalog calls return independent drafts', () => {
  for (const p of designPresets()) {
    const d = structuredClone(p.templates.ar);
    d.categories[0].channels[0].topic = 'Custom content';
    d.roles[0].color = 123;
    const en = context.window.CortexDesigner.translateLanguage(d, p.templates, 'en');
    validateCustomDesign(en);
    assert.equal(en.categories[0].name, p.templates.en.categories[0].name);
    assert.equal(en.categories[0].channels[0].topic, 'Custom content');
    assert.equal(en.roles[0].color, 123);
    assert.deepEqual(
      en.categories.map((c) => c.key),
      d.categories.map((c) => c.key),
    );
  }
  const catalog = designPresets();
  catalog[1].templates.ar.roles[0].name = 'changed';
  assert.notEqual(designPresets()[1].templates.ar.roles[0].name, 'changed');
});
