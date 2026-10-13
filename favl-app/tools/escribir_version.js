'use strict';
// Escribe favl-version.json (lo que las apps consultan para avisar que hay una versión nueva).
//   node escribir_version.js <archivo> <codigo> <nombre> <url_del_apk>
// «minimo» (versión mínima que se pide) y «nota» se conservan del archivo anterior: los cambia el administrador a mano.
const fs = require('fs');

const [, , ruta, codigo, nombre, apk] = process.argv;
if (!ruta || !/^[0-9]{1,7}$/.test(codigo || '') || !/^[0-9A-Za-z._-]{1,20}$/.test(nombre || '') || !/^https:\/\/[^\s'"<>]{1,180}\.apk$/.test(apk || '')) {
  console.error('Uso: node escribir_version.js <archivo> <codigo> <nombre> <url_apk>   (datos inválidos)');
  process.exit(1);
}
let previo = {};
try { previo = JSON.parse(fs.readFileSync(ruta, 'utf8')) || {}; } catch (e) { previo = {}; }
const salida = {
  codigo: Number(codigo),
  nombre: nombre,
  minimo: (Number.isInteger(previo.minimo) && previo.minimo >= 0) ? previo.minimo : 0,
  apk: apk,
  generado: new Date().toISOString()
};
if (typeof previo.nota === 'string' && previo.nota.length <= 200) salida.nota = previo.nota;
fs.writeFileSync(ruta, JSON.stringify(salida, null, 2) + '\n');
console.log('Versión publicada: ' + nombre + ' (código ' + codigo + ', mínima ' + salida.minimo + ')');
