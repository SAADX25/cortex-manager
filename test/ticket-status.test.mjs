import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ticketStatusCard,
  ticketStatusEdit,
  ticketCardIssue,
  ticketPanelCard,
  isTicketStatusMessage,
  IS_COMPONENTS_V2,
  TICKET_COLORS,
} from '../src/ticket-status.mjs';
import { ticketCopy } from '../src/ticket-locales.mjs';

const id = '123400000000000000',
  bot = '222222222222222222';
const ticket = {
  status: 'open',
  ownerId: '888888888888888888',
  claimedBy: null,
  createdAt: Date.parse('2026-11-06T12:00:00Z'),
  gender: 'male',
  age: 24,
};
const walk = (nodes) => nodes.flatMap((node) => [node, ...walk(node.components ?? [])]);
function validLayout(payload) {
  assert.equal(payload.flags & IS_COMPONENTS_V2, IS_COMPONENTS_V2);
  for (const key of ['content', 'embeds', 'poll', 'sticker_ids'])
    assert.ok(!Object.hasOwn(payload, key));
  const components = walk(payload.components);
  assert.ok(components.length <= 40);
  assert.equal(new Set(components.map((c) => c.id)).size, components.length);
  assert.ok(components.every((c) => Number.isSafeInteger(c.id) && c.id > 0));
  assert.ok(
    components.filter((c) => c.type === 10).reduce((length, c) => length + c.content.length, 0) <=
      4000,
  );
}

test('modern request cards use large headings and native separators for both languages and all states', () => {
  for (const copy of Object.values(ticketCopy))
    for (const change of [
      {},
      { claimedBy: '888888888888888889' },
      { status: 'closed', claimedBy: '888888888888888889', resolvedBy: '888888888888888889' },
    ]) {
      const payload = ticketStatusCard({ ...ticket, ...change }, id, copy, {
        title: 'A'.repeat(100),
        description: 'و'.repeat(1500),
      });
      validLayout(payload);
      const nodes = walk(payload.components);
      assert.ok(nodes.some((c) => c.type === 10 && c.content.startsWith('# 🎫 ')));
      assert.ok(nodes.filter((c) => c.type === 14 && c.spacing === 2).length >= 3);
      const message = { ...payload, author: { id: bot } };
      assert.deepEqual(ticketCardIssue(message), {
        title: 'A'.repeat(100),
        description: 'و'.repeat(1500),
      });
      assert.ok(isTicketStatusMessage(message, bot, id));
      assert.ok(!isTicketStatusMessage(message, bot, '123400000000000001'));
    }
  validLayout(ticketPanelCard(ticketCopy.ar));
  validLayout(ticketPanelCard(ticketCopy.en));
});

test('legacy migration clears incompatible fields while preserving issue text and prior flags', () => {
  const issue = {
    title: 'عنوان الطلب **test**',
    description: 'السطر الأول\n## user heading\n<@123> @everyone',
  };
  const old = {
    author: { id: bot },
    flags: 4,
    content: 'Old staff notification',
    embeds: [{ ...issue, footer: { text: `Cortex • ${id}` } }],
    components: [],
    poll: { question: 'legacy poll' },
    sticker_items: [{ id: '123456789012345678' }],
  };
  assert.ok(isTicketStatusMessage(old, bot, id));
  const migrated = ticketStatusEdit(ticket, id, ticketCopy.ar, old);
  assert.equal(migrated.flags, IS_COMPONENTS_V2 | 4);
  assert.equal(migrated.content, null);
  assert.deepEqual(migrated.embeds, []);
  assert.equal(migrated.poll, null);
  assert.deepEqual(migrated.sticker_ids, []);
  const message = { ...migrated, author: { id: bot } };
  assert.deepEqual(ticketCardIssue(message), issue);
  const claimed = ticketStatusEdit(
    { ...ticket, claimedBy: '888888888888888889' },
    id,
    ticketCopy.en,
    message,
  );
  assert.ok(!Object.hasOwn(claimed, 'embeds'));
  assert.ok(!Object.hasOwn(claimed, 'content'));
  assert.deepEqual(ticketCardIssue({ ...claimed, author: { id: bot } }), issue);
  assert.equal(claimed.components[0].accent_color, TICKET_COLORS.claimed);
  assert.deepEqual(claimed.allowed_mentions, { parse: [] });
});

test('user text cannot impersonate the status marker and malformed modern cards fail closed', () => {
  const payload = ticketStatusCard(ticket, id, ticketCopy.ar, {
    title: 'x',
    description: `-# Cortex • ${id}`,
  });
  const message = { ...payload, author: { id: bot } };
  message.components[0].components.find((c) => c.id === 14).content = 'not a marker';
  assert.ok(!isTicketStatusMessage(message, bot, id));
  message.author.id = ticket.ownerId;
  assert.ok(!isTicketStatusMessage(message, bot, id));
  const invalid = ticketStatusCard(ticket, id, ticketCopy.ar, { title: 'x', description: 'kept' });
  invalid.components[0].components = invalid.components[0].components.filter((c) => c.id !== 6);
  assert.throws(() => ticketStatusEdit(ticket, id, ticketCopy.ar, invalid), /issue content/);
});
