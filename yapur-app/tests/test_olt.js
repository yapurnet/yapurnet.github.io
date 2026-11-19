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
    /* medida a mano del técnico + datos de la ONU del cliente */
    await call('POST', '/api/users', { usuario: 'tec', nombre: 'Tecnico Uno', role: 'tecnico', clave: 'tecnico12' }, A);
    const T = (await call('POST', '/api/login', { usuario: 'tec', clave: 'tecnico12' })).j.token;
    r = await call('PUT', '/api/olt/mapa', { lista: [{ sn: 'TPLG-1234ABCD', port: '1/3' }, { sn: 'TPLGBBBB2222', port: '2/7' }] }, T);
    t('el técnico no carga el mapa de la OLT', r.s === 403, r);
    r = await call('PUT', '/api/olt/mapa', { lista: [{ sn: 'TPLG-1234ABCD', port: '1/3' }, { sn: 'TPLGBBBB2222', port: '2/7' }, { sn: 'x', port: '9/9' }] }, A);
    t('el administrador carga el mapa serie → puerto/ID', r.s === 200 && r.j.onus === 2, r);
    r = await call('PATCH', '/api/doc/clientes/c001', { data: { items: { d: { id: 'd', nombre: 'Sin Equipo Rosa', estado: 'activo' }, e: { id: 'e', nombre: 'Con Mapa Luis', estado: 'activo', equipo: 'TPLGBBBB2222' }, f: { id: 'f', nombre: 'Vinculada Ana', estado: 'activo' }, g: { nombre: 'Sin Id Propio', estado: 'activo', equipo: 'TPLGBBBB2222' }, h: { nombre: 'Juan Pérez', estado: 'activo', nodo: 'PON_3' }, i: { nombre: 'Ana López', estado: 'activo' }, j: { nombre: 'Ana López (local)', estado: 'activo' } } } }, A);
    r = await call('GET', '/api/olt/cliente/e', undefined, T);
    t('el técnico ve la ONU del cliente con su puerto aunque no haya lectura', r.s === 200 && r.j.port === '2/7' && r.j.rx === null && r.j.sn === 'TPLGBBBB2222', r);
    r = await call('POST', '/api/olt/vincular', { cid: 'f', q: 'ab' }, T);
    t('vincular pide al menos 4 caracteres', r.s === 400, r);
    r = await call('POST', '/api/olt/vincular', { cid: 'f', q: 'ZZZZ9' }, T);
    t('una serie que no está en la OLT da 404', r.s === 404, r);
    r = await call('POST', '/api/olt/vincular', { cid: 'f', q: '1234abcd' }, T);
    t('el técnico vincula la ONU por los últimos caracteres', r.s === 200 && r.j.sn === 'TPLG1234ABCD' && r.j.port === '1/3', r);
    r = await call('GET', '/api/olt/cliente/f', undefined, T);
    t('el cliente vinculado muestra su serie y puerto', r.j.sn === 'TPLG1234ABCD' && r.j.port === '1/3', r.j);
    r = await call('POST', '/api/olt/vincular', { cid: 'f', quitar: true }, T);
    t('se puede quitar un vínculo hecho por error', r.s === 200 && r.j.quitada === true, r);
    r = await call('GET', '/api/olt/cliente/f', undefined, T);
    t('sin vínculo el cliente vuelve a no tener serie', r.j.sn === null, r.j);
    r = await call('POST', '/api/olt/vincular', { cid: 'f', q: '1234abcd' }, T);
    r = await call('GET', '/api/olt/cliente/g', undefined, T);
    t('un cliente cuyo registro no trae el campo id también se resuelve', r.s === 200 && r.j.sn === 'TPLGBBBB2222', r);
    r = await call('POST', '/api/olt/ingest', { lect: [{ sn: 'TPLGAUTO0001', rx: -20, port: '3/9', name: 'Pérez Juan (Kiosco)' }, { sn: 'TPLGAUTO0002', rx: -21, port: '1/1', name: 'Lopez Ana' }, { sn: 'TPLGAUTO0003', rx: -22, port: '1/2', name: 'Nadie Conocido' }] }, TK);
    r = await call('POST', '/api/olt/auto', {}, T);
    t('el técnico no vincula en lote', r.s === 403, r);
    r = await call('POST', '/api/olt/auto', {}, A);
    t('la vinculación automática empieza mostrando qué haría y no cambia nada', r.s === 200 && r.j.aplicado === false && r.j.lista.seguras.some(x => x.k === 'TPLGAUTO0001' && x.cid === 'h'), r.j);
    t('un nombre que coincide con dos clientes no se vincula solo', r.j.lista.dudosas.some(x => x.k === 'TPLGAUTO0002'), r.j.lista.dudosas);
    t('un nombre que no existe queda como dudoso', r.j.lista.dudosas.some(x => x.k === 'TPLGAUTO0003' && /ningún cliente/.test(x.motivo)), r.j.lista.dudosas);
    r = await call('GET', '/api/olt/cliente/h', undefined, T);
    t('antes de aplicar el cliente sigue sin serie', r.j.sn === null, r.j);
    r = await call('GET', '/api/olt', undefined, A);
    t('el administrador ve la lista de ONU sin cliente con su nombre en la OLT', (r.j.sin || []).some(x => x.k === 'TPLGAUTO0003' && x.name === 'Nadie Conocido'), r.j.sin);
    r = await call('GET', '/api/olt', undefined, T);
    t('el técnico no recibe esa lista', r.s === 200 && Array.isArray(r.j.sin) && r.j.sin.length === 0, r.j);
    r = await call('POST', '/api/olt/auto', { aplicar: true }, A);
    r = await call('GET', '/api/olt/cliente/h', undefined, T);
    t('al aplicar el cliente queda con su ONU y su lectura', r.j.sn === 'TPLGAUTO0001' && r.j.rx === -20, r.j);
    r = await call('POST', '/api/olt/medida', { cid: 'e', rx: 'abc' }, T);
    t('una potencia que no es número se rechaza', r.s === 400, r);
    r = await call('POST', '/api/olt/medida', { cid: 'e', rx: 5 }, T);
    t('una potencia positiva se rechaza', r.s === 400, r);
    r = await call('POST', '/api/olt/medida', { cid: 'zzz', rx: -20 }, T);
    t('un cliente inexistente da 404', r.s === 404, r);
    r = await call('POST', '/api/olt/medida', { cid: 'e', rx: '-28,5' }, T);
    t('el técnico carga una medida a mano y avisa que es mala señal', r.s === 200 && r.j.rx === -28.5 && r.j.mala === true, r);
    r = await call('GET', '/api/olt/cliente/e', undefined, T);
    t('la medida queda guardada con quién la cargó', r.j.rx === -28.5 && r.j.manual === true && r.j.por === 'Tecnico Uno' && r.j.port === '2/7', r.j);
    r = await call('POST', '/api/olt/medida', { cid: 'd', rx: -31 }, T);
    t('un cliente sin serie también guarda su medida', r.s === 200 && r.j.mala === true, r);
    r = await call('GET', '/api/olt/cliente/d', undefined, T);
    t('...y se la ve de nuevo', r.j.rx === -31 && r.j.sn === null && r.j.manual === true, r.j);
    r = await call('GET', '/api/olt', undefined, O);
    const Lm = r.j.lista || [];
    t('las medidas a mano entran en las alertas y se cruzan con su cliente', Lm.some(o => o.cn === 'Con Mapa Luis' && o.rx === -28.5) && Lm.some(o => o.cn === 'Sin Equipo Rosa' && o.rx === -31), Lm);
    r = await call('POST', '/api/olt/ingest', { lect: [{ sn: 'TPLGBBBB2222', rx: -19, port: '2/7' }] }, TK);
    r = await call('GET', '/api/olt/cliente/e', undefined, T);
    t('una lectura nueva del lector reemplaza la medida a mano', r.j.rx === -19 && r.j.manual === false, r.j);
    r = await call('GET', '/api/olt/cliente/e', undefined, undefined);
    t('sin sesión no se ve la ONU del cliente', r.s === 401, r);
    const lista = []; for (let i = 1; i <= 60; i++) lista.push({ sn: 'TPLGMAPA' + String(1000 + i), port: '2/' + i });
    r = await call('POST', '/api/olt/ingest', { lect: [], mapa: lista }, TK);
    t('el lector manda la lista de ONU de la OLT y reemplaza el mapa', r.s === 200 && r.j.mapa === 60, r);
    r = await call('POST', '/api/olt/vincular', { cid: 'f', q: 'MAPA1007' }, T);
    t('una ONU nueva de la OLT se puede vincular sin pasar la configuración', r.s === 200 && r.j.port === '2/7', r);
    r = await call('POST', '/api/olt/vincular', { cid: 'f', q: '1234abcd' }, T);
    t('una ONU dada de baja en la OLT deja de poder vincularse', r.s === 404, r);
    r = await call('POST', '/api/olt/ingest', { lect: [], mapa: lista.slice(0, 5) }, TK);
    t('una lista chica no pisa el mapa (protege ante una lectura incompleta)', r.s === 200 && r.j.mapa === null, r);
  } finally { srv.stop && srv.stop(); }
  console.log('\n' + okN + ' ok, ' + failN + ' con fallas'); process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
