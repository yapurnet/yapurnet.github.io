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

    /* ---- red: cajas NAP y botellas de empalme ---- */
    const RED = (tok, items) => call('PATCH', '/api/doc/red/puntos', { data: { items } }, tok);
    r = await RED(T, { n1: { tipo: 'nap', nombre: 'NAP-01', lat: -28.4651, lng: -62.8352, puertos: 16, ref: 'Poste frente a la plaza', creado: 1, mod: 1 } });
    t('red: el técnico carga una caja NAP con su ubicación', r.s === 200 && r.j.data.items.n1.lat === -28.4651, r);
    r = await RED(O, { e1: { tipo: 'empalme', nombre: 'BE-01', lat: -28.46, lng: -62.83, puertos: null, padre: null }, n2: { tipo: 'nap', nombre: 'NAP-02', puertos: 8, padre: 'e1' } });
    t('red: la oficina carga una botella de empalme y una caja sin ubicación que sale de ella', r.s === 200 && r.j.data.items.e1.tipo === 'empalme' && r.j.data.items.n2.padre === 'e1', r);
    r = await RED(T, { x1: { tipo: 'torre', nombre: 'Rara' } });
    t('red: un tipo desconocido se rechaza', r.s === 403 && /tipo/i.test(r.j.error), r);
    r = await RED(T, { x1: { tipo: 'nap', nombre: '   ' } });
    t('red: sin nombre se rechaza', r.s === 403 && /nombre/i.test(r.j.error), r);
    r = await RED(T, { n1: { lat: 95, lng: -62 } });
    t('red: latitud fuera de rango se rechaza', r.s === 403 && /ubicaci/i.test(r.j.error), r);
    r = await RED(T, { n1: { lat: -28.4, lng: null } });
    t('red: latitud sin longitud se rechaza', r.s === 403 && /latitud y longitud/i.test(r.j.error), r);
    r = await RED(T, { n1: { lat: '-28.4', lng: '-62.8' } });
    t('red: coordenadas como texto se rechazan', r.s === 403, r);
    r = await RED(T, { n1: { puertos: 0 } });
    t('red: puertos en cero se rechazan', r.s === 403 && /puertos/i.test(r.j.error), r);
    r = await RED(T, { n1: { puertos: 'muchos' } });
    t('red: puertos que no son número se rechazan', r.s === 403, r);
    r = await RED(T, { n1: { inventado: 1 } });
    t('red: datos desconocidos se rechazan', r.s === 403 && /desconocido/i.test(r.j.error), r);
    r = await RED(T, { n1: { padre: 'n1' } });
    t('red: un punto no puede salir de sí mismo', r.s === 403, r);
    r = await RED(A, { n3: { tipo: 'nap', nombre: 'x'.repeat(61) } });
    t('red: ni el administrador se salta las validaciones', r.s === 403, r);
    r = await call('PUT', '/api/doc/red/puntos', { data: { items: {} } }, A);
    t('red: no se pisa todo el lote de una vez', r.s === 400, r);
    r = await RED(T, { n1: null });
    t('red: el técnico no puede eliminar puntos', r.s === 403 && /eliminar/i.test(r.j.error), r);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cr1: { nombre: 'Rita Red', estado: 'activo', nap: 'n1', napPuerto: 3 } } } }, O);
    t('red: la oficina conecta un cliente a una caja', r.s === 200 && r.j.data.items.cr1.nap === 'n1', r);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cr1: { nap: 'n2', napPuerto: 4 } } } }, T);
    t('red: el técnico puede cambiarle la caja y el puerto a un cliente (no es facturación)', r.s === 200 && r.j.data.items.cr1.nap === 'n2', r);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cr1: { nap: 'n1', napPuerto: 3 } } } }, T);
    r = await RED(O, { n1: null });
    t('red: no se elimina una caja con clientes conectados', r.s === 409 && /1 cliente conectado/.test(r.j.error), r);
    r = await RED(O, { e1: null });
    t('red: no se elimina una botella de la que sale otra caja', r.s === 409 && /1 punto/.test(r.j.error), r);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cr1: { estado: 'baja' } } } }, O);
    r = await RED(O, { n1: null });
    t('red: con el cliente dado de baja la caja se puede eliminar (la oficina puede)', r.s === 200 && r.j.data.items.n1 === null, r);
    r = await RED(T, { n1: { tipo: 'nap', nombre: 'Resucitada' } });
    t('red: se puede volver a cargar un punto con el mismo código luego de eliminarlo', r.s === 200 && r.j.data.items.n1.nombre === 'Resucitada', r);
    r = await call('PATCH', '/api/users/' + TEC_ID, { permisos: { cobrar: true, dni: true, red: false } }, A);
    t('red: el administrador apaga el permiso de red a un técnico', r.s === 200 && r.j.user.perms.red === false, r);
    r = await RED(T, { n9: { tipo: 'nap', nombre: 'Prohibida' } });
    t('red: sin permiso de red no puede escribir', r.s === 403 && /red/i.test(r.j.error), r);
    r = await call('GET', '/api/sync', undefined, T);
    t('red: aun sin permiso de escribir, el técnico ve la red (la usa para llegar)', r.s === 200 && r.j.cols.red && r.j.cols.red[0] && r.j.cols.red[0].data.items.e1.nombre === 'BE-01', r.j && Object.keys(r.j.cols || {}));
    r = await call('PATCH', '/api/users/' + TEC_ID, { permisos: { cobrar: true, dni: true, red: true } }, A);
    r = await call('GET', '/api/backup', undefined, A);
    t('red: la copia de seguridad incluye la red', r.s === 200 && r.j.docs.some(d => d.coll === 'red' && d.data.items.e1), r.j && Object.keys(r.j));

    /* ---- precios con vigencia por mes ---- */
    r = await call('PUT', '/api/doc/planes/pv1', { data: { nombre: 'Con historial', bajada: 50, subida: 20, precio: 25000, hist: [{ d: '0000-00', p: 20000 }, { d: '2099-01', p: 25000 }] } }, A);
    t('vigencia: el administrador guarda un plan con historial de precios', r.s === 200, r);
    r = await call('GET', '/api/doc/planes/pv1', undefined, T);
    t('vigencia: el técnico no ve el precio ni el historial del plan', r.s === 200 && r.j.data.precio === undefined && r.j.data.hist === undefined && r.j.data.nombre === 'Con historial', r);
    r = await call('GET', '/api/doc/planes/pv1', undefined, O);
    t('vigencia: la oficina (con precios) sí ve el historial', r.s === 200 && Array.isArray(r.j.data.hist) && r.j.data.hist.length === 2, r);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cv1: { nombre: 'Vera Vigencia', estado: 'activo', planId: 'pv1', hp: [{ h: '2026-09', planId: 'pv1', precio: null, extras: [] }] } } } }, O);
    t('vigencia: la oficina guarda un cliente con historial de cambios', r.s === 200 && r.j.data.items.cv1.hp.length === 1, r);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cv1: { hp: [] } } } }, T);
    t('vigencia: el técnico no puede tocar el historial de facturación del cliente', r.s === 403 && /facturaci/i.test(r.j.error), r);
    r = await call('GET', '/api/doc/clientes/c01', undefined, T);
    t('vigencia: al técnico no le llega el historial de precios del cliente', r.s === 200 && r.j.data.items.cv1 && r.j.data.items.cv1.hp === undefined && r.j.data.items.cv1.nombre === 'Vera Vigencia', r.j);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cv1: { deudaAnt: { m: 1, det: 'x' } } } } }, T);
    t('deuda anterior: el técnico no puede tocarla (es dato de facturación)', r.s === 403 && /facturaci/i.test(r.j.error), r);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cv1: { deudaAnt: { m: 20000, det: 'Octubre 2026', f: '2026-10-30' } } } } }, O);
    t('deuda anterior: la oficina la carga', r.s === 200 && r.j.data.items.cv1.deudaAnt.m === 20000, r);
    r = await call('GET', '/api/doc/clientes/c01', undefined, O);
    t('deuda anterior: la oficina la ve', r.s === 200 && r.j.data.items.cv1.deudaAnt && r.j.data.items.cv1.deudaAnt.m === 20000, r.j);
    r = await call('GET', '/api/doc/clientes/c01', undefined, T);
    t('deuda anterior: al técnico (sin permisos de dinero) no le llega', r.s === 200 && r.j.data.items.cv1 && r.j.data.items.cv1.deudaAnt === undefined, r.j);

    /* ---- cobros en la calle (técnicos con permiso) ---- */
    const HOY = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10), AYER = new Date(Date.now() - 27 * 3600e3).toISOString().slice(0, 10), PG = HOY.slice(0, 4) + '-s07';
    r = await call('POST', '/api/users', { usuario: 'tec2', nombre: 'Marcos', role: 'tecnico', clave: 'marcos1', permisos: { cobrarCampo: true } }, A);
    t('cobros: el administrador crea un técnico que puede cobrar en la calle', r.s === 200 && r.j.user.perms.cobrarCampo === true && r.j.user.perms.cobrar === false, r);
    const TEC2_ID = r.j.user.id;
    r = await call('POST', '/api/login', { usuario: 'tec2', clave: 'marcos1' });
    const T2 = r.j.token;
    r = await call('GET', '/api/doc/clientes/c01', undefined, T2);
    t('deuda anterior: a quien solo cobra en la calle no le llega', r.s === 200 && r.j.data.items.cv1 && r.j.data.items.cv1.deudaAnt === undefined && r.j.data.items.cv1.nombre === 'Vera Vigencia', r.j);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cp1: { nombre: 'Pablo Pendiente', estado: 'pendiente' }, cinst: { nombre: 'Ines Instalada', estado: 'activo' } } } }, O);
    t('cobros: se cargan un cliente por instalar y uno ya instalado', r.s === 200, r);
    const PAGO = (tok, id, o) => call('PATCH', '/api/doc/pagos/' + PG, { data: { items: { [id]: Object.assign({ c: 'cp1', concepto: 'instalacion', monto: 30000, fecha: HOY, hora: '10:00', recibo: 'RT' + id, metodo: 'efectivo' }, o || {}) } } }, tok);
    const PATCH_PAGO = (tok, id, o) => call('PATCH', '/api/doc/pagos/' + PG, { data: { items: { [id]: o } } }, tok);
    r = await PAGO(T2, 'pt1');
    t('cobros: cobra una instalación y queda a su nombre', r.s === 200 && r.j.data === null, r);
    r = await call('GET', '/api/doc/pagos/' + PG, undefined, A);
    t('cobros: el pago quedó registrado con su usuario y la hora del servidor', r.s === 200 && r.j.data.items.pt1.por === TEC2_ID && r.j.data.items.pt1.porNombre === 'Marcos' && r.j.data.items.pt1.srvTs > 0, r.j);
    r = await PAGO(T2, 'pt2', { concepto: 'reclamo', monto: 8000, por: 'otro-usuario', porNombre: 'Falso' });
    t('cobros: también un reclamo o visita técnica', r.s === 200, r);
    r = await PAGO(T2, 'pt3', { concepto: 'mensualidad', per: HOY.slice(0, 7) });
    t('cobros: no puede cobrar mensualidades', r.s === 403 && /mensualidad/i.test(r.j.error), r);
    r = await PAGO(T2, 'pt4', { fecha: AYER });
    t('cobros: no puede cargar cobros con otra fecha', r.s === 403 && /fecha de hoy/i.test(r.j.error), r);
    r = await PAGO(T2, 'pt5', { monto: -500 });
    t('cobros: monto negativo rechazado', r.s === 403 && /monto/i.test(r.j.error), r);
    r = await PAGO(T2, 'pt6', { monto: '30000' });
    t('cobros: monto como texto rechazado', r.s === 403, r);
    r = await PAGO(T2, 'pt7', { c: undefined });
    t('cobros: sin cliente rechazado', r.s === 403, r);
    r = await PAGO(T, 'pt8');
    t('cobros: el técnico sin el permiso no puede cobrar', r.s === 403 && /no puede registrar pagos/i.test(r.j.error), r);
    r = await call('PATCH', '/api/doc/pagos/' + PG, { data: { items: { pt1: { anulado: true, anuladoMotivo: 'x' } } } }, T2);
    t('cobros: tampoco puede anular', r.s === 403, r);
    r = await call('PATCH', '/api/doc/pagos/' + PG, { data: { items: { pt1: { monto: 1 } } } }, T2);
    t('cobros: ni modificar un cobro ya registrado', r.s === 403, r);
    r = await call('GET', '/api/doc/pagos/' + PG, undefined, T2);
    t('cobros: no puede leer la caja', r.s === 200 && r.j.exists === false, r);

    /* instalación solo una vez y solo a quien no está instalado; a uno ya instalado (mudanza) se le cobra reinstalación */
    r = await PAGO(T2, 'pi1', { c: 'cinst' });
    t('instalación: no se le cobra a un cliente que ya está instalado', r.s === 403 && /ya está instalado/.test(r.j.error) && /Reinstalación/.test(r.j.error), r);
    r = await PAGO(T2, 'pi2', { c: 'cinst', concepto: 'reinstalacion', monto: 20000 });
    t('instalación: a un cliente ya instalado se le cobra la reinstalación (mudanza)', r.s === 200, r);
    r = await PAGO(T2, 'pi3', { c: 'cp1', concepto: 'reinstalacion' });
    t('instalación: la reinstalación no se cobra a quien todavía no está instalado', r.s === 403 && /todavía no está instalado/.test(r.j.error), r);
    r = await PATCH_PAGO(O, 'po1', { c: 'cinst', concepto: 'instalacion', monto: 5000, fecha: HOY, hora: '11:00', recibo: 'ROpo1', metodo: 'efectivo' });
    t('instalación: a la oficina (que cobra todo) no se le restringe el concepto', r.s === 200, r);
    r = await PAGO(T2, 'pi6', { c: 'cp1', monto: 4000, recibo: 'RTpi6' });
    t('instalación: a un cliente por instalar se le puede cobrar en dos veces (no se mira lo cobrado: el técnico no ve los pagos)', r.s === 200, r);

    /* el técnico no se entera de si un cliente está activo o suspendido por falta de pago ni de su deuda */
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { csus: { nombre: 'Sara Suspendida', estado: 'suspendido', corteMora: '2026-10-20', reconectado: '2026-09-01', promesas: [{ hasta: '2026-11-05' }], dir: 'Calle 9' }, cbaj: { nombre: 'Bruno Baja', estado: 'baja' } } } }, O);
    t('estado: la oficina carga un cliente suspendido y uno de baja', r.s === 200, r);
    r = await call('GET', '/api/doc/clientes/c01', undefined, T2);
    const itT = r.j.data.items;
    t('estado: al técnico no le llega «activo» ni «suspendido»', itT.cinst && !('estado' in itT.cinst) && itT.csus && !('estado' in itT.csus) && itT.csus.nombre === 'Sara Suspendida' && itT.csus.dir === 'Calle 9', itT.csus);
    t('estado: tampoco la fecha de corte, la reconexión ni las promesas de pago', !('corteMora' in itT.csus) && !('reconectado' in itT.csus) && !('promesas' in itT.csus), itT.csus);
    t('estado: sí le llegan «por instalar» y «baja» (las usa para trabajar)', itT.cp1.estado === 'pendiente' && itT.cbaj.estado === 'baja', [itT.cp1, itT.cbaj]);
    r = await call('GET', '/api/sync', undefined, T2);
    const syncC = r.j.cols.clientes.flatMap(d => Object.values(d.data.items || {}));
    t('estado: la sincronización del técnico tampoco lo trae', syncC.length > 0 && !syncC.some(c => c.estado === 'activo' || c.estado === 'suspendido' || 'corteMora' in c), syncC.filter(c => c.estado === 'activo' || c.estado === 'suspendido').length);
    r = await call('GET', '/api/doc/clientes/c01', undefined, O);
    t('estado: la oficina y el administrador sí lo ven', r.j.data.items.csus.estado === 'suspendido' && r.j.data.items.csus.corteMora === '2026-10-20' && r.j.data.items.cinst.estado === 'activo', r.j.data.items.csus);
    r = await call('GET', '/api/doc/clientes/c01', undefined, A);
    t('estado: el administrador ve todo', r.j.data.items.csus.estado === 'suspendido' && r.j.data.items.csus.promesas.length === 1, r.j.data.items.csus);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { csus: { nombre: 'Sara Suspendida', dir: 'Calle 9 bis', lat: -28.5, lng: -62.9 } } } }, T2);
    t('estado: el técnico guarda la ubicación de un suspendido', r.s === 200 && !('estado' in r.j.data.items.csus), r);
    r = await call('GET', '/api/doc/clientes/c01', undefined, A);
    t('estado: lo que guarda el técnico no pisa el estado real (sigue suspendido, con su corte)', r.j.data.items.csus.estado === 'suspendido' && r.j.data.items.csus.corteMora === '2026-10-20' && r.j.data.items.csus.dir === 'Calle 9 bis', r.j.data.items.csus);
    /* servicios adicionales (Multimedia, Multimedia Net): son de facturación, el técnico no tiene que verlos */
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cmm: { nombre: 'Mabel Multimedia', estado: 'activo', extras: ['multimedia', 'multimedia_net'], dir: 'Calle 7' } } } }, O);
    t('servicios: la oficina carga un cliente con Multimedia y Multimedia Net', r.s === 200 && r.j.data.items.cmm.extras.length === 2, r);
    r = await call('GET', '/api/doc/clientes/c01', undefined, T2);
    t('servicios: al técnico no le llegan los servicios del cliente (sí el resto de sus datos)', r.s === 200 && r.j.data.items.cmm && !('extras' in r.j.data.items.cmm) && r.j.data.items.cmm.dir === 'Calle 7', r.j.data.items.cmm);
    r = await call('GET', '/api/doc/clientes/c01', undefined, T);
    t('servicios: tampoco al técnico sin permiso de cobro', r.s === 200 && !('extras' in r.j.data.items.cmm), r.j.data.items.cmm);
    r = await call('GET', '/api/sync', undefined, T2);
    t('servicios: ni en la sincronización', !r.j.cols.clientes.some(d => Object.values(d.data.items || {}).some(c => 'extras' in c)), r.j.cols.clientes.length);
    r = await call('GET', '/api/doc/clientes/c01', undefined, O);
    t('servicios: la oficina los sigue viendo', r.j.data.items.cmm.extras.join() === 'multimedia,multimedia_net', r.j.data.items.cmm);
    r = await call('GET', '/api/doc/clientes/c01', undefined, A);
    t('servicios: y el administrador', r.j.data.items.cmm.extras.length === 2, r.j.data.items.cmm);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cmm: { nombre: 'Mabel Multimedia', dir: 'Calle 7 bis', lat: -28.4, lng: -62.8 } } } }, T2);
    t('servicios: el técnico guarda la ubicación sin tocar los servicios', r.s === 200 && !('extras' in r.j.data.items.cmm), r);
    r = await call('GET', '/api/doc/clientes/c01', undefined, A);
    t('servicios: lo que guarda el técnico no los borra', r.j.data.items.cmm.extras.join() === 'multimedia,multimedia_net' && r.j.data.items.cmm.dir === 'Calle 7 bis', r.j.data.items.cmm);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cmm: { extras: [] } } } }, T2);
    t('servicios: y no puede quitárselos', r.s === 403, r);
    const sT2 = await openStream(T2);
    await sleep(200);
    await call('PATCH', '/api/doc/clientes/c01', { data: { items: { csus: { estado: 'activo', corteMora: null } } } }, O);
    await sleep(300);
    const evs = sT2.events.filter(e => e.ev === 'doc' && e.data.coll === 'clientes');
    t('estado: en vivo tampoco le llega el cambio de suspendido a activo', evs.length === 1 && !('estado' in evs[0].data.data.items.csus) && !('corteMora' in evs[0].data.data.items.csus), evs.map(e => e.data.data));
    sT2.close();
    r = await call('GET', '/api/doc/pagos/' + PG, undefined, T);
    t('cobros: el técnico sigue sin poder leer la caja', r.s === 200 && r.j.exists === false, r);
    r = await call('GET', '/api/sync', undefined, T2);
    t('cobros: la sincronización del técnico no trae pagos', r.s === 200 && !('pagos' in r.j.cols));
    r = await call('GET', '/api/mis-cobros', undefined, T2);
    t('cobros: «mis cobros» devuelve solo los suyos', r.s === 200 && r.j.docs.length === 1 && Object.keys(r.j.docs[0].data.items).sort().join() === 'pi2,pi6,pt1,pt2' && r.j.hoy === HOY, r);
    r = await call('GET', '/api/mis-cobros', undefined, T);
    t('cobros: otro técnico no ve los de Marcos', r.s === 200 && r.j.docs.length === 0, r);
    r = await call('GET', '/api/mis-cobros', undefined);
    t('cobros: sin sesión no se accede', r.s === 401, r);
    r = await call('GET', '/api/doc/pagos/' + PG, undefined, O);
    t('cobros: la oficina ve los cobros del técnico con su nombre de usuario', r.s === 200 && r.j.data.items.pt2.por === TEC2_ID && r.j.data.items.pt2.porNombre === 'Marcos' && r.j.data.items.pt2.concepto === 'reclamo', r.j);
    r = await call('PATCH', '/api/doc/pagos/' + PG, { data: { items: { pt2: { anulado: true, anuladoMotivo: 'Error de monto' } } } }, A);
    t('cobros: el administrador puede anular un cobro del técnico', r.s === 200 && r.j.data.items.pt2.anuladoPor, r);
    r = await call('GET', '/api/mis-cobros', undefined, T2);
    t('cobros: el técnico ve que quedó anulado', r.j.docs[0].data.items.pt2.anulado === true, r);

    /* ---- routers MikroTik: el router manda su lista, el sistema nunca se conecta ni corta ---- */
    const ING = (tok, q, body) => fetch(BASE + '/api/router/ingest?' + q, { method: 'POST', headers: Object.assign({ 'content-type': 'text/plain' }, tok ? { authorization: 'Bearer ' + tok } : {}), body }).then(async x => ({ s: x.status, j: await x.json().catch(() => null) }));
    r = await call('POST', '/api/routers', { nombre: 'ADMIN02', kinds: ['q', 'p', 'd', 'x'] }, O);
    t('routers: la oficina no puede dar de alta routers', r.s === 403, r);
    r = await call('POST', '/api/routers', { nombre: 'ADMIN02', kinds: ['q', 'p', 'd', 'x'] }, A);
    t('routers: el administrador da de alta un router y recibe el token una sola vez', r.s === 200 && /^r[0-9a-f]{10}\.[A-Za-z0-9_-]{30,}$/.test(r.j.token) && r.j.router.kinds.join() === 'd,p,q', r);
    const RT = r.j.router.id, RTOK = r.j.token;
    r = await call('POST', '/api/routers', { nombre: 'admin02' }, A);
    t('routers: no deja repetir el nombre (aunque cambien las mayúsculas)', r.s === 409, r);
    r = await call('GET', '/api/routers', undefined, A);
    t('routers: la lista no trae el token ni su huella', r.s === 200 && r.j.routers.length === 1 && !JSON.stringify(r.j).includes(RTOK.split('.')[1]) && !('th' in r.j.routers[0]) && r.j.routers[0].hayDatos === false, r);
    r = await call('GET', '/api/routers', undefined, O);
    t('routers: la oficina no ve la lista', r.s === 403, r);
    r = await ING(null, 'run=a1&part=1&fin=1', 'Q\tx\t10.0.0.1\t');
    t('routers: sin token no se puede mandar nada', r.s === 401, r);
    r = await ING(RT + '.malaclave', 'run=a1&part=1&fin=1', 'Q\tx\t10.0.0.1\t');
    t('routers: con un token equivocado tampoco', r.s === 401, r);
    r = await ING(RTOK, 'run=run1&part=1', '#\tADMIN02\t7.15.1\nQ\tJuan Perez\t10.10.0.5/32\t20000000/20000000\tfalse\tnone\tcalle 1\nQ\tRango\t10.20.0.0/24,10.30.0.0/24\t5M/5M\tfalse\tnone\t\nP\tmaria\tpppoe\tplan20\t10.50.0.7\tfalse\tMaría Gómez\nF\tplan20\t20M/20M\nbasura sin formato\nD\t10.40.0.9\tAA:BB:CC:DD:EE:FF\tdhcp1\tfalse\tPedro Díaz\n');
    t('routers: acepta una tanda y cuenta los registros (ignora la basura)', r.s === 200 && r.j.registros === 5 && r.j.ignorados === 1, r);
    r = await call('GET', '/api/routers/' + RT + '/items', undefined, A);
    t('routers: mientras la corrida no termina no hay lista', r.s === 200 && r.j.lines.length === 0 && r.j.router.hayDatos === false, r);
    r = await ING(RTOK, 'run=run1&part=3&fin=1', '#\tfin\n');
    t('routers: si faltan tandas no da por terminada la corrida', r.s === 409, r);
    r = await ING(RTOK, 'run=run1&part=2&fin=1', 'Q\tOtro\t10.10.0.6\t10M/10M\ttrue\tnone\t' + '\n#\tfin\n');
    t('routers: al cerrar la corrida queda la lista completa', r.s === 200 && r.j.total === 6, r);
    r = await call('GET', '/api/routers/' + RT + '/items', undefined, A);
    t('routers: el administrador lee los registros tal cual', r.s === 200 && r.j.lines.length === 6 && r.j.lines.some(l => l[0] === 'P' && l[1] === 'maria' && l[4] === '10.50.0.7') && r.j.lines.some(l => l[0] === 'D' && l[2] === 'AA:BB:CC:DD:EE:FF'), r.j.lines);
    t('routers: guarda el nombre y la versión del router', r.j.router.ident === 'ADMIN02' && r.j.router.ros === '7.15.1' && r.j.router.hayDatos === true && r.j.router.visto > 0, r.j.router);
    r = await ING(RTOK, 'run=run2&part=1', 'Q\tNuevo\t10.0.0.9\t1M/1M\tfalse\tnone\t\n');
    r = await call('GET', '/api/routers/' + RT + '/items', undefined, A);
    t('routers: una corrida a medio hacer no pisa la lista anterior', r.j.lines.length === 6, r.j.lines.length);
    r = await ING(RTOK, 'run=run2&part=2&fin=1', 'Q\tNuevo2\t10.0.0.10\t1M/1M\tfalse\tnone\t\n#\tfin\n');
    r = await call('GET', '/api/routers/' + RT + '/items', undefined, A);
    t('routers: al terminar la nueva corrida reemplaza la anterior', r.j.lines.length === 2 && r.j.lines[0][1] === 'Nuevo', r.j.lines);
    r = await ING(RTOK, 'run=bad run&part=1', 'Q\tx\t1\t');
    t('routers: rechaza una corrida con datos inválidos', r.s === 400, r);
    r = await ING(RTOK, 'run=r9&part=1', 'Q\t' + 'x'.repeat(50000));
    t('routers: rechaza una tanda enorme', r.s === 413, r.s);
    r = await call('GET', '/api/doc/routers/' + RT, undefined, A);
    t('routers: los datos del router no son un documento más (no salen por la sincronización)', r.s === 400, r);
    r = await call('GET', '/api/sync', undefined, A);
    t('routers: ni aparecen en la sincronización', r.s === 200 && !('routers' in r.j.cols));
    r = await call('POST', '/api/routers/' + RT + '/token', {}, A);
    const RTOK2 = r.j.token;
    t('routers: se puede generar un token nuevo', r.s === 200 && RTOK2 !== RTOK && RTOK2.startsWith(RT + '.'), r);
    {
      const filas = []; for (let i = 0; i < 6000; i++) filas.push('Q\tCliente ' + i + '\t10.' + (i >> 8) + '.' + (i & 255) + '.1/32\t20M/20M\tfalse\tnone\tcomentario ' + i);
      const t0 = Date.now(); let ok = true, n = 0;
      for (let i = 0; i < filas.length; i += 40) { n++; const x = await ING(RTOK2, 'run=grande&part=' + n + (i + 40 >= filas.length ? '&fin=1' : ''), filas.slice(i, i + 40).join('\n') + '\n'); if (x.s !== 200) { ok = false; break; } }
      r = await call('GET', '/api/routers/' + RT + '/items', undefined, A);
      t('routers: una lista grande (6.000 registros en 150 tandas) entra completa y se lee entera', ok && n === 150 && r.s === 200 && r.j.lines.length === 6000 && r.j.router.total === 6000 && r.j.lines[5999][1] === 'Cliente 5999', [ok, n, r.s, r.j && r.j.lines && r.j.lines.length]);
      t('routers: y no tarda una eternidad', Date.now() - t0 < 60000, Date.now() - t0);
    }
    r = await ING(RTOK, 'run=r5&part=1&fin=1', '#\tfin\n');
    t('routers: el token anterior deja de valer', r.s === 401, r);
    r = await ING(RTOK2, 'run=r5&part=1&fin=1', '#\tfin\n');
    t('routers: el nuevo token sí', r.s === 200, r);
    r = await call('PATCH', '/api/routers/' + RT, { nombre: 'ADMIN02 principal', kinds: ['q'] }, A);
    t('routers: se puede renombrar y cambiar qué lee', r.s === 200 && r.j.router.nombre === 'ADMIN02 principal' && r.j.router.kinds.join() === 'q', r);
    r = await call('DELETE', '/api/routers/' + RT, undefined, O);
    t('routers: la oficina no puede borrarlo', r.s === 403, r);
    r = await call('DELETE', '/api/routers/' + RT, undefined, A);
    t('routers: el administrador lo borra', r.s === 200, r);
    r = await ING(RTOK2, 'run=r6&part=1&fin=1', '#\tfin\n');
    t('routers: borrado el router su token ya no sirve', r.s === 401, r);

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
    t('ajustes: perfiles virtuales, sin claves, sin precios de servicios', Array.isArray(r.j.data.perfiles) && r.j.data.perfiles.length === 3 && !r.j.data.perfiles.some(p => p.hash || p.salt || p.pin) && !('precio' in r.j.data.servicios[0]) && !r.j.data.perfiles.some(p => p.id === 'falso'), r.j);
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
    t('sync técnico: sin pagos', r.s === 200 && !('pagos' in r.j.cols) && r.j.cols.clientes.length === 1 && r.j.cols.planes.length === 2, Object.keys(r.j.cols || {}));
    r = await call('GET', '/api/sync', undefined, O);
    t('sync oficina: con pagos', r.j.cols.pagos && r.j.cols.pagos[0].data.items.pg1, r.j && Object.keys(r.j.cols || {}));

    /* ---- borrar planes: solo el administrador y solo si ningún cliente lo usa ---- */
    r = await call('PUT', '/api/doc/planes/pdel', { data: { nombre: 'Plan sin uso', bajada: 10, subida: 5, precio: 9000 } }, A);
    t('borrar plan: se crea un plan de prueba sin clientes', r.s === 200, r);
    const dsO = await openStream(O), dsT = await openStream(T);
    await sleep(200);
    r = await call('DELETE', '/api/doc/planes/pdel', undefined, O);
    t('borrar plan: la oficina no puede', r.s === 403 && /administrador/i.test(r.j.error), r);
    r = await call('DELETE', '/api/doc/planes/pdel', undefined, T);
    t('borrar plan: el técnico no puede', r.s === 403, r);
    r = await call('DELETE', '/api/doc/planes/pdel');
    t('borrar plan: sin sesión no puede', r.s === 401, r);
    r = await call('GET', '/api/doc/planes/pdel', undefined, A);
    t('borrar plan: tras los intentos rechazados el plan sigue', r.j.exists === true, r);
    r = await call('DELETE', '/api/doc/planes/p1', undefined, A);
    t('borrar plan: no deja si lo usan clientes activos', r.s === 409 && /Hogar 100/.test(r.j.error) && /2 clientes/.test(r.j.error) && /Desactivalo/.test(r.j.error), r);
    r = await call('GET', '/api/doc/planes/p1', undefined, A);
    t('borrar plan: el plan en uso sigue intacto', r.j.exists === true && r.j.data.precio === 20000, r);
    r = await call('DELETE', '/api/doc/clientes/c01', undefined, A);
    t('borrar: solo se pueden borrar planes (los clientes no)', r.s === 400, r);
    r = await call('GET', '/api/doc/clientes/c01', undefined, A);
    t('borrar: los clientes siguen ahí tras el intento', r.j.exists === true && r.j.data.items.cli1, r);
    r = await call('DELETE', '/api/doc/planes/noexiste', undefined, A);
    t('borrar plan: uno que no existe da 404', r.s === 404, r);

    /* un plan que solo figura en un cliente dado de baja */
    await call('PUT', '/api/doc/planes/pbaja', { data: { nombre: 'Plan viejo', bajada: 5, subida: 2, precio: 5000 } }, A);
    await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cliB: { nombre: 'Ex cliente', planId: 'pbaja', estado: 'baja' } } } }, O);
    r = await call('DELETE', '/api/doc/planes/pbaja', undefined, A);
    t('borrar plan: tampoco si lo tiene un cliente dado de baja', r.s === 409 && /1 cliente dado de baja/.test(r.j.error), r);
    await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cliB: { planId: 'p1' } } } }, O);
    r = await call('DELETE', '/api/doc/planes/pbaja', undefined, A);
    t('borrar plan: al quedar sin clientes se puede borrar', r.s === 200 && r.j.ok === true && r.j.op === 'delete', r);

    /* un plan que solo figura en el historial de precios de un cliente (lo que pagó antes) */
    await call('PUT', '/api/doc/planes/phist', { data: { nombre: 'Plan de antes', bajada: 5, subida: 2, precio: 6000 } }, A);
    await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cliH: { nombre: 'Con historial', planId: 'p1', hp: [{ h: '2026-01', planId: 'phist', precio: 6000 }] } } } }, O);
    r = await call('DELETE', '/api/doc/planes/phist', undefined, A);
    t('borrar plan: tampoco si figura en el historial de precios de un cliente', r.s === 409 && /historial de precios de 1 cliente/.test(r.j.error), r);
    await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cliH: { hp: [] } } } }, O);
    r = await call('DELETE', '/api/doc/planes/phist', undefined, A);
    t('borrar plan: sin referencias en el historial se puede borrar', r.s === 200, r);

    r = await call('DELETE', '/api/doc/planes/pdel', undefined, A);
    t('borrar plan: el administrador borra el plan sin uso', r.s === 200 && r.j.ok === true && r.j.op === 'delete' && r.j.seq > 0, r);
    r = await call('GET', '/api/doc/planes/pdel', undefined, A);
    t('borrar plan: ya no existe', r.j.exists === false, r);
    r = await call('DELETE', '/api/doc/planes/pdel', undefined, A);
    t('borrar plan: borrarlo dos veces da 404, no rompe', r.s === 404, r);
    r = await call('GET', '/api/sync', undefined, T);
    t('borrar plan: ya no viaja en la sincronización', r.j.cols.planes.length === 2 && !r.j.cols.planes.some(x => ['pdel', 'pbaja', 'phist'].includes(x.id)), r.j.cols.planes.map(x => x.id));
    await sleep(200);
    const evO = dsO.events.filter(e => e.ev === 'doc' && e.data.coll === 'planes' && e.data.op === 'delete').map(e => e.data.id);
    const evT = dsT.events.filter(e => e.ev === 'doc' && e.data.coll === 'planes' && e.data.op === 'delete').map(e => e.data.id);
    t('borrar plan: el borrado llega en vivo a la oficina y al técnico (una vez por plan)', ['pbaja', 'phist', 'pdel'].every(id => evO.filter(x => x === id).length === 1 && evT.filter(x => x === id).length === 1), [evO, evT]);
    t('borrar plan: ningún intento rechazado se anunció', !dsO.events.some(e => e.ev === 'doc' && e.data.coll === 'planes' && e.data.id === 'p1'), dsO.events.length);
    dsO.close(); dsT.close();

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
    t('copia completa descargable', r.s === 200 && r.j.docs.length >= 4 && r.j.users.length === 4, r.j && [r.j.docs && r.j.docs.length, r.j.users && r.j.users.length]);
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
