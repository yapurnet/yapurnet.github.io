// Pruebas del Worker de FAVL.   Uso:  node --test favl-app/worker/
// Simulan a GitHub (fetch) y llaman al Worker como lo hace Cloudflare. No necesitan internet ni claves reales.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const RUTA = path.join(path.dirname(new URL(import.meta.url).pathname), 'favl-worker.js');
const TOKEN = 'github_pat_TOKEN_SECRETO_DE_PRUEBA_0123456789abcdef';
const CLAVE1 = 'clave-de-publicacion-uno-1234';
const CLAVE2 = 'otra_clave_de_publicacion_5678';
const REPO = 'yapurnet/yapurnet.github.io';
const BASE = 'https://favl.example.workers.dev';
const CODIGO = 'ABCD2345EFGH';
const hashDe = c => crypto.createHash('sha256').update('FAVL|' + c).digest('hex');
const HASH = hashDe(CODIGO);
const NONCE = 'a1b2c3d4e5f60718';

let contador = 0;
const fetchReal = globalThis.fetch;
const dateNowReal = Date.now;

// Un Worker nuevo (con la memoria vacía) y un GitHub simulado para cada prueba
async function montar(envExtra, opciones) {
  opciones = opciones || {};
  const gh = {
    issues: [], comentarios: {}, llamadas: [], falla: {},
    registro: opciones.registro === undefined ? { version: 1, exigir: false, claves: [{ h: HASH, i: '', c: 1, e: Date.now() + 86400000, u: 0 }] } : opciones.registro,
    etag: 'W/"v1"',
  };
  globalThis.fetch = async (url, init) => {
    init = init || {};
    const u = new URL(url);
    const h = new Headers(init.headers || {});
    gh.llamadas.push({ metodo: init.method || 'GET', ruta: u.pathname + u.search, h });
    assert.equal(u.origin, 'https://api.github.com', 'el Worker solo habla con GitHub');
    assert.equal(h.get('authorization'), 'Bearer ' + TOKEN);
    assert.ok(h.get('user-agent'), 'GitHub exige User-Agent');
    const R = (status, obj, hd) => new Response(obj === undefined ? null : JSON.stringify(obj), { status, headers: hd || {} });
    if (gh.falla.red) throw new TypeError('sin red');
    if (u.pathname === '/repos/' + REPO + '/issues' && init.method === 'POST') {
      if (gh.falla.issues) return R(gh.falla.issues, { message: 'Bad credentials ' + TOKEN });
      const j = JSON.parse(init.body);
      gh.issues.push({ number: 100 + gh.issues.length + 1, title: j.title, body: j.body });
      return R(201, { number: 100 + gh.issues.length });
    }
    if (u.pathname === '/repos/' + REPO + '/contents/favl-claves.json') {
      if (gh.falla.registro) return R(gh.falla.registro, {});
      if (gh.registro === null) return R(404, { message: 'Not Found' });
      if (h.get('if-none-match') === gh.etag) return R(304);
      return new Response(JSON.stringify(gh.registro), { status: 200, headers: { etag: gh.etag } });
    }
    if (u.pathname === '/repos/' + REPO) return gh.falla.repo ? R(gh.falla.repo, { message: 'Bad credentials ' + TOKEN }) : R(200, { full_name: REPO });
    if (u.pathname === '/repos/' + REPO + '/issues' && (init.method || 'GET') === 'GET') return gh.falla.leerIssues ? R(gh.falla.leerIssues, {}) : R(200, []);
    const m = /^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)\/comments$/.exec(u.pathname);
    if (m && (init.method || 'GET') === 'GET') {
      if (gh.falla.comentarios) return R(gh.falla.comentarios, {});
      const n = Number(m[1]);
      if (!gh.issues.some(i => i.number === n) && !gh.comentarios[n]) return R(404, { message: 'Not Found' });
      return R(200, gh.comentarios[n] || []);
    }
    return R(404, {});
  };
  const mod = await import(pathToFileURL(RUTA).href + '?v=' + (++contador));
  const env = Object.assign({ GITHUB_TOKEN: TOKEN, CLAVES_PUBLICAR: CLAVE1 }, envExtra || {});
  const respuestas = [];
  async function llamar(metodo, ruta, o) {
    o = o || {};
    const hd = Object.assign({ 'CF-Connecting-IP': o.ip || '203.0.113.7' }, o.headers || {});
    if (o.clave) hd['Authorization'] = 'Bearer ' + o.clave;
    const body = o.body === undefined ? undefined : (typeof o.body === 'string' ? o.body : JSON.stringify(o.body));
    const r = await mod.default.fetch(new Request(BASE + ruta, { method: metodo, headers: hd, body }), env);
    const txt = await r.text();
    respuestas.push(txt);
    let j = null; try { j = JSON.parse(txt); } catch (e) {}
    return { status: r.status, j, txt, headers: r.headers };
  }
  return { gh, llamar, respuestas, env };
}
test.afterEach(() => { globalThis.fetch = fetchReal; Date.now = dateNowReal; });
function sinSecretos(t) {
  t.respuestas.forEach(x => {
    assert.ok(!x.includes(TOKEN), 'una respuesta contiene la clave de GitHub');
    assert.ok(!x.includes(CLAVE1) && !x.includes(CLAVE2), 'una respuesta contiene una clave de publicación');
  });
}
const pedido = (op, extra) => Object.assign({ v: 1, n: NONCE, t: 1, op, id: 'x' }, extra || {});

