/* En WhatsApp Web: si la app acaba de mandar un comprobante (hace menos de 2 minutos), lo pega solo en el chat abierto.
   Después hay que apretar «Enviar»: nunca se manda solo. */
(function () {
  const VIDA = 120000;
  async function pegar() {
    let d; try { d = (await chrome.storage.local.get('yapurWA')).yapurWA; } catch (_) { return; }
    if (!d || !d.png || Date.now() - d.ts > VIDA) return;
    const caja = () => document.querySelector('footer div[contenteditable="true"]') || document.querySelector('div[contenteditable="true"][data-tab="10"]');
    for (let i = 0; i < 120 && !caja(); i++) await new Promise(r => setTimeout(r, 500));   /* espera hasta 60 s a que cargue el chat */
    const c = caja(); if (!c) return;
    await chrome.storage.local.remove('yapurWA');   /* se usa una sola vez */
    const bin = atob(d.png.split(',')[1]), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const dt = new DataTransfer(); dt.items.add(new File([u8], d.nombre, { type: 'image/png' }));
    c.focus();
    c.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }
  pegar();
  try { chrome.storage.onChanged.addListener((ch) => { if (ch.yapurWA && ch.yapurWA.newValue) pegar(); }); } catch (_) {}
})();
