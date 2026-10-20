'use strict';
// Escribe yapur-version.json (lo que la app consulta para avisar que hay un APK nuevo).
//   node escribir_version.js <archivo> <codigo> <nombre> <url_del_apk>
const fs = require('fs');
const [, , ruta, codigo, nombre, apk] = process.argv;
if (!ruta || !/^[0-9]{1,7}$/.test(codigo || '') || !/^[0-9]{1,3}\.[0-9]{1,6}$/.test(nombre || '') || !/^https:\/\/[^\s'"<>]{1,180}\.apk$/.test(apk || '')) {
  console.error('Uso: node escribir_version.js <archivo> <codigo> <nombre N.N> <url_apk>   (datos inválidos)');
  process.exit(1);
}
fs.writeFileSync(ruta, JSON.stringify({ codigo: Number(codigo), nombre, apk, generado: new Date().toISOString() }, null, 2) + '\n');
console.log('Versión publicada: ' + nombre + ' (código ' + codigo + ')');
