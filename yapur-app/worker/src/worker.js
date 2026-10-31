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
const PERM_KEYS = ['clientesTodos', 'telefono', 'dni', 'editarClientes', 'ubicacion', 'ordenesTodas', 'crearOrdenes', 'operarOrdenes', 'precios', 'cobrar', 'caja', 'anular', 'promesas', 'resumen', 'red', 'cobrarCampo', 'verTecnicos'];
const MONEY = ['cobrar', 'caja', 'anular', 'promesas', 'resumen'];
const PERM_DEF = {
  tecnico: { clientesTodos: false, telefono: true, dni: false, editarClientes: false, ubicacion: true, ordenesTodas: false, crearOrdenes: true, operarOrdenes: true, precios: false, cobrar: false, caja: false, anular: false, promesas: false, resumen: false, red: true, cobrarCampo: false, verTecnicos: false },
  oficina: { clientesTodos: true, telefono: true, dni: true, editarClientes: true, ubicacion: true, ordenesTodas: true, crearOrdenes: true, operarOrdenes: true, precios: true, cobrar: true, caja: true, anular: false, promesas: true, resumen: false, red: true, cobrarCampo: false, verTecnicos: false }
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
const CAMPO_CONCEPTOS = ['instalacion', 'reconexion', 'reclamo', 'otro'];
const CLIENT_LOCKED = ['precio', 'planId', 'extras', 'hp', 'ciclo', 'desde', 'dia', 'deudaAnt'];
const ANUL_KEYS = ['anulado', 'anuladoMotivo', 'anuladoFecha', 'anuladoPor'];
/* controles de integridad; devuelven un texto si hay que rechazar. Pueden completar datos (quién lo hizo). */
function guard(u, p, coll, existing, patch) {
  if (u.role === 'admin' && coll !== 'pagos' && coll !== 'red') return null;
  const items = isPlain(patch.items) ? patch.items : null;
  if (!items) return coll === 'pagos' || coll === 'clientes' || coll === 'ordenes' || coll === 'red' ? 'Formato inválido.' : null;
  const old = existing && isPlain(existing.items) ? existing.items : {};
  if (coll === 'clientes') {
    for (const id of Object.keys(items)) {
      const nw = items[id], prev = old[id];
      if (!isPlain(nw)) return 'Formato inválido.';
      if (!prev) { if (!p.editarClientes) return 'Tu usuario no puede dar de alta clientes.'; continue; }
      if (p.editarClientes) continue;
      for (const k of CLIENT_LOCKED) if (k in nw && !same(nw[k], prev[k])) return 'Tu usuario no puede cambiar los datos de facturación del cliente.';
      if ('promesas' in nw && !same(nw.promesas, prev.promesas) && !p.promesas) return 'Tu usuario no puede dar promesas de pago.';
    }
  } else if (coll === 'red') {
    return guardRed(u, p, old, items);
  } else if (coll === 'pagos') {
    for (const id of Object.keys(items)) {
      const nw = items[id], prev = old[id];
      if (!isPlain(nw)) return 'Formato inválido.';
      if (!prev) {
        if (u.role !== 'admin' && !p.cobrar) {
          /* quien solo cobra en la calle: instalaciones, reclamos y reconexiones, del día y por un monto válido (nunca mensualidades) */
          if (!p.cobrarCampo) return 'Tu usuario no puede registrar pagos.';
          if (!CAMPO_CONCEPTOS.includes(nw.concepto) || nw.per) return 'Tu usuario solo puede cobrar instalaciones, reclamos, reconexiones y otros cobros, no mensualidades.';
          if (!isNum(nw.monto) || nw.monto <= 0 || nw.monto > 1e8) return 'El monto del cobro no es válido.';
          if (nw.fecha !== ymd()) return 'Los cobros en la calle se registran con la fecha de hoy.';
          if (typeof nw.c !== 'string' || !ID_RE.test(nw.c)) return 'Falta el cliente del cobro.';
        }
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
const RED_KEYS = ['tipo', 'nombre', 'lat', 'lng', 'puertos', 'padre', 'ref', 'notas', 'creado', 'mod'];
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
  }
  return null;
}

/* ================= respuestas ================= */
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'Access-Control-Max-Age': '600' };
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
      return stub.fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};

/* ================= ubicación de los técnicos en horario laboral ================= */
/* Solo se guarda lo que llega dentro del horario (por defecto de 8 a 20 h, hora de Argentina) y se borra a los 14 días.
   El horario lo controla el servidor con su propio reloj: no importa lo que diga el celular. Argentina no tiene horario de verano: siempre UTC-3. */
const UBIC_DIAS = 14;
const UBIC_MIN_MS = 20e3;            // no se guarda más de un punto cada 20 segundos por técnico
const arTime = ts => { const d = new Date(ts - 3 * 3600e3); return { fecha: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() }; };
const arDayStart = fecha => Date.parse(fecha + 'T00:00:00-03:00');

/* ================= la base de datos y toda la lógica ================= */
export class YapurDB extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.env = env;
    this.streams = new Set();
    this.tickets = new Map();
    this.fails = new Map();
    this.timer = null;
    this.snapState = null;
    this.snapBusy = false;
    this.USERS = new Map();
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS docs(coll TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, upd INTEGER NOT NULL, PRIMARY KEY(coll,id)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, usuario TEXT UNIQUE NOT NULL, nombre TEXT NOT NULL, role TEXT NOT NULL, tel TEXT DEFAULT '', permisos TEXT, activo INTEGER NOT NULL DEFAULT 1, salt TEXT, hash TEXT, created INTEGER, last_login INTEGER);
      CREATE TABLE IF NOT EXISTS sessions(th TEXT PRIMARY KEY, uid TEXT NOT NULL, created INTEGER, last INTEGER);
      CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS fails(k TEXT PRIMARY KEY, n INTEGER NOT NULL, until INTEGER NOT NULL, t INTEGER NOT NULL) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS routers(id TEXT PRIMARY KEY, nombre TEXT NOT NULL, th TEXT NOT NULL, kinds TEXT NOT NULL DEFAULT 'q', creado INTEGER, visto INTEGER, run TEXT, total INTEGER NOT NULL DEFAULT 0, ident TEXT, ros TEXT, ip TEXT);
      CREATE TABLE IF NOT EXISTS rsnap(router TEXT NOT NULL, run TEXT NOT NULL, part INTEGER NOT NULL, data TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY(router,run,part)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS ubic(uid TEXT NOT NULL, ts INTEGER NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, acc REAL, PRIMARY KEY(uid,ts)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS snapshots(name TEXT NOT NULL, part INTEGER NOT NULL, ts INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(name,part)) WITHOUT ROWID;
    `);
    this.sql.exec('DELETE FROM sessions WHERE last<?', Date.now() - 180 * 864e5);
    this.sql.exec('DELETE FROM fails WHERE t<?', Date.now() - 864e5);
    this.sql.exec('DELETE FROM ubic WHERE ts<?', Date.now() - UBIC_DIAS * 864e5);
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
  async newSession(uid) {
    const token = b64u(rnd(32));
    this.sql.exec('INSERT INTO sessions(th,uid,created,last) VALUES(?,?,?,?)', await sha(token), uid, Date.now(), Date.now());
    return token;
  }
  async authOf(request) {
    const m = /^Bearer\s+(\S+)$/.exec(request.headers.get('authorization') || '');
    if (!m) return null;
    const th = await sha(m[1]);
    const s = this.q1('SELECT uid,last FROM sessions WHERE th=?', th);
    if (!s) return null;
    const u = this.USERS.get(s.uid);
    if (!u || !u.activo) return null;
    if (Date.now() - s.last > 180 * 864e5) { this.sql.exec('DELETE FROM sessions WHERE th=?', th); return null; }
    if (Date.now() - s.last > 60e3) this.sql.exec('UPDATE sessions SET last=? WHERE th=?', Date.now(), th);
    return { user: u, th };
  }
  async needAuth(request) { const a = await this.authOf(request); if (!a) throw httpErr(401, 'Tu sesión terminó. Entrá de nuevo.', 'unauthenticated'); return a; }
  async needAdmin(request) { const a = await this.needAuth(request); if (a.user.role !== 'admin') throw httpErr(403, 'Solo el administrador puede hacer esto.', 'permission_denied'); return a; }
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
      const d = Object.assign({}, data, { perfiles: this.perfilesView() });
      if (!p.precios && Array.isArray(d.servicios)) d.servicios = d.servicios.map(s => { const c = Object.assign({}, s); delete c.precio; delete c.hist; return c; });
      return d;
    }
    if (u.role === 'admin') return data;
    if (coll === 'planes') { if (p.precios) return data; const c = Object.assign({}, data); delete c.precio; delete c.hist; return c; }
    if (coll === 'clientes') {
      const drop = [];
      if (!p.precios) drop.push('precio', 'hp');
      if (!p.precios && !p.cobrar && !p.caja) drop.push('deudaAnt');
      if (!p.dni) drop.push('dni');
      if (!p.telefono) drop.push('tel', 'tel2');
      return drop.length ? strip(data, drop) : data;
    }
    return data;
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
    let out;
    this.tx(() => {
      const existing = this.readDoc(coll, id);
      if (coll === 'ajustes') { data = Object.assign({}, data); delete data.perfiles; }
      const why = guard(u, p, coll, existing, data);
      if (why) throw httpErr(403, why, 'permission_denied');
      if (coll === 'red') { const inUse = this.redInUse(existing, data.items); if (inUse) throw httpErr(409, inUse, 'failed_precondition'); }
      const next = op === 'set' || !existing ? data : deepMerge(existing, data);
      const s = JSON.stringify(next);
      /* la base de Cloudflare admite hasta 2 MB por fila: se mide en bytes, no en letras */
      if (s.length > 6e5 && bytesOf(s) > 1.9e6) throw httpErr(413, 'El documento es demasiado grande.', 'quota_exceeded');
      this.putDoc(coll, id, s);
      this.SEQ++;
      out = { seq: this.SEQ, next, patch: data };
    });
    const sendOp = coll === 'ajustes' ? 'set' : op;
    const payload = coll === 'ajustes' ? out.next : out.patch;
    this.broadcastDoc(coll, id, sendOp, payload, out.seq);
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

  /* los cobros que registró esta persona en los últimos días (quien cobra en la calle no lee la caja entera) */
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

  /* ----- tiempo real (SSE) ----- */
  sse(s, event, data) {
    try {
      if (s.c.desiredSize !== null && s.c.desiredSize < -300) throw new Error('lento');
      s.c.enqueue(enc.encode('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'));
    } catch (e) { this.endStream(s); }
  }
  endStream(s) { this.streams.delete(s); try { s.c.close(); } catch (e) { /* ya estaba cerrado */ } }
  broadcastDoc(coll, id, op, data, seq) {
    for (const s of [...this.streams]) {
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
    for (const s of [...this.streams]) if (s.uid === uid) {
      if (!u || !u.activo) { this.sse(s, 'kick', {}); this.endStream(s); } else this.sse(s, 'me', meOf(u));
    }
  }
  kickUser(uid) { for (const s of [...this.streams]) if (s.uid === uid) { this.sse(s, 'kick', {}); this.endStream(s); } }
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
  openStream(u) {
    const self = this;
    let s;
    const body = new ReadableStream({
      start(c) {
        s = { c, uid: u.id };
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
    return '{"app":"yapur-gestion","v":1,"ts":' + Date.now() + ',"docs":[' + docs.join(',') + '],"users":[' + users.join(',') + ']}';
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
      this.SEQ++;
    });
    this.loadUsers();
    for (const s of [...this.streams]) { this.sse(s, 'kick', {}); this.endStream(s); }
    return { docs: rows.length, usuarios: report };
  }

  /* ================= routers MikroTik (solo lectura) =================
     El sistema NO se conecta a los routers ni guarda usuario ni clave de ninguno: cada router manda por su cuenta,
     con un script de solo lectura, la lista de sus colas, secretos PPPoE y leases DHCP estáticos. Con este token
     lo único que se puede hacer es dejar esa lista acá: no hay ningún camino para cortar o cambiar algo en un router. */
  routerPublic(r) {
    return { id: r.id, nombre: r.nombre, kinds: String(r.kinds || 'q').split(',').filter(Boolean), creado: r.creado, visto: r.visto || null, total: r.total || 0, ident: r.ident || '', ros: r.ros || '', hayDatos: !!r.run };
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

  /* ----- ubicación de los técnicos ----- */
  ubicHorario() {
    const r = this.q1("SELECT v FROM meta WHERE k='ubic_horario'");
    const [d, h] = String(r && r.v || '8,20').split(',').map(Number);
    return Number.isInteger(d) && Number.isInteger(h) && d >= 0 && h <= 24 && d < h ? { desde: d, hasta: h } : { desde: 8, hasta: 20 };
  }
  ubicDentro(ts, h) { const hr = arTime(ts).min / 60; return hr >= h.desde && hr < h.hasta; }
  ubicAcepto(uid) { return !!this.q1('SELECT 1 x FROM meta WHERE k=?', 'ubicok:' + uid); }
  ubicEstado(u) {
    const h = this.ubicHorario();
    return { aplica: u.role === 'tecnico', acepto: this.ubicAcepto(u.id), desde: h.desde, hasta: h.hasta, dentro: this.ubicDentro(Date.now(), h), dias: UBIC_DIAS };
  }
  ubicGuardar(u, b) {
    if (u.role !== 'tecnico') throw httpErr(403, 'Solo los técnicos comparten su ubicación.');
    if (!this.ubicAcepto(u.id)) throw httpErr(409, 'Primero hay que aceptar el aviso de ubicación.', 'sin_aceptar');
    const h = this.ubicHorario(), now = Date.now();
    const pts = (Array.isArray(b.pts) ? b.pts : [b]).filter(isPlain).slice(0, 30);
    pts.forEach(x => { const t = Number(x.ts); x._ts = isFinite(t) && t <= now + 60e3 && t >= now - 15 * 60e3 ? t : now; });
    pts.sort((x, y) => x._ts - y._ts);
    let n = 0, fuera = 0;
    for (const x of pts) {
      const lat = Number(x.lat), lng = Number(x.lng);
      if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) continue;
      if (!this.ubicDentro(x._ts, h)) { fuera++; continue; }
      if (this.q1('SELECT 1 x FROM ubic WHERE uid=? AND ts>? AND ts<?', u.id, x._ts - UBIC_MIN_MS, x._ts + UBIC_MIN_MS)) continue;   // ya hay uno a menos de 20 s (también sirve para los puntos que llegan tarde)
      const acc = Number(x.acc);
      this.sql.exec('INSERT OR REPLACE INTO ubic(uid,ts,lat,lng,acc) VALUES(?,?,?,?,?)', u.id, x._ts, Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6, isFinite(acc) && acc >= 0 ? Math.min(Math.round(acc), 99999) : null);
      n++;
    }
    if (Math.random() < 0.01) this.sql.exec('DELETE FROM ubic WHERE ts<?', now - UBIC_DIAS * 864e5);
    return { ok: true, guardados: n, fuera_horario: n === 0 && fuera > 0, desde: h.desde, hasta: h.hasta };
  }
  ubicLista(dia) {
    const h = this.ubicHorario(), ahora = Date.now(), hoy = arTime(ahora).fecha;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || isNaN(arDayStart(dia))) dia = hoy;
    const t0 = arDayStart(dia), t1 = t0 + 864e5;
    const tecnicos = [...this.USERS.values()].filter(u => u.role === 'tecnico' && u.activo).map(u => {
      const ultima = this.q1('SELECT ts,lat,lng,acc FROM ubic WHERE uid=? AND ts>=? AND ts<? ORDER BY ts DESC LIMIT 1', u.id, t0, t1) || null;
      const todos = this.q('SELECT ts,lat,lng FROM ubic WHERE uid=? AND ts>=? AND ts<? ORDER BY ts', u.id, t0, t1);
      const paso = Math.max(1, Math.ceil(todos.length / 240));
      const ruta = todos.filter((_, i) => i % paso === 0 || i === todos.length - 1).map(r => [r.ts, r.lat, r.lng]);
      return { id: u.id, nombre: u.nombre, tel: u.tel || '', acepto: this.ubicAcepto(u.id), ultima, puntos: todos.length, ruta };
    });
    return { dia, hoy, ahora, horario: h, dias: UBIC_DIAS, tecnicos };
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
      return send(200, { token: await this.newSession(id), me: meOf(this.USERS.get(id)) });
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
      this.sql.exec('UPDATE users SET last_login=? WHERE id=?', Date.now(), u.id); u.last_login = Date.now();
      return send(200, { token: await this.newSession(u.id), me: meOf(u) });
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
      this.tickets.set(t, { uid: a.user.id, exp: Date.now() + 30e3 });
      this.ensureTimer();
      return send(200, { t });
    }
    if (p === '/api/stream' && m === 'GET') {
      const t = url.searchParams.get('t'), tk = this.tickets.get(t);
      this.tickets.delete(t);
      if (!tk || tk.exp < Date.now()) return send(401, { error: 'ticket', code: 'unauthenticated' });
      const u = this.USERS.get(tk.uid);
      if (!u || !u.activo) return send(401, { error: 'usuario', code: 'unauthenticated' });
      return this.openStream(u);
    }
    if (p === '/api/mis-cobros' && m === 'GET') {
      const a = await this.needAuth(request);
      return send(200, this.misCobros(a.user, Math.max(1, Math.min(31, parseInt(url.searchParams.get('dias') || '7', 10) || 7))));
    }
    if (p === '/api/ubicacion/estado' && m === 'GET') return send(200, this.ubicEstado((await this.needAuth(request)).user));
    if (p === '/api/ubicacion/acepto' && m === 'POST') {
      const a = await this.needAuth(request);
      if (a.user.role !== 'tecnico') throw httpErr(403, 'Solo los técnicos comparten su ubicación.');
      this.sql.exec('INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)', 'ubicok:' + a.user.id, String(Date.now()));
      return send(200, this.ubicEstado(a.user));
    }
    if (p === '/api/ubicacion' && m === 'POST') return send(200, this.ubicGuardar((await this.needAuth(request)).user, readBody(raw, 2e5)));
    if (p === '/api/ubicaciones' && m === 'GET') {
      const a = await this.needAuth(request);
      if (!effPerms(a.user).verTecnicos) throw httpErr(403, 'No tenés permiso para ver la ubicación de los técnicos.');
      return send(200, this.ubicLista(url.searchParams.get('dia') || ''));
    }
    if (p === '/api/ubicacion/horario' && m === 'POST') {
      await this.needAdmin(request);
      const b = readBody(raw, 1e3), d = Number(b.desde), h = Number(b.hasta);
      if (!Number.isInteger(d) || !Number.isInteger(h) || d < 0 || h > 24 || d >= h) throw httpErr(400, 'El horario no es válido: «desde» tiene que ser menor que «hasta» (de 0 a 24).');
      this.sql.exec('INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)', 'ubic_horario', d + ',' + h);
      return send(200, { horario: this.ubicHorario() });
    }
    let mm;
    if (p === '/api/router/ingest' && m === 'POST') return send(200, await this.routerIngest(request, url, raw));
    if (p === '/api/routers' && m === 'GET') { await this.needAdmin(request); return send(200, { routers: this.routerList() }); }
    if (p === '/api/routers' && m === 'POST') { await this.needAdmin(request); return send(200, await this.routerCreate(readBody(raw, 1e4))); }
    if ((mm = /^\/api\/routers\/(r[0-9a-f]{10})(\/token|\/items)?$/.exec(p))) {
      await this.needAdmin(request);
      const id = mm[1], r = this.q1('SELECT * FROM routers WHERE id=?', id);
      if (!r) throw httpErr(404, 'No existe ese router.');
      if (mm[2] === '/items' && m === 'GET') return send(200, this.routerItems(id), { 'Content-Type': 'application/json; charset=utf-8' });
      if (mm[2] === '/token' && m === 'POST') return send(200, { token: await this.routerNewToken(id) });
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
