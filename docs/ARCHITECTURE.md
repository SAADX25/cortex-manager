# Architecture

Cortex Manager has two independent runtimes: a Windows administration app and a hosted notification bot. They share Discord API utilities but do not automatically synchronize configuration.

## Project map

| Location                                                      | Responsibility                                                                           |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `desktop/ModernLauncher.cs`                                   | Windows window lifecycle, Edge app mode and local Node process                           |
| `desktop/web/app.js`                                          | Dashboard navigation, server inventory and editor orchestration                          |
| `desktop/web/role-translation.js`                             | Conservative role-name suggestions and name-only drafts for the existing review workflow |
| `desktop/web/designer.js`                                     | Local blueprint editing, numbered designs, undo and template-language switching          |
| `desktop/web/locales/`                                        | Arabic/English catalogs and legacy dynamic-label rules                                   |
| `desktop/web/i18n.js`                                         | Runtime translation, RTL/LTR and saved language preference                               |
| `desktop/web/social-ui.js`, `welcome-ui.js`                   | Feature forms, local previews and explicit save/send flows                               |
| `src/desktop-server.mjs`                                      | Authenticated loopback HTTP bridge, isolated session state and route orchestration       |
| `src/desktop-worker.mjs`                                      | Short-lived Discord operations, credentials received over stdin                          |
| `src/api.mjs`, `gateway.mjs`                                  | REST rate limits, snapshots, gateway sessions and reconnect handling                     |
| `src/editor.mjs`, `batch-editor.mjs`, `role-grants.mjs`       | Review/confirmation and narrow apply operations                                          |
| `src/custom-design.mjs`, `design-presets.mjs`                 | Blueprint schema and five bilingual server layouts                                       |
| `src/plan.mjs`, `rebuild.mjs`, `safety.mjs`                   | Plans, approval binding and guarded create/migrate/delete execution                      |
| `src/permissions.mjs`                                         | Permission bits, role hierarchy and channel overwrites                                   |
| `src/hosted-bot.mjs`                                          | Hosted process startup, polling lifecycle and shutdown                                   |
| `src/social-*.mjs`, `instagram-rss.mjs`, `youtube-source.mjs` | Feed validation, provider reads, deduplication, manual links and hosted export           |
| `src/welcome-*.mjs`                                           | Membership messages, image rendering, background library and durable deduplication       |
| `test/`                                                       | Behavioral tests with mocked Discord and temporary local storage                         |
| `scripts/check.mjs`                                           | Offline syntax and localization checks                                                   |
| `out/`                                                        | Ignored generated files and private local application state                              |

## Administration flow

The launcher starts the loopback bridge; the browser receives a per-launch capability. Static resources use a fixed allowlist. APIs validate the capability, Host and Origin. UI actions start isolated workers with secrets on stdin; credentials are not returned to the browser.

Read inventory → edit a local draft → review exact changes → explicitly confirm → recheck configuration and source freshness → apply allowed writes → save a report. New blueprint replacements are created before approved obsolete resources are removed. Unmapped member assignments retain their original roles.

Custom role names have no special protection. Manageability follows Discord permissions, bot hierarchy, managed-role status and the existing protection for bot-held roles and everyone. Community-linked channels and parents remain protected. No workflow operation kicks, bans or deletes the guild.

## Hosted flow

Saved nonsecret social/welcome settings → explicit ZIP export → manual deployment → hosted process reads environment credentials and package configuration. Persistent delivery reservations prevent ambiguous retries. Updating local forms does not change the hosted bot until another package is deployed.

Canvas/font loading is lazy; image rendering is serialized and bounded. Original uploaded backgrounds are normalized into a per-guild library. Only selected backgrounds enter the hosted package.

## Maintenance boundaries

Formatting changes retain module paths and public APIs. The large dashboard and bridge remain orchestration modules; feature-specific behavior belongs in its existing module rather than expanding their event handlers. Styles retain their established cascade order to avoid appearance regressions. Backend operational errors remain authored at their source; user-visible translations belong in the catalogs, never in provider response data.

Kick notifications use src/kick-notifications.mjs with separate Arabic/English copy in src/notification-locales.mjs. The hosted Gateway enables audit events only for explicitly enabled guild settings. Authoritative kick entries generate staff reports; bounded queues, persisted reservations and mention suppression apply. No moderation write is implemented. Ordinary farewell suppression is best effort within a 2.5-second audit arrival window.

Role membership management uses the reviewed role-grant protocol with an explicit grant/remove operation bound into the approval hash. Removal calls only DELETE /guilds/{guild}/members/{member}/roles/{role}, after rechecking the member, assignments, Manage Roles and hierarchy. It never deletes the role or replaces the member role array. The authenticated role-members read action pages up to 1000 guild members per request and retains filtered names/IDs only in the current session; the UI supports search and loading more pages. Enable Server Members Intent for member listing. Protected roles, bot members and the actual guild owner remain ineligible for removal.
