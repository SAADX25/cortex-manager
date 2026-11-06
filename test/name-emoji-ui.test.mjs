import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { loadLocaleCatalogs } from './helpers/locales.mjs';

const source = fs.readFileSync(new URL('../desktop/web/app.js', import.meta.url), 'utf8');
const picker = source.slice(
  source.indexOf('const nameEmojiGroups ='),
  source.indexOf('\nfunction channelGeneral('),
);
function harness(name = '🎯・help') {
  const nodes = new Map();
  let closed = false;
  const make = (id) => {
    const node = {
      value: '',
      disabled: false,
      attributes: {},
      focus() {},
      dispatchEvent() {},
      setAttribute(key, value) {
        this.attributes[key] = value;
      },
      removeAttribute(key) {
        delete this.attributes[key];
      },
      close() {
        closed = true;
      },
    };
    nodes.set(id, node);
    return node;
  };
  make('#editName').value = name;
  make('#confirmDialog');
  const editor = { values: { name } };
  const context = vm.createContext({
    Intl,
    Event,
    window: { CortexI18n: { language: 'ar' } },
    model: { editor },
    busy: () => false,
    $: (id) => nodes.get(id),
    $$: () => [],
    icon: () => '',
    esc: String,
    invalidate() {},
    toast() {},
    showDialog(html) {
      for (const [, id, attrs] of html.matchAll(/id="([^"]+)"([^>]*)/g))
        make('#' + id).disabled = attrs.includes('disabled');
    },
  });
  loadLocaleCatalogs(context);
  vm.runInContext(picker, context);
  context.showNameEmojiPicker(editor);
  return {
    nodes,
    editor,
    context,
    get closed() {
      return closed;
    },
  };
}

test('pasting one Unicode emoji immediately enables use and updates the channel draft', () => {
  for (const emoji of ['😊', '👍🏽', '👨‍👩‍👧‍👦', '🇯🇴', '1️⃣']) {
    const h = harness();
    const input = h.nodes.get('#ownNameEmoji'),
      use = h.nodes.get('#useNameEmoji');
    assert.equal(use.disabled, true);
    input.value = emoji;
    input.oninput();
    assert.equal(use.disabled, false, emoji);
    assert.equal(h.nodes.get('#emojiNamePreview').textContent, emoji + '・help');
    use.onclick();
    assert.equal(h.editor.values.name, emoji + '・help');
    assert.equal(h.nodes.get('#editName').value, emoji + '・help');
    assert.equal(h.closed, true);
    assert.deepEqual(Array.from(h.context.model.customNameEmojis), [emoji]);
  }
});

test('invalid or cleared pasted text removes the prior selection and cannot apply it', () => {
  for (const invalid of ['', 'hello', '😊😊', '<:custom:123456789012345678>']) {
    const h = harness(),
      input = h.nodes.get('#ownNameEmoji');
    input.value = '😊';
    input.oninput();
    input.value = invalid;
    input.oninput();
    assert.equal(h.nodes.get('#useNameEmoji').disabled, true);
    h.nodes.get('#useNameEmoji').onclick();
    assert.equal(h.editor.values.name, '🎯・help');
    assert.equal(h.closed, false);
    assert.equal(input.attributes['aria-invalid'], invalid ? 'true' : undefined);
  }
});

test('the own-emoji choose button and Enter retain the pasted selection', () => {
  const h = harness(),
    input = h.nodes.get('#ownNameEmoji');
  input.value = ' 🐉 ';
  h.nodes.get('#chooseOwnEmoji').onclick();
  assert.equal(h.nodes.get('#useNameEmoji').disabled, false);
  let prevented = false;
  input.onkeydown({
    key: 'Enter',
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(h.nodes.get('#emojiNamePreview').textContent, '🐉・help');
});
