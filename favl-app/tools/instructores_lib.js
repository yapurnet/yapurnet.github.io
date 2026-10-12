'use strict';
// Lógica común de la lista de instructores (la usan la compilación del APK y el procesador de pedidos).
// La fusión de «lista del examen» + «cambios publicados» replica construirListaInstructores() del examen.
const fs = require('fs');
const vm = require('vm');

const INI = '/*INSTR_BASE_INICIO*/';
const FIN = '/*INSTR_BASE_FIN*/';
const MAX_CORREOS = 5;
const RE_CORREO = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const RE_LOGO = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const RE_ID = /^[A-Za-z0-9_-]{1,60}$/;
const RE_CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]/;

// Igual que limpiarCorreos() del examen: minúsculas, sin repetir, solo los que parecen correo, máximo 5.
function limpiarCorreos(entrada) {
  let crudos = [];
  if (Array.isArray(entrada)) {
    crudos = entrada;
  } else {
    String(entrada == null ? '' : entrada).split(/[,;\r\n]+/).forEach(seg => {
      const conNombre = /<[^<>]*>/.test(seg);
      seg.replace(/[<>"]/g, ' ').split(/\s+/).filter(Boolean).forEach(t => {
        if (!conNombre || t.indexOf('@') >= 0) crudos.push(t);
      });
    });
  }
  const validos = [];
  crudos.map(s => String(s).trim().toLowerCase()).filter(Boolean).forEach(p => {
    if (RE_CORREO.test(p) && p.length <= 120 && !validos.includes(p)) validos.push(p);
  });
  return validos.slice(0, MAX_CORREOS);
}

// ---- lista de fábrica (la que está escrita dentro del examen) ----
function leerBase(texto) {
  const a = texto.indexOf(INI), b = texto.indexOf(FIN);
  if (a < 0 || b < a) throw new Error('no encontré la lista de instructores dentro del examen (faltan las marcas INSTR_BASE).');
  let lista;
  try {
    lista = vm.runInNewContext('(' + texto.slice(a + INI.length, b) + ')', Object.create(null), { timeout: 2000 });
  } catch (e) {
    throw new Error('no pude leer la lista de instructores del examen: ' + e.message);
  }
  if (!Array.isArray(lista) || !lista.length) throw new Error('la lista de instructores está vacía.');
  return lista;
}

// Valida una lista completa y la deja limpia. Lanza Error con un mensaje claro si algo no cierra.
function validarLista(lista, etiqueta) {
  const ids = new Set();
  return lista.map((i, n) => {
    const donde = (etiqueta || 'instructor') + ' #' + (n + 1) + (i && i.nombre ? ' (' + i.nombre + ')' : '');
    if (!i || typeof i.id !== 'string' || !i.id) throw new Error(donde + ': falta el id.');
    if (ids.has(i.id)) throw new Error(donde + ': el id «' + i.id + '» está repetido.');
    ids.add(i.id);
    if (typeof i.nombre !== 'string' || !i.nombre.trim()) throw new Error(donde + ': falta el nombre.');
    if (typeof i.licencia !== 'string' || !i.licencia.trim()) throw new Error(donde + ': falta la licencia.');
    if (typeof i.logo !== 'string' || !/^data:image\/(jpeg|png|webp|gif);base64,/.test(i.logo)) throw new Error(donde + ': la foto no es una imagen válida (jpeg/png/webp/gif).');
    const emails = Array.isArray(i.emails) ? i.emails.filter(e => typeof e === 'string' && e.trim()).map(e => e.trim()) : [];
    return { id: i.id, nombre: i.nombre.trim(), licencia: i.licencia.trim(), emails: emails, logo: i.logo };
  });
}

// Reemplaza la lista de fábrica dentro del HTML del examen (se escapa «<» para no cerrar el <script>).
function reemplazarBase(texto, lista) {
  const a = texto.indexOf(INI), b = texto.indexOf(FIN);
  if (a < 0 || b < a) throw new Error('faltan las marcas INSTR_BASE.');
  const js = JSON.stringify(lista, null, 2).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return texto.slice(0, a + INI.length) + js + texto.slice(b);
}