test('preflight CORS y cabeceras', async () => {
  const t = await montar();
  const r = await t.llamar('OPTIONS', '/publicar');
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.match(r.headers.get('access-control-allow-headers'), /authorization/i);
  assert.match(r.headers.get('access-control-allow-headers'), /content-type/i);
  const g = await t.llamar('GET', '/');
  assert.equal(g.headers.get('access-control-allow-origin'), '*');
  assert.equal(g.headers.get('cache-control'), 'no-store');
});

test('portada: configurado y sin configurar (nunca muestra secretos)', async () => {
  const t = await montar();
  let r = await t.llamar('GET', '/');
  assert.equal(r.status, 200); assert.equal(r.j.ok, true); assert.match(r.j.publicar, /listo \(1 clave\)/); assert.equal(r.j.falta, undefined);
  r = await t.llamar('GET', '/', { headers: { Accept: 'text/html' } });
  assert.match(r.txt, /Funcionando/); assert.ok(!r.txt.includes(TOKEN));
  const v = await montar({ GITHUB_TOKEN: '', CLAVES_PUBLICAR: 'corta' });
  r = await v.llamar('GET', '/');
  assert.deepEqual(r.j.falta.length, 2); assert.match(r.j.falta.join(' '), /GITHUB_TOKEN/); assert.match(r.j.falta.join(' '), /CLAVES_PUBLICAR/);
  assert.equal(r.j.claves_descartadas, 1);
  r = await v.llamar('GET', '/', { headers: { Accept: 'text/html' } });
  assert.match(r.txt, /Falta configurar/);
  sinSecretos(t); sinSecretos(v);
});

test('/publicar: exige la clave de publicación', async () => {
  const t = await montar();
  const cuerpo = pedido('set', { d: { nombre: 'Ana', licencia: '1' } });
  let r = await t.llamar('POST', '/publicar', { body: cuerpo });
  assert.equal(r.status, 401); assert.equal(r.j.motivo, 'auth');
  r = await t.llamar('POST', '/publicar', { body: cuerpo, clave: 'clave-incorrecta-123456' });
  assert.equal(r.status, 401);
  r = await t.llamar('POST', '/publicar', { body: cuerpo, headers: { Authorization: 'Basic abc' } });
  assert.equal(r.status, 401);
  assert.equal(t.gh.issues.length, 0, 'sin clave no se crea ningún pedido');
  r = await t.llamar('POST', '/publicar', { body: cuerpo, clave: CLAVE1 });
  assert.equal(r.status, 200); assert.equal(r.j.ok, true); assert.equal(r.j.num, 101);
  assert.equal(t.gh.issues.length, 1);
  assert.equal(t.gh.issues[0].title, 'FAVL-INSTR set ' + NONCE.slice(0, 8));
  assert.equal(t.gh.issues[0].body, JSON.stringify(cuerpo), 'el cuerpo viaja tal cual');
  sinSecretos(t);
});

