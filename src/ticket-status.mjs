const prefix = 'cortex:ticket:';
export const TICKET_COLORS = Object.freeze({
  waiting: 0xed4245,
  claimed: 0xfee75c,
  resolved: 0x57f287,
  closed: 0x949ba4,
});
const memberLabel = (id, name) =>
  name
    ? `${String(name)
        .replace(/[\\`*_~|<>\[\]()]/g, '\\$&')
        .slice(0, 200)} · <@${id}>`
    : `<@${id}>`;
export function ticketStatusCard(ticket, ticketId, copy, original = {}) {
  const resolved = ticket.status === 'closed';
  const phase = resolved
    ? ticket.resolvedBy
      ? 'resolved'
      : 'closed'
    : ticket.claimedBy
      ? 'claimed'
      : 'waiting';
  const fields = [
    { name: copy.statusLabel, value: copy['status_' + phase], inline: false },
    { name: copy.requesterLabel, value: `<@${ticket.ownerId}>`, inline: true },
    {
      name: copy.handlerLabel,
      value: ticket.claimedBy ? memberLabel(ticket.claimedBy, ticket.claimedName) : copy.unassigned,
      inline: true,
    },
  ];
  if (resolved && ticket.resolvedBy)
    fields.push({
      name: copy.resolvedByLabel,
      value: memberLabel(ticket.resolvedBy, ticket.resolvedName),
      inline: true,
    });
  return {
    embeds: [
      {
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
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 1,
            custom_id: prefix + 'claim',
            label: copy.claim,
            disabled: resolved || Boolean(ticket.claimedBy),
          },
          { type: 2, style: 3, custom_id: prefix + 'close', label: copy.close, disabled: resolved },
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
