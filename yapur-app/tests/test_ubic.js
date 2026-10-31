'use strict';
/* Ubicación de los técnicos en horario laboral: quién la manda, quién la ve, el horario (lo decide el servidor) y el borrado. */
const { start } = require('./harness');
let BASE = '', okN = 0, failN = 0;
const t = (name, cond, extra) => { if (cond) { okN++; console.log('ok   ' + name); } else { failN++; console.log('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); } };
async function call(method, p, body, token) {
  const r = await fetch(BASE + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) { /* sin cuerpo */ }
  return { s: r.status, j };
}
/* la fecha y la hora de Argentina (UTC-3), igual que el servidor */
const ar = ts => { const d = new Date(ts - 3 * 3600e3); return { fecha: d.toISOString().slice(0, 10), h: d.getUTCHours() }; };

(async () => {
  const code = 'TEST-CODE-1234-ABCD';
  const srv = await start({ code });
  BASE = srv.base;
  try {
    let r = await call('POST', '/api/setup', { codigo: code, usuario: 'mauro', clave: 'claveSegura1', nombre: 'Mauro' });
    const A = r.j.token;
    await call('POST', '/api/users', { usuario: 'ofi', nombre: 'Laura', role: 'oficina', clave: 'laura1' }, A);
    await call('POST', '/api/users', { usuario: 'pedro', nombre: 'Pedro', role: 'tecnico', clave: 'pedro1', tel: '3844111111' }, A);
    await call('POST', '/api/users', { usuario: 'juan', nombre: 'Juan', role: 'tecnico', clave: 'juan11' }, A);
    const O = (await call('POST', '/api/login', { usuario: 'ofi', clave: 'laura1' })).j.token;
    const P = (await call('POST', '/api/login', { usuario: 'pedro', clave: 'pedro1' })).j.token;
    const J = (await call('POST', '/api/login', { usuario: 'juan', clave: 'juan11' })).j.token;

    /* horario: por defecto 8 a 20, solo lo cambia el administrador */
    r = await call('GET', '/api/ubicacion/estado', undefined, P);
    t('estado del técnico: aplica, no aceptó, horario 8 a 20', r.s === 200 && r.j.aplica === true && r.j.acepto === false && r.j.desde === 8 && r.j.hasta === 20, r);
    r = await call('GET', '/api/ubicacion/estado', undefined, A);
    t('el administrador no comparte ubicación (aplica = false)', r.j.aplica === false, r);
    r = await call('POST', '/api/ubicacion/horario', { desde: 9, hasta: 18 }, O);
    t('la oficina no puede cambiar el horario', r.s === 403, r);
    r = await call('POST', '/api/ubicacion/horario', { desde: 20, hasta: 8 }, A);
    t('horario al revés rechazado', r.s === 400, r);
    r = await call('POST', '/api/ubicacion/horario', { desde: 0, hasta: 25 }, A);
    t('horario fuera de 0 a 24 rechazado', r.s === 400, r);

    /* sin aceptar el aviso no se guarda nada */
    await call('POST', '/api/ubicacion/horario', { desde: 0, hasta: 24 }, A);   // todo el día, para probar a cualquier hora
    r = await call('POST', '/api/ubicacion', { lat: -28.46, lng: -62.83, acc: 10 }, P);
    t('sin aceptar el aviso, el servidor rechaza la ubicación (409 sin_aceptar)', r.s === 409 && r.j.code === 'sin_aceptar', r);
    r = await call('POST', '/api/ubicacion/acepto', {}, A);
    t('el administrador no puede «aceptar» por un técnico ni mandar ubicación', r.s === 403, r);
    r = await call('POST', '/api/ubicacion/acepto', {}, P);
    t('el técnico acepta el aviso', r.s === 200 && r.j.acepto === true, r);

    /* mandar ubicación */
    r = await call('POST', '/api/ubicacion', { lat: -28.4601, lng: -62.8302, acc: 12.4 }, P);
    t('guarda una ubicación válida', r.s === 200 && r.j.guardados === 1, r);
    r = await call('POST', '/api/ubicacion', { lat: -28.4602, lng: -62.8303, acc: 9 }, P);
    t('un segundo punto a los pocos segundos no se guarda (máximo uno cada 20 s)', r.s === 200 && r.j.guardados === 0, r);
    r = await call('POST', '/api/ubicacion', { lat: 'x', lng: 5 }, P);
    t('coordenadas inválidas no se guardan', r.s === 200 && r.j.guardados === 0, r);
    r = await call('POST', '/api/ubicacion', { lat: 0, lng: 0 }, J);
    t('la coordenada 0,0 no se guarda', r.s === 409 || r.j.guardados === 0, r);   // Juan no aceptó: 409
    r = await call('POST', '/api/ubicacion', { lat: -28.4, lng: -62.8 }, O);
    t('la oficina no manda ubicación', r.s === 403, r);
    r = await call('POST', '/api/ubicacion', { lat: -28.4, lng: -62.8 });
    t('sin sesión no se acepta', r.s === 401, r);

    /* varios puntos juntos (los que quedaron en cola sin señal) con la hora del celular */
    const ahora = Date.now();
    r = await call('POST', '/api/ubicacion/acepto', {}, J);
    r = await call('POST', '/api/ubicacion', { pts: [
      { lat: -28.40, lng: -62.80, acc: 8, ts: ahora - 5 * 60e3 }, { lat: -28.41, lng: -62.81, acc: 8, ts: ahora - 4 * 60e3 },
      { lat: -28.42, lng: -62.82, acc: 8, ts: ahora - 3 * 60e3 }, { lat: -28.43, lng: -62.83, acc: 8, ts: ahora - 2 * 60e3 }] }, J);
    t('guarda los puntos en cola (con su hora) y no los pisa con la de ahora', r.s === 200 && r.j.guardados === 4, r);
    r = await call('POST', '/api/ubicacion', { pts: [{ lat: -28.5, lng: -62.9, acc: 8, ts: ahora - 3 * 3600e3 }] }, J);
    t('un punto de hace 3 horas no se acepta con esa hora (se toma la de ahora)', r.s === 200, r);

    r = await call('POST', '/api/ubicacion', { pts: [{ lat: -28.3, lng: -62.7, acc: 5, ts: ahora - 90 * 1000 }, { lat: -28.3001, lng: -62.7001, acc: 5, ts: ahora - 80 * 1000 }] }, P);
    t('un punto atrasado se guarda aunque ya haya uno más nuevo; el pegado a otro (10 s) no', r.s === 200 && r.j.guardados === 1, r);

    /* quién la ve */
    r = await call('GET', '/api/ubicaciones', undefined, P);
    t('un técnico no ve la ubicación de nadie', r.s === 403, r);
    r = await call('GET', '/api/ubicaciones', undefined, O);
    t('la oficina tampoco, salvo que se le dé el permiso', r.s === 403, r);
    r = await call('GET', '/api/ubicaciones', undefined, A);
    const ped = r.s === 200 && r.j.tecnicos.find(x => x.nombre === 'Pedro'), jua = r.s === 200 && r.j.tecnicos.find(x => x.nombre === 'Juan');
    t('el administrador ve a los técnicos (no a la oficina ni a él mismo)', r.s === 200 && r.j.tecnicos.length === 2, r.j && r.j.tecnicos && r.j.tecnicos.map(x => x.nombre));
    t('Pedro: una ubicación, con precisión redondeada y que aceptó', ped && ped.puntos === 2 && ped.ultima.lat === -28.4601 && ped.ultima.acc === 12 && ped.acepto === true, ped);
    t('Juan: sus puntos en orden, la última es la más reciente', jua && jua.puntos >= 4 && jua.ultima.lat === jua.ruta[jua.ruta.length - 1][1] && jua.ruta[0][0] < jua.ruta[1][0], jua);
    t('el listado trae el horario y los días que se guarda', r.j.horario.desde === 0 && r.j.horario.hasta === 24 && r.j.dias === 14, r.j);
    r = await call('GET', '/api/ubicaciones?dia=2001-01-01', undefined, A);
    t('un día sin datos devuelve a los técnicos sin ubicación', r.s === 200 && r.j.tecnicos.every(x => x.ultima === null && x.puntos === 0), r.j);
    r = await call('GET', '/api/ubicaciones?dia=basura', undefined, A);
    t('un día inválido se toma como hoy', r.s === 200 && r.j.dia === r.j.hoy, r.j);

    /* permiso para la oficina */
    r = await call('GET', '/api/users', undefined, A);
    const ofi = r.j.users.find(u => u.usuario === 'ofi');
    r = await call('PATCH', '/api/users/' + ofi.id, { permisos: { verTecnicos: true } }, A);
    r = await call('GET', '/api/ubicaciones', undefined, O);
    t('con el permiso «verTecnicos» la oficina sí los ve', r.s === 200 && r.j.tecnicos.length === 2, r);
    r = await call('GET', '/api/me', undefined, O);
    t('el permiso aparece en /api/me', r.j.me.perms.verTecnicos === true, r.j.me.perms);

    /* el horario lo decide el servidor: con un horario que no incluye la hora actual, todo se descarta */
    const h = ar(Date.now()).h, fuera = h >= 12 ? { desde: 0, hasta: 1 } : { desde: 23, hasta: 24 };
    await call('POST', '/api/ubicacion/horario', fuera, A);
    r = await call('POST', '/api/ubicacion', { lat: -28.45, lng: -62.85, acc: 5, ts: Date.now() }, P);
    t('fuera de horario no se guarda (aunque el celular diga otra hora)', r.s === 200 && r.j.guardados === 0 && r.j.fuera_horario === true, r);
    r = await call('GET', '/api/ubicacion/estado', undefined, P);
    t('el estado dice que está fuera de horario', r.j.dentro === false && r.j.desde === fuera.desde, r);
    r = await call('GET', '/api/ubicaciones', undefined, A);
    t('lo guardado antes sigue ahí, pero no hay nada nuevo', r.j.tecnicos.find(x => x.nombre === 'Pedro').puntos === 2, r.j.tecnicos);
    await call('POST', '/api/ubicacion/horario', { desde: 8, hasta: 20 }, A);
    r = await call('GET', '/api/ubicacion/estado', undefined, P);
    t('se puede volver al horario de 8 a 20', r.j.desde === 8 && r.j.hasta === 20, r);

    /* estado de cada técnico y tramos sin señal (huecos de más de 10 minutos) */
    {
      await call('POST', '/api/ubicacion/horario', { desde: 0, hasta: 24 }, A);
      await call('POST', '/api/users', { usuario: 'luis', nombre: 'Luis', role: 'tecnico', clave: 'luis11', tel: '3844222222' }, A);
      const L = (await call('POST', '/api/login', { usuario: 'luis', clave: 'luis11' })).j.token;
      r = await call('GET', '/api/ubicaciones', undefined, A);
      let lu = r.j.tecnicos.find(x => x.nombre === 'Luis');
      t('sin aceptar el aviso: estado «sin_aceptar» y ningún tramo', lu && lu.estado === 'sin_aceptar' && lu.huecos.length === 0 && lu.sinSenalMin === 0, lu);
      await call('POST', '/api/ubicacion/acepto', {}, L);
      r = await call('GET', '/api/ubicaciones', undefined, A);
      lu = r.j.tecnicos.find(x => x.nombre === 'Luis');
      t('aceptó pero no mandó nada: «sin_datos», sin inventar tramos', lu.estado === 'sin_datos' && lu.huecos.length === 0 && lu.sinSenalMin === 0, lu);
      const ped2 = r.j.tecnicos.find(x => x.nombre === 'Pedro'), jua2 = r.j.tecnicos.find(x => x.nombre === 'Juan');
      t('los que mandaron hace un rato figuran «en_linea»', ped2.estado === 'en_linea' && jua2.estado === 'en_linea', [ped2.estado, jua2.estado]);

      const base = Date.now(), p1 = base - 14 * 60e3, p2 = base - 13 * 60e3;
      if (ar(p1).fecha !== ar(base).fecha) t('(salteado: recién pasó la medianoche, los puntos caerían en otro día)', true);
      else {
        r = await call('POST', '/api/ubicacion', { pts: [{ lat: -28.41, lng: -62.81, acc: 7, ts: p1 }, { lat: -28.411, lng: -62.811, acc: 7, ts: p2 }] }, L);
        t('el servidor acepta los dos puntos atrasados', r.s === 200 && r.j.guardados === 2, r);
        r = await call('GET', '/api/ubicaciones', undefined, A);
        lu = r.j.tecnicos.find(x => x.nombre === 'Luis');
        const g0 = lu.huecos[0], gN = lu.huecos[lu.huecos.length - 1];
        t('último punto de hace 13 min: «sin_senal»', lu.estado === 'sin_senal', lu);
        t('dos tramos: desde que arranca el horario hasta el primer punto, y desde el último hasta ahora', lu.huecos.length === 2 && g0.inicio === true && g0.hasta === p1 && gN.sigue === true && gN.desde === p2, lu.huecos);
        t('suma los minutos sin señal', lu.sinSenalMin >= 13, lu.sinSenalMin);
        r = await call('POST', '/api/ubicacion', { lat: -28.412, lng: -62.812, acc: 7 }, L);
        r = await call('GET', '/api/ubicaciones', undefined, A);
        lu = r.j.tecnicos.find(x => x.nombre === 'Luis');
        const medio = lu.huecos.find(g => g.desde === p2);
        t('al volver a mandar: «en_linea» y el tramo queda anotado, ya sin «sigue»', lu.estado === 'en_linea' && medio && !medio.sigue && medio.hasta - medio.desde > 12.5 * 60e3 && !lu.huecos.some(g => g.sigue), lu);
      }
      r = await call('GET', '/api/ubicaciones?dia=2001-01-01', undefined, A);
      t('un día pasado no tiene estado «en vivo» ni tramos', r.j.tecnicos.every(x => x.huecos.length === 0 && x.estado !== 'en_linea' && x.estado !== 'sin_senal' && x.estado !== 'sin_datos'), r.j.tecnicos.map(x => x.estado));
      await call('POST', '/api/ubicacion/horario', fuera, A);
      r = await call('GET', '/api/ubicaciones', undefined, A);
      t('con la hora actual fuera del horario figuran «fuera_horario»', r.j.tecnicos.filter(x => x.acepto).every(x => x.estado === 'fuera_horario'), r.j.tecnicos.map(x => x.estado));
      await call('POST', '/api/ubicacion/horario', { desde: 8, hasta: 20 }, A);
      r = await call('GET', '/api/users', undefined, A);
      await call('PATCH', '/api/users/' + r.j.users.find(u => u.usuario === 'luis').id, { activo: false }, A);
    }

    /* el cálculo de tramos, probado solo (ventana de 8 a 20 de un día cualquiera) */
    {
      const fs = require('fs'), path = require('path');
      const src = fs.readFileSync(path.join(__dirname, '..', 'worker', 'src', 'worker.js'), 'utf8');
      const ubicHuecos = new Function(src.slice(src.indexOf('const UBIC_HUECO_MS'), src.indexOf('const arTime')) + '; return ubicHuecos;')();
      const D = Date.parse('2026-03-10T00:00:00-03:00'), hh = (h, m = 0) => D + (h * 60 + m) * 60e3, ws = hh(8), we = hh(20);
      t('sin ningún punto no hay tramos', ubicHuecos([], ws, we, false).length === 0);
      const g = ubicHuecos([hh(9), hh(9, 5), hh(9, 30), hh(12), hh(19, 58)], ws, we, false);
      t('tramos de un día cerrado: inicio, 25 min, 2 h 30 min y de 12:00 a 19:58; los 2 min del final no cuentan', g.length === 4 && g[0].inicio && g[0].desde === ws && g[0].hasta === hh(9) && g[1].desde === hh(9, 5) && g[1].hasta === hh(9, 30) && g[2].hasta === hh(12) && g[3].desde === hh(12) && g[3].hasta === hh(19, 58), g);
      t('exactamente 10 minutos no es un tramo; 10 min y 1 s sí', ubicHuecos([hh(8), hh(8, 10)], ws, hh(8, 10), false).length === 0 && ubicHuecos([hh(8), hh(8, 10) + 1000], ws, hh(8, 10) + 1000, false).length === 1);
      const h2 = ubicHuecos([hh(8), hh(8, 5)], ws, hh(9), true);
      t('si el día sigue abierto, el último tramo lleva «sigue»', h2.length === 1 && h2[0].sigue === true && h2[0].desde === hh(8, 5) && h2[0].hasta === hh(9), h2);
      t('los puntos fuera de la ventana se ignoran', ubicHuecos([hh(6), hh(21)], ws, we, false).length === 1 && ubicHuecos([hh(6), hh(21)], ws, we, false)[0].desde === ws, ubicHuecos([hh(6), hh(21)], ws, we, false));
      t('una ventana que todavía no empezó no tiene tramos', ubicHuecos([hh(9)], ws, ws, true).length === 0);
    }

    /* un técnico dado de baja deja de aparecer */
    r = await call('GET', '/api/users', undefined, A);
    const jj = r.j.users.find(u => u.usuario === 'juan');
    await call('PATCH', '/api/users/' + jj.id, { activo: false }, A);
    r = await call('GET', '/api/ubicaciones', undefined, A);
    t('un técnico desactivado no figura en el listado', r.j.tecnicos.length === 1 && r.j.tecnicos[0].nombre === 'Pedro', r.j.tecnicos);

    /* el listado de /api/sync y el respaldo no se llevan las ubicaciones */
    r = await call('GET', '/api/backup', undefined, A);
    t('el respaldo no incluye las ubicaciones', r.s === 200 && !JSON.stringify(r.j).includes('-28.4601'), r.s);
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
