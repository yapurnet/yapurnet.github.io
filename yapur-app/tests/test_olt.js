'use strict';
/* Señal de las ONU: ingreso con token propio, cruce con clientes por serie/MAC, alerta peor que el umbral, permisos. */
const fs = require('fs'), path = require('path'), os = require('os');
const { start } = require('./harness');
let BASE = '', okN = 0, failN = 0;
const t = (name, cond, extra) => { if (cond) { okN++; console.log('ok   ' + name); } else { failN++; console.log('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 300) : '')); } };
async function call(method, p, body, token) {
  const r = await fetch(BASE + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) { /* sin cuerpo */ }
  return { s: r.status, j };
}
(async () => {
  const code = 'TEST-CODE-1234-ABCD', dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yapur-olt-'));
  const srv = await start({ code, dir, vars: { DISP_APROBAR: '0' } });
  BASE = srv.base;
  try {
    let r = await call('POST', '/api/setup', { codigo: code, usuario: 'mauro', clave: 'claveSegura1', nombre: 'Mauro' });
    const A = r.j.token;
    await call('POST', '/api/users', { usuario: 'cobra', nombre: 'Brenda', role: 'oficina', clave: 'brenda12' }, A);
    const O = (await call('POST', '/api/login', { usuario: 'cobra', clave: 'brenda12' })).j.token;
    r = await call('PATCH', '/api/doc/clientes/c001', { data: { items: {
      a: { id: 'a', nombre: 'Perez Hector', dir: 'San Martin 100', loc: 'Añatuya', estado: 'activo', equipo: 'tplg-1234abcd' },
      b: { id: 'b', nombre: 'Gomez Ana', estado: 'activo', comodato: [{ t: 'ONU', d: 'XC220', s: '2C:3A:E8:11:AA:BB', n: 1, e: 'nuevo', o: '' }] },
      c: { id: 'c', nombre: 'Baja Juan', estado: 'baja', equipo: 'TPLG0000FFFF' } } } }, A);
    t('se cargan clientes de prueba', r.s === 200, r);
    r = await call('POST', '/api/olt/ingest', { lect: [] }, undefined);
    t('sin token no se puede mandar lecturas', r.s === 401, r);
    r = await call('POST', '/api/olt/token', {}, O);
    t('la oficina no genera el token', r.s === 403, r);
    r = await call('POST', '/api/olt/token', {}, A);
    const TK = r.j && r.j.token;
    t('el administrador genera el token', r.s === 200 && /^olt\./.test(TK), r);
    r = await call('POST', '/api/olt/ingest', { lect: [] }, 'olt.malo');
    t('un token incorrecto se rechaza', r.s === 401, r);
    r = await call('POST', '/api/olt/ingest', { lect: [
      { sn: 'TPLG-1234ABCD', rx: -29.4, tx: 2.1, est: 'online', port: '1/3' },
      { mac: '2c3ae811aabb', rx: '-26,8', est: 'online', port: '1/4' },
      { sn: 'TPLG0000FFFF', rx: -31, port: '2/1' },
      { sn: 'ZZZZ99998888', rx: -20, port: '2/2' },
      { sn: 'ZZZZ77776666', rx: -33.5, port: '2/3' },
      { sn: 'x', rx: -50 }, { sn: 'ABCDEF123456', rx: 99 }] }, TK);
    t('el lector manda lecturas', r.s === 200 && r.j.guardadas === 6, r);
    r = await call('GET', '/api/olt', undefined, O);
    const L = r.j && r.j.lista || [];
    t('la oficina ve la señal', r.s === 200 && r.j.umbral === -27 && r.j.total === 6, r);
    t('alerta solo peor que -27 (-29.4, -31 y -33.5; no -26.8 ni -20)', L.length === 3 && L.map(o => o.rx).join() === '-33.5,-31,-29.4', L);
    t('cruza con el cliente por la serie (ignora mayúsculas y guiones)', L.find(o => o.rx === -29.4).cn === 'Perez Hector' && L.find(o => o.rx === -29.4).cd === 'San Martin 100, Añatuya', L);
    t('una ONU sin cliente figura sin nombre', L.find(o => o.rx === -33.5).cn === null, L);
    t('un cliente de baja no se cruza', L.find(o => o.rx === -31).cn === null, L);
    t('cuenta las ONU sin cliente', r.j.sinCliente === 4, r.j.sinCliente);
    r = await call('PUT', '/api/olt/config', { umbral: -25 }, O);
    t('la oficina no cambia el límite', r.s === 403, r);
    r = await call('PUT', '/api/olt/config', { umbral: 5 }, A);
    t('un límite positivo no se acepta', r.s === 400, r);
    r = await call('PUT', '/api/olt/config', { umbral: -25 }, A);
    r = await call('GET', '/api/olt', undefined, O);
    t('con límite -25 también alerta la de -26,8', r.j.malas === 4, r.j);
    r = await call('GET', '/api/olt', undefined, undefined);
    t('sin sesión no se ve', r.s === 401, r);
  } finally { srv.stop && srv.stop(); }
  console.log('\n' + okN + ' ok, ' + failN + ' con fallas'); process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
