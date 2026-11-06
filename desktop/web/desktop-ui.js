'use strict';
// UI preferences only. Never read connection credentials or start a worker.
(() => {
  const root = document.documentElement;
  const key = 'cortex.ui.density';
  let density = 'comfortable';
  try {
    if (localStorage.getItem(key) === 'compact') density = 'compact';
  } catch {}
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'desktopDensity';
  button.className = 'desktop-density icon-button';
  button.setAttribute('translate', 'no');
  button.innerHTML =
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="4"/><path d="M8 4v16M12 9h5M12 15h5"/></svg>';
  function apply() {
    root.dataset.density = density;
    const words = window.CortexI18n.text('desktop_ui.' + density);
    button.title = words;
    button.setAttribute('aria-label', words);
    button.setAttribute('aria-pressed', String(density === 'compact'));
  }
  button.onclick = () => {
    density = density === 'compact' ? 'comfortable' : 'compact';
    try {
      localStorage.setItem(key, density);
    } catch {}
    apply();
  };
  document.querySelector('.topbar-tools')?.prepend(button);
  window.addEventListener('cortex-language-changed', apply);
  apply();
})();
