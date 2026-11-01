'use strict';
/* Horas trabajadas: cuánto se cuenta de cada día (de corrido o cortado), el resumen diario y semanal, qué ve cada uno y las correcciones de la oficina. */
const fs = require('fs'), path = require('path');
const { start } = require('./harness');
let BASE = '', okN = 0, failN = 0;
const t = (name, cond, extra) => { if (cond) { okN++; console.log('ok   ' + name); } else { failN++; console.log('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); } };
async function call(method, p, body, token) {
  const r = await fetch(BASE + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) { /* sin cuerpo */ }
  return { s: r.status, j };
}

const src = fs.readFileSync(path.join(__dirname, '..', 'worker', 'src', 'worker.js'), 'utf8');
const a0 = src.indexOf('const UBIC_HUECO_MS'), a1 = src.indexOf('/* fin de las funciones puras del horario */');
const P = new Function(src.slice(a0, a1) + '; return { jornadaHoras, arDayStart, trStr, trParse };')();
const H = 3600e3, M = 60e3;

function puras() {
  const dia = '2026-10-28', t0 = P.arDayStart(dia), at = h => t0 + Math.round(h * 60) * M;   // at(8.05) = 8:03
  const corr = [[8, 20]], cort = [[8, 13], [17, 22]], pasado = { dia, hoy: '2026-10-29', ahora: t0 + 30 * H };
  const hoyA = (h, tr) => ({ dia, hoy: dia, ahora: at(h), tr });
  const hm = x => Math.floor(x / 60) + ':' + String(x % 60).padStart(2, '0');

  /* de corrido */
  let r = P.jornadaHoras({ ingreso: at(8.05), ult: at(19.75), ev: [[at(10), 0], [at(19.75), 1]] }, Object.assign({ tr: corr }, pasado));
  t('de corrido, ingresó 8:03 y volvió a la base 19:45: 11 h 42 min', r.min === 702 && r.estado === 'ok' && r.segs.length === 1 && r.segs[0][0] === at(8.05) && r.segs[0][1] === at(19.75), [hm(r.min), r.estado]);
  r = P.jornadaHoras({ ingreso: at(8.05), ult: at(15), ev: [[at(10), 0]] }, hoyA(15, corr));
  t('de corrido, hoy y todavía afuera: se cuenta hasta ahora y figura «en curso»', r.min === 417 && r.estado === 'en_curso', [hm(r.min), r.estado]);
  r = P.jornadaHoras({ ingreso: at(8.05), ult: at(17.5), ev: [[at(10), 0]] }, Object.assign({ tr: corr }, pasado));
  t('de corrido, un día pasado en que no volvió a la base: hasta la última posición, «incompleto»', r.min === 567 && r.estado === 'incompleto', [hm(r.min), r.estado]);
  r = P.jornadaHoras({ ingreso: at(8.05), ult: at(19.98), ev: [] }, Object.assign({ tr: corr }, pasado));
  t('si nunca salió de la base: «incompleto» (no se sabe cuándo terminó)', r.estado === 'incompleto', r);
  r = P.jornadaHoras({ ingreso: at(8.05), ult: at(19.98), ev: [[at(10), 0]] }, hoyA(21, corr));
  t('hoy pero ya pasó el final del horario sin que vuelva a la base: «incompleto»', r.estado === 'incompleto' && r.segs[0][1] === at(19.98), r);
  r = P.jornadaHoras({ ingreso: at(8.05), ult: at(11), ev: [[at(10), 0], [at(11), 1]] }, hoyA(11.5, corr));
  t('hoy, volvió a la base a las 11: ese es el fin hasta que vuelva a salir', r.min === 177 && r.estado === 'ok', [hm(r.min), r.estado]);
  r = P.jornadaHoras({ ingreso: at(8.05), ult: at(12), ev: [[at(10), 0], [at(11), 1], [at(12), 0]] }, hoyA(12.5, corr));
  t('y si vuelve a salir, sigue contando', r.estado === 'en_curso' && r.min === Math.round((12.5 - 8.05) * 60), [hm(r.min), r.estado]);
  r = P.jornadaHoras({ ingreso: at(8.05), ult: at(19.75), ev: [[at(10), 0], [at(19.75), 1]], tr: '8-20' }, Object.assign({ tr: cort }, pasado));
  t('manda el horario guardado con la fila, no el plan actual', r.segs.length === 1 && r.min === 702, r);

  /* cortado */
  const ev = [[at(9), 0], [at(12.67), 1], [at(17.17), 0], [at(21.83), 1]];
  r = P.jornadaHoras({ ingreso: at(8), ingreso2: at(17.02), ult: at(21.83), ev }, Object.assign({ tr: cort }, pasado));
  t('cortado, un día completo: mañana 8:00 a 12:40 y tarde 17:01 a 21:50, sin la siesta', r.segs.length === 2 && r.min === 280 + 289 && r.estado === 'ok', [hm(r.min), r.segs]);
  r = P.jornadaHoras({ ingreso: at(8), ult: at(12), ev: [[at(9), 0]] }, Object.assign({ tr: cort }, pasado));
  t('cortado, salió a la calle y a las 13 cortó sin volver a la base: la mañana cuenta hasta las 13', r.segs.length === 1 && r.min === 300 && r.estado === 'ok', [hm(r.min), r.estado]);
  r = P.jornadaHoras({ ingreso: at(8), ingreso2: at(17.02), ult: at(21), ev: [[at(9), 0], [at(12.67), 1], [at(17.17), 0]] }, Object.assign({ tr: cort }, pasado));
  t('cortado, la tarde sin volver a la base: hasta la última posición y «incompleto»', r.estado === 'incompleto' && r.segs[1][1] === at(21) && r.min === 280 + Math.round((21 - 17.02) * 60), [hm(r.min), r.estado]);
  r = P.jornadaHoras({ ingreso: at(8), ult: at(12.67), ev: [[at(9), 0], [at(12.67), 1]] }, hoyA(15, cort));
  t('cortado, hoy en la siesta: solo la mañana, «ok»', r.min === 280 && r.estado === 'ok', [hm(r.min), r.estado]);
  r = P.jornadaHoras({ ingreso: at(8), ingreso2: at(17.02), ult: at(18), ev: [[at(9), 0], [at(12.67), 1], [at(17.17), 0]] }, hoyA(18, cort));
  t('cortado, hoy a las 18 con la tarde abierta: mañana + hasta ahora, «en curso»', r.estado === 'en_curso' && r.min === 280 + Math.round((18 - 17.02) * 60), [hm(r.min), r.estado]);
  r = P.jornadaHoras({ ingreso: at(17.5), ult: at(21.83), ev: [[at(19), 0], [at(21.83), 1]] }, Object.assign({ tr: cort }, pasado));
  t('cortado, no vino a la mañana: solo la tarde, desde su ingreso', r.segs.length === 1 && r.segs[0][0] === at(17.5) && r.min === 260, [hm(r.min), r.segs]);
  r = P.jornadaHoras({ ingreso: at(8), ult: at(21.83), ev: [[at(9), 0], [at(12.67), 1], [at(17.08), 0], [at(21.83), 1]] }, Object.assign({ tr: cort }, pasado));
  t('cortado, sin retoma pero volvió a la base de noche: se cuenta desde las 17 y queda «estimado»', r.segs.length === 2 && r.segs[1][0] === at(17) && r.estimado === true && r.min === 280 + 290, [hm(r.min), r.segs, r.estimado]);

  /* corrección de la oficina */
  r = P.jornadaHoras({ ingreso: at(8), ult: at(10), ev: [], adj: { s: [[at(8), at(12.5)], [at(17), at(21)]] } }, Object.assign({ tr: cort }, pasado));
  t('corregido a mano: cuenta lo cargado (4 h 30 min + 4 h) y figura «corregido»', r.min === 510 && r.estado === 'corregido' && r.segs.length === 2, [hm(r.min), r.estado]);
  r = P.jornadaHoras({ ingreso: at(8), ult: at(10), ev: [], adj: { s: [[at(10), at(9)]] } }, Object.assign({ tr: corr }, pasado));
  t('un tramo al revés no suma', r.min === 0, r);
  t('trStr / trParse van y vuelven', P.trStr(cort) === '8-13,17-22' && JSON.stringify(P.trParse('8-13,17-22')) === JSON.stringify(cort) && P.trParse('x').length === 0);
}

(async () => {
  puras();
  const code = 'TEST-CODE-1234-ABCD';
  const srv = await start({ code });
  BASE = srv.base;
  try {
    const ahoraAR = new Date(Date.now() - 3 * 3600e3), hoy = ahoraAR.toISOString().slice(0, 10), ayer = new Date(ahoraAR.getTime() - 864e5).toISOString().slice(0, 10);
    let r = await call('POST', '/api/setup', { codigo: code, usuario: 'mauro', clave: 'claveSegura1', nombre: 'Mauro' });
    const A = r.j.token;
    await call('POST', '/api/users', { usuario: 'ofi', nombre: 'Laura', role: 'oficina', clave: 'laura1' }, A);
    await call('POST', '/api/users', { usuario: 'pedro', nombre: 'Pedro', role: 'tecnico', clave: 'pedro1' }, A);
    await call('POST', '/api/users', { usuario: 'juan', nombre: 'Juan', role: 'tecnico', clave: 'juan11' }, A);
    const O = (await call('POST', '/api/login', { usuario: 'ofi', clave: 'laura1' })).j.token;
    const P1 = (await call('POST', '/api/login', { usuario: 'pedro', clave: 'pedro1' })).j.token;
    const J1 = (await call('POST', '/api/login', { usuario: 'juan', clave: 'juan11' })).j.token;
    const users = (await call('GET', '/api/users', undefined, A)).j;
    const lista = Array.isArray(users) ? users : users.users || users.usuarios || [];
    const idDe = n => (lista.find(x => x.nombre === n) || {}).id;
    const idP = idDe('Pedro'), idJ = idDe('Juan');
    t('(los ids de los técnicos se conocen)', !!idP && !!idJ, lista.map(x => x.nombre));
    await call('POST', '/api/ubicacion/plan', { desde: 0, hasta: 24, cortado: null, dias: { 0: 'corrido', 1: 'corrido', 2: 'corrido', 3: 'corrido', 4: 'corrido', 5: 'corrido', 6: 'corrido' }, fechas: {} }, A);
    for (const tk of [P1, J1]) await call('POST', '/api/ubicacion/acepto', {}, tk);
    await call('POST', '/api/jornada/base', { lat: -28.4601, lng: -62.8302, radio: 40, tol: 10, dias: [0, 1, 2, 3, 4, 5, 6] }, A);

    /* resumen vacío: una semana de lunes a domingo */
    r = await call('GET', '/api/jornada/horas', undefined, A);
    t('el administrador pide el resumen: la semana de lunes a domingo con los dos técnicos', r.s === 200 && r.j.tecnicos.length === 2 && r.j.tecnicos[0].dias.length === 7 && new Date(r.j.desde + 'T12:00:00Z').getUTCDay() === 1 && new Date(r.j.hasta + 'T12:00:00Z').getUTCDay() === 0 && r.j.desde <= hoy && hoy <= r.j.hasta && r.j.puedeAjustar === true, r.j && { d: r.j.desde, h: r.j.hasta });
    t('sin jornadas, todo en 0 y «sin_registro»', r.j.tecnicos.every(x => x.total === 0 && x.dias.every(d => d.estado === 'sin_registro' && d.min === 0)), r.j.tecnicos[0]);
    r = await call('GET', '/api/jornada/horas?desde=' + ayer + '&dias=3', undefined, A);
    t('se puede pedir otro rango: 3 días desde ayer', r.j.desde === ayer && r.j.dias === undefined && r.j.tecnicos[0].dias.length === 3 && r.j.hasta >= hoy, r.j && [r.j.desde, r.j.hasta]);
    r = await call('GET', '/api/jornada/horas?desde=2000-01-01&dias=2', undefined, A);
    t('no se mira más atrás de 90 días', r.j.desde > '2000-01-01', r.j.desde);
    r = await call('GET', '/api/jornada/horas?dias=99', undefined, A);
    t('como mucho 31 días', r.j.tecnicos[0].dias.length === 31);

    /* quién ve qué */
    r = await call('GET', '/api/jornada/horas', undefined, P1);
    t('un técnico ve solo las suyas', r.s === 200 && r.j.tecnicos.length === 1 && r.j.tecnicos[0].nombre === 'Pedro' && r.j.puedeAjustar === false, r.j && r.j.tecnicos);
    r = await call('GET', '/api/jornada/horas', undefined, O);
    t('la oficina sin permiso de ver técnicos no puede', r.s === 403, r);
    r = await call('GET', '/api/jornada/horas');
    t('sin sesión, no', r.s === 401, r);

    /* horas de hoy, con posiciones de verdad: ingresa, sale y vuelve */
    const now = Date.now(), post = (tk, lat, lng, ts) => call('POST', '/api/ubicacion', { pts: [{ lat, lng, acc: 8, ts }] }, tk);
    const BASEP = [-28.4601, -62.8302], LEJOS = [-28.6, -62.9];
    const minHoy = ahoraAR.getUTCHours() * 60 + ahoraAR.getUTCMinutes();
    if (minHoy < 20) t('(salteado: recién pasó la medianoche y las posiciones caerían en otro día)', true);
    else {
      const t1 = now - 12 * M, t2 = now - 8 * M, t3 = now - 4 * M;
      await post(P1, BASEP[0], BASEP[1], t1);
      r = await call('GET', '/api/jornada/horas', undefined, P1);
      let d = r.j.tecnicos[0].dias.find(x => x.dia === hoy);
      t('llegó a la base: el día figura «en_curso» desde su ingreso', d.estado === 'en_curso' && d.ingreso === t1 && d.min >= 11 && d.min <= 13, d);
      await post(P1, LEJOS[0], LEJOS[1], t2);
      await post(P1, BASEP[0], BASEP[1], t3);
      r = await call('GET', '/api/jornada/horas', undefined, P1);
      d = r.j.tecnicos[0].dias.find(x => x.dia === hoy);
      t('salió y volvió: 8 minutos, «ok», un tramo de ingreso a regreso', d.estado === 'ok' && d.min === 8 && d.segs.length === 1 && d.segs[0][0] === t1 && d.segs[0][1] === t3, d);
      t('y la semana suma lo mismo', r.j.tecnicos[0].total === 8, r.j.tecnicos[0].total);
      r = await call('GET', '/api/jornada', undefined, P1);
      t('el técnico recibe sus horas junto con su jornada (hoy y la semana)', r.j.horas && r.j.horas.semana === 8 && r.j.horas.dias.length === 7 && r.j.horas.dias.find(x => x.dia === hoy).min === 8, r.j.horas);
      r = await call('GET', '/api/ubicaciones', undefined, A);
      const pj = r.j.tecnicos.find(x => x.nombre === 'Pedro').jornada;
      t('la lista de la oficina trae las horas del día de cada técnico', pj.horasMin === 8 && pj.horasEstado === 'ok', pj);
      t('y el que no hizo nada, sin horas', r.j.tecnicos.find(x => x.nombre === 'Juan').jornada.horasMin === null);
    }

    /* correcciones: solo el administrador */
    const base = (x) => Object.assign({ uid: idJ, dia: ayer, nota: 'Se le apagó el celular' }, x);
    const t0 = new Date(ayer + 'T00:00:00-03:00').getTime();
    const seg = (a, b) => [t0 + a * H, t0 + b * H];
    r = await call('POST', '/api/jornada/ajuste', base({ segs: [seg(8, 12)] }), P1);
    t('un técnico no corrige horas', r.s === 403, r);
    r = await call('POST', '/api/jornada/ajuste', base({ segs: [seg(8, 12)] }), O);
    t('la oficina tampoco', r.s === 403, r);
    for (const [n, b] of [
      ['un técnico que no existe', base({ uid: 'nadie', segs: [seg(8, 12)] })],
      ['un día futuro', base({ dia: '2999-01-01', segs: [seg(8, 12)] })],
      ['un día de hace más de 90 días', base({ dia: '2020-01-01', segs: [seg(8, 12)] })],
      ['un día mal escrito', base({ dia: 'ayer', segs: [seg(8, 12)] })],
      ['un tramo al revés', base({ segs: [seg(12, 8)] })],
      ['tres tramos', base({ segs: [seg(8, 9), seg(10, 11), seg(12, 13)] })],
      ['tramos superpuestos', base({ segs: [seg(8, 12), seg(11, 15)] })],
      ['horas como texto', base({ segs: [['8', '12']] })],
      ['un tramo fuera del día', base({ segs: [[t0 - 5 * H, t0 + 2 * H]] })]
    ]) { const x = await call('POST', '/api/jornada/ajuste', b, A); t(n + ' no se acepta', x.s === 400 || x.s === 404, x); }
    r = await call('POST', '/api/jornada/ajuste', base({ segs: [seg(17, 21), seg(8, 12.5)] }), A);
    t('el administrador carga las horas de un día sin registro (se ordenan solas): 4 h 30 min + 4 h', r.s === 200 && r.j.min === 510 && r.j.estado === 'corregido' && r.j.ajuste.nota === 'Se le apagó el celular' && r.j.ajuste.por === 'Mauro' && r.j.origen === 'oficina' && r.j.segs[0][0] === seg(8, 12.5)[0], r.j);
    r = await call('GET', '/api/jornada/horas?desde=' + ayer + '&dias=2', undefined, A);
    let jd = r.j.tecnicos.find(x => x.nombre === 'Juan');
    t('el resumen lo muestra: Juan, ayer 8 h 30 min, un corregido', jd.dias[0].min === 510 && jd.dias[0].estado === 'corregido' && jd.corregidos === 1 && jd.total >= 510, jd);
    r = await call('GET', '/api/jornada/horas?desde=' + ayer + '&dias=2', undefined, J1);
    t('Juan ve su día corregido y quién lo corrigió', r.j.tecnicos[0].dias[0].estado === 'corregido' && r.j.tecnicos[0].dias[0].ajuste.por === 'Mauro', r.j.tecnicos[0].dias[0]);
    r = await call('POST', '/api/jornada/ajuste', base({ segs: [seg(9, 13)], nota: '' }), A);
    t('se puede volver a corregir', r.s === 200 && r.j.min === 240, r.j);
    r = await call('POST', '/api/jornada/ajuste', base({ quitar: true }), A);
    t('«volver al cálculo automático» en un día que cargó la oficina lo borra (no había nada automático)', r.s === 200 && r.j.estado === 'sin_registro' && r.j.min === 0, r.j);
    r = await call('POST', '/api/jornada/ajuste', base({ quitar: true }), A);
    t('quitar dos veces no falla', r.s === 200, r);

    /* una corrección encima de un día automático: se puede volver atrás y no se pierde lo automático */
    if (minHoy >= 20) {
      r = await call('POST', '/api/jornada/ajuste', { uid: idP, dia: hoy, segs: [[now - 20 * M, now - 5 * M]], nota: 'Salió antes' }, A);
      t('Pedro, hoy: la corrección manda (15 min) por encima de lo automático', r.s === 200 && r.j.min === 15 && r.j.estado === 'corregido', r.j);
      r = await call('POST', '/api/jornada/ajuste', { uid: idP, dia: hoy, quitar: true }, A);
      t('al quitarla vuelve lo automático (8 min) y no se pierde nada', r.j.min === 8 && r.j.estado === 'ok', r.j);
    }

    /* el respaldo no se lleva las horas ni las coordenadas */
    r = await call('GET', '/api/backup', undefined, A);
    t('el respaldo sigue andando', r.s === 200, r.s);
  } finally { await srv.stop(); }
  console.log(`\n${okN} ok, ${failN} con fallas`);
  process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
