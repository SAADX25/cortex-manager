# Development guide

Use Node.js 22.9 or later and install dependencies with `npm ci`. Runtime dependencies and development tools are pinned in `package-lock.json`.

## Checks

- `npm run format`: format supported source, tests, styles and documentation.
- `npm run check`: verify formatting, JavaScript syntax, translation keys and placeholder parity. It never connects to Discord.
- `npm test`: run mocked API, UI and lifecycle tests. No production credentials are required.
- `npm run desktop:test`: Windows launcher build and local bridge verification.

Keep tests that protect behavior and permissions. Put test fixtures in `test/helpers/`; temporary test state must be isolated and cleaned up. Never use real tokens in fixtures.

## Localization

- `desktop/web/locales/ar.js`: Arabic messages.
- `desktop/web/locales/en.js`: English messages with exactly the same keys.
- `desktop/web/locales/patterns.js`: dynamic legacy counters and labels.
- `desktop/web/i18n.js`: language selection, persistence and DOM localization only.

New page text should use a descriptive, stable key and `window.CortexI18n.text(key)`. Add the key in both catalogs; preserve placeholders such as `{user}` and `{server}`. Do not derive keys from user content. Catalogs load before the language controller and page scripts, using ordered deferred scripts.

The main dashboard and older inspectors retain Arabic source labels for compatibility. The language controller resolves these through the `ui.*` catalog index. Migrate these labels to keyed calls when changing the relevant component; avoid rewriting unrelated forms. Social and welcome page messages already use keyed calls. Do not add bilingual string pairs to page logic.

Language changes must never translate or overwrite user-entered channel names, role names, drafts, messages, IDs or reports. Use `translate="no"` on user data. Blueprint language and application language are separate choices; only explicitly requested default template names are translated.

## Runtime boundaries

Read [the architecture map](docs/ARCHITECTURE.md) before changing data flow. Keep Discord writes in reviewed backend operations. Preview and apply are distinct. New source changes invalidate prior approvals: generate another preview before executing.

The hosted ZIP uses an explicit allowlist in `src/social-package.mjs`. It contains runtime source, selected assets and nonsecret configuration. Never include `node_modules`, local credentials, `.env`, reports, browser profiles or delivery state. Discloud installs platform dependencies itself.

## Working tree and generated files

Do not edit `out/` as source. It contains local state, user image libraries, saved credentials and generated packages. Do not delete it during routine cleanup. The desktop executable is a generated launcher; the full project folder and installed Node.js remain required. Reopen the app to load changed JavaScript or CSS.