test('/publicar: varias claves, y una clave vieja deja de servir al sacarla', async () => {
  const t = await montar({ CLAVES_PUBLICAR: CLAVE1 + '\n' + CLAVE2 + ', ' });
  for (const c of [CLAVE1, CLAVE2]) {
    const r = await t.llamar('POST', '/publicar', { body: pedido('del'), clave: c });
    assert.equal(r.status, 200);
  }
  const sola = await montar({ CLAVES_PUBLICAR: CLAVE2 });
  const r = await sola.llamar('POST', '/publicar', { body: pedido('del'), clave: CLAVE1 });
  assert.equal(r.status, 401);
});

test('/publicar: bloqueo tras muchos intentos con clave incorrecta (solo a esa IP)', async () => {
  const t = await montar();
  for (let i = 0; i < 8; i++) assert.equal((await t.llamar('POST', '/publicar', { body: pedido('del'), clave: 'mala-mala-mala-mala-' + i })).status, 401);
  let r = await t.llamar('POST', '/publicar', { body: pedido('del'), clave: CLAVE1 });
  assert.equal(r.status, 429, 'ni la clave correcta pasa desde esa IP mientras dura el bloqueo');
  r = await t.llamar('POST', '/publicar', { body: pedido('del'), clave: CLAVE1, ip: '198.51.100.9' });
  assert.equal(r.status, 200, 'otra IP no se ve afectada');
});

test('/publicar: solo pedidos con formato válido y operaciones permitidas', async () => {
  const t = await montar();
  const malos = [
    ['ck-use no se acepta acá', pedido('ck-use', { id: HASH })],
    ['operación desconocida', pedido('borrar-todo')],
    ['versión distinta', pedido('set', { v: 2 })],
    ['nonce corto', pedido('set', { n: 'abc' })],
    ['nonce con mayúsculas', pedido('set', { n: 'A1B2C3D4E5F60718' })],
    ['sin nonce', { v: 1, op: 'set' }],
    ['arreglo', [pedido('set')]],
    ['texto que no es JSON', 'esto no es json'],
    ['null', 'null'],
  ];
  for (const [nombre, body] of malos) {
    const r = await t.llamar('POST', '/publicar', { body, clave: CLAVE1 });
    assert.equal(r.status, 400, nombre); assert.equal(r.j.motivo, 'formato', nombre);
  }
  const grande = await t.llamar('POST', '/publicar', { body: JSON.stringify(pedido('set', { d: { logo: 'x'.repeat(66000) } })), clave: CLAVE1 });
  assert.equal(grande.status, 413);
  assert.equal(t.gh.issues.length, 0, 'nada de esto llegó a GitHub');
  for (const op of ['set', 'del', 'ck-new', 'ck-del', 'ck-cfg']) {
    assert.equal((await t.llamar('POST', '/publicar', { body: pedido(op), clave: CLAVE1 })).status, 200, op);
  }
  assert.equal(t.gh.issues.length, 5);
});

test('/publicar: sin configurar o con claves de publicación inválidas', async () => {
  const t = await montar({ CLAVES_PUBLICAR: 'muy-corta' });
  let r = await t.llamar('POST', '/publicar', { body: pedido('del'), clave: 'muy-corta' });
  assert.equal(r.status, 500); assert.equal(r.j.motivo, 'config'); assert.match(r.j.texto, /CLAVES_PUBLICAR/);
  const v = await montar({ GITHUB_TOKEN: '' });
  r = await v.llamar('POST', '/publicar', { body: pedido('del'), clave: CLAVE1 });
  assert.equal(r.status, 500); assert.match(r.j.texto, /GITHUB_TOKEN/);
});

test('/clave: comprueba la clave de publicación', async () => {
  const t = await montar();
  assert.equal((await t.llamar('GET', '/clave', { clave: CLAVE1 })).status, 200);
  assert.equal((await t.llamar('GET', '/clave', { clave: 'incorrecta-incorrecta-1' })).status, 401);
  assert.equal((await t.llamar('GET', '/clave')).status, 401);
  assert.equal(t.gh.llamadas.length, 0, 'comprobar la clave no toca GitHub');
});

