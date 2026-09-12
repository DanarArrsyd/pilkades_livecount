// Shared hamburger drawer nav, reused across every page. Each page calls
// initNav({ active: 'input', links: [...], hamburgerTarget: '#hamburgerBtn' })
// with hrefs relative to itself (so it works the same from /admin/, /live/, or root).
function initNav(config) {
  const overlay = document.createElement('div');
  overlay.className = 'nav-overlay';
  overlay.id = 'navOverlay';

  const drawer = document.createElement('div');
  drawer.className = 'nav-drawer';
  drawer.id = 'navDrawer';
  drawer.innerHTML = `
    <div class="nav-drawer-head">
      <strong>Pilkades Live Count</strong>
      <button class="nav-drawer-close" id="navDrawerClose" aria-label="Tutup menu">×</button>
    </div>
    ${config.links.map((l) => `<a href="${l.href}" class="${l.key === config.active ? 'active' : ''}">${l.label}</a>`).join('')}
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(drawer);

  function open() {
    overlay.classList.add('open');
    drawer.classList.add('open');
  }
  function close() {
    overlay.classList.remove('open');
    drawer.classList.remove('open');
  }

  overlay.addEventListener('click', close);
  document.getElementById('navDrawerClose').addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  const hamburgerBtn = document.querySelector(config.hamburgerTarget || '#hamburgerBtn');
  if (hamburgerBtn) {
    hamburgerBtn.addEventListener('click', open);
  }
}
