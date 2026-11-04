'use strict';
/* Pruebas de conexión (ping): la oficina o el técnico lo pide en la ficha, un router (con su token de ping) lo toma, hace el ping y manda el resultado.
   Acá el router se simula con pedidos HTTP con su token. */
const fs = require('fs'), path = require('path'), os = require('os');
const { start } = require('./harness');
let BASE = '', okN = 0, failN = 0;
const t = (name, cond, extra) => { if (cond) { okN++; console.log('ok   ' + name); } else { failN++; console.log('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function call(method, p, body, token) {
  const r = await fetch(BASE + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { s: r.status, j };
}
/* lo que hace el router: consulta (texto «id:ip,id:ip») y manda el resultado */
const poll = async tk => { const r = await fetch(BASE + '/api/router/ping', { headers: { authorization: 'Bearer ' + tk } }); return { s: r.status, txt: await r.text() }; };
const report = async (tk, q) => { const r = await fetch(BASE + '/api/router/ping?' + q, { method: 'POST', headers: { authorization: 'Bearer ' + tk }, body: 'x' }); let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };

(async () => {
  const code = 'TEST-CODE-1234-ABCD', dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yapur-ping-'));
  const vars = { PING_VENCE_MS: '1500' };
  const srv = await start({ code, dir, vars });
  BASE = srv.base;
  try {
    let r = await call('POST', '/api/setup', { codigo: code, usuario: 'mauro', clave: 'claveSegura1', nombre: 'Mauro' });
    const A = r.j.token;
    for (const [u, rol, c] of [['ofi', 'oficina', 'laura1'], ['tec1', 'tecnico', 'pedro1'], ['tec2', 'tecnico', 'marcos1']]) await call('POST', '/api/users', { usuario: u, nombre: u, role: rol, clave: c }, A);
    const O = (await call('POST', '/api/login', { usuario: 'ofi', clave: 'laura1' })).j.token;
    const T1 = (await call('POST', '/api/login', { usuario: 'tec1', clave: 'pedro1' })).j.token;
    const T2 = (await call('POST', '/api/login', { usuario: 'tec2', clave: 'marcos1' })).j.token;
    const users = (await call('GET', '/api/users', undefined, A)).j.users, tec2 = users.find(u => u.usuario === 'tec2');
    r = await call('PATCH', '/api/users/' + tec2.id, { permisos: { ping: false } }, A);
    t('el administrador le apaga el ping a un técnico', r.s === 200 && r.j.user.perms.ping === false, r);
    t('por defecto la oficina y los técnicos pueden probar la conexión', (await call('GET', '/api/me', undefined, O)).j.me.perms.ping === true && (await call('GET', '/api/me', undefined, T1)).j.me.perms.ping === true);

    const items = { cA: { nombre: 'Ana', ip: '10.0.0.5' }, cB: { nombre: 'Sin IP', ip: '' }, cC: { nombre: 'Del ADMIN02', ip: '10.0.0.6/32', nodo: 'ADMIN02' }, cD: { nombre: 'Dos IP', ip: '10.0.0.1, 10.0.0.2' }, cE: { nombre: 'Cero', ip: '0.0.0.0' }, cF: { nombre: 'Del BORDE01', ip: '10.0.0.9', nodo: 'BORDE01' } };
    for (let i = 0; i < 14; i++) items['m' + i] = { nombre: 'Masivo ' + i, ip: '10.1.0.' + (i + 1) };
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items } }, A);
    t('(preparación) clientes cargados', r.s === 200, r);

    /* ---- sin ningún router configurado ---- */
    r = await call('POST', '/api/ping', { cid: 'cA' }, O);
    t('sin router configurado, avisa claro y no deja la prueba colgada', r.s === 409 && /Todavía no hay un router/.test(r.j.error), r);

    /* ---- routers: token de ping propio, distinto del de datos ---- */
    const R1 = (await call('POST', '/api/routers', { nombre: 'ADMIN02', kinds: ['q'] }, A)).j;
    const R2 = (await call('POST', '/api/routers', { nombre: 'BORDE01', kinds: ['q'] }, A)).j;
    r = await poll(R1.token);
    t('el token de datos del router NO sirve para el ping', r.s === 401, r);
    r = await call('POST', '/api/routers/' + R1.router.id + '/ping-token', {}, O);
    t('solo el administrador genera el token de ping', r.s === 403, r);
    const P1 = (await call('POST', '/api/routers/' + R1.router.id + '/ping-token', {}, A)).j.token;
    const P2 = (await call('POST', '/api/routers/' + R2.router.id + '/ping-token', {}, A)).j.token;
    t('el token de ping tiene el formato del router', /^r[0-9a-f]{10}\.[A-Za-z0-9_-]{20,}$/.test(P1), P1);
    r = await poll('r0000000000.basura');
    t('un token inventado se rechaza', r.s === 401, r);
    r = await poll(P1);
    t('el router consulta y no hay nada pendiente: respuesta vacía', r.s === 200 && r.txt === '', r);
    await poll(P2);
    r = await call('GET', '/api/routers', undefined, A);
    t('la lista de routers muestra que atienden pruebas', r.j.routers.every(x => x.ping === true && x.pingVisto > 0), r.j.routers);

    /* ---- un pedido completo ---- */
    r = await call('POST', '/api/ping', { cid: 'cA' }, O);
    const pa = r.j.ping;
    t('la oficina pide la prueba: queda esperando al router, con la IP del cliente', r.s === 200 && pa.estado === 'pend' && pa.ip === '10.0.0.5' && /^g[0-9a-f]{14}$/.test(pa.id), r);
    r = await call('POST', '/api/ping', { cid: 'cA' }, T1);
    t('si otro pide lo mismo enseguida, se junta con la prueba en curso', r.j.ping.id === pa.id, r.j);
    r = await poll(P1);
    t('el router la toma: llega «id:ip»', r.s === 200 && r.txt === pa.id + ':10.0.0.5', r);
    r = await poll(P2);
    t('otro router no la vuelve a tomar', r.txt === '', r);
    r = await call('GET', '/api/ping/' + pa.id, undefined, O);
    t('mientras tanto la app ve que el router la está haciendo', r.j.ping.estado === 'toma', r.j);
    r = await report(P2, 'id=' + pa.id + '&sent=4&rec=4');
    t('un router que no la tomó no puede mandar el resultado', r.s === 404, r);
    r = await report(P1, 'id=' + pa.id + '&sent=4&rec=4&avg=3ms383us');
    t('el router manda el resultado', r.s === 200 && r.j.ok === true, r);
    r = await call('GET', '/api/ping/' + pa.id, undefined, O);
    t('la app ve: responde 4 de 4, 3,4 ms, probado por ADMIN02', r.j.ping.estado === 'hecho' && r.j.ping.sent === 4 && r.j.ping.rec === 4 && r.j.ping.avg === 3.4 && r.j.ping.router === 'ADMIN02', r.j);
    r = await call('GET', '/api/ping/' + pa.id, undefined, T1);
    t('otro usuario no ve una prueba ajena', r.s === 404, r);
    r = await call('GET', '/api/ping/' + pa.id, undefined, A);
    t('el administrador sí', r.s === 200, r);
    r = await report(P1, 'id=' + pa.id + '&sent=4&rec=0');
    r = await call('GET', '/api/ping/' + pa.id, undefined, O);
    t('un segundo aviso del mismo resultado no lo pisa', r.j.ping.rec === 4, r.j);

    /* ---- cada cliente se prueba desde el router de su nodo ---- */
    r = await call('POST', '/api/ping', { cid: 'cC' }, T1);
    const pc = r.j.ping;
    r = await poll(P2);
    t('un cliente del nodo ADMIN02 no lo toma BORDE01', r.txt === '', r);
    r = await poll(P1);
    t('lo toma ADMIN02', r.txt === pc.id + ':10.0.0.6', r);
    r = await report(P1, 'id=' + pc.id + '&sent=4&rec=2');
    r = await call('GET', '/api/ping/' + pc.id, undefined, T1);
    t('resultado parcial: 2 de 4 (pierde paquetes) y sin tiempo', r.j.ping.rec === 2 && r.j.ping.sent === 4 && r.j.ping.avg === null, r.j);
    r = await call('POST', '/api/ping', { cid: 'cF' }, O);
    const pf = r.j.ping;
    await poll(P2);
    r = await report(P2, 'id=' + pf.id + '&sent=4&rec=0');
    r = await call('GET', '/api/ping/' + pf.id, undefined, O);
    t('sin respuesta: 0 de 4', r.j.ping.estado === 'hecho' && r.j.ping.rec === 0, r.j);

    /* ---- validaciones ---- */
    for (const [cid, esp, txt] of [['cB', 400, 'sin IP cargada'], ['cD', 400, 'con más de una IP'], ['cE', 400, 'con IP 0.0.0.0'], ['noExiste', 404, 'que no existe']]) {
      r = await call('POST', '/api/ping', { cid }, O);
      t('no se prueba un cliente ' + txt, r.s === esp, r);
    }
    r = await call('POST', '/api/ping', { cid: 'cA' }, T2);
    t('un técnico sin permiso de ping no puede pedirlo', r.s === 403, r);
    r = await call('POST', '/api/ping', { cid: 'cA' });
    t('sin sesión no se puede', r.s === 401, r);
    r = await report(P1, 'id=' + pa.id + '&sent=4&rec=9');
    t('un resultado imposible (más respuestas que envíos) se rechaza', r.s === 400, r);
    r = await report(P1, 'id=zzz&sent=4&rec=1');
    t('un identificador inválido se rechaza', r.s === 400, r);

    /* ---- vence lo que nadie atiende ---- */
    r = await call('POST', '/api/ping', { cid: 'm0' }, O);
    const pv = r.j.ping;
    await sleep(1900);
    r = await call('GET', '/api/ping/' + pv.id, undefined, O);
    t('una prueba que ningún router atendió a tiempo queda «vencida»', r.j.ping.estado === 'vencido', r.j);
    r = await call('POST', '/api/ping', { cid: 'm1' }, O);
    await poll(P1);
    await sleep(1900);
    r = await call('GET', '/api/ping/' + r.j.ping.id, undefined, O);
    t('y una que el router tomó y no contestó también', r.j.ping.estado === 'vencido', r.j);

    /* ---- tope por usuario ---- */
    await poll(P1); await poll(P2);
    let ult = null;
    for (let i = 2; i < 14; i++) ult = await call('POST', '/api/ping', { cid: 'm' + i }, T1);
    t('hay un tope de pruebas por minuto por usuario', ult.s === 429, ult);

    /* ---- se corta el router: no se aceptan más pruebas ---- */
    r = await call('POST', '/api/routers/' + R1.router.id + '/ping-token', {}, A);
    r = await poll(P1);
    t('al generar otro token de ping, el anterior deja de valer', r.s === 401, r);
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
