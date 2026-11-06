/* Gestión YAPUR.NET — servidor en Cloudflare (Worker + Durable Object con SQLite).
   Es el mismo servidor que corría en Node, pero sin máquina propia:
   - Usuarios reales con clave (PBKDF2) y sesiones con token.
   - Cada rol ve y escribe solo lo que le corresponde (los pagos son de solo-agregar).
   - Cambios en tiempo real por Server-Sent Events.
   - Copia automática diaria dentro de la misma base + descarga/restauración manual.
   La app web (carpeta public/) la sirve Cloudflare directamente; este código solo atiende /api/*. */
import { DurableObject } from 'cloudflare:workers';

const VERSION = '2.0.0';
const enc = new TextEncoder();

/* ================= utilidades ================= */
const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rnd = n => crypto.getRandomValues(new Uint8Array(n));
const sha = async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const safeEq = (a, b) => {
  a = String(a); b = String(b);
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
};
const bytesOf = s => enc.encode(s).length;
async function gzip(str) {
  const cs = new CompressionStream('gzip'), w = cs.writable.getWriter();
  w.write(enc.encode(str)); w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
async function gunzip(u8) {
  const ds = new DecompressionStream('gzip'), w = ds.writable.getWriter();
  w.write(u8); w.close();
  return await new Response(ds.readable).text();
}
/* día en Argentina (UTC-3, sin horario de verano) */
const ymd = (t = Date.now()) => new Date(t - 3 * 3600e3).toISOString().slice(0, 10);

const COLS = new Set(['clientes', 'pagos', 'ordenes', 'planes', 'ajustes', 'red']);
const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
const USER_RE = /^[a-z0-9._-]{2,32}$/;
const PERM_KEYS = ['clientesTodos', 'telefono', 'dni', 'editarClientes', 'ubicacion', 'ordenesTodas', 'crearOrdenes', 'operarOrdenes', 'precios', 'cobrar', 'caja', 'anular', 'promesas', 'resumen', 'red', 'cobrarCampo', 'verTecnicos', 'ping', 'verPlan', 'comodato', 'contratosGestion'];
const MONEY = ['cobrar', 'caja', 'anular', 'promesas', 'resumen'];
const PERM_DEF = {
  tecnico: { clientesTodos: false, telefono: true, dni: false, editarClientes: false, ubicacion: true, ordenesTodas: false, crearOrdenes: true, operarOrdenes: true, precios: false, cobrar: false, caja: false, anular: false, promesas: false, resumen: false, red: true, cobrarCampo: false, verTecnicos: false, ping: true, verPlan: false, comodato: true, contratosGestion: false },
  oficina: { clientesTodos: true, telefono: true, dni: true, editarClientes: true, ubicacion: true, ordenesTodas: true, crearOrdenes: true, operarOrdenes: true, precios: true, cobrar: true, caja: true, anular: false, promesas: true, resumen: false, red: true, cobrarCampo: false, verTecnicos: false, ping: true, verPlan: true, comodato: true, contratosGestion: true }
};
const ROLES = ['admin', 'oficina', 'tecnico'];
const isPlain = o => o && typeof o === 'object' && !Array.isArray(o);
const BAD_KEY = new Set(['__proto__', 'constructor', 'prototype']);
const same = (a, b) => JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b);
const normUser = s => String(s || '').trim().toLowerCase();
const normCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const slug = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 24) || 'usuario';
const newId = () => 'u' + hex(rnd(6));
const tempPw = () => { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; let s = ''; const b = rnd(8); for (let i = 0; i < 8; i++) s += a[b[i] % a.length]; return s; };
function httpErr(status, msg, code) { const e = new Error(msg); e.status = status; e.code = code; return e; }
function cleanPerms(o) { const c = {}; PERM_KEYS.forEach(k => { if (k in o) c[k] = !!o[k]; }); return c; }

function effPerms(u) {
  const o = {};
  if (u.role === 'admin') { PERM_KEYS.forEach(k => { o[k] = true; }); return o; }
  const base = PERM_DEF[u.role] || PERM_DEF.tecnico;
  const set = u.permisos && typeof u.permisos === 'object' ? u.permisos : {};
  PERM_KEYS.forEach(k => { o[k] = k in set ? !!set[k] : !!base[k]; });
  if (u.role === 'tecnico') MONEY.forEach(k => { o[k] = false; });
  return o;
}
const canReadPagos = (u, p) => u.role === 'admin' || p.cobrar || p.caja || p.promesas || p.resumen || p.anular;
const pubUser = u => ({ id: u.id, usuario: u.usuario, nombre: u.nombre, role: u.role, tel: u.tel, activo: u.activo, permisos: u.permisos, perms: effPerms(u), last_login: u.last_login || null });
const meOf = u => ({ id: u.id, usuario: u.usuario, nombre: u.nombre, role: u.role, tel: u.tel, perms: effPerms(u) });

/* ================= equipos (dispositivos) =================
   Cada teléfono o navegador que entra queda registrado con un identificador propio (lo genera la app y lo guarda en el equipo).
   Los empleados solo pueden entrar desde equipos que el administrador aprobó. */
const DID_RE = /^[A-Za-z0-9_-]{16,64}$/;
/* un nombre legible del equipo a partir de lo que manda el navegador (modelo y sistema en Android, navegador o app) */
function uaInfo(ua) {
  ua = String(ua || '');
  const apk = /YapurApp\/([\d.]+)/.exec(ua);
  let os = '', modelo = '';
  const an = /Android ([\d.]+);\s*([^;)]*)/.exec(ua);
  if (an) { os = 'Android ' + an[1].split('.')[0]; modelo = an[2].replace(/\s*Build\/.*$/, '').trim(); if (/^(K|wv)$/i.test(modelo)) modelo = ''; }
  else if (/iPhone/.test(ua)) { os = 'iPhone'; }
  else if (/iPad/.test(ua)) { os = 'iPad'; }
  else if (/Windows NT/.test(ua)) { os = 'Windows'; }
  else if (/Mac OS X|Macintosh/.test(ua)) { os = 'Mac'; }
  else if (/CrOS/.test(ua)) { os = 'Chromebook'; }
  else if (/Linux/.test(ua)) { os = 'Linux'; }
  let nav = '';
  if (/Edg\//.test(ua)) nav = 'Edge'; else if (/OPR\/|Opera/.test(ua)) nav = 'Opera'; else if (/SamsungBrowser/.test(ua)) nav = 'Samsung Internet';
  else if (/Firefox\//.test(ua)) nav = 'Firefox'; else if (/Chrome\/|CriOS/.test(ua)) nav = 'Chrome'; else if (/Safari\//.test(ua)) nav = 'Safari';
  const app = apk ? 'apk' : 'web';
  const partes = [modelo, os].filter(Boolean);
  const cuando = apk ? 'App Yapur ' + apk[1] : (nav ? 'Navegador ' + nav : 'Navegador');
  return { app, label: (partes.length ? partes.join(' · ') + ' · ' : '') + cuando };
}
/* de dónde parece venir el pedido (Cloudflare lo estima por la IP; en celulares puede ser la ciudad del operador) */
function geoOf(request) {
  const cf = request.cf || {};
  const lugar = [cf.city, cf.region].filter(Boolean).join(', ') + (cf.country ? (cf.city || cf.region ? ' ' : '') + '(' + cf.country + ')' : '');
  return [lugar, cf.asOrganization].filter(Boolean).join(' · ').slice(0, 140);
}

/* ================= contraseñas ================= */
/* PBKDF2-SHA256 con el máximo de vueltas que permite Cloudflare (100.000). El prefijo «p1:» permite cambiar el método más adelante. */
async function derive(pw, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, key, 256));
}
async function makePw(pw) { const salt = hex(rnd(16)); return { salt, hash: 'p1:' + await derive(pw, salt) }; }
async function checkPw(pw, u) {
  if (!u || !u.hash || !String(u.hash).startsWith('p1:')) { await derive(pw, 'sin-usuario'); return false; }
  return safeEq('p1:' + await derive(pw, u.salt), u.hash);
}

/* ================= qué ve y qué puede escribir cada rol ================= */
function strip(data, keys) {
  if (!isPlain(data) || !isPlain(data.items)) return data;
  const items = {};
  for (const id of Object.keys(data.items)) {
    const it = data.items[id];
    if (!isPlain(it)) { items[id] = it; continue; }
    const c = Object.assign({}, it);
    keys.forEach(k => { delete c[k]; });
    items[id] = c;
  }
  return Object.assign({}, data, { items });
}
function deepMerge(a, b) {
  if (!isPlain(a) || !isPlain(b)) return b;
  const out = Object.assign({}, a);
  for (const k of Object.keys(b)) {
    if (BAD_KEY.has(k)) continue;
    out[k] = isPlain(b[k]) && isPlain(out[k]) ? deepMerge(out[k], b[k]) : b[k];
  }
  return out;
}
function canWrite(u, p, coll, op) {
  if (u.role === 'admin') return null;
  if (coll === 'planes' || coll === 'ajustes') return 'Solo el administrador puede cambiar esto.';
  if (op === 'set') return 'Operación no permitida.';
  if (coll === 'clientes') return (p.editarClientes || p.ubicacion || p.promesas || p.operarOrdenes || p.cobrar) ? null : 'Tu usuario no puede modificar clientes.';
  if (coll === 'ordenes') return (p.crearOrdenes || p.operarOrdenes) ? null : 'Tu usuario no puede modificar órdenes.';
  if (coll === 'pagos') return (p.cobrar || p.anular || p.cobrarCampo) ? null : 'Tu usuario no puede registrar pagos.';
  if (coll === 'red') return p.red ? null : 'Tu usuario no puede modificar la red.';
  return 'No permitido.';
}
const RT_KINDS = ['q', 'p', 'd'];   // q: colas simples (IP fija) · p: secretos y perfiles PPPoE · d: leases DHCP estáticos
const RT_FIELDS = { Q: { n: 7, min: 3 }, P: { n: 7, min: 2 }, F: { n: 3, min: 2 }, D: { n: 6, min: 2 } };
const CAMPO_CONCEPTOS = ['instalacion', 'reinstalacion', 'reclamo', 'otro'];   // la reconexión no la cobra el técnico (la cobra la oficina, y solo si el cliente tiene deuda)
/* Precios fijos: los define el administrador en Ajustes; quien cobra en la calle no puede cambiarlos. Si todavía no se cargaron rigen estos. */
const PRECIO_KEYS = { instalacion: 'precioInstalacion', reinstalacion: 'precioReinstalacion' };
const PRECIO_DEF = { instalacion: 65000, reinstalacion: 35000 };
const pesos = n => '$ ' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
/* ----- recibo por WhatsApp: números, textos y topes (el envío está más abajo, en la clase) ----- */
const WA_CONC = { mensualidad: 'Mensualidad', deuda_anterior: 'Deuda anterior', instalacion: 'Instalación', reinstalacion: 'Reinstalación (mudanza)', reconexion: 'Reconexión', reclamo: 'Reclamo o visita técnica', otro: 'Otro' };
const WA_MAX_NUM_DIA = 3, WA_MAX_DIA = 400;   // avisos automáticos por día: por número de cliente y en total (freno ante un uso indebido)
/* número de WhatsApp de Argentina: 54 + 9 + código de área + número (13 cifras); '' si no sirve */
function waNumero(tel) {
  let d = String(tel == null ? '' : tel).replace(/\D/g, '').replace(/^0+/, '');
  if (!d) return '';
  if (!d.startsWith('54')) d = '54' + (d.startsWith('9') ? '' : '9') + d;
  else if (d.length === 12 && d[2] !== '9') d = '549' + d.slice(2);
  return /^549\d{10}$/.test(d) ? d : '';
}
/* los textos de una plantilla no admiten saltos de línea ni quedar vacíos */
const waTxt = (s, n) => String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, n) || '-';
const dmyAR = f => /^\d{4}-\d{2}-\d{2}$/.test(f || '') ? f.slice(8) + '/' + f.slice(5, 7) + '/' + f.slice(0, 4) : '-';
const METODOS_PAGO = ['efectivo', 'transferencia', 'mercadopago', 'otro'];
/* quien cobra en la calle y recibe una transferencia tiene que adjuntar la foto del comprobante */
const COMP_METODOS = ['transferencia'];
const COMP_ID_RE = /^[a-f0-9]{20}$/;
const COMP_MAX = 450e3;   // bytes de la foto ya comprimida (la app la reduce antes de subirla)
const CLIENT_LOCKED = ['precio', 'planId', 'extras', 'hp', 'ciclo', 'desde', 'dia', 'deudaAnt', 'cuenta'];
const ANUL_KEYS = ['anulado', 'anuladoMotivo', 'anuladoFecha', 'anuladoPor'];
/* controles de integridad; devuelven un texto si hay que rechazar. Pueden completar datos (quién lo hizo). */
function guard(u, p, coll, existing, patch, ctx) {
  if (coll === 'ajustes') {
    for (const k of Object.values(PRECIO_KEYS)) if (k in patch && (!isNum(patch[k]) || patch[k] <= 0 || patch[k] > 1e7 || Math.round(patch[k]) !== patch[k])) return 'El precio no es válido: tiene que ser un número entero mayor que cero.';
    return null;
  }
  if (u.role === 'admin' && coll !== 'pagos' && coll !== 'red') return null;
  const items = isPlain(patch.items) ? patch.items : null;
  if (!items) return coll === 'pagos' || coll === 'clientes' || coll === 'ordenes' || coll === 'red' ? 'Formato inválido.' : null;
  const old = existing && isPlain(existing.items) ? existing.items : {};
  if (coll === 'clientes') {
    for (const id of Object.keys(items)) {
      const nw = items[id], prev = old[id];
      if (!isPlain(nw)) return 'Formato inválido.';
      const malComodato = guardComodato(p, nw, prev);
      if (malComodato) return malComodato;
      if (!prev) { if (!p.editarClientes) return 'Tu usuario no puede dar de alta clientes.'; continue; }
      if (p.editarClientes) continue;
      for (const k of CLIENT_LOCKED) if (k in nw && !same(nw[k], prev[k])) return 'Tu usuario no puede cambiar los datos de facturación del cliente.';
      if ('promesas' in nw && !same(nw.promesas, prev.promesas) && !p.promesas) return 'Tu usuario no puede dar promesas de pago.';
    }
  } else if (coll === 'red') {
    return guardRed(u, p, old, items);
  } else if (coll === 'pagos') {
    const usadas = new Set();   /* fotos de comprobante ya tomadas por un cobro de este mismo lote */
    for (const id of Object.keys(items)) {
      const nw = items[id], prev = old[id];
      if (!isPlain(nw)) return 'Formato inválido.';
      if (!prev) {
        if (u.role !== 'admin' && !p.cobrar) {
          /* quien solo cobra en la calle: instalaciones, reinstalaciones, reclamos y otros, del día y por un monto válido (nunca mensualidades ni reconexiones) */
          if (!p.cobrarCampo) return 'Tu usuario no puede registrar pagos.';
          if (!CAMPO_CONCEPTOS.includes(nw.concepto) || nw.per) return 'Tu usuario solo puede cobrar instalaciones, reinstalaciones, reclamos y otros cobros, no mensualidades ni reconexiones.';
          if (!isNum(nw.monto) || nw.monto <= 0 || nw.monto > 1e8) return 'El monto del cobro no es válido.';
          /* instalación y reinstalación se cobran al precio fijo que cargó el administrador: no se puede poner otro monto */
          const fijos = ctx && ctx.preciosFijos ? ctx.preciosFijos() : PRECIO_DEF;
          if ((nw.concepto === 'instalacion' || nw.concepto === 'reinstalacion') && nw.monto !== fijos[nw.concepto])
            return (nw.concepto === 'instalacion' ? 'La instalación' : 'La reinstalación') + ' se cobra a precio fijo: ' + pesos(fijos[nw.concepto]) + '. Lo define el administrador.';
          if (nw.fecha !== ymd()) return 'Los cobros en la calle se registran con la fecha de hoy.';
          if (typeof nw.c !== 'string' || !ID_RE.test(nw.c)) return 'Falta el cliente del cobro.';
          if (!METODOS_PAGO.includes(nw.metodo)) return 'El medio de pago no es válido.';
          if (COMP_METODOS.includes(nw.metodo)) {
            if (typeof nw.comp !== 'string' || !COMP_ID_RE.test(nw.comp)) return 'Las transferencias llevan la foto del comprobante: adjuntala antes de cobrar.';
            if (usadas.has(nw.comp) || !ctx || !ctx.comprobanteLibre(nw.comp, u.id)) return 'La foto del comprobante no sirve o ya se usó en otro cobro. Sacá una nueva.';
            usadas.add(nw.comp);
          } else delete nw.comp;
          /* «Instalación» se cobra una sola vez por cliente: si ya se le cobró (y no se anuló), una nueva instalación es una mudanza y se cobra «Reinstalación».
             No se mira el estado del cliente: la oficina carga al abonado nuevo como «activo» y el técnico no ve los pagos, así que lo controla el servidor */
          const cl = ctx ? ctx.clienteDe(nw.c) : null;
          if (nw.concepto === 'instalacion') {
            const f = ctx && ctx.instalacionCobrada ? ctx.instalacionCobrada(nw.c) : '';
            if (f) return 'A este cliente ya se le cobró la instalación' + (/^\d{4}-\d\d-\d\d$/.test(f) ? ' el ' + f.slice(8) + '/' + f.slice(5, 7) + '/' + f.slice(0, 4) : '') + '. Si se mudó, cobrá «Reinstalación (mudanza)».';
          } else if (nw.concepto === 'reinstalacion' && cl && cl.estado === 'pendiente') return 'Ese cliente todavía no está instalado: cobrá «Instalación».';
        }
        if (u.role === 'admin' || p.cobrar) delete nw.comp;   /* el comprobante lo adjunta quien cobra en la calle */
        delete nw.wa;   /* el estado del aviso por WhatsApp lo escribe solo el servidor */
        nw.por = u.id; nw.porNombre = String(u.nombre || '').slice(0, 60); nw.srvTs = Date.now();
        continue;
      }
      /* un pago ya registrado no se edita: solo se puede anular (y nunca volver atrás) */
      for (const k of Object.keys(nw)) {
        if (ANUL_KEYS.includes(k)) continue;
        if (!same(nw[k], prev[k])) return 'Un pago registrado no se puede modificar. Anulalo y cargá uno nuevo.';
      }
      if (prev.anulado && nw.anulado !== undefined && nw.anulado !== true) return 'Un recibo anulado no se puede reactivar.';
      if ('anulado' in nw && nw.anulado && !prev.anulado) {
        if (u.role !== 'admin' && !p.anular) return 'Tu usuario no puede anular recibos.';
        nw.anuladoPor = u.id;
      }
    }
  }
  return null;
}