test('/canjear: clave válida arma el pedido con el HASH (la clave no sale del Worker)', async () => {
  const t = await montar();
  const r = await t.llamar('POST', '/canjear', { body: { codigo: 'abcd-2345-efgh' } });   // minúsculas y guiones: se normaliza
  assert.equal(r.status, 200); assert.deepEqual(r.j, { ok: true, num: 101 });
  const i = t.gh.issues[0];
  assert.match(i.title, /^FAVL-INSTR ck-use [a-f0-9]{8}$/);
  const p = JSON.parse(i.body);
  assert.equal(p.v, 1); assert.equal(p.op, 'ck-use'); assert.equal(p.id, HASH); assert.match(p.n, /^[a-f0-9]{16}$/);
  assert.ok(!i.body.includes(CODIGO) && !i.title.includes(CODIGO), 'el código en claro nunca se publica');
  sinSecretos(t);
});

test('/canjear: formato inválido, inexistente, usada, vencida: no crean pedidos', async () => {
  const ahora = Date.now();
  const reg = { version: 1, exigir: false, claves: [
    { h: HASH, i: '', c: 1, e: ahora + 86400000, u: 0 },
    { h: hashDe('USADA2345678'), i: '', c: 1, e: ahora + 86400000, u: ahora - 1000 },
    { h: hashDe('VENCDA234567'), i: '', c: 1, e: ahora - 1000, u: 0 },
  ] };
  const t = await montar({}, { registro: reg });
  for (const c of ['', 'ABC', 'ABCD2345EFGI', 'ABCD-2345-EFG0', 'A'.repeat(40), null]) {      // I y 0 no existen en el alfabeto
    const r = await t.llamar('POST', '/canjear', { body: { codigo: c } });
    assert.equal(r.status, 400, String(c)); assert.equal(r.j.motivo, 'formato');
  }
  assert.equal((await t.llamar('POST', '/canjear', { body: 'no es json' })).status, 400);
  let r = await t.llamar('POST', '/canjear', { body: { codigo: 'ZZZZ2222YYYY' } });
  assert.equal(r.status, 409); assert.equal(r.j.motivo, 'noexiste'); assert.match(r.j.texto, /no existe|anulada|venció/);
  r = await t.llamar('POST', '/canjear', { body: { codigo: 'USADA2345678' } });
  assert.equal(r.status, 409); assert.equal(r.j.motivo, 'usada'); assert.match(r.j.texto, /ya fue usada/);
  r = await t.llamar('POST', '/canjear', { body: { codigo: 'VENCDA234567' } });
  assert.equal(r.status, 409); assert.equal(r.j.motivo, 'vencida'); assert.match(r.j.texto, /venció/);
  assert.equal(t.gh.issues.length, 0);
});

test('/canjear: sin registro todavía (404) = ninguna clave existe', async () => {
  const t = await montar({}, { registro: null });
  const r = await t.llamar('POST', '/canjear', { body: { codigo: CODIGO } });
  assert.equal(r.status, 409); assert.equal(r.j.motivo, 'noexiste');
});

test('/canjear: el registro se recuerda unos segundos y luego se revalida (304)', async () => {
  let ahora = 1_000_000_000_000;
  Date.now = () => ahora;
  const t = await montar({}, { registro: { version: 1, exigir: false, claves: [{ h: HASH, i: '', c: 1, e: ahora + 86400000, u: 0 }] } });
  const lecturas = () => t.gh.llamadas.filter(x => x.ruta.includes('/contents/')).length;
  await t.llamar('POST', '/canjear', { body: { codigo: CODIGO } });
  await t.llamar('POST', '/canjear', { body: { codigo: CODIGO } });
  assert.equal(lecturas(), 1, 'dos canjes seguidos leen el registro una sola vez');
  ahora += 4000;
  const r = await t.llamar('POST', '/canjear', { body: { codigo: CODIGO } });
  assert.equal(r.status, 200);
  assert.equal(lecturas(), 2);
  assert.equal(t.gh.llamadas.filter(x => x.ruta.includes('/contents/')).pop().h.get('if-none-match'), 'W/"v1"', 'pregunta si cambió (si no cambió, GitHub no lo cuenta)');
  // el instructor anuló la clave: a los pocos segundos ya no sirve
  t.gh.registro = { version: 2, exigir: false, claves: [] }; t.gh.etag = 'W/"v2"';
  ahora += 4000;
  const x = await t.llamar('POST', '/canjear', { body: { codigo: CODIGO } });
  assert.equal(x.status, 409); assert.equal(x.j.motivo, 'noexiste');
});

