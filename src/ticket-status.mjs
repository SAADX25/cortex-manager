const prefix = 'cortex:ticket:';
export const ticketPanelText = Object.freeze({
  language: 'en',
  title: 'Support',
  button: 'Open ticket',
});
export const IS_COMPONENTS_V2 = 1 << 15;
export const TICKET_COLORS = Object.freeze({
  waiting: 0xed4245,
  claimed: 0xfee75c,
  resolved: 0x57f287,
  closed: 0x949ba4,
});
const display = (id, content) => ({ type: 10, id, content });
const separator = (id) => ({ type: 14, id, divider: true, spacing: 2 });
const member = (id) => `<@${id}>`;
const container = (message) => (message?.components ?? []).find((c) => c.type === 17 && c.id === 1);
const text = (message, id) =>
  container(message)?.components.find((c) => c.type === 10 && c.id === id)?.content;

// Stable component IDs let updates recover the original user text without parsing translated labels.
export function ticketCardIssue(message) {
  if (Number(message?.flags ?? 0) & IS_COMPONENTS_V2) {
    const title = text(message, 3);
    const description = text(message, 6);
    const heading = typeof title === 'string' && /^(?:##|###) /.exec(title);
    if (!heading || typeof description !== 'string')
      throw new Error('Invalid ticket card issue content.');
    return { title: title.slice(heading[0].length), description };
  }
  return message?.embeds?.[0] ?? {};
}

export function ticketStatusCard(ticket, ticketId, copy, original = {}) {
  const closed = ticket.status === 'closed';
  const phase = closed
    ? ticket.resolvedBy
      ? 'resolved'
      : 'closed'
    : ticket.claimedBy
      ? 'claimed'
      : 'waiting';
  const [statusIcon, ...statusLabel] = copy['status_' + phase].split(' ');
  const details = [];
  if (ticket.gender) details.push(ticket.gender === 'male' ? copy.genderMale : copy.genderFemale);
  if (ticket.age !== undefined) details.push(copy.ageYears.replace('{age}', String(ticket.age)));
  const handler = ticket.claimedBy ?? ticket.resolvedBy;
  const profile = [
    `**${copy.requesterLabel}:** ${member(ticket.ownerId)}${details.length ? '  ' + details.join(' · ') : ''}`,
    `**${copy.handlerLabel}:** ${handler ? member(handler) : copy.unassigned}`,
  ];
  if (closed && ticket.resolvedBy && ticket.claimedBy && ticket.resolvedBy !== ticket.claimedBy)
    profile.push(`**${copy.resolvedByLabel}:** ${member(ticket.resolvedBy)}`);
  const buttons = closed
    ? []
    : [
        {
          type: 2,
          id: 12,
          style: ticket.claimedBy ? 2 : 1,
          custom_id: prefix + 'claim',
          label: ticket.claimedBy ? copy.claimedButton : copy.claim,
          emoji: { name: ticket.claimedBy ? '👤' : '🙋' },
          disabled: Boolean(ticket.claimedBy),
        },
        {
          type: 2,
          id: 13,
          style: 3,
          custom_id: prefix + 'close',
          label: copy.close,
          emoji: { name: '✅' },
        },
      ];
  const time = Math.floor(ticket.createdAt / 1000);
  const reference = String(ticket.number ?? ticketId).padStart(4, '0');
  return {
    flags: IS_COMPONENTS_V2,
    allowed_mentions: { parse: [] },
    components: [
      {
        type: 17,
        id: 1,
        accent_color: TICKET_COLORS[phase],
        components: [
          display(8, `${statusIcon} **${statusLabel.join(' ')}**`),
          display(3, `### ${original.title || copy.title}`),
          display(6, original.description || copy.noIssueDetails),
          separator(9),
          display(10, profile.join('\n')),
          display(14, `-# Cortex · #${reference} · ${copy.openedLabel} <t:${time}:t>`),
          ...(buttons.length ? [{ type: 1, id: 11, components: buttons }] : []),
        ],
      },
    ],
  };
}

export function ticketStatusEdit(ticket, ticketId, copy, message) {
  const payload = ticketStatusCard(ticket, ticketId, copy, ticketCardIssue(message));
  payload.flags |= Number(message.flags ?? 0);
  if (!(Number(message.flags ?? 0) & IS_COMPONENTS_V2)) {
    // Discord requires legacy message fields to be cleared when enabling Components V2.
    payload.content = null;
    payload.embeds = [];
    if (message.poll) payload.poll = null;
    if (message.sticker_items?.length) payload.sticker_ids = [];
  }
  return payload;
}

export function ticketPanelCard() {
  return {
    flags: IS_COMPONENTS_V2,
    allowed_mentions: { parse: [] },
    components: [
      {
        type: 17,
        id: 1,
        accent_color: 0x9888ff,
        components: [
          display(2, `### ${ticketPanelText.title}`),
          {
            type: 1,
            id: 9,
            components: [
              {
                type: 2,
                id: 10,
                style: 1,
                custom_id: prefix + 'open',
                label: ticketPanelText.button,
              },
            ],
          },
        ],
      },
    ],
  };
}

export function isTicketStatusMessage(message, botId, ticketId, ticket = {}) {
  if (message?.author?.id !== botId || message.webhook_id) return false;
  if (Number(message.flags ?? 0) & IS_COMPONENTS_V2) {
    const marker = text(message, 14),
      expected = `-# Cortex • ${ticketId}`;
    if (typeof marker !== 'string') return false;
    if (marker === expected || marker.startsWith(expected + ' · ')) return true;
    const reference = String(ticket.number ?? ticketId).padStart(4, '0');
    return marker.startsWith(`-# Cortex · #${reference} · `);
  }
  if (message.embeds?.[0]?.footer?.text === `Cortex • ${ticketId}`) return true;
  const ids = (message.components ?? [])
    .flatMap((row) => row.components ?? [])
    .map((c) => c.custom_id);
  return (
    !message.embeds?.[0]?.footer?.text?.startsWith('Cortex • ') &&
    ids.includes(prefix + 'claim') &&
    ids.includes(prefix + 'close')
  );
}
