#!/usr/bin/env node
'use strict';
// Deja en el cuestionario la misma lista de instructores que lleva el examen de la app (sin correos),
// para que desde el cuestionario se pueda elegir al instructor con su nombre, licencia y logo.
//   Uso: node inyectar_instructores_cuestionario.js <examen_fusionado.html> <cuestionario.html>
// La lista va entre las marcas /*CUEST_INSTR_INI*/ y /*CUEST_INSTR_FIN*/ del cuestionario. Si faltan, falla a propósito
// (si no, el cuestionario quedaría con una lista vieja sin que nadie se entere).
const fs = require('fs');
const L = require('./instructores_lib.js');

const INI = '/*CUEST_INSTR_INI*/';
const FIN = '/*CUEST_INSTR_FIN*/';

function inyectar(textoExamen, textoCuestionario) {
  const lista = L.validarLista(L.leerBase(textoExamen), 'instructor del examen')
    .map(i => ({ id: i.id, nombre: i.nombre, licencia: i.licencia, logo: i.logo }));
  const a = textoCuestionario.indexOf(INI), b = textoCuestionario.indexOf(FIN);
  if (a < 0 || b < a || textoCuestionario.indexOf(INI, a + 1) >= 0 || textoCuestionario.indexOf(FIN, b + 1) >= 0) {
    throw new Error('el cuestionario no tiene las marcas CUEST_INSTR_INI / CUEST_INSTR_FIN (una sola vez cada una).');
  }
  // «<» escapado para que ningún dato pueda cerrar el <script>
  const js = JSON.stringify(lista).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return { texto: textoCuestionario.slice(0, a + INI.length) + js + textoCuestionario.slice(b), cantidad: lista.length };
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
    console.log('    cuestionario: ' + r.cantidad + ' instructores (los mismos del examen)');
  } catch (e) {
    console.error('ERROR: ' + e.message);
    process.exit(1);
  }
}

module.exports = { inyectar, INI, FIN };
