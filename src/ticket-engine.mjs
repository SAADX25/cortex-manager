import fs from 'node:fs';
import { snapshot } from './api.mjs';
import { P, has, botPermissions, effectiveChannelPermissions, overwrite } from './permissions.mjs';
import { atomicJSON, snowflake } from './social-config.mjs';
import { validateTickets } from './ticket-config.mjs';
import { ticketCopy } from './ticket-locales.mjs';
import {
  ticketStatusCard,
  ticketStatusEdit,
  ticketPanelCard,
  isTicketStatusMessage,
} from './ticket-status.mjs';
import { createTicketIntake, ticketIntakeModal, readTicketIntake } from './ticket-intake.mjs';

const prefix = 'cortex:ticket:';
const commands = [
  ['ticket', 'commandOpen'],
  ['ticket-panel', 'commandPanel'],
  ['ticket-claim', 'commandClaim'],
  ['ticket-close', 'commandClose'],
  ['ticket-resolve', 'commandResolve'],
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

function nextTicketNumber(tickets, guildId) {
  const number =
    1 +
    Object.values(tickets).reduce(
      (max, ticket) => (ticket.guildId === guildId ? Math.max(max, ticket.number ?? 0) : max),
      0,
    );
  if (!Number.isSafeInteger(number)) throw new Error('Ticket numbering is exhausted.');
  return number;
}

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
  const numbers = new Set(),
    highestNumbers = new Map();
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
      (t.closedReason !== undefined &&
        (t.closedReason !== 'channel-deleted' ||
          t.status !== 'closed' ||
          !Number.isFinite(t.deletedAt))) ||
      (t.deletedAt !== undefined && t.closedReason !== 'channel-deleted')
    )
      throw new Error('Invalid ticket deletion record.');
    if (
      t.messageAttempt !== undefined &&
      !['sending', 'sent', 'unknown'].includes(t.messageAttempt)
    )
      throw new Error('Invalid ticket status delivery.');
    if (t.language !== undefined && !['ar', 'en'].includes(t.language))
      throw new Error('Invalid ticket language.');
    if (t.gender !== undefined && !['male', 'female'].includes(t.gender))
      throw new Error('Invalid ticket gender.');
    if (t.age !== undefined && (!Number.isInteger(t.age) || t.age < 1 || t.age > 120))
      throw new Error('Invalid ticket age.');
    if (t.number !== undefined) {
      const key = `${t.guildId}:${t.number}`;
      if (!Number.isSafeInteger(t.number) || t.number < 1 || numbers.has(key))
        throw new Error('Invalid ticket number.');
      numbers.add(key);
      highestNumbers.set(t.guildId, Math.max(highestNumbers.get(t.guildId) ?? 0, t.number));
    }
  }
  // Assign stable per-guild references to pre-numbering records before any card update.
  for (const ticket of Object.values(value.tickets)) {
    if (ticket.number !== undefined) continue;
    ticket.number = 1 + (highestNumbers.get(ticket.guildId) ?? 0);
    if (!Number.isSafeInteger(ticket.number)) throw new Error('Ticket numbering is exhausted.');
    highestNumbers.set(ticket.guildId, ticket.number);
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
  const intake = createTicketIntake({ now });
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
      if (isTicketStatusMessage(i.message, s.bot.id, ticketId, ticket) && snowflake(i.message.id))
        message = await api.get(`/channels/${ticket.channelId}/messages/${i.message.id}`);
      else {
        const messages = await api.get(`/channels/${ticket.channelId}/messages?limit=100`);
        if (!Array.isArray(messages)) throw new Error('Invalid ticket message history.');
        message = messages.find((m) => isTicketStatusMessage(m, s.bot.id, ticketId, ticket));
      }
    }
    if (message) {
      if (!snowflake(message.id) || !isTicketStatusMessage(message, s.bot.id, ticketId, ticket))
        throw new Error('The ticket status message is not owned by this bot.');
      ticket.messageId = message.id;
      ticket.messageAttempt = 'sent';
      persist();
      await api.patch(
        `/channels/${ticket.channelId}/messages/${message.id}`,
        ticketStatusEdit(ticket, ticketId, copy, message),
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
        payload.components.unshift({
          type: 10,
          id: 100,
          content: `📩 ${copy.notified}\n${ticket.staffRoleIds.map((id) => `<@&${id}>`).join(' ')}`,
        });
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
  const wrongChannel = (c, g) => `${c.wrongChannel} <#${g.panelChannelId}>`;
  function remember(i) {
    state.seen[i.id] = now();
    const entries = Object.entries(state.seen);
    for (const [id] of entries.slice(0, Math.max(0, entries.length - 2000))) delete state.seen[id];
    persist();
  }
  async function processInteraction(i, g, c, action, intakeSession) {
    if (isStopping() || state.seen[i.id]) return;
    remember(i);
    if (['submit', 'panel'].includes(action) && i.channel_id !== g.panelChannelId)
      return reply(i, wrongChannel(c, g));
    const { s, member } = await context(i, g);
    const staff = isStaff(member, g, s);
    if (action !== 'submit' && !staff) return reply(i, c.denied);
    if (action === 'submit') {
      if (!canRequest(member, g)) return reply(i, c.denied);
      validateTargets(g, s);
      if (!intakeSession || intakeSession.expiresAt <= now()) return reply(i, c.formExpired);
      const details = readTicketIntake(i.data);
      if (details.error) return reply(i, c[details.error]);
      const { subject, description, gender, age } = details;
      const previous = Object.entries(state.tickets).filter(
        ([, t]) => t.guildId === g.guildId && t.ownerId === member.user.id && t.status !== 'closed',
      );
      let recoveredDeleted = false;
      for (const [id, t] of previous) {
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
        let existingChannel = s.channels.find((ch) => ch.id === t.channelId);
        if (t.channelId && !existingChannel) {
          // An absent inventory entry alone is insufficient: access failures must
          // never release a live ticket. Only Discord's explicit Unknown Channel
          // response for the saved ID confirms that this reservation can retire.
          try {
            const channel = await api.get(`/channels/${t.channelId}`);
            if (channel?.id === t.channelId && channel.guild_id === g.guildId)
              existingChannel = channel;
          } catch (error) {
            if (/HTTP 404\b/.test(error.message) && /\bcode 10003\./.test(error.message)) {
              t.status = 'closed';
              t.closedReason = 'channel-deleted';
              t.deletedAt = now();
              persist();
              recoveredDeleted = true;
              continue;
            }
            log('TICKET_CHANNEL_CHECK_FAILED');
          }
        }
        return reply(
          i,
          t.channelId &&
            existingChannel?.type === 0 &&
            existingChannel.parent_id === g.categoryId &&
            existingChannel.topic === `cortex-ticket:${id}:${t.ownerId}`
            ? `${c.exists} <#${t.channelId}>`
            : c.uncertain,
        );
      }
      const category = s.channels.find((ch) => ch.id === g.categoryId);
      if (
        !has(botPermissions(s), P.ManageChannels | P.ManageRoles) ||
        !has(effectiveChannelPermissions(s, category), P.ViewChannel | P.ManageChannels)
      )
        throw new Error('Missing ticket channel permissions.');
      if (Object.keys(state.tickets).length >= 10000) throw new Error('Ticket storage is full.');
      const ticket = {
        number: nextTicketNumber(state.tickets, g.guildId),
        guildId: g.guildId,
        ownerId: member.user.id,
        channelId: null,
        status: 'creating',
        staffRoleIds: [...g.staffRoleIds],
        claimedBy: null,
        createdAt: now(),
        language: intakeSession.language,
        gender,
        age,
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
        if (!snowflake(channel?.id) || channel.type !== 0 || channel.parent_id !== g.categoryId)
          throw new Error('Invalid created ticket destination.');
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
      return reply(
        i,
        (recoveredDeleted ? c.deletedRecovered + '\n' : '') + `${c.created} <#${channel.id}>`,
      );
    }
    if (action === 'panel') {
      validateTargets(g, s);
      const channel = s.channels.find((ch) => ch.id === g.panelChannelId);
      if (
        !has(effectiveChannelPermissions(s, channel), P.ViewChannel | P.SendMessages | P.EmbedLinks)
      )
        throw new Error('Missing ticket panel permissions.');
      await api.post(`/channels/${g.panelChannelId}/messages`, ticketPanelCard());
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
    if (
      ticketChannel?.topic !== `cortex-ticket:${ticketId}:${ticket.ownerId}` ||
      ticketChannel.parent_id !== g.categoryId
    )
      return reply(i, c.notTicket);
    c = ticketCopy[ticket.language ?? g.language];
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
    const intakeMatch =
      typeof i?.data?.custom_id === 'string'
        ? /^cortex:ticket:(language|submit):(ar|en):([a-f0-9]{24})$/.exec(i.data.custom_id)
        : null;
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
          ? intakeMatch
            ? intakeMatch[1]
            : i.data.custom_id.slice(prefix.length)
          : null;
    if (
      !['open', 'language', 'submit', 'panel', 'claim', 'close', 'confirm-close'].includes(
        action,
      ) ||
      !snowflake(i.id) ||
      !snowflake(i.application_id) ||
      !snowflake(i.guild_id) ||
      !snowflake(i.member?.user?.id) ||
      !snowflake(i.channel_id) ||
      typeof i.token !== 'string' ||
      !/^[\w.-]{1,256}$/.test(i.token) ||
      (applicationId && i.application_id !== applicationId) ||
      (action === 'submit' ? i.type !== 5 : i.type === 5) ||
      (action === 'language' && i.type !== 3) ||
      isStopping() ||
      inFlight.has(i.id) ||
      state.seen[i.id]
    )
      return;
    const g = config.guilds.find((g) => g.guildId === i.guild_id);
    const c = ticketCopy[intakeMatch?.[2] ?? g?.language ?? 'ar'];
    let intakeSession;
    inFlight.add(i.id);
    try {
      if (!g?.enabled)
        return await respond(i, { content: c.disabled, flags: 64, allowed_mentions: quiet });
      if (
        ['open', 'language', 'submit', 'panel'].includes(action) &&
        i.channel_id !== g.panelChannelId
      )
        return await respond(i, {
          content: wrongChannel(c, g),
          flags: 64,
          allowed_mentions: quiet,
        });
      if (action === 'open') {
        if (!canRequest(i.member, g))
          return await respond(i, { content: c.denied, flags: 64, allowed_mentions: quiet });
        const started = intake.begin(i, g);
        if (started.error)
          return await respond(i, {
            content: c[started.error],
            flags: 64,
            allowed_mentions: quiet,
          });
        try {
          return await respond(i, {
            content: c.chooseLanguage,
            flags: 64,
            allowed_mentions: quiet,
            components: [
              row(
                button(`language:ar:${started.session.id}`, 'العربية'),
                button(`language:en:${started.session.id}`, 'English'),
              ),
            ],
          });
        } catch (error) {
          intake.release(started.session);
          throw error;
        }
      }
      if (action === 'language') {
        if (!canRequest(i.member, g))
          return await respond(i, { content: c.denied, flags: 64, allowed_mentions: quiet });
        const selected = intake.select(i, g, intakeMatch?.[3], intakeMatch?.[2]);
        if (selected.error)
          return await respond(i, {
            content: c[selected.error],
            flags: 64,
            allowed_mentions: quiet,
          });
        try {
          return await respond(
            i,
            ticketIntakeModal(c, selected.session.language, selected.session.id),
            9,
          );
        } catch (error) {
          intake.release(selected.session);
          throw error;
        }
      }
      if (pending >= 100)
        return await respond(i, { content: c.queued, flags: 64, allowed_mentions: quiet });
      if (action === 'submit') {
        const submission = intake.submit(i, g, intakeMatch?.[3], intakeMatch?.[2]);
        if (submission.error)
          return await respond(i, {
            content: c[submission.error],
            flags: 64,
            allowed_mentions: quiet,
          });
        intakeSession = submission.session;
      }
      pending++;
      try {
        // Acknowledge immediately, before waiting for reads or the serialized work queue.
        await respond(i, { flags: 64 }, 5);
        const work = queue.then(() => processInteraction(i, g, c, action, intakeSession));
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
      intake.release(intakeSession);
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
        for (const [name, descriptionKey] of commands)
          await api.post(`/applications/${applicationId}/guilds/${g.guildId}/commands`, {
            name,
            description: ticketCopy[g.language][descriptionKey],
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
