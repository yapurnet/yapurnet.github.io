// FAVL Bandera Vuela — Worker de Cloudflare: la «puerta» entre la app y GitHub.
//
// Para qué sirve: hasta ahora la clave de GitHub (la que permite abrir pedidos en el repositorio) viajaba DENTRO de la APK,
// y una APK pública se puede abrir y sacarle la clave. Con este Worker la clave vive solo acá (como secreto de Cloudflare)
// y la app únicamente conoce la dirección del Worker. El Worker revisa cada pedido y recién entonces lo manda a GitHub.
//
// Qué deja hacer, y a quién:
//   · Alumnos (sin clave):   POST /canjear         → gastar su clave personal de examen (el Worker comprueba que exista, que no
//                                                    esté usada ni vencida, y arma el pedido; la clave NUNCA llega a GitHub, solo su hash)
//                            GET  /resultado/<n>   → ver cómo salió un pedido (lo contesta el bot de GitHub)
//   · Instructores (con la «clave de publicación»):
//                            POST /publicar        → cambios de instructores y claves personales (set, del, ck-new, ck-del, ck-cfg)
//                            GET  /clave           → comprobar que la clave de publicación es correcta
//   · Cualquiera:            GET  /                → comprobación de que el Worker está andando (no muestra ningún secreto)
//                            GET  /?comprobar=1    → además prueba que GitHub acepte la clave del Worker (sirve para detectar una clave vencida)
//
// Configuración (Cloudflare > Workers > tu Worker > Settings > Variables and Secrets):
//   GITHUB_TOKEN      (secreto)   clave de GitHub de grano fino: solo este repositorio, permiso «Issues: Read and write»
//   CLAVES_PUBLICAR   (secreto)   una o varias claves de publicación, separadas por coma o salto de línea
//                                 (16 a 100 caracteres: letras, números, guion y guion bajo). Una por instructor permite
//                                 retirarle el acceso a uno solo sin tocar a los demás.
//   REPO              (variable)  opcional, «usuario/repositorio» (por defecto yapurnet/yapurnet.github.io)
//
// El código no usa ninguna librería: se puede pegar tal cual en el editor de Cloudflare.

const REPO_DEFECTO = 'yapurnet/yapurnet.github.io';
const GH = 'https://api.github.com';
const OPS_PUBLICAR = ['set', 'del', 'ck-new', 'ck-del', 'ck-cfg'];   // «ck-use» solo se acepta por /canjear
const RE_NONCE = /^[a-f0-9]{16,32}$/;
const RE_CK = /^[A-HJKMNP-Z2-9]{12}$/;
const RE_PUBKEY = /^[A-Za-z0-9_-]{16,100}$/;
const MAX_CUERPO = 65000;                 // el cuerpo de un issue admite 65536 caracteres
const TTL_REGISTRO_MS = 3000;
const TTL_RESULTADO_MS = 2000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

/* ---------- utilidades ---------- */
function json(status, obj, extra) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, CORS, extra || {}),
  });
}
function falla(status, motivo, texto, extra) { return json(status, Object.assign({ ok: false, motivo, texto }, extra || {})); }

function hex(buf) { return Array.from(new Uint8Array(buf)).map(b => ('0' + b.toString(16)).slice(-2)).join(''); }
async function sha256(txt) { return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt))); }
async function sha256Hex(txt) { return hex(await sha256(txt)); }
function aleatorioHex(bytes) { const u = new Uint8Array(bytes); crypto.getRandomValues(u); return hex(u); }

