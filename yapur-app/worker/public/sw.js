/* Hace que la app abra aunque no haya señal: guarda la pantalla principal en el equipo.
   Con señal siempre se baja la versión nueva (si la red tarda más de 3,5 segundos, se usa la guardada).
   Los datos (/api/*) nunca pasan por acá: los maneja la propia app. */
const V = 'yapur-196ca73502';
const SHELL = ['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
async function netFirst(r) {
  const cache = await caches.open(V);
  const net = fetch(r).then(res => { if (res.ok) cache.put('./', res.clone()); return res; });
  net.catch(() => {});
  const wait = new Promise(res => setTimeout(() => res(null), 3500));
  try {
    const first = await Promise.race([net, wait]);
    if (first) return first;
    return (await cache.match('./')) || await net;
  } catch (e) {
    const hit = await cache.match('./');
    if (hit) return hit;
    throw e;
  }
}
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin || u.pathname.startsWith('/api/') || u.pathname === '/healthz') return;
  if (r.mode === 'navigate') { e.respondWith(netFirst(r)); return; }
  e.respondWith(caches.match(r).then(hit => hit || fetch(r).then(res => {
    if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); }
    return res;
  })));
});
