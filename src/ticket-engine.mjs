import fs from 'node:fs';
import { snapshot } from './api.mjs';
import { P, has, botPermissions, effectiveChannelPermissions, overwrite } from './permissions.mjs';
import { atomicJSON, snowflake } from './social-config.mjs';
import { validateTickets } from './ticket-config.mjs';
import { ticketCopy } from './ticket-locales.mjs';
import { ticketStatusCard, isTicketStatusMessage } from './ticket-status.mjs';

const prefix = 'cortex:ticket:';
const commands = [
  ['ticket', 'Open a private support ticket'],
  ['ticket-panel', 'Publish the support ticket panel (support staff only)'],
  ['ticket-claim', 'Claim this support ticket (support staff only)'],
  ['ticket-close', 'Close this ticket without deleting its history (support staff only)'],
  ['ticket-resolve', 'Confirm this issue is resolved and close its ticket (support staff only)'],
];
const quiet = { parse: [] };
const button = (id, label, style = 1) => ({ type: 2, style, custom_id: prefix + id, label });
const row = (...components) => ({ type: 1, components });
const userAccess =
  P.ViewChannel | P.SendMessages | P.ReadMessageHistory | P.AttachFiles | P.EmbedLinks;
const closedDeny =
  P.SendMessages |
  P.AddReactions |
  P.CreatePublicThreads |
  P.CreatePrivateThreads |
  P.SendMessagesInThreads;

function readState(file) {
  if (!fs.existsSync(file)) return { version: 1, tickets: {}, seen: {} };
  if (fs.statSync(file).size > 16 * 1024 * 1024) throw new Error('Invalid ticket state.');
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (
    value?.version !== 1 ||
    !value.tickets ||
    !value.seen ||
    typeof value.tickets !== 'object' ||
    Array.isArray(value.tickets) ||
    typeof value.seen !== 'object' ||
    Array.isArray(value.seen) ||
    Object.keys(value.tickets).length > 10000 ||
    Object.keys(value.seen).length > 2000
  )
    throw new Error('Invalid ticket state.');
  for (const [id, t] of Object.entries(value.tickets)) {
    if (
      !snowflake(id) ||
      !snowflake(t.guildId) ||
      !snowflake(t.ownerId) ||
      !['creating', 'unknown', 'open', 'closing', 'closed'].includes(t.status) ||
      (t.channelId !== null && !snowflake(t.channelId)) ||
      !Array.isArray(t.staffRoleIds) ||
      !t.staffRoleIds.every(snowflake) ||
      !Number.isFinite(t.createdAt) ||
      (t.claimedBy !== null && !snowflake(t.claimedBy))
    )
      throw new Error('Invalid ticket state entry.');
    for (const field of ['messageId', 'resolvedBy'])
      if (t[field] !== undefined && !snowflake(t[field]))
        throw new Error('Invalid ticket status ID.');
    for (const field of ['claimedName', 'resolvedName'])
      if (t[field] !== undefined && (typeof t[field] !== 'string' || t[field].length > 100))
        throw new Error('Invalid ticket staff name.');
    for (const field of ['claimedAt', 'resolvedAt'])
      if (t[field] !== undefined && !Number.isFinite(t[field]))
        throw new Error('Invalid ticket status time.');
    if (
      t.messageAttempt !== undefined &&
      !['sending', 'sent', 'unknown'].includes(t.messageAttempt)
    )
      throw new Error('Invalid ticket status delivery.');
  }
  if (Object.entries(value.seen).some(([id, time]) => !snowflake(id) || !Number.isFinite(time)))
    throw new Error('Invalid ticket interaction state.');
  return value;
}