test('/canjear: límite de intentos por IP', async () => {
  const t = await montar();
  let ultimo = 0;
  for (let i = 0; i < 121; i++) ultimo = (await t.llamar('POST', '/canjear', { body: { codigo: 'ZZZZ2222YYYY' } })).status;
  assert.equal(ultimo, 429);
  assert.equal((await t.llamar('POST', '/canjear', { body: { codigo: 'ZZZZ2222YYYY' }, ip: '198.51.100.20' })).status, 409);
});

test('problemas con GitHub: se avisan sin mostrar detalles ni claves', async () => {
  const t = await montar();
  t.gh.falla.issues = 401;
  let r = await t.llamar('POST', '/canjear', { body: { codigo: CODIGO } });
  assert.equal(r.status, 502); assert.equal(r.j.motivo, 'servicio'); assert.equal(r.j.gh, 401);
  r = await t.llamar('POST', '/publicar', { body: pedido('del'), clave: CLAVE1 });
  assert.equal(r.status, 502);
  t.gh.falla.issues = 403;
  r = await t.llamar('POST', '/publicar', { body: pedido('del'), clave: CLAVE1 });
  assert.equal(r.status, 503); assert.equal(r.j.motivo, 'ocupado');
  t.gh.falla.issues = 0; t.gh.falla.red = true;
  r = await t.llamar('POST', '/publicar', { body: pedido('del'), clave: CLAVE1 });
  assert.equal(r.status, 502);
  r = await t.llamar('POST', '/canjear', { body: { codigo: CODIGO } });
  assert.equal(r.status, 502);
  t.gh.falla.red = false; t.gh.falla.registro = 500;
  Date.now = () => dateNowReal() + 10000;                  // pasa el tiempo de recuerdo del registro
  r = await t.llamar('POST', '/canjear', { body: { codigo: CODIGO } });
  assert.equal(r.status, 502);
  sinSecretos(t);
});

test('/resultado: pendiente, aplicado, repetido y rechazado', async () => {
  const t = await montar();
  await t.llamar('POST', '/publicar', { body: pedido('ck-new', { id: HASH }), clave: CLAVE1 });
  let r = await t.llamar('GET', '/resultado/101');
  assert.equal(r.status, 200); assert.deepEqual(r.j, { ok: true, estado: 'PENDIENTE' });
  const bot = (cuerpo) => ({ user: { login: 'github-actions[bot]' }, body: cuerpo });
  t.gh.comentarios[101] = [bot('FAVL-OK\n\nClave publicada:   ya se puede usar.')];
  Date.now = () => dateNowReal() + 5000;                   // pasa el tiempo de recuerdo
  r = await t.llamar('GET', '/resultado/101');
  assert.deepEqual(r.j, { ok: true, estado: 'OK', texto: 'Clave publicada: ya se puede usar.' });
  t.gh.comentarios[102] = [bot('FAVL-RECHAZADO\nEsta clave ya fue usada. Pedile una nueva a tu instructor.')];
  assert.equal((await t.llamar('GET', '/resultado/102')).j.estado, 'RECHAZADO');
  t.gh.comentarios[103] = [bot('FAVL-REPETIDO\nEste pedido ya se había aplicado.')];
  assert.equal((await t.llamar('GET', '/resultado/103')).j.estado, 'REPETIDO');
  sinSecretos(t);
});

test('/resultado: solo vale lo que dice el bot de GitHub Actions', async () => {
  const t = await montar();
  t.gh.comentarios[200] = [
    { user: { login: 'yapurnet' }, body: 'FAVL-OK\nfalso' },
    { user: { login: 'un-alumno' }, body: 'FAVL-OK\nfalso' },
    { user: { login: 'github-actions[bot]' }, body: 'otra cosa que no es un resultado' },
    null, { body: 'FAVL-OK' },
  ];
  const r = await t.llamar('GET', '/resultado/200');
  assert.equal(r.j.estado, 'PENDIENTE');
});

