import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { loadLocaleCatalogs } from './helpers/locales.mjs';
const source = fs.readFileSync(new URL('../desktop/web/workbench-ui.js', import.meta.url), 'utf8');
function setup(language = 'en') {
  const guild = '111111111111111111',
    role = '555555555555555555',
    channel = '777777777777777777';
  let html = '',
    resultRows = [],
    roleRows = [],
    roleInputs = [],
    filterButtons = [],
    actions = [];
  const nodes = new Map();
  function node(id, attrs = '') {
    const n = {
      value: attrs.match(/value="([^"]*)"/)?.[1] ?? '',
      disabled: attrs.includes('disabled'),
      hidden: attrs.includes('hidden'),
      textContent: '',
      dataset: {},
      classList: { toggle() {} },
      setAttribute() {},
      focus() {},
    };
    Object.defineProperty(n, 'innerHTML', {
      set: (v) => {
        n.content = v;
        parse(v, false);
      },
      get: () => n.content ?? '',
    });
    nodes.set(id, n);
    return n;
  }
  function parse(value, reset) {
    if (reset) {
      nodes.clear();
      resultRows = [];
      roleRows = [];
      roleInputs = [];
      filterButtons = [];
    }
    for (const [, id, attrs] of value.matchAll(/id="([^"]+)"([^>]*)/g)) node('#' + id, attrs);
    for (const [, name] of value.matchAll(/data-role-search="([^"]*)"/g))
      roleRows.push({ dataset: { roleSearch: name }, hidden: false });
    for (const [, id, attrs] of value.matchAll(/data-simulation-role="([^"]+)"([^>]*)/g))
      roleInputs.push({ dataset: { simulationRole: id }, checked: attrs.includes('checked') });
    for (const [, state, name] of value.matchAll(
      /data-simulation-result="([^"]+)" data-permission-search="([^"]+)"/g,
    ))
      resultRows.push({
        dataset: { simulationResult: state, permissionSearch: name },
        hidden: false,
      });
    for (const [, filter] of value.matchAll(/data-simulation-filter="([^"]+)"/g))
      filterButtons.push({
        dataset: { simulationFilter: filter },
        classList: { toggle() {} },
        setAttribute() {},
      });
  }
  const root = {
    set innerHTML(v) {
      html = v;
      parse(v, true);
    },
  };
  const model = {
    state: {},
    simulatorForms: {
      [guild]: { mode: 'roles', memberId: '', channelId: channel, roleIds: [], query: '' },
    },
  };
  const inv = {
    guildId: guild,
    roles: [
      { id: guild, name: '@everyone' },
      { id: role, name: 'Moderator', color: 0x3498db },
      { id: '555555555555555556', name: 'Member' },
    ],
    channels: [
      { id: channel, name: 'rules', type: 0 },
      { id: '777777777777777778', name: 'voice', type: 2 },
    ],
  };
  const context = vm.createContext({
    window: { CortexI18n: { language } },
    model,
    inventory: () => inv,
    guildId: () => guild,
    busy: () => false,
    icon: () => '',
    esc: (v) => String(v).replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    shortTime: () => '12:00',
    permissionLabel: (n) => n,
    noInventory: () => 'Connect',
    bindEmpty() {},
    toast() {},
    action: (name, body) => actions.push({ name, body }),
    $: (s) => (s === '#main' ? root : (nodes.get(s) ?? null)),
    $$: (s) =>
      ({
        '[data-simulation-role]': roleInputs,
        '[data-role-search]': roleRows,
        '[data-simulation-result]': resultRows,
        '[data-simulation-filter]': filterButtons,
      })[s] ?? [],
  });
  loadLocaleCatalogs(context);
  vm.runInContext(source, context);
  return {
    context,
    model,
    inv,
    guild,
    role,
    channel,
    nodes,
    actions,
    get html() {
      return html;
    },
    get inputs() {
      return roleInputs;
    },
    get roleRows() {
      return roleRows;
    },
    get resultRows() {
      return resultRows;
    },
    get filters() {
      return filterButtons;
    },
    render: () => context.window.CortexWorkbench.renderSimulator(),
  };
}
function result(h) {
  return {
    guildId: h.guild,
    channelId: h.channel,
    channelName: 'rules',
    mode: 'roles',
    roles: [{ id: h.guild, name: '@everyone' }],
    capturedAt: '2026-11-01',
    results: [
      {
        name: 'ViewChannel',
        allowed: true,
        trace: [{ stage: 'base', allowed: true, allow: [{ name: '@everyone' }], deny: [] }],
      },
      {
        name: 'SendMessages',
        allowed: false,
        trace: [{ stage: 'everyone', allowed: false, allow: [], deny: [{ name: '@everyone' }] }],
      },
    ],
  };
}
test('access inspector role search preserves selections and only explicit analysis sends a read request', () => {
  for (const language of ['ar', 'en']) {
    const h = setup(language);
    h.render();
    assert.ok(!h.html.includes('undefined'));
    assert.equal(h.actions.length, 0);
    h.inputs[0].checked = true;
    h.inputs[0].onchange();
    assert.equal(h.nodes.get('#simulationSelectedCount').textContent, 1);
    h.nodes.get('#simulationRoleSearch').value = 'member';
    h.nodes.get('#simulationRoleSearch').oninput();
    assert.equal(h.roleRows[0].hidden, true);
    assert.equal(h.roleRows[1].hidden, false);
    assert.equal(h.inputs[0].checked, true);
    h.nodes.get('#runPermissionSimulation').onclick();
    assert.equal(h.actions.length, 1);
    assert.equal(h.actions[0].name, 'permission-simulate');
    assert.equal(h.actions[0].body.simulationRequest.roleIds[0], h.role);
    h.nodes.get('#simulationClearRoles').onclick();
    assert.equal(h.nodes.get('#simulationSelectedCount').textContent, 0);
    assert.equal(h.inputs[0].checked, false);
  }
});
test('access results show decision sources, filter allowed/denied and suppress mismatched old results', () => {
  const h = setup();
  h.model.state.simulation = result(h);
  h.render();
  assert.ok(h.html.includes('sim-stats'));
  assert.ok(h.html.includes('Decision details'));
  assert.equal(h.resultRows.length, 2);
  h.filters.find((b) => b.dataset.simulationFilter === 'denied').onclick();
  assert.equal(h.resultRows[0].hidden, true);
  assert.equal(h.resultRows[1].hidden, false);
  h.nodes.get('#simulationPermissionSearch').value = 'missing';
  h.nodes.get('#simulationPermissionSearch').oninput();
  assert.equal(h.nodes.get('#simulationNoResults').hidden, false);
  h.nodes.get('#simulationChannel').onchange({ target: { value: '777777777777777778' } });
  assert.equal(h.model.state.simulation, null);
  assert.ok(h.nodes.get('#simulationOutput').content.includes('Selection changed'));
  h.model.state.simulation = result(h);
  h.render();
  assert.ok(!h.html.includes('sim-stats'));
});
test('member mode rejects invalid IDs and does not confuse role-only results with member results', () => {
  const h = setup();
  h.model.simulatorForms[h.guild].mode = 'member';
  h.model.state.simulation = result(h);
  h.render();
  assert.ok(!h.html.includes('sim-stats'));
  h.nodes.get('#runPermissionSimulation').onclick();
  assert.equal(h.actions.length, 0);
  h.nodes.get('#simulationMember').value = '888888888888888888';
  h.nodes.get('#simulationMember').oninput();
  h.nodes.get('#runPermissionSimulation').onclick();
  assert.equal(h.actions[0].body.simulationRequest.memberId, '888888888888888888');
  assert.equal(h.actions[0].body.simulationRequest.roleIds, undefined);
});
