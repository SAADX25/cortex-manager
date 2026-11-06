const prefix = 'cortex:ticket:';
export const TICKET_COLORS = Object.freeze({
  waiting: 0xed4245,
  claimed: 0xfee75c,
  resolved: 0x57f287,
  closed: 0x949ba4,
});
const memberLabel = (id) => `<@${id}>`;
export function ticketStatusCard(ticket, ticketId, copy, original = {}) {
  const resolved = ticket.status === 'closed';
  const phase = resolved
    ? ticket.resolvedBy
      ? 'resolved'
      : 'closed'
    : ticket.claimedBy
      ? 'claimed'
      : 'waiting';
  const sameStaff = resolved && ticket.resolvedBy && ticket.resolvedBy === ticket.claimedBy;
  const fields = [
    { name: copy.statusLabel, value: `**${copy['status_' + phase]}**`, inline: false },
    { name: copy.requesterLabel, value: memberLabel(ticket.ownerId), inline: false },
  ];
  if (sameStaff || ticket.claimedBy || !ticket.resolvedBy)
    fields.push({
      name: sameStaff ? copy.handlerResolverLabel : copy.handlerLabel,
      value: ticket.claimedBy ? memberLabel(ticket.claimedBy) : copy.unassigned,
      inline: false,
    });
  if (resolved && ticket.resolvedBy && !sameStaff)
    fields.push({
      name: copy.resolvedByLabel,
      value: memberLabel(ticket.resolvedBy),
      inline: false,
    });
  return {
    // The initial staff notification is removed on later edits; the card carries the details.
    content: '',
    embeds: [
      {
        author: { name: copy.supportBrand },
        title: original.title || copy.title,
        ...(original.description ? { description: original.description } : {}),
        color: TICKET_COLORS[phase],
        fields,
        footer: { text: `Cortex • ${ticketId}` },
        timestamp: new Date(
          ticket.resolvedAt ?? ticket.claimedAt ?? ticket.createdAt,
        ).toISOString(),
      },
    ],
    components: resolved
      ? [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: ticket.resolvedBy ? 3 : 2,
                custom_id: prefix + 'closed',
                label: ticket.resolvedBy ? copy.resolvedButton : copy.closedButton,
                emoji: { name: ticket.resolvedBy ? '✅' : '🔒' },
                disabled: true,
              },
            ],
          },
        ]
      : [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: ticket.claimedBy ? 2 : 1,
                custom_id: prefix + 'claim',
                label: ticket.claimedBy ? copy.claimedButton : copy.claim,
                emoji: { name: ticket.claimedBy ? '👤' : '🙋' },
                disabled: Boolean(ticket.claimedBy),
              },
              {
                type: 2,
                style: 3,
                custom_id: prefix + 'close',
                label: copy.close,
                emoji: { name: '✅' },
              },
            ],
          },
        ],
    allowed_mentions: { parse: [] },
  };
}

export function ticketPanelCard(copy) {
  return {
    embeds: [
      {
        author: { name: copy.supportBrand },
        title: copy.panelTitle,
        description: copy.panel,
        color: 0x9888ff,
        fields: [
          { name: copy.panelStepsLabel, value: copy.panelSteps, inline: false },
          { name: copy.panelFollowupLabel, value: copy.panelFollowup, inline: false },
        ],
        footer: { text: copy.panelFooter },
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 1,
            custom_id: prefix + 'open',
            label: copy.open,
            emoji: { name: '🎫' },
          },
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

export function isTicketStatusMessage(message, botId, ticketId) {
  if (message?.author?.id !== botId || message.webhook_id) return false;
  if (message.embeds?.[0]?.footer?.text === `Cortex • ${ticketId}`) return true;
  // Older packages used the same pair of buttons, without a persisted message ID.
  const ids = (message.components ?? [])
    .flatMap((row) => row.components ?? [])
    .map((c) => c.custom_id);
  return (
    !message.embeds?.[0]?.footer?.text?.startsWith('Cortex • ') &&
    ids.includes(prefix + 'claim') &&
    ids.includes(prefix + 'close')
  );
}
