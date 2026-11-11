'use strict';
/* Freno automático: con el cupo del día avanzado, la ubicación de un técnico se guarda más espaciada y la respuesta le pide a la app que se espacie. */
const fs = require('fs'), path = require('path'), os = require('os');
const { start } = require('./harness');
let BASE = '', okN = 0, failN = 0;
const t = (name, cond, extra) => { if (cond) { okN++; console.log('ok   ' + name); } else { failN++; console.log('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 300) : '')); } };
async function call(method, p, body, token) {
  const r = await fetch(BASE + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) { /* sin cuerpo */ }
  return { s: r.status, j };
}
async function caso(nivel, esperado) {
  const code = 'TEST-CODE-1234-ABCD', dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yapur-freno-'));
  const srv = await start({ code, dir, vars: { FRENO_FORZAR: String(nivel) } });
  BASE = srv.base;
  try {
    let r = await call('POST', '/api/setup', { codigo: code, usuario: 'mauro', clave: 'claveSegura1', nombre: 'Mauro' });
    const A = r.j.token;
    await call('POST', '/api/users', { usuario: 'pedro', nombre: 'Pedro', role: 'tecnico', clave: 'pedro1' }, A);
    const P = (await call('POST', '/api/login', { usuario: 'pedro', clave: 'pedro1' })).j.token;
    await call('POST', '/api/ubicacion/horario', { desde: 0, hasta: 24 }, A);
    await call('POST', '/api/ubicacion/acepto', {}, P);
    const ahora = Date.now(), pts = [0, 30, 70, 130, 250].map((s, i) => ({ lat: -28.46 + i * 1e-4, lng: -62.83, acc: 10, ts: ahora - 290e3 + s * 1e3 }));
    r = await call('POST', '/api/ubicacion', { pts }, P);
    t('nivel ' + nivel + ': se guardan ' + esperado + ' de 5 puntos', r.s === 200 && r.j.guardados === esperado && r.j.freno.nivel === nivel, r.j);
    if (nivel) t('nivel ' + nivel + ': le pide a la app espaciarse', r.j.freno.seg >= 60, r.j.freno);
    r = await call('POST', '/api/ubicacion/latido', { via: 'web' }, P);
    t('nivel ' + nivel + ': el latido también trae el pedido', r.s === 200 && r.j.freno && r.j.freno.nivel === nivel, r.j);
  } finally { await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
}
(async () => {
  try { await caso(0, 5); await caso(1, 4); await caso(2, 3); await caso(3, 1); }
  catch (e) { failN++; console.log('FAIL excepción', e); }
  console.log(`\n${okN} ok, ${failN} con fallas`); process.exit(failN ? 1 : 0);
})();
