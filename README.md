# Cortex Manager 6

A manual redesign workflow for the existing `SAADX25/cortex-manager` project and its configured Discord server. The proposal contains **7 Arabic categories, 31 channel slots and 11 distinct colored roles**, with private staff and VIP areas. Read [PROPOSED_CHANGES.md](PROPOSED_CHANGES.md) before deploying the code.

## Local Windows app

### Unified Discloud package

Open **Prepare ZIP / تجهيز ملف ZIP** under Bot tools to review saved ticket, welcome, farewell, kick notification and social settings together. Save changes in their feature sections first. Prepare the ZIP, download it, then use the link to the existing Discloud application (default `1793358824529`) to upload the update manually. Feature export buttons open this central page. Channels, roles and server designs keep their reviewed direct-to-Discord workflow; unapplied drafts are not deployment settings.

The page shows package freshness, enabled counts, required environment variable names and the latest archive fingerprint. Settings or packaged-source changes invalidate downloads until another build. Both the desktop page and `npm run discloud:build` use the shared `src/deployment-package.mjs` builder and produce `out/discloud/cortex-manager.zip` with `verification.json`. Archives exclude credentials, environment values and persistent delivery/ticket state. Keep hosted `data/` and existing environment variables when updating. The application ID selects the dashboard destination; it is not written as a site ID into the bot's `discloud.config`.

### Support tickets

The **Support tickets / تذاكر الدعم** page configures the request-panel text channel, ticket category, support staff roles and optional requester roles. An empty requester list allows all members. Save after reviewing these destinations, then stop/restart the local bot connection, or export and redeploy the Discloud package. The bot installation needs the `bot` and `applications.commands` scopes. Tickets use Gateway interactions and do not require Message Content Intent or Server Members Intent.

- `/ticket` or the panel button opens a subject/description form and creates a private channel for the member, configured support roles and bot. Each member can have one open ticket per server.
- `/ticket-panel` publishes the button in the configured channel. `/ticket-claim` assigns the current ticket to a staff member. `/ticket-close` asks for confirmation, then makes its ordinary owner read-only while preserving the channel and conversation. Staff commands require a configured support role or actual server ownership; an unrelated Administrator role does not authorize bot commands.
- The original request card starts red while waiting, becomes yellow when claimed and displays the staff member's server name and mention, then becomes green after staff explicitly confirm resolution with `/ticket-resolve`, `/ticket-close` or the resolve button. The card preserves the original subject/description, records the resolver separately and disables controls after completion. Claiming remains exclusive and survives restarts. These are explicit staff actions; Discord does not expose message-reader lists to bots.
- Discord server owners and Administrator members can still see private channels. The bot needs Manage Channels, Manage Roles and the channel/message permissions shown in the settings page. Staff-role pings require mentionable roles or the bot's permission to mention roles. Existing tickets retain the access overwrites chosen when they were created.

Run one bot instance at a time. Local state is in `out/desktop-modern/ticket-state.json`; hosted state is in `data/tickets.json`. Preserve that state when restarting or updating; deployment exports contain settings and source only. Lost channel-creation responses are reconciled using an exact channel marker; unresolved requests stay reserved for staff review instead of blindly creating duplicates. Ticket failures log fixed codes without interaction tokens. Local form changes take effect on the next local connection; hosted settings change after redeployment. Disable tickets and restart to reject existing ticket commands and buttons.

Older open tickets upgrade their original bot card on the next staff action, using its button or the latest 100 channel messages when no message ID was recorded. If no original card is available, a separate status card is created without replacing conversation history. Ambiguous message sends are reconciled before another send; status-edit failures preserve the staff action and report that the command should be retried. Tickets closed by older packages stay labelled closed without inventing a past resolution confirmation.

The implementation follows Discord's [interaction response protocol](https://docs.discord.com/developers/interactions/receiving-and-responding) and [channel permissions](https://docs.discord.com/developers/topics/permissions).

Open **CortexManager.exe in the project root**, or double-click **Start-Cortex-Manager.cmd** to build/open it. Version 6 uses installed Microsoft Edge in application mode, with a modern Arabic dashboard, scalable SVG icons, full-color emoji, readable typography, searchable channel/category and role views, and dedicated inspectors. It opens as a Windows application window. Keep the complete project folder beside the executable. Windows, Microsoft Edge, Node.js 22.9+ and .NET Framework 4.8 are required; administrator elevation is not required. See the [Arabic desktop guide](desktop/README.ar.md).