// ---- cambios publicados (archivo favl-app/data/instructores-cambios.json) ----
function cambiosVacios() { return { agregados: [], editados: {}, eliminados: [], aplicados: [] }; }

function normalizarCambios(c) {
  const v = cambiosVacios();
  if (!c || typeof c !== 'object') return v;
  if (Array.isArray(c.agregados)) {
    v.agregados = c.agregados.filter(i => i && typeof i.id === 'string' && typeof i.nombre === 'string' &&
      typeof i.licencia === 'string' && typeof i.logo === 'string' && /^data:image\//.test(i.logo));
  }
  if (c.editados && typeof c.editados === 'object' && !Array.isArray(c.editados)) {
    Object.keys(c.editados).forEach(k => { if (c.editados[k] && typeof c.editados[k] === 'object') v.editados[k] = c.editados[k]; });
  }
  if (Array.isArray(c.eliminados)) v.eliminados = c.eliminados.filter(x => typeof x === 'string');
  if (Array.isArray(c.aplicados)) v.aplicados = c.aplicados.filter(x => typeof x === 'string');
  return v;
}

function leerCambios(ruta) {
  if (!ruta || !fs.existsSync(ruta)) return cambiosVacios();
  const txt = fs.readFileSync(ruta, 'utf8').trim();
  if (!txt) return cambiosVacios();
  let j;
  try { j = JSON.parse(txt); } catch (e) { throw new Error('el archivo de cambios de instructores no es un JSON válido: ' + e.message); }
  return normalizarCambios(j);
}

function hayCambios(c) {
  return c.agregados.length > 0 || Object.keys(c.editados).length > 0 || c.eliminados.length > 0;
}

// Misma lógica que construirListaInstructores() del examen.
function fusionar(base, cambios) {
  const c = normalizarCambios(cambios);
  const out = [], vistos = new Set();
  base.forEach(b => {
    if (c.eliminados.includes(b.id)) return;
    const e = c.editados[b.id] || {};
    out.push({
      id: b.id,
      nombre: (typeof e.nombre === 'string' && e.nombre) ? e.nombre : b.nombre,
      licencia: (typeof e.licencia === 'string' && e.licencia) ? e.licencia : b.licencia,
      logo: (typeof e.logo === 'string' && /^data:image\//.test(e.logo)) ? e.logo : b.logo,
      emails: Array.isArray(e.emails) ? limpiarCorreos(e.emails) : limpiarCorreos(b.emails || [])
    });
    vistos.add(b.id);
  });
  c.agregados.forEach(a => {
    if (vistos.has(a.id) || c.eliminados.includes(a.id)) return;
    out.push({ id: a.id, nombre: a.nombre, licencia: a.licencia, logo: a.logo, emails: limpiarCorreos(a.emails || []) });
    vistos.add(a.id);
  });
  if (!out.length) base.forEach(b => out.push({ id: b.id, nombre: b.nombre, licencia: b.licencia, logo: b.logo, emails: limpiarCorreos(b.emails || []) }));
  return out;
}

// Versión de la lista publicada: número creciente (marca de tiempo en segundos).
function versionNueva(rutaJsonPrevio) {
  let prev = 0;
  try { prev = Number(JSON.parse(fs.readFileSync(rutaJsonPrevio, 'utf8')).version) || 0; } catch (e) { prev = 0; }
  return Math.max(Math.floor(Date.now() / 1000), prev + 1);
}

module.exports = {
  INI, FIN, MAX_CORREOS, RE_CORREO, RE_LOGO, RE_ID, RE_CONTROL,
  limpiarCorreos, leerBase, validarLista, reemplazarBase,
  cambiosVacios, normalizarCambios, leerCambios, hayCambios, fusionar, versionNueva
};
