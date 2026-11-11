'use strict';
/* Historial del cliente (c.hist): quien no es oficina solo puede sumarle renglones; no puede borrar ni cambiar los anteriores. */
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
  const code = 'TEST-CODE-1234-ABCD', dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yapur-hist-'));
  const srv = await start({ code, dir, vars: { DISP_APROBAR: '0' } });
  BASE = srv.base;
  try {
    let r = await call('POST', '/api/setup', { codigo: code, usuario: 'mauro', clave: 'claveSegura1', nombre: 'Mauro' });
    const A = r.j.token;
    await call('POST', '/api/users', { usuario: 'tec1', nombre: 'Pedro', role: 'tecnico', clave: 'pedro1' }, A);
    const T = (await call('POST', '/api/login', { usuario: 'tec1', clave: 'pedro1' })).j.token;
    const h1 = { f: '2026-10-01', t: 'corte' }, h2 = { f: '2026-10-05', t: 'reconexion' };
    const base = { nombre: 'Rosa', estado: 'activo', dir: 'Calle 1', hist: [h1, h2] };
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cH: base } } }, A);
    t('el administrador guarda un cliente con historial', r.s === 200, r);
    const edit = (hist, extra) => call('PATCH', '/api/doc/clientes/c01', { data: { items: { cH: Object.assign({}, base, { dir: 'Calle 2' }, extra || {}, { hist }) } } }, T);
    r = await edit([h1, h2]);
    t('un técnico puede editar datos técnicos sin tocar el historial', r.s === 200, r);
    r = await edit([h1, h2, { f: '2026-11-01', t: 'corte' }]);
    t('puede sumar un renglón', r.s === 200, r);
    r = await edit([h1, { f: '2026-11-02', t: 'otro' }]);
    t('no puede cambiar un renglón anterior', r.s !== 200, r);
    r = await edit([]);
    t('no puede borrar el historial', r.s !== 200, r);
    r = await edit([h1, h2, { f: 'ayer', t: 'corte' }]);
    t('rechaza renglones mal formados', r.s !== 200, r);
    r = await edit([h1, h2, { f: '2026-11-01', t: 'corte' }, { f: '2026-11-02', t: 'a' }, { f: '2026-11-03', t: 'b' }, { f: '2026-11-04', t: 'c' }, { f: '2026-11-05', t: 'd' }]);
    t('no puede sumar muchos de golpe', r.s !== 200, r);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cH: Object.assign({}, base, { hist: [] }) } } }, A);
    t('la oficina o el administrador sí pueden corregirlo', r.s === 200, r);
  } finally { await srv.stop(); }
  console.log('\n' + okN + ' ok, ' + failN + ' con fallas');
  process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