The app shows actual server counts after you explicitly connect. Create categories, text/voice channels and roles; edit names, parent categories, topics, slowmode, voice limits, role colors, role permission flags and channel overwrite states. Each change has a read-only before/after review and explicit Save confirmation. The editor preserves unknown permission bits, member overwrites and untouched entries; protected entities are read-only. Source/configuration drift invalidates approval. Each save snapshots configuration before a single POST/PATCH and writes `edit-result.json`; no editor operation deletes entities or changes member-role assignments. Reports and log events are formatted for review.

The channel inspector also has a Bot Messages tab. Compose a message for the selected text/voice channel, review its content and destination, then confirm sending separately. Mentions are suppressed, permissions are rechecked, and each reviewed send has a persisted attempt record plus a Discord nonce to prevent duplicate requests. Testing never posts to a live Discord server.

The supported binary is now **`CortexManager.exe` at the project root**, marked **MODERN 6** inside the interface. Both the command launcher and `npm run desktop` use it. The app keeps tokens in session memory and worker stdin. An explicit Save button optionally stores the token and guild ID encrypted with Windows DPAPI for the current Windows account in `out/desktop-modern/credentials.json`. It never saves the token in browser storage or returns a restored token to the UI. Saved data loads on the next launch; connecting remains manual. A separate button deletes the saved file while leaving a running session intact.

`npm run desktop:demo` opens a clearly labeled demonstration with simulated channels/roles and disabled Discord writes. The normal app starts disconnected, with no simulated server and no automatic Discord calls. Its per-launch HTTP service binds only to 127.0.0.1, authenticates API requests with a random capability, rejects foreign origins, serializes jobs, and exposes a fixed set of actions and current-session reports. The window uses a dedicated Edge profile under `out/desktop-modern/`; closing it stops this app's presence connection after a short reload grace period. An active rebuild is allowed to finish.

Each session stores reviews and reports under `out/desktop-modern/sessions/session-.../out/`. Opening another session requires a new preview; rebuilding requires reading the proposal and manually entering the guild ID and deletion phrase. The Online connection is independent of rebuild jobs and requires leaving the app/computer online. GitHub Actions still offers the separate manual Discord workflow; **Build Windows desktop app** is a manual build-only workflow that packages the application without connecting to Discord.

## Role manageability

Role names are not protected aliases. Custom roles named OWNER or CO_OWNER follow the same editing, assignment and reviewed cleanup rules as any other role. The actual Discord server owner is a guild property, not a role name.

The workflow does not issue any role-position/reorder requests. Discord can renumber numeric `position` values when other roles are created or deleted; the relative hierarchy of protected surviving roles stays unchanged and is checked before deletion and at completion.

It also preserves `@everyone`, integration/bot-managed roles (including Cortex Manager), roles held by the bot, and roles at or above the bot. Preserved roles are reported instead of blocking ordinary cleanup. A design name matching a protected role is preserved without patching it or creating a duplicate.

Community `rules_channel_id` and `public_updates_channel_id`, channels named `rules` and `moderator-only`, other guild-linked channels, inaccessible channels, and their parent categories remain unchanged. Existing Community channels fill the rules/security design slots where applicable; their functions are never unlinked. Protected channels can therefore keep their original names and locations.

## Review first, rebuild separately

This repository has no push, schedule or automatic rebuild trigger. Both operations require a manual `workflow_dispatch`.

1. After reviewing these source changes, place them in the existing repository. Configure Actions secret `DISCORD_BOT_TOKEN` and repository variable `DISCORD_GUILD_ID`.
2. Enable **Server Members Intent** in the Discord Developer Portal for complete member-role backups. The bot needs Manage Roles, Manage Channels and View Channel. Give it the specific voice/moderation capabilities listed in the preview if needed. Put its role above roles you want it to replace; roles at or above the bot remain unmanageable. Administrator is not required.
3. Run **Cortex Manager - Reviewed Server Redesign**, with `operation: preview`. This only reads Discord. Download `cortex-preview-<run ID>` and review the Actions summary and `plan.json`. Actual server deletion IDs and assignment exceptions come from this preview.
4. If you want to migrate an assigned obsolete role, edit `ROLE_MIGRATIONS` in `src/design.mjs`, mapping its exact old role ID to a new role key. Review the target role's powers. Commit the mapping and run a fresh preview; role names alone never automatically grant new staff assignments.
5. Only when you approve that exact preview, manually run the same workflow on the **same commit**, with `operation: rebuild`, `preview_run_id` set to the successful preview run's numerical ID, `confirm_guild_id` equal to the configured guild ID, and `confirm_delete` exactly `DELETE_ALL_OLD_CHANNELS_AND_ROLES`.
6. Rebuild verifies the preview's repository/workflow/revision, source digest, plan hash, current configuration and assignments. A changed server requires another preview. It uploads the reviewed backup before writing to Discord, creates all replacements, applies and verifies migrations, and then removes only approved obsolete IDs. Review `result.json` and any retained entities after completion.

