import fs from 'node:fs';
import vm from 'node:vm';
/** Load production browser catalogs into an isolated UI test. */
export function loadLocaleCatalogs(context) {
  for (const file of ['ar.js', 'en.js', 'patterns.js'])
    vm.runInContext(
      fs.readFileSync(new URL('../../desktop/web/locales/' + file, import.meta.url), 'utf8'),
      context,
    );
  const i18n = context.window.CortexI18n;
  if (i18n) i18n.text = (key) => context.window.CortexLocales[i18n.language ?? 'ar'][key];
}
