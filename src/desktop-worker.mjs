import { previewBatch, applyBatch, batchPublic } from './batch-editor.mjs';
import { readPermissionSimulation } from './permission-simulator.mjs';
import fs from 'node:fs';
import { validateCustomDesign } from './custom-design.mjs';
import { previewRoleGrant, applyRoleGrant, roleGrantPublic } from './role-grants.mjs';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { DiscordAPI, snapshot } from './api.mjs';
import {
  P,
  has,
  bits,
  botPermissions,
  botTopPosition,
  effectiveRolePermissions,
  canManageChannel,
} from './permissions.mjs';
import { ROLES } from './design.mjs';
import { roleProtection } from './safety.mjs';
import { GatewaySession } from './gateway.mjs';
import path from 'node:path';
import { serverInventory, previewEdit, applyEdit, editSummary } from './editor.mjs';
import { previewMessage, sendMessage, messagePreview } from './messages.mjs';
import { readMemberCounts } from './member-counts.mjs';

export function diagnostics(s) {
  const permissionBits = botPermissions(s);
  const requested = bits([
    ...new Set([
      'ManageChannels',
      'ManageRoles',
      'ViewChannel',
      'Connect',
      'Speak',
      'AddReactions',
      'CreatePublicThreads',
      'CreatePrivateThreads',
      'SendMessagesInThreads',
      ...ROLES.flatMap((r) => r.permissions),
    ]),
  ]);
  const invite = new URL('https://discord.com/oauth2/authorize');
  invite.search = new URLSearchParams({
    client_id: s.bot.id,
    scope: 'bot',
    permissions: String(requested),
    guild_id: s.guild.id,
    disable_guild_select: 'true',
  }).toString();
  return {
    guildId: s.guild.id,
    guildName: s.guild.name,
    botName: s.bot.username,
    botId: s.bot.id,
    topPosition: botTopPosition(s),
    permissions: Object.entries(P).map(([name, flag]) => ({
      name,
      granted: has(permissionBits, flag),
    })),
    roles: s.roles.map((r) => ({
      id: r.id,
      name: r.name,
      position: r.position,
      preserved: roleProtection(s, r),
    })),
    inaccessibleChannels: s.channels
      .filter((c) => !canManageChannel(s, c))
      .map((c) => ({ id: c.id, name: c.name })),
    missingRights: ROLES.flatMap((r) => {
      const { missing } = effectiveRolePermissions(r.permissions, permissionBits);
      return missing.length ? [{ role: r.name, missing }] : [];
    }),
    inventory: serverInventory(s),
    inviteURL: invite.href,
    adminInviteURL: new URL(invite.href.replace(/permissions=\d+/, 'permissions=8')).href,
  };
}

