# Cortex Manager v4

A manual redesign workflow for the existing `SAADX25/cortex-manager` project and its configured Discord server. The proposal contains **7 Arabic categories, 31 channel slots and 11 distinct colored roles**, with private staff and VIP areas. Read [PROPOSED_CHANGES.md](PROPOSED_CHANGES.md) before deploying the code.

## Permanent preservation

`★ OWNER ★` and `★ CO_OWNER ★` are excluded from every role edit, deletion and assignment operation. The workflow never renames, recreates, reorders, or removes members from these roles. Their role permissions stay unchanged. Existing leadership roles receive access overwrites in new private areas.

The workflow does not issue any role-position/reorder requests. Discord can renumber numeric `position` values when other roles are created or deleted; the relative hierarchy of leadership and surviving existing roles stays unchanged and is checked before deletion and at completion.

It also preserves `@everyone`, integration/bot-managed roles (including Cortex Manager), roles held by the bot, and roles at or above the bot. Preserved roles are reported instead of blocking ordinary cleanup. A design name matching a protected role is preserved without patching it or creating a duplicate.

Community `rules_channel_id` and `public_updates_channel_id`, channels named `rules` and `moderator-only`, other guild-linked channels, inaccessible channels, and their parent categories remain unchanged. Existing Community channels fill the rules/security design slots where applicable; their functions are never unlinked. Protected channels can therefore keep their original names and locations.

## Review first, rebuild separately

This repository has no push, schedule or automatic rebuild trigger. Both operations require a manual `workflow_dispatch`.

1. After reviewing these source changes, place them in the existing repository. Configure Actions secret `DISCORD_BOT_TOKEN` and repository variable `DISCORD_GUILD_ID`.
2. Enable **Server Members Intent** in the Discord Developer Portal for complete member-role backups. The bot needs Manage Roles, Manage Channels and View Channel. Give it the specific voice/moderation capabilities listed in the preview if needed. Put its role above roles you want it to replace; **do not move OWNER or CO_OWNER to accommodate the workflow**. Administrator is not required.
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

| File | Contents |
|---|---|
| `snapshot.json` | Reviewed guild, roles, channel configuration and member-role inventory (or an explicit inventory failure) |
| `preview.md` | Full creation/update/deletion/preservation plan, role colors/powers, migration exceptions and permission gaps |
| `plan.json` | Machine-readable proposal, exact entity IDs and plan hash |
| `approval.json` | Preview run, commit, guild, source digest and approval hash |
| `before-delete.json` | Fresh configuration and available assignments after creation/migration |
| `execution-log.txt` | Completed write operations and introduction-message warnings |
| `result.json` | Created, updated, deleted and retained IDs, migration results and partial failure details |
| `failure.json` | CLI failure reason, including confirmation/provenance/preflight failures |

**Channel deletion is irreversible. Messages, attachments and thread history are not backed up or restored.** Configuration/member backups are not an automatic rollback. If execution stops, some new entities may exist; a fresh preview discovers and reuses unique matching entities. Ambiguous duplicates block the next rebuild for review. Creation requests are not blindly retried after ambiguous network/server failures.

The write allowlist has no guild deletion, kick, ban, member-removal, full member-edit or role-reorder route. Calls are serialized, rate-limit headers and 429 retry delays are respected, and transient reads/idempotent requests are retried. No member is automatically granted a new leadership role.

## Layout and limitations

The public Arabic sections cover getting started, community chat/media, gaming squads, voice lounges and help. Staff headquarters and security notes are private; a VIP lounge has restricted access. Existing Administrator roles bypass channel overwrites and keep their current permissions.

The Muted role uses channel overwrites for ordinary members. Other role/member allow overwrites and Administrator can override it; use Discord's native timeout for reliable moderation. The workflow does not kick, ban or time out anyone. Support, verification and logging channels are organizational spaces; ticketing, verification, leveling and automatic audit bots are not implemented here. The bot may appear offline because this project uses REST rather than a permanent Gateway connection.

Discord's channel list excludes threads. Deleting a parent channel also destroys its threads/history. Hidden channels may be absent from the API response when Discord channel obfuscation is enabled; the plan covers the inventory Discord returns and cannot manage unseen channels.

## Local development

Use Node.js 22 or later, with no external npm packages:

```powershell
npm test
npm run preview
```

Set the Discord token and guild ID locally through your environment only if you intend to run a live read-only preview. Tests use a simulated Discord server and no credentials. `npm run snapshot` only exports configuration/inventory; it is not an approval. Local `npm run rebuild` requires the exact confirmation environment values and the matching files produced by a separate local preview. GitHub Actions additionally validates preview-run provenance and commit identity.

Official API references: [role hierarchy and overwrites](https://docs.discord.com/developers/topics/permissions), [guild roles and member endpoints](https://docs.discord.com/developers/resources/guild), [Community channel deletion restrictions](https://docs.discord.com/developers/resources/channel#deleteclose-channel), and [rate limits](https://docs.discord.com/developers/topics/rate-limits).
