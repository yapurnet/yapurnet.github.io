'use strict';
/* Horario de corrido o cortado (mañana y tarde, con siesta): qué día es cada uno, días puntuales, qué guarda el servidor,
   que la siesta no cuente como «sin señal» y cómo se anota la retoma de la tarde. Lo que depende de la hora se prueba con funciones puras. */
const fs = require('fs'), path = require('path');
const { start } = require('./harness');
let BASE = '', okN = 0, failN = 0;
const t = (name, cond, extra) => { if (cond) { okN++; console.log('ok   ' + name); } else { failN++; console.log('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); } };
async function call(method, p, body, token) {
  const r = await fetch(BASE + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) { /* sin cuerpo */ }
  return { s: r.status, j };
}

/* ---------- funciones puras del servidor, con cualquier hora ---------- */
const src = fs.readFileSync(path.join(__dirname, '..', 'worker', 'src', 'worker.js'), 'utf8');
const a0 = src.indexOf('const UBIC_HUECO_MS'), a1 = src.indexOf('/* fin de las funciones puras del horario */');
const P = new Function(src.slice(a0, a1) + '; return { ubicTramosDe, ubicEnTramos, ubicHuecosDia, jornadaRetoma, jornadaEstadoDia, arDayStart, trOk, horaOk };')();
const H = 3600e3, M = 60e3;

function puras() {
  const plan = { corrido: { desde: 8, hasta: 20 }, cortado: { m: [8, 13], t: [17, 22] }, dias: { 0: 'corrido', 1: 'corrido', 2: 'corrido', 3: 'cortado', 4: 'corrido', 5: 'corrido', 6: 'corrido' }, fechas: {} };
  /* 2026-11-04 es miércoles; 2026-11-05, jueves */
  t('un día de corrido tiene un solo tramo', JSON.stringify(P.ubicTramosDe(plan, '2026-11-05')) === '[[8,20]]', P.ubicTramosDe(plan, '2026-11-05'));
  t('un día marcado cortado tiene mañana y tarde', JSON.stringify(P.ubicTramosDe(plan, '2026-11-04')) === '[[8,13],[17,22]]', P.ubicTramosDe(plan, '2026-11-04'));
  t('un día puntual cortado gana sobre el día de la semana', JSON.stringify(P.ubicTramosDe(Object.assign({}, plan, { fechas: { '2026-11-05': 'cortado' } }), '2026-11-05')) === '[[8,13],[17,22]]');
  t('un día puntual de corrido gana sobre un miércoles cortado', JSON.stringify(P.ubicTramosDe(Object.assign({}, plan, { fechas: { '2026-11-04': 'corrido' } }), '2026-11-04')) === '[[8,20]]');
  t('sin horario cortado cargado, todo es de corrido aunque el día diga cortado', JSON.stringify(P.ubicTramosDe(Object.assign({}, plan, { cortado: null }), '2026-11-04')) === '[[8,20]]');
  t('una fecha inválida no rompe: queda de corrido', JSON.stringify(P.ubicTramosDe(plan, 'x')) === '[[8,20]]');
  const c = [[8, 13], [17, 22]], mn = h => Math.round(h * 60);
  t('7:59 está fuera, 8:00 dentro', !P.ubicEnTramos(c, mn(7.99)) && P.ubicEnTramos(c, mn(8)));
  t('12:59 dentro, 13:00 fuera (empieza la siesta)', P.ubicEnTramos(c, 12 * 60 + 59) && !P.ubicEnTramos(c, 13 * 60));
  t('a las 15 (siesta) está fuera', !P.ubicEnTramos(c, 15 * 60));
  t('17:00 dentro, 21:59 dentro, 22:00 fuera', P.ubicEnTramos(c, 17 * 60) && P.ubicEnTramos(c, 21 * 60 + 59) && !P.ubicEnTramos(c, 22 * 60));
  t('horaOk/trOk: 8 a 13 sí; 13 a 13, 13 a 8 y 8 a 25 no', P.trOk([8, 13]) && !P.trOk([13, 13]) && !P.trOk([13, 8]) && !P.trOk([8, 25]) && !P.trOk(['8', '13']));

  /* sin señal por tramo */
  const dia = '2026-10-28', t0 = P.arDayStart(dia), pts = (d, h) => { const o = []; for (let x = d * 60; x < h * 60; x++) o.push(t0 + x * M); return o; };
  const todo = [...pts(8, 13), ...pts(17, 22)];
  t('un día completo en dos tramos: la siesta NO es un hueco', P.ubicHuecosDia(todo, t0, c, t0 + 30 * H, false).length === 0, P.ubicHuecosDia(todo, t0, c, t0 + 30 * H, false));
  let hu = P.ubicHuecosDia(pts(8, 13), t0, c, t0 + 30 * H, false);
  t('si no mandó nada a la tarde, es un solo hueco de 17 a 22', hu.length === 1 && hu[0].desde === t0 + 17 * H && hu[0].hasta === t0 + 22 * H, hu);
  hu = P.ubicHuecosDia([...pts(8, 9), ...pts(9.5, 13), ...pts(17, 22)], t0, c, t0 + 30 * H, false);
  t('un corte de media hora a la mañana es un hueco de 8:59 a 9:30', hu.length === 1 && hu[0].desde === t0 + 8 * H + 59 * M && hu[0].hasta === t0 + 9.5 * H, hu);
  hu = P.ubicHuecosDia(pts(17, 22), t0, c, t0 + 30 * H, false);
  t('si solo mandó a la tarde, la mañana entera es un hueco que arranca en el inicio del horario', hu.length === 1 && hu[0].desde === t0 + 8 * H && hu[0].hasta === t0 + 13 * H, hu);
  hu = P.ubicHuecosDia(pts(8, 13), t0, c, t0 + 15 * H, true);
  t('hoy, a las 15 (siesta): la tarde todavía no empezó, no hay huecos', hu.length === 0, hu);
  hu = P.ubicHuecosDia(pts(8, 13), t0, c, t0 + 17.5 * H, true);
  t('hoy, a las 17:30 sin nada a la tarde: hueco abierto desde las 17', hu.length === 1 && hu[0].desde === t0 + 17 * H && hu[0].sigue === true, hu);
  hu = P.ubicHuecosDia([...pts(8, 13), ...pts(17, 17.5)], t0, c, t0 + 17.5 * H, true);
  t('hoy, a las 17:30 con señal desde las 17: sin huecos', hu.length === 0, hu);
  hu = P.ubicHuecosDia(pts(8, 20), t0, [[8, 20]], t0 + 30 * H, false);
  t('de corrido funciona igual que antes', hu.length === 0);

  /* la retoma de la tarde */
  const f = o => Object.assign({ ingreso: t0 + 8.1 * H, ingreso2: null }, o);
  t('retoma: aparece en la base a las 17:05 habiendo ingresado a la mañana', P.jornadaRetoma(c, t0, f(), t0 + 17.08 * H) === true);
  t('no es retoma si todavía es la mañana o la siesta', P.jornadaRetoma(c, t0, f(), t0 + 11 * H) === false && P.jornadaRetoma(c, t0, f(), t0 + 15 * H) === false);
  t('no es retoma si su ingreso ya fue a la tarde (no vino a la mañana)', P.jornadaRetoma(c, t0, f({ ingreso: t0 + 17.5 * H }), t0 + 17.6 * H) === false);
  t('la retoma no se pisa', P.jornadaRetoma(c, t0, f({ ingreso2: t0 + 17.1 * H }), t0 + 18 * H) === false);
  t('de corrido no hay retoma', P.jornadaRetoma([[8, 20]], t0, f(), t0 + 17.08 * H) === false);

  /* estado de la jornada en un día cortado */
  const o = (extra) => Object.assign({ dia, hoy: dia, ahora: t0 + 14 * H, tr: c, base: true, laborable: true, tol: 10 }, extra || {});
  const v = x => Object.assign({ ingreso: t0 + 8.05 * H, origen: 'base', dist: 3, regreso: null, enBase: true, ingreso2: null }, x);
  let e = P.jornadaEstadoDia(v({ regreso: t0 + 13.08 * H }), o());
  t('a las 14, con la mañana hecha: «siesta»', e.estado === 'siesta' && e.sinRetomar === false, e);
  e = P.jornadaEstadoDia(v({ regreso: t0 + 13.08 * H }), o({ ahora: t0 + 17.3 * H }));
  t('a las 17:18 y todavía sin aparecer en la base: sigue «trabajando» (el regreso de la siesta no es el fin del día) y «sin retomar»', e.estado === 'trabajando' && e.sinRetomar === true, e);
  e = P.jornadaEstadoDia(v({ regreso: t0 + 13.08 * H }), o({ ahora: t0 + 17.1 * H }));
  t('a las 17:06, dentro de la tolerancia, todavía no es «sin retomar»', e.sinRetomar === false, e);
  e = P.jornadaEstadoDia(v({ regreso: t0 + 13.08 * H, ingreso2: t0 + 17.07 * H }), o({ ahora: t0 + 18 * H }));
  t('retomó a las 17:04: «trabajando», 4 min de atraso, no tarde', e.estado === 'trabajando' && e.atraso2Min === 4 && e.tarde2 === false && e.sinRetomar === false, e);
  e = P.jornadaEstadoDia(v({ regreso: t0 + 13.08 * H, ingreso2: t0 + 17.42 * H }), o({ ahora: t0 + 18 * H }));
  t('retomó a las 17:25: 25 min tarde', e.atraso2Min === 25 && e.tarde2 === true, e);
  e = P.jornadaEstadoDia(v({ regreso: t0 + 21.83 * H, ingreso2: t0 + 17.07 * H }), o({ ahora: t0 + 22.5 * H }));
  t('volvió a la base a las 21:50: «termino»', e.estado === 'termino', e);
  e = P.jornadaEstadoDia(v({ regreso: t0 + 21.83 * H, ingreso2: t0 + 17.07 * H }), o({ dia: '2026-10-28', hoy: '2026-10-29', ahora: t0 + 30 * H }));
  t('un día pasado completo: «termino»', e.estado === 'termino' && e.sinRetomar === false, e);
  e = P.jornadaEstadoDia(v({ regreso: t0 + 13.08 * H }), o({ hoy: '2026-10-29', ahora: t0 + 30 * H }));
  t('un día pasado en que no volvió a la tarde: «sin_cierre» y «sin retomar»', e.estado === 'sin_cierre' && e.sinRetomar === true, e);
  e = P.jornadaEstadoDia(v({ ingreso: t0 + 17.5 * H }), o({ ahora: t0 + 18 * H }));
  t('si recién apareció a la tarde: 9 h 30 min tarde respecto de la mañana, y sin «sin retomar»', e.atrasoMin === 570 && e.tarde === true && e.sinRetomar === false, e);
  e = P.jornadaEstadoDia(v({ ingreso: t0 + 8.5 * H }), o({ ahora: t0 + 10 * H }));
  t('a las 8:30 de ingreso: 30 min tarde', e.atrasoMin === 30 && e.tarde === true, e);
  e = P.jornadaEstadoDia(null, o({ ahora: t0 + 8.1 * H }));
  t('sin ingreso, dentro de la tolerancia: «esperando»', e.estado === 'esperando', e);
  e = P.jornadaEstadoDia(null, o({ ahora: t0 + 9 * H }));
  t('sin ingreso, pasada la tolerancia: «sin_ingreso»', e.estado === 'sin_ingreso', e);
  e = P.jornadaEstadoDia(null, o({ base: false, ahora: t0 + 9 * H }));
  t('sin base cargada: «sin_base»', e.estado === 'sin_base', e);
  e = P.jornadaEstadoDia(null, o({ laborable: false, ahora: t0 + 9 * H }));
  t('un día no laborable: «no_laborable»', e.estado === 'no_laborable', e);
  e = P.jornadaEstadoDia(v({ regreso: t0 + 19.9 * H }), o({ tr: [[8, 20]], ahora: t0 + 20.5 * H }));
  t('de corrido: terminó al volver a la base, sin siesta ni retoma', e.estado === 'termino' && e.sinRetomar === false && e.ingreso2 === null, e);
  e = P.jornadaEstadoDia(v({ regreso: t0 + 11 * H }), o({ tr: [[8, 20]], ahora: t0 + 12 * H }));
  t('de corrido, a las 12: volvió a la base pero ya no es «siesta»', e.estado === 'termino', e);
}

(async () => {
  puras();
  const code = 'TEST-CODE-1234-ABCD';
  const srv = await start({ code });
  BASE = srv.base;
  try {
    const ahoraAR = new Date(Date.now() - 3 * 3600e3), h0 = ahoraAR.getUTCHours(), min0 = ahoraAR.getUTCMinutes();
    let r = await call('POST', '/api/setup', { codigo: code, usuario: 'mauro', clave: 'claveSegura1', nombre: 'Mauro' });
    const A = r.j.token;
    await call('POST', '/api/users', { usuario: 'ofi', nombre: 'Laura', role: 'oficina', clave: 'laura1' }, A);
    await call('POST', '/api/users', { usuario: 'pedro', nombre: 'Pedro', role: 'tecnico', clave: 'pedro1' }, A);
    const O = (await call('POST', '/api/login', { usuario: 'ofi', clave: 'laura1' })).j.token;
    const P1 = (await call('POST', '/api/login', { usuario: 'pedro', clave: 'pedro1' })).j.token;
    await call('POST', '/api/ubicacion/acepto', {}, P1);
    const hoy = ahoraAR.toISOString().slice(0, 10);

    /* por defecto: de corrido, de 8 a 20 */
    r = await call('GET', '/api/ubicacion/estado', undefined, P1);
    t('por defecto el día es de corrido, un solo tramo de 8 a 20', r.s === 200 && JSON.stringify(r.j.tramos) === '[[8,20]]' && r.j.modo === 'corrido' && r.j.desde === 8 && r.j.hasta === 20 && r.j.fecha === hoy, r.j);

    /* quién lo cambia y qué se acepta */
    const plan = { desde: 8, hasta: 20, cortado: { m: [8, 13], t: [17, 22] }, dias: { 0: 'corrido', 1: 'cortado', 2: 'cortado', 3: 'cortado', 4: 'cortado', 5: 'cortado', 6: 'corrido' }, fechas: {} };
    r = await call('POST', '/api/ubicacion/plan', plan, P1);
    t('el técnico no puede cambiar el horario', r.s === 403, r);
    r = await call('POST', '/api/ubicacion/plan', plan, O);
    t('la oficina tampoco: solo el administrador', r.s === 403, r);
    const malo = async (name, over, frag) => { const x = await call('POST', '/api/ubicacion/plan', Object.assign({}, plan, over), A); t(name, x.s === 400 && (!frag || String(x.j.error).includes(frag)), x); };
    await malo('la mañana no puede terminar después de que empieza la tarde', { cortado: { m: [8, 18], t: [17, 22] } }, 'antes de que empiece la tarde');
    await malo('tampoco pegada a la tarde (13 y 13)', { cortado: { m: [8, 13], t: [13, 22] } }, 'antes de que empiece la tarde');
    await malo('un tramo con «desde» mayor que «hasta» no se acepta', { cortado: { m: [13, 8], t: [17, 22] } }, 'cortado no es válido');
    await malo('una hora de 25 no se acepta', { cortado: { m: [8, 13], t: [17, 25] } }, 'cortado no es válido');
    await malo('horas como texto no se aceptan', { cortado: { m: ['8', '13'], t: [17, 22] } });
    await malo('el horario de corrido inválido no se acepta', { desde: 20, hasta: 8 }, 'de corrido no es válido');
    await malo('un día con un modo desconocido no se acepta', { dias: Object.assign({}, plan.dias, { 2: 'medio' }) }, 'corrido» o «cortado');
    await malo('días cortados sin cargar el horario cortado no se aceptan', { cortado: null }, 'dos tramos');
    await malo('un día puntual con fecha inválida no se acepta', { fechas: { 'mañana': 'cortado' } }, 'puntual');
    await malo('un día puntual con modo inválido no se acepta', { fechas: { '2026-12-01': 'raro' } }, 'puntual');
    const muchas = {}; for (let i = 0; i < 201; i++) muchas[new Date(Date.UTC(2027, 0, 1 + i)).toISOString().slice(0, 10)] = 'cortado';
    await malo('más de 200 días puntuales no se aceptan', { fechas: muchas }, 'demasiados');

    /* un plan válido se guarda y se devuelve */
    r = await call('POST', '/api/ubicacion/plan', Object.assign({}, plan, { fechas: { '2020-01-01': 'cortado', '2026-12-24': 'corrido' } }), A);
    t('el administrador guarda el horario partido', r.s === 200 && JSON.stringify(r.j.plan.cortado) === '{"m":[8,13],"t":[17,22]}' && r.j.plan.dias[1] === 'cortado' && r.j.plan.dias[0] === 'corrido' && r.j.plan.corrido.hasta === 20, r);
    t('los días puntuales de hace más de 60 días se descartan y los futuros se conservan', r.j.plan.fechas['2020-01-01'] === undefined && r.j.plan.fechas['2026-12-24'] === 'corrido', r.j.plan.fechas);
    r = await call('GET', '/api/ubicaciones', undefined, A);
    t('el administrador recibe el plan y el horario del día (con sus tramos)', r.s === 200 && r.j.plan && r.j.plan.cortado && Array.isArray(r.j.horario.tramos) && ['corrido', 'cortado'].includes(r.j.horario.modo), r.j.horario);

    /* la ruta vieja sigue cambiando solo el horario de corrido */
    r = await call('POST', '/api/ubicacion/horario', { desde: 6, hasta: 18 }, A);
    r = await call('GET', '/api/ubicaciones', undefined, A);
    t('el viejo «cambiar el horario» sigue cambiando el de corrido y no toca el cortado', r.j.plan.corrido.desde === 6 && r.j.plan.corrido.hasta === 18 && r.j.plan.cortado.m[0] === 8, r.j.plan);

    /* lo que guarda el servidor según el horario de HOY (hay que estar bien adentro de la hora para que la prueba no se parta en dos horas) */
    if (h0 < 2 || h0 > 21 || min0 < 3 || min0 > 58) { t('(salteado: con esta hora del día las pruebas de «dentro y fuera de horario» caerían cerca de un cambio de hora)', true); }
    else {
      const ahora = Date.now();   // los puntos se mandan con hora de hace 30 a 120 segundos (el servidor solo acepta los últimos 15 minutos)
      const poner = (pl) => call('POST', '/api/ubicacion/plan', Object.assign({}, plan, pl), A);
      const post = (tk, ts) => call('POST', '/api/ubicacion', { pts: [{ lat: -28.41, lng: -62.81, acc: 8, ts }] }, tk);
      const base = { desde: 0, hasta: 24, dias: { 0: 'corrido', 1: 'corrido', 2: 'corrido', 3: 'corrido', 4: 'corrido', 5: 'corrido', 6: 'corrido' } };

      /* en la siesta de hoy */
      r = await poner(Object.assign({}, base, { cortado: { m: [0, h0], t: [h0 + 1, 24] }, fechas: { [hoy]: 'cortado' } }));
      t('hoy cortado, con la siesta ahora: se guarda', r.s === 200 && r.j.hoy.modo === 'cortado', r);
      r = await call('GET', '/api/ubicacion/estado', undefined, P1);
      t('el técnico ve dos tramos y que ahora está fuera de horario', JSON.stringify(r.j.tramos) === JSON.stringify([[0, h0], [h0 + 1, 24]]) && r.j.modo === 'cortado' && r.j.dentro === false && r.j.desde === 0 && r.j.hasta === 24, r.j);
      r = await post(P1, ahora - 120e3);
      t('en la siesta el servidor no guarda nada, aunque el celular lo mande', r.s === 200 && r.j.guardados === 0 && r.j.fuera_horario === true, r.j);
      r = await call('GET', '/api/ubicaciones', undefined, A);
      let pe = r.j.tecnicos.find(x => x.nombre === 'Pedro');
      t('y en la oficina figura «fuera_horario» sin huecos inventados', pe.estado === 'fuera_horario' && pe.huecos.length === 0, pe);

      /* a la mañana */
      r = await poner(Object.assign({}, base, { cortado: { m: [0, Math.min(h0 + 1, 22)], t: [Math.min(h0 + 2, 23), 24] }, fechas: { [hoy]: 'cortado' } }));
      r = await post(P1, ahora - 90e3);
      t('con un tramo de mañana que incluye la hora actual, se guarda', r.j.guardados === 1 && !r.j.fuera_horario && r.j.tramos.length === 2, r.j);
      r = await call('GET', '/api/ubicaciones', undefined, A);
      pe = r.j.tecnicos.find(x => x.nombre === 'Pedro');
      t('en la oficina: «en_linea» con un punto reciente', pe.estado === 'en_linea' && pe.puntos === 1, pe);

      /* a la tarde: la última posición viene de otro tramo */
      r = await poner(Object.assign({}, base, { cortado: { m: [0, 1], t: [2, h0 + 1] }, fechas: { [hoy]: 'cortado' } }));
      r = await post(P1, ahora - 60e3);
      t('con la hora actual en el tramo de la tarde, se guarda', r.j.guardados === 1 && !r.j.fuera_horario, r.j);

      /* un día puntual de corrido gana sobre los días cortados */
      r = await poner(Object.assign({}, base, { dias: { 0: 'cortado', 1: 'cortado', 2: 'cortado', 3: 'cortado', 4: 'cortado', 5: 'cortado', 6: 'cortado' }, cortado: { m: [0, h0], t: [h0 + 1, 24] }, fechas: { [hoy]: 'corrido' } }));
      r = await call('GET', '/api/ubicacion/estado', undefined, P1);
      t('hoy marcado de corrido, aunque todos los días de la semana sean cortados: un solo tramo y dentro', JSON.stringify(r.j.tramos) === '[[0,24]]' && r.j.modo === 'corrido' && r.j.dentro === true, r.j);
      r = await post(P1, ahora - 30e3);
      t('y el servidor guarda', r.j.guardados === 1, r.j);
      r = await poner(Object.assign({}, base, { dias: { 0: 'cortado', 1: 'cortado', 2: 'cortado', 3: 'cortado', 4: 'cortado', 5: 'cortado', 6: 'cortado' }, cortado: { m: [0, h0], t: [h0 + 1, 24] }, fechas: {} }));
      r = await call('GET', '/api/ubicacion/estado', undefined, P1);
      t('sin día puntual, vale el de la semana (cortado)', r.j.modo === 'cortado' && r.j.dentro === false, r.j);

      /* la jornada en la siesta */
      await call('POST', '/api/jornada/base', { lat: -28.4601, lng: -62.8302, radio: 40, tol: 10, dias: [0, 1, 2, 3, 4, 5, 6] }, A);
      r = await call('POST', '/api/jornada/ingreso', {}, P1);
      t('el técnico inicia su jornada a mano', r.s === 200 && r.j.fila && r.j.fila.origen === 'manual', r);
      r = await call('GET', '/api/jornada', undefined, P1);
      t('él ve los tramos de hoy en su estado', r.j.horario && r.j.horario.tramos.length === 2 && r.j.horario.desde === 0 && r.j.horario.hasta === 24, r.j.horario);
      r = await call('GET', '/api/ubicaciones', undefined, A);
      pe = r.j.tecnicos.find(x => x.nombre === 'Pedro');
      t('la oficina ve «siesta» (jornada cortada, ya empezó) y no «terminó» ni «sin ingreso»', pe.jornada.estado === 'siesta' && pe.jornada.cortado === true && pe.jornada.sinRetomar === false, pe.jornada);
      r = await poner(Object.assign({}, base, { cortado: null, dias: base.dias, fechas: {} }));
      r = await call('GET', '/api/ubicaciones', undefined, A);
      pe = r.j.tecnicos.find(x => x.nombre === 'Pedro');
      t('al pasar el día a corrido, deja de ser «siesta»', pe.jornada.estado === 'trabajando' && pe.jornada.cortado === false, pe.jornada);
    }

    /* los datos de ubicación y jornada no cambian el respaldo: el horario es configuración, no datos de clientes */
    r = await call('GET', '/api/backup', undefined, A);
    t('el respaldo sigue andando', r.s === 200, r.s);
  } finally { await srv.stop(); }
  console.log(`\n${okN} ok, ${failN} con fallas`);
  process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
