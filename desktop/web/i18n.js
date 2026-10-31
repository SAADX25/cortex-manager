'use strict';

// Only interface text is localized. Names, drafts, JSON, reviewed payloads and
// reports remain original data. Existing DOM nodes and form values are retained.
(() => {
  const catalogs = window.CortexLocales;
  if (!catalogs?.ar || !catalogs?.en || !catalogs?.patterns)
    throw new Error('Language catalogs must load before i18n.js.');
  const en = Object.fromEntries(
    Object.keys(catalogs.ar)
      .filter((key) => key.startsWith('ui.'))
      .map((key) => [catalogs.ar[key], catalogs.en[key]]),
  );
  const patterns = catalogs.patterns;
  let language = 'ar',
    observer;
  const originals = new WeakMap(),
    attributes = new WeakMap();
  const skip =
    'script,style,textarea,input,code,[translate="no"],.emoji,.entity-title strong,#sidebarGuildName,#emojiNamePreview,#editParent option,#overwriteRole option,.message-bubble,.discord-embed,.review-summary,.report-content,.message-confirm-preview';
  function translate(value) {
    if (language !== 'en') return value;
    const trimmed = value.trim();
    let translated = Object.hasOwn(en, trimmed) ? en[trimmed] : undefined;
    if (translated === undefined) {
      for (const [pattern, format] of patterns) {
        const m = trimmed.match(pattern);
        if (m) {
          translated = format(...m);
          break;
        }
      }
    }
    if (translated === undefined) return value;
    return (
      value.slice(0, value.indexOf(trimmed)) +
      translated +
      value.slice(value.indexOf(trimmed) + trimmed.length)
    );
  }
  function localize() {
    observer?.disconnect();
    try {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!node.parentElement || node.parentElement.closest(skip) || !node.data.trim()) continue;
        let entry = originals.get(node);
        if (!entry || node.data !== entry.rendered) entry = { source: node.data };
        entry.rendered = translate(entry.source);
        if (node.data !== entry.rendered) node.data = entry.rendered;
        originals.set(node, entry);
      }
      document.querySelectorAll('[placeholder],[aria-label],[title]').forEach((element) => {
        if (element.closest('[translate="no"]')) return;
        const saved = attributes.get(element) ?? {};
        for (const name of ['placeholder', 'aria-label', 'title']) {
          if (
            !element.hasAttribute(name) ||
            (element.matches('[data-entity-id]') && name === 'title')
          )
            continue;
          const value = element.getAttribute(name);
          let entry = saved[name];
          if (!entry || value !== entry.rendered) entry = { source: value };
          entry.rendered = translate(entry.source);
          if (language === 'en' && element.dataset.nameEmoji) {
            const english =
              (saved.title?.source ?? element.getAttribute('title') ?? '')
                .replace(/\p{Script=Arabic}+/gu, '')
                .trim() || 'Custom emoji';
            entry.rendered =
              english + (name === 'aria-label' ? ' ' + element.dataset.nameEmoji : '');
          }
          if (value !== entry.rendered) element.setAttribute(name, entry.rendered);
          saved[name] = entry;
        }
        attributes.set(element, saved);
      });
    } finally {
      observer?.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['placeholder', 'aria-label', 'title'],
      });
    }
  }
  function apply(next) {
    language = next;
    document.documentElement.lang = next;
    document.documentElement.dir = next === 'ar' ? 'rtl' : 'ltr';
    document.title =
      next === 'ar' ? 'Cortex Manager 6 | لوحة التحكم الحديثة' : 'Cortex Manager 6 | Dashboard';
    document.querySelectorAll('#languageSwitch [data-language]').forEach((option) => {
      option.setAttribute('aria-pressed', String(option.dataset.language === next));
    });
    localize();
    window.dispatchEvent(new CustomEvent('cortex-language-changed', { detail: next }));
  }
  function text(key) {
    const value = catalogs[language]?.[key];
    if (typeof value !== 'string') throw new Error('Unknown translation key: ' + key);
    return value;
  }
  window.CortexI18n = {
    get language() {
      return language;
    },
    translate,
    text,
    refresh: localize,
  };
  const button = document.querySelector('#languageSwitch');
  let pending = true;
  function setPending(value) {
    pending = value;
    button.setAttribute('aria-busy', String(value));
    button.querySelectorAll('[data-language]').forEach((option) => {
      option.disabled = value;
    });
  }
  const fragment = location.hash.slice(1),
    key = fragment.startsWith('key=')
      ? new URLSearchParams(fragment).get('key')
      : decodeURIComponent(fragment);
  async function preference(method = 'GET', value) {
    const response = await fetch('/api/preferences', {
      method,
      cache: 'no-store',
      headers: { 'X-Cortex-Key': key, ...(value ? { 'Content-Type': 'application/json' } : {}) },
      ...(value ? { body: JSON.stringify({ language: value }) } : {}),
    });
    if (!response.ok) throw new Error('Language preference could not be saved.');
    return response.json();
  }
  observer = new MutationObserver(localize);
  apply('ar');
  preference()
    .then((p) => {
      if (['ar', 'en'].includes(p.language)) apply(p.language);
    })
    .catch(() => {})
    .finally(() => setPending(false));
  button.onclick = async (event) => {
    const option = event.target.closest('[data-language]'),
      next = option?.dataset.language;
    if (pending || !['ar', 'en'].includes(next) || next === language) return;
    const previous = language;
    setPending(true);
    apply(next);
    try {
      await preference('POST', language);
    } catch {
      apply(previous);
      window.dispatchEvent(new CustomEvent('cortex-language-error'));
    } finally {
      setPending(false);
    }
  };
})();
