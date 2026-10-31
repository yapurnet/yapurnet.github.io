'use strict';
/* Jornada laboral de los técnicos: base, ingreso al llegar a la base (o a mano), regreso a la base como fin del día (todo automático), y quién ve qué. */
const { start } = require('./harness');
let BASE = '', okN = 0, failN = 0;
const t = (name, cond, extra) => { if (cond) { okN++; console.log('ok   ' + name); } else { failN++; console.log('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); } };
async function call(method, p, body, token) {
  const r = await fetch(BASE + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) { /* sin cuerpo */ }
  return { s: r.status, j };
}
const arFecha = ts => new Date(ts - 3 * 3600e3).toISOString().slice(0, 10);
const arHora = ts => new Date(ts - 3 * 3600e3).getUTCHours();

const BASEPOS = { lat: -28.4601, lng: -62.8302 };
const LEJOS = { lat: -28.6, lng: -62.9 };

(async () => {
  const code = 'TEST-CODE-1234-ABCD';
  const srv = await start({ code });
  BASE = srv.base;
  try {
    if (((Date.now() - 3 * 3600e3) % 864e5) / 60e3 < 20) { t('(salteado: recién pasó la medianoche y las posiciones caerían en otro día)', true); return; }
    let r = await call('POST', '/api/setup', { codigo: code, usuario: 'mauro', clave: 'claveSegura1', nombre: 'Mauro' });
    const A = r.j.token;
    await call('POST', '/api/users', { usuario: 'ofi', nombre: 'Laura', role: 'oficina', clave: 'laura1' }, A);
    await call('POST', '/api/users', { usuario: 'pedro', nombre: 'Pedro', role: 'tecnico', clave: 'pedro1' }, A);
    await call('POST', '/api/users', { usuario: 'juan', nombre: 'Juan', role: 'tecnico', clave: 'juan11' }, A);
    await call('POST', '/api/users', { usuario: 'luis', nombre: 'Luis', role: 'tecnico', clave: 'luis11' }, A);
    const O = (await call('POST', '/api/login', { usuario: 'ofi', clave: 'laura1' })).j.token;
    const P = (await call('POST', '/api/login', { usuario: 'pedro', clave: 'pedro1' })).j.token;
    const J = (await call('POST', '/api/login', { usuario: 'juan', clave: 'juan11' })).j.token;
    const L = (await call('POST', '/api/login', { usuario: 'luis', clave: 'luis11' })).j.token;

    /* el horario: desde dos horas antes de ahora, para poder calcular el atraso */
    const h0 = arHora(Date.now()), desde = Math.max(0, h0 - 2);
    await call('POST', '/api/ubicacion/horario', { desde, hasta: 24 }, A);
    for (const tk of [P, J, L]) await call('POST', '/api/ubicacion/acepto', {}, tk);

    /* sin configurar nada */
    r = await call('GET', '/api/ubicaciones', undefined, A);
    t('sin configurar: no hay base, 150 m, 10 min de tolerancia y de lunes a sábado', r.s === 200 && r.j.jornada.base === null && r.j.jornada.radio === 150 && r.j.jornada.tol === 10 && JSON.stringify(r.j.jornada.dias) === '[1,2,3,4,5,6]', r.j.jornada);

    t('sin base cargada la jornada está apagada: nadie figura «sin_ingreso»', r.j.tecnicos.every(x => x.jornada.estado === 'sin_base'), r.j.tecnicos.map(x => x.jornada.estado));
    r = await call('GET', '/api/jornada', undefined, P);
    t('y el técnico lo sabe (hayBase = false)', r.j.hayBase === false && r.j.fila === null, r.j);

    /* quién puede cargar la base */
    const cfg = { lat: BASEPOS.lat, lng: BASEPOS.lng, radio: 150, tol: 10, dias: [0, 1, 2, 3, 4, 5, 6] };
    r = await call('POST', '/api/jornada/base', cfg, P);
    t('el técnico no puede cargar la base', r.s === 403, r);
    r = await call('POST', '/api/jornada/base', cfg, O);
    t('la oficina tampoco: solo el administrador', r.s === 403, r);
    r = await call('POST', '/api/jornada/base', Object.assign({}, cfg, { radio: 5 }), A);
    t('un radio de 5 m no se acepta (30 a 2000)', r.s === 400, r);
    r = await call('POST', '/api/jornada/base', Object.assign({}, cfg, { lat: 'x' }), A);
    t('una ubicación inválida no se acepta', r.s === 400, r);
    r = await call('POST', '/api/jornada/base', Object.assign({}, cfg, { dias: [7] }), A);
    t('un día inválido no se acepta', r.s === 400, r);
    r = await call('POST', '/api/jornada/base', Object.assign({}, cfg, { tol: 500 }), A);
    t('una tolerancia de 500 min no se acepta', r.s === 400, r);
    r = await call('POST', '/api/jornada/base', cfg, A);
    t('el administrador carga la base', r.s === 200 && r.j.base.lat === BASEPOS.lat && r.j.radio === 150 && r.j.dias.length === 7, r);

    /* el técnico ve solo lo suyo */
    r = await call('GET', '/api/jornada', undefined, P);
    t('el técnico ve su estado: todavía sin ingreso, con base cargada y sin haber visto el aviso', r.s === 200 && r.j.aplica === true && r.j.enterado === false && r.j.hayBase === true && r.j.fila === null && !('base' in r.j), r.j);
    r = await call('GET', '/api/jornada', undefined, A);
    t('el administrador no tiene jornada propia', r.s === 200 && r.j.aplica === false, r.j);
    r = await call('POST', '/api/jornada/ingreso', {}, A);
    t('el administrador no puede iniciar la jornada de nadie', r.s === 403, r);
    r = await call('POST', '/api/jornada/acepto', {}, A);
    t('ni dar por enterado a un técnico', r.s === 403, r);

    /* en la base: el ingreso se anota solo, haya visto o no el aviso (el «Entendido» solo deja constancia) */
    const now = Date.now(), tsBase = now - 120e3;
    r = await call('POST', '/api/ubicacion', { pts: [{ lat: BASEPOS.lat + 0.0003, lng: BASEPOS.lng, acc: 12, ts: tsBase }] }, P);
    t('el servidor guarda la posición', r.s === 200 && r.j.guardados === 1, r);
    r = await call('GET', '/api/jornada', undefined, P);
    t('la primera posición dentro de la base inicia la jornada con esa hora, origen «base» y la distancia, sin necesidad de haber visto el aviso', r.j.fila && r.j.fila.ingreso === tsBase && r.j.fila.origen === 'base' && r.j.fila.dist > 20 && r.j.fila.dist <= 150 && r.j.fila.regreso === null && r.j.enterado === false, r.j);
    r = await call('POST', '/api/jornada/acepto', {}, P);
    t('el técnico toca «Entendido» y queda constancia', r.s === 200 && r.j.enterado === true && r.j.fila.ingreso === tsBase, r);
    await call('POST', '/api/ubicacion', { pts: [{ lat: BASEPOS.lat, lng: BASEPOS.lng, acc: 8, ts: now - 60e3 }] }, P);
    r = await call('POST', '/api/jornada/ingreso', BASEPOS, P);
    t('otra posición o tocar «Iniciar» no cambia la hora de ingreso', r.j.fila.ingreso === tsBase && r.j.fila.regreso === null, r.j.fila);
    r = await call('GET', '/api/jornada', undefined, J);
    t('el ingreso de Pedro no aparece en Juan', r.j.fila === null, r.j);
    await call('POST', '/api/ubicacion', { pts: [{ lat: LEJOS.lat, lng: LEJOS.lng, acc: 10, ts: now - 90e3 }] }, J);
    r = await call('GET', '/api/jornada', undefined, J);
    t('una posición lejos de la base no inicia la jornada', r.j.fila === null, r.j);

    /* una posición con mala precisión no sirve para el ingreso automático */
    await call('POST', '/api/jornada/acepto', {}, L);
    await call('POST', '/api/ubicacion', { pts: [{ lat: BASEPOS.lat, lng: BASEPOS.lng, acc: 900, ts: now - 100e3 }] }, L);
    r = await call('GET', '/api/jornada', undefined, L);
    t('con precisión peor de 300 m no se anota el ingreso', r.j.fila === null, r.j);

    /* lo que ve la oficina */
    const ws = Date.parse(arFecha(Date.now()) + 'T00:00:00-03:00') + desde * 3600e3;
    r = await call('GET', '/api/ubicaciones', undefined, A);
    const ped = r.j.tecnicos.find(x => x.nombre === 'Pedro'), jua = r.j.tecnicos.find(x => x.nombre === 'Juan');
    const atrasoEsp = Math.max(0, Math.round((tsBase - ws) / 60000));
    t('Pedro: trabajando, ingreso exacto, origen «base» y el atraso respecto del inicio del horario', ped.jornada.estado === 'trabajando' && ped.jornada.ingreso === tsBase && ped.jornada.origen === 'base' && ped.jornada.atrasoMin === atrasoEsp && ped.jornada.tarde === (atrasoEsp > 10) && ped.jornada.enterado === true, ped.jornada);
    t('Juan: todavía sin ingreso (o «esperando» si el horario recién empezó)', jua.jornada.estado === (Date.now() > ws + 10 * 60e3 ? 'sin_ingreso' : 'esperando') && jua.jornada.ingreso === null, jua.jornada);
    r = await call('GET', '/api/ubicaciones', undefined, O);
    t('la oficina sin permiso no ve nada de esto', r.s === 403, r);

    /* ingreso manual */
    r = await call('POST', '/api/jornada/ingreso', { lat: LEJOS.lat, lng: LEJOS.lng, acc: 20 }, J);
    t('Juan inicia a mano desde lejos: origen «manual» y la distancia a la base', r.s === 200 && r.j.fila.origen === 'manual' && r.j.fila.dist > 1000 && r.j.fila.enBase === false && Math.abs(r.j.fila.ingreso - Date.now()) < 5000, r.j);
    r = await call('POST', '/api/jornada/ingreso', { lat: 'x', lng: 'y' }, L);
    t('sin posición válida igual se anota la hora (origen «manual», sin distancia)', r.s === 200 && r.j.fila.origen === 'manual' && r.j.fila.dist === null, r.j);
    r = await call('POST', '/api/jornada/fin', {}, P);
    t('ya no hay «terminar jornada» a mano: el fin sale solo', r.s === 404, r);

    /* el recorrido del día: sale, vuelve, sale otra vez, vuelve. Se prueba en orden con puntos de los últimos 15 minutos. */
    await call('POST', '/api/users', { usuario: 'nico', nombre: 'Nico', role: 'tecnico', clave: 'nico11' }, A);
    const N = (await call('POST', '/api/login', { usuario: 'nico', clave: 'nico11' })).j.token;
    await call('POST', '/api/ubicacion/acepto', {}, N);
    await call('POST', '/api/jornada/acepto', {}, N);
    const m = 60e3, ahora = Date.now(), tsN0 = ahora - 14 * m;
    const ENTRE = { lat: BASEPOS.lat + 0.0017, lng: BASEPOS.lng };   // unos 190 m: fuera del radio (150) pero dentro de 1,5 veces
    const post = (tk, lat, lng, ts, acc) => call('POST', '/api/ubicacion', { pts: [{ lat, lng, acc: acc || 10, ts }] }, tk);
    const fila = async tk => (await call('GET', '/api/jornada', undefined, tk)).j.fila;
    await post(N, BASEPOS.lat, BASEPOS.lng, tsN0);   // llega a la base: ingreso
    let f = await fila(N);
    t('Nico llega a la base: ingreso con la hora de esa posición, sin regreso y «en la base»', f.ingreso === tsN0 && f.origen === 'base' && f.regreso === null && f.enBase === true, f);
    await post(N, BASEPOS.lat, BASEPOS.lng, tsN0 + 30e3);
    f = await fila(N);
    t('seguir en la base no cambia nada', f.ingreso === tsN0 && f.regreso === null, f);
    await post(N, ENTRE.lat, ENTRE.lng, ahora - 13 * m);
    f = await fila(N);
    t('un punto a 190 m (entre el radio y 1,5 veces) todavía no cuenta como salida', f.enBase === true, f);
    await post(N, LEJOS.lat, LEJOS.lng, ahora - 12 * m);
    f = await fila(N);
    t('un punto lejos: salió de la base', f.enBase === false && f.regreso === null, f);
    await post(N, ENTRE.lat, ENTRE.lng, ahora - 11 * m);
    f = await fila(N);
    t('a 190 m todavía no cuenta como haber vuelto', f.enBase === false && f.regreso === null, f);
    const tsVuelta1 = ahora - 10 * m;
    await post(N, BASEPOS.lat, BASEPOS.lng, tsVuelta1);
    f = await fila(N);
    t('al volver a entrar al radio queda el primer regreso con esa hora', f.enBase === true && f.regreso === tsVuelta1, f);
    await post(N, BASEPOS.lat, BASEPOS.lng, ahora - 9 * m);
    f = await fila(N);
    t('seguir en la base no mueve la hora del regreso', f.regreso === tsVuelta1, f);
    r = await call('GET', '/api/ubicaciones', undefined, A);
    let pj = r.j.tecnicos.find(x => x.nombre === 'Nico').jornada;
    t('la oficina ve «termino» con ingreso y regreso', pj.estado === 'termino' && pj.ingreso === tsN0 && pj.regreso === tsVuelta1 && pj.enBase === true, pj);
    await post(N, LEJOS.lat, LEJOS.lng, ahora - 8 * m);
    r = await call('GET', '/api/ubicaciones', undefined, A);
    pj = r.j.tecnicos.find(x => x.nombre === 'Nico').jornada;
    t('si vuelve a salir, deja de estar terminada («trabajando») y se recuerda el último regreso', pj.estado === 'trabajando' && pj.regreso === tsVuelta1 && pj.enBase === false, pj);
    await post(N, LEJOS.lat, LEJOS.lng, ahora - 6 * m, 900);
    await post(N, BASEPOS.lat, BASEPOS.lng, ahora - 5 * m, 900);
    f = await fila(N);
    t('una posición con precisión peor de 300 m no cuenta para entrar ni para salir', f.enBase === false && f.regreso === tsVuelta1, f);
    const tsVuelta2 = ahora - 2 * m;
    await post(N, BASEPOS.lat + 0.0002, BASEPOS.lng, tsVuelta2);
    f = await fila(N);
    t('el segundo regreso reemplaza al primero: el fin del día es el último', f.enBase === true && f.regreso === tsVuelta2 && f.ingreso === tsN0, f);
    await post(N, LEJOS.lat, LEJOS.lng, ahora - 3 * m);   // llega atrasado, antes que el último
    f = await fila(N);
    t('una posición atrasada que llega después de otras más nuevas no cambia nada', f.enBase === true && f.regreso === tsVuelta2, f);
    r = await call('GET', '/api/ubicaciones', undefined, A);
    pj = r.j.tecnicos.find(x => x.nombre === 'Nico').jornada;
    t('la oficina ve «termino» con el último regreso', pj.estado === 'termino' && pj.regreso === tsVuelta2, pj);
    r = await call('POST', '/api/ubicacion', { pts: [{ lat: LEJOS.lat, lng: LEJOS.lng, acc: 8, ts: Date.now() }] }, N);
    t('la ubicación sigue llegando después del regreso (el envío lo corta solo el horario)', r.s === 200, r);

    /* días que no se trabaja, días pasados y futuros */
    await call('POST', '/api/jornada/base', Object.assign({}, cfg, { dias: [1, 2, 3, 4, 5] }), A);
    r = await call('GET', '/api/ubicaciones?dia=2001-01-06', undefined, A);
    t('un sábado, con el trabajo de lunes a viernes: «no_laborable»', r.j.tecnicos.every(x => x.jornada.estado === 'no_laborable'), r.j.tecnicos.map(x => x.jornada.estado));
    r = await call('GET', '/api/ubicaciones?dia=2001-01-08', undefined, A);
    t('un lunes pasado sin registro: «sin_ingreso»', r.j.tecnicos.every(x => x.jornada.estado === 'sin_ingreso'), r.j.tecnicos.map(x => x.jornada.estado));
    r = await call('GET', '/api/ubicaciones?dia=2999-01-04', undefined, A);
    t('un día futuro no es falta: «esperando»', r.j.tecnicos.every(x => x.jornada.estado === 'esperando'), r.j.tecnicos.map(x => x.jornada.estado));

    /* sacar la base: ya no hay ingreso automático, pero sí manual */
    r = await call('POST', '/api/jornada/base', { radio: 150, tol: 10, dias: [1, 2, 3, 4, 5, 6] }, A);
    t('se puede quitar la base (queda sin ubicación)', r.s === 200 && r.j.base === null, r);
    r = await call('GET', '/api/jornada', undefined, J);
    t('sin base, el técnico lo sabe (hayBase = false)', r.j.hayBase === false, r.j);
    r = await call('GET', '/api/ubicaciones', undefined, A);
    t('sin base, lo ya anotado se conserva', r.j.tecnicos.find(x => x.nombre === 'Pedro').jornada.ingreso === tsBase && r.j.tecnicos.find(x => x.nombre === 'Pedro').jornada.estado !== 'sin_base', r.j.tecnicos.map(x => [x.nombre, x.jornada.estado]));

    /* el cálculo de distancia, probado solo */
    {
      const fs = require('fs'), path = require('path');
      const src = fs.readFileSync(path.join(__dirname, '..', 'worker', 'src', 'worker.js'), 'utf8');
      const a = src.indexOf('const distM'), b = src.indexOf('const UBIC_HUECO_MS');
      const distM = new Function(src.slice(a, b) + '; return distM;')();
      t('un grado de longitud en el ecuador son unos 111 km', Math.abs(distM(0, 0, 0, 1) - 111195) < 200, distM(0, 0, 0, 1));
      t('la distancia de un punto a sí mismo es 0 y es simétrica', distM(-28.46, -62.83, -28.46, -62.83) === 0 && distM(-28.46, -62.83, -28.5, -62.9) === distM(-28.5, -62.9, -28.46, -62.83));
      t('0,001 grados de latitud son unos 111 m', Math.abs(distM(-28.46, -62.83, -28.459, -62.83) - 111) <= 2, distM(-28.46, -62.83, -28.459, -62.83));
    }

    /* las horas de jornada no entran en las copias de seguridad ni llevan coordenadas */
    r = await call('GET', '/api/backup', undefined, A);
    t('el respaldo no se lleva la jornada ni las coordenadas de la base', r.s === 200 && !JSON.stringify(r.j).includes('-28.4601'), r.s);
    t('sin errores en el registro del servidor', !/Uncaught|\bERROR\b|✘/.test(srv.log()), srv.log().split('\n').filter(l => /Uncaught|ERROR|✘/.test(l)).slice(0, 5));
  } catch (e) {
    failN++; console.log('FAIL excepción', e);
  } finally {
    await srv.stop();
    console.log(`\n${okN} ok, ${failN} con fallas`);
    if (failN) console.log('--- log del servidor ---\n' + srv.log().slice(-3000));
    process.exit(failN ? 1 : 0);
  }
})();
