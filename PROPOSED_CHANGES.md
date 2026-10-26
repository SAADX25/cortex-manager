# Proposed Discord redesign — ready for code review

The project now also includes a local Arabic Windows app: `Start-Cortex-Manager.cmd`, `desktop/ModernLauncher.cs`, and `desktop/README.ar.md`. It offers Online/Offline bot presence, permission diagnostics and opt-in authorization links, read-only preview and separately confirmed rebuild. The existing protected-role policy and rebuild engine are reused. Creating/opening the app does not run a live Discord operation; testing uses a simulated server.

Version 6 replaces the normal WinForms interface with `desktop/web/`, rendered by installed Microsoft Edge in an application window. It includes full-color emoji, crisp SVG icons, a modern Arabic layout, searchable live channel/category and role views, role colors, property/permission inspectors, drafts, before/after review and independently confirmed saves. `src/desktop-server.mjs` is an authenticated loopback-only bridge to fresh existing worker processes. Tokens use session memory and worker stdin, with optional Windows DPAPI encryption for explicitly saved connection details. Restored tokens never return to the browser, and connecting remains manual. Reports belong to the current session. Demo mode uses labeled simulated data and disables live mutations. The single supported launcher is now `CortexManager.exe` in the project root; the command launcher builds/opens it.

The editor retains its existing protection, live/source freshness checks, unknown permissions and member overwrites; it has no individual deletion or member mutation routes. The manual Windows build workflow packages the app and runs mocked tests without a Discord token. Source changes and UI testing do not execute a destructive rebuild.

These are local proposed changes to the existing cortex-manager project. No live Discord preview, rebuild, role change or deletion has been run, and no code has been pushed to GitHub. Actual deletion IDs/counts and member migrations require a separate live read-only preview after code review.

## Safety changes

The live channel/role browser now supports handle dragging and a keyboard-accessible move button. A move is a separate reviewed editor operation with exact confirmation, a fresh configuration check and backup, then one positions-only PATCH. Channel moves omit overwrite/sync fields. Protected roles cannot be crossed or included in role position payloads; Community channels, their categories and category children stay locked for movement. The rebuild mutation allowlist remains unchanged. UI drop markers, auto-scroll, category hover opening and reduced-motion-aware row transitions only preview movement until confirmation.

The Server redesign page now has a bilingual blueprint editor: Arabic/English presets, categories and text/voice channels, role names/colors/permissions, private access, read-only writers, optional opening messages and explicit legacy-role migration mappings. Drafts save locally per guild and import/export validated JSON. Preview records the exact reviewed blueprint in `design.json`; rebuilding verifies it against the approval and source fingerprint. Any draft change invalidates the displayed approval. Up/down controls change creation sequence while existing role positions stay unchanged. GitHub Actions includes the reviewed blueprint in the pre-execution backup artifact.

- Permanently protect ★ OWNER ★ and ★ CO_OWNER ★ by role name and the IDs captured in the reviewed snapshot. Never send edit/delete/reorder/member-removal requests for either role. Preserve permissions, membership and relative hierarchy.
- Preserve @everyone, managed/integration/bot roles, bot-assigned roles and roles outside the bot hierarchy; report these without stopping normal cleanup.
- Leave Community rules/moderator-only channels, guild-linked channels and parent categories unchanged. Reuse Community functions for corresponding design slots.
- Split preview and rebuild into separate manually selected jobs. Rebuild requires a successful preview from the same code revision, the exact server ID and the explicit deletion phrase.
- Bind approval to the snapshot, design, migration mappings and executable source. Detect changed configuration/assignments before any writes.
- Create replacements first, verify additive member-role migrations, then delete approved obsolete IDs. Stop before any old deletion when creation or a planned migration fails.
- Retain assigned legacy roles without explicit mappings and roles needed by preserved channel overwrites. Retain all obsolete roles if member inventory is unavailable; report each exception.
- Save full creation/deletion/preservation/migration reports and partial failures. Respect Discord rate-limit headers, serialize calls and avoid ambiguous creation retries.
- The mutation allowlist excludes kicking, banning, member removal, full member-role replacement, role reordering and server deletion.

## Proposed roles

Existing leadership stays as ★ OWNER ★ and ★ CO_OWNER ★. No Founder or replacement Co Owner role is created. New roles are created in this order without moving existing roles. Existing exact matches retain their IDs and membership.

| Role | Color | Requested permissions |
|---|---|---|
| 🛡️・Administrator | #E74C3C | ViewChannel, SendMessages, ReadMessageHistory, ManageChannels, ManageRoles, ManageMessages, KickMembers, BanMembers, ModerateMembers |
| ⚔️・Head Moderator | #D35400 | ViewChannel, SendMessages, ReadMessageHistory, KickMembers, BanMembers, ModerateMembers, ManageMessages, ManageNicknames, ManageThreads |
| 🔨・Moderator | #3498DB | ViewChannel, SendMessages, ReadMessageHistory, KickMembers, ModerateMembers, ManageMessages, ManageThreads |
| 🎫・Support Team | #1ABC9C | ViewChannel, SendMessages, ReadMessageHistory |
| 🎯・Event Host | #9B59B6 | ViewChannel, SendMessages, ReadMessageHistory, ManageEvents, MoveMembers |
| 🎨・Content Creator | #FF78B2 | ViewChannel, SendMessages, ReadMessageHistory, AttachFiles, EmbedLinks |
| 💎・VIP | #13D9D4 | ViewChannel, SendMessages, ReadMessageHistory |
| 🎮・Gamer | #5865F2 | ViewChannel, SendMessages, ReadMessageHistory, Connect, Speak, AddReactions, CreatePublicThreads, SendMessagesInThreads |
| ✅・Verified | #57F287 | ViewChannel, SendMessages, ReadMessageHistory, Connect, Speak |
| 🌿・Member | #95A5A6 | ViewChannel, SendMessages, ReadMessageHistory, Connect, Speak |
| 🔇・Muted | #555C68 | Channel restriction overwrites |