// Interaction acknowledgements use a separate REST queue from ordinary bot work.
// Persist reservations before POSTs: ambiguous failures must never create duplicates.
export function createTicketEngine({
  api,
  responseAPI = api,
  config,
  stateFile,
  onStatus = () => {},
  isStopping = () => false,
  now = Date.now,
}) {
  config = validateTickets(config);
  const state = readState(stateFile);
  const inFlight = new Set();
  let queue = Promise.resolve(),
    pending = 0,
    applicationId = null;
  const persist = () => atomicJSON(stateFile, state);
  const log = (code) => onStatus({ component: 'tickets', status: 'error', code });
  const staffName = (member) =>
    String(member.nick || member.user.global_name || member.user.username || member.user.id).slice(
      0,
      100,
    );
  async function syncCard(i, ticket, ticketId, s, copy, { original, notify = false } = {}) {
    let message;
    if (ticket.messageId) {
      try {
        message = await api.get(`/channels/${ticket.channelId}/messages/${ticket.messageId}`);
      } catch (error) {
        if (!/HTTP 404\b/.test(error.message)) throw error;
        delete ticket.messageId;
        delete ticket.messageAttempt;
        persist();
      }
    }
    if (!message && !notify) {
      if (isTicketStatusMessage(i.message, s.bot.id, ticketId) && snowflake(i.message.id))
        message = await api.get(`/channels/${ticket.channelId}/messages/${i.message.id}`);
      else {
        const messages = await api.get(`/channels/${ticket.channelId}/messages?limit=100`);
        if (!Array.isArray(messages)) throw new Error('Invalid ticket message history.');
        message = messages.find((m) => isTicketStatusMessage(m, s.bot.id, ticketId));
      }
    }
    if (message) {
      if (!snowflake(message.id) || !isTicketStatusMessage(message, s.bot.id, ticketId))
        throw new Error('The ticket status message is not owned by this bot.');
      ticket.messageId = message.id;
      ticket.messageAttempt = 'sent';
      persist();
      await api.patch(
        `/channels/${ticket.channelId}/messages/${message.id}`,
        ticketStatusCard(ticket, ticketId, copy, message.embeds?.[0]),
      );
      return;
    }
    if (['sending', 'unknown'].includes(ticket.messageAttempt))
      throw new Error('Uncertain status message delivery needs review.');
    ticket.messageAttempt = 'sending';
    persist();
    try {
      const payload = ticketStatusCard(ticket, ticketId, copy, original);
      if (notify) {
        payload.content = `${copy.notified} — <@${ticket.ownerId}> ${ticket.staffRoleIds.map((id) => `<@&${id}>`).join(' ')}`;
        payload.allowed_mentions = {
          parse: [],
          roles: ticket.staffRoleIds,
          users: [ticket.ownerId],
        };
      }
      const sent = await api.post(`/channels/${ticket.channelId}/messages`, {
        ...payload,
        nonce: ticketId,
        enforce_nonce: true,
      });
      if (!snowflake(sent?.id)) throw new Error('Invalid ticket status response.');
      ticket.messageId = sent.id;
      ticket.messageAttempt = 'sent';
      persist();
    } catch (error) {
      if (/HTTP 4\d\d\b/.test(error.message) && !/HTTP 429\b/.test(error.message))
        delete ticket.messageAttempt;
      else ticket.messageAttempt = 'unknown';
      persist();
      throw error;
    }
  }
  async function refreshCard(i, ticket, ticketId, s, copy) {
    try {
      await syncCard(i, ticket, ticketId, s, copy);
      return '';
    } catch {
      log('TICKET_STATUS_UPDATE_FAILED');
      return '\n' + copy.cardUpdateFailed;
    }
  }
  const respond = (i, data, type = 4) => {
    const route = `/interactions/${i.id}/${i.token}/callback`;
    // Discord interaction callbacks are exempt from the bot global rate limit.
    // Each has its own token/route and must not wait behind queued webhook edits.
    return responseAPI.request
      ? responseAPI.request('POST', route, { type, data })
      : responseAPI.post(route, { type, data });
  };
  const reply = (i, content, components = []) =>
    responseAPI.patch(`/webhooks/${i.application_id}/${i.token}/messages/@original`, {
      content,
      components,
      allowed_mentions: quiet,
    });
  const isStaff = (member, g, s) =>
    member.user?.id === s.guild.owner_id || member.roles?.some((id) => g.staffRoleIds.includes(id));
  async function context(i, g) {
    const s = await snapshot(api, g.guildId, { includeMembers: false });
    const member = await api.get(`/guilds/${g.guildId}/members/${i.member.user.id}`);
    if (member.user?.id !== i.member.user.id || member.user.bot || !Array.isArray(member.roles))
      throw new Error('Invalid ticket member.');
    return { s, member };
  }
  function validateTargets(g, s) {
    if (
      !s.channels.some((c) => c.id === g.categoryId && c.type === 4) ||
      !s.channels.some((c) => c.id === g.panelChannelId && c.type === 0) ||
      [...g.staffRoleIds, ...g.requesterRoleIds].some((id) => !s.roles.some((r) => r.id === id))
    )
      throw new Error('Ticket destination or role no longer exists.');
  }
  function canRequest(member, g) {
    return (
      !g.requesterRoleIds.length || member.roles?.some((id) => g.requesterRoleIds.includes(id))
    );
  }
  function modal(c) {
    return {
      custom_id: prefix + 'submit',
      title: c.modal,
      components: [
        {
          type: 18,
          label: c.subject,
          component: {
            type: 4,
            custom_id: 'subject',
            style: 1,
            min_length: 1,
            max_length: 100,
            required: true,
          },
        },
        {
          type: 18,
          label: c.description,
          component: {
            type: 4,
            custom_id: 'description',
            style: 2,
            min_length: 1,
            max_length: 1500,
            required: true,
          },
        },
      ],
    };
  }
  function remember(i) {
    state.seen[i.id] = now();
    const entries = Object.entries(state.seen);
    for (const [id] of entries.slice(0, Math.max(0, entries.length - 2000))) delete state.seen[id];
    persist();
  }
  async function processInteraction(i, g, c, action) {
    if (isStopping() || state.seen[i.id]) return;
    remember(i);
    const { s, member } = await context(i, g);
    const staff = isStaff(member, g, s);
    if (action !== 'submit' && !staff) return reply(i, c.denied);
    if (action === 'submit') {
      if (!canRequest(member, g)) return reply(i, c.denied);
      validateTargets(g, s);
      const values = (i.data.components ?? []).flatMap((r) =>
        r.component ? [r.component] : (r.components ?? []),
      );
      const subject = values.find((v) => v.custom_id === 'subject')?.value;
      const description = values.find((v) => v.custom_id === 'description')?.value;
      if (
        typeof subject !== 'string' ||
        !subject.trim() ||
        subject.length > 100 ||
        typeof description !== 'string' ||
        !description.trim() ||
        description.length > 1500
      )
        return reply(i, c.failed);
      const previous = Object.entries(state.tickets).find(
        ([, t]) => t.guildId === g.guildId && t.ownerId === member.user.id && t.status !== 'closed',
      );
      if (previous) {
        const [id, t] = previous;
        if (!t.channelId) {
          // Recover a channel created before a crash/lost response using its unique marker.
          const matches = s.channels.filter(
            (ch) => ch.type === 0 && ch.topic === `cortex-ticket:${id}:${t.ownerId}`,
          );
          if (matches.length === 1) {
            t.channelId = matches[0].id;
            t.status = 'open';
            persist();
          }
        }
        return reply(i, t.channelId ? `${c.exists} <#${t.channelId}>` : c.uncertain);
      }
      const category = s.channels.find((ch) => ch.id === g.categoryId);
      if (
        !has(botPermissions(s), P.ManageChannels | P.ManageRoles) ||
        !has(effectiveChannelPermissions(s, category), P.ViewChannel | P.ManageChannels)
      )
        throw new Error('Missing ticket channel permissions.');
      if (Object.keys(state.tickets).length >= 10000) throw new Error('Ticket storage is full.');
      const ticket = {
        guildId: g.guildId,
        ownerId: member.user.id,
        channelId: null,
        status: 'creating',
        staffRoleIds: [...g.staffRoleIds],
        claimedBy: null,
        createdAt: now(),
      };
      state.tickets[i.id] = ticket;
      persist();
      let channel;
      try {
        channel = await api.post(`/guilds/${g.guildId}/channels`, {
          name: 'ticket-' + i.id.slice(-8),
          type: 0,
          parent_id: g.categoryId,
          topic: `cortex-ticket:${i.id}:${ticket.ownerId}`,
          permission_overwrites: [
            overwrite(g.guildId, 0, 0n, P.ViewChannel),
            ...g.staffRoleIds.map((id) => overwrite(id, 0, userAccess)),
            overwrite(ticket.ownerId, 1, userAccess),
            overwrite(s.bot.id, 1, userAccess | P.ManageChannels | P.ManageRoles),
          ],
        });
        if (!snowflake(channel?.id)) throw new Error('Invalid created ticket.');
      } catch (error) {
        // A conclusive client rejection did not create a channel. Other outcomes need reconciliation.
        if (/HTTP 4\d\d\b/.test(error.message) && !/HTTP 429\b/.test(error.message))
          delete state.tickets[i.id];
        else ticket.status = 'unknown';
        persist();
        throw error;
      }
      ticket.channelId = channel.id;
      ticket.status = 'open';
      persist();
      await syncCard(i, ticket, i.id, s, c, {
        original: { title: subject.trim(), description: description.trim() },
        notify: true,
      });
      return reply(i, `${c.created} <#${channel.id}>`);
    }
    if (action === 'panel') {
      validateTargets(g, s);
      const channel = s.channels.find((ch) => ch.id === g.panelChannelId);
      if (
        !has(effectiveChannelPermissions(s, channel), P.ViewChannel | P.SendMessages | P.EmbedLinks)
      )
        throw new Error('Missing ticket panel permissions.');
      await api.post(`/channels/${g.panelChannelId}/messages`, {
        embeds: [{ title: c.title, description: c.panel, color: 0x9888ff }],
        components: [row(button('open', c.open))],
        allowed_mentions: quiet,
      });
      return reply(i, `${c.panelSent} <#${g.panelChannelId}>`);
    }
    const entry = Object.entries(state.tickets).find(
      ([, t]) =>
        t.guildId === g.guildId &&
        t.channelId === i.channel_id &&
        (['open', 'closing'].includes(t.status) ||
          (t.status === 'closed' && ['close', 'confirm-close'].includes(action))),
    );
    if (!entry) return reply(i, c.notTicket);
    const [ticketId, ticket] = entry;
    const ticketChannel = s.channels.find((ch) => ch.id === ticket.channelId && ch.type === 0);
    if (ticketChannel?.topic !== `cortex-ticket:${ticketId}:${ticket.ownerId}`)
      return reply(i, c.notTicket);
    if (action === 'claim') {
      if (ticket.claimedBy)
        return reply(
          i,
          `${c.alreadyClaimed} <@${ticket.claimedBy}>` +
            (await refreshCard(i, ticket, ticketId, s, c)),
        );
      ticket.claimedBy = member.user.id;
      ticket.claimedName = staffName(member);
      ticket.claimedAt = now();
      persist();
      return reply(
        i,
        `${c.claimed} <@${member.user.id}>` + (await refreshCard(i, ticket, ticketId, s, c)),
      );
    }
    if (ticket.status === 'closed')
      return reply(
        i,
        (ticket.resolvedBy ? c.closed : c.closedLegacy) +
          (await refreshCard(i, ticket, ticketId, s, c)),
      );
    if (action === 'close')
      return reply(i, c.confirmText, [row(button('confirm-close', c.confirmClose, 4))]);
    if (action === 'confirm-close') {
      const channel = s.channels.find((ch) => ch.id === ticket.channelId && ch.type === 0);
      if (
        !channel ||
        !has(
          effectiveChannelPermissions(s, channel),
          P.ViewChannel | P.ManageRoles | P.ManageChannels,
        )
      )
        throw new Error('Missing ticket closing permissions.');
      // A member overwrite overrides role allows. Preserve other overwrites and the history.
      const overwrites = (channel.permission_overwrites ?? []).filter(
        (w) => !(w.type === 1 && w.id === ticket.ownerId),
      );
      overwrites.push(
        overwrite(ticket.ownerId, 1, P.ViewChannel | P.ReadMessageHistory, closedDeny),
      );
      ticket.status = 'closing';
      persist();
      await api.patch(`/channels/${ticket.channelId}`, { permission_overwrites: overwrites });
      ticket.status = 'closed';
      ticket.resolvedBy = member.user.id;
      ticket.resolvedName = staffName(member);
      ticket.resolvedAt = now();
      persist();
      return reply(i, c.closed + (await refreshCard(i, ticket, ticketId, s, c)));
    }
  }
  async function handle(i) {
    const action =
      i?.type === 2
        ? {
            ticket: 'open',
            'ticket-panel': 'panel',
            'ticket-claim': 'claim',
            'ticket-close': 'close',
            'ticket-resolve': 'close',
          }[i.data?.name]
        : [3, 5].includes(i?.type) && i.data?.custom_id?.startsWith(prefix)
          ? i.data.custom_id.slice(prefix.length)
          : null;
    if (
      !['open', 'submit', 'panel', 'claim', 'close', 'confirm-close'].includes(action) ||
      !snowflake(i.id) ||
      !snowflake(i.application_id) ||
      !snowflake(i.guild_id) ||
      !snowflake(i.member?.user?.id) ||
      !snowflake(i.channel_id) ||
      typeof i.token !== 'string' ||
      !/^[\w.-]{1,256}$/.test(i.token) ||
      (applicationId && i.application_id !== applicationId) ||
      (action === 'submit' ? i.type !== 5 : i.type === 5) ||
      isStopping() ||
      inFlight.has(i.id) ||
      state.seen[i.id]
    )
      return;
    const g = config.guilds.find((g) => g.guildId === i.guild_id);
    const c = ticketCopy[g?.language ?? 'ar'];
    inFlight.add(i.id);
    try {
      if (!g?.enabled)
        return await respond(i, { content: c.disabled, flags: 64, allowed_mentions: quiet });
      if (action === 'open') {
        if (!canRequest(i.member, g))
          return await respond(i, { content: c.denied, flags: 64, allowed_mentions: quiet });
        return await respond(i, modal(c), 9);
      }
      if (pending >= 100)
        return await respond(i, { content: c.queued, flags: 64, allowed_mentions: quiet });
      pending++;
      try {
        // Acknowledge immediately, before waiting for reads or the serialized work queue.
        await respond(i, { flags: 64 }, 5);
        const work = queue.then(() => processInteraction(i, g, c, action));
        queue = work.catch(() => {});
        await work;
      } catch {
        log('TICKET_REQUEST_FAILED');
        try {
          await reply(i, c.failed);
        } catch {
          log('TICKET_RESPONSE_FAILED');
        }
      } finally {
        pending--;
      }
    } catch {
      log('TICKET_ACKNOWLEDGEMENT_FAILED');
    } finally {
      inFlight.delete(i.id);
    }
  }
  return {
    handle,
    async register() {
      const enabled = config.guilds.filter((g) => g.enabled);
      if (!enabled.length) return;
      const application = await api.get('/oauth2/applications/@me');
      if (!snowflake(application?.id)) throw new Error('Invalid ticket application.');
      applicationId = application.id;
      for (const g of enabled)
        for (const [name, description] of commands)
          await api.post(`/applications/${applicationId}/guilds/${g.guildId}/commands`, {
            name,
            description,
            type: 1,
            default_member_permissions: null,
          });
    },
    async drain() {
      // handle() can still be acknowledging before it joins the ordinary work queue.
      while (inFlight.size) await new Promise((resolve) => setTimeout(resolve, 10));
      await queue;
    },
  };
}
