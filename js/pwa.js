// Registers the service worker and surfaces the two things an operator actually
// needs to know: a new version is ready, and the app can be installed.
// Pages sit at different depths (/, /admin/, /live/), so paths are resolved
// against the page rather than hardcoded.
(function () {
  if (!('serviceWorker' in navigator)) return;

  const root = new URL(document.querySelector('link[rel="manifest"]')?.href || './', location.href);
  const swUrl = new URL('sw.js', root).href;
  const scope = new URL('./', root).href;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register(swUrl, { scope }).catch(() => {});
  });

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    location.reload();
  });

  // Install prompt: Chrome/Edge fire this instead of showing their own button.
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    document.body.classList.add('can-install');
  });

  window.promptPwaInstall = function promptPwaInstall() {
    if (!installPrompt) return;
    installPrompt.prompt();
    installPrompt = null;
    document.body.classList.remove('can-install');
  };
})();
