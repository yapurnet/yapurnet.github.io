'use strict';
/* Equipos (dispositivos): registro de cada teléfono o navegador que entra, aprobación de los equipos nuevos de los empleados,
   bloqueo inmediato y qué pasa con las sesiones que ya estaban abiertas cuando se agregó esta función. */
const fs = require('fs'), path = require('path'), os = require('os');
const { start } = require('./harness');
let BASE = '', okN = 0, failN = 0;
const t = (name, cond, extra) => { if (cond) { okN++; console.log('ok   ' + name); } else { failN++; console.log('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function call(method, p, body, token, hdr) {
  const r = await fetch(BASE + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}, hdr || {}), body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { s: r.status, j };
}
/* conexión en vivo como la usa la app: WebSocket (el servidor se duerme mientras nadie hace nada). Devuelve los mensajes ya separados en {ev,data}. */
async function openStream(token, ticket) {
  const tk = ticket || (await call('POST', '/api/ticket', {}, token)).j.t;
  const events = [];
  const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/api/stream?t=' + tk);
  let status = 0;
  ws.addEventListener('message', m => { if (m.data === 'pong') { events.pong = (events.pong || 0) + 1; return; } try { const j = JSON.parse(m.data); events.push({ ev: j.e, data: j.d }); } catch (e) {} });
  ws.addEventListener('close', () => { events.closed = true; });
  await new Promise(res => { ws.addEventListener('open', () => { status = 200; res(); }); ws.addEventListener('error', () => res()); ws.addEventListener('close', () => res()); });
  return { events, status, ws, close: () => { try { ws.close(); } catch (e) {} } };
}
const UA_APK = 'Mozilla/5.0 (Linux; Android 13; SM-A135M Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 YapurApp/2.11';
const UA_WEB = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const D1 = 'dev-tec1-telefono-0001', D2 = 'dev-tec1-otro-equipo-02', D3 = 'dev-tec1-tercer-equipo3';
const login = (u, c, did, ua) => call('POST', '/api/login', { usuario: u, clave: c, did }, undefined, ua ? { 'user-agent': ua } : undefined);

(async () => {
  const code = 'TEST-CODE-1234-ABCD';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yapur-disp-'));
  const vars = { DISP_APROBAR: '1' };
  let srv = await start({ code, dir, vars });
  BASE = srv.base;
  try {
    let r = await call('POST', '/api/setup', { codigo: code, usuario: 'mauro', clave: 'claveSegura1', nombre: 'Mauro', did: 'dev-admin-celular-0001' }, undefined, { 'user-agent': UA_WEB });
    const A = r.j.token;
    r = await call('GET', '/api/dispositivos', undefined, A, { 'x-did': 'dev-admin-celular-0001' });
    t('el administrador queda como equipo autorizado desde la instalación', r.s === 200 && r.j.lista.length === 1 && r.j.lista[0].estado === 'ok' && r.j.lista[0].actual === true && r.j.lista[0].label === 'Windows · Navegador Chrome', r.j);
    t('por defecto se pide aprobación a los empleados', r.j.requiere === true);
    await call('POST', '/api/users', { usuario: 'tec1', nombre: 'Pedro', role: 'tecnico', clave: 'pedro1' }, A);
    await call('POST', '/api/users', { usuario: 'ofi', nombre: 'Laura', role: 'oficina', clave: 'laura1' }, A);

    // el administrador mira en vivo
    const sa = await openStream(A);
    await sleep(200);

    /* ---- un empleado en un equipo nuevo no entra hasta que se aprueba ---- */
    r = await login('tec1', 'pedro1', D1, UA_APK);
    t('el técnico en un equipo nuevo no recibe sesión', r.s === 403 && r.j.code === 'device_pending' && !r.j.token, r);
    await sleep(300);
    t('al administrador le llega el aviso en vivo con la cantidad pendiente', sa.events.some(e => e.ev === 'disp' && e.data.pend === 1), sa.events);
    r = await call('GET', '/api/dispositivos', undefined, A);
    const p1 = r.j.lista[0];
    t('el equipo pendiente aparece primero con modelo, sistema, app, IP y usuario', p1.estado === 'pend' && p1.usuario === 'tec1' && p1.nombre === 'Pedro' && p1.label === 'SM-A135M · Android 13 · App Yapur 2.11' && p1.app === 'apk' && r.j.pend === 1 && typeof p1.ip === 'string', p1);
    await login('tec1', 'pedro1', D1, UA_APK);
    r = await call('GET', '/api/dispositivos', undefined, A);
    t('volver a intentarlo no duplica el equipo', r.j.lista.filter(x => x.usuario === 'tec1').length === 1, r.j.lista.length);
    r = await login('tec1', 'mala', D1, UA_APK);
    t('con la clave mala sigue siendo clave incorrecta (no se registra equipo)', r.s === 401, r);

    /* ---- aprobar ---- */
    r = await call('POST', '/api/dispositivos/' + p1.id, { accion: 'aprobar' }, A);
    t('el administrador aprueba el equipo', r.s === 200 && r.j.pend === 0 && r.j.lista.find(x => x.id === p1.id).estado === 'ok', r.j);
    r = await login('tec1', 'pedro1', D1, UA_APK);
    const T1 = r.j.token;
    t('ya entra desde ese equipo', r.s === 200 && !!T1, r);
    r = await call('GET', '/api/me', undefined, T1, { 'x-did': D1 });
    t('y la sesión funciona', r.s === 200 && r.j.me.usuario === 'tec1', r);

    /* ---- otro equipo con la misma clave (alguien que la consiguió) ---- */
    r = await login('tec1', 'pedro1', D2, UA_WEB);
    t('con la clave del técnico desde otro equipo NO entra: queda pendiente', r.s === 403 && r.j.code === 'device_pending', r);
    r = await call('GET', '/api/dispositivos', undefined, A);
    const p2 = r.j.lista.find(x => x.estado === 'pend');
    t('el administrador ve el equipo desconocido (Windows · Chrome) para rechazarlo', p2 && p2.label === 'Windows · Navegador Chrome' && r.j.pend === 1, r.j);

    /* ---- un empleado no ve ni toca esta lista ---- */
    r = await call('GET', '/api/dispositivos', undefined, T1, { 'x-did': D1 });
    t('el técnico no puede ver los equipos', r.s === 403, r);
    r = await call('POST', '/api/dispositivos/' + p2.id, { accion: 'aprobar' }, T1);
    t('el técnico no puede aprobarse un equipo', r.s === 403, r);
    r = await call('PATCH', '/api/dispositivos', { requiere: false }, T1);
    t('el técnico no puede apagar la aprobación', r.s === 403, r);

    /* ---- bloquear corta la sesión en el acto ---- */
    const st = await openStream(T1);
    await sleep(200);
    r = await call('POST', '/api/dispositivos/' + p1.id, { accion: 'bloquear' }, A);
    t('el administrador bloquea el teléfono del técnico', r.s === 200 && r.j.lista.find(x => x.id === p1.id).estado === 'bloq', r.j);
    r = await call('GET', '/api/me', undefined, T1, { 'x-did': D1 });
    t('la sesión de ese equipo termina en el acto', r.s === 401, r);
    await sleep(300);
    t('y la pantalla abierta se cierra sola (kick en vivo)', st.events.some(e => e.ev === 'kick'), st.events);
    r = await login('tec1', 'pedro1', D1, UA_APK);
    t('el equipo bloqueado no puede volver a entrar', r.s === 403 && r.j.code === 'device_blocked', r);
    r = await call('POST', '/api/dispositivos/' + p2.id, { accion: 'bloquear' }, A);
    t('se bloquea también el equipo desconocido', r.s === 200, r.j);
    r = await login('tec1', 'pedro1', D2, UA_WEB);
    t('que tampoco entra (bloqueado)', r.s === 403 && r.j.code === 'device_blocked', r);

    /* ---- el administrador no se bloquea a sí mismo ---- */
    r = await call('GET', '/api/dispositivos', undefined, A, { 'x-did': 'dev-admin-celular-0001' });
    const yo = r.j.lista.find(x => x.actual);
    r = await call('POST', '/api/dispositivos/' + yo.id, { accion: 'bloquear' }, A, { 'x-did': 'dev-admin-celular-0001' });
    t('el administrador no puede bloquear el equipo que está usando', r.s === 400, r);
    r = await call('POST', '/api/dispositivos/d000000000000', { accion: 'aprobar' }, A);
    t('un equipo que no existe da 404', r.s === 404, r);
    r = await call('POST', '/api/dispositivos/' + p2.id, { accion: 'volar' }, A);
    t('una acción inválida se rechaza', r.s === 400, r);

    /* ---- quitar y desbloquear ---- */
    r = await call('POST', '/api/dispositivos/' + p2.id, { accion: 'quitar' }, A);
    t('quitar saca el equipo de la lista', r.s === 200 && !r.j.lista.some(x => x.id === p2.id), r.j);
    r = await login('tec1', 'pedro1', D2, UA_WEB);
    t('si vuelve a intentar, queda pendiente otra vez (no bloqueado)', r.s === 403 && r.j.code === 'device_pending', r);
    r = await call('POST', '/api/dispositivos/' + p1.id, { accion: 'aprobar' }, A);
    r = await login('tec1', 'pedro1', D1, UA_APK);
    t('«Permitir de nuevo» un equipo bloqueado lo habilita', r.s === 200 && !!r.j.token, r);

    /* ---- la oficina también necesita aprobación; el administrador no ---- */
    r = await login('ofi', 'laura1', 'dev-ofi-compu-00000001', UA_WEB);
    t('la oficina en un equipo nuevo también queda pendiente', r.s === 403 && r.j.code === 'device_pending', r);
    r = await login('mauro', 'claveSegura1', 'dev-admin-otra-notebook1', UA_WEB);
    t('el administrador entra desde un equipo nuevo (queda registrado, no bloqueado)', r.s === 200 && !!r.j.token, r);
    r = await call('GET', '/api/dispositivos', undefined, A);
    t('y se ve en la lista, para que sepa desde dónde entró', r.j.lista.filter(x => x.usuario === 'mauro').length === 2, r.j.lista.map(x => x.usuario));

    /* ---- alguien con la clave no puede llenar la lista de equipos pendientes ---- */
    let ult = null;
    for (let i = 2; i <= 9; i++) ult = await login('ofi', 'laura1', 'dev-ofi-spam-' + String(i).padStart(8, '0'), UA_WEB);
    t('hay un tope de equipos pendientes por usuario (8): el noveno se rechaza con aviso', ult.s === 429, ult);

    /* ---- sin identificador (versión vieja de la app): se identifica por el navegador ---- */
    r = await login('tec1', 'pedro1', undefined, UA_WEB);
    t('sin identificador de equipo también queda pendiente (se reconoce por el navegador)', r.s === 403 && r.j.code === 'device_pending', r);

    /* ---- apagar la aprobación ---- */
    r = await call('PATCH', '/api/dispositivos', { requiere: false }, A);
    t('el administrador apaga el pedido de aprobación', r.s === 200 && r.j.requiere === false, r.j);
    r = await login('tec1', 'pedro1', D3, UA_WEB);
    t('con la aprobación apagada, un equipo nuevo entra directo y queda en la lista', r.s === 200 && !!r.j.token, r);
    r = await login('ofi', 'laura1', 'dev-ofi-compu-00000001', UA_WEB);
    t('los que estaban pendientes entran también', r.s === 200, r);
    r = await call('PATCH', '/api/dispositivos', { requiere: 'si' }, A);
    t('valor inválido en el ajuste se rechaza', r.s === 400, r);
    r = await call('PATCH', '/api/dispositivos', { requiere: true }, A);
    t('se vuelve a encender', r.j.requiere === true);

    /* ---- reinicio: el ajuste, los equipos y las sesiones se conservan ---- */
    await srv.stop(true);
    srv = await start({ code, dir, vars });
    BASE = srv.base;
    r = await call('GET', '/api/dispositivos', undefined, A);
    t('tras reiniciar, los equipos y el ajuste siguen', r.s === 200 && r.j.requiere === true && r.j.lista.length >= 5, r.j && r.j.lista && r.j.lista.length);
    r = await login('tec1', 'pedro1', D1, UA_APK);
    t('el equipo aprobado sigue entrando', r.s === 200, r);

    /* ---- sesiones abiertas ANTES de que existiera esta función ----
       Se simula dejando la base como estaba: sesiones sin equipo. Al arrancar, quedan como «Sesión anterior» autorizada
       y no se les corta nada; con el primer pedido de la app nueva se completan con los datos reales del equipo. */
    const TL = (await login('tec1', 'pedro1', D1, UA_APK)).j.token;
    await srv.stop(true);
    let sqlite = null; try { sqlite = require('node:sqlite'); } catch (e) { /* node viejo */ }
    const files = [];
    (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.sqlite$/.test(f.name) && !/metadata/.test(f.name)) files.push(p); } })(dir);
    let hecho = false;
    if (sqlite) for (const f of files) {
      const db = new sqlite.DatabaseSync(f);
      try {
        if (!db.prepare("SELECT name FROM sqlite_master WHERE name='devices'").get()) { db.close(); continue; }
        db.exec("UPDATE sessions SET dev=NULL; DELETE FROM devices;");
        db.close(); hecho = true;
      } catch (e) { try { db.close(); } catch (e2) {} }
    }
    t('(preparación) la base quedó como antes de existir los equipos', sqlite ? hecho : true, files);
    if (hecho) {
      srv = await start({ code, dir, vars });
      BASE = srv.base;
      r = await call('GET', '/api/me', undefined, TL);
      t('la sesión abierta antes de la actualización sigue funcionando (aunque pidan aprobación)', r.s === 200 && r.j.me.usuario === 'tec1', r);
      r = await call('GET', '/api/dispositivos', undefined, A);
      const viejos = r.j.lista.filter(x => x.anterior), nViejos = viejos.length;
      t('las sesiones anteriores aparecen como «Sesión anterior» autorizadas', viejos.length >= 1 && viejos.every(x => x.estado === 'ok' && /Sesión anterior/.test(x.label)), r.j.lista);
      r = await call('GET', '/api/me', undefined, TL, { 'x-did': D1, 'user-agent': UA_APK });
      t('con el primer pedido de la app nueva, la sesión sigue funcionando', r.s === 200, r);
      r = await call('GET', '/api/dispositivos', undefined, A);
      const reales = r.j.lista.filter(x => x.usuario === 'tec1' && !x.anterior);
      t('y ese equipo pasa a mostrarse con su modelo real, sin duplicarse (una sesión anterior menos)', reales.length === 1 && reales[0].label === 'SM-A135M · Android 13 · App Yapur 2.11' && reales[0].estado === 'ok' && r.j.lista.filter(x => x.anterior).length === nViejos - 1, r.j.lista);
      r = await login('tec1', 'pedro1', D1, UA_APK);
      t('y al volver a entrar desde ese teléfono no pide aprobación (ya está reconocido)', r.s === 200, r);
    }
    t('sin errores en el registro del servidor', !/Uncaught|\bERROR\b|✘/.test(srv.log()), srv.log().split('\n').filter(l => /Uncaught|ERROR|✘/.test(l)).slice(0, 5));
  } catch (e) {
    failN++; console.log('FAIL excepción', e);
  } finally {
    await srv.stop();
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`\n${okN} ok, ${failN} con fallas`);
    if (failN) console.log('--- log del servidor ---\n' + srv.log().slice(-3000));
    process.exit(failN ? 1 : 0);
  }
})();
