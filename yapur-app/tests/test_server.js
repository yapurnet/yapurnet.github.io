'use strict';
const fs = require('fs'), path = require('path');
const { start } = require('./harness');
let BASE = '';
let okN = 0, failN = 0;
const t = (name, cond, extra) => { if (cond) { okN++; console.log('ok   ' + name); } else { failN++; console.log('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function call(method, p, body, token) {
  const r = await fetch(BASE + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { s: r.status, j };
}
async function openStream(token) {
  const tk = (await call('POST', '/api/ticket', {}, token)).j.t;
  const r = await fetch(BASE + '/api/stream?t=' + tk);
  const events = [];
  const rd = r.body.getReader(), dec = new TextDecoder();
  let buf = '';
  (async () => {
    try {
      for (;;) {
        const { value, done } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /event: (\w+)/.exec(chunk), d = /data: (.*)/.exec(chunk);
          if (ev && d) events.push({ ev: ev[1], data: JSON.parse(d[1]) });
        }
      }
    } catch (e) {}
    events.closed = true;
  })();
  return { events, status: r.status, close: () => rd.cancel().catch(() => {}) };
}

(async () => {
  /* Con YAPUR_CODE_FILE se prueba el código real (la huella SETUP_HASH de wrangler.jsonc); si no, un código de prueba por variable. */
  const realFile = process.env.YAPUR_CODE_FILE;
  const code = realFile ? fs.readFileSync(realFile, 'utf8').split('\n')[0].trim() : 'TEST-CODE-1234-ABCD';
  const dataDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'yapur-persist-'));
  const vars = { SNAP_B_MS: '2500' };   // la segunda copia del día, en la prueba, a los 2,5 segundos
  let srv = await start(realFile ? { dir: dataDir, vars } : { code, dir: dataDir, vars });
  BASE = srv.base;
  try {
    /* ---- instalación ---- */
    let r = await call('GET', '/api/status');
    t('estado: necesita instalación', r.s === 200 && r.j.needsSetup === true, r);
    t('hay código de instalación configurado', typeof code === 'string' && code.length >= 16);
    r = await call('POST', '/api/setup', { codigo: 'XXXX-XXXX-XXXX-XXXX', usuario: 'mauro', clave: 'claveSegura1', nombre: 'Mauro' });
    t('setup con código malo rechazado', r.s === 403, r);
    r = await call('POST', '/api/setup', { codigo: code, usuario: 'mauro', clave: 'corta', nombre: 'Mauro' });
    t('setup con clave corta rechazado', r.s === 400, r);
    r = await call('POST', '/api/setup', { codigo: code.toLowerCase().replace(/-/g, ' '), usuario: 'Mauro', clave: 'claveSegura1', nombre: 'Mauro', empresa: 'YAPUR.NET' });
    t('setup crea administrador y entra (el código vale en minúsculas y sin guiones)', r.s === 200 && r.j.token && r.j.me.role === 'admin' && r.j.me.perms.cobrar === true, r);
    const A = r.j.token;
    r = await call('POST', '/api/setup', { codigo: code, usuario: 'otro', clave: 'claveSegura1' });
    t('setup no se puede repetir', r.s === 403, r);
    r = await call('GET', '/api/status');
    t('estado: ya instalado', r.j.needsSetup === false);
    r = await call('GET', '/api/sync');
    t('sin token no hay datos', r.s === 401, r);

    /* ---- usuarios ---- */
    r = await call('POST', '/api/users', { usuario: 'ofi', nombre: 'Laura', role: 'oficina', clave: 'laura1' }, A);
    t('admin crea oficina', r.s === 200 && r.j.user.role === 'oficina' && r.j.user.perms.cobrar === true && r.j.user.perms.anular === false, r);
    const OFI_ID = r.j.user.id;
    r = await call('POST', '/api/users', { usuario: 'tec1', nombre: 'Pedro', role: 'tecnico', clave: 'pedro1', tel: '3844111111', permisos: { cobrar: true, dni: true } }, A);
    t('técnico: permisos de dinero siempre apagados', r.s === 200 && r.j.user.perms.cobrar === false && r.j.user.perms.dni === true, r.j);
    const TEC_ID = r.j.user.id;
    r = await call('POST', '/api/users', { usuario: 'tec1', nombre: 'Otro', role: 'tecnico', clave: 'pedro1' }, A);
    t('usuario repetido rechazado', r.s === 409, r);
    r = await call('POST', '/api/users', { usuario: 'con espacio', nombre: 'X', role: 'tecnico', clave: 'pedro1' }, A);
    t('usuario con espacios rechazado', r.s === 400, r);
    r = await call('POST', '/api/login', { usuario: 'ofi', clave: 'mala' });
    t('login con clave mala', r.s === 401, r);
    r = await call('POST', '/api/login', { usuario: 'OFI', clave: 'laura1' });
    t('login (usuario sin importar mayúsculas)', r.s === 200 && r.j.me.id === OFI_ID, r);
    const O = r.j.token;
    r = await call('POST', '/api/login', { usuario: 'tec1', clave: 'pedro1' });
    const T = r.j.token;
    t('login técnico', r.s === 200 && r.j.me.role === 'tecnico', r);
    r = await call('GET', '/api/users', undefined, O);
    t('oficina no lista usuarios', r.s === 403, r);
    r = await call('POST', '/api/users', { usuario: 'x1', nombre: 'X', role: 'admin', clave: 'clave1234' }, T);
    t('técnico no crea usuarios', r.s === 403, r);
    r = await call('GET', '/api/backup', undefined, O);
    t('oficina no descarga la copia', r.s === 403, r);

    /* ---- datos y permisos ---- */
    r = await call('PUT', '/api/doc/planes/p1', { data: { nombre: 'Hogar 100', bajada: 100, subida: 50, precio: 20000 } }, A);
    t('admin crea plan', r.s === 200 && r.j.data.precio === 20000, r);
    r = await call('PUT', '/api/doc/planes/p2', { data: { nombre: 'Hack', precio: 1 } }, O);
    t('oficina no crea planes', r.s === 403, r);
    r = await call('PUT', '/api/doc/ajustes/general', { data: { empresa: 'YAPUR.NET', diaVenc: 10, servicios: [{ id: 'multimedia', nombre: 'Multimedia', precio: 15000, activo: true }], perfiles: [{ id: 'falso' }] } }, A);
    t('admin guarda ajustes', r.s === 200, r);
    r = await call('PUT', '/api/doc/ajustes/general', { data: { empresa: 'Hack' } }, O);
    t('oficina no cambia ajustes', r.s === 403, r);

    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cli1: { nombre: 'Ana', tel: '3844000000', dni: '30111222', planId: 'p1', precio: null, lat: -28.46, lng: -62.83, estado: 'activo' }, cli2: { nombre: 'Beto', planId: 'p1', precio: 15000 } } } }, O);
    t('oficina da de alta clientes', r.s === 200, r);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cli3: { nombre: 'Carla' } } } }, T);
    t('técnico no da de alta clientes', r.s === 403, r);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cli1: { precio: 1 } } } }, T);
    t('técnico no cambia el precio de un cliente', r.s === 403, r);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cli1: { nombre: 'Ana', tel: '3844000000', dni: '30111222', planId: 'p1', precio: null, lat: -28.5, lng: -62.9, estado: 'activo', nodo: 'Torre 2' } } } }, T);
    t('técnico sí actualiza ubicación y datos técnicos (aunque mande el objeto completo)', r.s === 200, r);
    r = await call('GET', '/api/doc/clientes/c01', undefined, A);
    t('merge conserva los otros clientes del lote', r.j.data.items.cli2 && r.j.data.items.cli1.lat === -28.5 && r.j.data.items.cli1.nodo === 'Torre 2' && r.j.data.items.cli1.dni === '30111222', r.j);
    r = await call('GET', '/api/doc/clientes/c01', undefined, T);
    t('técnico no recibe el precio especial; el DNI solo si se lo dieron', r.j.data.items.cli1.dni === '30111222' && !('precio' in r.j.data.items.cli2) && r.j.data.items.cli1.tel === '3844000000', r.j);
    r = await call('GET', '/api/doc/planes/p1', undefined, T);
    t('técnico no recibe el precio del plan', r.j.data.nombre === 'Hogar 100' && !('precio' in r.j.data), r.j);
    r = await call('GET', '/api/doc/ajustes/general', undefined, T);
    t('ajustes: perfiles virtuales, sin claves, sin precios de servicios', Array.isArray(r.j.data.perfiles) && r.j.data.perfiles.length === 2 && !r.j.data.perfiles.some(p => p.hash || p.salt || p.pin) && !('precio' in r.j.data.servicios[0]) && !r.j.data.perfiles.some(p => p.id === 'falso'), r.j);
    r = await call('GET', '/api/doc/ajustes/general', undefined, A);
    t('administrador sí ve precios de servicios', r.j.data.servicios[0].precio === 15000);

    /* ---- pagos ---- */
    r = await call('GET', '/api/doc/pagos/2026-s01', undefined, T);
    t('técnico no lee pagos', r.s === 200 && r.j.exists === false && r.j.data === null, r);
    r = await call('PATCH', '/api/doc/pagos/2026-s01', { data: { items: { pg1: { c: 'cli1', concepto: 'mensualidad', per: '2026-10', monto: 20000, fecha: '2026-10-05', recibo: 'R1', por: 'FALSO' } } } }, T);
    t('técnico no registra pagos', r.s === 403, r);
    r = await call('PATCH', '/api/doc/pagos/2026-s01', { data: { items: { pg1: { c: 'cli1', concepto: 'mensualidad', per: '2026-10', monto: 20000, fecha: '2026-10-05', recibo: 'R1', por: 'FALSO' } } } }, O);
    t('oficina registra pago', r.s === 200 && r.j.data.items.pg1.por === OFI_ID, r);
    r = await call('PATCH', '/api/doc/pagos/2026-s01', { data: { items: { pg1: { monto: 1 } } } }, O);
    t('un pago registrado no se edita', r.s === 403, r);
    r = await call('PATCH', '/api/doc/pagos/2026-s01', { data: { items: { pg1: { anulado: true, anuladoMotivo: 'error' } } } }, O);
    t('oficina sin permiso de anular no puede', r.s === 403, r);
    r = await call('PATCH', '/api/doc/pagos/2026-s01', { data: { items: { pg1: { anulado: true, anuladoMotivo: 'error', anuladoFecha: '2026-10-06', anuladoPor: 'FALSO' } } } }, A);
    t('admin anula y queda su nombre', r.s === 200 && r.j.data.items.pg1.anuladoPor !== 'FALSO', r);
    r = await call('PATCH', '/api/doc/pagos/2026-s01', { data: { items: { pg1: { anulado: false } } } }, A);
    t('un recibo anulado no se reactiva', r.s === 403, r);
    r = await call('PUT', '/api/doc/pagos/2026-s01', { data: { items: {} } }, A);
    t('pagos: no se reemplaza un lote entero', r.s === 400, r);

    /* cambiar permisos de la oficina: ahora puede anular */
    r = await call('PATCH', '/api/users/' + OFI_ID, { permisos: { anular: true } }, A);
    t('admin da permiso de anular', r.s === 200 && r.j.user.perms.anular === true, r);
    r = await call('PATCH', '/api/doc/pagos/2026-s01', { data: { items: { pg2: { c: 'cli2', concepto: 'mensualidad', per: '2026-10', monto: 15000, fecha: '2026-10-07', recibo: 'R2' } } } }, O);
    r = await call('PATCH', '/api/doc/pagos/2026-s01', { data: { items: { pg2: { anulado: true, anuladoMotivo: 'prueba', anuladoFecha: '2026-10-07' } } } }, O);
    t('oficina con permiso anula', r.s === 200 && r.j.data.items.pg2.anuladoPor === OFI_ID, r);

    /* ---- sincronización ---- */
    r = await call('GET', '/api/sync', undefined, T);
    t('sync técnico: sin pagos', r.s === 200 && !('pagos' in r.j.cols) && r.j.cols.clientes.length === 1 && r.j.cols.planes.length === 1, Object.keys(r.j.cols || {}));
    r = await call('GET', '/api/sync', undefined, O);
    t('sync oficina: con pagos', r.j.cols.pagos && r.j.cols.pagos[0].data.items.pg1, r.j && Object.keys(r.j.cols || {}));

    /* ---- tiempo real ---- */
    const sO = await openStream(O), sT = await openStream(T);
    await sleep(200);
    t('stream abre y saluda', sO.status === 200 && sO.events.some(e => e.ev === 'hello'));
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cli2: { nombre: 'Beto', planId: 'p1', precio: 15000, nodo: 'Torre 9' } } } }, O);
    await sleep(200);
    const dO = sO.events.filter(e => e.ev === 'doc' && e.data.coll === 'clientes'), dT = sT.events.filter(e => e.ev === 'doc' && e.data.coll === 'clientes');
    t('el cambio llega en vivo a los dos', dO.length === 1 && dT.length === 1 && dO[0].data.data.items.cli2.nodo === 'Torre 9', [dO.length, dT.length]);
    t('en vivo, el técnico no recibe el precio', !('precio' in dT[0].data.data.items.cli2) && dO[0].data.data.items.cli2.precio === 15000, dT);
    t('seq coincide con la respuesta', dO[0].data.seq === r.j.seq, [dO[0].data.seq, r.j.seq]);
    r = await call('PATCH', '/api/doc/pagos/2026-s01', { data: { items: { pg3: { c: 'cli1', concepto: 'mensualidad', per: '2026-11', monto: 20000, fecha: '2026-11-05', recibo: 'R3' } } } }, O);
    await sleep(200);
    t('los pagos en vivo solo llegan a quien puede verlos', sO.events.filter(e => e.ev === 'doc' && e.data.coll === 'pagos').length === 1 && sT.events.filter(e => e.ev === 'doc' && e.data.coll === 'pagos').length === 0);
    r = await call('POST', '/api/stream', {}, T);
    r = await fetch(BASE + '/api/stream?t=reusado');
    t('ticket inválido rechazado', r.status === 401);

    /* permisos en vivo */
    r = await call('PATCH', '/api/users/' + TEC_ID, { permisos: { dni: false } }, A);
    await sleep(200);
    t('cambio de permisos llega al usuario (evento me)', sT.events.some(e => e.ev === 'me' && e.data.perms.dni === false));
    r = await call('GET', '/api/doc/clientes/c01', undefined, T);
    t('sin permiso de DNI, el servidor deja de enviarlo', r.j.data.items.cli1 && !('dni' in r.j.data.items.cli1), r.j);
    t('y la lista de perfiles se actualiza para todos', sO.events.some(e => e.ev === 'doc' && e.data.coll === 'ajustes'));

    /* ---- desactivar ---- */
    r = await call('PATCH', '/api/users/' + TEC_ID, { activo: false }, A);
    await sleep(300);
    t('desactivar expulsa la sesión en vivo', sT.events.some(e => e.ev === 'kick'));
    r = await call('GET', '/api/sync', undefined, T);
    t('token del desactivado deja de funcionar', r.s === 401, r);
    r = await call('POST', '/api/login', { usuario: 'tec1', clave: 'pedro1' });
    t('el desactivado no puede entrar', r.s === 401 && /desactivado/.test(r.j.error), r);
    r = await call('PATCH', '/api/users/' + (await call('GET', '/api/users', undefined, A)).j.users.find(u => u.usuario === 'mauro').id, { activo: false }, A);
    t('no se puede desactivar al único administrador', r.s === 400, r);
    sO.close(); sT.close();

    /* ---- claves ---- */
    r = await call('POST', '/api/me/clave', { actual: 'incorrecta', nueva: 'nueva123' }, O);
    t('cambio de clave propia exige la actual', r.s === 403, r);
    r = await call('POST', '/api/me/clave', { actual: 'laura1', nueva: 'laura2' }, O);
    t('cambio de clave propia', r.s === 200, r);
    r = await call('POST', '/api/login', { usuario: 'ofi', clave: 'laura2' });
    t('entra con la clave nueva', r.s === 200);
    r = await call('POST', '/api/users/' + OFI_ID + '/clave', { clave: 'laura3' }, A);
    r = await call('GET', '/api/sync', undefined, O);
    t('reset de clave por el admin cierra sus sesiones', r.s === 401, r);

    /* ---- freno de intentos ---- */
    let last;
    for (let i = 0; i < 6; i++) last = await call('POST', '/api/login', { usuario: 'ofi', clave: 'mal' + i });
    t('freno tras varios intentos fallidos', last.s === 429, last);
    r = await call('POST', '/api/login', { usuario: 'ofi', clave: 'laura3' });
    t('aun con la clave buena queda frenado un rato', r.s === 429, r);
    r = await call('POST', '/api/login', { usuario: 'mauro', clave: 'claveSegura1' });
    t('otro usuario no se ve afectado', r.s === 200, r);

    /* ---- copia y restauración (formato propio y formato anterior) ---- */
    r = await call('GET', '/api/backup', undefined, A);
    t('copia completa descargable', r.s === 200 && r.j.docs.length >= 4 && r.j.users.length === 3, r.j && [r.j.docs && r.j.docs.length, r.j.users && r.j.users.length]);
    const backup = r.j;
    const legacy = { app: 'yapur-legacy', v: 1, docs: [
      { coll: 'clientes', id: 'c05', data: { items: { x1: { nombre: 'Legacy 1' }, x2: { nombre: 'Legacy 2' } } } },
      { coll: 'planes', id: 'pz', data: { nombre: 'Plan Z', precio: 1 } },
      { coll: 'ajustes', id: 'general', data: { empresa: 'YAPUR.NET', perfiles: [{ id: 'abc123', nombre: 'Marcos Gómez', base: 'tecnico', activo: true, pin: 'x', salt: 'y', permisos: { dni: true } }, { id: 'def456', nombre: 'Sandra', base: 'oficina', activo: false }] } },
      { coll: 'pagos', id: '2026-s02', data: { items: { q1: { c: 'x1', monto: 5 } } } },
      { coll: 'hack', id: 'z', data: {} }
    ] };
    r = await call('POST', '/api/restore', legacy, A);
    t('restaura copia de la versión anterior', r.s === 200 && r.j.docs === 4 && r.j.usuarios.length === 2 && r.j.usuarios[0].usuario === 'marcos.gomez' && r.j.usuarios[0].clave.length === 8, r);
    const temp = r.j.usuarios[0];
    r = await call('POST', '/api/login', { usuario: 'mauro', clave: 'claveSegura1' });
    t('el administrador sigue entrando después de restaurar', r.s === 200, r);
    const A2 = r.j.token;
    r = await call('GET', '/api/doc/ajustes/general', undefined, A2);
    t('perfiles viejos pasaron a usuarios con el mismo id', r.j.data.perfiles.some(p => p.id === 'abc123' && p.base === 'tecnico' && p.permisos.dni === true) && r.j.data.perfiles.some(p => p.id === 'def456' && p.activo === false), r.j.data.perfiles);
    r = await call('POST', '/api/login', { usuario: temp.usuario, clave: temp.clave });
    t('el técnico migrado entra con su clave provisoria', r.s === 200 && r.j.me.id === 'abc123', r);
    r = await call('GET', '/api/doc/clientes/c01', undefined, A2);
    t('restaurar reemplaza los datos anteriores', r.j.exists === false);
    r = await call('POST', '/api/restore', backup, A2);
    t('restaura una copia propia (usuarios y claves incluidos)', r.s === 200 && r.j.usuarios.length === 0, r);
    r = await call('POST', '/api/login', { usuario: 'mauro', clave: 'claveSegura1' });
    t('después de restaurar la copia propia, el admin entra', r.s === 200, r);
    let A3 = r.j.token;
    r = await call('GET', '/api/doc/clientes/c01', undefined, A3);
    t('datos recuperados', r.j.exists && r.j.data.items.cli1.nombre === 'Ana', r.j);
    r = await call('GET', '/api/backups', undefined, A3);
    t('copias guardadas: «antes de restaurar» y la diaria', r.s === 200 && r.j.copias.some(c => c.name.startsWith('antes-de-restaurar')) && r.j.copias.every(c => c.bytes > 100), r.j);
    r = await call('GET', '/api/backups', undefined, O);
    t('oficina no ve las copias', r.s === 403 || r.s === 401, r);
    r = await call('POST', '/api/backups/restore', { name: '../etc' }, A3);
    t('nombre de copia raro rechazado', r.s === 400, r);
    await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cliZ: { nombre: 'Zeta' } } } }, A3);
    await sleep(400);
    r = await call('GET', '/api/backups', undefined, A3);
    const daily = (r.j.copias || []).find(c => /^yapur-\d{4}-\d{2}-\d{2}$/.test(c.name));
    t('copia diaria automática creada', !!daily, r.j);
    await sleep(2600);
    await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cliY: { nombre: 'Y' } } } }, A3);
    await sleep(600);
    r = await call('GET', '/api/backups', undefined, A3);
    t('la segunda copia del día se hace más tarde', (r.j.copias || []).some(c => /^yapur-\d{4}-\d{2}-\d{2}b$/.test(c.name)), r.j);
    r = await call('POST', '/api/backups/restore', { name: (r.j.copias.find(c => /b$/.test(c.name)) || {}).name }, A3);
    t('y se puede restaurar', r.s === 200, r);
    r = await call('POST', '/api/login', { usuario: 'mauro', clave: 'claveSegura1' });
    A3 = r.j.token;
    r = await call('GET', '/api/backups', undefined, A3);
    const antes = (r.j.copias || []).filter(c => c.name.startsWith('antes-de-restaurar')).sort((a, b) => a.name.localeCompare(b.name))[0];
    r = await call('POST', '/api/backups/restore', { name: antes.name }, A3);
    t('restaurar una copia guardada por el servidor', r.s === 200, r);
    r = await call('POST', '/api/login', { usuario: 'mauro', clave: 'claveSegura1' });
    t('después de restaurar desde el servidor, el admin entra', r.s === 200, r);
    const A4 = r.j.token;
    r = await call('GET', '/api/doc/clientes/c01', undefined, A4);
    t('la copia del servidor trae los datos de entonces (sin Zeta)', r.j.exists && r.j.data.items.cli1 && !r.j.data.items.cliZ, r.j);
    r = await call('GET', '/api/backup', undefined, A4);
    t('la copia propia vuelve a bajarse', r.s === 200 && r.j.docs.length >= 4);

    /* ---- seguridad básica ---- */
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cli1: { '__proto__': { polluted: true }, nombre: 'Ana' } } } }, A4);
    t('prototype pollution no afecta al servidor', ({}).polluted === undefined && r.s === 200);
    r = await call('GET', '/api/doc/hack/x', undefined, A4);
    t('colecciones desconocidas rechazadas', r.s === 400, r);
    r = await call('GET', '/api/doc/clientes/..%2f..%2fetc', undefined, A4);
    t('ids raros rechazados', r.s === 400, r);
    const st = await fetch(BASE + '/..%2f..%2fetc%2fpasswd');
    t('no se sale de la carpeta pública', st.status === 403 || st.status === 404, st.status);
    const big = await fetch(BASE + '/api/doc/clientes/c01', { method: 'PATCH', headers: { authorization: 'Bearer ' + A4, 'content-type': 'application/json' }, body: JSON.stringify({ data: { items: { z: { x: 'a'.repeat(2.2e6) } } } }) }).catch(() => ({ status: 0 }));
    t('pedidos enormes rechazados', big.status === 413 || big.status === 0, big.status);
    const pre = await fetch(BASE + '/api/sync', { method: 'OPTIONS' });
    t('CORS preflight para la app Android', pre.status === 204 && pre.headers.get('access-control-allow-origin') === '*');
    const h = await fetch(BASE + '/healthz');
    t('healthz', h.status === 200);

    /* ---- reinicio del servidor: los datos, las sesiones y el orden de cambios sobreviven ---- */
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cliP: { nombre: 'Persistente' } } } }, A4);
    const seqAntes = r.j.seq;
    await srv.stop(true);
    srv = await start(realFile ? { dir: dataDir, vars } : { code, dir: dataDir, vars });
    BASE = srv.base;
    r = await call('GET', '/api/doc/clientes/c01', undefined, A4);
    t('después de reiniciar, la sesión y los datos siguen', r.s === 200 && r.j.exists && r.j.data.items.cliP && r.j.data.items.cliP.nombre === 'Persistente', r);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cliQ: { nombre: 'Después' } } } }, A4);
    t('el número de cambio nunca vuelve atrás tras un reinicio', r.s === 200 && r.j.seq > seqAntes, [seqAntes, r.j.seq]);
    r = await call('POST', '/api/login', { usuario: 'ofi', clave: 'laura3' });
    t('el freno de intentos sobrevive al reinicio (no se esquiva esperando)', r.s === 429, r);
    r = await call('POST', '/api/login', { usuario: 'mauro', clave: 'claveSegura1' });
    t('la clave sigue valiendo tras reiniciar', r.s === 200, r);
    t('sin errores en el registro del servidor', !/Uncaught|\bERROR\b|✘/.test(srv.log()), srv.log().split('\n').filter(l => /Uncaught|ERROR|✘/.test(l)).slice(0, 5));
  } catch (e) {
    failN++; console.log('FAIL excepción', e);
  } finally {
    await srv.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
    console.log(`\n${okN} ok, ${failN} con fallas`);
    if (failN) console.log('--- log del servidor ---\n' + srv.log().slice(-4000));
    process.exit(failN ? 1 : 0);
  }
})();
