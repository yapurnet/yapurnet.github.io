'use strict';
/* Cupo del plan gratis de Cloudflare: lo que cuesta despertar al servidor (no debe recorrer las tablas grandes), el consumo que se ve en Ajustes
   (pedidos, filas leídas y escritas) y la pantalla de técnicos leyendo solo las posiciones nuevas. */
const fs = require('fs'), os = require('os'), path = require('path');
const { start } = require('./harness');
let BASE = '', okN = 0, failN = 0;
const t = (name, cond, extra) => { if (cond) { okN++; console.log('ok   ' + name); } else { failN++; console.log('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); } };
async function call(method, p, body, token) {
  const r = await fetch(BASE + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) { /* sin cuerpo */ }
  return { s: r.status, j };
}
(async () => {
  const code = 'TEST-CODE-1234-ABCD', dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yapur-cupo-'));
  let srv = await start({ code, dir: dataDir });
  BASE = srv.base;
  try {
    let r = await call('POST', '/api/setup', { codigo: code, usuario: 'mauro', clave: 'claveSegura1', nombre: 'Mauro' });
    let A = r.j.token;
    await call('POST', '/api/ubicacion/horario', { desde: 0, hasta: 24 }, A);   // todo el día, para probar a cualquier hora
    /* seis técnicos que ya aceptaron el aviso y mandan posiciones (cada una a más de 20 segundos de la anterior) */
    const ahora = Date.now(), TEC = [];
    for (let i = 0; i < 6; i++) {
      await call('POST', '/api/users', { usuario: 'tec' + i, nombre: 'Técnico ' + i, role: 'tecnico', clave: 'tecnico' + i }, A);
      const T = (await call('POST', '/api/login', { usuario: 'tec' + i, clave: 'tecnico' + i })).j.token;
      TEC.push(T);
      await call('POST', '/api/ubicacion/acepto', {}, T);
      const pts = []; for (let k = 0; k < 30; k++) pts.push({ lat: -28.4 - i * 0.001, lng: -62.8 - k * 0.0001, acc: 8, ts: ahora - (30 - k) * 25e3 });
      r = await call('POST', '/api/ubicacion', { pts }, T);
      if (i === 0) t('los puntos se guardan', r.s === 200 && r.j.guardados === 30, r);
    }

    /* la pantalla de técnicos: la segunda vez lee solo lo nuevo, y un punto que llega tarde se ve igual */
    r = await call('GET', '/api/ubicaciones', undefined, A);
    const p0 = r.j.tecnicos.map(x => x.puntos);
    t('la oficina ve las posiciones de los seis técnicos', r.s === 200 && p0.length === 6 && p0.every(n => n === 30), p0);
    const uso1 = (await call('GET', '/api/uso', undefined, A)).j, lee1 = (uso1.pedidos.find(x => x.k === 'GET /api/ubicaciones') || {}).fl;
    await call('GET', '/api/ubicaciones', undefined, A);
    const uso2 = (await call('GET', '/api/uso', undefined, A)).j, lee2 = (uso2.pedidos.find(x => x.k === 'GET /api/ubicaciones') || {}).fl;
    t('el consumo cuenta las filas leídas por cada tipo de pedido', lee1 > 0 && uso2.leidas > 0 && uso2.escritas > 0, [lee1, uso2.leidas, uso2.escritas]);
    t('pedir de nuevo la pantalla de técnicos lee muy pocas filas (no las 180 posiciones otra vez)', lee2 - lee1 < 60, [lee1, lee2]);
    r = await call('POST', '/api/ubicacion', { pts: [{ lat: -28.5, lng: -62.9, acc: 8, ts: ahora - 14 * 60e3 }, { lat: -28.51, lng: -62.91, acc: 8, ts: ahora - 5e3 }] }, TEC[0]);
    t('llegan una posición nueva y otra vieja que llegó tarde', r.s === 200 && r.j.guardados === 2, r);
    r = await call('GET', '/api/ubicaciones', undefined, A);
    const t0 = r.j.tecnicos.find(x => x.nombre === 'Técnico 0');
    t('las dos aparecen en la pantalla (la vieja también) y la ruta sigue en orden', t0.puntos === 32 && t0.ruta.every((x, i, a) => !i || a[i - 1][0] < x[0]) && r.j.tecnicos.filter(x => x.nombre !== 'Técnico 0').every(x => x.puntos === 30), t0.puntos);

    /* despertar el servidor: no tiene que recorrer las tablas grandes (la limpieza de lo viejo corre cada varias horas, no en cada despertar) */
    const desp0 = ((await call('GET', '/api/uso', undefined, A)).j.pedidos || []).find(x => x.k === '(al despertar y otros)');
    await srv.stop(true);
    srv = await start({ code, dir: dataDir });
    BASE = srv.base;
    r = await call('GET', '/api/uso', undefined, A);
    const desp1 = (r.j.pedidos || []).find(x => x.k === '(al despertar y otros)'), desp = { fl: (desp1 ? desp1.fl : 0) - (desp0 ? desp0.fl : 0), fe: (desp1 ? desp1.fe : 0) - (desp0 ? desp0.fe : 0) };   // lo que costó este despertar (el contador del día suma los de antes)
    t('tras despertar, el servidor sigue con sus datos', r.s === 200, r);
    t('despertar no recorre las posiciones (180 filas) ni prueba las columnas de nuevo: se leen menos de 60 filas', desp.fl < 60, desp);
    r = await call('GET', '/api/ubicaciones', undefined, A);
    t('las posiciones siguen después de despertar', r.j.tecnicos.find(x => x.nombre === 'Técnico 0').puntos === 32 && r.j.tecnicos.length === 6, r.j.tecnicos.map(x => x.puntos));

    /* el contador no pierde lo que pasó antes de dormirse */
    await call('GET', '/api/status');
    await new Promise(r => setTimeout(r, 7000));   // pasa el tiempo en que se anota solo
    await srv.stop(true);
    srv = await start({ code, dir: dataDir });
    BASE = srv.base;
    r = await call('GET', '/api/uso', undefined, A);
    t('el consumo de antes del reinicio quedó anotado (aunque el servidor se durmió enseguida)', r.s === 200 && r.j.total >= 12 && r.j.pedidos.some(x => x.k === 'GET /api/status'), [r.j.total, r.j.pedidos.length]);
    t('sin errores en el registro del servidor', !/Uncaught|\bERROR\b|✘/.test(srv.log()), srv.log().split('\n').filter(l => /Uncaught|ERROR|✘/.test(l)).slice(0, 5));
  } catch (e) {
    failN++; console.log('FAIL excepción', e);
  } finally {
    await srv.stop();
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) { /* ya no está */ }
  }
  console.log('\n' + okN + ' ok, ' + failN + ' con fallas');
  process.exit(failN ? 1 : 0);
})();
