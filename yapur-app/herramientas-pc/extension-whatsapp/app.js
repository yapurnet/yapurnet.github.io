/* En la app de YAPUR.NET: cuando la app manda un comprobante a WhatsApp Web, guarda la imagen para que la pegue la otra pestaña. */
window.addEventListener('message', e => {
  if (e.source !== window || !e.data || !e.data.yapurWA) return;
  const m = e.data.yapurWA;
  if (typeof m.png !== 'string' || !m.png.startsWith('data:image/png')) return;
  try { chrome.storage.local.set({ yapurWA: { png: m.png, nombre: String(m.nombre || 'Recibo.png'), ts: Date.now() } }); } catch (_) {}
});
