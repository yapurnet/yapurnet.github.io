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
