import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import { loadLocaleCatalogs } from './helpers/locales.mjs';

test('central ZIP page uses saved feature counts, binds builds to the revision and preserves its target across languages', async () => {
  let html = '',
    built = null,
    gets = 0;
  const nodes = new Map(),
    listeners = {};
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, { disabled: false });
    return nodes.get(id);
  };
  const main = {
    set innerHTML(value) {
      html = value;
      nodes.clear();
    },
  };
  const status = {
    appId: '1793358824529',
    revision: 'a'.repeat(64),
    canBuild: true,
    runtimeAvailable: true,
    demo: false,
    requiredEnvironment: ['DISCORD_BOT_TOKEN'],
    features: [{ key: 'tickets', page: 'tickets', saved: 1, enabled: 1 }],
    lastBuild: null,
  };
  const context = vm.createContext({
    window: {
      CortexI18n: { language: 'ar' },
      addEventListener: (key, fn) => (listeners[key] = fn),
    },
    model: { page: 'deployment' },
    icon: () => '',
    esc: (value) => String(value ?? '').replaceAll('<', '&lt;'),
    $: (key) => (key === '#main' ? main : node(key)),
    $$: () => [],
    toast() {},
    api: async (url, body) => {
      if (url === '/api/deployment') gets++;
      else {
        assert.equal(url, '/api/deployment/build');
        built = body;
      }
      return structuredClone({
        ...status,
        ...(body
          ? {
              appId: body.appId,
              lastBuild: {
                appId: body.appId,
                stale: false,
                sha256: 'b'.repeat(64),
                bytes: 1024,
                builtAt: '2026-11-06T11:00:00Z',
                downloadURL: '/api/deployment/download?sha256=' + 'b'.repeat(64),
              },
            }
          : {}),
      });
    },
  });
  loadLocaleCatalogs(context);
  vm.runInContext(
    fs.readFileSync(new URL('../desktop/web/deployment-ui.js', import.meta.url), 'utf8'),
    context,
  );
  context.window.CortexDeployment.render();
  await setImmediate();
  assert.equal(gets, 1);
  assert.ok(html.includes('تذاكر الدعم'));
  assert.ok(html.includes('https://discloud.com/dashboard/app/1793358824529'));
  node('#deploymentAppId').oninput({ target: { value: 'javascript:alert(1)' } });
  assert.equal(node('#buildDeployment').disabled, true);
  assert.equal(node('#deploymentDashboard').href, 'https://discloud.com/dashboard');
  node('#deploymentAppId').oninput({ target: { value: '1793358824530' } });
  context.window.CortexI18n.language = 'en';
  listeners['cortex-language-changed']();
  assert.ok(html.includes('Prepare ZIP'));
  assert.ok(html.includes('value="1793358824530"'));
  assert.equal(built, null);
  await node('#buildDeployment').onclick();
  assert.equal(built.appId, '1793358824530');
  assert.equal(built.baseRevision, status.revision);
  assert.ok(!html.includes('id="downloadDeployment" disabled'));
});
