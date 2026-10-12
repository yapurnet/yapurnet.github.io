#!/usr/bin/env node
// Extrae la lista de instructores del examen original y la guarda como favl-instructores.json,
// que la app descarga al abrirse para actualizar los instructores sin reinstalar.
//   Uso: node extract_instructores.js <examen_original.html> <salida.json> <version>
'use strict';
const fs = require('fs');
const vm = require('vm');

const [, , rawPath, outPath, versionTxt] = process.argv;
if (!rawPath || !outPath || !/^\d+$/.test(versionTxt || '')) {
  console.error('Uso: node extract_instructores.js <examen.html> <salida.json> <version numérica>');
  process.exit(2);
}
function fallar(msg) { console.error('ERROR: ' + msg); process.exit(1); }

const t = fs.readFileSync(rawPath, 'utf8');
const ini = '/*INSTR_BASE_INICIO*/', fin = '/*INSTR_BASE_FIN*/';
const a = t.indexOf(ini), b = t.indexOf(fin);
if (a < 0 || b < a) fallar('no encontré la lista de instructores dentro del examen (faltan las marcas INSTR_BASE).');

let lista;
try {
  lista = vm.runInNewContext('(' + t.slice(a + ini.length, b) + ')', Object.create(null), { timeout: 2000 });
} catch (e) {
  fallar('no pude leer la lista de instructores del examen: ' + e.message);
}
if (!Array.isArray(lista) || !lista.length) fallar('la lista de instructores está vacía.');

const ids = new Set();
const salida = lista.map((i, n) => {
  const donde = 'instructor #' + (n + 1) + (i && i.nombre ? ' (' + i.nombre + ')' : '');
  if (!i || typeof i.id !== 'string' || !i.id) fallar(donde + ': falta el id.');
  if (ids.has(i.id)) fallar(donde + ': el id «' + i.id + '» está repetido.');
  ids.add(i.id);
  if (typeof i.nombre !== 'string' || !i.nombre.trim()) fallar(donde + ': falta el nombre.');
  if (typeof i.licencia !== 'string' || !i.licencia.trim()) fallar(donde + ': falta la licencia.');
  if (typeof i.logo !== 'string' || !/^data:image\/(jpeg|png|webp|gif);base64,/.test(i.logo)) fallar(donde + ': la foto no es una imagen válida (jpeg/png/webp/gif).');
  const emails = Array.isArray(i.emails) ? i.emails.filter(e => typeof e === 'string' && e.trim()).map(e => e.trim()) : [];
  return { id: i.id, nombre: i.nombre.trim(), licencia: i.licencia.trim(), emails: emails, logo: i.logo };
});

const json = JSON.stringify({ version: Number(versionTxt), generado: new Date().toISOString(), instructores: salida });
fs.writeFileSync(outPath, json);
console.log('Instructores publicados: %d (%s) — %d KB', salida.length, salida.map(i => i.nombre).join(', '), Math.round(json.length / 1024));
