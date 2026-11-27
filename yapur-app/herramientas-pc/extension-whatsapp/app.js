/* En la app de YAPUR.NET: (1) cuando la app manda un comprobante a WhatsApp Web, guarda la imagen para que la pegue la otra pestaña;
   (2) le avisa a la app que la extensión está instalada (la app lo muestra en el cuadro del recibo). */
const VERSION = '1.1';
const avisar = () => { try { window.postMessage({ yapurWAext: VERSION }, '*'); } catch (_) {} };
window.addEventListener('message', e => {
  if (e.source !== window || !e.data) return;
  if (e.data.yapurWAping) { avisar(); return; }
  if (!e.data.yapurWA) return;
  const m = e.data.yapurWA;
  if (typeof m.png !== 'string' || !m.png.startsWith('data:image/png')) return;
  try { chrome.storage.local.set({ yapurWA: { png: m.png, nombre: String(m.nombre || 'Recibo.png'), ts: Date.now() } }); } catch (_) {}
});
avisar();
