#!/usr/bin/env node
// Arma la lista de instructores que usa la app: lista del examen + cambios publicados desde las apps.
//   Uso: node extract_instructores.js <examen_original.html> <salida.json> <version|auto> [cambios.json] [examen_fusionado.html]
//   - salida.json: lo que las apps instaladas descargan al abrirse (favl-instructores.json).
//   - version: marca de tiempo en segundos; «auto» = ahora (siempre mayor que la que ya había en salida.json).
//   - cambios.json (opcional): favl-app/data/instructores-cambios.json (altas/ediciones/bajas hechas desde la app).
//   - examen_fusionado.html (opcional): copia del examen con la lista ya fusionada (para que el APK nazca al día).
'use strict';
const fs = require('fs');
const L = require('./instructores_lib.js');

const [, , rawPath, outPath, versionTxt, cambiosPath, rawOut] = process.argv;
if (!rawPath || !outPath || !(/^\d+$/.test(versionTxt || '') || versionTxt === 'auto')) {
  console.error('Uso: node extract_instructores.js <examen.html> <salida.json> <version numérica|auto> [cambios.json] [examen_fusionado.html]');
  process.exit(2);
}
function fallar(msg) { console.error('ERROR: ' + msg); process.exit(1); }

try {
  const texto = fs.readFileSync(rawPath, 'utf8');
  const base = L.validarLista(L.leerBase(texto), 'instructor');
  const cambios = L.leerCambios(cambiosPath);
  const lista = L.validarLista(L.fusionar(base, cambios), 'instructor publicado');
  const version = versionTxt === 'auto' ? L.versionNueva(outPath) : Number(versionTxt);

  const json = JSON.stringify({ version: version, generado: new Date().toISOString(), instructores: lista });
  fs.writeFileSync(outPath, json);
  console.log('Instructores publicados: %d (%s) — %d KB%s', lista.length, lista.map(i => i.nombre).join(', '),
    Math.round(json.length / 1024), L.hayCambios(cambios) ? ' — incluye cambios hechos desde la app' : '');

  if (rawOut) {
    if (L.hayCambios(cambios)) fs.writeFileSync(rawOut, L.reemplazarBase(texto, lista));
    else fs.copyFileSync(rawPath, rawOut);
  }
} catch (e) {
  fallar(e.message);
}
