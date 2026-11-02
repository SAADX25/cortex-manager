import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { loadLocaleCatalogs } from './helpers/locales.mjs';
const source = fs.readFileSync(new URL('../desktop/web/app.js', import.meta.url), 'utf8');
const functions = source.slice(
  source.indexOf('function openRoleGrant(e) {'),
  source.indexOf('\nfunction showApplyDialog()'),
);
function harness(language) {
  let html = '',
    actions = [];
  const nodes = new Map();
  const make = (id) => {
    const node = {
      value: '',
      disabled: false,
      checked: false,
      dataset: {},
      focus() {},
      remove() {},
      close() {},
      closest() {
        return this;
      },
      click() {
        this.onclick?.();
      },
      querySelectorAll() {
        return [];
      },
    };
    let content = '';
    Object.defineProperty(node, 'innerHTML', {
      get: () => content,
      set: (value) => {
        content = value;
        const buttons = [...value.matchAll(/data-remove-member="([^"]+)"([^>]*)/g)].map(
          ([, id, attrs]) => ({
            dataset: { removeMember: id },
            disabled: attrs.includes('disabled'),
            click() {
              if (!this.disabled) this.onclick?.();
            },
          }),
        );
        node.querySelectorAll = () => buttons;
      },
    });
    nodes.set(id, node);
    return node;
  };
  const context = vm.createContext({
    window: { CortexI18n: { language } },
    model: { state: { demo: false } },
    busy: () => false,
    guildId: () => '111111111111111111',
    guildName: () => 'Test Server',
    icon: () => '',
    esc: (v) => String(v).replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    toast() {},
    action: (name, body) => actions.push({ name, body }),
    $: (selector) => nodes.get(selector) ?? null,
    showDialog: (content) => {
      html = content;
      nodes.clear();
      for (const [, id, attrs] of content.matchAll(/id="([^"]+)"([^>]*)/g)) {
        const n = make('#' + id);
        n.disabled = attrs.includes('disabled');
      }
      make('#confirmDialog');
    },
  });
  loadLocaleCatalogs(context);
  vm.runInContext(functions, context);
  return {
    context,
    nodes,
    actions,
    get html() {
      return html;
    },
  };
}
test('role member UI supports searchable holders and requires a matching removal review before confirmation in both languages', () => {
  for (const language of ['ar', 'en']) {
    const h = harness(language),
      c = h.context;
    c.openRoleGrant({ item: { id: '555555555555555555', name: 'Member' } });
    assert.equal(h.actions[0].name, 'role-members');
    assert.equal(h.actions[0].body.roleMembersRequest.after, '0');
    const d = c.model.grantDraft;
    d.loadingMembers = false;
    d.membersLoaded = true;
    d.members = [
      { id: '888888888888888888', name: 'Alex <script>', removable: true },
      { id: '999999999999999999', name: 'Owner', removable: false },
    ];
    c.renderRoleGrantDialog();
    assert.ok(!h.html.includes('undefined'));
    assert.ok(h.nodes.get('#confirmRoleGrant').disabled);
    let list = h.nodes.get('#roleMemberList');
    assert.ok(list.innerHTML.includes('&lt;script>'));
    assert.equal(list.querySelectorAll()[1].disabled, true);
    h.nodes.get('#roleMemberSearch').oninput({ target: { value: 'alex' } });
    assert.equal(list.querySelectorAll().length, 1);
    // Clicking the holder's remove action only requests a preview, never an apply.
    list.querySelectorAll()[0].click();
    assert.equal(d.memberId, '888888888888888888');
    assert.equal(h.actions.at(-1).name, 'role-grant-preview');
    assert.equal(h.actions.at(-1).body.roleGrantRequest.operation, 'remove');
    assert.ok(!h.actions.some((a) => a.name === 'role-grant-apply'));
    d.pending = false;
    d.plan = {
      guildId: d.guildId,
      roleId: d.roleId,
      memberId: d.memberId,
      memberName: 'Alex',
      operation: 'remove',
      approvalHash: 'reviewed',
      administrator: false,
    };
    c.renderRoleGrantDialog();
    assert.equal(h.nodes.get('#confirmRoleGrant').disabled, false);
    h.nodes.get('#confirmRoleGrant').click();
    assert.equal(h.actions.at(-1).name, 'role-grant-apply');
    assert.equal(h.actions.at(-1).body.roleGrantConfirmation.operation, 'remove');
    assert.equal(h.actions.at(-1).body.roleGrantConfirmation.approvalHash, 'reviewed');
  }
});