// Comparación que tarda lo mismo acierte o falle (compara los hashes de ambos textos)
async function iguales(a, b) {
  const x = await sha256(a), y = await sha256(b);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

function leerConfig(env) {
  env = env || {};
  const token = String(env.GITHUB_TOKEN || '').trim();
  const repo = String(env.REPO || REPO_DEFECTO).trim();
  const brutas = String(env.CLAVES_PUBLICAR || '').split(/[\s,;]+/).filter(Boolean);
  const claves = brutas.filter(c => RE_PUBKEY.test(c));
  const faltan = [];
  if (!token) faltan.push('GITHUB_TOKEN');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) faltan.push('REPO (con formato usuario/repositorio)');
  const faltanPublicar = faltan.slice();
  if (!claves.length) faltanPublicar.push(brutas.length ? 'CLAVES_PUBLICAR (ninguna tiene un formato válido: 16 a 100 letras, números, - o _)' : 'CLAVES_PUBLICAR');
  return { token, repo, claves, descartadas: brutas.length - claves.length, faltan, faltanPublicar, dueno: repo.split('/')[0].toLowerCase() };
}

/* ---------- límites por dirección IP (en memoria: frenan abusos groseros; Cloudflare también tiene sus propias protecciones) ---------- */
const ventanas = new Map();
function dentroDelLimite(clave, max, ms) {
  const ahora = Date.now();
  let v = ventanas.get(clave);
  if (!v || ahora - v.t >= ms) {
    if (ventanas.size > 4000) { for (const [k, w] of ventanas) if (ahora - w.t >= w.ms) ventanas.delete(k); }
    v = { t: ahora, n: 0, ms };
    ventanas.set(clave, v);
  }
  v.n++;
  return v.n <= max;
}
function yaSePaso(clave, max) { const v = ventanas.get(clave); return !!(v && Date.now() - v.t < v.ms && v.n >= max); }

/* ---------- GitHub ---------- */
function cabeceras(cfg, accept) {
  return {
    'Authorization': 'Bearer ' + cfg.token,
    'Accept': accept || 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'favl-worker',            // GitHub rechaza los pedidos sin User-Agent
  };
}
// Errores de GitHub que son un problema del servicio (no de quien llama): se avisan sin mostrar detalles
function errorServicio(status) { const e = new Error('github ' + status); e.servicio = true; e.gh = status; return e; }
async function gh(cfg, ruta, init) {
  let r;
  try { r = await fetch(GH + ruta, init); } catch (e) { throw errorServicio(0); }
  return r;
}
function respuestaServicio(e) {
  const g = (e && e.gh) || 0;
  if (g === 403 || g === 429) return falla(503, 'ocupado', 'GitHub está limitando los pedidos en este momento. Probá de nuevo en un minuto.', { gh: g });
  return falla(502, 'servicio', 'El servicio de claves tiene un problema (no es tuyo). Avisale al administrador.', { gh: g });
}

async function crearIssue(cfg, titulo, cuerpo) {
  const r = await gh(cfg, '/repos/' + cfg.repo + '/issues', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, cabeceras(cfg)),
    body: JSON.stringify({ title: titulo, body: cuerpo }),
  });
  if (r.status !== 201) throw errorServicio(r.status);
  let j; try { j = await r.json(); } catch (e) { j = null; }
  if (!j || !Number.isInteger(j.number)) throw errorServicio(0);
  return j.number;
}

// Registro público de claves (solo hashes y fechas). Se lee por la API (sin el retraso de GitHub Pages) y se recuerda unos segundos.
let cacheRegistro = null;
async function registro(cfg) {
  const ahora = Date.now();
  if (cacheRegistro && cacheRegistro.repo === cfg.repo && ahora - cacheRegistro.t < TTL_REGISTRO_MS) return cacheRegistro.claves;
  const h = cabeceras(cfg, 'application/vnd.github.raw+json');
  if (cacheRegistro && cacheRegistro.repo === cfg.repo && cacheRegistro.etag) h['If-None-Match'] = cacheRegistro.etag;
  const r = await gh(cfg, '/repos/' + cfg.repo + '/contents/favl-claves.json', { headers: h });
  if (r.status === 304 && cacheRegistro) { cacheRegistro.t = ahora; return cacheRegistro.claves; }
  if (r.status === 404) { cacheRegistro = { repo: cfg.repo, t: ahora, etag: '', claves: [] }; return []; }   // todavía no se creó ninguna clave
  if (!r.ok) throw errorServicio(r.status);
  let j;
  try { j = JSON.parse(await r.text()); } catch (e) { throw errorServicio(0); }
  const claves = [];
  if (j && Array.isArray(j.claves)) {
    j.claves.forEach(k => {
      if (k && typeof k.h === 'string' && /^[0-9a-f]{64}$/.test(k.h)) claves.push({ h: k.h, e: Number(k.e) || 0, u: Number(k.u) || 0 });
    });
  }
  cacheRegistro = { repo: cfg.repo, t: ahora, etag: r.headers.get('etag') || '', claves };
  return claves;
}

