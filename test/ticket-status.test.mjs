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
  number: 42,
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

test('compact request cards prioritize status and issue, retaining profiles and opening time in both languages', () => {
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
      const content = payload.components[0].components;
      assert.deepEqual(
        content.slice(0, 6).map((c) => c.id),
        [8, 3, 6, 9, 10, 14],
      );
      assert.ok(content[1].content.startsWith('### '));
      assert.equal(nodes.filter((c) => c.type === 14).length, 1);
      assert.equal(content[4].content.split('\n').length, 2);
      assert.ok(
        content[4].content
          .split('\n')[0]
          .includes(copy.genderMale + ' · ' + copy.ageYears.replace('{age}', '24')),
      );
      assert.equal(
        content[5].content,
        `-# Cortex · #0042 · ${copy.openedLabel} <t:${ticket.createdAt / 1000}:t>`,
      );
      assert.equal(content.filter((c) => c.type === 1).length, change.status === 'closed' ? 0 : 1);
      const message = { ...payload, author: { id: bot } };
      assert.deepEqual(ticketCardIssue(message), {
        title: 'A'.repeat(100),
        description: 'و'.repeat(1500),
      });
      assert.ok(isTicketStatusMessage(message, bot, id, ticket));
      assert.ok(
        !isTicketStatusMessage(message, bot, '123400000000000001', { ...ticket, number: 43 }),
      );
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

test('previous V2 cards preserve the original issue when headings and footer are compacted', () => {
  const old = ticketStatusCard(ticket, id, ticketCopy.ar, {
    title: 'عنوان محفوظ',
    description: 'تفاصيل\nبدون تغيير',
  });
  old.components[0].components.find((c) => c.id === 3).content = '## عنوان محفوظ';
  old.components[0].components.find((c) => c.id === 14).content = `-# Cortex • ${id} · <t:1234:f>`;
  old.author = { id: bot };
  assert.ok(isTicketStatusMessage(old, bot, id, ticket));
  const updated = ticketStatusEdit(
    { ...ticket, claimedBy: '888888888888888889', claimedAt: ticket.createdAt + 60000 },
    id,
    ticketCopy.ar,
    old,
  );
  assert.deepEqual(ticketCardIssue(updated), {
    title: 'عنوان محفوظ',
    description: 'تفاصيل\nبدون تغيير',
  });
  assert.equal(
    updated.components[0].components.find((c) => c.id === 14).content,
    `-# Cortex · #0042 · فُتح <t:${ticket.createdAt / 1000}:t>`,
  );
  assert.ok(isTicketStatusMessage({ ...updated, author: { id: bot } }, bot, id, ticket));
});

test('user text cannot impersonate the status marker and malformed modern cards fail closed', () => {
  const payload = ticketStatusCard(ticket, id, ticketCopy.ar, {
    title: 'x',
    description: `-# Cortex • ${id}`,
  });
  const message = { ...payload, author: { id: bot } };
  message.components[0].components.find((c) => c.id === 14).content = 'not a marker';
  assert.ok(!isTicketStatusMessage(message, bot, id, ticket));
  message.author.id = ticket.ownerId;
  assert.ok(!isTicketStatusMessage(message, bot, id, ticket));
  const invalid = ticketStatusCard(ticket, id, ticketCopy.ar, { title: 'x', description: 'kept' });
  invalid.components[0].components = invalid.components[0].components.filter((c) => c.id !== 6);
  assert.throws(() => ticketStatusEdit(ticket, id, ticketCopy.ar, invalid), /issue content/);
});
