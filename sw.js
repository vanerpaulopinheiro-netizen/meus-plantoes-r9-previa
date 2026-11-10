/* Service worker do Meus Plantões — cache do próprio app (nunca de dados): precache ATÔMICO num cache nomeado pela versão
   (se um arquivo falhar, o worker novo não instala e o antigo continua); o cache anterior só é apagado na ativação;
   sem skipWaiting automático — o app avisa "nova versão" e manda SKIP_WAITING quando não há gravação pendente. */
const VERSION = '1.0.0+a53c28ca8f';
const CACHE = 'mp-' + VERSION;
const ASSETS = ['./', './index.html', './styles.css', './src/app.js', './src/core.js', './src/store.js', './src/codecs.js', './src/sync.js', './src/merge.js', './src/sync2.js', './src/version.js', './sample.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png', './fonts/inter-var.woff2'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('mp-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); if (e.data === 'VERSION') e.source?.postMessage({ version: VERSION }); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url); if (e.request.method !== 'GET' || u.origin !== self.location.origin) return; /* nada de outra origem passa por aqui */
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true }); if (hit) return hit;
    try { return await fetch(e.request); } catch (err) { if (e.request.mode === 'navigate') { const idx = await c.match('./index.html'); if (idx) return idx; } throw err; }
  }));
});
