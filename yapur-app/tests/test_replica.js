'use strict';
/* Servidor de respaldo: dos servidores de verdad (workerd) que se hablan. A trabaja y B espera.
   Cubre: primera copia completa, cambios al vuelo (documentos, borrados, usuarios, contratos, plantilla), B solo deja mirar, clave del respaldo,
   traspaso ordenado sin perder el último cambio, traspaso de emergencia con A caído y su vuelta, restauración de una copia y la función apagada sin variables. */
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const { start } = require('./harness');
let okN = 0, failN = 0;
const t = (name, cond, extra) => { if (cond) { okN++; console.log('ok   ' + name); } else { failN++; console.log('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 400) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function call(base, method, p, body, token, hdr) {
  const r = await fetch(base + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}, hdr || {}), body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) { /* sin cuerpo */ }
  return { s: r.status, j };
}
/* espera hasta que se cumpla algo (el envío al respaldo tarda un segundo o dos) */
async function hasta(fn, ms) { const fin = Date.now() + (ms || 20000); let v; while (Date.now() < fin) { try { v = await fn(); if (v) return v; } catch (e) { /* todavía no */ } await sleep(300); } return v; }
/* una firma de mentira: un PNG de verdad */
function crc32(b) { let c, crc = ~0; for (let n = 0; n < b.length; n++) { c = (crc ^ b[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function firmaPng(seed) {
  const w = 120, h = 50, raw = Buffer.alloc((w * 3 + 1) * h); let x = seed || 7;
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let i = 0; i < w * 3; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; raw[y * (w * 3 + 1) + 1 + i] = (x >> 16) & 0xff; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
const TITULAR = { nombre: 'Rosa Graciela Cejas', dni: '20.111.222', dir: 'Calle 9 N° 123', loc: 'Añatuya', tel: '3844123456' };
const EQUIPOS = [{ t: 'ONU', d: 'Huawei HG8145V5', s: '48575443AABBCCDD', n: 1, e: 'nuevo', o: '' }];

(async () => {
  const code = 'TEST-CODE-1234-ABCD', KEY = 'clave-de-respaldo-de-prueba-0123456789abcdef';
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'yapur-repA-')), dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'yapur-repB-')), dirC = fs.mkdtempSync(path.join(os.tmpdir(), 'yapur-repC-'));
  const pA = 21000 + Math.floor(Math.random() * 6000) * 2, pB = pA + 20000;
  const URL_A = 'http://127.0.0.1:' + pA, URL_B = 'http://127.0.0.1:' + pB;
  const varsA = { REPLICA_URL: URL_B, REPLICA_KEY: KEY, REPLICA_ROL: 'activo', REP_DEB_MS: '800', REP_BACK_MS: '700' };
  const varsB = { REPLICA_URL: URL_A, REPLICA_KEY: KEY, REP_DEB_MS: '800', REP_BACK_MS: '700' };
  let A = null, B = null, C = null;
  try {
    B = await start({ code, dir: dirB, port: pB, vars: varsB });
    A = await start({ code, dir: dirA, port: pA, vars: varsA });
    const bA = A.base, bB = B.base;

    /* ---- B recién creado y vacío: espera la copia, no deja hacer el alta ---- */
    let r = await call(bB, 'GET', '/api/status');
    t('el respaldo vacío dice que está en espera y que todavía no tiene datos (no ofrece crear el administrador)', r.s === 200 && r.j.respaldo && r.j.respaldo.rol === 'espera' && r.j.respaldo.vacio === true && r.j.needsSetup === false, r.j);
    r = await call(bB, 'POST', '/api/setup', { codigo: code, usuario: 'intruso', clave: 'claveSegura1' });
    t('en el respaldo vacío no se puede dar de alta un administrador', r.s === 409 && r.j.code === 'respaldo_espera', r);

    /* ---- A trabaja: alta, usuarios, datos ---- */
    r = await call(bA, 'POST', '/api/setup', { codigo: code, usuario: 'mauro', clave: 'claveSegura1', nombre: 'Mauro' });
    t('A se da de alta (REPLICA_ROL=activo, vacío)', r.s === 200 && r.j.token, r);
    const TA = r.j.token;
    for (const [u, rol, c] of [['ofi', 'oficina', 'laura1'], ['tec1', 'tecnico', 'pedro1']]) await call(bA, 'POST', '/api/users', { usuario: u, nombre: u, role: rol, clave: c }, TA);
    const O = (await call(bA, 'POST', '/api/login', { usuario: 'ofi', clave: 'laura1' })).j.token;
    r = await call(bA, 'PATCH', '/api/doc/clientes/c01', { data: { items: { cA: { nombre: 'Cejas Rosa', codigo: '77', dir: 'Calle 9 N° 123', loc: 'Añatuya', tel: '3844123456', estado: 'activo', tec: 'fibra' }, cB: { nombre: 'Otro Cliente', estado: 'activo' } } } }, O);
    t('(preparación) A tiene dos clientes', r.s === 200, r);
    r = await call(bA, 'PUT', '/api/doc/planes/p1', { data: { nombre: 'Plan 10', precio: 1000, activo: true } }, TA);
    t('(preparación) A tiene un plan', r.s === 200, r);

    /* ---- la copia llega sola a B ---- */
    const lleg = await hasta(async () => (await call(bB, 'POST', '/api/login', { usuario: 'ofi', clave: 'laura1' })).s === 200, 25000);
    t('B recibió la copia completa: los usuarios de A pueden entrar con sus mismas claves', lleg === true);
    const TB = (await call(bB, 'POST', '/api/login', { usuario: 'mauro', clave: 'claveSegura1' })).j.token;
    /* ---- equipos y sesiones viajan con los usuarios: quien ya estaba adentro entra al respaldo sin volver a identificarse ---- */
    const OD = (await call(bA, 'POST', '/api/login', { usuario: 'ofi', clave: 'laura1', did: 'dev-ofi-oficina-pc-0001' })).j.token;
    const ses = await hasta(async () => (await call(bB, 'GET', '/api/me', undefined, OD)).s === 200, 25000);
    t('la sesión abierta en A también vale en B (sin volver a entrar)', ses === true);
    r = await call(bB, 'GET', '/api/dispositivos', undefined, TB);
    t('B conoce el equipo de la oficina que A tenía registrado', r.s === 200 && r.j.lista.filter(x => x.usuario === 'ofi').length >= 2, r);
    r = await call(bB, 'GET', '/api/me', undefined, TB);
    t('la sesión abierta directamente en B se conserva al llegar las copias', r.s === 200, r);
    await call(bA, 'POST', '/api/logout', {}, OD);
    const cer = await hasta(async () => (await call(bB, 'GET', '/api/me', undefined, OD)).s === 401, 25000);
    t('si se cierra la sesión en A, deja de valer también en B', cer === true);
    r = await call(bB, 'GET', '/api/doc/clientes/c01', undefined, TB);
    t('B tiene los clientes de A', r.s === 200 && r.j.data && r.j.data.items && r.j.data.items.cA && r.j.data.items.cA.nombre === 'Cejas Rosa', r);
    r = await call(bB, 'GET', '/api/status');
    t('B ya no está vacío: sigue en espera y no pide dar de alta a nadie', r.j.respaldo.rol === 'espera' && r.j.respaldo.vacio === false && r.j.needsSetup === false, r.j);
    r = await call(bB, 'PATCH', '/api/doc/clientes/c01', { data: { items: { cA: { nombre: 'Cambiado en el respaldo' } } } }, TB);
    t('B en espera no acepta cambios (ni del administrador)', r.s === 409 && r.j.code === 'respaldo_espera', r);
    r = await call(bB, 'POST', '/api/users', { usuario: 'otro', nombre: 'Otro', role: 'oficina', clave: 'otraClave1' }, TB);
    t('B en espera tampoco crea usuarios', r.s === 409 && r.j.code === 'respaldo_espera', r);
    r = await call(bB, 'GET', '/api/me', undefined, TB);
    t('/api/me de B avisa que es el respaldo en espera', r.j.respaldo && r.j.respaldo.rol === 'espera' && r.j.respaldo.url === URL_A, r.j);

    /* ---- cambios al vuelo ---- */
    r = await call(bA, 'PATCH', '/api/doc/clientes/c01', { data: { items: { cA: { nombre: 'Rosa Cejas (editada)' } } } }, O);
    const v1 = await hasta(async () => (await call(bB, 'GET', '/api/doc/clientes/c01', undefined, TB)).j.data.items.cA.nombre === 'Rosa Cejas (editada)');
    t('un cambio en un cliente llega a B en pocos segundos', v1 === true);
    r = await call(bA, 'PUT', '/api/doc/planes/p2', { data: { nombre: 'Plan 20', precio: 2000, activo: true } }, TA);
    r = await call(bA, 'DELETE', '/api/doc/planes/p2', undefined, TA);
    t('(preparación) A borra el plan p2', r.s === 200, r);
    const v2 = await hasta(async () => { const a = await call(bB, 'GET', '/api/doc/planes/p1', undefined, TB), b = await call(bB, 'GET', '/api/doc/planes/p2', undefined, TB); return a.s === 200 && (b.s === 404 || !b.j.data || !Object.keys(b.j.data).length); });
    t('un plan nuevo llega y uno borrado se borra también en B', v2 === true);
    r = await call(bA, 'POST', '/api/me/clave', { actual: 'laura1', nueva: 'laura-nueva-2' }, O);
    r = await call(bA, 'PATCH', '/api/users/' + (await call(bA, 'GET', '/api/users', undefined, TA)).j.users.find(u => u.usuario === 'tec1').id, { nombre: 'Pedro Técnico' }, TA);
    const v3 = await hasta(async () => (await call(bB, 'POST', '/api/login', { usuario: 'ofi', clave: 'laura-nueva-2' })).s === 200);
    t('el cambio de clave de un usuario llega a B (entra con la nueva)', v3 === true);
    const v3b = await hasta(async () => ((await call(bB, 'GET', '/api/users', undefined, TB)).j.users || []).some(u => u.nombre === 'Pedro Técnico'));
    t('el cambio de nombre de un usuario llega a B', v3b === true);

    /* contrato firmado (de prueba), plantilla y su papelera */
    r = await call(bA, 'POST', '/api/contrato/vista', { cid: 'cA', motivo: 'alta', titular: TITULAR }, TA);
    const vp = r.j;
    r = await call(bA, 'PATCH', '/api/doc/clientes/c01', { data: { items: { cA: { comodato: EQUIPOS } } } }, O);
    r = await call(bA, 'POST', '/api/contrato/vista', { cid: 'cA', motivo: 'alta', titular: TITULAR }, TA);
    const vp2 = r.j;
    r = await call(bA, 'POST', '/api/contrato', { cid: 'cA', motivo: 'alta', titular: TITULAR, firma: firmaPng(3), aclar: 'Rosa Cejas', acepto: true, tver: vp2.tver, eq: vp2.eq }, TA);
    t('(preparación) A firma un contrato', r.s === 200 && r.j.contrato && r.j.contrato.id, r);
    const idC = r.j.contrato.id;
    const v4 = await hasta(async () => { const x = await call(bB, 'GET', '/api/contrato/' + idC, undefined, TB); return x.s === 200 && x.j.contrato.estado === 'vigente' && x.j.contrato.firma === firmaPng(3); });
    t('el contrato firmado, con su firma, llega a B', v4 === true);
    r = await call(bA, 'POST', '/api/contrato/' + idC + '/borrar', { motivo: 'era una prueba' }, O);
    const v5 = await hasta(async () => { const x = await call(bB, 'GET', '/api/contrato/' + idC, undefined, TB); return x.s === 200 && x.j.contrato.estado === 'borrado' && (x.j.contrato.log || []).some(l => l.acc === 'borrado'); });
    t('mandar el contrato a la papelera (cambio de estado y su registro) también llega a B', v5 === true);
    r = await call(bA, 'GET', '/api/contrato/plantilla', undefined, TA);
    r = await call(bA, 'PUT', '/api/contrato/plantilla', { texto: r.j.texto + '\nLínea nueva de prueba del respaldo.', final: true, empresa: r.j.empresa }, TA);
    const v6 = await hasta(async () => /Línea nueva de prueba del respaldo/.test(((await call(bB, 'GET', '/api/contrato/plantilla', undefined, TB)).j || {}).texto || ''));
    t('la plantilla del contrato llega a B', v6 === true);

    /* ---- la clave del respaldo ---- */
    r = await call(bB, 'GET', '/api/replica/ping');
    t('sin la clave, el otro servidor no responde datos', r.s === 403, r);
    r = await call(bB, 'GET', '/api/replica/ping', undefined, undefined, { 'x-replica-key': 'una-clave-equivocada-de-largo-parecido-123' });
    t('con una clave equivocada tampoco', r.s === 403, r);
    for (let i = 0; i < 6; i++) r = await call(bB, 'GET', '/api/replica/ping', undefined, undefined, { 'x-replica-key': 'otra-equivocada-' + i });
    t('los intentos fallidos se frenan', r.s === 429, r);
    r = await call(bB, 'GET', '/api/replica/ping', undefined, undefined, { 'x-replica-key': KEY });
    t('con la clave correcta responde aunque haya intentos fallidos (el otro servidor nunca queda afuera)', r.s === 200 && r.j.rol === 'espera' && r.j.cuentas.docs > 0, r);
    const pingA = (await call(bA, 'GET', '/api/replica/ping', undefined, undefined, { 'x-replica-key': KEY })).j, pingB = r.j;
    t('las cantidades de A y B coinciden (documentos, usuarios, contratos y registro)', JSON.stringify(pingA.cuentas) === JSON.stringify(pingB.cuentas), [pingA.cuentas, pingB.cuentas]);

    /* ---- estado que ve el administrador ---- */
    r = await call(bA, 'GET', '/api/replica/estado', undefined, TA);
    t('el estado en A: activo, el respaldo está en espera y no queda nada pendiente', r.s === 200 && r.j.rol === 'activo' && r.j.par && r.j.par.rol === 'espera' && r.j.pendientes === 0 && r.j.esMismo === false, r.j);
    r = await call(bA, 'GET', '/api/replica/estado', undefined, O);
    t('solo el administrador ve el estado', r.s === 403, r);
    r = await call(bA, 'POST', '/api/replica/sincronizar', {}, TA);
    t('«enviar la copia completa ahora» funciona en el activo', r.s === 200 && r.j.ok, r);
    r = await call(bB, 'POST', '/api/replica/sincronizar', {}, TB);
    t('y no en el que está en espera', r.s === 409, r);

    /* ---- restaurar una copia en A: B la recibe completa ---- */
    const copia = (await call(bA, 'GET', '/api/backup', undefined, TA)).j;
    await call(bA, 'PATCH', '/api/doc/clientes/c01', { data: { items: { cB: { nombre: 'Cliente que se va a deshacer' } } } }, O);
    r = await call(bA, 'POST', '/api/restore', copia, TA);
    t('(preparación) A restaura la copia de antes', r.s === 200, r);
    const TA2 = (await call(bA, 'POST', '/api/login', { usuario: 'mauro', clave: 'claveSegura1' })).j.token;
    const v7 = await hasta(async () => { const x = await call(bB, 'GET', '/api/doc/clientes/c01', undefined, TB); return x.s === 200 && x.j.data.items.cB.nombre === 'Otro Cliente'; });
    t('restaurar una copia en A deja a B igual (el cambio deshecho también se deshace en B)', v7 === true);

    /* ---- traspaso ordenado: el último cambio de A no se pierde ---- */
    r = await call(bA, 'PATCH', '/api/doc/clientes/c01', { data: { items: { cA: { nombre: 'Último cambio antes del traspaso' } } } }, TA2);   // (restaurar cierra las sesiones: se usa la nueva)
    t('(preparación) A hace un cambio justo antes del traspaso', r.s === 200, r);
    r = await call(bB, 'POST', '/api/replica/activar', {}, TB);
    t('B se activa con traspaso ordenado', r.s === 200 && r.j.ok && r.j.modo === 'ordenado' && r.j.epoca === 1, r);
    r = await call(bB, 'GET', '/api/doc/clientes/c01', undefined, TB);
    t('B ya tiene el último cambio de A (A mandó lo que le faltaba antes de pasarle el trabajo)', r.j.data.items.cA.nombre === 'Último cambio antes del traspaso', r.j);
    r = await call(bA, 'GET', '/api/status');
    t('A quedó en espera', r.j.respaldo.rol === 'espera', r.j);
    r = await call(bA, 'PATCH', '/api/doc/clientes/c01', { data: { items: { cA: { nombre: 'No debería poder' } } } }, TA2);
    t('A en espera ya no acepta cambios', r.s === 409 && r.j.code === 'respaldo_espera', r);
    r = await call(bB, 'PATCH', '/api/doc/clientes/c01', { data: { items: { cA: { nombre: 'Trabajando en B' } } } }, TB);
    t('B activo acepta cambios', r.s === 200, r);
    const v8 = await hasta(async () => (await call(bA, 'GET', '/api/doc/clientes/c01', undefined, TA2)).j.data.items.cA.nombre === 'Trabajando en B');
    t('y se los manda a A (ahora el respaldo)', v8 === true);
    r = await call(bB, 'GET', '/api/me', undefined, TB);
    t('/api/me de B ya dice activo', r.j.respaldo.rol === 'activo', r.j);
    r = await call(bB, 'POST', '/api/replica/activar', {}, TB);
    t('activar un servidor que ya es el activo da un aviso claro', r.s === 409, r);

    /* ---- emergencia: B (activo) se cae con un cambio sin mandar; A se activa solo ---- */
    await call(bB, 'PATCH', '/api/doc/clientes/c01', { data: { items: { cB: { nombre: 'Cambio de B que no alcanzó a copiarse' } } } }, TB);
    await B.stop(true);   // se cae enseguida: el cambio queda en su cola
    r = await call(bA, 'POST', '/api/replica/activar', {}, TA2);
    t('con el otro caído, activar pide confirmación (no lo hace solo)', r.s === 409 && r.j.code === 'par_no_responde', r);
    r = await call(bA, 'POST', '/api/replica/activar', { forzar: true }, TA2);
    t('con la confirmación, A se activa de emergencia (época nueva)', r.s === 200 && r.j.modo === 'emergencia' && r.j.epoca === 2, r);
    r = await call(bA, 'PATCH', '/api/doc/clientes/c01', { data: { items: { cA: { nombre: 'Trabajando en A mientras B está caído' } } } }, TA2);
    t('A trabaja mientras B está caído', r.s === 200, r);
    r = await call(bA, 'GET', '/api/replica/estado', undefined, TA2);
    t('el estado en A muestra el aviso: el otro no responde y hay cosas por mandar', r.j.rol === 'activo' && r.j.par && r.j.par.error && r.j.completoPendiente === true, r.j);

    /* ---- B vuelve: se entera de que quedó viejo, pasa a espera y recibe todo ---- */
    B = await start({ code, dir: dirB, port: pB, vars: varsB });
    const bB2 = B.base;
    const v9 = await hasta(async () => (await call(bB2, 'GET', '/api/status')).j.respaldo.rol === 'espera', 40000);
    t('al volver, B se entera de que hay un activo más nuevo y queda en espera', v9 === true);
    const TB2 = (await call(bB2, 'POST', '/api/login', { usuario: 'mauro', clave: 'claveSegura1' })).j.token;
    const v10 = await hasta(async () => { const x = await call(bB2, 'GET', '/api/doc/clientes/c01', undefined, TB2); return x.s === 200 && x.j.data.items.cA.nombre === 'Trabajando en A mientras B está caído'; }, 40000);
    t('B recibe la copia completa de A', v10 === true);
    r = await call(bB2, 'GET', '/api/doc/clientes/c01', undefined, TB2);
    t('el cambio de B que no alcanzó a copiarse se descarta (A manda)', r.j.data.items.cB.nombre === 'Otro Cliente', r.j.data.items.cB);
    r = await call(bB2, 'GET', '/api/backups', undefined, TB2);
    t('B guardó una copia de lo que tenía antes de pisarlo (se puede recuperar desde Copias de seguridad)', r.s === 200 && r.j.copias.some(c => /^antes-de-restaurar-/.test(c.name)), r.j);
    r = await call(bB2, 'PATCH', '/api/doc/clientes/c01', { data: { items: { cA: { nombre: 'x' } } } }, TB2);
    t('B quedó en espera: no acepta cambios', r.s === 409 && r.j.code === 'respaldo_espera', r);

    /* ---- y de vuelta al principal con un traspaso ordenado desde B ---- */
    r = await call(bB2, 'POST', '/api/replica/activar', {}, TB2);
    t('B se activa otra vez con traspaso ordenado (vuelta al principal)', r.s === 200 && r.j.modo === 'ordenado' && r.j.epoca === 3, r);
    r = await call(bA, 'GET', '/api/status');
    t('A queda en espera', r.j.respaldo.rol === 'espera', r.j);

    /* ---- sin las variables, la función no existe ---- */
    C = await start({ code, dir: dirC, vars: { REPLICA_URL: 'http://127.0.0.1:9' } });   // la dirección sin la clave: apagada
    r = await call(C.base, 'GET', '/api/status');
    t('sin clave configurada el servidor es el de siempre: sin respaldo y con alta normal', r.j.respaldo === undefined && r.j.needsSetup === true, r.j);
    r = await call(C.base, 'POST', '/api/setup', { codigo: code, usuario: 'solo', clave: 'claveSegura1', nombre: 'Solo' });
    const TC = r.j.token;
    r = await call(C.base, 'GET', '/api/replica/estado', undefined, TC);
    t('y las rutas de respaldo no existen', r.s === 404, r);
    r = await call(C.base, 'PATCH', '/api/doc/clientes/c01', { data: { items: { x: { nombre: 'ok' } } } }, TC);
    t('trabaja normalmente', r.s === 200, r);

    for (const [n, s] of [['A', A], ['B', B], ['C', C]]) t('sin errores en el registro de ' + n, !/Uncaught|✘|TypeError|ReferenceError|SqliteError/.test(s.log()), s.log().split('\n').filter(l => /Uncaught|✘|TypeError|ReferenceError|SqliteError/.test(l)).slice(0, 5));
  } catch (e) {
    failN++; console.log('FAIL excepción', e);
  } finally {
    for (const s of [A, B, C]) { try { if (s) await s.stop(true); } catch (e) { /* ya cerró */ } }
    for (const d of [dirA, dirB, dirC]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* ya no está */ } }
  }
  console.log('\n' + okN + ' ok, ' + failN + ' con fallas');
  process.exit(failN ? 1 : 0);
})();