export async function runDesktopWorker(
  mode,
  { input = process.stdin, output = process.stdout } = {},
) {
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  const config = await new Promise((resolve, reject) => {
    lines.once('line', (line) => {
      try {
        resolve(JSON.parse(line));
      } catch {
        reject(new Error('Invalid local configuration'));
      }
    });
    lines.once('close', () => reject(new Error('Missing local configuration')));
  });
  const token = String(config.token ?? '').trim(),
    guildId = String(config.guildId ?? '').trim();
  const emit = (data) => output.write(JSON.stringify(data) + '\n');
  if (!token || !/^\d{16,22}$/.test(guildId)) {
    lines.close();
    throw new Error('أدخل توكن البوت ورقم السيرفر الصحيح.');
  }
  if (mode === 'online') {
    if (lines.closed) return;
    const session = new GatewaySession(token);
    session.on('status', (state) => {
      emit({ event: 'presence', ...state });
      if (state.status === 'error' && !session.running) {
        lines.close();
        process.exitCode = 1;
      }
    });
    lines.on('line', (line) => {
      try {
        if (JSON.parse(line).action === 'stop') {
          session.stop();
          lines.close();
        }
      } catch {}
    });
    lines.on('close', () => session.stop());
    process.once('SIGTERM', () => {
      session.stop();
      lines.close();
    });
    session.start();
    return;
  }
  lines.close();
  if (['check', 'inventory'].includes(mode)) {
    const api = new DiscordAPI(token),
      s = await snapshot(api, guildId, { includeMembers: false });
    s.memberStatistics = await readMemberCounts(api, guildId);
    emit({ event: 'diagnostics', data: diagnostics(s) });
    return;
  }
  if (mode === 'batch-preview') {
    const p = await previewBatch(
      new DiscordAPI(token),
      guildId,
      config.batchRequests,
      path.join(process.cwd(), 'out'),
    );
    emit({ event: 'batch-preview', data: batchPublic(p) });
    return;
  }
  if (mode === 'batch-apply') {
    const result = await applyBatch(
      new DiscordAPI(token),
      guildId,
      config.batchConfirmation,
      path.join(process.cwd(), 'out'),
    );
    emit({ event: 'batch-applied', data: result });
    return;
  }
  if (mode === 'permission-simulate') {
    const result = await readPermissionSimulation(
      new DiscordAPI(token),
      guildId,
      config.simulationRequest,
    );
    emit({ event: 'permission-simulation', data: result });
    return;
  }
  if (mode === 'role-grant-preview') {
    const p = await previewRoleGrant(
      new DiscordAPI(token),
      guildId,
      config.roleGrantRequest,
      path.join(process.cwd(), 'out'),
    );
    emit({ event: 'role-grant-preview', data: roleGrantPublic(p) });
    return;
  }
  if (mode === 'role-grant-apply') {
    const result = await applyRoleGrant(
      new DiscordAPI(token),
      guildId,
      config.roleGrantConfirmation,
      path.join(process.cwd(), 'out'),
    );
    emit({ event: 'role-granted', data: result });
    return;
  }
  if (mode === 'edit-preview') {
    const p = await previewEdit(
      new DiscordAPI(token),
      guildId,
      config.editRequest,
      path.join(process.cwd(), 'out'),
    );
    emit({
      event: 'edit-preview',
      data: {
        approvalHash: p.approvalHash,
        summary: editSummary(p),
        changes: p.changes,
        ...(p.move ? { move: p.move } : {}),
      },
    });
    return;
  }
  if (mode === 'edit-apply') {
    const result = await applyEdit(
      new DiscordAPI(token),
      guildId,
      config.editConfirmation,
      path.join(process.cwd(), 'out'),
    );
    emit({ event: 'edit-applied', data: result });
    return;
  }
  if (mode === 'message-preview') {
    const p = await previewMessage(
      new DiscordAPI(token),
      guildId,
      config.messageRequest,
      path.join(process.cwd(), 'out'),
    );
    emit({ event: 'message-preview', data: messagePreview(p) });
    return;
  }
  if (mode === 'message-send') {
    const result = await sendMessage(
      new DiscordAPI(token),
      guildId,
      config.messageConfirmation,
      path.join(process.cwd(), 'out'),
    );
    emit({ event: 'message-sent', data: result });
    return;
  }
  if (!['preview', 'rebuild'].includes(mode)) throw new Error('Unknown desktop operation');
  if (mode === 'preview') {
    const file = path.join(process.cwd(), 'out', 'design-input.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (config.design) fs.writeFileSync(file, JSON.stringify(validateCustomDesign(config.design)));
    else fs.rmSync(file, { force: true });
  }
  process.env.DISCORD_BOT_TOKEN = token;
  process.env.DISCORD_GUILD_ID = guildId;
  process.env.CONFIRM_GUILD_ID = String(config.confirmGuildId ?? '');
  process.env.CONFIRM_DELETE = String(config.confirmDelete ?? '');
  // Local desktop approval uses the existing independently generated plan,
  // source hash, exact confirmations and live drift checks in the CLI.
  process.env.GITHUB_ACTIONS = 'false';
  process.argv[2] = mode;
  await import('./cli.mjs');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDesktopWorker(process.argv[2]).catch((error) => {
    console.error(error.message);
    console.error('تعذّرت العملية. تحقق من التوكن، صلاحيات البوت واتصال الإنترنت.');
    process.exitCode = 1;
  });
}
