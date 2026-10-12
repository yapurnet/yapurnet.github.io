// Guardar PDF: en la app Android lo entrega el puente nativo (descarga + compartir);
// en un navegador común (pruebas en PC) se descarga normalmente.
if (window.AndroidBridge && (typeof window.AndroidBridge.savePdfBase64 === 'function' || typeof window.AndroidBridge.postMessage === 'function') && typeof entregarPdfApp === 'function') {
  let b64 = pdfBase64;
  if (!b64) { try { b64 = pdfABase64(doc); } catch (err) { b64 = ''; } }
  if (b64) { entregarPdfApp(nombreArchivo.replace(/\s+/g,'_'), b64); } else { doc.save(nombreArchivo); }
} else {
  doc.save(nombreArchivo);
}
return { nombre: nombreArchivo, base64: pdfBase64 };