Permissions are capped at what the bot can delegate, with every gap shown in the live preview. Privileged roles are assigned only through explicitly reviewed ID mappings; unmapped staff assignments are retained in their original roles.

## Arabic server layout

31 channel slots across seven sections. Existing protected Community rooms keep their current names and locations and can fill the rules/security slots; their parent categories remain as well.

### ╔═ ✦ 01 • البداية

Public community section.

- # Text **👋・أهلاً-وسهلاً** — read-only — أهلاً بك في مجتمع Real Friends
- # Text **📜・القوانين** — read-only — قوانين المجتمع وآداب التعامل
- # Text **📢・الإعلانات** — read-only — الإعلانات الرسمية والتحديثات
- # Text **🏷️・دليل-الرتب** — read-only — معاني الرتب ومن يملك كل صلاحية
- # Text **❓・الأسئلة-الشائعة** — read-only — دليل الاستخدام والإجابات الشائعة

### ╠═ ✦ 02 • المجتمع

Public community section.

- # Text **💬・الدردشة-العامة** — دردشة المجتمع للجميع
- # Text **🙋・تعارف** — عرّف عن نفسك واهتماماتك
- # Text **📸・صور-ومقاطع** — شارك الصور واللقطات
- # Text **😂・ميمز** — زاوية الضحك والميمز
- # Text **💡・اقتراحات** — اقتراحات لتطوير المجتمع
- # Text **🗳️・تصويتات** — استطلاعات المجتمع

### ╠═ ✦ 03 • ساحة الألعاب

Public community section.

- # Text **🎮・الألعاب** — نقاشات الألعاب
- # Text **🔫・كاونتر-سترايك** — أخبار CS2 واللاعبين والبطولات
- # Text **🪖・ببجي-موبايل** — PUBG Mobile والفرق
- # Text **🏝️・فورتنايت** — Fortnite
- # Text **🤝・تجميع-سكواد** — ابحث عن فريق أو أعضاء للعب
- # Text **🏆・لقطات-احترافية** — شارك أفضل اللقطات والإنجازات

### ╠═ ✦ 04 • الجلسات الصوتية

Public community section.

- 🔊 Voice **🔊・المجلس العام**
- 🔊 Voice **🎮・فريق الألعاب 01** — 5 seats
- 🔊 Voice **🎮・فريق الألعاب 02** — 5 seats
- 🔊 Voice **☕・جلسة هادئة**
- 🔊 Voice **💎・مجلس المميزين** — private VIP / moderators / leadership — 10 seats
- 🔊 Voice **🌙・استراحة**

### ╠═ ✦ 05 • مركز المساعدة

Public community section.

- # Text **🎫・طلب-مساعدة** — اطرح سؤالك؛ هذا ليس نظام تذاكر تلقائي
- # Text **🚨・إرشادات-البلاغات** — read-only — تواصل مع الإدارة بشكل خاص لإبلاغات الأعضاء
- # Text **📚・مساعدة-السيرفر** — حلول وأجوبة المجتمع

### ╠═ ✦ 06 • مقر الإدارة

Private — 🛡️・Administrator, ⚔️・Head Moderator, 🔨・Moderator, 🎫・Support Team, OWNER and CO_OWNER.

- # Text **🛡️・دردشة-الإدارة** — نقاشات الطاقم الخاصة
- # Text **📋・مهام-الإدارة** — المهام والتنظيم
- 🔊 Voice **🎙️・اجتماع الإدارة** — 12 seats

### ╚═ ✦ 07 • سجلات الإدارة

Private — 🛡️・Administrator, ⚔️・Head Moderator, OWNER and CO_OWNER.

- # Text **📊・ملاحظات-الإشراف** — ملاحظات الإدارة (ليست سجلات تلقائية)
- # Text **🔐・ملاحظات-الأمان** — ملاحظات الأمان والبلاغات الداخلية

## Files to review

| File | Purpose |
|---|---|
| src/design.mjs | Roles, colors, Arabic layout and explicit ROLE_MIGRATIONS |
| src/safety.mjs | Preservation policy, snapshot fingerprint, confirmation and mutation allowlist |
| src/plan.mjs | Full creation/deletion/preservation/migration proposal |
| src/rebuild.mjs | Creation, verified additive migration and guarded deletion phases |
| src/api.mjs | Sequential REST requests, rate-limit handling and paginated member backups |
| src/permissions.mjs | Private staff/VIP access, preserved leadership and permission caps |
| src/cli.mjs | Separate preview approval and rebuild verification |
| .github/workflows/discord-setup.yml | Separate manual jobs, preview artifact validation and reports |
| test/*.test.mjs | Simulated API and rebuild safety scenarios |

## Review and execution

1. Review this proposal and the local source diff.
2. After code approval, update the existing GitHub repository and manually run preview.
3. Review the actual server-specific deletion/creation report and unmigrated assignments. Add exact old-role-ID mappings if needed, then run a fresh preview.
4. Only explicitly approve a rebuild by manually selecting rebuild with that preview run ID, the exact guild ID and DELETE_ALL_OLD_CHANNELS_AND_ROLES.

No live server inventory was supplied for this code review, so assigning guessed legacy roles to new staff powers would be unsafe. Unmapped assignments remain intact until reviewed. Channel deletion does not preserve messages or attachments; backups cover configuration and available member-role assignments.
