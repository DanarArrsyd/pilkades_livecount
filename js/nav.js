// Shared hamburger drawer nav, reused across every page. Each page calls
// initNav({ active: 'input', links: [...], hamburgerTarget: '#hamburgerBtn' })
// with hrefs relative to itself (so it works the same from /admin/, /live/, or root).

// icon paths keyed by link.key so call sites don't need to pass icons themselves.
const NAV_ICONS = {
  dashboard: '<path d="M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6V11h-6v9Zm0-16v5h6V4h-6Z"/>',
  tps: '<path d="M3 17h3v3H3v-3Zm7-6h3v9h-3v-9ZM17 5h3v15h-3V5Z"/>',
  input: '<path d="M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h10v2H4v-2Z"/>',
  candidates: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0v1H5v-1Z"/>',
  logs: '<path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm8 1.5V9h4.5L14 4.5ZM8 13h8v1.5H8V13Zm0 4h8v1.5H8V17Z"/>',
  export: '<path d="M12 3a1 1 0 0 1 1 1v9.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42l2.3 2.3V4a1 1 0 0 1 1-1ZM5 19h14a1 1 0 0 1 0 2H5a1 1 0 0 1 0-2Z"/>',
  snapshots: '<path d="M9 3l-1.5 2H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2.5L15 3H9Zm3 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/>',
  login: '<path d="M11 3a1 1 0 0 1 1 1v1h5a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-5v1a1 1 0 0 1-1 1 1 1 0 0 1-.6-.2l-7-5A1 1 0 0 1 3 15V9a1 1 0 0 1 .4-.8l7-5A1 1 0 0 1 11 3Zm6 3h-4.68L5 9.5v5l7.32 5.23V6H17V6Zm1 2v8h1V8h-1Z"/>',
  settings: '<path d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Zm7.4 2.1-1.55-.3a5.7 5.7 0 0 0-.5-1.2l.88-1.3a1 1 0 0 0-.12-1.27l-.7-.7a1 1 0 0 0-1.27-.12l-1.3.88a5.7 5.7 0 0 0-1.2-.5l-.3-1.55A1 1 0 0 0 12.36 3h-.72a1 1 0 0 0-.98.82l-.3 1.55c-.43.13-.83.3-1.2.5l-1.3-.88a1 1 0 0 0-1.27.12l-.7.7a1 1 0 0 0-.12 1.27l.88 1.3c-.2.37-.37.77-.5 1.2l-1.55.3A1 1 0 0 0 3.78 12v.72a1 1 0 0 0 .82.98l1.55.3c.13.43.3.83.5 1.2l-.88 1.3a1 1 0 0 0 .12 1.27l.7.7a1 1 0 0 0 1.27.12l1.3-.88c.37.2.77.37 1.2.5l.3 1.55a1 1 0 0 0 .98.82h.72a1 1 0 0 0 .98-.82l.3-1.55c.43-.13.83-.3 1.2-.5l1.3.88a1 1 0 0 0 1.27-.12l.7-.7a1 1 0 0 0 .12-1.27l-.88-1.3c.2-.37.37-.77.5-1.2l1.55-.3a1 1 0 0 0 .82-.98V12a1 1 0 0 0-.82-.98Z"/>',
};
const NAV_ICON_DEFAULT = '<circle cx="12" cy="12" r="4"/>';

function initNav(config) {
  const overlay = document.createElement('div');
  overlay.className = 'nav-overlay';
  overlay.id = 'navOverlay';

  const drawer = document.createElement('div');
  drawer.className = 'nav-drawer';
  drawer.id = 'navDrawer';
  drawer.innerHTML = `
    <div class="nav-drawer-head">
      <div class="nav-drawer-brand">
        <span class="nav-drawer-mark">P</span>
        <strong>Pilkades Live Count</strong>
      </div>
      <button class="nav-drawer-close" id="navDrawerClose" aria-label="Tutup menu">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>
    <div class="nav-drawer-label">Menu</div>
    <nav class="nav-drawer-links">
      ${config.links.map((l) => `
        <a href="${l.href}" class="${l.key === config.active ? 'active' : ''}">
          <svg class="nav-drawer-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">${NAV_ICONS[l.key] || NAV_ICON_DEFAULT}</svg>
          <span>${l.label}</span>
        </a>
      `).join('')}
    </nav>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(drawer);

  const hamburgerBtn = document.querySelector(config.hamburgerTarget || '#hamburgerBtn');

  function open() {
    overlay.classList.add('open');
    drawer.classList.add('open');
    if (hamburgerBtn) hamburgerBtn.classList.add('active');
    if (hamburgerBtn) hamburgerBtn.setAttribute('aria-expanded', 'true');
  }
  function close() {
    overlay.classList.remove('open');
    drawer.classList.remove('open');
    if (hamburgerBtn) hamburgerBtn.classList.remove('active');
    if (hamburgerBtn) hamburgerBtn.setAttribute('aria-expanded', 'false');
  }

  overlay.addEventListener('click', close);
  document.getElementById('navDrawerClose').addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  if (hamburgerBtn) {
    hamburgerBtn.setAttribute('aria-expanded', 'false');
    hamburgerBtn.addEventListener('click', () => {
      drawer.classList.contains('open') ? close() : open();
    });
  }
}
