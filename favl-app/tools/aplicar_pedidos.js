#!/usr/bin/env node
// Aplica los pedidos de instructores que mandan las apps (issues «FAVL-INSTR …»).
//   Uso: node aplicar_pedidos.js <issues.json> <cambios.json> <resultado.json> <examen_original.html>
//   Entorno: FAVL_OWNER (dueño del repositorio)
//
// Seguridad: el texto de los issues es PÚBLICO y no es confiable. Un pedido solo se aplica si
//   1) lo abrió el dueño del repositorio: cualquiera puede abrir issues, pero a nombre del dueño solo se puede
//      con su clave de GitHub, que está únicamente en el celular de quien carga los instructores,
//   2) su identificador único (nonce) no se aplicó antes (no se puede repetir un pedido viejo),
//   3) todos sus datos pasan una validación estricta.
// Nada del texto del issue se usa como comando ni se escribe en los comentarios.
'use strict';
const fs = require('fs');
const L = require('./instructores_lib.js');

const [, , issuesPath, cambiosPath, resultadoPath, rawPath] = process.argv;
if (!issuesPath || !cambiosPath || !resultadoPath || !rawPath) {
  console.error('Uso: node aplicar_pedidos.js <issues.json> <cambios.json> <resultado.json> <examen.html>');
  process.exit(2);
}

const MAX_PEDIDOS_POR_CORRIDA = 30;
const MAX_INSTRUCTORES = 50;
const MAX_CUERPO = 70000;
const MAX_LOGO = 200000;

const dueno = String(process.env.FAVL_OWNER || '').toLowerCase();

function textoSeguro(s, min, max) {
  if (typeof s !== 'string') return null;
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length < min || t.length > max || L.RE_CONTROL.test(t) || /[<>]/.test(t)) return null;
  return t;
}

let issues = [];
try { issues = JSON.parse(fs.readFileSync(issuesPath, 'utf8')); } catch (e) { issues = []; }
if (!Array.isArray(issues)) issues = [];
issues = issues.filter(i => i && Number.isInteger(i.number)).sort((a, b) => a.number - b.number);

let base, cambios;
try {
  base = L.validarLista(L.leerBase(fs.readFileSync(rawPath, 'utf8')), 'instructor');
  cambios = L.leerCambios(cambiosPath);
} catch (e) {
  console.error('ERROR: ' + e.message);
  process.exit(1);
}
const idsBase = new Set(base.map(b => b.id));
const resultados = [];
let huboCambios = false;

function resultado(number, estado, mensaje) { resultados.push({ number: number, estado: estado, mensaje: mensaje }); }

function aplicarSet(p) {
  if (typeof p.id !== 'string' || !L.RE_ID.test(p.id)) return 'El identificador del instructor no es válido.';
  const d = p.d;
  if (!d || typeof d !== 'object') return 'Faltan los datos del instructor.';
  const nombre = textoSeguro(d.nombre, 3, 120);
  if (!nombre) return 'El nombre no es válido.';
  const licencia = textoSeguro(d.licencia, 1, 40);
  if (!licencia) return 'La licencia no es válida.';
  let emails;
  if (d.emails !== undefined) {
    if (!Array.isArray(d.emails) || d.emails.length > 20 || d.emails.some(e => typeof e !== 'string' || e.length > 200)) return 'Los correos no son válidos.';
    emails = L.limpiarCorreos(d.emails);
  }
  let logo;
  if (d.logo !== undefined) {
    if (typeof d.logo !== 'string' || d.logo.length > MAX_LOGO || !L.RE_LOGO.test(d.logo)) return 'La foto no es una imagen válida o pesa demasiado.';
    logo = d.logo;
  }

  const actual = L.fusionar(base, cambios);
  const existe = actual.find(i => i.id === p.id);
  const otroConMismoNombre = actual.find(i => i.id !== p.id && i.nombre.toLowerCase() === nombre.toLowerCase());
  if (otroConMismoNombre) return 'Ya hay otro instructor con ese nombre.';

  const enAgregados = cambios.agregados.find(a => a.id === p.id);
  if (idsBase.has(p.id)) {
    // instructor del examen: se guarda como edición (y si estaba quitado, vuelve)
    cambios.eliminados = cambios.eliminados.filter(x => x !== p.id);
    const e = Object.assign({}, cambios.editados[p.id] || {}, { nombre: nombre, licencia: licencia });
    if (emails !== undefined) e.emails = emails;
    if (logo !== undefined) e.logo = logo;
    cambios.editados[p.id] = e;
    return null;
  }
  if (enAgregados) {
    enAgregados.nombre = nombre; enAgregados.licencia = licencia;
    if (emails !== undefined) enAgregados.emails = emails;
    if (logo !== undefined) enAgregados.logo = logo;
    return null;
  }
  // instructor nuevo
  if (existe) return 'Ese identificador ya está en uso.';
  if (logo === undefined) return 'Falta la foto del instructor nuevo.';
  if (actual.length >= MAX_INSTRUCTORES) return 'Se alcanzó el máximo de instructores.';
  cambios.agregados.push({ id: p.id, nombre: nombre, licencia: licencia, logo: logo, emails: emails || [] });
  return null;
}

