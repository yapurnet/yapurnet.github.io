#!/usr/bin/env node
'use strict';
// Deja en el cuestionario dos cosas copiadas del examen de la app, para que no haya que tocarlas a mano:
//   1) la lista de instructores (sin correos), para elegir al instructor con su nombre, licencia y logo;
//   2) el hash de la clave de instructor (CLAVE_INSTRUCTOR_HASH), que hace falta para agregar o editar
//      un instructor que no está en la lista (sin la clave, un alumno solo puede elegir de la lista).
//   Uso: node inyectar_instructores_cuestionario.js <examen_fusionado.html> <cuestionario.html>
// Cada cosa va entre sus marcas /*CUEST_INSTR_INI*/…/*CUEST_INSTR_FIN*/ y /*CUEST_CLAVE_INI*/…/*CUEST_CLAVE_FIN*/.
// Si faltan (o el examen no tiene la clave), falla a propósito: si no, el cuestionario quedaría con una lista o una
// clave vieja sin que nadie se entere.
const fs = require('fs');
const L = require('./instructores_lib.js');

const INI = '/*CUEST_INSTR_INI*/';
const FIN = '/*CUEST_INSTR_FIN*/';
const CLAVE_INI = '/*CUEST_CLAVE_INI*/';
const CLAVE_FIN = '/*CUEST_CLAVE_FIN*/';

function entreMarcas(texto, ini, fin, nuevo) {
  const a = texto.indexOf(ini), b = texto.indexOf(fin);
  if (a < 0 || b < a || texto.indexOf(ini, a + 1) >= 0 || texto.indexOf(fin, b + 1) >= 0) {
    throw new Error('el cuestionario no tiene las marcas ' + ini.replace(/\/\*|\*\//g, '') + ' / ' + fin.replace(/\/\*|\*\//g, '') + ' (una sola vez cada una).');
  }
  return texto.slice(0, a + ini.length) + nuevo + texto.slice(b);
}

// Hash de la clave de instructor del examen: 64 caracteres hexadecimales, una sola vez.
function leerHashClave(textoExamen) {
  const m = textoExamen.match(/const\s+CLAVE_INSTRUCTOR_HASH\s*=\s*"([0-9a-f]{64})"\s*;/g);
  if (!m || m.length !== 1) throw new Error('no encontré (una sola vez) CLAVE_INSTRUCTOR_HASH en el examen.');
  return m[0].match(/"([0-9a-f]{64})"/)[1];
}

function inyectar(textoExamen, textoCuestionario) {
  const lista = L.validarLista(L.leerBase(textoExamen), 'instructor del examen')
    .map(i => ({ id: i.id, nombre: i.nombre, licencia: i.licencia, logo: i.logo }));
  // «<» escapado para que ningún dato pueda cerrar el <script>
  const js = JSON.stringify(lista).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  let texto = entreMarcas(textoCuestionario, INI, FIN, js);
  const hash = leerHashClave(textoExamen);
  texto = entreMarcas(texto, CLAVE_INI, CLAVE_FIN, "'" + hash + "'");
  return { texto, cantidad: lista.length, hash };
}

if (require.main === module) {
  const [, , rutaExamen, rutaCuestionario] = process.argv;
  if (!rutaExamen || !rutaCuestionario) {
    console.error('Uso: node inyectar_instructores_cuestionario.js <examen_fusionado.html> <cuestionario.html>');
    process.exit(2);
  }
  try {
    const r = inyectar(fs.readFileSync(rutaExamen, 'utf8'), fs.readFileSync(rutaCuestionario, 'utf8'));
    fs.writeFileSync(rutaCuestionario, r.texto);
    console.log('    cuestionario: ' + r.cantidad + ' instructores (los mismos del examen) y la clave de instructor del examen');
  } catch (e) {
    console.error('ERROR: ' + e.message);
    process.exit(1);
  }
}

module.exports = { inyectar, leerHashClave, INI, FIN, CLAVE_INI, CLAVE_FIN };
