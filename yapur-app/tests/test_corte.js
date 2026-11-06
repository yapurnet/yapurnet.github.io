'use strict';
/* Corte manual del GPS de un técnico: la oficina (solo el administrador) lo corta a la hora en que ve que se fue.
   Desde esa hora el servidor no guarda más su ubicación, borra lo ya guardado desde entonces, cierra su jornada en esa hora y le recorta el horario
   al celular; «Reanudar» lo vuelve a habilitar. Los demás técnicos no se enteran. */
const { start } = require('./harness');
let BASE = '', okN = 0, failN = 0;
const t = (name, cond, extra) => { if (cond) { okN++; console.log('ok   ' + name); } else { failN++; console.log('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function call(method, p, body, token) {
  const r = await fetch(BASE + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) { /* sin cuerpo */ }
  return { s: r.status, j };
}
/* conexión en vivo como la usa la app */
async function openStream(token) {
  const tk = (await call('POST', '/api/ticket', {}, token)).j.t;
  const events = [];
  const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/api/stream?t=' + tk);
  ws.addEventListener('message', m => { if (m.data === 'pong') return; try { const j = JSON.parse(m.data); events.push({ ev: j.e, data: j.d }); } catch (e) { /* no es JSON */ } });
  await new Promise(res => { ws.addEventListener('open', () => res()); ws.addEventListener('error', () => res()); ws.addEventListener('close', () => res()); });
  return { events, close: () => { try { ws.close(); } catch (e) { /* ya estaba cerrado */ } } };
}
const arFecha = ts => new Date(ts - 3 * 3600e3).toISOString().slice(0, 10);
const BASEPOS = { lat: -28.4601, lng: -62.8302 };
const LEJOS = { lat: -28.6, lng: -62.9 };
const M = 60e3;

(async () => {
  const code = 'TEST-CODE-1234-ABCD';
  const srv = await start({ code });
  BASE = srv.base;
  try {
    if (((Date.now() - 3 * 3600e3) % 864e5) / 60e3 < 25) { t('(salteado: recién pasó la medianoche y las posiciones caerían en otro día)', true); return; }
    let r = await call('POST', '/api/setup', { codigo: code, usuario: 'mauro', clave: 'claveSegura1', nombre: 'Mauro' });
    const A = r.j.token;
    await call('POST', '/api/users', { usuario: 'ofi', nombre: 'Laura', role: 'oficina', clave: 'laura1' }, A);
    for (const [u, n] of [['pedro', 'Pedro'], ['juan', 'Juan'], ['luis', 'Luis']]) await call('POST', '/api/users', { usuario: u, nombre: n, role: 'tecnico', clave: u + '11' }, A);
    const O = (await call('POST', '/api/login', { usuario: 'ofi', clave: 'laura1' })).j.token;
    const P = (await call('POST', '/api/login', { usuario: 'pedro', clave: 'pedro11' })).j.token;
    const J = (await call('POST', '/api/login', { usuario: 'juan', clave: 'juan11' })).j.token;
    const L = (await call('POST', '/api/login', { usuario: 'luis', clave: 'luis11' })).j.token;
    const uid = nombre => r2.j.tecnicos.find(x => x.nombre === nombre).id;
    await call('POST', '/api/ubicacion/horario', { desde: 0, hasta: 24 }, A);   // todo el día, para probar a cualquier hora
    for (const tk of [P, J, L]) { await call('POST', '/api/ubicacion/acepto', {}, tk); await call('POST', '/api/jornada/acepto', {}, tk); }
    await call('POST', '/api/jornada/base', { lat: BASEPOS.lat, lng: BASEPOS.lng, radio: 40, tol: 10, dias: [0, 1, 2, 3, 4, 5, 6] }, A);
    let r2 = await call('GET', '/api/ubicaciones', undefined, A);
    const idP = uid('Pedro'), idJ = uid('Juan'), idL = uid('Luis');
    const hoy = arFecha(Date.now()), t0 = Date.parse(hoy + 'T00:00:00-03:00');

    /* sin corte */
    r = await call('GET', '/api/ubicacion/estado', undefined, P);
    t('sin corte: el celular ve el horario completo, «dentro» y corte nulo', r.j.corte === null && r.j.dentro === true && JSON.stringify(r.j.tramos) === '[[0,24]]', r.j);
    t('sin corte: la oficina no ve ningún corte', r2.j.tecnicos.every(x => x.corte === null && x.estado !== 'cortado'), r2.j.tecnicos.map(x => [x.nombre, x.estado, x.corte]));

    /* quién puede cortar y qué se rechaza */
    r = await call('POST', '/api/ubicacion/cortar', { uid: idP }, P);
    t('un técnico no puede cortar el GPS (ni el suyo)', r.s === 403, r);
    r = await call('POST', '/api/ubicacion/cortar', { uid: idJ }, O);
    t('la oficina tampoco: solo el administrador', r.s === 403, r);
    r = await call('POST', '/api/ubicacion/reanudar', { uid: idP }, O);
    t('ni reanudar', r.s === 403, r);
    r = await call('POST', '/api/ubicacion/cortar', { uid: 'nadie' }, A);
    t('un técnico que no existe: 404', r.s === 404, r);
    const idAdmin = (await call('GET', '/api/users', undefined, A)).j.users.find(x => x.usuario === 'mauro').id;
    r = await call('POST', '/api/ubicacion/cortar', { uid: idAdmin }, A);
    t('el administrador no es un técnico: no se corta', r.s === 404, r);
    r = await call('POST', '/api/ubicacion/cortar', { uid: idP, ts: Date.now() + 10 * M }, A);
    t('una hora que todavía no llegó se rechaza', r.s === 400, r);
    r = await call('POST', '/api/ubicacion/cortar', { uid: idP, ts: t0 }, A);
    t('una hora anterior al comienzo del horario se rechaza', r.s === 400, r);
    r = await call('POST', '/api/ubicacion/cortar', { uid: idP, ts: 'abc' }, A);
    t('una hora que no es un número se rechaza', r.s === 400, r);
    r = await call('GET', '/api/ubicacion/estado', undefined, P);
    t('los rechazos no cortaron nada', r.j.corte === null, r.j);

    /* el recorrido de Pedro: llega a la base, sale, y a los 10 minutos vuelve a pasar por la base */
    const ahora = Date.now();
    const post = (tk, pos, ts) => call('POST', '/api/ubicacion', { pts: [{ lat: pos.lat, lng: pos.lng, acc: 10, ts }] }, tk);
    const tsIng = ahora - 14 * M;
    await post(P, BASEPOS, tsIng);
    await post(P, LEJOS, ahora - 12 * M);
    await post(P, LEJOS, ahora - 10 * M);
    await post(P, LEJOS, ahora - 8 * M);
    await post(P, LEJOS, ahora - 6 * M);
    await post(P, BASEPOS, ahora - 4 * M);   // el «regreso» que el sistema anotó por su cuenta, después de que la oficina lo vio irse
    await post(J, LEJOS, ahora - 5 * M);
    let f = (await call('GET', '/api/jornada', undefined, P)).j.fila;
    t('antes del corte: Pedro tiene ingreso y un regreso anotado a las -4 min', f.ingreso === tsIng && f.regreso === ahora - 4 * M && f.enBase === true, f);

    /* la oficina ve que se fue hace 9 minutos y corta ahí; mientras tanto Pedro mira en vivo */
    const sp = await openStream(P), sj = await openStream(J);
    await sleep(200);
    const corte = ahora - 9 * M;
    r = await call('POST', '/api/ubicacion/cortar', { uid: idP, ts: corte }, A);
    t('el administrador corta el GPS de Pedro: queda la hora, se borraron los 3 puntos de después y se cerró la jornada', r.s === 200 && r.j.corte === corte && r.j.borrados === 3 && r.j.jornada === 'cerrada' && r.j.dia === hoy, r);
    await sleep(300);
    t('a Pedro le llega el aviso en vivo con la hora del corte', sp.events.some(e => e.ev === 'ubic' && e.data.corte === corte), sp.events);
    t('a Juan no le llega nada', !sj.events.some(e => e.ev === 'ubic'), sj.events);

    r2 = await call('GET', '/api/ubicaciones', undefined, A);
    const ped = r2.j.tecnicos.find(x => x.nombre === 'Pedro'), jua = r2.j.tecnicos.find(x => x.nombre === 'Juan');
    t('la oficina ve a Pedro «cortado», con la hora y solo los 3 puntos anteriores', ped.estado === 'cortado' && ped.corte === corte && ped.puntos === 3 && ped.ultima.ts === ahora - 10 * M, [ped.estado, ped.corte, ped.puntos, ped.ultima]);
    t('Pedro no figura como problema de señal', !(ped.estado === 'sin_senal' || ped.estado === 'sin_datos'), ped.estado);
    t('la jornada de Pedro termina en el corte: «termino», regreso = corte, en la base, mismo ingreso', ped.jornada.estado === 'termino' && ped.jornada.regreso === corte && ped.jornada.enBase === true && ped.jornada.ingreso === tsIng && ped.jornada.corte === corte && ped.jornada.sinRetomar === false, ped.jornada);
    t('las horas de Pedro van del ingreso al corte (5 min), cerradas', ped.jornada.horasMin === 5 && ped.jornada.horasEstado === 'ok', [ped.jornada.horasMin, ped.jornada.horasEstado]);
    t('lo que pasó desde el corte no cuenta como «sin señal» (ni «sigue sin señal»)', !ped.huecos.some(g => g.sigue || g.hasta > corte), ped.huecos);
    t('Juan sigue como siempre', jua.corte === null && jua.estado !== 'cortado' && jua.puntos === 1, [jua.estado, jua.corte, jua.puntos]);
    r = await call('GET', '/api/jornada', undefined, P);
    t('Pedro ve su jornada terminada en el corte, y el servidor le avisa que fue la oficina', r.j.corte === corte && r.j.fila.regreso === corte && r.j.fila.enBase === true, r.j);

    /* lo que ve el celular */
    r = await call('GET', '/api/ubicacion/estado', undefined, P);
    const hastaEsp = Math.min(24, Math.ceil((corte - t0) / 3600e3));
    t('el celular de Pedro recibe el horario recortado (hora entera, para arriba), «dentro» en falso y la hora del corte', r.j.corte === corte && r.j.dentro === false && JSON.stringify(r.j.tramos) === JSON.stringify([[0, hastaEsp]]) && r.j.hasta === hastaEsp && r.j.aplica === true && r.j.acepto === true, r.j);
    r = await call('GET', '/api/ubicacion/estado', undefined, J);
    t('el de Juan no cambia', r.j.corte === null && r.j.dentro === true && JSON.stringify(r.j.tramos) === '[[0,24]]', r.j);

    /* lo que mande después se descarta; lo que llegue tarde pero sea anterior al corte, se guarda sin tocar la jornada */
    r = await post(P, LEJOS, Date.now());
    t('una posición posterior al corte se descarta y el servidor avisa que está cortado', r.s === 200 && r.j.guardados === 0 && r.j.cortado === true && r.j.corte === corte && JSON.stringify(r.j.tramos) === JSON.stringify([[0, hastaEsp]]), r);
    r = await post(P, BASEPOS, corte + 30e3);
    t('una posición apenas posterior al corte también', r.j.guardados === 0 && r.j.cortado === true, r);
    r = await post(P, LEJOS, corte - 30e3);
    t('una posición anterior al corte que llega tarde sí se guarda', r.j.guardados === 1 && r.j.cortado === false, r);
    f = (await call('GET', '/api/jornada', undefined, P)).j.fila;
    t('y no mueve el fin de la jornada', f.regreso === corte && f.enBase === true, f);
    r = await post(J, LEJOS, Date.now());
    t('Juan sigue mandando normal', r.j.guardados === 1 && r.j.cortado === false, r);

    /* cortar de nuevo mueve la hora; sin «ts» corta ahora */
    const corte2 = ahora - 11 * M;
    r = await call('POST', '/api/ubicacion/cortar', { uid: idP, ts: corte2 }, A);
    t('cortar de nuevo más temprano mueve el corte, borra los puntos de después y deja la jornada en esa hora', r.s === 200 && r.j.corte === corte2 && r.j.borrados >= 1 && r.j.jornada === 'cerrada', r);
    f = (await call('GET', '/api/jornada', undefined, P)).j.fila;
    t('la jornada de Pedro termina en el corte nuevo', f.regreso === corte2 && f.enBase === true && f.ingreso === tsIng, f);
    const antes = Date.now();
    r = await call('POST', '/api/ubicacion/cortar', { uid: idL }, A);
    t('sin «ts» corta ahora; Luis no tenía jornada: no queda nada para cerrar', r.s === 200 && r.j.corte >= antes - 1000 && r.j.corte <= Date.now() + 1000 && r.j.jornada === 'sin_jornada' && r.j.borrados === 0, r);

    /* si la oficina ya cargó las horas a mano, eso manda */
    const segs = [[t0 + 8 * 3600e3, t0 + 12 * 3600e3]];
    r = await call('POST', '/api/jornada/ajuste', { uid: idJ, dia: hoy, segs, nota: 'cargado a mano' }, A);
    t('(preparación) la oficina carga las horas de Juan a mano', r.s === 200 && r.j.min === 240 && r.j.estado === 'corregido', r);
    r = await call('POST', '/api/ubicacion/cortar', { uid: idJ, ts: Date.now() - 2 * M }, A);
    t('cortar a Juan no pisa las horas cargadas a mano', r.s === 200 && r.j.jornada === 'corregida_a_mano', r);
    r2 = await call('GET', '/api/ubicaciones', undefined, A);
    t('Juan queda con 240 min «corregido»', r2.j.tecnicos.find(x => x.nombre === 'Juan').jornada.horasMin === 240 && r2.j.tecnicos.find(x => x.nombre === 'Juan').jornada.horasEstado === 'corregido', r2.j.tecnicos.find(x => x.nombre === 'Juan').jornada);

    /* otro día: el corte es solo de hoy */
    r = await call('GET', '/api/ubicaciones?dia=2001-01-08', undefined, A);
    t('un día pasado no tiene corte', r.j.tecnicos.every(x => x.corte === null), r.j.tecnicos.map(x => x.corte));

    /* reanudar */
    await sleep(100);
    r = await call('POST', '/api/ubicacion/reanudar', { uid: idP }, A);
    t('el administrador reanuda a Pedro', r.s === 200 && r.j.corte === null, r);
    await sleep(300);
    t('a Pedro le llega el aviso en vivo de que se reanudó', sp.events.some(e => e.ev === 'ubic' && e.data.corte === null), sp.events);
    r = await call('GET', '/api/ubicacion/estado', undefined, P);
    t('el celular vuelve a ver el horario completo y «dentro»', r.j.corte === null && r.j.dentro === true && JSON.stringify(r.j.tramos) === '[[0,24]]', r.j);
    r = await post(P, LEJOS, Date.now());
    t('vuelve a guardar lo que manda', r.j.guardados === 1 && r.j.cortado === false, r);
    f = (await call('GET', '/api/jornada', undefined, P)).j.fila;
    t('al reanudar y moverse, la jornada sigue como si hubiera salido de la base (ya no figura terminada)', f.enBase === false && f.regreso === corte2, f);
    r2 = await call('GET', '/api/ubicaciones', undefined, A);
    const ped2 = r2.j.tecnicos.find(x => x.nombre === 'Pedro');
    t('la oficina ve a Pedro «trabajando» y en línea', ped2.estado === 'en_linea' && ped2.corte === null && ped2.jornada.estado === 'trabajando', [ped2.estado, ped2.corte, ped2.jornada.estado]);
    r = await call('POST', '/api/ubicacion/reanudar', { uid: idP }, A);
    t('reanudar a quien no está cortado no falla', r.s === 200 && r.j.corte === null, r);
    r = await call('POST', '/api/ubicacion/reanudar', { uid: 'nadie' }, A);
    t('reanudar a un técnico que no existe: 404', r.s === 404, r);

    sp.close(); sj.close();
  } catch (e) { failN++; console.log('FAIL excepción -> ' + (e && e.stack || e)); }
  finally { await srv.stop(); }
  console.log('\n' + okN + ' ok, ' + failN + ' fallas');
  process.exit(failN ? 1 : 0);
})();