A preview containing real blockers fails while still saving reports. Intentionally preserved roles and Community channels are not blockers. Expired/missing artifacts, permission failures or interrupted runs require a new preview. Concurrent runs of this workflow are serialized.

## Member assignments

- Exact matching design roles are reused, preserving their IDs and assignments. Their proposed colors and permissions are shown before approval.
- Explicit migration mappings add the replacement role through the single-role PUT endpoint and verify the assignment before deletion. The workflow never sends a complete replacement role list for a member.
- Assigned obsolete roles with no mapping remain intact and appear in `unmigrated`; this avoids silent loss of access or guessed promotions.
- Roles controlling overwrites in preserved channels remain intact to preserve channel access.
- If complete member inventory is unavailable, **all obsolete roles are retained**. Channel creation/cleanup can still proceed under the reviewed plan.
- A failed planned migration stops before any old channels or roles are deleted. New structures already created are retained and reported.
- Newly protected roles/channels and newly unmigrated assignments are skipped and reported during deletion rechecks.

## Reports and recovery

Artifacts are retained for seven days and contain member IDs and role assignments; use appropriate repository/Actions access controls.

| File                 | Contents                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| `snapshot.json`      | Reviewed guild, roles, channel configuration and member-role inventory (or an explicit inventory failure)     |
| `preview.md`         | Full creation/update/deletion/preservation plan, role colors/powers, migration exceptions and permission gaps |
| `plan.json`          | Machine-readable proposal, exact entity IDs and plan hash                                                     |
| `approval.json`      | Preview run, commit, guild, source digest and approval hash                                                   |
| `before-delete.json` | Fresh configuration and available assignments after creation/migration                                        |
| `execution-log.txt`  | Completed write operations and introduction-message warnings                                                  |
| `result.json`        | Created, updated, deleted and retained IDs, migration results and partial failure details                     |
| `failure.json`       | CLI failure reason, including confirmation/provenance/preflight failures                                      |

**Channel deletion is irreversible. Messages, attachments and thread history are not backed up or restored.** Configuration/member backups are not an automatic rollback. If execution stops, some new entities may exist; a fresh preview discovers and reuses unique matching entities. Ambiguous duplicates block the next rebuild for review. Creation requests are not blindly retried after ambiguous network/server failures.

The write allowlist has no guild deletion, kick, ban, member-removal, full member-edit or role-reorder route. Calls are serialized, rate-limit headers and 429 retry delays are respected, and transient reads/idempotent requests are retried. Role assignments require a reviewed operation or an explicit migration mapping.

## Layout and limitations

The public Arabic sections cover getting started, community chat/media, gaming squads, voice lounges and help. Staff headquarters and security notes are private; a VIP lounge has restricted access. Existing Administrator roles bypass channel overwrites and keep their current permissions.

The Muted role uses channel overwrites for ordinary members. Other role/member allow overwrites and Administrator can override it; use Discord's native timeout for reliable moderation. The workflow does not kick, ban or time out anyone. Verification and leveling bots are not implemented here. Support tickets are an optional configured bot feature; automatic kick notifications are also optional. CLI and GitHub Actions use REST and do not keep the bot online. The Windows app can maintain a separate Gateway connection and handle configured tickets.

Discord's channel list excludes threads. Deleting a parent channel also destroys its threads/history. Hidden channels may be absent from the API response when Discord channel obfuscation is enabled; the plan covers the inventory Discord returns and cannot manage unseen channels.

## Local development

Use Node.js 22.9 or later. Install the locked dependencies before development:

```powershell
npm ci
npm run check
npm test
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) for development and localization conventions, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the module map. `npm run preview` is a separate live, read-only operation requiring your own configured Discord credentials.

Set the Discord token and guild ID locally through your environment only if you intend to run a live read-only preview. Tests use a simulated Discord server and no credentials. `npm run snapshot` only exports configuration/inventory; it is not an approval. Local `npm run rebuild` requires the exact confirmation environment values and the matching files produced by a separate local preview. GitHub Actions additionally validates preview-run provenance and commit identity.

Official API references: [role hierarchy and overwrites](https://docs.discord.com/developers/topics/permissions), [guild roles and member endpoints](https://docs.discord.com/developers/resources/guild), [Community channel deletion restrictions](https://docs.discord.com/developers/resources/channel#deleteclose-channel), and [rate limits](https://docs.discord.com/developers/topics/rate-limits).