/* ---------- servicios ---------- */
function ipDe(req) { return req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For') || 'sin-ip'; }

// Devuelve null si la clave de publicación es correcta; si no, la respuesta de error
async function exigirClavePublicar(req, cfg, ip) {
  if (cfg.faltanPublicar.length) return falla(500, 'config', 'El Worker no está configurado del todo. Falta: ' + cfg.faltanPublicar.join(', ') + '.');
  if (yaSePaso('fallos|' + ip, 8)) return falla(429, 'limite', 'Demasiados intentos con una clave incorrecta. Esperá unos minutos.');
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization') || '');
  let ok = false;
  if (m) { for (const c of cfg.claves) { if (await iguales(m[1], c)) ok = true; } }
  if (!ok) {
    dentroDelLimite('fallos|' + ip, 8, 10 * 60000);
    return falla(401, 'auth', 'La clave de publicación no es correcta.');
  }
  return null;
}

async function leerJson(req, max) {
  const largo = Number(req.headers.get('Content-Length') || 0);
  if (largo > max) return { error: falla(413, 'formato', 'El pedido es demasiado grande.') };
  const txt = await req.text();
  if (txt.length > max) return { error: falla(413, 'formato', 'El pedido es demasiado grande.') };
  let obj;
  try { obj = JSON.parse(txt); } catch (e) { return { error: falla(400, 'formato', 'El pedido no tiene el formato esperado.') }; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { error: falla(400, 'formato', 'El pedido no tiene el formato esperado.') };
  return { txt, obj };
}

async function publicar(req, cfg) {
  const ip = ipDe(req);
  const no = await exigirClavePublicar(req, cfg, ip);
  if (no) return no;
  if (!dentroDelLimite('pub|' + ip, 60, 60000)) return falla(429, 'limite', 'Demasiados pedidos seguidos. Esperá un minuto.');
  const l = await leerJson(req, MAX_CUERPO);
  if (l.error) return l.error;
  const p = l.obj;
  if (p.v !== 1 || typeof p.n !== 'string' || !RE_NONCE.test(p.n) || OPS_PUBLICAR.indexOf(p.op) < 0) {
    return falla(400, 'formato', 'El pedido no tiene el formato esperado.');
  }
  try {
    const num = await crearIssue(cfg, 'FAVL-INSTR ' + p.op + ' ' + p.n.slice(0, 8), l.txt);
    return json(200, { ok: true, num });
  } catch (e) { return respuestaServicio(e); }
}

// (el límite es holgado porque toda un aula puede salir a internet por la misma dirección; probar claves al azar no sirve: tienen 31^12 combinaciones)
async function canjear(req, cfg) {
  if (cfg.faltan.length) return falla(500, 'config', 'El Worker no está configurado del todo. Falta: ' + cfg.faltan.join(', ') + '.');
  const ip = ipDe(req);
  if (!dentroDelLimite('canje|' + ip, 120, 60000)) return falla(429, 'limite', 'Demasiados intentos seguidos. Esperá un minuto.');
  const l = await leerJson(req, 400);
  if (l.error) return l.error;
  const codigo = String(l.obj.codigo == null ? '' : l.obj.codigo).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!RE_CK.test(codigo)) return falla(400, 'formato', 'La clave no tiene el formato esperado (12 letras y números).');
  const h = await sha256Hex('FAVL|' + codigo);
  let claves;
  try { claves = await registro(cfg); } catch (e) { return respuestaServicio(e); }
  const k = claves.find(x => x.h === h);
  if (!k) return falla(409, 'noexiste', 'La clave no existe, fue anulada o venció. Revisala o pedile una nueva a tu instructor.');
  if (k.u > 0) return falla(409, 'usada', 'Esta clave ya fue usada. Pedile una nueva a tu instructor.');
  if (k.e <= Date.now()) return falla(409, 'vencida', 'Esta clave venció. Pedile una nueva a tu instructor.');
  const n = aleatorioHex(8);
  const cuerpo = JSON.stringify({ v: 1, n, t: Date.now(), op: 'ck-use', id: h });
  try {
    const num = await crearIssue(cfg, 'FAVL-INSTR ck-use ' + n.slice(0, 8), cuerpo);
    return json(200, { ok: true, num });
  } catch (e) { return respuestaServicio(e); }
}

const cacheResultados = new Map();
async function resultado(req, cfg, num) {
  if (cfg.faltan.length) return falla(500, 'config', 'El Worker no está configurado del todo. Falta: ' + cfg.faltan.join(', ') + '.');
  if (!dentroDelLimite('res|' + ipDe(req), 600, 60000)) return falla(429, 'limite', 'Demasiadas consultas seguidas. Esperá un momento.');
  const ahora = Date.now();
  const c = cacheResultados.get(num);
  if (c && ahora - c.t < TTL_RESULTADO_MS) return json(200, c.cuerpo);
  let r;
  try {
    r = await gh(cfg, '/repos/' + cfg.repo + '/issues/' + num + '/comments?per_page=10', { headers: cabeceras(cfg) });
    if (r.status === 404 || r.status === 410) return falla(404, 'noexiste', 'No existe ese pedido.');
    if (!r.ok) throw errorServicio(r.status);
  } catch (e) { return respuestaServicio(e); }
  let arr;
  try { arr = await r.json(); } catch (e) { return respuestaServicio(errorServicio(0)); }
  let cuerpo = { ok: true, estado: 'PENDIENTE' };
  for (const x of (Array.isArray(arr) ? arr : [])) {
    if (!x || !x.user || x.user.login !== 'github-actions[bot]' || typeof x.body !== 'string') continue;
    const m = /^FAVL-(OK|REPETIDO|RECHAZADO)\b/.exec(x.body);
    if (m) { cuerpo = { ok: true, estado: m[1], texto: x.body.split('\n').slice(1).join(' ').replace(/\s+/g, ' ').trim().slice(0, 220) }; break; }
  }
  if (cacheResultados.size > 300) cacheResultados.clear();
  cacheResultados.set(num, { t: ahora, cuerpo });
  return json(200, cuerpo);
}

// Prueba que GitHub acepta la clave del Worker y que ve el repositorio (se pide con «?comprobar»; no muestra ninguna clave)
async function comprobarGitHub(cfg) {
  if (cfg.faltan.length) return { resultado: 'no se puede probar: falta configurar' };
  if (!dentroDelLimite('probar', 20, 60000)) return { resultado: 'probá de nuevo en un minuto' };
  try {
    const r = await gh(cfg, '/repos/' + cfg.repo, { headers: cabeceras(cfg) });
    if (r.status === 401) return { resultado: 'GitHub RECHAZÓ la clave (venció, se revocó o está mal copiada)', gh: 401 };
    if (r.status === 404) return { resultado: 'GitHub no encuentra el repositorio ' + cfg.repo + ' con esta clave (¿la clave tiene acceso a ese repositorio?)', gh: 404 };
    if (!r.ok) return { resultado: 'GitHub contestó un error', gh: r.status };
    const i = await gh(cfg, '/repos/' + cfg.repo + '/issues?per_page=1', { headers: cabeceras(cfg) });
    if (!i.ok) return { resultado: 'GitHub ve el repositorio pero no deja leer los pedidos (Issues): revisá el permiso «Issues: Read and write»', gh: i.status };
    return { resultado: 'OK: GitHub aceptó la clave y ve el repositorio ' + cfg.repo, ok: true };
  } catch (e) { return { resultado: 'no se pudo hablar con GitHub' }; }
}

async function portada(req, cfg, comprobar) {
  const estado = {
    ok: true, servicio: 'FAVL', version: 1,
    github: cfg.faltan.length === 0 ? 'configurado' : 'falta configurar',
    publicar: cfg.faltanPublicar.length === 0 ? ('listo (' + cfg.claves.length + (cfg.claves.length === 1 ? ' clave' : ' claves') + ')') : 'falta configurar',
  };
  if (cfg.faltanPublicar.length) estado.falta = cfg.faltanPublicar;
  if (cfg.descartadas) estado.claves_descartadas = cfg.descartadas;
  const prueba = comprobar ? await comprobarGitHub(cfg) : null;
  if (prueba) estado.comprobacion = prueba;
  if ((req.headers.get('Accept') || '').indexOf('text/html') >= 0) {
    const listo = cfg.faltanPublicar.length === 0;
    const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FAVL</title>' +
      '<body style="font:16px/1.5 system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px">' +
      '<h2>FAVL Bandera Vuela — servicio de claves</h2>' +
      '<p><b>' + (listo ? '✔ Funcionando.' : '⚠ Falta configurar.') + '</b></p>' +
      '<ul><li>Clave de GitHub: ' + esc(estado.github) + '</li><li>Publicación de instructores y claves: ' + esc(estado.publicar) + '</li></ul>' +
      (listo ? '' : '<p>Falta cargar en Cloudflare (Settings &gt; Variables and Secrets): <b>' + esc(cfg.faltanPublicar.join(', ')) + '</b></p>') +
      (prueba ? '<p><b>Conexión con GitHub:</b> ' + esc(prueba.resultado) + '</p>' : '<p><a href="?comprobar=1">Comprobar la conexión con GitHub</a></p>') +
      '<p style="color:#666;font-size:13px">Esta página no muestra ninguna clave.</p></body>';
    return new Response(html, { status: 200, headers: Object.assign({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, CORS) });
  }
  return json(200, estado);
}

/* ---------- entrada ---------- */
export default {
  async fetch(req, env) {
    try {
      const url = new URL(req.url);
      const ruta = url.pathname.replace(/\/+$/, '') || '/';
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      const cfg = leerConfig(env);
      if (ruta === '/') return req.method === 'GET' ? await portada(req, cfg, url.searchParams.has('comprobar')) : falla(405, 'metodo', 'Método no permitido.');
      if (ruta === '/publicar') return req.method === 'POST' ? await publicar(req, cfg) : falla(405, 'metodo', 'Método no permitido.');
      if (ruta === '/canjear') return req.method === 'POST' ? await canjear(req, cfg) : falla(405, 'metodo', 'Método no permitido.');
      if (ruta === '/clave') {
        if (req.method !== 'GET' && req.method !== 'POST') return falla(405, 'metodo', 'Método no permitido.');
        return (await exigirClavePublicar(req, cfg, ipDe(req))) || json(200, { ok: true });
      }
      const m = /^\/resultado\/(\d{1,9})$/.exec(ruta);
      if (m) return req.method === 'GET' ? await resultado(req, cfg, Number(m[1])) : falla(405, 'metodo', 'Método no permitido.');
      return falla(404, 'noexiste', 'No existe.');
    } catch (e) {
      return falla(500, 'interno', 'Error interno del servicio.');
    }
  },
};
