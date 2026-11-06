const prefix = 'cortex:ticket:';
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
    if (typeof title !== 'string' || !title.startsWith('## ') || typeof description !== 'string')
      throw new Error('Invalid ticket card issue content.');
    return { title: title.slice(3), description };
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
  const sameStaff = closed && ticket.resolvedBy && ticket.resolvedBy === ticket.claimedBy;
  const status = [`## ${copy['status_' + phase]}`];
  if (sameStaff || ticket.claimedBy || !ticket.resolvedBy)
    status.push(
      `**${sameStaff ? copy.handlerResolverLabel : copy.handlerLabel}:** ${ticket.claimedBy ? member(ticket.claimedBy) : copy.unassigned}`,
    );
  if (closed && ticket.resolvedBy && !sameStaff)
    status.push(`**${copy.resolvedByLabel}:** ${member(ticket.resolvedBy)}`);
  const profile = [
    `## ${copy.requestInfo}`,
    `**${copy.requesterLabel}:** ${member(ticket.ownerId)}`,
  ];
  const details = [];
  if (ticket.gender)
    details.push(
      `**${copy.genderLabel}:** ${ticket.gender === 'male' ? copy.genderMale : copy.genderFemale}`,
    );
  if (ticket.age !== undefined)
    details.push(`**${copy.ageLabel}:** ${copy.ageYears.replace('{age}', String(ticket.age))}`);
  if (details.length) profile.push(details.join('   •   '));
  const buttons = closed
    ? [
        {
          type: 2,
          id: 12,
          style: ticket.resolvedBy ? 3 : 2,
          custom_id: prefix + 'closed',
          label: ticket.resolvedBy ? copy.resolvedButton : copy.closedButton,
          emoji: { name: ticket.resolvedBy ? '✅' : '🔒' },
          disabled: true,
        },
      ]
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
  const time = Math.floor((ticket.resolvedAt ?? ticket.claimedAt ?? ticket.createdAt) / 1000);
  return {
    flags: IS_COMPONENTS_V2,
    allowed_mentions: { parse: [] },
    components: [
      {
        type: 17,
        id: 1,
        accent_color: TICKET_COLORS[phase],
        components: [
          display(2, `# 🎫 ${copy.cardTitle}\n-# ${copy.supportBrand}`),
          display(3, `## ${original.title || copy.title}`),
          separator(4),
          display(5, `## ${copy.issueDetails}`),
          display(6, original.description || copy.noIssueDetails),
          separator(7),
          display(8, status.join('\n')),
          separator(9),
          display(10, profile.join('\n')),
          { type: 1, id: 11, components: buttons },
          display(14, `-# Cortex • ${ticketId} · <t:${time}:f>`),
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

export function ticketPanelCard(copy) {
  return {
    flags: IS_COMPONENTS_V2,
    allowed_mentions: { parse: [] },
    components: [
      {
        type: 17,
        id: 1,
        accent_color: 0x9888ff,
        components: [
          display(2, `# ${copy.panelTitle}`),
          display(3, copy.panel),
          separator(4),
          display(5, `## ${copy.panelStepsLabel}\n${copy.panelSteps}`),
          separator(6),
          display(7, `## ${copy.panelFollowupLabel}\n${copy.panelFollowup}`),
          {
            type: 1,
            id: 9,
            components: [
              {
                type: 2,
                id: 10,
                style: 1,
                custom_id: prefix + 'open',
                label: copy.open,
                emoji: { name: '🎫' },
              },
            ],
          },
          display(14, `-# ${copy.panelFooter}`),
        ],
      },
    ],
  };
}

export function isTicketStatusMessage(message, botId, ticketId) {
  if (message?.author?.id !== botId || message.webhook_id) return false;
  if (Number(message.flags ?? 0) & IS_COMPONENTS_V2) {
    const marker = text(message, 14),
      expected = `-# Cortex • ${ticketId}`;
    return (
      typeof marker === 'string' && (marker === expected || marker.startsWith(expected + ' · '))
    );
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