/* ----- red: cajas NAP y botellas de empalme (se guardan juntas en red/puntos, un registro por punto) ----- */
const RED_TIPOS = ['nap', 'empalme'];
const RED_KEYS = ['tipo', 'nombre', 'lat', 'lng', 'puertos', 'padre', 'ref', 'notas', 'creado', 'mod', 'fibra', 'hilos', 'xtubo', 'pons', 'hacer', 'pelos'];
/* solo de las botellas de empalme: qué fibra es, cuántos pelos tiene y de a cuántos por tubo, qué PON están vivos, qué hay que hacer y qué lleva cada pelo */
const EMP_KEYS = ['fibra', 'hilos', 'xtubo', 'pons', 'hacer', 'pelos'];
const PELO_ESTADOS = ['libre', 'empalmado', 'reservado', 'danado'];
const PELO_KEYS = ['e', 'p', 'a', 'n'];   // estado, PON que lleva, caja o botella a la que lleva, nota
const isNum = v => typeof v === 'number' && isFinite(v);
function guardRed(u, p, old, items) {
  for (const id of Object.keys(items)) {
    if (!ID_RE.test(id)) return 'Identificador inválido.';
    const nw = items[id], prev = old[id];
    if (nw === null) {   /* eliminar un punto */
      if (u.role !== 'admin' && !p.editarClientes) return 'Tu usuario no puede eliminar puntos de la red.';
      continue;
    }
    if (!isPlain(nw)) return 'Formato inválido.';
    for (const k of Object.keys(nw)) if (!RED_KEYS.includes(k)) return 'Dato desconocido en la red: ' + k + '.';
    const tipo = 'tipo' in nw ? nw.tipo : prev && prev.tipo, nombre = 'nombre' in nw ? nw.nombre : prev && prev.nombre;
    if (!RED_TIPOS.includes(tipo)) return 'El tipo tiene que ser caja NAP o botella de empalme.';
    if (typeof nombre !== 'string' || !nombre.trim() || nombre.length > 60) return 'Falta el nombre (hasta 60 letras).';
    if ('lat' in nw || 'lng' in nw) {
      const la = 'lat' in nw ? nw.lat : prev && prev.lat, ln = 'lng' in nw ? nw.lng : prev && prev.lng;
      if ((la === null || la === undefined) !== (ln === null || ln === undefined)) return 'La ubicación necesita latitud y longitud.';
      if (la !== null && la !== undefined && (!isNum(la) || !isNum(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180)) return 'La ubicación no es válida.';
    }
    if ('puertos' in nw && nw.puertos !== null && !(Number.isInteger(nw.puertos) && nw.puertos >= 1 && nw.puertos <= 288)) return 'Los puertos tienen que ser un número entre 1 y 288.';
    if ('padre' in nw && nw.padre !== null && (typeof nw.padre !== 'string' || !ID_RE.test(nw.padre) || nw.padre === id)) return 'El punto del que sale no es válido.';
    for (const k of ['ref', 'notas']) if (k in nw && nw[k] !== null && (typeof nw[k] !== 'string' || nw[k].length > 500)) return 'El texto es demasiado largo.';
    if (EMP_KEYS.some(k => k in nw)) {
      if (tipo !== 'empalme') return 'Los datos de pelos y PON son solo de las botellas de empalme.';
      const e = guardEmpalme(id, nw);
      if (e) return e;
    }
  }
  return null;
}
function guardEmpalme(id, nw) {
  if ('fibra' in nw && nw.fibra !== null && (typeof nw.fibra !== 'string' || nw.fibra.length > 120)) return 'La descripción de la fibra es demasiado larga (hasta 120 letras).';
  if ('hacer' in nw && nw.hacer !== null && (typeof nw.hacer !== 'string' || nw.hacer.length > 500)) return 'El texto de «qué hay que hacer» es demasiado largo.';
  if ('hilos' in nw && nw.hilos !== null && !(Number.isInteger(nw.hilos) && nw.hilos >= 1 && nw.hilos <= 288)) return 'Los pelos de la fibra tienen que ser un número entre 1 y 288.';
  if ('xtubo' in nw && nw.xtubo !== null && !(Number.isInteger(nw.xtubo) && nw.xtubo >= 0 && nw.xtubo <= 48)) return 'Los pelos por tubo no son válidos.';
  if ('pons' in nw && nw.pons !== null) {
    if (!Array.isArray(nw.pons) || nw.pons.length > 32 || nw.pons.some(n => !(Number.isInteger(n) && n >= 1 && n <= 32)) || new Set(nw.pons).size !== nw.pons.length) return 'Los PON vivos no son válidos.';
  }
  if ('pelos' in nw && nw.pelos !== null) {
    if (!isPlain(nw.pelos)) return 'Los pelos no son válidos.';
    for (const k of Object.keys(nw.pelos)) {
      if (!/^[1-9]\d{0,2}$/.test(k) || Number(k) > 288) return 'Número de pelo inválido: ' + k + '.';
      const x = nw.pelos[k];
      if (x === null) continue;
      if (!isPlain(x) || Object.keys(x).some(q => !PELO_KEYS.includes(q))) return 'Los datos del pelo ' + k + ' no son válidos.';
      if ('e' in x && !PELO_ESTADOS.includes(x.e)) return 'El estado del pelo ' + k + ' no es válido.';
      if ('p' in x && x.p !== null && !(Number.isInteger(x.p) && x.p >= 1 && x.p <= 32)) return 'El PON del pelo ' + k + ' no es válido.';
      if ('a' in x && x.a !== null && (typeof x.a !== 'string' || !ID_RE.test(x.a) || x.a === id)) return 'A dónde lleva el pelo ' + k + ' no es válido.';
      if ('n' in x && x.n !== null && (typeof x.n !== 'string' || x.n.length > 120)) return 'La nota del pelo ' + k + ' es demasiado larga (hasta 120 letras).';
    }
  }
  return null;
}

/* ================= comodato: equipos prestados al cliente y contrato firmado ================= */
const COMODATO_TIPOS = ['ONU', 'Router Wi-Fi', 'Antena', 'Cable de fibra', 'Fuente o adaptador', 'Otro'];
const COMODATO_KEYS = ['t', 'd', 's', 'n', 'e', 'o'];   // tipo, descripción (marca y modelo), serie o MAC, cantidad, estado (nuevo|usado), observaciones
const COMODATO_MAX = 30;
const lim = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
function comodatoLimpio(v) {
  const out = [];
  for (const it of (Array.isArray(v) ? v : []).slice(0, COMODATO_MAX)) {
    if (!isPlain(it)) continue;
    out.push({ t: COMODATO_TIPOS.includes(it.t) ? it.t : 'Otro', d: lim(it.d, 80), s: lim(it.s, 60), n: Math.max(1, Math.min(99, Math.round(Number(it.n)) || 1)), e: it.e === 'nuevo' ? 'nuevo' : 'usado', o: lim(it.o, 120) });
  }
  return out;
}
/* la «firma» de una lista de equipos: dos listas con los mismos equipos (en cualquier orden) dan el mismo texto */
const eqSig = arr => comodatoLimpio(arr).map(e => [e.t, e.d, e.s, e.n, e.e, e.o].map(x => String(x).toLowerCase()).join('|')).sort().join(';');
function guardComodato(p, nw, prev) {
  if (!('comodato' in nw) || (prev && same(nw.comodato, prev.comodato))) return null;
  if (!p.comodato) return 'Tu usuario no puede cargar los equipos en comodato.';
  const c = nw.comodato, mal = 'La lista de equipos en comodato no es válida.';
  if (!Array.isArray(c) || c.length > COMODATO_MAX) return mal;
  for (const it of c) {
    if (!isPlain(it) || Object.keys(it).some(k => !COMODATO_KEYS.includes(k))) return mal;
    for (const [k, n] of [['t', 30], ['d', 80], ['s', 60], ['e', 10], ['o', 120]]) if (k in it && (typeof it[k] !== 'string' || it[k].length > n)) return mal;
    if (typeof it.n !== 'number' || !isFinite(it.n) || it.n < 1 || it.n > 99 || Math.round(it.n) !== it.n) return mal;
  }
  return null;
}
const CONTRATO_ESTADOS = ['vigente', 'revision', 'archivado', 'rechazado', 'borrado'];
const CONTRATO_MOTIVOS = { alta: 'Alta', titularidad: 'Cambio de titularidad', equipos: 'Cambio de equipos' };
const CONTRATO_VARS = ['empresa', 'empresa_cuit', 'empresa_domicilio', 'representante', 'lugar', 'fecha', 'numero', 'titular', 'dni', 'domicilio', 'telefono', 'cliente_n', 'equipos'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fechaLarga = t => { const [y, m, d] = ymd(t).split('-').map(Number); return d + ' de ' + MESES[m - 1] + ' de ' + y; };
const fmtDocAR = s => { const d = String(s || '').replace(/\D/g, ''); if (d.length === 11) return d.slice(0, 2) + '-' + d.slice(2, 10) + '-' + d.slice(10); return d.length === 7 || d.length === 8 ? d.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : d; };
const horaAR = t => { const d = new Date(t - 3 * 3600e3).toISOString(); return d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) + ' ' + d.slice(11, 16); };
/* Texto provisorio: sirve para probar el circuito. Mientras diga «BORRADOR» o tenga «[COMPLETAR…]» no se puede marcar como definitivo ni lo pueden firmar los clientes. */
const CONTRATO_TXT_DEF = `BORRADOR PARA REVISAR: este es un texto provisorio. Reemplazalo por el contrato definitivo y borrá esta línea.

CONTRATO DE COMODATO DE EQUIPOS N° {{numero}}

En {{lugar}}, a {{fecha}}, entre {{empresa}} (CUIT {{empresa_cuit}}), con domicilio en {{empresa_domicilio}}, representada por {{representante}}, en adelante "EL COMODANTE", y {{titular}}, DNI/CUIT {{dni}}, con domicilio en {{domicilio}}, teléfono {{telefono}}, cliente N° {{cliente_n}}, en adelante "EL COMODATARIO", se celebra el presente contrato de comodato, sujeto a las siguientes cláusulas:

PRIMERA - OBJETO. EL COMODANTE entrega en comodato (préstamo de uso gratuito) a EL COMODATARIO, que los recibe de conformidad, los siguientes equipos, de propiedad exclusiva de EL COMODANTE:

{{equipos}}

SEGUNDA - DESTINO. Los equipos se usan únicamente para recibir el servicio de internet contratado, en el domicilio indicado. EL COMODATARIO no puede prestarlos, alquilarlos, cederlos, abrirlos, modificarlos ni trasladarlos sin autorización de EL COMODANTE.

TERCERA - PLAZO. El comodato dura mientras se mantenga el servicio. Termina cuando el servicio se da de baja por cualquier causa.

CUARTA - CUIDADO. EL COMODATARIO conserva los equipos con la diligencia de un buen cuidador y responde por su pérdida, robo o daño, salvo el desgaste normal por el uso. En ese caso abonará el valor de reposición: [COMPLETAR valor o criterio].

QUINTA - DEVOLUCIÓN. Al terminar el servicio, EL COMODATARIO devuelve los equipos en el plazo de [COMPLETAR días] y en buen estado. EL COMODANTE puede retirarlos del domicilio y EL COMODATARIO permitirá el ingreso del personal técnico.

SEXTA - CAMBIO DE TITULARIDAD. Si cambia el titular del servicio, el nuevo titular firma un nuevo contrato. El anterior queda archivado cuando EL COMODANTE aprueba el cambio.

SÉPTIMA - JURISDICCIÓN. Para cualquier cuestión, las partes se someten a los tribunales ordinarios de [COMPLETAR jurisdicción].

EL COMODATARIO declara haber leído este contrato, estar de acuerdo con su contenido y que los datos indicados son verdaderos. La firma se realiza en forma electrónica en un dispositivo de EL COMODANTE y queda guardada junto con la fecha, la hora y un código de verificación.`;
function renderContrato(tpl, x) {
  const em = tpl.empresa || {};
  const eq = x.equipos.map((e, i) => (i + 1) + '. ' + e.t + (e.d ? ' ' + e.d : '') + (e.s ? ' · N° de serie / MAC: ' + e.s : '') + ' · Cantidad: ' + e.n + ' · Estado: ' + e.e + (e.o ? ' · ' + e.o : '')).join('\n');
  const v = {
    empresa: em.razon, empresa_cuit: em.cuit, empresa_domicilio: em.domicilio, representante: em.rep, lugar: em.lugar,
    fecha: fechaLarga(x.ts), numero: x.num ? String(x.num).padStart(4, '0') : '(se asigna al firmar)',
    titular: x.titular.nombre, dni: x.titular.dniTxt, domicilio: x.titular.dir + (x.titular.loc ? ', ' + x.titular.loc : ''), telefono: x.titular.tel, cliente_n: x.codigo, equipos: eq
  };
  return String(tpl.texto).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => (k in v ? (String(v[k] || '').trim() || '-') : m));
}
/* la firma dibujada llega como imagen PNG chica en base64 */
function pngOk(s) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(s || ''));
  if (!m || m[1].length > 90000 || m[1].length < 300) return false;
  try { const b = atob(m[1].slice(0, 16)); return b.charCodeAt(0) === 0x89 && b.slice(1, 4) === 'PNG'; } catch (e) { return false; }
}

/* ================= respuestas ================= */
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, x-did', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'Access-Control-Max-Age': '600' };
function send(status, body, headers) {
  const h = Object.assign({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }, CORS, headers || {});
  if (typeof body !== 'string') { h['Content-Type'] = h['Content-Type'] || 'application/json; charset=utf-8'; body = JSON.stringify(body); }
  return new Response(body, { status, headers: h });
}
/* el cuerpo del pedido se lee siempre entero (aunque la ruta no lo use): si no, Cloudflare avisa de un error al cerrar */
function readBody(raw, limit) {
  if (raw.length > limit) throw httpErr(413, 'Pedido demasiado grande.', 'quota_exceeded');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { throw httpErr(400, 'JSON inválido.'); }
}

/* ================= entrada: reparte el trabajo ================= */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/healthz') return send(200, 'ok', { 'Content-Type': 'text/plain' });
    if (url.pathname.startsWith('/api/')) {
      /* un único objeto con nombre fijo = una única base de datos para toda la empresa; se crea cerca de Sudamérica */
      const stub = env.YAPUR.get(env.YAPUR.idFromName('principal'), { locationHint: 'sam' });
      /* si la base de datos tira una excepción (límite del plan, reinicio, falla de Cloudflare) Cloudflare mostraba su página «Error 1101» sin decir nada:
         ahora se contesta con el motivo, así se ve qué pasó y la app lo trata como «sin conexión» (no como un dato inválido) */
      try { return await stub.fetch(request); }
      catch (e) {
        const motivo = String((e && e.message) || e).replace(/\s+/g, ' ').slice(0, 200);
        console.error('YapurDB:', motivo);
        return send(503, { error: 'La base de datos del servidor no responde: ' + motivo, code: 'unavailable' });
      }
    }
    return env.ASSETS.fetch(request);
  }
};

/* ================= ubicación de los técnicos en horario laboral ================= */
/* Solo se guarda lo que llega dentro del horario (por defecto de 8 a 20 h, hora de Argentina) y se borra a los 14 días.
   El horario lo controla el servidor con su propio reloj: no importa lo que diga el celular. Argentina no tiene horario de verano: siempre UTC-3. */
const UBIC_DIAS = 14;
const UBIC_MIN_MS = 20e3;            // no se guarda más de un punto cada 20 segundos por técnico
const JORNADA_DIAS = 90;             // las horas de ingreso y fin se guardan 90 días (sin coordenadas: solo la distancia a la base)
const JORNADA_TOL = 10;              // minutos de tolerancia para llegar tarde, si no se cambia
/* distancia en metros entre dos puntos (fórmula de Haversine) */
const distM = (a1, o1, a2, o2) => {
  const r = Math.PI / 180, dA = (a2 - a1) * r, dO = (o2 - o1) * r;
  const h = Math.sin(dA / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dO / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h))));
};
const UBIC_HUECO_MS = 10 * 60e3;     // más de 10 minutos sin recibir nada = «sin señal»
/* Tramos sin señal dentro de la ventana [ws, we]: el celular manda un punto por minuto, así que un silencio largo es
   un celular apagado, sin datos o con la app cerrada. `tss` viene ordenado. Sin ningún punto no se inventa un hueco
   (puede ser un día libre). El primer tramo (desde que arranca el horario) lleva `inicio`; el último, `sigue` si la ventana aún está abierta. */
function ubicHuecos(tss, ws, we, abierta) {
  const out = [];
  if (!tss.length || we <= ws) return out;
  let prev = ws, primero = true;
  for (const ts of tss) {
    if (ts < ws || ts > we) continue;
    if (ts - prev > UBIC_HUECO_MS) out.push(primero ? { desde: prev, hasta: ts, inicio: true } : { desde: prev, hasta: ts });
    prev = ts; primero = false;
  }
  if (we - prev > UBIC_HUECO_MS) out.push(abierta ? { desde: prev, hasta: we, sigue: true } : { desde: prev, hasta: we });
  return out;
}
const arTime = ts => { const d = new Date(ts - 3 * 3600e3); return { fecha: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() }; };
const arDayStart = fecha => Date.parse(fecha + 'T00:00:00-03:00');

/* ----- horario por día: de corrido (un tramo) o cortado (mañana y tarde, con siesta en el medio) -----
   plan = { corrido:{desde,hasta}, cortado:{m:[d,h],t:[d,h]}|null, dias:{0..6:'corrido'|'cortado'}, fechas:{'AAAA-MM-DD':'corrido'|'cortado'} }.
   Un día puntual (fechas) gana sobre el día de la semana. Son funciones puras para poder probarlas con cualquier hora. */
const horaOk = (d, h) => Number.isInteger(d) && Number.isInteger(h) && d >= 0 && h <= 24 && d < h;
const trOk = t => Array.isArray(t) && t.length === 2 && horaOk(t[0], t[1]);
function ubicTramosDe(plan, fecha) {
  const dow = new Date(arDayStart(fecha) + 12 * 3600e3).getUTCDay();
  const modo = (plan.fechas && plan.fechas[fecha]) || (plan.dias && plan.dias[dow]);
  return modo === 'cortado' && plan.cortado ? [plan.cortado.m, plan.cortado.t] : [[plan.corrido.desde, plan.corrido.hasta]];
}
const ubicEnTramos = (tr, min) => tr.some(t => min / 60 >= t[0] && min / 60 < t[1]);
/* sin señal, tramo por tramo: la siesta no es un hueco */
function ubicHuecosDia(tss, t0, tr, ahora, esHoy) {
  const out = [];
  for (const t of tr) {
    const ws = t0 + t[0] * 3600e3, wend = t0 + t[1] * 3600e3, we = esHoy ? Math.min(ahora, wend) : wend;
    out.push(...ubicHuecos(tss, ws, we, esHoy && ahora >= ws && ahora < wend));
  }
  return out;
}
/* ----- corte manual del GPS de un técnico (la oficina lo corta a la hora en que ve que se fue) -----
   Los tramos del día quedan recortados en esa hora. Las horas son enteras porque el APK las lee con getInt: el fin se redondea para arriba
   y el servidor descarta igual todo lo que llegue desde el corte. Un tramo que empezaba en el corte o después desaparece; siempre queda el primero. */
function ubicTramosCorte(tr, t0, corte) {
  if (!corte) return tr;
  const out = [];
  for (const t of tr) {
    if (corte <= t0 + t[0] * 3600e3) continue;
    out.push([t[0], Math.min(t[1], Math.ceil((corte - t0) / 3600e3))]);
  }
  return out.length ? out : tr;
}
/* la primera vez que, en un día cortado, el celular aparece en la base después de que empezó la tarde (y ya había ingresado a la mañana) */
const jornadaRetoma = (tr, t0, f, ts) => tr.length === 2 && !f.ingreso2 && ts >= t0 + tr[1][0] * 3600e3 && f.ingreso < t0 + tr[1][0] * 3600e3;
/* qué se muestra de la jornada de un técnico en un día. v = fila ya «vista» (o null); o = { dia, hoy, ahora, tr, base, laborable, tol } */
function jornadaEstadoDia(v, o) {
  const t0 = arDayStart(o.dia), esHoy = o.dia === o.hoy, ws = t0 + o.tr[0][0] * 3600e3;
  const ws2 = o.tr.length === 2 ? t0 + o.tr[1][0] * 3600e3 : 0, fin1 = o.tr.length === 2 ? t0 + o.tr[0][1] * 3600e3 : 0;
  const atraso = v ? Math.max(0, Math.round((v.ingreso - ws) / 60000)) : 0;
  const atraso2 = v && v.ingreso2 ? Math.max(0, Math.round((v.ingreso2 - ws2) / 60000)) : 0;
  const sinRetomar = !!v && !!ws2 && !v.ingreso2 && v.ingreso < ws2 && (o.dia < o.hoy || o.ahora > ws2 + o.tol * 60e3);
  let estado;
  if (v) {
    if (esHoy && ws2 && o.ahora >= fin1 && o.ahora < ws2) estado = 'siesta';
    else if (v.regreso && v.enBase && !(ws2 && v.regreso < ws2)) estado = 'termino';   // en un día cortado, un regreso anterior a la tarde es el de la siesta, no el del fin del día
    else estado = esHoy ? 'trabajando' : 'sin_cierre';
  } else if (!o.base) estado = 'sin_base';   // la jornada está apagada hasta que se carga la base: nada de alarmas
  else if (!o.laborable) estado = 'no_laborable';
  else if (o.dia > o.hoy) estado = 'esperando';
  else estado = esHoy && o.ahora <= ws + o.tol * 60e3 ? 'esperando' : 'sin_ingreso';
  return { estado, atrasoMin: atraso, tarde: atraso > o.tol, ingreso2: v ? (v.ingreso2 || null) : null, atraso2Min: atraso2, tarde2: atraso2 > o.tol, sinRetomar };
}
/* ----- horas trabajadas en un día -----
   La jornada empieza cuando el celular aparece en la base y termina cuando vuelve a guardar el vehículo. En un día cortado hay dos tramos:
   se cuenta cada uno por separado, así la siesta no suma. f = { ingreso, ingreso2, ult, ev:[[ts,1|0]…] (cada vez que entró/salió de la base después del ingreso),
   adj:{s:[[desde,hasta]…]}|null (corrección de la oficina), tr:'8-13,17-22'|null (tramos de ese día, guardados con la fila) }; o = { dia, hoy, ahora, tr (de respaldo) }.
   Devuelve { min, estado: ok | en_curso | incompleto | corregido, segs:[[desde,hasta]…], estimado }.
     · ok: el tramo terminó con un regreso a la base (o, si no es el último tramo del día, el tramo se acabó con el técnico en la calle: la siesta).
     · en_curso: es hoy y el tramo sigue abierto: se cuenta hasta ahora.
     · incompleto: el último tramo del día se cerró sin que vuelva a la base (celular apagado, app cerrada…): se cuenta hasta la última posición recibida y queda marcado para revisar.
     · corregido: la oficina cargó las horas a mano. */
const trStr = tr => tr.map(t => t[0] + '-' + t[1]).join(',');
const trParse = s => String(s || '').split(',').map(x => x.split('-').map(Number)).filter(trOk);
function jornadaHoras(f, o) {
  const H = 3600e3, t0 = arDayStart(o.dia), esHoy = o.dia === o.hoy;
  if (f.adj && Array.isArray(f.adj.s)) {
    const segs = f.adj.s.filter(x => Array.isArray(x) && x[1] > x[0]);
    return { min: Math.round(segs.reduce((a, x) => a + (x[1] - x[0]), 0) / 60000), estado: 'corregido', segs, estimado: false };
  }
  let tr = f.tr ? trParse(f.tr) : [];
  if (!tr.length) tr = o.tr;
  const ev = Array.isArray(f.ev) ? f.ev : [], segs = [];
  let abierto = false, incompleto = false, estimado = false;
  tr.forEach((t, k) => {
    const ws = t0 + t[0] * H, we = t0 + t[1] * H, ultimo = k === tr.length - 1;
    let ini = null;
    if (k === 0) ini = f.ingreso < we ? f.ingreso : null;
    else if (f.ingreso2) ini = f.ingreso2;
    else if (f.ingreso >= t0 + tr[k - 1][1] * H) ini = f.ingreso;
    else if (ev.some(e => e[1] === 1 && e[0] >= ws && e[0] < we)) { ini = ws; estimado = true; }   // volvió a la base a la noche sin haber pasado a la tarde: se cuenta desde que empezó la tarde
    if (ini === null) return;
    const evk = ev.filter(e => e[0] >= ini && e[0] < we), last = evk[evk.length - 1];
    let fin;
    if (last && last[1] === 1) fin = last[0];
    else if (esHoy && o.ahora < we) { fin = Math.max(ini, o.ahora); abierto = true; }
    else if (!ultimo) fin = we;
    else { fin = Math.min(we, Math.max(ini, f.ult || ini)); incompleto = true; }
    segs.push([ini, Math.max(ini, fin)]);
  });
  return { min: Math.round(segs.reduce((a, x) => a + (x[1] - x[0]), 0) / 60000), estado: incompleto ? 'incompleto' : abierto ? 'en_curso' : 'ok', segs, estimado };
}
/* fin de las funciones puras del horario */

