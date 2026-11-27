/* En WhatsApp Web: si la app acaba de mandar un comprobante (hace menos de 2 minutos), lo pega solo en el chat abierto.
   Después hay que apretar «Enviar»: nunca se manda solo. Arriba de la pantalla avisa qué pasó (si no aparece ningún aviso, la extensión no está instalada o está apagada). */
(function () {
  const VIDA = 120000;
  const espera = ms => new Promise(r => setTimeout(r, ms));
  function aviso(txt, mal) {
    let d = document.getElementById('yapur-wa-aviso');
    if (!d) { d = document.createElement('div'); d.id = 'yapur-wa-aviso'; document.documentElement.appendChild(d); }
    d.textContent = txt;
    d.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;max-width:min(560px,90vw);padding:10px 16px;border-radius:10px;font:600 14px/1.35 system-ui,Segoe UI,sans-serif;color:#fff;box-shadow:0 4px 18px rgba(0,0,0,.3);background:' + (mal ? '#b3261e' : '#0f766e');
    clearTimeout(aviso.t); aviso.t = setTimeout(() => d.remove(), mal ? 15000 : 7000);
  }
  /* el cuadro donde se escribe el mensaje del chat abierto (nunca el buscador de la izquierda); WhatsApp cambia sus nombres de vez en cuando, por eso se prueban varios */
  const SEL = ['#main footer [contenteditable="true"]', 'footer [contenteditable="true"]', '#main [contenteditable="true"][role="textbox"]', '[contenteditable="true"][data-tab="10"]', '[contenteditable="true"][data-tab="11"]'];
  function caja() {
    for (const s of SEL) for (const el of document.querySelectorAll(s)) if (!el.closest('#side') && el.getAttribute('data-tab') !== '3') return el;
    return null;
  }
  const blobs = () => document.querySelectorAll('img[src^="blob:"]').length;
  let ocupado = false;
  async function pegar() {
    if (ocupado) return;
    let d; try { d = (await chrome.storage.local.get('yapurWA')).yapurWA; } catch (_) { return; }
    if (!d || !d.png || Date.now() - d.ts > VIDA) return;
    ocupado = true;
    try {
      for (let i = 0; i < 120 && !caja(); i++) await espera(500);   /* espera hasta 60 s a que cargue el chat */
      const c = caja();
      if (!c) { aviso('YAPUR.NET: no encontré el cuadro de mensaje de WhatsApp. Hacé clic en el cuadro y apretá Ctrl+V: el recibo ya está copiado.', true); return; }
      await espera(1200);   /* que el chat termine de cargar y WhatsApp ponga el texto del recibo */
      await chrome.storage.local.remove('yapurWA');   /* se usa una sola vez */
      const bin = atob(d.png.split(',')[1]), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const dt = new DataTransfer(); dt.items.add(new File([u8], d.nombre, { type: 'image/png' }));
      const antes = blobs();
      c.focus();
      c.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      for (let i = 0; i < 10 && blobs() <= antes; i++) await espera(300);
      if (blobs() > antes) aviso('YAPUR.NET: recibo pegado. Revisalo y apretá Enviar.');
      else aviso('YAPUR.NET: si no ves el recibo en pantalla, hacé clic en el cuadro de mensaje y apretá Ctrl+V (ya está copiado).', true);
    } finally { ocupado = false; }
  }
  pegar();
  try { chrome.storage.onChanged.addListener((ch) => { if (ch.yapurWA && ch.yapurWA.newValue) pegar(); }); } catch (_) {}
})();