function aplicarDel(p) {
  if (typeof p.id !== 'string' || !L.RE_ID.test(p.id)) return { error: 'El identificador del instructor no es válido.' };
  const actual = L.fusionar(base, cambios);
  if (!actual.some(i => i.id === p.id)) return { aviso: 'Ese instructor ya no estaba en la lista.' };
  if (actual.length <= 1) return { error: 'No se puede quitar al último instructor.' };
  if (idsBase.has(p.id)) {
    if (!cambios.eliminados.includes(p.id)) cambios.eliminados.push(p.id);
    delete cambios.editados[p.id];
  } else {
    cambios.agregados = cambios.agregados.filter(a => a.id !== p.id);
  }
  return {};
}

issues.slice(0, MAX_PEDIDOS_POR_CORRIDA).forEach(it => {
  const n = it.number;
  const autor = String((it.author && it.author.login) || '').toLowerCase();
  if (typeof it.title !== 'string' || !/^FAVL-INSTR(\s|$)/.test(it.title) || !dueno || autor !== dueno) {
    return resultado(n, 'ignorado', '');
  }
  if (typeof it.body !== 'string' || it.body.length > MAX_CUERPO) return resultado(n, 'rechazado', 'El pedido no tiene el formato esperado.');
  let p;
  try { p = JSON.parse(it.body); } catch (e) { return resultado(n, 'rechazado', 'El pedido no tiene el formato esperado.'); }
  if (!p || p.v !== 1 || typeof p.n !== 'string' || !/^[a-f0-9]{16,32}$/.test(p.n) || (p.op !== 'set' && p.op !== 'del')) {
    return resultado(n, 'rechazado', 'El pedido no tiene el formato esperado.');
  }
  if (cambios.aplicados.includes(p.n)) return resultado(n, 'repetido', 'Este pedido ya se había aplicado.');

  let error = null, aviso = '';
  if (p.op === 'set') {
    error = aplicarSet(p);
  } else {
    const r = aplicarDel(p);
    error = r.error || null; aviso = r.aviso || '';
  }
  cambios.aplicados.push(p.n);          // pedido del dueño con formato válido: no se vuelve a procesar
  huboCambios = true;                    // (también si se rechazó: el nonce queda registrado)
  if (error) return resultado(n, 'rechazado', error);
  resultado(n, 'aplicado', aviso || 'Listo: el cambio ya está publicado para todos los celulares.');
});

if (huboCambios) fs.writeFileSync(cambiosPath, JSON.stringify(cambios) + '\n');
fs.writeFileSync(resultadoPath, JSON.stringify({ huboCambios: huboCambios, issues: resultados }));
const cuenta = {};
resultados.forEach(r => { cuenta[r.estado] = (cuenta[r.estado] || 0) + 1; });
console.log('Pedidos: ' + JSON.stringify(cuenta) + (issues.length > MAX_PEDIDOS_POR_CORRIDA ? ' (quedan más para la próxima corrida)' : ''));