/* ================= la base de datos y toda la lógica ================= */
export class YapurDB extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.env = env;
    this.streams = new Set();   /* solo las pantallas viejas por SSE; las nuevas son WebSocket que dejan dormir al servidor (conexiones()) */
    this.tickets = new Map();
    /* el «ping» de cada pantalla lo contesta Cloudflare solo, sin despertar al servidor: así no se gasta tiempo encendido mientras nadie hace nada */
    try { ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong')); } catch (e) { /* un entorno sin WebSocket: queda el SSE */ }
    this.fails = new Map();
    this.timer = null;
    this.snapState = null;
    this.snapBusy = false;
    this.USERS = new Map();
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS docs(coll TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, upd INTEGER NOT NULL, PRIMARY KEY(coll,id)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, usuario TEXT UNIQUE NOT NULL, nombre TEXT NOT NULL, role TEXT NOT NULL, tel TEXT DEFAULT '', permisos TEXT, activo INTEGER NOT NULL DEFAULT 1, salt TEXT, hash TEXT, created INTEGER, last_login INTEGER);
      CREATE TABLE IF NOT EXISTS sessions(th TEXT PRIMARY KEY, uid TEXT NOT NULL, created INTEGER, last INTEGER);
      CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, uid TEXT NOT NULL, did TEXT NOT NULL, label TEXT, ua TEXT, app TEXT, ip TEXT, geo TEXT, estado TEXT NOT NULL DEFAULT 'pend', creado INTEGER, visto INTEGER, UNIQUE(uid,did));
      CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS fails(k TEXT PRIMARY KEY, n INTEGER NOT NULL, until INTEGER NOT NULL, t INTEGER NOT NULL) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS routers(id TEXT PRIMARY KEY, nombre TEXT NOT NULL, th TEXT NOT NULL, kinds TEXT NOT NULL DEFAULT 'q', creado INTEGER, visto INTEGER, run TEXT, total INTEGER NOT NULL DEFAULT 0, ident TEXT, ros TEXT, ip TEXT);
      CREATE TABLE IF NOT EXISTS pings(id TEXT PRIMARY KEY, cid TEXT NOT NULL, ip TEXT NOT NULL, nodo TEXT, uid TEXT NOT NULL, ts INTEGER NOT NULL, router TEXT, tomado INTEGER, hecho INTEGER, sent INTEGER, rec INTEGER, avg REAL, estado TEXT NOT NULL DEFAULT 'pend') WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS rsnap(router TEXT NOT NULL, run TEXT NOT NULL, part INTEGER NOT NULL, data TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY(router,run,part)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS comprobantes(id TEXT PRIMARY KEY, uid TEXT NOT NULL, ts INTEGER NOT NULL, pago TEXT, data BLOB NOT NULL) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS ubic(uid TEXT NOT NULL, ts INTEGER NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, acc REAL, PRIMARY KEY(uid,ts)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS jornada(uid TEXT NOT NULL, dia TEXT NOT NULL, ingreso INTEGER NOT NULL, origen TEXT NOT NULL, dist INTEGER, regreso INTEGER, en_base INTEGER NOT NULL DEFAULT 1, ult INTEGER NOT NULL DEFAULT 0, ingreso2 INTEGER, ev TEXT, tr TEXT, adj TEXT, PRIMARY KEY(uid,dia)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS snapshots(name TEXT NOT NULL, part INTEGER NOT NULL, ts INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(name,part)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS contratos(id TEXT PRIMARY KEY, num INTEGER NOT NULL, cid TEXT NOT NULL, estado TEXT NOT NULL, motivo TEXT NOT NULL, prev TEXT, prueba INTEGER NOT NULL DEFAULT 0, tver INTEGER, titular TEXT NOT NULL, equipos TEXT NOT NULL, eq TEXT NOT NULL, texto TEXT NOT NULL, firma TEXT NOT NULL, aclar TEXT, ts INTEGER NOT NULL, por TEXT, pornombre TEXT, ip TEXT, ua TEXT, hash TEXT NOT NULL, estado_prev TEXT);
      CREATE INDEX IF NOT EXISTS contratos_cid ON contratos(cid);
      CREATE TABLE IF NOT EXISTS contratos_log(id TEXT PRIMARY KEY, cto TEXT NOT NULL, ts INTEGER NOT NULL, uid TEXT, uname TEXT, acc TEXT NOT NULL, det TEXT);
      CREATE INDEX IF NOT EXISTS contratos_log_cto ON contratos_log(cto);
    `);
    for (const col of ['ingreso2 INTEGER', 'ev TEXT', 'tr TEXT', 'adj TEXT']) { try { this.sql.exec('ALTER TABLE jornada ADD COLUMN ' + col); } catch (e) { /* la tabla ya la tiene */ } }
    this.sql.exec('DELETE FROM sessions WHERE last<?', Date.now() - 180 * 864e5);
    try { this.sql.exec('ALTER TABLE sessions ADD COLUMN dev TEXT'); } catch (e) { /* la tabla ya la tiene */ }
    for (const col of ['pth TEXT', 'pvisto INTEGER']) { try { this.sql.exec('ALTER TABLE routers ADD COLUMN ' + col); } catch (e) { /* la tabla ya la tiene */ } }
    this.sql.exec('DELETE FROM pings WHERE ts<?', Date.now() - 2 * 864e5);
    /* las sesiones que ya estaban abiertas antes de existir el registro de equipos quedan como equipos autorizados («Sesión anterior»);
       cuando ese teléfono vuelva a pedir algo con la versión nueva, se completa con los datos reales del equipo */
    for (const r of this.q('SELECT th,uid,created,last FROM sessions WHERE dev IS NULL')) {
      const id = 'd' + hex(rnd(6));
      this.sql.exec('INSERT INTO devices(id,uid,did,label,ua,app,ip,geo,estado,creado,visto) VALUES(?,?,?,?,?,?,?,?,?,?,?)', id, r.uid, 'old-' + r.th.slice(0, 20), 'Sesión anterior (sin datos del equipo)', '', '', '', '', 'ok', r.created || Date.now(), r.last || Date.now());
      this.sql.exec('UPDATE sessions SET dev=? WHERE th=?', id, r.th);
    }
    this.sql.exec('DELETE FROM fails WHERE t<?', Date.now() - 864e5);
    this.sql.exec('DELETE FROM ubic WHERE ts<?', Date.now() - UBIC_DIAS * 864e5);
    this.sql.exec('DELETE FROM jornada WHERE dia<?', arTime(Date.now() - JORNADA_DIAS * 864e5).fecha);
    this.sql.exec("DELETE FROM meta WHERE k LIKE 'ubiccorte:%' AND substr(k,-10)<?", arTime(Date.now() - JORNADA_DIAS * 864e5).fecha);
    this.loadUsers();
    /* el número de cambio nunca vuelve atrás aunque el objeto se reinicie: arranca en la hora actual (milisegundos) */
    this.SEQ = Date.now();
  }

  q(sql, ...a) { return this.sql.exec(sql, ...a).toArray(); }
  q1(sql, ...a) { return this.sql.exec(sql, ...a).toArray()[0]; }
  tx(fn) { return this.ctx.storage.transactionSync(fn); }

  /* ----- usuarios (se guardan también en memoria) ----- */
  loadUsers() {
    this.USERS = new Map();
    for (const r of this.q('SELECT * FROM users ORDER BY nombre COLLATE NOCASE')) {
      let permisos = null;
      try { permisos = r.permisos ? JSON.parse(r.permisos) : null; } catch (e) { /* queda sin permisos propios */ }
      this.USERS.set(r.id, { id: r.id, usuario: r.usuario, nombre: r.nombre, role: r.role, tel: r.tel || '', permisos, activo: !!r.activo, salt: r.salt, hash: r.hash, created: r.created, last_login: r.last_login });
    }
  }
  userCount() { return this.q1('SELECT COUNT(*) n FROM users').n; }
  perfilesView() {
    return [...this.USERS.values()].filter(u => u.role !== 'admin').map(u => ({ id: u.id, nombre: u.nombre, base: u.role, tel: u.tel, activo: u.activo, permisos: u.permisos || {}, usuario: u.usuario }));
  }
  insUser(u) {
    this.sql.exec('INSERT INTO users(id,usuario,nombre,role,tel,permisos,activo,salt,hash,created,last_login) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      u.id, u.usuario, u.nombre, u.role, u.tel || '', u.permisos ? JSON.stringify(u.permisos) : null, u.activo ? 1 : 0, u.salt || null, u.hash || null, u.created || Date.now(), u.last_login || null);
  }

  /* ----- sesiones ----- */
  async newSession(uid, dev) {
    const token = b64u(rnd(32));
    this.sql.exec('INSERT INTO sessions(th,uid,created,last,dev) VALUES(?,?,?,?,?)', await sha(token), uid, Date.now(), Date.now(), dev || null);
    return token;
  }
  /* equipos: ¿hay que pedir aprobación a los empleados? (se cambia en Ajustes; si nadie lo tocó, vale lo configurado en el servidor, que normalmente es «sí») */
  reqAprob() {
    const r = this.q1('SELECT v FROM meta WHERE k=?', 'disp_aprob');
    return r ? r.v !== '0' : String(this.env.DISP_APROBAR || '1') !== '0';
  }
  /* reconoce (o da de alta) el equipo desde el que entra un usuario y devuelve su fila; un empleado en un equipo nuevo queda «pendiente» y se le avisa al administrador */
  async devEntrar(u, request, didIn) {
    const ua = (request.headers.get('user-agent') || '').slice(0, 300), info = uaInfo(ua), ip = (request.headers.get('cf-connecting-ip') || '').slice(0, 60), geo = geoOf(request), now = Date.now();
    const did = DID_RE.test(String(didIn || '')) ? String(didIn) : 'ua-' + (await sha(ua)).slice(0, 24);
    let d = this.q1('SELECT * FROM devices WHERE uid=? AND did=?', u.id, did);
    if (!d) {
      const estado = u.role === 'admin' || !this.reqAprob() ? 'ok' : 'pend';
      if (estado === 'pend' && this.q1("SELECT COUNT(*) n FROM devices WHERE uid=? AND estado='pend'", u.id).n >= 8) throw httpErr(429, 'Hay demasiados equipos esperando aprobación para este usuario. Avisale al administrador.', 'resource_exhausted');
      d = { id: 'd' + hex(rnd(6)), uid: u.id, did, label: info.label, ua, app: info.app, ip, geo, estado, creado: now, visto: now };
      this.sql.exec('INSERT INTO devices(id,uid,did,label,ua,app,ip,geo,estado,creado,visto) VALUES(?,?,?,?,?,?,?,?,?,?,?)', d.id, d.uid, d.did, d.label, d.ua, d.app, d.ip, d.geo, d.estado, d.creado, d.visto);
      if (estado === 'pend') this.avisarAdmins();
      return d;
    }
    if (d.estado === 'pend' && !this.reqAprob()) d.estado = 'ok';   // se apagó el pedido de aprobación: los que esperaban entran
    this.sql.exec('UPDATE devices SET label=?,ua=?,app=?,ip=?,geo=?,estado=?,visto=? WHERE id=?', info.label, ua, info.app, ip, geo, d.estado, now, d.id);
    return Object.assign(d, { label: info.label, ua, app: info.app, ip, geo, visto: now });
  }
  /* una sesión abierta antes de existir el registro de equipos: con el primer pedido de la app nueva se completa con el equipo real */
  devCompletar(d, request, didIn) {
    if (!DID_RE.test(String(didIn || ''))) return;
    const ua = (request.headers.get('user-agent') || '').slice(0, 300), info = uaInfo(ua), ip = (request.headers.get('cf-connecting-ip') || '').slice(0, 60), geo = geoOf(request);
    const otro = this.q1('SELECT id FROM devices WHERE uid=? AND did=?', d.uid, didIn);
    if (otro) { this.sql.exec('UPDATE sessions SET dev=? WHERE dev=?', otro.id, d.id); this.sql.exec('DELETE FROM devices WHERE id=?', d.id); return; }
    this.sql.exec('UPDATE devices SET did=?,label=?,ua=?,app=?,ip=?,geo=? WHERE id=?', didIn, info.label, ua, info.app, ip, geo, d.id);
  }
  avisarAdmins() {
    const n = this.q1("SELECT COUNT(*) n FROM devices WHERE estado='pend'").n;
    for (const s of this.conexiones()) { const u = this.USERS.get(s.uid); if (u && u.role === 'admin') this.sse(s, 'disp', { pend: n }); }
  }
  async authOf(request) {
    const m = /^Bearer\s+(\S+)$/.exec(request.headers.get('authorization') || '');
    if (!m) return null;
    const th = await sha(m[1]);
    const s = this.q1('SELECT uid,last,dev FROM sessions WHERE th=?', th);
    if (!s) return null;
    const u = this.USERS.get(s.uid);
    if (!u || !u.activo) return null;
    if (Date.now() - s.last > 180 * 864e5) { this.sql.exec('DELETE FROM sessions WHERE th=?', th); return null; }
    /* el equipo de esta sesión tiene que seguir autorizado: si el administrador lo bloqueó o lo quitó, la sesión termina en el acto */
    let dev = s.dev ? this.q1('SELECT id,uid,did,estado FROM devices WHERE id=?', s.dev) : null;
    if (s.dev && (!dev || dev.estado !== 'ok')) { this.sql.exec('DELETE FROM sessions WHERE th=?', th); return null; }
    const did = request.headers.get('x-did');
    if (dev && dev.did.startsWith('old-') && did) { this.devCompletar(dev, request, did); dev = this.q1('SELECT id,uid,did,estado FROM devices WHERE uid=? AND did=?', s.uid, did) || dev; }
    if (Date.now() - s.last > 60e3) {
      this.sql.exec('UPDATE sessions SET last=?,dev=? WHERE th=?', Date.now(), dev ? dev.id : s.dev, th);
      if (dev) this.sql.exec('UPDATE devices SET visto=?,ip=?,geo=? WHERE id=?', Date.now(), (request.headers.get('cf-connecting-ip') || '').slice(0, 60), geoOf(request), dev.id);
      if (dev && dev.did.startsWith('old-')) { const ua = (request.headers.get('user-agent') || '').slice(0, 300), info = uaInfo(ua); this.sql.exec('UPDATE devices SET label=?,ua=?,app=? WHERE id=?', info.label, ua, info.app, dev.id); }
    }
    return { user: u, th, dev: dev ? dev.id : null };
  }
  async needAuth(request) { const a = await this.authOf(request); if (!a) throw httpErr(401, 'Tu sesión terminó. Entrá de nuevo.', 'unauthenticated'); return a; }
  async needAdmin(request) { const a = await this.needAuth(request); if (a.user.role !== 'admin') throw httpErr(403, 'Solo el administrador puede hacer esto.', 'permission_denied'); return a; }
  /* lista de equipos para el administrador: primero los que esperan aprobación, después los autorizados (el último uso arriba) y al final los bloqueados */
  dispView(a) {
    const orden = { pend: 0, ok: 1, bloq: 2 };
    const lista = this.q('SELECT d.*, (SELECT COUNT(*) FROM sessions s WHERE s.dev=d.id) ses FROM devices d').map(r => {
      const u = this.USERS.get(r.uid);
      return { id: r.id, uid: r.uid, usuario: u ? u.usuario : '?', nombre: u ? u.nombre : '(usuario eliminado)', role: u ? u.role : '', label: r.label || '', app: r.app || '', ip: r.ip || '', geo: r.geo || '', estado: r.estado, creado: r.creado, visto: r.visto, sesion: r.ses > 0, actual: r.id === a.dev, anterior: r.did.startsWith('old-'), cod: /^(old|ua)-/.test(r.did) ? '' : r.did.slice(0, 6).toUpperCase() };
    }).sort((x, y) => (orden[x.estado] - orden[y.estado]) || ((y.estado === 'pend' ? y.creado : y.visto) - (x.estado === 'pend' ? x.creado : x.visto)));
    return { requiere: this.reqAprob(), pend: lista.filter(x => x.estado === 'pend').length, lista };
  }
  adminsActivos() { return [...this.USERS.values()].filter(u => u.role === 'admin' && u.activo); }

  /* ----- freno a los intentos de entrada -----
     Se guarda en la base (no solo en memoria): Cloudflare apaga el objeto cuando pasa un rato sin pedidos,
     y si el freno se olvidara, alguien podría esperar y seguir probando claves. */
  clientIp(request) {
    const ip = request.headers.get('cf-connecting-ip') || '?';
    return ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip;   // en IPv6 cuenta la red completa (/64), no cada dirección
  }
  failGet(key) {
    let f = this.fails.get(key);
    if (!f) {
      const r = this.q1('SELECT n,until FROM fails WHERE k=?', key);
      f = r ? { n: r.n, until: r.until } : { n: 0, until: 0 };
      this.fails.set(key, f);
    }
    return f;
  }
  locked(key) { const f = this.failGet(key); return f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0; }
  addFail(key, max) {
    const f = this.failGet(key);
    if (f.until && f.until <= Date.now()) { f.n = 0; f.until = 0; }
    f.n++;
    if (f.n >= (max || 5)) f.until = Date.now() + 30e3 * Math.min(30, f.n - (max || 5) + 1);
    this.sql.exec('INSERT INTO fails(k,n,until,t) VALUES(?,?,?,?) ON CONFLICT(k) DO UPDATE SET n=excluded.n, until=excluded.until, t=excluded.t', key, f.n, f.until, Date.now());
  }
  clearFail(key) {
    const f = this.fails.get(key);
    if (f && f.n === 0) return;
    this.fails.delete(key);
    this.sql.exec('DELETE FROM fails WHERE k=?', key);
  }

  /* ----- documentos ----- */
  readDoc(coll, id) { const r = this.q1('SELECT data FROM docs WHERE coll=? AND id=?', coll, id); return r ? JSON.parse(r.data) : null; }
  putDoc(coll, id, s) {
    this.sql.exec('INSERT INTO docs(coll,id,data,upd) VALUES(?,?,?,?) ON CONFLICT(coll,id) DO UPDATE SET data=excluded.data, upd=excluded.upd', coll, id, s, Date.now());
  }
  viewData(u, p, coll, id, data) {
    if (coll === 'pagos') return canReadPagos(u, p) ? data : null;
    if (coll === 'ajustes') {
      if (id !== 'general') return u.role === 'admin' ? data : null;
      const d = Object.assign({}, data, { perfiles: this.perfilesView(), waActivo: this.waActivo() });
      if (!p.precios && Array.isArray(d.servicios)) d.servicios = d.servicios.map(s => { const c = Object.assign({}, s); delete c.precio; delete c.hist; return c; });
      return d;
    }
    if (u.role === 'admin') return data;
    if (coll === 'planes') { if (!p.verPlan) return null; if (p.precios) return data; const c = Object.assign({}, data); delete c.precio; delete c.hist; return c; }
    if (coll === 'clientes') {
      const drop = [];
      if (!p.precios) drop.push('precio', 'hp');
      /* el plan contratado (velocidad y nombre) tampoco lo ve quien no tiene el permiso: ni el plan actual ni los anteriores */
      if (!p.verPlan) drop.push('planId', 'hp');
      if (!p.comodato) drop.push('comodato');
      if (!p.precios && !p.cobrar && !p.caja) drop.push('deudaAnt');
      if (!p.dni) drop.push('dni');
      /* los servicios adicionales (Multimedia, Multimedia Net…) son de facturación: el técnico no tiene que enterarse de cuáles tiene cada cliente */
      if (!(p.cobrar || p.caja || p.editarClientes || p.precios)) drop.push('extras');
      if (!p.telefono) drop.push('tel', 'tel2');
      const out = drop.length ? strip(data, drop) : data;
      return p.cobrar || p.caja || p.editarClientes ? out : this.sinEstadoDePago(out);
    }
    return data;
  }
  /* Quien no ve la facturación (el técnico) no tiene que enterarse de si un cliente está activo o suspendido por falta de pago:
     se le saca el estado «activo» o «suspendido» (queda «por instalar» y «baja», que usa para trabajar) y todo lo que delata un corte o una deuda.
     Al faltar el campo, lo que él guarda de vuelta no pisa el estado real. */
  sinEstadoDePago(data) {
    if (!isPlain(data) || !isPlain(data.items)) return data;
    const items = {};
    for (const id of Object.keys(data.items)) {
      const it = data.items[id];
      if (!isPlain(it)) { items[id] = it; continue; }
      const c = Object.assign({}, it);
      if (c.estado === 'activo' || c.estado === 'suspendido') delete c.estado;
      delete c.corteMora; delete c.reconectado; delete c.promesas;
      items[id] = c;
    }
    return Object.assign({}, data, { items });
  }
  /* no se puede borrar una caja o empalme que todavía tiene clientes conectados, ni un empalme del que sale otra caja */
  redInUse(existing, items) {
    const gone = Object.keys(items).filter(k => items[k] === null && existing && isPlain(existing.items) && isPlain(existing.items[k]));
    if (!gone.length) return null;
    const rows = this.q('SELECT data FROM docs WHERE coll=?', 'clientes');
    for (const id of gone) {
      const key = '"nap":' + JSON.stringify(id);
      let n = 0;   /* los clientes dados de baja ya no ocupan la caja */
      for (const r of rows) {
        if (!r.data.includes(key)) continue;
        const its = JSON.parse(r.data).items || {};
        for (const k of Object.keys(its)) if (isPlain(its[k]) && its[k].nap === id && its[k].estado !== 'baja') n++;
      }
      const nombre = String(existing.items[id].nombre || id);
      if (n) return 'No se puede eliminar «' + nombre + '»: tiene ' + n + (n === 1 ? ' cliente conectado' : ' clientes conectados') + '. Pasalos primero a otra caja.';
      const hijos = Object.keys(existing.items).filter(k => k !== id && items[k] !== null && isPlain(existing.items[k]) && existing.items[k].padre === id && !(isPlain(items[k]) && 'padre' in items[k] && items[k].padre !== id));
      if (hijos.length) return 'No se puede eliminar «' + nombre + '»: de ahí salen ' + hijos.length + (hijos.length === 1 ? ' punto de la red' : ' puntos de la red') + '. Cambiales primero de dónde salen.';
    }
    return null;
  }
  writeDoc(u, coll, id, op, data) {
    if (!COLS.has(coll) || !ID_RE.test(id)) throw httpErr(400, 'Ruta inválida.');
    if (!isPlain(data)) throw httpErr(400, 'Datos inválidos.');
    const p = effPerms(u);
    if (op === 'set' && (coll === 'clientes' || coll === 'pagos' || coll === 'ordenes' || coll === 'red')) throw httpErr(400, 'Los lotes de clientes, pagos, órdenes y red solo se modifican de a un registro.', 'invalid_argument');
    const bad = canWrite(u, p, coll, op);
    if (bad) throw httpErr(403, bad, 'permission_denied');
    if (coll === 'ajustes' && id !== 'general') throw httpErr(400, 'Ruta inválida.');
    let out, waKeys = [];
    this.tx(() => {
      const existing = this.readDoc(coll, id);
      if (coll === 'ajustes') {
        data = Object.assign({}, data); delete data.perfiles; delete data.waActivo;
        /* una pantalla desactualizada que guarda otros ajustes no tiene que borrar los precios fijos */
        if (op === 'set' && existing) for (const k of Object.values(PRECIO_KEYS)) if (!(k in data) && k in existing) data[k] = existing[k];
      }
      const why = guard(u, p, coll, existing, data, this);
      if (why) throw httpErr(403, why, 'permission_denied');
      if (coll === 'red') { const inUse = this.redInUse(existing, data.items); if (inUse) throw httpErr(409, inUse, 'failed_precondition'); }
      /* cobro de quien cobra en la calle: el recibo le llega al cliente por WhatsApp (queda «pendiente» hasta que se envíe) */
      if (coll === 'pagos' && u.role !== 'admin' && !p.cobrar && p.cobrarCampo && this.waActivo()) {
        waKeys = Object.keys(data.items).filter(k => isPlain(data.items[k]) && !(existing && isPlain(existing.items) && k in existing.items));
        for (const k of waKeys) data.items[k].wa = { e: 'pendiente', ts: Date.now(), tel: null, err: null, id: null, n: 0 };
      }
      const next = op === 'set' || !existing ? data : deepMerge(existing, data);
      const s = JSON.stringify(next);
      /* la base de Cloudflare admite hasta 2 MB por fila: se mide en bytes, no en letras */
      if (s.length > 6e5 && bytesOf(s) > 1.9e6) throw httpErr(413, 'El documento es demasiado grande.', 'quota_exceeded');
      this.putDoc(coll, id, s);
      if (coll === 'pagos') {   /* la foto del comprobante queda atada a este cobro: no se puede usar en otro */
        for (const k of Object.keys(data.items)) {
          const it = data.items[k];
          if (isPlain(it) && typeof it.comp === 'string' && COMP_ID_RE.test(it.comp)) this.sql.exec('UPDATE comprobantes SET pago=? WHERE id=? AND pago IS NULL', id + '/' + k, it.comp);
        }
      }
      this.SEQ++;
      out = { seq: this.SEQ, next, patch: data };
    });
    const sendOp = coll === 'ajustes' ? 'set' : op;
    const payload = coll === 'ajustes' ? out.next : out.patch;
    this.broadcastDoc(coll, id, sendOp, payload, out.seq);
    if (waKeys.length) this.waAvisar(id, waKeys);
    this.snapshotSoon();
    return { ok: true, seq: out.seq, op: sendOp, data: this.viewData(u, p, coll, id, payload) };
  }
  /* Borrar un plan: solo el administrador, y solo si ningún cliente lo usa ni lo usó (ni siquiera dados de baja ni en el historial de
     precios): borrarlo cambiaría a qué plan y precio figuran esos meses. Para dejar de ofrecerlo alcanza con desactivarlo. */
  planEnUso(id) {
    const key = JSON.stringify(id);
    let act = 0, baja = 0, hist = 0;
    for (const r of this.q('SELECT data FROM docs WHERE coll=?', 'clientes')) {
      if (!r.data.includes(key)) continue;
      const its = JSON.parse(r.data).items || {};
      for (const k of Object.keys(its)) {
        const c = its[k];
        if (!isPlain(c)) continue;
        if (c.planId === id) { if (c.estado === 'baja') baja++; else act++; }
        else if (Array.isArray(c.hp) && c.hp.some(e => isPlain(e) && e.planId === id)) hist++;
      }
    }
    return { act, baja, hist };
  }
  deleteDoc(u, coll, id) {
    if (coll !== 'planes' || !ID_RE.test(id)) throw httpErr(400, 'Solo se pueden borrar planes.', 'invalid_argument');
    if (u.role !== 'admin') throw httpErr(403, 'Solo el administrador puede borrar planes.', 'permission_denied');
    let seq;
    this.tx(() => {
      const plan = this.readDoc('planes', id);
      if (!plan) throw httpErr(404, 'Ese plan no existe.', 'not_found');
      const n = this.planEnUso(id), partes = [];
      if (n.act) partes.push(n.act + (n.act === 1 ? ' cliente' : ' clientes'));
      if (n.baja) partes.push(n.baja + (n.baja === 1 ? ' cliente dado de baja' : ' clientes dados de baja'));
      if (n.hist) partes.push('el historial de precios de ' + n.hist + (n.hist === 1 ? ' cliente' : ' clientes'));
      if (partes.length) throw httpErr(409, 'No se puede eliminar «' + String(plan.nombre || id) + '»: figura en ' + partes.join(', ') + '. Desactivalo para que no se ofrezca más.', 'failed_precondition');
      this.sql.exec('DELETE FROM docs WHERE coll=? AND id=?', 'planes', id);
      this.SEQ++;
      seq = this.SEQ;
    });
    this.broadcastDoc('planes', id, 'delete', {}, seq);
    this.snapshotSoon();
    return { ok: true, seq, op: 'delete', data: {} };
  }
  /* Todo lo que puede ver esta persona, ya armado como texto JSON. Lo que no hay que filtrar (por ejemplo los pagos, que son lo más grande)
     se copia tal cual desde la base, sin abrirlo: así no se agota la memoria cuando haya años de cobros. */
  syncJSON(u) {
    const p = effPerms(u), cols = [];
    for (const coll of COLS) {
      if (coll === 'pagos' && !canReadPagos(u, p)) continue;
      const arr = [];
      let hasGeneral = false;
      for (const r of this.q('SELECT id,data FROM docs WHERE coll=? ORDER BY id', coll)) {
        if (coll === 'ajustes' && r.id !== 'general' && u.role !== 'admin') continue;
        if (coll === 'ajustes' && r.id === 'general') hasGeneral = true;
        if (coll === 'pagos' || (u.role === 'admin' && coll !== 'ajustes')) { arr.push('{"id":' + JSON.stringify(r.id) + ',"data":' + r.data + '}'); continue; }
        const v = this.viewData(u, p, coll, r.id, JSON.parse(r.data));
        if (v != null) arr.push(JSON.stringify({ id: r.id, data: v }));
      }
      if (coll === 'ajustes' && !hasGeneral) arr.push(JSON.stringify({ id: 'general', data: this.viewData(u, p, 'ajustes', 'general', {}) }));
      cols.push(JSON.stringify(coll) + ':[' + arr.join(',') + ']');
    }
    return '{"seq":' + this.SEQ + ',"cols":{' + cols.join(',') + '}}';
  }

  /* precios fijos de instalación y reinstalación (Ajustes; si falta alguno rige el de siempre) */
  preciosFijos() {
    const a = this.readDoc('ajustes', 'general') || {};
    const out = {};
    for (const k of Object.keys(PRECIO_KEYS)) { const v = Number(a[PRECIO_KEYS[k]]); out[k] = isFinite(v) && v > 0 ? Math.round(v) : PRECIO_DEF[k]; }
    return out;
  }
  /* el cliente tal como está guardado (los clientes viven repartidos en varios documentos) */
  clienteDe(cid) {
    const key = JSON.stringify(cid);
    for (const r of this.q('SELECT data FROM docs WHERE coll=?', 'clientes')) {
      if (!r.data.includes(key)) continue;
      const it = (JSON.parse(r.data).items || {})[cid];
      if (isPlain(it)) return it;
    }
    return null;
  }
  /* la fecha en que se le cobró la instalación a este cliente (sin contar los recibos anulados), o '' si todavía no se le cobró */
  instalacionCobrada(cid) {
    const key = JSON.stringify(cid);
    for (const r of this.q('SELECT data FROM docs WHERE coll=?', 'pagos')) {
      if (!r.data.includes(key) || !r.data.includes('"instalacion"')) continue;
      const its = JSON.parse(r.data).items || {};
      for (const k of Object.keys(its)) { const it = its[k]; if (isPlain(it) && it.c === cid && it.concepto === 'instalacion' && !it.anulado) return typeof it.fecha === 'string' && it.fecha ? it.fecha : 'si'; }
    }
    return '';
  }
  /* los cobros que registró esta persona en los últimos días (quien cobra en la calle no lee la caja entera) */
  /* ----- foto del comprobante de una transferencia (la sube quien cobra en la calle) ----- */
  comprobanteLibre(id, uid) {
    const r = this.q1('SELECT uid,pago FROM comprobantes WHERE id=?', id);
    return !!r && r.uid === uid && !r.pago;
  }
  comprobanteGuardar(u, body) {
    const p = effPerms(u);
    if (u.role !== 'admin' && !p.cobrar && !p.cobrarCampo) throw httpErr(403, 'Tu usuario no puede registrar pagos.', 'permission_denied');
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(body.img || ''));
    if (!m) throw httpErr(400, 'La foto no es válida: tiene que ser una imagen JPEG.');
    let bin;
    try { bin = Uint8Array.from(atob(m[1]), ch => ch.charCodeAt(0)); } catch (e) { throw httpErr(400, 'La foto no es válida.'); }
    if (bin.length > COMP_MAX) throw httpErr(413, 'La foto es demasiado grande.', 'quota_exceeded');
    if (bin.length < 1000 || bin[0] !== 0xFF || bin[1] !== 0xD8 || bin[2] !== 0xFF) throw httpErr(400, 'La foto no es válida: tiene que ser una imagen JPEG.');
    this.sql.exec('DELETE FROM comprobantes WHERE pago IS NULL AND ts<?', Date.now() - 2 * 864e5);   /* las que no se usaron en 2 días */
    if (this.q1('SELECT COUNT(*) n FROM comprobantes WHERE uid=? AND pago IS NULL', u.id).n >= 20) throw httpErr(429, 'Tenés demasiadas fotos sin usar. Terminá primero los cobros que tenés en curso.', 'resource_exhausted');
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    this.sql.exec('INSERT INTO comprobantes(id,uid,ts,data) VALUES(?,?,?,?)', id, u.id, Date.now(), bin);
    return { id };
  }
  comprobanteLeer(u, id) {
    const r = this.q1('SELECT uid,data FROM comprobantes WHERE id=?', id);
    if (!r) throw httpErr(404, 'No se encontró el comprobante.');
    if (r.uid !== u.id && !canReadPagos(u, effPerms(u))) throw httpErr(403, 'Tu usuario no puede ver este comprobante.', 'permission_denied');
    return new Response(r.data, { status: 200, headers: Object.assign({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }, CORS) });
  }

  misCobros(u, dias) {
    const hoy = ymd(), desde = ymd(Date.now() - (dias - 1) * 864e5), docs = [];
    for (const y of new Set([desde.slice(0, 4), hoy.slice(0, 4)])) {
      for (const r of this.q('SELECT id,data FROM docs WHERE coll=? AND id LIKE ? ORDER BY id', 'pagos', y + '-%')) {
        const its = JSON.parse(r.data).items || {}, mine = {};
        for (const k of Object.keys(its)) { const it = its[k]; if (isPlain(it) && it.por === u.id && it.fecha >= desde && it.fecha <= hoy) mine[k] = it; }
        if (Object.keys(mine).length) docs.push({ id: r.id, data: { items: mine } });
      }
    }
    return { docs, desde, hoy };
  }

  /* ===== recibo por WhatsApp (WhatsApp Business de Meta) =====
     Solo anda si en Cloudflare están cargados los secretos WA_TOKEN y WA_PHONE_ID. Cuando un técnico cobra en la calle, el servidor le manda al
     cliente un mensaje con la plantilla aprobada por WhatsApp (WA_TEMPLATE, por defecto «recibo_cobro», en WA_LANG, por defecto es_AR).
     El resultado queda en el propio cobro (campo «wa»): pendiente, enviado, error o sin_tel. Ninguna clave sale del servidor. */
  waConfig() {
    const e = this.env, token = String(e.WA_TOKEN || '').trim(), phone = String(e.WA_PHONE_ID || '').trim();
    if (!token || !/^\d{5,25}$/.test(phone)) return null;
    const rm = Number(e.WA_RETRY_MS);
    return {
      token, phone, tpl: String(e.WA_TEMPLATE || 'recibo_cobro').trim(), lang: String(e.WA_LANG || 'es_AR').trim(),
      base: String(e.WA_API || 'https://graph.facebook.com').replace(/\/+$/, '') + '/' + String(e.WA_VER || 'v23.0').trim(),
      retryMs: e.WA_RETRY_MS !== undefined && e.WA_RETRY_MS !== '' && isFinite(rm) && rm >= 0 ? rm : 2000
    };
  }
  waActivo() { return !!this.waConfig() && (this.readDoc('ajustes', 'general') || {}).waAuto !== false; }
  /* un mensaje con la plantilla; devuelve { ok, id } o { ok:false, temp (vale reintentar), error } */
  async waLlamar(cfg, to, vars) {
    const body = { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'template',
      template: { name: cfg.tpl, language: { code: cfg.lang }, components: [{ type: 'body', parameters: vars.map(v => ({ type: 'text', text: v })) }] } };
    let res;
    try {
      res = await fetch(cfg.base + '/' + cfg.phone + '/messages', { method: 'POST', headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    } catch (e) { return { ok: false, temp: true, error: 'No se pudo conectar con WhatsApp.' }; }
    let j = null;
    try { j = await res.json(); } catch (e) { /* sin cuerpo */ }
    if (res.ok && j && Array.isArray(j.messages) && j.messages[0] && j.messages[0].id) return { ok: true, id: String(j.messages[0].id).slice(0, 120) };
    const er = j && isPlain(j.error) ? j.error : {}, det = isPlain(er.error_data) && er.error_data.details ? ' ' + er.error_data.details : '';
    const txt = (String(er.message || 'Respuesta ' + res.status) + det).split(cfg.token).join('***').replace(/\s+/g, ' ').slice(0, 220);
    return { ok: false, temp: res.status === 429 || res.status >= 500, error: '(' + (er.code || res.status) + ') ' + txt };
  }
  /* tope diario de avisos: por número y en total */
  waCupo(to, manual) {
    const k = 'wa:' + ymd(), r = this.q1('SELECT v FROM meta WHERE k=?', k);
    let d = null;
    try { d = r ? JSON.parse(r.v) : null; } catch (e) { d = null; }
    if (!isPlain(d) || !isPlain(d.n)) d = { t: 0, n: {} };
    if (d.t >= WA_MAX_DIA || (!manual && (d.n[to] || 0) >= WA_MAX_NUM_DIA)) return false;
    d.t++; d.n[to] = (d.n[to] || 0) + 1;
    this.sql.exec('INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)', k, JSON.stringify(d));
    this.sql.exec('DELETE FROM meta WHERE k LIKE ? AND k<>?', 'wa:%', k);   // solo queda el contador de hoy
    return true;
  }
  /* anota el estado del aviso en los cobros del recibo y se lo avisa a las pantallas abiertas */
  waMarcar(docId, ks, wa) {
    let seq = 0;
    this.tx(() => {
      const d = this.readDoc('pagos', docId);
      if (!d || !isPlain(d.items)) return;
      let hay = false;
      for (const k of ks) if (isPlain(d.items[k])) { d.items[k].wa = wa; hay = true; }
      if (!hay) return;
      this.putDoc('pagos', docId, JSON.stringify(d));
      this.SEQ++; seq = this.SEQ;
    });
    if (!seq) return;
    const patch = { items: {} };
    for (const k of ks) patch.items[k] = { wa };
    this.broadcastDoc('pagos', docId, 'merge', patch, seq);
  }
  /* manda el recibo de un cobro (o de varios del mismo recibo) y deja anotado cómo salió */
  async waRecibo(docId, ks, manual) {
    const cfg = this.waConfig();
    const d = this.readDoc('pagos', docId), its = ks.map(k => d && isPlain(d.items) ? d.items[k] : null).filter(isPlain);
    if (!cfg) return { e: 'error', err: 'El WhatsApp automático no está configurado.' };
    if (!its.length) return { e: 'error', err: 'No se encontró el cobro.' };
    const vivos = its.filter(i => !i.anulado);
    const now = Date.now(), fin = (e, o) => { const wa = Object.assign({ e, ts: Date.now(), tel: null, err: null, id: null, n: 0 }, o); this.waMarcar(docId, ks, wa); return wa; };
    if (!vivos.length) return fin('error', { err: 'El recibo está anulado: no se envía.' });
    /* recibo de una cuenta con varios servicios: sale a nombre de la cuenta principal y al WhatsApp de ella (o, si no tiene, al de algún servicio) */
    const mie = this.clienteDe(vivos[0].c), ids = new Set(vivos.map(i => i.c)), cab = mie && mie.cuenta && ids.size > 1 ? this.clienteDe(mie.cuenta) : null;
    const cl = cab || mie, tels = [];
    if (cab) { tels.push(cab.tel, cab.tel2); for (const id of ids) { const s = this.clienteDe(id); if (s) tels.push(s.tel, s.tel2); } } else tels.push(cl && cl.tel, cl && cl.tel2);
    let to = '';
    for (const t of tels) { to = waNumero(t); if (to) break; }
    if (!to) return fin('sin_tel', { err: !cl ? 'No se encontró al cliente.' : (cl.tel || cl.tel2) ? 'El teléfono del cliente no sirve para WhatsApp (tiene que tener el código de área, sin 0 ni 15).' : 'El cliente no tiene teléfono cargado.' });
    if (!this.waCupo(to, manual)) return fin('error', { tel: to, err: 'Se llegó al máximo de avisos por WhatsApp de hoy para este número. Probá mañana o mandalo a mano.' });
    this.waMarcar(docId, ks, { e: 'pendiente', ts: now, tel: to, err: null, id: null, n: 0 });
    const total = vivos.reduce((t, i) => t + (Number(i.monto) || 0), 0), conc = [...new Set(vivos.map(i => WA_CONC[i.concepto] || 'Pago'))].join(', ');
    const vars = [waTxt(String(cl.nombre || '').split(/\s+/).slice(0, 3).join(' '), 60), pesos(total), waTxt(conc, 60), waTxt(vivos[0].recibo, 40), dmyAR(vivos[0].fecha)];
    let r = null, n = 0;
    while (n < 3) {
      r = await this.waLlamar(cfg, to, vars); n++;
      if (r.ok || !r.temp || n >= 3) break;
      await new Promise(res => setTimeout(res, cfg.retryMs * (n === 1 ? 1 : 3)));
    }
    return r.ok ? fin('enviado', { tel: to, id: r.id, n }) : fin('error', { tel: to, err: r.error, n });
  }
  /* en segundo plano: el cobro ya está guardado y el técnico no espera a WhatsApp */
  waAvisar(docId, keys) {
    (async () => {
      try {
        const d = this.readDoc('pagos', docId), by = {};
        for (const k of keys) { const it = d && isPlain(d.items) ? d.items[k] : null; if (isPlain(it)) (by[it.recibo || k] = by[it.recibo || k] || []).push(k); }
        for (const ks of Object.values(by)) await this.waRecibo(docId, ks, false);
      } catch (e) { console.error('Aviso por WhatsApp falló:', e && e.message); }
    })();
  }
  /* los cobros de un recibo, tal como están guardados: [{ doc, keys }] */
  waBuscar(recibo) {
    if (!/^[A-Za-z0-9-]{4,40}$/.test(String(recibo || ''))) return [];
    const key = '"recibo":' + JSON.stringify(recibo), out = [];
    for (const r of this.q('SELECT id,data FROM docs WHERE coll=? AND data LIKE ?', 'pagos', '%' + key + '%')) {
      const its = JSON.parse(r.data).items || {}, keys = Object.keys(its).filter(k => isPlain(its[k]) && its[k].recibo === recibo);
      if (keys.length) out.push({ doc: r.id, keys });
    }
    return out;
  }
  /* la oficina reintenta (o repite) el aviso de un recibo, o de todos los que fallaron en los últimos días */
  async waReenviar(u, body) {
    const p = effPerms(u);
    if (u.role !== 'admin' && !p.cobrar && !p.caja) throw httpErr(403, 'Tu usuario no puede reenviar recibos.', 'permission_denied');
    if (!this.waConfig()) throw httpErr(409, 'El WhatsApp automático no está configurado.', 'failed_precondition');
    const b = isPlain(body) ? body : {};
    if (b.todos === true) {
      const desde = ymd(Date.now() - 14 * 864e5), lotes = [];
      const docs = [];
      for (const y of new Set([desde.slice(0, 4), ymd().slice(0, 4)])) docs.push(...this.q('SELECT id,data FROM docs WHERE coll=? AND id LIKE ? ORDER BY id DESC', 'pagos', y + '-%'));
      for (const r of docs) {
        const its = JSON.parse(r.data).items || {}, by = {};
        for (const k of Object.keys(its)) {
          const it = its[k];
          if (!isPlain(it) || it.anulado || !isPlain(it.wa) || it.fecha < desde) continue;
          if (it.wa.e === 'error' || (it.wa.e === 'pendiente' && Date.now() - (it.wa.ts || 0) > 5 * 60e3)) (by[it.recibo || k] = by[it.recibo || k] || []).push(k);
        }
        for (const ks of Object.values(by)) lotes.push({ doc: r.id, keys: ks });
      }
      const hechos = lotes.slice(0, 25);
      let ok = 0;
      for (const l of hechos) { const wa = await this.waRecibo(l.doc, l.keys, true); if (wa.e === 'enviado') ok++; }
      return { ok: true, intentados: hechos.length, enviados: ok, quedan: Math.max(0, lotes.length - hechos.length) };
    }
    const hay = this.waBuscar(b.recibo);
    if (!hay.length) throw httpErr(404, 'No se encontró el recibo.');
    const wa = await this.waRecibo(hay[0].doc, hay[0].keys, true);
    return { ok: wa.e === 'enviado', wa };
  }
  /* estado del WhatsApp automático (solo el administrador) */
  waEstado() {
    const cfg = this.waConfig(), a = this.readDoc('ajustes', 'general') || {};
    const r = this.q1('SELECT v FROM meta WHERE k=?', 'wa:' + ymd());
    let hoy = 0;
    try { hoy = r ? Number(JSON.parse(r.v).t) || 0 : 0; } catch (e) { hoy = 0; }
    return { configurado: !!cfg, auto: a.waAuto !== false, plantilla: cfg ? cfg.tpl : String(this.env.WA_TEMPLATE || 'recibo_cobro'), idioma: cfg ? cfg.lang : String(this.env.WA_LANG || 'es_AR'), hoy };
  }
  /* mensaje de prueba al número que elige el administrador (con datos de ejemplo) */
  async waPrueba(body) {
    const cfg = this.waConfig();
    if (!cfg) throw httpErr(409, 'Todavía no está cargada la conexión con WhatsApp en Cloudflare.', 'failed_precondition');
    const to = waNumero(isPlain(body) ? body.tel : '');
    if (!to) throw httpErr(400, 'Escribí un número de celular con código de área, sin 0 ni 15 (por ejemplo 3844 56-2605).');
    if (!this.waCupo(to, true)) throw httpErr(429, 'Se llegó al máximo de mensajes de hoy.');
    const r = await this.waLlamar(cfg, to, ['Prueba', pesos(1), 'Mensaje de prueba', 'R-PRUEBA', dmyAR(ymd())]);
    if (!r.ok) throw httpErr(422, 'WhatsApp no aceptó el mensaje: ' + r.error);
    return { ok: true };
  }

  /* ----- tiempo real (SSE) ----- */
  /* todas las pantallas conectadas: WebSocket (el servidor puede dormirse y despierta cuando hay algo que avisar) + las versiones viejas por SSE */
  conexiones() {
    const out = [];
    try { for (const ws of this.ctx.getWebSockets()) { const a = ws.deserializeAttachment(); if (a && a.uid) out.push({ ws, uid: a.uid, dev: a.dev || null }); } } catch (e) { /* sin WebSocket */ }
    for (const s of this.streams) out.push(s);
    return out;
  }
  sse(s, event, data) {
    if (s.ws) { try { s.ws.send(JSON.stringify({ e: event, d: data })); } catch (e) { this.endStream(s); } return; }
    try {
      if (s.c.desiredSize !== null && s.c.desiredSize < -300) throw new Error('lento');
      s.c.enqueue(enc.encode('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'));
    } catch (e) { this.endStream(s); }
  }
  endStream(s) { if (s.ws) { try { s.ws.close(1000, 'fin'); } catch (e) { /* ya estaba cerrado */ } return; } this.streams.delete(s); try { s.c.close(); } catch (e) { /* ya estaba cerrado */ } }
  webSocketMessage() { /* nada: el «ping» se contesta solo y el servidor no recibe órdenes por acá */ }
  webSocketClose(ws, code) { try { ws.close(code && code !== 1005 && code !== 1006 ? code : 1000, 'fin'); } catch (e) { /* ya estaba cerrado */ } }
  webSocketError(ws) { try { ws.close(1011, 'error'); } catch (e) { /* ya estaba cerrado */ } }
  broadcastDoc(coll, id, op, data, seq) {
    for (const s of this.conexiones()) {
      const u = this.USERS.get(s.uid);
      if (!u || !u.activo) continue;
      const v = this.viewData(u, effPerms(u), coll, id, data);
      if (v == null) continue;
      this.sse(s, 'doc', { seq, coll, id, op, data: v });
    }
  }
  broadcastPerfiles() {
    const row = this.q1('SELECT data FROM docs WHERE coll=? AND id=?', 'ajustes', 'general');
    this.SEQ++;
    this.broadcastDoc('ajustes', 'general', 'set', row ? JSON.parse(row.data) : {}, this.SEQ);
  }
  pushMe(uid) {
    const u = this.USERS.get(uid);
    for (const s of this.conexiones()) if (s.uid === uid) {
      if (!u || !u.activo) { this.sse(s, 'kick', {}); this.endStream(s); } else this.sse(s, 'me', meOf(u));
    }
  }
  kickDevice(dev) { for (const s of this.conexiones()) if (s.dev === dev) { this.sse(s, 'kick', {}); this.endStream(s); } }
  kickUser(uid) { for (const s of this.conexiones()) if (s.uid === uid) { this.sse(s, 'kick', {}); this.endStream(s); } }
  ensureTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const t = Date.now();
      for (const [k, v] of this.tickets) if (v.exp < t) this.tickets.delete(k);
      for (const [k, f] of this.fails) if (f.until < t - 36e5) this.fails.delete(k);
      this.sql.exec('DELETE FROM fails WHERE t<?', t - 864e5);
      for (const s of [...this.streams]) this.sse(s, 'ping', 1);
      if (!this.streams.size) { clearInterval(this.timer); this.timer = null; }
    }, 20e3);
  }
  /* conexión en vivo por WebSocket «con hibernación»: mientras nadie hace nada el servidor se duerme y no gasta tiempo encendido (el plan gratis tiene un tope diario) */
  openSocket(u, dev) {
    const par = new WebSocketPair(), cli = par[0], srv = par[1];
    this.ctx.acceptWebSocket(srv);
    srv.serializeAttachment({ uid: u.id, dev: dev || null });
    srv.send(JSON.stringify({ e: 'hello', d: { seq: this.SEQ } }));
    return new Response(null, { status: 101, webSocket: cli });
  }
  openStream(u, dev) {
    const self = this;
    let s;
    const body = new ReadableStream({
      start(c) {
        s = { c, uid: u.id, dev: dev || null };
        self.streams.add(s);
        c.enqueue(enc.encode('retry: 3000\n\n'));
        self.sse(s, 'hello', { seq: self.SEQ });
        self.ensureTimer();
      },
      cancel() { self.streams.delete(s); }
    });
    return new Response(body, { status: 200, headers: Object.assign({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' }, CORS) });
  }

  /* ----- copias ----- */
  /* copia completa como texto JSON (los documentos se copian tal cual, sin abrirlos) */
  exportJSON() {
    const docs = this.q('SELECT coll,id,data FROM docs ORDER BY coll,id').map(r => '{"coll":' + JSON.stringify(r.coll) + ',"id":' + JSON.stringify(r.id) + ',"data":' + r.data + '}');
    const users = this.q('SELECT * FROM users').map(r => JSON.stringify({ id: r.id, usuario: r.usuario, nombre: r.nombre, role: r.role, tel: r.tel, permisos: r.permisos ? JSON.parse(r.permisos) : null, activo: r.activo, salt: r.salt, hash: r.hash, created: r.created }));
    /* los contratos firmados (con su firma) y su registro viajan en toda copia; la plantilla también */
    const contratos = this.q('SELECT * FROM contratos ORDER BY num').map(r => JSON.stringify(r));
    const clog = this.q('SELECT * FROM contratos_log ORDER BY ts').map(r => JSON.stringify(r));
    const tpl = this.q1("SELECT v FROM meta WHERE k='contrato_tpl'");
    return '{"app":"yapur-gestion","v":1,"ts":' + Date.now() + ',"docs":[' + docs.join(',') + '],"users":[' + users.join(',') + '],"contratos":[' + contratos.join(',') + '],"contratos_log":[' + clog.join(',') + '],"contrato_tpl":' + (tpl ? tpl.v : 'null') + '}';
  }
  async snapshot(name) {
    const gz = await gzip(this.exportJSON());
    const CH = 1.5e6;
    this.tx(() => {
      this.sql.exec('DELETE FROM snapshots WHERE name=?', name);
      for (let i = 0, n = 0; i < gz.length; i += CH, n++) this.sql.exec('INSERT INTO snapshots(name,part,ts,data) VALUES(?,?,?,?)', name, n, Date.now(), gz.slice(i, i + CH));
    });
    /* se conservan las últimas 14 copias diarias y las últimas 5 «antes de restaurar» */
    const names = this.q('SELECT DISTINCT name FROM snapshots').map(r => r.name);
    const old = [...names.filter(n => /^yapur-\d{4}-\d{2}-\d{2}b?$/.test(n)).sort().slice(0, -28), ...names.filter(n => /^antes-/.test(n)).sort().slice(0, -5)];
    for (const n of old) this.sql.exec('DELETE FROM snapshots WHERE name=?', n);
  }
  /* dos copias por día en segundo plano: la primera con el primer movimiento (el estado con que empezó la jornada)
     y otra, 8 horas después o más, con el siguiente movimiento. Así un error se puede deshacer sin perder un día entero. */
  snapshotSoon() {
    const now = Date.now(), day = ymd(now);
    if (this.snapBusy) return;
    let st = this.snapState;
    if (!st || st.day !== day) {
      const a = this.q1('SELECT MIN(ts) ts FROM snapshots WHERE name=?', 'yapur-' + day);
      const b = this.q1('SELECT 1 x FROM snapshots WHERE name=? LIMIT 1', 'yapur-' + day + 'b');
      st = this.snapState = { day, aTs: a && a.ts ? a.ts : 0, bDone: !!b };
    }
    let name = null;
    if (!st.aTs) name = 'yapur-' + day;
    else if (!st.bDone && now - st.aTs > (Number(this.env.SNAP_B_MS) || 8 * 3600e3)) name = 'yapur-' + day + 'b';
    if (!name) return;
    this.snapBusy = true;
    (async () => {
      try {
        await this.snapshot(name);
        if (name === 'yapur-' + day) st.aTs = Date.now(); else st.bDone = true;
      } catch (e) { console.error('Copia automática falló:', e && e.message); }
      finally { this.snapBusy = false; }
    })();
  }
  listSnapshots() {
    return this.q('SELECT name, MIN(ts) ts, SUM(LENGTH(data)) bytes FROM snapshots GROUP BY name ORDER BY name DESC').map(r => ({ name: r.name, ts: r.ts, bytes: r.bytes }));
  }
  async readSnapshot(name) {
    const parts = this.q('SELECT data FROM snapshots WHERE name=? ORDER BY part', name);
    if (!parts.length) throw httpErr(404, 'No existe esa copia.');
    const total = parts.reduce((n, r) => n + r.data.byteLength, 0), all = new Uint8Array(total);
    let o = 0;
    for (const r of parts) { all.set(new Uint8Array(r.data), o); o += r.data.byteLength; }
    return await gunzip(all);
  }

  /* Los contratos firmados no se pisan ni se borran al restaurar: solo se suman los que faltan (un contrato nunca se modifica una vez firmado,
     y los que se firmaron después de la copia tienen que quedar). Lo mismo con su registro y con la plantilla, que solo se repone si no hay ninguna. */
  restoreContratos(body) {
    const t = v => (typeof v === 'string' ? v : '');
    for (const r of Array.isArray(body.contratos) ? body.contratos : []) {
      if (!isPlain(r) || !/^k[0-9a-f]{16}$/.test(t(r.id)) || !Number.isInteger(r.num) || !ID_RE.test(t(r.cid)) || !CONTRATO_ESTADOS.includes(r.estado) || !Object.prototype.hasOwnProperty.call(CONTRATO_MOTIVOS, r.motivo)) continue;
      if (!t(r.titular) || !t(r.equipos) || !t(r.texto) || !pngOk(r.firma) || !t(r.hash) || !Number.isFinite(r.ts)) continue;
      this.sql.exec('INSERT OR IGNORE INTO contratos(id,num,cid,estado,motivo,prev,prueba,tver,titular,equipos,eq,texto,firma,aclar,ts,por,pornombre,ip,ua,hash,estado_prev) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        r.id, r.num, r.cid, r.estado, r.motivo, r.prev ? t(r.prev) : null, r.prueba ? 1 : 0, Number.isInteger(r.tver) ? r.tver : null, r.titular, r.equipos, t(r.eq), r.texto, r.firma, t(r.aclar), r.ts, r.por ? t(r.por) : null, t(r.pornombre), t(r.ip), t(r.ua), r.hash, r.estado_prev ? t(r.estado_prev) : null);
    }
    for (const l of Array.isArray(body.contratos_log) ? body.contratos_log : []) {
      if (!isPlain(l) || !/^l[0-9a-f]{16}$/.test(t(l.id)) || !/^k[0-9a-f]{16}$/.test(t(l.cto)) || !Number.isFinite(l.ts) || !t(l.acc)) continue;
      this.sql.exec('INSERT OR IGNORE INTO contratos_log(id,cto,ts,uid,uname,acc,det) VALUES(?,?,?,?,?,?,?)', l.id, l.cto, l.ts, l.uid ? t(l.uid) : null, t(l.uname).slice(0, 60), t(l.acc).slice(0, 30), l.det ? t(l.det).slice(0, 300) : null);
    }
    if (isPlain(body.contrato_tpl) && typeof body.contrato_tpl.texto === 'string' && !this.q1("SELECT 1 x FROM meta WHERE k='contrato_tpl'")) this.sql.exec("INSERT INTO meta(k,v) VALUES('contrato_tpl',?)", JSON.stringify(body.contrato_tpl));
  }
  /* restaura una copia de este servidor o la exportada desde la versión anterior (artefacto de Claude) */
  async restore(body) {
    if (!body || !Array.isArray(body.docs)) throw httpErr(400, 'El archivo no es una copia válida.');
    const docs = body.docs.filter(d => d && COLS.has(d.coll) && ID_RE.test(String(d.id)) && isPlain(d.data));
    const newUsers = [], report = [];
    const usedNames = new Set([...this.USERS.values()].filter(u => u.role === 'admin').map(u => u.usuario));
    if (Array.isArray(body.users) && body.users.length) {
      for (const u of body.users) {
        if (!u || !ROLES.includes(u.role) || !USER_RE.test(String(u.usuario || ''))) continue;
        newUsers.push({ id: String(u.id), usuario: String(u.usuario), nombre: String(u.nombre || u.usuario), role: u.role, tel: String(u.tel || ''), permisos: isPlain(u.permisos) ? u.permisos : null, activo: u.activo === 0 || u.activo === false ? 0 : 1, salt: u.salt || null, hash: u.hash || null, created: u.created || Date.now() });
        usedNames.add(String(u.usuario));
      }
    }
    /* perfiles de la versión anterior → usuarios nuevos con clave provisoria */
    const aj = docs.find(d => d.coll === 'ajustes' && d.id === 'general');
    if (aj && Array.isArray(aj.data.perfiles)) {
      for (const pf of aj.data.perfiles) {
        if (!pf || !pf.id || !pf.nombre || !['oficina', 'tecnico'].includes(pf.base)) continue;
        if (newUsers.some(u => u.id === pf.id)) continue;
        let name = slug(pf.nombre), n = 1;
        while (usedNames.has(name)) name = slug(pf.nombre) + (++n);
        usedNames.add(name);
        const clave = tempPw(), pw = await makePw(clave);
        newUsers.push({ id: String(pf.id).replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 40) || newId(), usuario: name, nombre: String(pf.nombre), role: pf.base, tel: String(pf.tel || ''), permisos: isPlain(pf.permisos) ? pf.permisos : null, activo: pf.activo === false ? 0 : 1, salt: pw.salt, hash: pw.hash, created: Date.now() });
        report.push({ usuario: name, nombre: pf.nombre, rol: pf.base, clave });
      }
      delete aj.data.perfiles;
    }
    for (const d of docs) if (d.coll === 'ajustes' && d.id === 'general') delete d.data.perfiles;
    const rows = docs.map(d => ({ coll: d.coll, id: String(d.id), s: JSON.stringify(d.data) }));
    for (const r of rows) if (r.s.length > 6e5 && bytesOf(r.s) > 1.9e6) throw httpErr(413, 'Un registro de la copia (' + r.coll + '/' + r.id + ') es demasiado grande.', 'quota_exceeded');
    await this.snapshot('antes-de-restaurar-' + Date.now());
    this.tx(() => {
      this.sql.exec('DELETE FROM docs');
      for (const r of rows) this.putDoc(r.coll, r.id, r.s);
      /* se conservan las cuentas de administrador actuales si la copia no trae ninguna */
      const hasAdmin = newUsers.some(u => u.role === 'admin' && u.activo && u.hash);
      const keep = hasAdmin ? [] : [...this.USERS.values()].filter(u => u.role === 'admin');
      this.sql.exec('DELETE FROM users');
      this.sql.exec('DELETE FROM sessions');
      for (const u of [...keep, ...newUsers.filter(u => !keep.some(k => k.usuario === u.usuario))]) this.insUser(Object.assign({}, u, { last_login: null }));
      this.sql.exec('DELETE FROM devices WHERE uid NOT IN (SELECT id FROM users)');   // los equipos aprobados de quienes siguen existiendo se conservan
      this.restoreContratos(body);
      this.SEQ++;
    });
    this.loadUsers();
    for (const s of this.conexiones()) { this.sse(s, 'kick', {}); this.endStream(s); }
    return { docs: rows.length, usuarios: report };
  }

  /* ================= comodato: contratos firmados =================
     Cada contrato queda guardado de forma permanente en su propia tabla (no en los datos comunes): el texto tal como se firmó, los datos del titular,
     los equipos, la firma dibujada, quién la tomó, desde qué equipo y cuándo, y un código de verificación (SHA-256) que permite saber si algo se tocó.
     Nada se borra de verdad: «borrar» manda a la papelera (se puede restaurar) y todo cambio queda en un registro. */
  contratoTpl() {
    const r = this.q1("SELECT v FROM meta WHERE k='contrato_tpl'");
    let t = null; try { t = r ? JSON.parse(r.v) : null; } catch (e) { t = null; }
    if (!isPlain(t)) t = { texto: CONTRATO_TXT_DEF, ver: 1, final: false };
    const aj = this.readDoc('ajustes', 'general') || {};
    t.empresa = Object.assign({ razon: lim(aj.empresa || 'YAPUR.NET', 100), cuit: '', domicilio: '', rep: '', lugar: 'Añatuya, Santiago del Estero' }, isPlain(t.empresa) ? t.empresa : {});
    return t;
  }
  contratoPlantillaVer(u) {
    if (!effPerms(u).comodato) throw httpErr(403, 'Tu usuario no puede ver los contratos de comodato.', 'permission_denied');
    const t = this.contratoTpl();
    return { texto: t.texto, ver: t.ver, final: !!t.final, empresa: t.empresa, vars: CONTRATO_VARS, mod: t.mod || null, modPor: t.modPor || '' };
  }
  contratoPlantillaGuardar(u, b) {
    if (!isPlain(b)) throw httpErr(400, 'Datos inválidos.');
    const texto = String(b.texto == null ? '' : b.texto).replace(/\r\n?/g, '\n').trim();
    if (texto.length < 200 || texto.length > 20000) throw httpErr(400, 'El contrato tiene que tener entre 200 y 20.000 letras.');
    const mal = new Set();
    for (const m of texto.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)) if (!CONTRATO_VARS.includes(m[1])) mal.add(m[1]);
    if (mal.size) throw httpErr(400, 'El contrato usa datos que no existen: ' + [...mal].map(x => '{{' + x + '}}').join(', ') + '.');
    for (const k of ['equipos', 'titular', 'dni']) if (!new RegExp('\\{\\{\\s*' + k + '\\s*\\}\\}').test(texto)) throw httpErr(400, 'El contrato tiene que incluir {{' + k + '}}.');
    const e = isPlain(b.empresa) ? b.empresa : {};
    const empresa = { razon: lim(e.razon, 100), cuit: lim(e.cuit, 30), domicilio: lim(e.domicilio, 150), rep: lim(e.rep, 120), lugar: lim(e.lugar, 80) || 'Añatuya, Santiago del Estero' };
    const final = b.final === true;
    if (final) {
      if (/BORRADOR|\[COMPLETAR/i.test(texto)) throw httpErr(400, 'Todavía dice «BORRADOR» o tiene partes «[COMPLETAR…]». Corregilo antes de marcarlo como definitivo.');
      for (const [k, n] of [['razon', 'el nombre o razón social'], ['cuit', 'el CUIT'], ['domicilio', 'el domicilio'], ['rep', 'quién representa a la empresa']]) if (!empresa[k]) throw httpErr(400, 'Para marcarlo como definitivo completá ' + n + ' de la empresa.');
    }
    const old = this.contratoTpl();
    if (old.texto === texto && !!old.final === final && same(old.empresa, empresa)) return this.contratoPlantillaVer(u);
    const t = { texto, ver: (Number(old.ver) || 0) + 1, final, empresa, mod: Date.now(), modPor: String(u.nombre || u.usuario || '').slice(0, 60) };
    this.sql.exec("INSERT OR REPLACE INTO meta(k,v) VALUES('contrato_tpl',?)", JSON.stringify(t));
    return this.contratoPlantillaVer(u);
  }
  contratoLog(cto, u, acc, det) {
    this.sql.exec('INSERT INTO contratos_log(id,cto,ts,uid,uname,acc,det) VALUES(?,?,?,?,?,?,?)', 'l' + hex(rnd(8)), cto, Date.now(), u ? u.id : null, u ? String(u.nombre || u.usuario || '').slice(0, 60) : '', acc, det ? String(det).slice(0, 300) : null);
  }
  contratoResumen(r, gest) {
    const o = { id: r.id, num: r.num, cid: r.cid, estado: r.estado, motivo: r.motivo, prev: r.prev || null, prueba: !!r.prueba, ts: r.ts, por: r.pornombre || '' };
    if (r.estado === 'vigente' || r.estado === 'revision') o.eq = r.eq;
    if (gest) { try { o.tit = JSON.parse(r.titular).nombre; } catch (e) { o.tit = ''; } }
    return o;
  }
  contratoPermiso(u, gest) {
    const p = effPerms(u);
    if (!p.comodato) throw httpErr(403, 'Tu usuario no puede ver los contratos de comodato.', 'permission_denied');
    if (gest && !p.contratosGestion) throw httpErr(403, 'Esto lo hace la oficina o el administrador.', 'permission_denied');
    return p;
  }
  contratoLista(u, url) {
    const p = this.contratoPermiso(u, false), gest = !!p.contratosGestion;
    const cid = url.searchParams.get('cid');
    if (url.searchParams.get('papelera')) {
      this.contratoPermiso(u, true);
      return { contratos: this.q("SELECT id,num,cid,estado,motivo,prev,prueba,ts,pornombre,eq,titular FROM contratos WHERE estado='borrado' ORDER BY num DESC").map(r => this.contratoResumen(r, true)) };
    }
    const rows = cid && ID_RE.test(cid)
      ? this.q("SELECT id,num,cid,estado,motivo,prev,prueba,ts,pornombre,eq,titular FROM contratos WHERE cid=? AND estado<>'borrado' ORDER BY num", cid)
      : this.q("SELECT id,num,cid,estado,motivo,prev,prueba,ts,pornombre,eq,titular FROM contratos WHERE estado<>'borrado' ORDER BY num");
    return { contratos: rows.map(r => this.contratoResumen(r, gest)) };
  }
  /* avisa en vivo a las pantallas abiertas de quien puede ver contratos */
  broadcastContrato(id) {
    const r = this.q1('SELECT id,num,cid,estado,motivo,prev,prueba,ts,pornombre,eq,titular FROM contratos WHERE id=?', id);
    if (!r) return;
    for (const s of this.conexiones()) {
      const u = this.USERS.get(s.uid);
      if (!u || !u.activo) continue;
      const p = effPerms(u);
      if (!p.comodato) continue;
      const gest = !!p.contratosGestion;
      this.sse(s, 'contrato', r.estado === 'borrado' && !gest ? { id: r.id, cid: r.cid, estado: 'borrado' } : this.contratoResumen(r, gest));
    }
  }
  contratoTitular(t) {
    if (!isPlain(t)) throw httpErr(400, 'Faltan los datos del titular.');
    const nombre = lim(t.nombre, 80), d = String(t.dni || '').replace(/\D/g, ''), dir = lim(t.dir, 120), loc = lim(t.loc, 60), tel = lim(t.tel, 30);
    if (nombre.length < 3) throw httpErr(400, 'Falta el nombre completo del titular.');
    if (d.length < 7 || d.length > 11) throw httpErr(400, 'El DNI o CUIT del titular no es válido.');
    if (dir.length < 3) throw httpErr(400, 'Falta el domicilio del titular.');
    return { nombre, dni: d, dniTxt: fmtDocAR(d), dir, loc, tel };
  }
  /* controles comunes de la vista previa y de la firma */
  contratoPreparar(u, b) {
    const p = this.contratoPermiso(u, false);
    if (!isPlain(b)) throw httpErr(400, 'Datos inválidos.');
    const cid = String(b.cid || '');
    if (!ID_RE.test(cid)) throw httpErr(400, 'Falta el cliente.');
    const c = this.clienteDe(cid);
    if (!c) throw httpErr(404, 'No existe ese cliente.');
    const motivo = Object.prototype.hasOwnProperty.call(CONTRATO_MOTIVOS, b.motivo) ? b.motivo : '';
    if (!motivo) throw httpErr(400, 'Falta el motivo del contrato.');
    const equipos = comodatoLimpio(c.comodato);
    if (!equipos.length) throw httpErr(400, 'Cargá primero los equipos en comodato de este cliente.');
    const tpl = this.contratoTpl();
    if (!tpl.final && u.role !== 'admin') throw httpErr(409, 'Todavía no está cargado el texto definitivo del contrato. Avisale al administrador.', 'failed_precondition');
    const titular = this.contratoTitular(b.titular);
    const vivos = this.q("SELECT id,estado FROM contratos WHERE cid=? AND estado IN ('vigente','revision')", cid);
    const vig = vivos.find(r => r.estado === 'vigente'), rev = vivos.find(r => r.estado === 'revision');
    if (motivo === 'alta') {
      if (vig || rev) throw httpErr(409, 'Este cliente ya tiene un contrato' + (vig ? '' : ' esperando revisión') + '. Para cambiar al titular o los equipos usá «Cambio de titularidad» o «Cambio de equipos».', 'failed_precondition');
    } else {
      if (!vig) throw httpErr(409, 'Este cliente todavía no tiene un contrato vigente: primero hay que firmar el de alta.', 'failed_precondition');
      if (rev) throw httpErr(409, 'Ya hay un contrato nuevo de este cliente esperando la revisión de la oficina.', 'failed_precondition');
    }
    return { p, cid, c, motivo, equipos, eq: eqSig(equipos), tpl, titular, prev: vig ? vig.id : null };
  }
  contratoVista(u, b) {
    const x = this.contratoPreparar(u, b);
    const texto = renderContrato(x.tpl, { ts: Date.now(), num: 0, titular: x.titular, equipos: x.equipos, codigo: x.c.codigo });
    return { texto, tver: x.tpl.ver, eq: x.eq, final: !!x.tpl.final, prueba: !x.tpl.final, equipos: x.equipos, titular: x.titular, motivo: x.motivo };
  }
  contratoHash(c) { return sha(JSON.stringify(['yapur-comodato-v1', c.id, c.num, c.cid, c.motivo, c.prev || '', c.ts, c.texto, c.titular, c.equipos, c.eq, c.firmaSha, c.aclar])); }
  async contratoFirmar(u, b, request) {
    this.contratoPreparar(u, b);
    if (b.acepto !== true) throw httpErr(400, 'Falta confirmar que el titular leyó y acepta el contrato.');
    const aclar = lim(b.aclar, 80);
    if (aclar.length < 3) throw httpErr(400, 'Falta la aclaración: el nombre de quien firma.');
    if (!pngOk(b.firma)) throw httpErr(400, 'La firma no es válida. Pedile que firme de nuevo.');
    const firmaSha = await sha(b.firma), id = 'k' + hex(rnd(8)), ip = (request.headers.get('cf-connecting-ip') || '').slice(0, 60), ua = (request.headers.get('user-agent') || '').slice(0, 300);
    for (let intento = 0; intento < 5; intento++) {
      const x = this.contratoPreparar(u, b);
      if (Number(b.tver) !== x.tpl.ver || String(b.eq) !== x.eq) throw httpErr(409, 'El texto del contrato o los equipos cambiaron mientras se firmaba. Volvé a abrir el contrato para leer la versión actual.', 'failed_precondition');
      const num = this.q1('SELECT COALESCE(MAX(num),0)+1 n FROM contratos').n, ts = Date.now();
      const texto = renderContrato(x.tpl, { ts, num, titular: x.titular, equipos: x.equipos, codigo: x.c.codigo });
      const titularS = JSON.stringify(x.titular), equiposS = JSON.stringify(x.equipos);
      const hash = await this.contratoHash({ id, num, cid: x.cid, motivo: x.motivo, prev: x.prev, ts, texto, titular: titularS, equipos: equiposS, eq: x.eq, firmaSha, aclar });
      let hecho = false;
      this.tx(() => {
        const y = this.contratoPreparar(u, b);   // pudo cambiar algo mientras se calculaba el código
        if (y.eq !== x.eq || y.tpl.ver !== x.tpl.ver || y.prev !== x.prev || this.q1('SELECT COALESCE(MAX(num),0)+1 n FROM contratos').n !== num) return;
        this.sql.exec('INSERT INTO contratos(id,num,cid,estado,motivo,prev,prueba,tver,titular,equipos,eq,texto,firma,aclar,ts,por,pornombre,ip,ua,hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          id, num, x.cid, x.motivo === 'alta' ? 'vigente' : 'revision', x.motivo, x.prev, x.tpl.final ? 0 : 1, x.tpl.ver, titularS, equiposS, x.eq, texto, b.firma, aclar, ts, u.id, String(u.nombre || u.usuario || '').slice(0, 60), ip, ua, hash);
        this.contratoLog(id, u, 'firmado', CONTRATO_MOTIVOS[x.motivo] + (x.tpl.final ? '' : ' (de prueba)'));
        hecho = true;
      });
      if (hecho) { this.broadcastContrato(id); return { contrato: this.contratoDetalle(u, id) }; }
    }
    throw httpErr(409, 'Se firmaron varios contratos a la vez. Probá de nuevo.', 'failed_precondition');
  }
  contratoDetalle(u, id) {
    const p = this.contratoPermiso(u, false), gest = !!p.contratosGestion;
    const r = this.q1('SELECT * FROM contratos WHERE id=?', id);
    if (!r || (r.estado === 'borrado' && !gest)) throw httpErr(404, 'No existe ese contrato.', 'not_found');
    const tit = JSON.parse(r.titular);
    let texto = r.texto;
    if (!p.dni && !gest) { texto = tit.dniTxt ? texto.split(tit.dniTxt).join('••••••••') : texto; tit.dni = tit.dniTxt = '••••••••'; }
    const o = Object.assign(this.contratoResumen(r, gest), { texto, titular: tit, equipos: JSON.parse(r.equipos), aclar: r.aclar || '', firma: r.firma, hash: r.hash, tver: r.tver });
    if (gest) {
      o.ip = r.ip || ''; o.ua = r.ua || ''; o.estadoPrev = r.estado_prev || null;
      o.log = this.q('SELECT ts,uname,acc,det FROM contratos_log WHERE cto=? ORDER BY ts,rowid', id);
    }
    if (r.prev) { const pv = this.q1('SELECT id,num,cid,estado,motivo,prev,prueba,ts,pornombre,eq,titular FROM contratos WHERE id=?', r.prev); if (pv) o.prevResumen = this.contratoResumen(pv, gest); }
    return o;
  }
  async contratoVerificar(u, id) {
    this.contratoPermiso(u, true);
    const r = this.q1('SELECT * FROM contratos WHERE id=?', id);
    if (!r) throw httpErr(404, 'No existe ese contrato.', 'not_found');
    const h = await this.contratoHash({ id: r.id, num: r.num, cid: r.cid, motivo: r.motivo, prev: r.prev, ts: r.ts, texto: r.texto, titular: r.titular, equipos: r.equipos, eq: r.eq, firmaSha: await sha(r.firma), aclar: r.aclar || '' });
    const ok = safeEq(h, r.hash);
    this.contratoLog(id, u, 'verificado', ok ? 'Íntegro' : 'ALTERADO');
    return { ok };
  }
  contratoAccion(u, id, accion, b) {
    this.contratoPermiso(u, true);
    const motivo = lim(isPlain(b) ? b.motivo : '', 200);
    let res;
    this.tx(() => {
      const r = this.q1('SELECT * FROM contratos WHERE id=?', id);
      if (!r) throw httpErr(404, 'No existe ese contrato.', 'not_found');
      const cambiar = (rid, estado, extra) => this.sql.exec('UPDATE contratos SET estado=?, estado_prev=? WHERE id=?', estado, extra === undefined ? null : extra, rid);
      if (accion === 'aprobar') {
        if (r.estado !== 'revision') throw httpErr(409, 'Este contrato no está esperando revisión.', 'failed_precondition');
        for (const o of this.q("SELECT id FROM contratos WHERE cid=? AND estado='vigente' AND id<>?", r.cid, id)) { cambiar(o.id, 'archivado'); this.contratoLog(o.id, u, 'archivado', 'Lo reemplaza el contrato N° ' + String(r.num).padStart(4, '0')); }
        cambiar(id, 'vigente');
        this.contratoLog(id, u, 'aprobado', motivo || null);
      } else if (accion === 'rechazar') {
        if (r.estado !== 'revision') throw httpErr(409, 'Este contrato no está esperando revisión.', 'failed_precondition');
        if (motivo.length < 3) throw httpErr(400, 'Escribí el motivo del rechazo.');
        cambiar(id, 'rechazado');
        this.contratoLog(id, u, 'rechazado', motivo);
      } else if (accion === 'borrar') {
        if (r.estado === 'borrado') throw httpErr(409, 'Este contrato ya está en la papelera.', 'failed_precondition');
        if (motivo.length < 3) throw httpErr(400, 'Escribí el motivo por el que se borra.');
        cambiar(id, 'borrado', r.estado);
        this.contratoLog(id, u, 'borrado', motivo + ' (estaba ' + r.estado + ')');
      } else if (accion === 'restaurar') {
        if (r.estado !== 'borrado') throw httpErr(409, 'Este contrato no está en la papelera.', 'failed_precondition');
        let vuelve = CONTRATO_ESTADOS.includes(r.estado_prev) && r.estado_prev !== 'borrado' ? r.estado_prev : 'archivado';
        if (vuelve === 'vigente' && this.q1("SELECT 1 x FROM contratos WHERE cid=? AND estado='vigente' AND id<>?", r.cid, id)) vuelve = 'archivado';
        if (vuelve === 'revision' && this.q1("SELECT 1 x FROM contratos WHERE cid=? AND estado='revision' AND id<>?", r.cid, id)) vuelve = 'archivado';
        cambiar(id, vuelve);
        this.contratoLog(id, u, 'restaurado', 'Vuelve como «' + vuelve + '»');
      } else throw httpErr(400, 'Acción inválida.');
      res = r.cid;
    });
    this.broadcastContrato(id);
    for (const o of this.q('SELECT id FROM contratos WHERE cid=? AND id<>?', res, id)) this.broadcastContrato(o.id);
    return { contrato: this.contratoDetalle(u, id) };
  }

  /* ================= routers MikroTik (solo lectura) =================
     El sistema NO se conecta a los routers ni guarda usuario ni clave de ninguno: cada router manda por su cuenta,
     con un script de solo lectura, la lista de sus colas, secretos PPPoE y leases DHCP estáticos. Con este token
     lo único que se puede hacer es dejar esa lista acá: no hay ningún camino para cortar o cambiar algo en un router. */
  routerPublic(r) {
    return { id: r.id, nombre: r.nombre, kinds: String(r.kinds || 'q').split(',').filter(Boolean), creado: r.creado, visto: r.visto || null, total: r.total || 0, ident: r.ident || '', ros: r.ros || '', hayDatos: !!r.run, ping: !!r.pth, pingVisto: r.pvisto || null };
  }
  routerList() { return this.q('SELECT * FROM routers ORDER BY nombre COLLATE NOCASE').map(r => this.routerPublic(r)); }
  routerKinds(v) {
    const k = (Array.isArray(v) ? v : String(v || 'q').split(',')).map(x => String(x).trim()).filter(x => RT_KINDS.includes(x));
    return [...new Set(k)].sort().join(',') || 'q';
  }
  async routerNewToken(id) {
    const secret = b64u(rnd(24));
    this.sql.exec('UPDATE routers SET th=? WHERE id=?', await sha(secret), id);
    return id + '.' + secret;
  }
  async routerCreate(b) {
    const nombre = String(b.nombre || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!nombre) throw httpErr(400, 'Falta el nombre del router (por ejemplo ADMIN02).');
    if (this.q1('SELECT id FROM routers WHERE nombre=? COLLATE NOCASE', nombre)) throw httpErr(409, 'Ya hay un router con ese nombre.');
    if (this.q1('SELECT COUNT(*) c FROM routers').c >= 30) throw httpErr(400, 'Son demasiados routers (máximo 30).');
    const id = 'r' + hex(rnd(5));
    this.sql.exec('INSERT INTO routers(id,nombre,th,kinds,creado,total) VALUES(?,?,?,?,?,0)', id, nombre, '-', this.routerKinds(b.kinds), Date.now());
    const token = await this.routerNewToken(id);
    return { router: this.routerPublic(this.q1('SELECT * FROM routers WHERE id=?', id)), token };
  }
  routerItems(id) {
    const r = this.q1('SELECT * FROM routers WHERE id=?', id);
    if (!r) throw httpErr(404, 'No existe ese router.');
    const lines = [];
    if (r.run) for (const c of this.q('SELECT data FROM rsnap WHERE router=? AND run=? ORDER BY part', id, r.run))
      for (const ln of c.data.split('\n')) { if (!ln || ln[0] === '#') continue; lines.push(ln.split('\t')); }
    return { router: this.routerPublic(r), lines };
  }
  /* limpia y valida lo que manda el router; devuelve el texto aceptado y cuántos registros trae */
  routerClean(raw) {
    const out = []; let n = 0, bad = 0;
    for (let ln of String(raw).replace(/\r/g, '').split('\n')) {
      ln = ln.replace(/[^\t\x20-\x7e -￿]/g, '');
      if (!ln) continue;
      const f = ln.split('\t'), t = f[0], want = RT_FIELDS[t];
      if (t === '#') { out.push(f.slice(0, 3).map(x => x.slice(0, 80)).join('\t')); continue; }
      if (!want || f.length < want.min) { bad++; continue; }
      while (f.length < want.n) f.push('');
      out.push(f.slice(0, want.n).map(x => x.trim().slice(0, 120)).join('\t')); n++;
    }
    return { text: out.join('\n'), n, bad };
  }
  async routerIngest(request, url, raw) {
    const ip = this.clientIp(request), key = 'rtr|' + ip;
    if (this.locked(key)) throw httpErr(429, 'Demasiados intentos. Esperá un momento.', 'resource_exhausted');
    const tk = String((request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')).trim(), i = tk.indexOf('.');
    const r = i > 0 ? this.q1('SELECT * FROM routers WHERE id=?', tk.slice(0, i)) : null;
    if (!r || !safeEq(await sha(tk.slice(i + 1)), r.th)) { this.addFail(key, 8); throw httpErr(401, 'Token de router inválido.', 'unauthenticated'); }
    this.clearFail(key);
    if (raw.length > 12000) throw httpErr(413, 'La tanda es demasiado grande.', 'quota_exceeded');
    const run = String(url.searchParams.get('run') || ''), part = parseInt(url.searchParams.get('part') || '', 10), fin = url.searchParams.get('fin') === '1';
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(run) || !(part >= 1 && part <= 1000)) throw httpErr(400, 'Faltan datos de la tanda (run, part).');
    const c = this.routerClean(raw);
    this.tx(() => {
      if (part === 1) this.sql.exec('DELETE FROM rsnap WHERE router=? AND run<>? AND run<>?', r.id, run, r.run || '');   // descarta corridas que quedaron a medias
      this.sql.exec('INSERT OR REPLACE INTO rsnap(router,run,part,data,ts) VALUES(?,?,?,?,?)', r.id, run, part, c.text, Date.now());
    });
    if (!fin) return { ok: true, part, registros: c.n, ignorados: c.bad };
    this.sql.exec('DELETE FROM rsnap WHERE router=? AND run=? AND part>?', r.id, run, part);   // la última tanda es la que cierra: nada más allá de ella
    const have = this.q1('SELECT COUNT(*) c FROM rsnap WHERE router=? AND run=?', r.id, run).c;
    if (have !== part) throw httpErr(409, 'Faltan tandas (llegaron ' + have + ' de ' + part + '). Se conserva la lista anterior.');
    let total = 0, ident = '', ros = '';
    for (const row of this.q('SELECT data FROM rsnap WHERE router=? AND run=? ORDER BY part', r.id, run))
      for (const ln of row.data.split('\n')) { if (!ln) continue; if (ln[0] === '#') { const f = ln.split('\t'); if (f[1] && f[1] !== 'fin' && !ident) { ident = f[1]; ros = f[2] || ''; } } else total++; }
    this.tx(() => {
      this.sql.exec('UPDATE routers SET run=?, visto=?, total=?, ident=?, ros=?, ip=? WHERE id=?', run, Date.now(), total, ident, ros, ip, r.id);
      this.sql.exec('DELETE FROM rsnap WHERE router=? AND run<>?', r.id, run);
    });
    return { ok: true, part, registros: c.n, total, ignorados: c.bad };
  }

  /* ----- pruebas de conexión (ping) -----
     El sistema no entra a los routers: la oficina o el técnico pide la prueba, un router (que viene consultando con su propio token de ping) la toma,
     hace el ping a la IP del cliente desde la red de la empresa y manda solo el resultado. Solo se prueban IPs de clientes cargados. */
  async routerPingToken(id) {
    const secret = b64u(rnd(24));
    this.sql.exec('UPDATE routers SET pth=?, pvisto=NULL WHERE id=?', await sha(secret), id);
    return id + '.' + secret;
  }
  async routerPingAuth(request) {
    const ip = this.clientIp(request), key = 'rtr|' + ip;
    if (this.locked(key)) throw httpErr(429, 'Demasiados intentos. Esperá un momento.', 'resource_exhausted');
    const tk = String((request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')).trim(), i = tk.indexOf('.');
    const r = i > 0 ? this.q1('SELECT * FROM routers WHERE id=?', tk.slice(0, i)) : null;
    if (!r || !r.pth || !safeEq(await sha(tk.slice(i + 1)), r.pth)) { this.addFail(key, 8); throw httpErr(401, 'Token de router inválido.', 'unauthenticated'); }
    this.clearFail(key);
    return r;
  }
  /* una sola IPv4 válida (con o sin /32) de lo que está cargado en la ficha */
  ipUna(t) {
    const m = String(t == null ? '' : t).trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/32)?$/);
    if (!m || m.slice(1).some(x => Number(x) > 255)) return '';
    const ip = m.slice(1).map(Number).join('.');
    return ip === '0.0.0.0' || ip.startsWith('127.') ? '' : ip;
  }
  pingRouters() { return this.q('SELECT id,nombre,pvisto FROM routers WHERE pth IS NOT NULL'); }
  /* el router que corresponde al cliente: el de su «nodo» si ese router hace pruebas; si no, cualquiera que esté consultando */
  pingRouterDe(nodo) {
    const vivo = r => r.pvisto && Date.now() - r.pvisto < 90e3, k = String(nodo || '').trim().toLowerCase(), todos = this.pingRouters();
    const suyo = k ? todos.find(r => r.nombre.toLowerCase() === k) : null;
    if (suyo) return { suyo, ok: vivo(suyo) };
    const alguno = todos.find(vivo);
    return { suyo: null, ok: !!alguno, hay: todos.length > 0 };
  }
  pingView(r) {
    const hecho = r.estado === 'hecho';
    return { id: r.id, cid: r.cid, ip: r.ip, estado: r.estado, ts: r.ts, hecho: r.hecho || null, sent: hecho ? r.sent : null, rec: hecho ? r.rec : null, avg: hecho && r.avg != null ? r.avg : null, router: r.router ? ((this.q1('SELECT nombre FROM routers WHERE id=?', r.router) || {}).nombre || '') : '' };
  }
  /* pasa a «vencido» lo que nadie atendió a tiempo */
  pingVencer() {
    const t = Date.now(), ve = Number(this.env.PING_VENCE_MS) || 45e3;
    this.sql.exec("UPDATE pings SET estado='vencido', hecho=? WHERE (estado='pend' AND ts<?) OR (estado='toma' AND tomado<?)", t, t - ve, t - ve);
  }
  pingPedir(u, b) {
    if (!effPerms(u).ping) throw httpErr(403, 'No tenés permiso para probar la conexión de los clientes.', 'permission_denied');
    const cid = String(isPlain(b) ? b.cid : '');
    if (!ID_RE.test(cid)) throw httpErr(400, 'Falta el cliente.');
    const c = this.clienteDe(cid);
    if (!c) throw httpErr(404, 'No existe ese cliente.');
    const ip = this.ipUna(c.ip);
    if (!ip) throw httpErr(400, 'Este cliente no tiene una IP cargada en su ficha (o tiene más de una). Cargala para poder probarlo.');
    this.pingVencer();
    const ya = this.q1("SELECT * FROM pings WHERE cid=? AND estado IN ('pend','toma') AND ts>?", cid, Date.now() - 30e3);
    if (ya) return this.pingView(ya);
    if (this.q1('SELECT COUNT(*) n FROM pings WHERE uid=? AND ts>?', u.id, Date.now() - 60e3).n >= 12) throw httpErr(429, 'Hiciste muchas pruebas seguidas. Esperá un momento.', 'resource_exhausted');
    const rr = this.pingRouterDe(c.nodo);
    if (!rr.ok) {
      if (rr.suyo) throw httpErr(409, 'El router de este cliente (' + rr.suyo.nombre + ') no está atendiendo las pruebas ahora. Avisale al administrador.', 'failed_precondition');
      throw httpErr(409, rr.hay ? 'Ningún router está atendiendo las pruebas ahora. Avisale al administrador.' : 'Todavía no hay un router configurado para hacer pruebas de conexión.', 'failed_precondition');
    }
    const id = 'g' + hex(rnd(7));
    this.sql.exec("INSERT INTO pings(id,cid,ip,nodo,uid,ts,estado) VALUES(?,?,?,?,?,?,'pend')", id, cid, ip, String(c.nodo || '').slice(0, 40), u.id, Date.now());
    return this.pingView(this.q1('SELECT * FROM pings WHERE id=?', id));
  }
  pingVer(u, id) {
    if (!effPerms(u).ping) throw httpErr(403, 'No tenés permiso para probar la conexión de los clientes.', 'permission_denied');
    this.pingVencer();
    const r = this.q1('SELECT * FROM pings WHERE id=?', id);
    if (!r || (r.uid !== u.id && u.role !== 'admin')) throw httpErr(404, 'No existe esa prueba.');
    return this.pingView(r);
  }
  /* el router consulta: devuelve «id:ip,id:ip» (texto simple, fácil de leer en RouterOS) y deja marcado que las tomó */
  async routerPingPoll(request) {
    const r = await this.routerPingAuth(request);
    this.sql.exec('UPDATE routers SET pvisto=? WHERE id=?', Date.now(), r.id);
    this.pingVencer();
    const mine = r.nombre.toLowerCase(), nombres = new Set(this.pingRouters().map(x => x.nombre.toLowerCase()));
    const out = [];
    for (const p of this.q("SELECT id,ip,nodo FROM pings WHERE estado='pend' ORDER BY ts LIMIT 20")) {
      const n = String(p.nodo || '').trim().toLowerCase();
      if (n && nombres.has(n) && n !== mine) continue;   // es de otro router que también hace pruebas
      this.sql.exec("UPDATE pings SET estado='toma', router=?, tomado=? WHERE id=? AND estado='pend'", r.id, Date.now(), p.id);
      out.push(p.id + ':' + p.ip);
      if (out.length >= 5) break;
    }
    return out.join(',');
  }
  /* «3ms», «3ms383us», «00:00:00.003» o «3» → milisegundos */
  pingMs(v) {
    const t = String(v == null ? '' : v).trim();
    if (!t) return null;
    let m = t.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
    if (m) return Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1e4) / 10;
    if (/^\d+(?:\.\d+)?$/.test(t)) return Number(t);
    let ms = 0, any = false; const re = /(\d+(?:\.\d+)?)(ms|us|s)/g;
    while ((m = re.exec(t))) { any = true; ms += Number(m[1]) * (m[2] === 's' ? 1000 : m[2] === 'us' ? 0.001 : 1); }
    return any ? Math.round(ms * 10) / 10 : null;
  }
  async routerPingResult(request, url) {
    const r = await this.routerPingAuth(request);
    const id = String(url.searchParams.get('id') || ''), sent = parseInt(url.searchParams.get('sent') || '', 10), rec = parseInt(url.searchParams.get('rec') || '', 10);
    if (!/^g[0-9a-f]{14}$/.test(id) || !(sent >= 1 && sent <= 10) || !(rec >= 0 && rec <= sent)) throw httpErr(400, 'Faltan datos del resultado (id, sent, rec).');
    let avg = this.pingMs(url.searchParams.get('avg'));
    if (avg != null && !(avg >= 0 && avg <= 60000)) avg = null;
    const p = this.q1('SELECT * FROM pings WHERE id=?', id);
    if (!p || p.router !== r.id) throw httpErr(404, 'Esa prueba no es de este router.');
    if (p.estado === 'hecho') return { ok: true };
    this.sql.exec("UPDATE pings SET estado='hecho', hecho=?, sent=?, rec=?, avg=? WHERE id=?", Date.now(), sent, rec, rec > 0 ? avg : null, id);
    return { ok: true };
  }

  /* ----- ubicación de los técnicos ----- */
  ubicHorario() {
    const r = this.q1("SELECT v FROM meta WHERE k='ubic_horario'");
    const [d, h] = String(r && r.v || '8,20').split(',').map(Number);
    return Number.isInteger(d) && Number.isInteger(h) && d >= 0 && h <= 24 && d < h ? { desde: d, hasta: h } : { desde: 8, hasta: 20 };
  }
  ubicPlan() {
    const r = this.q1("SELECT v FROM meta WHERE k='ubic_plan'");
    let p = {};
    try { p = JSON.parse(r && r.v || '{}'); } catch (e) { p = {}; }
    if (!isPlain(p)) p = {};
    const cortado = isPlain(p.cortado) && trOk(p.cortado.m) && trOk(p.cortado.t) && p.cortado.m[1] < p.cortado.t[0] ? { m: p.cortado.m, t: p.cortado.t } : null;
    const dias = {};
    for (let i = 0; i < 7; i++) dias[i] = cortado && isPlain(p.dias) && p.dias[i] === 'cortado' ? 'cortado' : 'corrido';
    const fechas = {};
    if (isPlain(p.fechas)) for (const [f, mo] of Object.entries(p.fechas)) if (/^\d{4}-\d{2}-\d{2}$/.test(f) && (mo === 'cortado' || mo === 'corrido')) fechas[f] = mo;
    return { corrido: this.ubicHorario(), cortado, dias, fechas };
  }
  /* el horario de un día: los tramos [[desde,hasta],…], el modo y la ventana de afuera (del primer desde al último hasta) */
  ubicDia(fecha, plan) {
    const tramos = ubicTramosDe(plan || this.ubicPlan(), fecha);
    return { tramos, modo: tramos.length === 2 ? 'cortado' : 'corrido', desde: tramos[0][0], hasta: tramos[tramos.length - 1][1] };
  }
  ubicDentro(ts, tr) { return ubicEnTramos(tr, arTime(ts).min); }
  ubicAcepto(uid) { return !!this.q1('SELECT 1 x FROM meta WHERE k=?', 'ubicok:' + uid); }
  /* a qué hora (ms) la oficina le cortó el GPS a un técnico en un día; null si no se lo cortó */
  ubicCorteDe(uid, dia) {
    const r = this.q1('SELECT v FROM meta WHERE k=?', 'ubiccorte:' + uid + ':' + dia), t = r ? Number(r.v) : 0;
    return t > 0 ? t : null;
  }
  ubicEstado(u) {
    const ahora = Date.now(), fecha = arTime(ahora).fecha, h = this.ubicDia(fecha), corte = u.role === 'tecnico' ? this.ubicCorteDe(u.id, fecha) : null;
    const tramos = ubicTramosCorte(h.tramos, arDayStart(fecha), corte);
    return { aplica: u.role === 'tecnico', acepto: this.ubicAcepto(u.id), fecha, desde: tramos[0][0], hasta: tramos[tramos.length - 1][1], tramos, modo: h.modo, dentro: !(corte && ahora >= corte) && this.ubicDentro(ahora, tramos), corte, dias: UBIC_DIAS };
  }
  /* la oficina corta el GPS de un técnico desde una hora de hoy (por defecto, ahora): desde ahí no se guarda nada más, se borra lo que ya había guardado
     desde esa hora y esa hora queda como el fin de su jornada. Sirve cuando el regreso a la base no se detectó solo. «Reanudar» lo deshace hacia adelante. */
  ubicCortar(admin, b) {
    const t = this.USERS.get(String(b.uid || ''));
    if (!t || t.role !== 'tecnico') throw httpErr(404, 'No se encontró ese técnico.');
    const ahora = Date.now(), dia = arTime(ahora).fecha, t0 = arDayStart(dia), tr = this.ubicDia(dia).tramos;
    let ts = b.ts == null || b.ts === '' ? ahora : Number(b.ts);
    if (!Number.isFinite(ts)) throw httpErr(400, 'La hora del corte no es válida.');
    ts = Math.round(ts);
    if (ts > ahora + 60e3) throw httpErr(400, 'Esa hora todavía no llegó: elegí la hora a la que se fue, o una anterior.');
    ts = Math.min(ts, ahora);
    if (ts <= t0 + tr[0][0] * 3600e3) throw httpErr(400, 'Esa hora es anterior al comienzo de su horario de hoy (' + tr[0][0] + ':00).');
    this.sql.exec('INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)', 'ubiccorte:' + t.id + ':' + dia, String(ts));
    const borrados = (this.q1('SELECT COUNT(*) n FROM ubic WHERE uid=? AND ts>=?', t.id, ts) || {}).n || 0;
    if (borrados) this.sql.exec('DELETE FROM ubic WHERE uid=? AND ts>=?', t.id, ts);
    /* su jornada de hoy termina en el corte (salvo que la oficina ya haya cargado las horas a mano: eso manda) */
    let jornada = 'sin_jornada';
    const f = this.jornadaFilaHoras(t.id, dia);
    if (f && f.adj) jornada = 'corregida_a_mano';
    else if (f && f.ingreso >= ts) { this.sql.exec('DELETE FROM jornada WHERE uid=? AND dia=?', t.id, dia); jornada = 'sin_jornada'; }
    else if (f) {
      const ev = (Array.isArray(f.ev) ? f.ev : []).filter(e => Array.isArray(e) && e[0] < ts);
      ev.push([ts, 1]);
      this.sql.exec('UPDATE jornada SET regreso=?, en_base=1, ult=?, ev=?, ingreso2=? WHERE uid=? AND dia=?', ts, ts, JSON.stringify(ev.slice(-40)), f.ingreso2 && f.ingreso2 < ts ? f.ingreso2 : null, t.id, dia);
      jornada = 'cerrada';
    }
    for (const s of this.conexiones()) if (s.uid === t.id) this.sse(s, 'ubic', { corte: ts });
    return { ok: true, uid: t.id, dia, corte: ts, borrados, jornada };
  }
  ubicReanudar(admin, b) {
    const t = this.USERS.get(String(b.uid || ''));
    if (!t || t.role !== 'tecnico') throw httpErr(404, 'No se encontró ese técnico.');
    const dia = arTime(Date.now()).fecha;
    this.sql.exec('DELETE FROM meta WHERE k=?', 'ubiccorte:' + t.id + ':' + dia);
    for (const s of this.conexiones()) if (s.uid === t.id) this.sse(s, 'ubic', { corte: null });
    return { ok: true, uid: t.id, dia, corte: null };
  }
  ubicGuardar(u, b) {
    if (u.role !== 'tecnico') throw httpErr(403, 'Solo los técnicos comparten su ubicación.');
    if (!this.ubicAcepto(u.id)) throw httpErr(409, 'Primero hay que aceptar el aviso de ubicación.', 'sin_aceptar');
    const pl = this.ubicPlan(), now = Date.now(), h = this.ubicDia(arTime(now).fecha, pl);
    const pts = (Array.isArray(b.pts) ? b.pts : [b]).filter(isPlain).slice(0, 30);
    pts.forEach(x => { const t = Number(x.ts); x._ts = isFinite(t) && t <= now + 60e3 && t >= now - 15 * 60e3 ? t : now; });
    pts.sort((x, y) => x._ts - y._ts);
    let n = 0, fuera = 0, cortados = 0;
    const cortes = {};   // día → hora del corte de la oficina (o null)
    for (const x of pts) {
      const lat = Number(x.lat), lng = Number(x.lng);
      if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) continue;
      const dia = arTime(x._ts).fecha;
      if (!(dia in cortes)) cortes[dia] = this.ubicCorteDe(u.id, dia);
      if (cortes[dia] && x._ts >= cortes[dia]) { cortados++; continue; }   // la oficina le cortó el GPS: lo que llegue desde esa hora se descarta
      if (!this.ubicDentro(x._ts, ubicTramosDe(pl, dia))) { fuera++; continue; }
      if (this.q1('SELECT 1 x FROM ubic WHERE uid=? AND ts>? AND ts<?', u.id, x._ts - UBIC_MIN_MS, x._ts + UBIC_MIN_MS)) continue;   // ya hay uno a menos de 20 s (también sirve para los puntos que llegan tarde)
      const acc = Number(x.acc);
      this.sql.exec('INSERT OR REPLACE INTO ubic(uid,ts,lat,lng,acc) VALUES(?,?,?,?,?)', u.id, x._ts, Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6, isFinite(acc) && acc >= 0 ? Math.min(Math.round(acc), 99999) : null);
      n++;
      this.jornadaAuto(u, x._ts, lat, lng, Number(x.acc));
    }
    if (Math.random() < 0.01) {
      this.sql.exec('DELETE FROM ubic WHERE ts<?', now - UBIC_DIAS * 864e5); this.sql.exec('DELETE FROM jornada WHERE dia<?', arTime(now - JORNADA_DIAS * 864e5).fecha);
      this.sql.exec("DELETE FROM meta WHERE k LIKE 'ubiccorte:%' AND substr(k,-10)<?", arTime(now - JORNADA_DIAS * 864e5).fecha);
    }
    const hoy = arTime(now).fecha, corteHoy = hoy in cortes ? cortes[hoy] : this.ubicCorteDe(u.id, hoy), tramos = ubicTramosCorte(h.tramos, arDayStart(hoy), corteHoy);
    return { ok: true, guardados: n, fuera_horario: n === 0 && fuera > 0, cortado: n === 0 && cortados > 0, desde: tramos[0][0], hasta: tramos[tramos.length - 1][1], tramos, corte: corteHoy };
  }
  ubicLista(dia) {
    const pl = this.ubicPlan(), ahora = Date.now(), hoy = arTime(ahora).fecha;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || isNaN(arDayStart(dia))) dia = hoy;
    const t0 = arDayStart(dia), t1 = t0 + 864e5;
    const h = this.ubicDia(dia, pl), trHoy = ubicTramosDe(pl, hoy);
    const esHoy = dia === hoy, dentro = this.ubicDentro(ahora, trHoy), jc = this.jornadaBase(), laborable = jc.dias.includes(new Date(arDayStart(dia) + 12 * 3600e3).getUTCDay());
    /* desde cuándo corre el tramo en que estamos (hoy): un punto de la mañana no cuenta como señal de la tarde */
    const minAhora = arTime(ahora).min / 60, trAct = esHoy && dentro ? trHoy.find(t => minAhora >= t[0] && minAhora < t[1]) : null, iniTr = trAct ? t0 + trAct[0] * 3600e3 : 0;
    const tecnicos = [...this.USERS.values()].filter(u => u.role === 'tecnico' && u.activo).map(u => {
      const ultima = this.q1('SELECT ts,lat,lng,acc FROM ubic WHERE uid=? AND ts>=? AND ts<? ORDER BY ts DESC LIMIT 1', u.id, t0, t1) || null;
      const todos = this.q('SELECT ts,lat,lng FROM ubic WHERE uid=? AND ts>=? AND ts<? ORDER BY ts', u.id, t0, t1);
      const paso = Math.max(1, Math.ceil(todos.length / 240));
      const ruta = todos.filter((_, i) => i % paso === 0 || i === todos.length - 1).map(r => [r.ts, r.lat, r.lng]);
      const acepto = this.ubicAcepto(u.id), corte = this.ubicCorteDe(u.id, dia);
      /* estado (solo hoy): sin_aceptar · cortado (la oficina le cortó el GPS) · fuera_horario · sin_datos (no mandó nada) · en_linea (≤10 min) · sin_senal */
      let estado = 'historico';
      if (!acepto) estado = 'sin_aceptar';
      else if (esHoy && corte) estado = 'cortado';
      else if (esHoy) { const ult = ultima && ultima.ts >= iniTr ? ultima : null; estado = !dentro ? 'fuera_horario' : !ult ? 'sin_datos' : ahora - ult.ts <= UBIC_HUECO_MS ? 'en_linea' : 'sin_senal'; }
      /* con corte, lo que pasó desde esa hora no es «sin señal»: se mira el día como si «ahora» fuera el corte */
      const huecos = !acepto ? [] : corte ? ubicHuecosDia(todos.map(r => r.ts), t0, h.tramos, corte, true).map(g => ({ desde: g.desde, hasta: g.hasta, ...(g.inicio ? { inicio: true } : {}) })) : ubicHuecosDia(todos.map(r => r.ts), t0, h.tramos, ahora, esHoy);
      const sinSenalMin = Math.round(huecos.reduce((s, g) => s + (g.hasta - g.desde), 0) / 60000);
      return { id: u.id, nombre: u.nombre, tel: u.tel || '', acepto, estado, corte, ultima, puntos: todos.length, ruta, huecos: huecos.slice(-40), sinSenalMin, jornada: this.jornadaDia(u, dia, hoy, ahora, jc, laborable, h.tramos) };
    });
    return { dia, hoy, ahora, horario: { desde: h.desde, hasta: h.hasta, tramos: h.tramos, modo: h.modo }, plan: pl, dias: UBIC_DIAS, tecnicos, jornada: { base: jc.base, radio: jc.radio, tol: jc.tol, dias: jc.dias } };
  }

  /* ================= Jornada laboral: ingreso y regreso a la base de los técnicos =================
     Todo sale solo de las posiciones que manda el celular (con la app abierta), comparadas con la base:
       · INGRESO: la primera posición del día dentro del radio de la base.
       · REGRESO: cada vez que, después de haber salido, vuelve a entrar al radio. El último regreso del día es el fin de la jornada
         (los técnicos vuelven a la base a guardar los vehículos); si sale otra vez, ese regreso deja de ser el último.
     Para que una posición pegada al borde del radio no cuente como entrar y salir, se «sale» recién a 1,5 veces el radio. Una posición cuya precisión es peor que el radio (o que 50 m)
     no se usa para decidir nada.
     La hora es la del servidor (o la de la posición, que el servidor limita a los últimos 15 minutos). Si el técnico nunca pasa por la base, puede
     tocar «Iniciar jornada» (queda marcado como manual, con la distancia a la base). Solo se guardan horas y distancias, nunca coordenadas.
     El técnico ve un aviso en su pantalla hasta que toca «Entendido» (queda anotado), pero el registro no depende de eso. */
  jornadaBase() {
    const r = this.q1("SELECT v FROM meta WHERE k='jornada_base'");
    let b = null;
    try { b = r && JSON.parse(r.v); } catch (e) { b = null; }
    if (!isPlain(b)) b = {};
    const lat = Number(b.lat), lng = Number(b.lng);
    const base = b.lat != null && b.lng != null && isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
    const radio = Number.isInteger(b.radio) && b.radio >= 20 && b.radio <= 2000 ? b.radio : 40;
    const tol = Number.isInteger(b.tol) && b.tol >= 0 && b.tol <= 120 ? b.tol : JORNADA_TOL;
    const dias = Array.isArray(b.dias) ? [...new Set(b.dias.filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [1, 2, 3, 4, 5, 6];   // 0 = domingo
    return { base, radio, tol, dias };
  }
  jornadaFila(uid, dia) { return this.q1('SELECT ingreso, origen, dist, regreso, en_base, ult, ingreso2, ev, tr, adj FROM jornada WHERE uid=? AND dia=?', uid, dia) || null; }
  jornadaEnterado(uid) { return !!this.q1('SELECT 1 x FROM meta WHERE k=?', 'jornadaok:' + uid); }
  jornadaPos(b) {
    const lat = Number(b && b.lat), lng = Number(b && b.lng);
    return b && b.lat != null && b.lng != null && isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0) ? { lat, lng } : null;
  }
  jornadaVista(f) { return f ? { ingreso: f.ingreso, origen: f.origen, dist: f.dist == null ? null : f.dist, regreso: f.regreso || null, enBase: !!f.en_base, ingreso2: f.ingreso2 || null } : null; }
  /* lo que ve el propio técnico */
  jornadaEstado(u) {
    const ahora = Date.now(), dia = arTime(ahora).fecha, c = this.jornadaBase();
    const horas = u.role === 'tecnico' ? this.jornadaResumen(u, '', 7).tecnicos[0] : null;
    return { aplica: u.role === 'tecnico', horas: horas ? { semana: horas.total, desde: horas.dias[0].dia, dias: horas.dias.map(x => ({ dia: x.dia, min: x.min, estado: x.estado })) } : null, enterado: this.jornadaEnterado(u.id), dia, ahora, horario: (h => ({ desde: h.desde, hasta: h.hasta, tramos: h.tramos }))(this.ubicDia(dia)), hayBase: !!c.base, corte: u.role === 'tecnico' ? this.ubicCorteDe(u.id, dia) : null, fila: this.jornadaVista(this.jornadaFila(u.id, dia)) };
  }
  jornadaSoloTecnico(u) { if (u.role !== 'tecnico') throw httpErr(403, 'Solo los técnicos registran su jornada.'); }
  /* se llama con cada posición guardada, en orden */
  jornadaAuto(u, ts, lat, lng, acc) {
    const c = this.jornadaBase();
    /* sin base, o una posición demasiado imprecisa para decir si está adentro o afuera: si el GPS dice «±80 m» y el radio es de 40, no sirve para ninguna de las dos cosas */
    if (!c.base || (isFinite(acc) && acc > Math.max(c.radio, 50))) return;
    const dia = arTime(ts).fecha, d = distM(lat, lng, c.base.lat, c.base.lng), f = this.jornadaFila(u.id, dia), now = Date.now();
    if (!f) {
      if (d <= c.radio) this.sql.exec('INSERT OR IGNORE INTO jornada(uid,dia,ingreso,origen,dist,en_base,ult,ev,tr) VALUES(?,?,?,?,?,1,?,?,?)', u.id, dia, Math.min(ts, now), 'base', d, ts, '[]', trStr(this.ubicDia(dia).tramos));
      return;
    }
    if (ts <= f.ult) return;   // una posición atrasada que llegó después de otras más nuevas no cambia nada
    /* en un día cortado, la primera vez que aparece en la base a la tarde es su «retoma» */
    if (d <= c.radio && jornadaRetoma(this.ubicDia(dia).tramos, arDayStart(dia), f, ts)) this.sql.exec('UPDATE jornada SET ingreso2=? WHERE uid=? AND dia=?', Math.min(ts, now), u.id, dia);
    /* cada entrada y salida de la base queda anotada: de ahí salen las horas de cada tramo */
    const evs = (() => { try { const a = JSON.parse(f.ev || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } })();
    const anotar = (est, t) => JSON.stringify([...evs, [t, est]].slice(-40));
    if (d <= c.radio && !f.en_base) this.sql.exec('UPDATE jornada SET regreso=?, en_base=1, ult=?, ev=? WHERE uid=? AND dia=?', Math.min(ts, now), ts, anotar(1, Math.min(ts, now)), u.id, dia);
    else if (d > c.radio * 1.5 && f.en_base) this.sql.exec('UPDATE jornada SET en_base=0, ult=?, ev=? WHERE uid=? AND dia=?', ts, anotar(0, ts), u.id, dia);
    else this.sql.exec('UPDATE jornada SET ult=? WHERE uid=? AND dia=?', ts, u.id, dia);
  }
  /* «Iniciar jornada» a mano: para quien arranca sin pasar por la base */
  jornadaIngreso(u, b) {
    this.jornadaSoloTecnico(u);
    const now = Date.now(), dia = arTime(now).fecha;
    if (this.jornadaFila(u.id, dia)) return this.jornadaEstado(u);   // ya empezó: la hora no se pisa
    const c = this.jornadaBase(), pos = this.jornadaPos(b), dist = pos && c.base ? distM(pos.lat, pos.lng, c.base.lat, c.base.lng) : null;
    const enBase = dist !== null && dist <= c.radio;
    this.sql.exec('INSERT INTO jornada(uid,dia,ingreso,origen,dist,en_base,ult,ev,tr) VALUES(?,?,?,?,?,?,?,?,?)', u.id, dia, now, enBase ? 'base' : 'manual', dist, enBase ? 1 : 0, now, '[]', trStr(this.ubicDia(dia).tramos));
    return this.jornadaEstado(u);
  }
  /* lo que ve la oficina de un técnico en un día: estado, horas y minutos de atraso respecto del inicio de cada tramo */
  jornadaDia(u, dia, hoy, ahora, jc, laborable, tr) {
    const v = this.jornadaVista(this.jornadaFila(u.id, dia));
    const e = jornadaEstadoDia(v, { dia, hoy, ahora, tr, base: !!jc.base, laborable, tol: jc.tol });
    const hs = this.jornadaHorasDia(u.id, dia, hoy, ahora, tr), corte = this.ubicCorteDe(u.id, dia);
    if (corte && v) { e.estado = 'termino'; e.sinRetomar = false; }   // la oficina le cortó el GPS: el día terminó ahí, no queda nada por esperar
    return Object.assign(e, { corte, horasMin: hs ? hs.min : null, horasEstado: hs ? hs.estado : null, cortado: tr.length === 2, enterado: this.jornadaEnterado(u.id), ingreso: v ? v.ingreso : null, origen: v ? v.origen : null, dist: v ? v.dist : null, regreso: v ? v.regreso : null, enBase: v ? v.enBase : false });
  }

  /* ----- horas trabajadas ----- */
  jornadaFilaHoras(uid, dia) {
    const f = this.jornadaFila(uid, dia);
    if (!f) return null;
    const j = x => { try { return x ? JSON.parse(x) : null; } catch (e) { return null; } };
    return Object.assign({}, f, { ev: j(f.ev) || [], adj: j(f.adj) });
  }
  /* las horas de un técnico en un día, con lo que la oficina necesita para revisarlas; null si no hay jornada ese día */
  jornadaHorasDia(uid, dia, hoy, ahora, tramosDia) {
    const f = this.jornadaFilaHoras(uid, dia);
    if (!f) return null;
    const h = jornadaHoras(f, { dia, hoy, ahora, tr: tramosDia }), tr = f.tr ? trParse(f.tr) : tramosDia;
    return { dia, min: h.min, estado: h.estado, estimado: h.estimado, segs: h.segs, ingreso: f.ingreso, origen: f.origen, regreso: f.regreso || null, ingreso2: f.ingreso2 || null,
      tramos: tr.length ? tr : tramosDia, ajuste: f.adj ? { nota: String(f.adj.nota || ''), por: String(f.adj.por || ''), ts: f.adj.ts || 0 } : null };
  }
  /* resumen de horas de varios días (por defecto la semana de lunes a domingo): cada técnico ve las suyas; con permiso de ver técnicos, todos */
  jornadaResumen(u, desde, dias) {
    const ahora = Date.now(), hoy = arTime(ahora).fecha, ayer90 = arTime(ahora - JORNADA_DIAS * 864e5).fecha;
    let personas;
    if (u.role === 'tecnico') personas = [u];
    else if (effPerms(u).verTecnicos) personas = [...this.USERS.values()].filter(x => x.role === 'tecnico' && x.activo);
    else throw httpErr(403, 'No tenés permiso para ver las horas de los técnicos.');
    const n = Math.min(31, Math.max(1, Math.round(Number(dias)) || 7));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde || '') || isNaN(arDayStart(desde))) {
      const dow = new Date(arDayStart(hoy) + 12 * 3600e3).getUTCDay();   // lunes = 1 … domingo = 0
      desde = arTime(arDayStart(hoy) + 12 * 3600e3 - ((dow + 6) % 7) * 864e5).fecha;
    }
    if (desde < ayer90) desde = ayer90;
    const fechas = [];
    for (let i = 0; i < n; i++) fechas.push(arTime(arDayStart(desde) + 12 * 3600e3 + i * 864e5).fecha);
    const pl = this.ubicPlan();
    const tecnicos = personas.map(p => {
      const dd = fechas.map(dia => this.jornadaHorasDia(p.id, dia, hoy, ahora, ubicTramosDe(pl, dia)) || { dia, min: 0, estado: 'sin_registro' });
      return { id: p.id, nombre: p.nombre, dias: dd, total: dd.reduce((a, x) => a + x.min, 0), incompletos: dd.filter(x => x.estado === 'incompleto').length, corregidos: dd.filter(x => x.estado === 'corregido').length };
    }).sort((a, b) => a.nombre.localeCompare(b.nombre));
    return { desde: fechas[0], hasta: fechas[fechas.length - 1], hoy, ahora, puedeAjustar: u.role === 'admin', tecnicos };
  }
  /* la oficina (solo el administrador) carga o corrige las horas de un técnico en un día; sin «segs» vuelve al cálculo automático */
  jornadaAjustar(admin, b) {
    const t = this.USERS.get(String(b.uid || ''));
    if (!t || t.role !== 'tecnico') throw httpErr(404, 'No se encontró ese técnico.');
    const ahora = Date.now(), hoy = arTime(ahora).fecha, dia = String(b.dia || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || isNaN(arDayStart(dia)) || dia > hoy || dia < arTime(ahora - JORNADA_DIAS * 864e5).fecha) throw httpErr(400, 'El día no es válido: tiene que ser de hoy hacia atrás, hasta 90 días.');
    const t0 = arDayStart(dia), f = this.jornadaFilaHoras(t.id, dia), tramos = this.ubicDia(dia).tramos;
    if (b.quitar === true || b.segs == null) {
      if (f && f.adj) {
        if (f.origen === 'oficina') this.sql.exec('DELETE FROM jornada WHERE uid=? AND dia=?', t.id, dia);   // la fila la había creado la oficina: sin ajuste no queda nada
        else this.sql.exec('UPDATE jornada SET adj=NULL WHERE uid=? AND dia=?', t.id, dia);
      }
      return this.jornadaHorasDia(t.id, dia, hoy, ahora, tramos) || { dia, min: 0, estado: 'sin_registro' };
    }
    if (!Array.isArray(b.segs) || b.segs.length < 1 || b.segs.length > 2) throw httpErr(400, 'Cargá uno o dos tramos de trabajo.');
    const segs = b.segs.map(x => Array.isArray(x) && x.length === 2 ? [Number(x[0]), Number(x[1])] : null);
    if (segs.some(x => !x || !Number.isInteger(x[0]) || !Number.isInteger(x[1]) || x[0] < t0 || x[1] > t0 + 36 * 3600e3 || x[1] <= x[0])) throw httpErr(400, 'Cada tramo tiene que ir de una hora a otra posterior, dentro del día.');
    segs.sort((x, y) => x[0] - y[0]);
    if (segs.length === 2 && segs[1][0] < segs[0][1]) throw httpErr(400, 'Los dos tramos no se pueden superponer.');
    const adj = JSON.stringify({ s: segs, nota: String(b.nota || '').trim().slice(0, 200), por: admin.nombre || admin.usuario, ts: ahora });
    if (f) this.sql.exec('UPDATE jornada SET adj=? WHERE uid=? AND dia=?', adj, t.id, dia);
    else this.sql.exec('INSERT INTO jornada(uid,dia,ingreso,origen,dist,en_base,ult,ev,tr,adj) VALUES(?,?,?,?,NULL,0,0,?,?,?)', t.id, dia, segs[0][0], 'oficina', '[]', trStr(tramos), adj);
    return this.jornadaHorasDia(t.id, dia, hoy, ahora, tramos);
  }

  /* ================= HTTP ================= */
  async fetch(request) {
    try {
      let raw = '';
      if (request.method !== 'GET' && request.method !== 'HEAD' && request.body) {
        if (Number(request.headers.get('content-length') || 0) > 26e6) throw httpErr(413, 'Pedido demasiado grande.', 'quota_exceeded');
        raw = await request.text();
      }
      return await this.api(request, new URL(request.url), raw);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e && e.stack || e);
      return send(status, { error: status >= 500 ? 'Error interno del servidor.' : e.message, code: e.code || (status === 401 ? 'unauthenticated' : status === 403 ? 'permission_denied' : status === 413 ? 'quota_exceeded' : status === 429 ? 'resource_exhausted' : 'invalid_argument') });
    }
  }

  async api(request, url, raw) {
    const m = request.method, p = url.pathname;
    if (p === '/api/status' && m === 'GET') return send(200, { ok: true, v: VERSION, needsSetup: this.userCount() === 0, nube: 'cloudflare' });

    if (p === '/api/setup' && m === 'POST') {
      if (this.userCount() > 0) throw httpErr(403, 'El sistema ya está configurado.');
      const b = await readBody(raw, 1e5);
      const key = 'setup|' + this.clientIp(request);
      if (this.locked(key)) throw httpErr(429, 'Demasiados intentos. Esperá un momento.', 'resource_exhausted');
      const code = normCode(b.codigo);
      const e1 = normCode(this.env.CODIGO_INSTALACION), h1 = String(this.env.SETUP_HASH || '').trim().toLowerCase();
      if (!e1 && !h1) throw httpErr(503, 'Falta configurar el código de instalación en Cloudflare (variable SETUP_HASH o secreto CODIGO_INSTALACION).');
      const ok = code && ((e1 && safeEq(code, e1)) || (h1 && safeEq(await sha(code), h1)));
      if (!ok) { this.addFail(key); throw httpErr(403, 'El código de instalación no es correcto.'); }
      const usuario = normUser(b.usuario), clave = String(b.clave || '');
      if (!USER_RE.test(usuario)) throw httpErr(400, 'El usuario debe tener de 2 a 32 letras, números, punto o guion.');
      if (clave.length < 8) throw httpErr(400, 'La clave del administrador debe tener al menos 8 caracteres.');
      const pw = await makePw(clave), id = newId();
      if (this.userCount() > 0) throw httpErr(403, 'El sistema ya está configurado.');
      this.tx(() => {
        this.insUser({ id, usuario, nombre: String(b.nombre || usuario).trim().slice(0, 60), role: 'admin', tel: '', permisos: null, activo: 1, salt: pw.salt, hash: pw.hash, created: Date.now(), last_login: Date.now() });
        if (!this.readDoc('ajustes', 'general')) this.putDoc('ajustes', 'general', JSON.stringify({ empresa: String(b.empresa || 'YAPUR.NET').trim().slice(0, 60) || 'YAPUR.NET', diaVenc: 10 }));
      });
      this.loadUsers();
      const dev0 = await this.devEntrar(this.USERS.get(id), request, b.did);
      return send(200, { token: await this.newSession(id, dev0.id), me: meOf(this.USERS.get(id)) });
    }

    if (p === '/api/login' && m === 'POST') {
      const b = await readBody(raw, 1e4);
      const usuario = normUser(b.usuario), k1 = this.clientIp(request) + '|' + usuario, k2 = 'ip|' + this.clientIp(request);
      const wait = Math.max(this.locked(k1), this.locked(k2));
      if (wait) throw httpErr(429, 'Demasiados intentos. Probá de nuevo en ' + wait + ' segundos.', 'resource_exhausted');
      const u = [...this.USERS.values()].find(x => x.usuario === usuario);
      const ok = await checkPw(String(b.clave || ''), u);
      if (!ok || !u.activo) {
        this.addFail(k1, 5); this.addFail(k2, 25);
        throw httpErr(401, u && !u.activo && ok ? 'Este usuario está desactivado. Consultá con el administrador.' : 'Usuario o clave incorrectos.', 'unauthenticated');
      }
      this.clearFail(k1);
      /* ¿desde qué equipo entra? Un empleado en un equipo que el administrador no aprobó no recibe sesión */
      const dev = await this.devEntrar(u, request, b.did);
      if (dev.estado === 'bloq') throw httpErr(403, 'Este dispositivo fue bloqueado por el administrador.', 'device_blocked');
      if (dev.estado === 'pend') throw httpErr(403, 'Este dispositivo todavía no está autorizado. Avisale al administrador para que lo apruebe y después volvé a entrar.', 'device_pending');
      this.sql.exec('UPDATE users SET last_login=? WHERE id=?', Date.now(), u.id); u.last_login = Date.now();
      return send(200, { token: await this.newSession(u.id, dev.id), me: meOf(u) });
    }

    if (p === '/api/logout' && m === 'POST') {
      const a = await this.authOf(request);
      if (a) this.sql.exec('DELETE FROM sessions WHERE th=?', a.th);
      return send(200, { ok: true });
    }
    if (p === '/api/me' && m === 'GET') return send(200, { me: meOf((await this.needAuth(request)).user) });
    if (p === '/api/me/clave' && m === 'POST') {
      const a = await this.needAuth(request), b = await readBody(raw, 1e4);
      if (!(await checkPw(String(b.actual || ''), a.user))) throw httpErr(403, 'La clave actual no es correcta.');
      const nueva = String(b.nueva || ''), min = a.user.role === 'admin' ? 8 : 6;
      if (nueva.length < min) throw httpErr(400, 'La clave nueva debe tener al menos ' + min + ' caracteres.');
      const pw = await makePw(nueva);
      this.sql.exec('UPDATE users SET salt=?,hash=? WHERE id=?', pw.salt, pw.hash, a.user.id);
      this.sql.exec('DELETE FROM sessions WHERE uid=? AND th<>?', a.user.id, a.th);
      this.loadUsers();
      return send(200, { ok: true });
    }

    if (p === '/api/ticket' && m === 'POST') {
      const a = await this.needAuth(request), t = b64u(rnd(24));
      const ahora = Date.now();
      for (const [k, v] of this.tickets) if (v.exp < ahora) this.tickets.delete(k);
      for (const [k, f] of this.fails) if (f.until < ahora - 36e5) this.fails.delete(k);   /* la limpieza que antes hacía el reloj de 20 s, que mantenía despierto al servidor */
      this.sql.exec('DELETE FROM fails WHERE t<?', ahora - 864e5);
      this.tickets.set(t, { uid: a.user.id, dev: a.dev, exp: ahora + 30e3 });
      if (this.streams.size) this.ensureTimer();
      return send(200, { t });
    }
    if (p === '/api/stream' && m === 'GET') {
      const t = url.searchParams.get('t'), tk = this.tickets.get(t);
      this.tickets.delete(t);
      if (!tk || tk.exp < Date.now()) return send(401, { error: 'ticket', code: 'unauthenticated' });
      const u = this.USERS.get(tk.uid);
      if (!u || !u.activo) return send(401, { error: 'usuario', code: 'unauthenticated' });
      if (tk.dev) { const dv = this.q1('SELECT estado FROM devices WHERE id=?', tk.dev); if (!dv || dv.estado !== 'ok') return send(401, { error: 'dispositivo', code: 'unauthenticated' }); }
      if ((request.headers.get('Upgrade') || '').toLowerCase() === 'websocket') return this.openSocket(u, tk.dev);
      return this.openStream(u, tk.dev);
    }
    if (p === '/api/comprobante' && m === 'POST') {
      const a = await this.needAuth(request);
      return send(200, this.comprobanteGuardar(a.user, readBody(raw, 7e5)));
    }
    const mcomp = /^\/api\/comprobante\/([a-f0-9]{20})$/.exec(p);
    if (mcomp && m === 'GET') return this.comprobanteLeer((await this.needAuth(request)).user, mcomp[1]);
    if (p === '/api/mis-cobros' && m === 'GET') {
      const a = await this.needAuth(request);
      return send(200, this.misCobros(a.user, Math.max(1, Math.min(31, parseInt(url.searchParams.get('dias') || '7', 10) || 7))));
    }
    if (p === '/api/whatsapp' && m === 'GET') { await this.needAdmin(request); return send(200, this.waEstado()); }
    if (p === '/api/whatsapp/prueba' && m === 'POST') { await this.needAdmin(request); return send(200, await this.waPrueba(readBody(raw, 2e3))); }
    if (p === '/api/recibos/reenviar' && m === 'POST') { const a = await this.needAuth(request); return send(200, await this.waReenviar(a.user, readBody(raw, 2e3))); }
    if (p === '/api/ubicacion/estado' && m === 'GET') return send(200, this.ubicEstado((await this.needAuth(request)).user));
    if (p === '/api/ubicacion/acepto' && m === 'POST') {
      const a = await this.needAuth(request);
      if (a.user.role !== 'tecnico') throw httpErr(403, 'Solo los técnicos comparten su ubicación.');
      this.sql.exec('INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)', 'ubicok:' + a.user.id, String(Date.now()));
      return send(200, this.ubicEstado(a.user));
    }
    if (p === '/api/ubicacion' && m === 'POST') return send(200, this.ubicGuardar((await this.needAuth(request)).user, readBody(raw, 2e5)));
    if (p === '/api/ubicacion/cortar' && m === 'POST') { const a = await this.needAdmin(request); return send(200, this.ubicCortar(a.user, readBody(raw, 1e3))); }
    if (p === '/api/ubicacion/reanudar' && m === 'POST') { const a = await this.needAdmin(request); return send(200, this.ubicReanudar(a.user, readBody(raw, 1e3))); }
    if (p === '/api/ubicaciones' && m === 'GET') {
      const a = await this.needAuth(request);
      if (!effPerms(a.user).verTecnicos) throw httpErr(403, 'No tenés permiso para ver la ubicación de los técnicos.');
      return send(200, this.ubicLista(url.searchParams.get('dia') || ''));
    }
    if (p === '/api/jornada' && m === 'GET') return send(200, this.jornadaEstado((await this.needAuth(request)).user));
    if (p === '/api/jornada/horas' && m === 'GET') return send(200, this.jornadaResumen((await this.needAuth(request)).user, url.searchParams.get('desde') || '', url.searchParams.get('dias') || ''));
    if (p === '/api/jornada/ajuste' && m === 'POST') { const a = await this.needAdmin(request); return send(200, this.jornadaAjustar(a.user, readBody(raw, 4e3))); }
    if (p === '/api/jornada/acepto' && m === 'POST') {
      const a = await this.needAuth(request);
      this.jornadaSoloTecnico(a.user);
      this.sql.exec('INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)', 'jornadaok:' + a.user.id, String(Date.now()));
      return send(200, this.jornadaEstado(a.user));
    }
    if (p === '/api/jornada/ingreso' && m === 'POST') return send(200, this.jornadaIngreso((await this.needAuth(request)).user, readBody(raw, 2e3)));
    if (p === '/api/jornada/base' && m === 'POST') {
      await this.needAdmin(request);
      const b = readBody(raw, 2e3), pos = this.jornadaPos(b), radio = Number(b.radio), tol = Number(b.tol);
      if (b.lat != null && b.lng != null && !pos) throw httpErr(400, 'La ubicación de la base no es válida.');
      if (!Number.isInteger(radio) || radio < 20 || radio > 2000) throw httpErr(400, 'El radio tiene que estar entre 20 y 2000 metros.');
      if (!Number.isInteger(tol) || tol < 0 || tol > 120) throw httpErr(400, 'La tolerancia tiene que estar entre 0 y 120 minutos.');
      if (!Array.isArray(b.dias) || b.dias.some(d => !Number.isInteger(d) || d < 0 || d > 6)) throw httpErr(400, 'Los días de trabajo no son válidos.');
      this.sql.exec('INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)', 'jornada_base', JSON.stringify({ lat: pos ? Math.round(pos.lat * 1e6) / 1e6 : null, lng: pos ? Math.round(pos.lng * 1e6) / 1e6 : null, radio, tol, dias: [...new Set(b.dias)].sort() }));
      const c = this.jornadaBase();
      return send(200, { base: c.base, radio: c.radio, tol: c.tol, dias: c.dias });
    }
    if (p === '/api/ubicacion/horario' && m === 'POST') {
      await this.needAdmin(request);
      const b = readBody(raw, 1e3), d = Number(b.desde), h = Number(b.hasta);
      if (!Number.isInteger(d) || !Number.isInteger(h) || d < 0 || h > 24 || d >= h) throw httpErr(400, 'El horario no es válido: «desde» tiene que ser menor que «hasta» (de 0 a 24).');
      this.sql.exec('INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)', 'ubic_horario', d + ',' + h);
      return send(200, { horario: this.ubicHorario() });
    }
    if (p === '/api/ubicacion/plan' && m === 'POST') {
      /* horario de corrido + horario cortado (mañana y tarde) + qué días es cada uno + días puntuales; reemplaza todo lo anterior */
      await this.needAdmin(request);
      const b = readBody(raw, 16e3), d = Number(b.desde), h = Number(b.hasta);
      if (!horaOk(d, h)) throw httpErr(400, 'El horario de corrido no es válido: «desde» tiene que ser menor que «hasta» (de 0 a 24).');
      let cortado = null;
      if (b.cortado != null) {
        const c = b.cortado;
        if (!isPlain(c) || !trOk(c.m) || !trOk(c.t)) throw httpErr(400, 'El horario cortado no es válido: en cada tramo «desde» tiene que ser menor que «hasta» (de 0 a 24).');
        if (c.m[1] >= c.t[0]) throw httpErr(400, 'La mañana tiene que terminar antes de que empiece la tarde.');
        cortado = { m: [c.m[0], c.m[1]], t: [c.t[0], c.t[1]] };
      }
      const dias = {};
      for (let i = 0; i < 7; i++) {
        const mo = isPlain(b.dias) ? b.dias[i] : 'corrido';
        if (mo !== 'corrido' && mo !== 'cortado') throw httpErr(400, 'Los días tienen que ser «corrido» o «cortado».');
        dias[i] = mo;
      }
      const fechas = {}, hoy = arTime(Date.now()).fecha, limite = arTime(Date.now() - 60 * 864e5).fecha;
      if (b.fechas != null && !isPlain(b.fechas)) throw httpErr(400, 'Los días puntuales no son válidos.');
      const ent = Object.entries(b.fechas || {});
      if (ent.length > 200) throw httpErr(400, 'Hay demasiados días puntuales.');
      for (const [f, mo] of ent) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || isNaN(arDayStart(f)) || (mo !== 'corrido' && mo !== 'cortado')) throw httpErr(400, 'Un día puntual no es válido.');
        if (f >= limite) fechas[f] = mo;   // los de hace más de 60 días ya no sirven
      }
      if (!cortado && (Object.values(dias).includes('cortado') || Object.values(fechas).includes('cortado'))) throw httpErr(400, 'Para usar días cortados hay que cargar los dos tramos (mañana y tarde).');
      this.tx(() => {
        this.sql.exec('INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)', 'ubic_horario', d + ',' + h);
        this.sql.exec('INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)', 'ubic_plan', JSON.stringify({ cortado, dias, fechas }));
      });
      return send(200, { plan: this.ubicPlan(), hoy: this.ubicDia(hoy) });
    }
    let mm;
    if (p === '/api/router/ingest' && m === 'POST') return send(200, await this.routerIngest(request, url, raw));
    if (p === '/api/router/ping' && m === 'GET') return send(200, await this.routerPingPoll(request), { 'Content-Type': 'text/plain; charset=utf-8' });
    if (p === '/api/router/ping' && m === 'POST') return send(200, await this.routerPingResult(request, url));
    if (p === '/api/ping' && m === 'POST') return send(200, { ping: this.pingPedir((await this.needAuth(request)).user, readBody(raw, 1e3)) });
    if ((mm = /^\/api\/ping\/(g[0-9a-f]{14})$/.exec(p)) && m === 'GET') return send(200, { ping: this.pingVer((await this.needAuth(request)).user, mm[1]) });
    if (p === '/api/contratos' && m === 'GET') return send(200, this.contratoLista((await this.needAuth(request)).user, url));
    if (p === '/api/contrato/plantilla' && m === 'GET') return send(200, this.contratoPlantillaVer((await this.needAuth(request)).user));
    if (p === '/api/contrato/plantilla' && m === 'PUT') return send(200, this.contratoPlantillaGuardar((await this.needAdmin(request)).user, readBody(raw, 6e4)));
    if (p === '/api/contrato/vista' && m === 'POST') return send(200, this.contratoVista((await this.needAuth(request)).user, readBody(raw, 2e4)));
    if (p === '/api/contrato' && m === 'POST') return send(200, await this.contratoFirmar((await this.needAuth(request)).user, readBody(raw, 2e5), request));
    if ((mm = /^\/api\/contrato\/(k[0-9a-f]{16})(?:\/(aprobar|rechazar|borrar|restaurar|verificar))?$/.exec(p))) {
      const u = (await this.needAuth(request)).user;
      if (!mm[2] && m === 'GET') return send(200, { contrato: this.contratoDetalle(u, mm[1]) });
      if (mm[2] === 'verificar' && m === 'POST') return send(200, await this.contratoVerificar(u, mm[1]));
      if (mm[2] && mm[2] !== 'verificar' && m === 'POST') return send(200, this.contratoAccion(u, mm[1], mm[2], readBody(raw, 2e3)));
    }
    if (p === '/api/routers' && m === 'GET') { await this.needAdmin(request); return send(200, { routers: this.routerList() }); }
    if (p === '/api/routers' && m === 'POST') { await this.needAdmin(request); return send(200, await this.routerCreate(readBody(raw, 1e4))); }
    if ((mm = /^\/api\/routers\/(r[0-9a-f]{10})(\/token|\/ping-token|\/items)?$/.exec(p))) {
      await this.needAdmin(request);
      const id = mm[1], r = this.q1('SELECT * FROM routers WHERE id=?', id);
      if (!r) throw httpErr(404, 'No existe ese router.');
      if (mm[2] === '/items' && m === 'GET') return send(200, this.routerItems(id), { 'Content-Type': 'application/json; charset=utf-8' });
      if (mm[2] === '/token' && m === 'POST') return send(200, { token: await this.routerNewToken(id) });
      if (mm[2] === '/ping-token' && m === 'POST') return send(200, { token: await this.routerPingToken(id) });
      if (!mm[2] && m === 'PATCH') {
        const b = readBody(raw, 1e4), nombre = b.nombre === undefined ? r.nombre : String(b.nombre).trim().replace(/\s+/g, ' ').slice(0, 40);
        if (!nombre) throw httpErr(400, 'Falta el nombre del router.');
        const dup = this.q1('SELECT id FROM routers WHERE nombre=? COLLATE NOCASE AND id<>?', nombre, id);
        if (dup) throw httpErr(409, 'Ya hay un router con ese nombre.');
        this.sql.exec('UPDATE routers SET nombre=?, kinds=? WHERE id=?', nombre, b.kinds === undefined ? r.kinds : this.routerKinds(b.kinds), id);
        return send(200, { router: this.routerPublic(this.q1('SELECT * FROM routers WHERE id=?', id)) });
      }
      if (!mm[2] && m === 'DELETE') { this.tx(() => { this.sql.exec('DELETE FROM rsnap WHERE router=?', id); this.sql.exec('DELETE FROM routers WHERE id=?', id); }); return send(200, { ok: true }); }
    }
    if (p === '/api/sync' && m === 'GET') return send(200, this.syncJSON((await this.needAuth(request)).user), { 'Content-Type': 'application/json; charset=utf-8' });

    if ((mm = /^\/api\/doc\/([a-z]+)\/([^/]+)$/.exec(p))) {
      const a = await this.needAuth(request), coll = mm[1];
      let id; try { id = decodeURIComponent(mm[2]); } catch (e) { throw httpErr(400, 'Ruta inválida.'); }
      if (!COLS.has(coll) || !ID_RE.test(id)) throw httpErr(400, 'Ruta inválida.');
      if (m === 'GET') {
        const d = this.readDoc(coll, id), v = d ? this.viewData(a.user, effPerms(a.user), coll, id, d) : null;
        return send(200, { exists: !!d && v != null, data: v });
      }
      if (m === 'PUT' || m === 'PATCH') {
        const b = await readBody(raw, 2e6);
        return send(200, this.writeDoc(a.user, coll, id, m === 'PUT' ? 'set' : 'merge', b.data));
      }
      if (m === 'DELETE') return send(200, this.deleteDoc(a.user, coll, id));
    }

    if (p === '/api/users' && m === 'GET') { await this.needAdmin(request); return send(200, { users: [...this.USERS.values()].map(pubUser) }); }
    if (p === '/api/users' && m === 'POST') {
      await this.needAdmin(request);
      const b = await readBody(raw, 1e5), usuario = normUser(b.usuario), role = b.role;
      if (!ROLES.includes(role)) throw httpErr(400, 'Rol inválido.');
      if (!USER_RE.test(usuario)) throw httpErr(400, 'El usuario debe tener de 2 a 32 letras, números, punto o guion (sin espacios).');
      if ([...this.USERS.values()].some(u => u.usuario === usuario)) throw httpErr(409, 'Ya existe un usuario con ese nombre de acceso.');
      const nombre = String(b.nombre || '').trim().slice(0, 60);
      if (!nombre) throw httpErr(400, 'Falta el nombre.');
      const clave = String(b.clave || ''), min = role === 'admin' ? 8 : 6;
      if (clave.length < min) throw httpErr(400, 'La clave debe tener al menos ' + min + ' caracteres.');
      const pw = await makePw(clave), id = newId();
      if ([...this.USERS.values()].some(u => u.usuario === usuario)) throw httpErr(409, 'Ya existe un usuario con ese nombre de acceso.');
      this.insUser({ id, usuario, nombre, role, tel: String(b.tel || '').trim().slice(0, 30), permisos: role !== 'admin' && isPlain(b.permisos) ? cleanPerms(b.permisos) : null, activo: 1, salt: pw.salt, hash: pw.hash, created: Date.now() });
      this.loadUsers(); this.broadcastPerfiles();
      return send(200, { user: pubUser(this.USERS.get(id)) });
    }
    if ((mm = /^\/api\/users\/([^/]+)(\/clave)?$/.exec(p)) && (m === 'POST' || m === 'PATCH')) {
      const a = await this.needAdmin(request);
      let id; try { id = decodeURIComponent(mm[1]); } catch (e) { throw httpErr(400, 'Ruta inválida.'); }
      const u = this.USERS.get(id);
      if (!u) throw httpErr(404, 'No existe ese usuario.');
      if (mm[2] && m === 'POST') {
        const b = await readBody(raw, 1e4), clave = String(b.clave || ''), min = u.role === 'admin' ? 8 : 6;
        if (clave.length < min) throw httpErr(400, 'La clave debe tener al menos ' + min + ' caracteres.');
        const pw = await makePw(clave);
        this.sql.exec('UPDATE users SET salt=?,hash=? WHERE id=?', pw.salt, pw.hash, id);
        this.sql.exec('DELETE FROM sessions WHERE uid=?', id);
        this.loadUsers(); this.kickUser(id);
        return send(200, { ok: true });
      }
      if (!mm[2] && m === 'PATCH') {
        const b = await readBody(raw, 1e5);
        const role = b.role === undefined ? u.role : b.role, activo = b.activo === undefined ? u.activo : !!b.activo;
        if (!ROLES.includes(role)) throw httpErr(400, 'Rol inválido.');
        const nombre = b.nombre === undefined ? u.nombre : String(b.nombre).trim().slice(0, 60);
        if (!nombre) throw httpErr(400, 'Falta el nombre.');
        const wasAdmin = u.role === 'admin' && u.activo, willAdmin = role === 'admin' && activo;
        if (wasAdmin && !willAdmin && this.adminsActivos().length <= 1) throw httpErr(400, 'Tiene que quedar al menos un administrador activo.');
        if (id === a.user.id && !activo) throw httpErr(400, 'No podés desactivarte a vos mismo.');
        const permisos = role === 'admin' ? null : (b.permisos === undefined ? u.permisos : (isPlain(b.permisos) ? cleanPerms(b.permisos) : null));
        this.sql.exec('UPDATE users SET nombre=?,role=?,tel=?,permisos=?,activo=? WHERE id=?', nombre, role, b.tel === undefined ? u.tel : String(b.tel).trim().slice(0, 30), permisos ? JSON.stringify(permisos) : null, activo ? 1 : 0, id);
        if (!activo) this.sql.exec('DELETE FROM sessions WHERE uid=?', id);
        this.loadUsers(); this.pushMe(id); this.broadcastPerfiles();
        return send(200, { user: pubUser(this.USERS.get(id)) });
      }
    }

    if (p === '/api/dispositivos' && m === 'GET') return send(200, this.dispView(await this.needAdmin(request)));
    if (p === '/api/dispositivos' && m === 'PATCH') {
      const a = await this.needAdmin(request), b = readBody(raw, 1e3);
      if (!isPlain(b) || typeof b.requiere !== 'boolean') throw httpErr(400, 'Falta indicar si se pide aprobación.');
      this.sql.exec('INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)', 'disp_aprob', b.requiere ? '1' : '0');
      return send(200, this.dispView(a));
    }
    if ((mm = /^\/api\/dispositivos\/(d[0-9a-f]{12})$/.exec(p)) && m === 'POST') {
      const a = await this.needAdmin(request), b = readBody(raw, 1e3), id = mm[1], d = this.q1('SELECT * FROM devices WHERE id=?', id);
      if (!d) throw httpErr(404, 'Ese dispositivo ya no está en la lista.');
      const acc = isPlain(b) ? b.accion : '';
      if (acc === 'aprobar') this.sql.exec("UPDATE devices SET estado='ok' WHERE id=?", id);
      else if (acc === 'bloquear' || acc === 'quitar') {
        if (id === a.dev) throw httpErr(400, 'Es el equipo que estás usando ahora.');
        this.sql.exec('DELETE FROM sessions WHERE dev=?', id);
        if (acc === 'bloquear') this.sql.exec("UPDATE devices SET estado='bloq' WHERE id=?", id); else this.sql.exec('DELETE FROM devices WHERE id=?', id);
        this.kickDevice(id);
      } else throw httpErr(400, 'Acción inválida.');
      this.avisarAdmins();
      return send(200, this.dispView(a));
    }

    if (p === '/api/backup' && m === 'GET') {
      await this.needAdmin(request);
      return send(200, this.exportJSON(), { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="yapur-copia-' + ymd() + '.json"' });
    }
    if (p === '/api/backups' && m === 'GET') { await this.needAdmin(request); return send(200, { copias: this.listSnapshots() }); }
    if (p === '/api/backups/restore' && m === 'POST') {
      await this.needAdmin(request);
      const b = await readBody(raw, 1e4), name = String(b.name || '');
      if (!/^(yapur-\d{4}-\d{2}-\d{2}b?|antes-de-restaurar-\d+)$/.test(name)) throw httpErr(400, 'Nombre de copia inválido.');
      return send(200, await this.restore(JSON.parse(await this.readSnapshot(name))));
    }
    if (p === '/api/restore' && m === 'POST') {
      await this.needAdmin(request);
      return send(200, await this.restore(await readBody(raw, 25e6)));
    }
    throw httpErr(404, 'No existe.');
  }
}
