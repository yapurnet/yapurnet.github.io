'use strict';
// Registro de claves personales de examen (archivo favl-claves.json, en la raíz del sitio).
// Solo guarda el HASH de cada clave (SHA-256 de «FAVL|CLAVE»), nunca la clave ni el nombre del alumno.
//   { version, generado, exigir, claves: [ { h, i, c, e, u } ] }
//   h = hash · i = id del instructor que la creó · c = creada (ms) · e = vence (ms) · u = usada (ms, 0 = sin usar)
const fs = require('fs');

const RE_HASH = /^[0-9a-f]{64}$/;
const DIA = 24 * 3600 * 1000;
const MAX_ACTIVAS = 500;
const MAX_DIAS = 14;
const GRACIA_VENCIDAS = 2 * DIA;      // las vencidas se quitan 2 días después de vencer
const GRACIA_USADAS = 30 * DIA;       // las usadas se recuerdan 30 días (para decir «ya fue usada»)

function registroVacio() { return { version: 0, generado: '', exigir: false, claves: [] }; }

function normalizarRegistro(j) {
  const r = registroVacio();
  if (!j || typeof j !== 'object') return r;
  r.version = Number.isFinite(j.version) ? j.version : 0;
  r.generado = typeof j.generado === 'string' ? j.generado : '';
  r.exigir = j.exigir === true;
  if (Array.isArray(j.claves)) {
    const vistos = new Set();
    j.claves.forEach(k => {
      if (!k || typeof k.h !== 'string' || !RE_HASH.test(k.h) || vistos.has(k.h)) return;
      if (!Number.isFinite(k.c) || !Number.isFinite(k.e) || !Number.isFinite(k.u)) return;
      vistos.add(k.h);
      r.claves.push({ h: k.h, i: typeof k.i === 'string' ? k.i : '', c: k.c, e: k.e, u: k.u });
    });
  }
  return r;
}

function leerRegistro(ruta) {
  if (!ruta || !fs.existsSync(ruta)) return registroVacio();
  const txt = fs.readFileSync(ruta, 'utf8').trim();
  if (!txt) return registroVacio();
  let j;
  try { j = JSON.parse(txt); } catch (e) { throw new Error('el registro de claves no es un JSON válido: ' + e.message); }
  return normalizarRegistro(j);
}

// Quita lo que ya no sirve. Devuelve true si cambió algo.
function podar(reg, ahora) {
  const antes = reg.claves.length;
  reg.claves = reg.claves.filter(k => k.u > 0 ? (ahora - k.u) < GRACIA_USADAS : (ahora - k.e) < GRACIA_VENCIDAS);
  return reg.claves.length !== antes;
}

function activas(reg, ahora) { return reg.claves.filter(k => k.u === 0 && k.e > ahora).length; }

function escribirRegistro(ruta, reg, ahora) {
  const out = { version: Math.max(Math.floor(ahora / 1000), (reg.version || 0) + 1), generado: new Date(ahora).toISOString(), exigir: reg.exigir === true, claves: reg.claves };
  fs.writeFileSync(ruta, JSON.stringify(out) + '\n');
  return out;
}

module.exports = { RE_HASH, DIA, MAX_ACTIVAS, MAX_DIAS, registroVacio, normalizarRegistro, leerRegistro, podar, activas, escribirRegistro };