test('/resultado: número inválido, inexistente y recuerdo de pocos segundos', async () => {
  const t = await montar();
  assert.equal((await t.llamar('GET', '/resultado/abc')).status, 404);
  assert.equal((await t.llamar('GET', '/resultado/1234567890')).status, 404);
  assert.equal((await t.llamar('GET', '/resultado/-1')).status, 404);
  assert.equal(t.gh.llamadas.length, 0, 'un número inválido no llega a GitHub');
  const r = await t.llamar('GET', '/resultado/999999');
  assert.equal(r.status, 404); assert.equal(r.j.motivo, 'noexiste');
  t.gh.comentarios[300] = [];
  await t.llamar('GET', '/resultado/300'); await t.llamar('GET', '/resultado/300'); await t.llamar('GET', '/resultado/300');
  assert.equal(t.gh.llamadas.filter(x => x.ruta.includes('/issues/300/')).length, 1, 'varios celulares preguntando por lo mismo = una sola consulta');
  assert.equal((await t.llamar('POST', '/resultado/300')).status, 405);
});

test('/resultado: GitHub caído', async () => {
  const t = await montar();
  t.gh.falla.comentarios = 500;
  const r = await t.llamar('GET', '/resultado/5');
  assert.equal(r.status, 502); assert.equal(r.j.motivo, 'servicio');
});

test('rutas y métodos desconocidos', async () => {
  const t = await montar();
  assert.equal((await t.llamar('GET', '/publicar')).status, 405);
  assert.equal((await t.llamar('GET', '/canjear')).status, 405);
  assert.equal((await t.llamar('POST', '/')).status, 405);
  assert.equal((await t.llamar('GET', '/admin')).status, 404);
  assert.equal((await t.llamar('GET', '/publicar/')).status, 405, 'la barra final no cambia nada');
  assert.equal(t.gh.issues.length, 0);
});

test('repositorio configurable y validado', async () => {
  const t = await montar({ REPO: 'otro/repo' });
  // el GitHub simulado solo conoce yapurnet/…: la llamada a otro repo da 404 → el Worker lo informa como problema del servicio
  const r = await t.llamar('POST', '/publicar', { body: pedido('del'), clave: CLAVE1 });
  assert.equal(r.status, 502);
  assert.ok(t.gh.llamadas[0].ruta.startsWith('/repos/otro/repo/issues'));
  const v = await montar({ REPO: 'esto/no/vale' });
  assert.equal((await v.llamar('GET', '/')).j.github, 'falta configurar');
});

test('portada con «?comprobar»: prueba la clave de GitHub y dice qué pasa', async () => {
  const t = await montar();
  let r = await t.llamar('GET', '/?comprobar=1');
  assert.equal(r.status, 200); assert.equal(r.j.comprobacion.ok, true); assert.match(r.j.comprobacion.resultado, /^OK/);
  t.gh.falla.repo = 401;
  r = await t.llamar('GET', '/?comprobar=1');
  assert.equal(r.j.comprobacion.ok, undefined); assert.match(r.j.comprobacion.resultado, /RECHAZÓ/);
  t.gh.falla.repo = 404;
  assert.match((await t.llamar('GET', '/?comprobar=1')).j.comprobacion.resultado, /no encuentra el repositorio/);
  t.gh.falla.repo = 0; t.gh.falla.leerIssues = 403;
  assert.match((await t.llamar('GET', '/?comprobar=1')).j.comprobacion.resultado, /Issues/);
  t.gh.falla.leerIssues = 0; t.gh.falla.red = true;
  assert.match((await t.llamar('GET', '/?comprobar=1')).j.comprobacion.resultado, /no se pudo hablar/);
  t.gh.falla.red = false;
  const h = await t.llamar('GET', '/?comprobar=1', { headers: { Accept: 'text/html' } });
  assert.match(h.txt, /Conexión con GitHub/); assert.match(h.txt, /OK: GitHub aceptó/);
  const sin = await t.llamar('GET', '/');
  assert.equal(sin.j.comprobacion, undefined, 'sin «?comprobar» no se gasta ninguna llamada a GitHub');
  assert.equal((await t.llamar('GET', '/', { headers: { Accept: 'text/html' } })).txt.includes('?comprobar=1'), true);
  const v = await montar({ GITHUB_TOKEN: '' });
  assert.match((await v.llamar('GET', '/?comprobar=1')).j.comprobacion.resultado, /falta configurar/);
  sinSecretos(t); sinSecretos(v);
});
