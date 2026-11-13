'use strict';
/* Egresos de efectivo de la caja: quién los carga, que no se puedan editar ni borrar, anulación con motivo y quién los ve. */
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
  const code = 'TEST-CODE-1234-ABCD', dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yapur-egr-'));
  const srv = await start({ code, dir, vars: { DISP_APROBAR: '0' } });
  BASE = srv.base;
  try {
    let r = await call('POST', '/api/setup', { codigo: code, usuario: 'mauro', clave: 'claveSegura1', nombre: 'Mauro' });
    const A = r.j.token;
    await call('POST', '/api/users', { usuario: 'cobra', nombre: 'Brenda', role: 'oficina', clave: 'brenda12' }, A);
    await call('POST', '/api/users', { usuario: 'tec', nombre: 'Pedro', role: 'tecnico', clave: 'pedro12' }, A);
    const O = (await call('POST', '/api/login', { usuario: 'cobra', clave: 'brenda12' })).j.token;
    const T = (await call('POST', '/api/login', { usuario: 'tec', clave: 'pedro12' })).j.token;
    const hoy = new Date().toISOString().slice(0, 10), doc = 'e' + hoy.slice(0, 7).replace('-', '');
    const eg = (o) => Object.assign({ f: hoy, m: 39000, cat: 'equipo', det: 'Router entregado al cliente', c: 'c1', cn: 'Pallares Anabela' }, o || {});
    const put = (tok, items) => call('PATCH', '/api/doc/egresos/' + doc, { data: { items } }, tok);
    r = await put(T, { x1: eg() });
    t('el técnico no puede cargar egresos', r.s === 403, r);
    r = await put(O, { x1: eg() });
    t('la oficina carga un egreso de efectivo', r.s === 200, r);
    r = await call('GET', '/api/doc/egresos/' + doc, undefined, O);
    const it = r.j && (r.j.data || r.j).items && (r.j.data || r.j).items.x1;
    t('queda con quién lo cargó y cuándo', it && it.por && it.ts && it.m === 39000, r.j);
    r = await put(O, { x2: eg({ m: 0 }) });
    t('el importe tiene que ser mayor a cero', r.s === 403, r);
    r = await put(O, { x2: eg({ det: '' }) });
    t('sin detalle no se registra', r.s === 403, r);
    r = await put(O, { x2: eg({ cat: 'inventado' }) });
    t('el motivo tiene que ser uno de la lista', r.s === 403, r);
    r = await put(O, { x2: eg({ extra: 1 }) });
    t('no acepta datos que no corresponden', r.s === 403, r);
    r = await put(O, { x1: eg({ m: 1 }) });
    t('un egreso cargado no se edita', r.s === 403, r);
    r = await put(O, { x1: Object.assign({}, it, { anulado: true, anuladoMotivo: 'error' }) });
    t('la oficina sin permiso de anular no puede anular', r.s === 403, r);
    r = await put(A, { x1: Object.assign({}, it, { anulado: true }) });
    t('anular exige un motivo', r.s === 403, r);
    r = await put(A, { x1: Object.assign({}, it, { anulado: true, anuladoMotivo: 'Se cargó dos veces' }) });
    t('el administrador anula con motivo', r.s === 200, r);
    r = await put(A, { x1: Object.assign({}, it, { anulado: false }) });
    t('un egreso anulado no se reactiva', r.s === 403, r);
    r = await call('DELETE', '/api/doc/egresos/' + doc, undefined, A);
    t('el documento de egresos no se borra', r.s >= 400, r.s);
    r = await call('GET', '/api/sync', undefined, T);
    t('el técnico no recibe los egresos', !(r.j.cols || {}).egresos, Object.keys(r.j.cols || {}));
    r = await call('GET', '/api/sync', undefined, O);
    t('la oficina sí recibe los egresos', (r.j.cols || {}).egresos && r.j.cols.egresos.length === 1, Object.keys(r.j.cols || {}));
  } finally { await srv.stop(); }
  console.log(okN + ' ok, ' + failN + ' con fallas');
  process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
