'use strict';
/* Equipos en comodato y contrato firmado: permisos, plantilla, firma, titularidad en revisión, papelera, copia de seguridad y registro. */
const fs = require('fs'), path = require('path'), os = require('os'), zlib = require('zlib');
const { start } = require('./harness');
let BASE = '', okN = 0, failN = 0;
const t = (name, cond, extra) => { if (cond) { okN++; console.log('ok   ' + name); } else { failN++; console.log('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 600) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function call(method, p, body, token) {
  const r = await fetch(BASE + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { s: r.status, j };
}
/* conexión en vivo como la usa la app: WebSocket (el servidor se duerme mientras nadie hace nada). Devuelve los mensajes ya separados en {ev,data}. */
async function openStream(token, ticket) {
  const tk = ticket || (await call('POST', '/api/ticket', {}, token)).j.t;
  const events = [];
  const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/api/stream?t=' + tk);
  let status = 0;
  ws.addEventListener('message', m => { if (m.data === 'pong') { events.pong = (events.pong || 0) + 1; return; } try { const j = JSON.parse(m.data); events.push({ ev: j.e, data: j.d }); } catch (e) {} });
  ws.addEventListener('close', () => { events.closed = true; });
  await new Promise(res => { ws.addEventListener('open', () => { status = 200; res(); }); ws.addEventListener('error', () => res()); ws.addEventListener('close', () => res()); });
  return { events, status, ws, close: () => { try { ws.close(); } catch (e) {} } };
}
/* una firma de mentira: un PNG de verdad (con ruido para que no sea mínimo) */
function crc32(b) { let c, crc = ~0; for (let n = 0; n < b.length; n++) { c = (crc ^ b[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function firmaPng(seed) {
  const w = 120, h = 50, raw = Buffer.alloc((w * 3 + 1) * h); let x = seed || 7;
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let i = 0; i < w * 3; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; raw[y * (w * 3 + 1) + 1 + i] = (x >> 16) & 0xff; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return 'data:image/png;base64,' + png.toString('base64');
}
const TITULAR = { nombre: 'Rosa Graciela Cejas', dni: '20.111.222', dir: 'Calle 9 N° 123', loc: 'Añatuya', tel: '3844123456' };
const EQUIPOS = [{ t: 'ONU', d: 'Huawei HG8145V5', s: '48575443AABBCCDD', n: 1, e: 'nuevo', o: '' }, { t: 'Router Wi-Fi', d: 'TP-Link Archer C6', s: '', n: 1, e: 'usado', o: 'con caja' }];
const DNI_TXT = '20.111.222';

(async () => {
  const code = 'TEST-CODE-1234-ABCD', dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yapur-comodato-'));
  const srv = await start({ code, dir });
  BASE = srv.base;
  try {
    let r = await call('POST', '/api/setup', { codigo: code, usuario: 'mauro', clave: 'claveSegura1', nombre: 'Mauro' });
    const A = r.j.token;
    for (const [u, rol, c] of [['ofi', 'oficina', 'laura1'], ['tec1', 'tecnico', 'pedro1'], ['tec2', 'tecnico', 'marcos1']]) await call('POST', '/api/users', { usuario: u, nombre: u, role: rol, clave: c }, A);
    const login = async (u, c) => (await call('POST', '/api/login', { usuario: u, clave: c })).j.token;
    const O = await login('ofi', 'laura1'), T1 = await login('tec1', 'pedro1'), T2 = await login('tec2', 'marcos1');
    const users = (await call('GET', '/api/users', undefined, A)).j.users, tec2 = users.find(u => u.usuario === 'tec2');
    r = await call('PATCH', '/api/users/' + tec2.id, { permisos: { comodato: false } }, A);
    t('el administrador le apaga el comodato a un técnico', r.s === 200 && r.j.user.perms.comodato === false, r);
    const me = async tk => (await call('GET', '/api/me', undefined, tk)).j.me.perms;
    const pT = await me(T1), pO = await me(O), pA = await me(A);
    t('por defecto el técnico carga equipos y hace firmar, pero no gestiona contratos', pT.comodato === true && pT.contratosGestion === false, pT);
    t('la oficina y el administrador sí los gestionan', pO.comodato && pO.contratosGestion && pA.comodato && pA.contratosGestion);

    /* ---- equipos en comodato en la ficha del cliente ---- */
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cA: { nombre: 'Cejas Rosa', codigo: '77', dir: 'Calle 9 N° 123', loc: 'Añatuya', tel: '3844123456', estado: 'activo' }, cB: { nombre: 'Otro Cliente', estado: 'activo' } } } }, O);
    t('(preparación) clientes cargados', r.s === 200, r);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cA: { comodato: EQUIPOS } } } }, T1);
    t('el técnico carga los equipos en comodato del cliente', r.s === 200 && r.j.data.items.cA.comodato.length === 2, r);
    r = await call('GET', '/api/doc/clientes/c01', undefined, T1);
    t('y los ve', r.j.data.items.cA.comodato[0].d === 'Huawei HG8145V5' && r.j.data.items.cA.nombre === 'Cejas Rosa', r.j.data.items.cA);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cA: { comodato: [{ t: 'ONU', d: 'x', n: 0 }] } } } }, T1);
    t('una lista mal formada se rechaza (cantidad 0)', r.s === 403 && /equipos/i.test(r.j.error), r);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cA: { comodato: [{ t: 'ONU', n: 1, planId: 'p1' }] } } } }, T1);
    t('y la que trae campos de más', r.s === 403, r);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cA: { comodato: Array.from({ length: 31 }, () => ({ t: 'ONU', n: 1 })) } } } }, T1);
    t('y la que tiene demasiados equipos', r.s === 403, r);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cA: { comodato: [{ t: 'ONU', d: 'y'.repeat(81), n: 1 }] } } } }, T1);
    t('y un texto demasiado largo', r.s === 403, r);
    r = await call('GET', '/api/doc/clientes/c01', undefined, T2);
    t('sin el permiso de comodato no le llega la lista de equipos', r.s === 200 && r.j.data.items.cA && !('comodato' in r.j.data.items.cA), r.j.data.items.cA);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cA: { comodato: [] } } } }, T2);
    t('ni puede cambiarla', r.s === 403 && /comodato/i.test(r.j.error), r);
    r = await call('GET', '/api/contratos', undefined, T2);
    t('ni ver contratos', r.s === 403, r);

    /* ---- migrar un cliente de antena a fibra: el técnico cambia la tecnología y las IP, y queda un historial que no se puede tocar ---- */
    const cl = async () => (await call('GET', '/api/doc/clientes/c01', undefined, O)).j.data.items.cB;
    const M1 = { f: '2026-11-11', ts: 1, de: 'wireless', a: 'fibra', ipAnt: '10.20.43.9', ip: '192.168.100.4', nodoAnt: 'Torre Leo', eqAnt: 'AA:BB', ret: [{ t: 'Antena', d: 'CPE Ubiquiti LiteBeam Gen2', s: '24:A4:3C:01:02:AB' }], por: 'inventado', obs: 'se retiró la antena' };
    await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cB: { tec: 'wireless', ip: '10.20.43.9', nodo: 'Torre Leo', equipo: 'AA:BB' } } } }, O);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cB: { tec: 'fibra', ip: '192.168.100.4', nodo: '', equipo: '2C:3A:E8:11:AA:BB', migraciones: [M1] } } } }, T1);
    t('el técnico migra al cliente: cambia la tecnología y la IP y anota el historial', r.s === 200 && r.j.data.items.cB.tec === 'fibra' && r.j.data.items.cB.ip === '192.168.100.4' && r.j.data.items.cB.migraciones.length === 1, r);
    let cb = await cl();
    t('el servidor anota quién lo hizo y la hora (no lo que mande el celular)', cb.migraciones[0].por === 'tec1' && Math.abs(cb.migraciones[0].ts - Date.now()) < 60e3 && cb.migraciones[0].ipAnt === '10.20.43.9' && cb.migraciones[0].ip === '192.168.100.4' && cb.migraciones[0].ret[0].s === '24:A4:3C:01:02:AB', cb.migraciones);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cB: { migraciones: [Object.assign({}, cb.migraciones[0], { ipAnt: '1.1.1.1' })] } } } }, T1);
    t('un técnico no puede cambiar un renglón del historial', r.s === 403 && /no se puede modificar/.test(r.j.error), r);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cB: { migraciones: [] } } } }, T1);
    t('ni borrar el historial', r.s === 403, r);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cB: { migraciones: [cb.migraciones[0], Object.assign({}, M1, { inventado: 1 })] } } } }, T1);
    t('ni agregar un renglón con campos de más', r.s === 403 && /historial/.test(r.j.error), r);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cB: { migraciones: [cb.migraciones[0], Object.assign({}, M1, { f: 'ayer' })] } } } }, T1);
    t('ni con una fecha que no es fecha', r.s === 403, r);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cB: { migraciones: [cb.migraciones[0], Object.assign({}, M1, { a: 'fibra', de: 'fibra' })] } } } }, T1);
    t('ni una migración de una tecnología a la misma', r.s === 403, r);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cB: { migraciones: [cb.migraciones[0], Object.assign({}, M1, { ip: 'x'.repeat(81) })] } } } }, T1);
    t('ni con textos demasiado largos', r.s === 403, r);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cB: { nombre: 'Otro Cliente', migraciones: cb.migraciones } } } }, O);
    t('guardar de nuevo la ficha con el mismo historial no molesta', r.s === 200 && (await cl()).migraciones.length === 1, r);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cB: { migraciones: [cb.migraciones[0], Object.assign({}, M1, { de: 'fibra', a: 'wireless', ts: 5, por: 'otro' })] } } } }, O);
    cb = await cl();
    t('la oficina puede sumar otro renglón (vuelta a antena) y queda con su nombre y la hora del servidor', r.s === 200 && cb.migraciones.length === 2 && cb.migraciones[1].por === 'ofi' && cb.migraciones[1].ts > 1e12 && cb.migraciones[0].por === 'tec1', cb.migraciones);

    /* ---- mudanza a un lugar sin fibra: de fibra a antena, con el domicilio nuevo anotado en el historial ---- */
    const M2 = { f: '2026-11-12', ts: 1, de: 'fibra', a: 'wireless', ipAnt: '192.168.100.4', ip: '10.20.43.9', dom: 'Calle 12 N° 450, Añatuya', domAnt: 'Calle 9 N° 123, Añatuya', ret: [{ t: 'ONU', d: 'Huawei HG8145V5', s: '2C:3A:E8:11:AA:BB' }], por: 'inventado' };
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cB: { tec: 'wireless', ip: '10.20.43.9', dir: 'Calle 12 N° 450', nap: null, napPuerto: null, lat: -28.46, lng: -62.83, migraciones: cb.migraciones.concat([M2]) } } } }, T1);
    cb = await cl();
    t('el técnico pasa al cliente a antena y anota el domicilio nuevo en el historial', r.s === 200 && cb.tec === 'wireless' && cb.dir === 'Calle 12 N° 450' && cb.migraciones.length === 3 && cb.migraciones[2].dom === 'Calle 12 N° 450, Añatuya' && cb.migraciones[2].domAnt === 'Calle 9 N° 123, Añatuya' && cb.migraciones[2].de === 'fibra' && cb.migraciones[2].por === 'tec1', r);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cB: { migraciones: cb.migraciones.concat([Object.assign({}, M2, { de: 'wireless', a: 'fibra', dom: 'x'.repeat(161) })]) } } } }, T1);
    t('un domicilio demasiado largo en el historial se rechaza', r.s === 403 && /historial/.test(r.j.error), r);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cB: { migraciones: cb.migraciones.concat([Object.assign({}, M2, { de: 'wireless', a: 'fibra', dom: 7 })]) } } } }, T1);
    t('ni uno que no es texto', r.s === 403, r);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cB: { migraciones: cb.migraciones.slice(0, 2).concat([Object.assign({}, cb.migraciones[2], { dom: 'Otra calle 1' })]) } } } }, T1);
    t('y un domicilio ya anotado no se puede cambiar', r.s === 403 && /no se puede modificar/.test(r.j.error), r);

    /* ---- modelos de equipos que el técnico elige de una lista (así solo escribe la MAC) ---- */
    r = await call('GET', '/api/comodato/modelos', undefined, T1);
    const modDef = (r.j.modelos || []).map(m => m.t + '|' + m.d);
    t('de arranque la lista trae la ONU Huawei, la antena LiteBeam, el inyector PoE y la fuente de la ONU', r.s === 200 && same(modDef, ['ONU|Huawei HG8145V5', 'Antena|CPE Ubiquiti LiteBeam Gen2', 'Fuente o adaptador|Inyector de corriente PoE', 'Fuente o adaptador|Fuente de corriente de la ONU']) && r.j.tipos.includes('ONU'), r.j);
    r = await call('GET', '/api/comodato/modelos', undefined, T2);
    t('un técnico sin permiso de comodato no la pide', r.s === 403, r);
    r = await call('PUT', '/api/comodato/modelos', { modelos: [{ t: 'ONU', d: 'ZTE F670L' }] }, T1);
    t('un técnico no puede cambiarla', r.s === 403, r);
    r = await call('PUT', '/api/comodato/modelos', { modelos: [{ t: 'ONU', d: 'ZTE F670L' }] }, O);
    t('ni la oficina (solo el administrador)', r.s === 403, r);
    r = await call('PUT', '/api/comodato/modelos', { modelos: 'x' }, A);
    t('una lista mal formada se rechaza', r.s === 400, r);
    r = await call('PUT', '/api/comodato/modelos', { modelos: [{ t: 'ONU', d: 'Huawei HG8145V5' }, { t: 'ONU', d: '  zte   F670L ' }, { t: 'ONU', d: 'ZTE F670L' }, { t: 'Inventado', d: 'x1234' }, { t: 'ONU', d: 'x' }, { t: 'Antena', d: 'CPE Ubiquiti LiteBeam Gen2' }, 'basura', null] }, A);
    t('el administrador la guarda: se limpian los espacios, los repetidos, los tipos que no existen y los modelos vacíos', r.s === 200 && same(r.j.modelos.map(m => m.t + '|' + m.d), ['ONU|Huawei HG8145V5', 'ONU|zte F670L', 'Antena|CPE Ubiquiti LiteBeam Gen2']) && r.j.modPor === 'Mauro', r.j);
    r = await call('GET', '/api/comodato/modelos', undefined, T1);
    t('el técnico ya ve la lista nueva', r.s === 200 && r.j.modelos.length === 3 && r.j.modelos[1].d === 'zte F670L', r.j);
    r = await call('PUT', '/api/comodato/modelos', { modelos: [] }, A);
    t('el administrador puede dejarla vacía (el técnico escribe el modelo) y no vuelve sola la de arranque', r.s === 200 && r.j.modelos.length === 0, r.j);
    r = await call('GET', '/api/comodato/modelos', undefined, T1);
    t('queda vacía para el técnico', r.s === 200 && r.j.modelos.length === 0, r.j);
    r = await call('PUT', '/api/comodato/modelos', { modelos: [{ t: 'ONU', d: 'Huawei HG8145V5' }, { t: 'ONU', d: 'ZTE F670L' }] }, A);
    t('(se deja una lista para la copia de seguridad)', r.s === 200 && r.j.modelos.length === 2, r.j);

    /* ---- plantilla ---- */
    r = await call('GET', '/api/contrato/plantilla', undefined, T1);
    t('el texto de arranque ya es el definitivo: sin «BORRADOR», versión 1, listo para que los técnicos hagan firmar', r.s === 200 && r.j.final === true && !/BORRADOR/.test(r.j.texto) && r.j.ver === 1 && r.j.vars.includes('equipos'), r.j);
    const TXT = r.j.texto;
    const vars0 = r.j.vars, emp0 = r.j.empresa, sugT1 = r.j.sugerido;
    t('es el contrato completo: sin partes por completar y con la modalidad del cliente', !/\[COMPLETAR/.test(TXT) && /\{\{tecnologia\}\}/.test(TXT) && vars0.includes('tecnologia'), vars0);
    t('trae el ingreso al domicilio para instalar, desinstalar, inspeccionar, mantener y retirar los equipos', /INGRESO AL DOMICILIO, INSTALACIÓN Y RETIRO/.test(TXT) && /AUTORIZA y se obliga a permitir el ingreso/.test(TXT) && /conectar e instalar/.test(TXT) && /inspeccionar, mantener, reparar/.test(TXT) && /desinstalar y retirar los equipos/.test(TXT) && /propietario del inmueble o contar con la autorización/.test(TXT), TXT.slice(0, 200));
    t('y la devolución de los equipos al terminar el servicio', /diez \(10\) días corridos/.test(TXT) && /valor de reposición/.test(TXT));
    t('sin «período mínimo» (el contrato es por tiempo indeterminado y sin cargos por rescindir)', !/período mínimo/i.test(TXT) && /sin invocación de causa/.test(TXT));
    t('la baja la puede pedir el cliente sin preaviso ni mes adelantado, en persona, por teléfono o por WhatsApp, y recibe una constancia', /dar de baja el SERVICIO en cualquier momento y sin invocar causa, sin preaviso/.test(TXT) && /no se le cobra un mes adelantado/.test(TXT) && /en persona en la oficina de YAPUR\.NET, por teléfono, por WhatsApp/.test(TXT) && /constancia con un número de referencia/.test(TXT) && /dentro de las 72 horas/.test(TXT), TXT.slice(TXT.indexOf('III.'), TXT.indexOf('III.') + 900));
    t('la baja se hace efectiva el día del pedido (se pagan los días usados) y no se condiciona al pago de deudas', /efectiva el día del pedido/.test(TXT) && /en proporción al abono mensual/.test(TXT) && /no condiciona la baja al pago previo de deudas/.test(TXT));
    t('ya no exige «hacerse presente» como único medio ni el corte del día 11, y la baja por falta de pago lleva notificación previa', !/haciéndose PRESENTE/i.test(TXT) && !/día 11/.test(TXT) && !/sin necesidad de comunicación previa/.test(TXT) && /previa notificación al CLIENTE/.test(TXT));
    t('los datos de la empresa de los contratos en papel vienen cargados (el papel no llevaba CUIT y el texto tampoco lo pide)', emp0.razon === 'YAPUR MAURO MIGUEL' && /Belgrano/.test(emp0.domicilio) && emp0.cuit === '' && emp0.rep, emp0);
    t('el técnico no recibe el texto sugerido', sugT1 === undefined, sugT1);
    r = await call('GET', '/api/contrato/plantilla', undefined, A);
    t('el administrador sí: lo usa para recargar el texto sugerido si ya había guardado otro', r.s === 200 && r.j.sugerido === TXT, r.s);
    t('el texto no pide el CUIT de la empresa (el contrato en papel no lo llevaba)', !/empresa_cuit/.test(TXT), TXT.slice(0, 300));
    r = await call('PUT', '/api/contrato/plantilla', { texto: TXT, final: false }, O);
    t('solo el administrador cambia el texto del contrato', r.s === 403, r);
    r = await call('PUT', '/api/contrato/plantilla', { texto: 'corto' }, A);
    t('un texto demasiado corto se rechaza', r.s === 400, r);
    r = await call('PUT', '/api/contrato/plantilla', { texto: TXT + ' {{inventado}}' }, A);
    t('un dato que no existe se rechaza y dice cuál', r.s === 400 && /inventado/.test(r.j.error), r);
    r = await call('PUT', '/api/contrato/plantilla', { texto: TXT.replace(/\{\{equipos\}\}/g, '') }, A);
    t('tiene que incluir los equipos', r.s === 400 && /equipos/.test(r.j.error), r);
    r = await call('PUT', '/api/contrato/plantilla', { texto: TXT + '\nCUIT: {{empresa_cuit}}', final: true, empresa: { razon: 'YAPUR.NET', cuit: '', domicilio: 'X', rep: 'Y' } }, A);
    t('si el texto pide el CUIT de la empresa y falta, no se puede marcar como definitivo', r.s === 400 && /CUIT/.test(r.j.error), r);
    /* el administrador lo deja como borrador a propósito (para probar o corregir): mientras tanto los técnicos no firman */
    const BORR = 'BORRADOR PARA REVISAR: texto de prueba.\n\n' + TXT;
    r = await call('PUT', '/api/contrato/plantilla', { texto: BORR, final: true, empresa: { razon: 'YAPUR.NET', cuit: '20-1-1', domicilio: 'X', rep: 'Y' } }, A);
    t('con «BORRADOR» o «[COMPLETAR…]» no se puede marcar como definitivo', r.s === 400 && /BORRADOR|COMPLETAR/.test(r.j.error), r);
    r = await call('PUT', '/api/contrato/plantilla', { texto: BORR, final: false }, A);
    t('el administrador puede dejar el texto como borrador (versión 2)', r.s === 200 && r.j.final === false && r.j.ver === 2 && /BORRADOR/.test(r.j.texto), r.j);

    /* ---- mientras sea borrador, los clientes no firman ---- */
    const vistaBody = (cid, motivo, tit) => ({ cid, motivo, titular: tit || TITULAR });
    r = await call('POST', '/api/contrato/vista', vistaBody('cA', 'alta'), T1);
    t('con el texto en borrador, el técnico no puede hacer firmar', r.s === 409 && /definitivo/.test(r.j.error), r);
    r = await call('POST', '/api/contrato/vista', vistaBody('cA', 'alta'), A);
    t('el administrador sí puede probarlo (sale marcado como prueba)', r.s === 200 && r.j.prueba === true && /BORRADOR/.test(r.j.texto), r.j);
    const vp = r.j;
    t('la modalidad del contrato sale de los equipos si el cliente no tiene la tecnología cargada (una ONU: fibra óptica)', /modalidad tecnológica Fibra óptica «INTERNET CABLEADO»/.test(vp.texto) && /cliente N° 77/.test(vp.texto) && !/\{\{/.test(vp.texto), vp.texto.slice(0, 600));
    t('el contrato armado trae el ingreso al domicilio y los equipos del cliente', /AUTORIZA y se obliga/.test(vp.texto) && /Huawei HG8145V5/.test(vp.texto) && /Rosa Graciela Cejas/.test(vp.texto));
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: {
      cW: { nombre: 'Walter Antena', codigo: '78', dir: 'Calle 1', estado: 'activo', tec: 'wireless', comodato: [{ t: 'Antena', d: 'CPE Ubiquiti LiteBeam Gen2', s: 'AA11', n: 1, e: 'nuevo', o: '' }, { t: 'Fuente o adaptador', d: 'Inyector de corriente PoE', n: 1, e: 'nuevo', o: '' }] },
      cF: { nombre: 'Fabiana Fibra', codigo: '79', dir: 'Calle 2', estado: 'activo', tec: 'fibra', comodato: [{ t: 'Antena', d: 'Antena vieja', s: 'BB22', n: 1, e: 'usado', o: '' }] } } } }, O);
    t('(preparación) un cliente de antena y uno de fibra', r.s === 200, r);
    r = await call('POST', '/api/contrato/vista', vistaBody('cW', 'alta'), A);
    t('cliente de antena: el contrato dice antena inalámbrica y lista el LiteBeam con su inyector PoE', r.s === 200 && /modalidad tecnológica Antena inalámbrica «INTERNET POR ANTENA»/.test(r.j.texto) && /LiteBeam Gen2/.test(r.j.texto) && /Inyector de corriente PoE/.test(r.j.texto) && !/INTERNET CABLEADO/.test(r.j.texto), r.j.texto && r.j.texto.slice(0, 500));
    r = await call('POST', '/api/contrato/vista', vistaBody('cF', 'alta'), A);
    t('si la ficha dice fibra, manda la ficha aunque los equipos digan antena', r.s === 200 && /Fibra óptica «INTERNET CABLEADO»/.test(r.j.texto) && !/INTERNET POR ANTENA/.test(r.j.texto), r.j.texto && r.j.texto.slice(0, 500));
    r = await call('POST', '/api/contrato', { cid: 'cA', motivo: 'alta', titular: TITULAR, firma: firmaPng(1), aclar: 'Rosa Cejas', acepto: true, tver: vp.tver, eq: vp.eq }, A);
    t('la firma de prueba queda guardada como «prueba»', r.s === 200 && r.j.contrato.prueba === true && r.j.contrato.estado === 'vigente' && r.j.contrato.num === 1, r.j);
    const idPrueba = r.j.contrato.id;
    r = await call('POST', '/api/contrato/' + idPrueba + '/borrar', { motivo: 'prueba' }, O);
    t('la oficina manda la prueba a la papelera', r.s === 200 && r.j.contrato.estado === 'borrado', r);

    /* ---- texto definitivo ---- */
    const FINAL = BORR.replace(/^BORRADOR[^\n]*\n\n/, '');   /* vuelve al texto de arranque, sin la línea de borrador */
    r = await call('PUT', '/api/contrato/plantilla', { texto: FINAL, final: true, empresa: { razon: 'YAPUR.NET', cuit: '20-12345678-9', domicilio: 'Calle 1 de Añatuya', rep: 'Mauro Yapur', lugar: 'Añatuya, Santiago del Estero' } }, A);
    t('el administrador carga el texto definitivo', r.s === 200 && r.j.final === true && r.j.ver === 3 && !/BORRADOR/.test(r.j.texto), r.j);
    r = await call('PUT', '/api/contrato/plantilla', { texto: FINAL, final: true, empresa: { razon: 'YAPUR.NET', cuit: '20-12345678-9', domicilio: 'Calle 1 de Añatuya', rep: 'Mauro Yapur', lugar: 'Añatuya, Santiago del Estero' } }, A);
    t('guardar lo mismo no cambia la versión', r.s === 200 && r.j.ver === 3, r.j);

    /* ---- vista previa y firma ---- */
    r = await call('POST', '/api/contrato/vista', vistaBody('cNo', 'alta'), T1);
    t('un cliente que no existe', r.s === 404, r);
    r = await call('POST', '/api/contrato/vista', vistaBody('cB', 'alta'), T1);
    t('sin equipos cargados no se puede hacer el contrato', r.s === 400 && /equipos/i.test(r.j.error), r);
    r = await call('POST', '/api/contrato/vista', vistaBody('cA', 'inventado'), T1);
    t('un motivo inválido', r.s === 400, r);
    r = await call('POST', '/api/contrato/vista', vistaBody('cA', 'alta', Object.assign({}, TITULAR, { nombre: 'A' })), T1);
    t('el nombre del titular es obligatorio', r.s === 400 && /nombre/i.test(r.j.error), r);
    r = await call('POST', '/api/contrato/vista', vistaBody('cA', 'alta', Object.assign({}, TITULAR, { dni: '123' })), T1);
    t('el DNI tiene que ser válido', r.s === 400 && /DNI/.test(r.j.error), r);
    r = await call('POST', '/api/contrato/vista', vistaBody('cA', 'titularidad'), T1);
    t('sin contrato vigente no hay cambio de titularidad', r.s === 409, r);
    r = await call('POST', '/api/contrato/vista', vistaBody('cA', 'alta'), T1);
    const v1 = r.j;
    t('la vista previa arma el texto con el titular, los equipos y la empresa', r.s === 200 && v1.prueba === false && v1.texto.includes('Rosa Graciela Cejas') && v1.texto.includes(DNI_TXT) && v1.texto.includes('1. ONU Huawei HG8145V5') && v1.texto.includes('2. Router Wi-Fi TP-Link Archer C6') && v1.texto.includes('YAPUR.NET, con domicilio en Calle 1 de Añatuya') && v1.texto.includes('Cliente N° 77'.toLowerCase().replace('c', 'c')) === false && /cliente N° 77/.test(v1.texto) && !/\{\{/.test(v1.texto), v1.texto);
    t('el número se asigna recién al firmar', /N° \(se asigna al firmar\)/.test(v1.texto));
    const base = { cid: 'cA', motivo: 'alta', titular: TITULAR, firma: firmaPng(2), aclar: 'Rosa Cejas', acepto: true, tver: v1.tver, eq: v1.eq };
    r = await call('POST', '/api/contrato', Object.assign({}, base, { acepto: false }), T1);
    t('sin aceptar no se firma', r.s === 400 && /acepta/.test(r.j.error), r);
    r = await call('POST', '/api/contrato', Object.assign({}, base, { aclar: '' }), T1);
    t('sin aclaración no se firma', r.s === 400 && /aclaraci/i.test(r.j.error), r);
    r = await call('POST', '/api/contrato', Object.assign({}, base, { firma: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' }), T1);
    t('una firma que no es PNG se rechaza', r.s === 400 && /firma/i.test(r.j.error), r);
    r = await call('POST', '/api/contrato', Object.assign({}, base, { firma: 'data:image/png;base64,' + 'A'.repeat(100000) }), T1);
    t('ni una enorme', r.s === 400, r);
    r = await call('POST', '/api/contrato', Object.assign({}, base, { tver: v1.tver + 1 }), T1);
    t('si el texto cambió mientras tanto, no firma sin volver a leerlo', r.s === 409 && /cambiaron/.test(r.j.error), r);
    r = await call('POST', '/api/contrato', Object.assign({}, base, { eq: 'otra|cosa' }), T1);
    t('ni si cambiaron los equipos', r.s === 409, r);
    const sO = await openStream(O), sT = await openStream(T1);
    await sleep(200);
    r = await call('POST', '/api/contrato', base, T1);
    const k1 = r.j.contrato;
    t('el técnico hace firmar: queda vigente, con número, huella y quién lo tomó', r.s === 200 && k1.estado === 'vigente' && k1.num === 2 && k1.prueba === false && /^[0-9a-f]{64}$/.test(k1.hash) && k1.por === 'tec1' && k1.motivo === 'alta' && k1.firma.startsWith('data:image/png;base64,'), r.j);
    t('el contrato guardado tiene el número y la fecha en el texto', /CONTRATO DE COMODATO Y PRESTACIÓN DE SERVICIO N° 0002/.test(k1.texto) && /a \d+ de [a-z]+ de \d{4}/.test(k1.texto), k1.texto.slice(0, 300));
    t('el técnico no ve el DNI: ni en el texto ni en los datos del titular', !k1.texto.includes(DNI_TXT) && k1.titular.dni === '••••••••' && k1.texto.includes('••••••••') && !('ip' in k1) && !('log' in k1) && !('tit' in k1), k1.titular);
    await sleep(300);
    const evO = sO.events.filter(e => e.ev === 'contrato' && e.data.id === k1.id), evT = sT.events.filter(e => e.ev === 'contrato' && e.data.id === k1.id);
    t('la oficina y el técnico se enteran en vivo; el nombre del titular solo le llega a la oficina', evO.length === 1 && evT.length === 1 && evO[0].data.tit === 'Rosa Graciela Cejas' && !('tit' in evT[0].data) && evT[0].data.eq === k1.eq, [evO, evT]);
    r = await call('GET', '/api/contrato/' + k1.id, undefined, O);
    const dO = r.j.contrato;
    t('la oficina lo ve completo: DNI, IP, equipo desde el que se firmó y el registro', dO.texto.includes(DNI_TXT) && dO.titular.dni === '20111222' && typeof dO.ip === 'string' && /node|undici|Mozilla|curl|^$/i.test(dO.ua || 'node') && dO.log.length === 1 && dO.log[0].acc === 'firmado' && dO.log[0].uname === 'tec1', dO);
    r = await call('GET', '/api/contrato/' + k1.id, undefined, A);
    t('y el administrador', r.s === 200 && r.j.contrato.texto.includes(DNI_TXT));
    r = await call('GET', '/api/contrato/' + k1.id, undefined, T2);
    t('quien no tiene el permiso no lo abre', r.s === 403, r);
    r = await call('POST', '/api/contrato', base, T1);
    t('no se puede volver a firmar el alta de un cliente con contrato vigente', r.s === 409 && /Cambio de titularidad/.test(r.j.error), r);

    /* ---- la lista ---- */
    r = await call('GET', '/api/contratos?cid=cA', undefined, T1);
    t('el técnico ve que el cliente tiene su contrato vigente (sin el nombre del titular)', r.s === 200 && r.j.contratos.length === 1 && r.j.contratos[0].id === k1.id && r.j.contratos[0].estado === 'vigente' && !('tit' in r.j.contratos[0]) && r.j.contratos[0].eq === k1.eq, r.j);
    r = await call('GET', '/api/contratos', undefined, O);
    t('la oficina ve todos (y el titular)', r.s === 200 && r.j.contratos.length === 1 && r.j.contratos[0].tit === 'Rosa Graciela Cejas', r.j);
    r = await call('GET', '/api/contratos?papelera=1', undefined, T1);
    t('la papelera es solo de la oficina', r.s === 403, r);
    r = await call('GET', '/api/contratos?papelera=1', undefined, O);
    t('la oficina ve la prueba en la papelera', r.s === 200 && r.j.contratos.length === 1 && r.j.contratos[0].id === idPrueba && r.j.contratos[0].estado === 'borrado', r.j);

    /* ---- cambio de titularidad: nuevo contrato firmado, en revisión ---- */
    const NUEVO = { nombre: 'Juan Carlos Díaz', dni: '30111222', dir: 'Calle 9 N° 123', loc: 'Añatuya', tel: '3844999999' };
    r = await call('POST', '/api/contrato/vista', vistaBody('cA', 'titularidad', NUEVO), T1);
    const v2 = r.j;
    t('la vista previa del cambio de titularidad', r.s === 200 && v2.texto.includes('Juan Carlos Díaz') && v2.texto.includes('30.111.222'), v2.texto && v2.texto.slice(0, 200));
    r = await call('POST', '/api/contrato', { cid: 'cA', motivo: 'titularidad', titular: NUEVO, firma: firmaPng(3), aclar: 'Juan Díaz', acepto: true, tver: v2.tver, eq: v2.eq }, T1);
    const k2 = r.j.contrato;
    t('el nuevo contrato firmado queda EN REVISIÓN y el anterior sigue vigente', r.s === 200 && k2.estado === 'revision' && k2.prev === k1.id && k2.num === 3, r.j);
    r = await call('GET', '/api/contratos?cid=cA', undefined, T1);
    t('mientras se revisa, el cliente tiene un vigente y uno en revisión', r.j.contratos.map(c => c.estado).join() === 'vigente,revision', r.j);
    r = await call('POST', '/api/contrato', { cid: 'cA', motivo: 'titularidad', titular: NUEVO, firma: firmaPng(4), aclar: 'Juan Díaz', acepto: true, tver: v2.tver, eq: v2.eq }, T1);
    t('no se puede abrir otro cambio mientras uno espera revisión', r.s === 409 && /esperando/.test(r.j.error), r);
    r = await call('POST', '/api/contrato/' + k2.id + '/aprobar', {}, T1);
    t('el técnico NO aprueba ni archiva', r.s === 403, r);
    r = await call('POST', '/api/contrato/' + k2.id + '/rechazar', { motivo: 'no es' }, T1);
    t('ni rechaza', r.s === 403, r);
    r = await call('POST', '/api/contrato/' + k1.id + '/aprobar', {}, O);
    t('no se aprueba un contrato que no está en revisión', r.s === 409, r);
    r = await call('POST', '/api/contrato/' + k2.id + '/aprobar', { motivo: 'Documentación a la vista' }, O);
    t('la oficina aprueba: el nuevo pasa a vigente', r.s === 200 && r.j.contrato.estado === 'vigente', r.j);
    r = await call('GET', '/api/contratos?cid=cA', undefined, O);
    t('y el anterior queda archivado (no se borra)', r.j.contratos.map(c => c.estado).join() === 'archivado,vigente', r.j);
    r = await call('GET', '/api/contrato/' + k1.id, undefined, O);
    t('el registro del anterior dice que lo reemplazó el nuevo', r.j.contrato.log.some(l => l.acc === 'archivado' && /0003/.test(l.det)), r.j.contrato.log);
    r = await call('GET', '/api/contrato/' + k2.id, undefined, O);
    t('el registro del nuevo: firmado y aprobado, con quién y la nota', r.j.contrato.log.map(l => l.acc).join() === 'firmado,aprobado' && r.j.contrato.log[1].uname === 'ofi' && /Documentación/.test(r.j.contrato.log[1].det) && r.j.contrato.prevResumen.id === k1.id, r.j.contrato.log);
    await sleep(300);
    t('las pantallas abiertas se enteraron del archivado', evUlt(sT.events, k1.id).estado === 'archivado' && evUlt(sO.events, k2.id).estado === 'vigente', sT.events.filter(e => e.ev === 'contrato').map(e => e.data.id + ':' + e.data.estado));
    function evUlt(evs, id) { const l = evs.filter(e => e.ev === 'contrato' && e.data.id === id); return l.length ? l[l.length - 1].data : {}; }

    /* ---- cambio de equipos: la lista nueva no coincide con la del contrato ---- */
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cA: { comodato: EQUIPOS.concat([{ t: 'Antena', d: 'LiteBeam', s: '', n: 1, e: 'usado', o: '' }]) } } } }, T1);
    r = await call('GET', '/api/contratos?cid=cA', undefined, T1);
    const vig = r.j.contratos.find(c => c.estado === 'vigente');
    t('si cambian los equipos, el contrato vigente ya no coincide (la app lo avisa comparando)', r.s === 200 && vig.id === k2.id && vig.eq !== '' && !vig.eq.includes('litebeam'), vig);

    /* ---- rechazar ---- */
    r = await call('POST', '/api/contrato/vista', vistaBody('cA', 'equipos', NUEVO), T1);
    const v3 = r.j;
    r = await call('POST', '/api/contrato', { cid: 'cA', motivo: 'equipos', titular: NUEVO, firma: firmaPng(5), aclar: 'Juan Díaz', acepto: true, tver: v3.tver, eq: v3.eq }, T1);
    const k3 = r.j.contrato;
    t('un cambio de equipos también queda en revisión', r.s === 200 && k3.estado === 'revision' && k3.motivo === 'equipos' && k3.texto.includes('LiteBeam'), r.j);
    r = await call('POST', '/api/contrato/' + k3.id + '/rechazar', {}, O);
    t('rechazar pide el motivo', r.s === 400, r);
    r = await call('POST', '/api/contrato/' + k3.id + '/rechazar', { motivo: 'Faltó firmar la hoja de equipos' }, O);
    t('la oficina lo rechaza', r.s === 200 && r.j.contrato.estado === 'rechazado', r.j);
    r = await call('GET', '/api/contratos?cid=cA', undefined, O);
    t('el vigente sigue siendo el de Juan Díaz', r.j.contratos.filter(c => c.estado === 'vigente').length === 1 && r.j.contratos.find(c => c.estado === 'vigente').id === k2.id);

    /* ---- borrar: solo oficina y administrador, a la papelera, y se puede restaurar ---- */
    r = await call('POST', '/api/contrato/' + k3.id + '/borrar', { motivo: 'error de carga' }, T1);
    t('el técnico NO puede borrar un contrato', r.s === 403, r);
    r = await call('POST', '/api/contrato/' + k3.id + '/borrar', {}, O);
    t('borrar pide el motivo', r.s === 400, r);
    r = await call('POST', '/api/contrato/' + k2.id + '/borrar', { motivo: 'Lo firmó la persona equivocada' }, O);
    t('la oficina lo manda a la papelera', r.s === 200 && r.j.contrato.estado === 'borrado' && r.j.contrato.estadoPrev === 'vigente', r.j);
    r = await call('GET', '/api/contrato/' + k2.id, undefined, T1);
    t('el técnico ya no lo ve', r.s === 404, r);
    r = await call('GET', '/api/contratos?cid=cA', undefined, T1);
    t('ni en la lista del cliente', !r.j.contratos.some(c => c.id === k2.id), r.j);
    r = await call('POST', '/api/contrato/' + k2.id + '/borrar', { motivo: 'otra vez' }, O);
    t('no se borra dos veces', r.s === 409, r);
    r = await call('POST', '/api/contrato/' + k2.id + '/restaurar', {}, T1);
    t('el técnico no restaura', r.s === 403, r);
    r = await call('POST', '/api/contrato/' + k2.id + '/restaurar', {}, A);
    t('el administrador lo restaura y vuelve como vigente', r.s === 200 && r.j.contrato.estado === 'vigente', r.j);
    r = await call('GET', '/api/contrato/' + k2.id, undefined, O);
    t('el registro guarda todo: firmado, aprobado, borrado, restaurado', r.j.contrato.log.map(l => l.acc).join() === 'firmado,aprobado,borrado,restaurado' && /equivocada/.test(r.j.contrato.log[2].det), r.j.contrato.log);
    r = await call('POST', '/api/contrato/' + k2.id + '/verificar', {}, O);
    t('la verificación dice que está íntegro', r.s === 200 && r.j.ok === true, r);
    r = await call('POST', '/api/contrato/' + k2.id + '/verificar', {}, T1);
    t('verificar es de la oficina', r.s === 403, r);

    /* ---- varios a la vez: solo uno gana ---- */
    await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cC: { nombre: 'Carrera', estado: 'activo', comodato: [{ t: 'ONU', d: 'Z', n: 1, e: 'nuevo' }] } } } }, O);
    r = await call('POST', '/api/contrato/vista', vistaBody('cC', 'alta'), T1);
    const vc = r.j;
    const cuerpo = n => ({ cid: 'cC', motivo: 'alta', titular: TITULAR, firma: firmaPng(10 + n), aclar: 'Carrera', acepto: true, tver: vc.tver, eq: vc.eq });
    const rs = await Promise.all([call('POST', '/api/contrato', cuerpo(1), T1), call('POST', '/api/contrato', cuerpo(2), O), call('POST', '/api/contrato', cuerpo(3), A)]);
    t('tres firmas del mismo cliente a la vez: solo una se guarda', rs.filter(x => x.s === 200).length === 1 && rs.filter(x => x.s === 409).length === 2, rs.map(x => x.s));
    r = await call('GET', '/api/contratos?cid=cC', undefined, O);
    t('y el cliente queda con un solo contrato', r.j.contratos.length === 1);
    r = await call('GET', '/api/contratos', undefined, O);
    const nums = r.j.contratos.map(c => c.num);
    t('los números no se repiten', new Set(nums).size === nums.length, nums);

    /* ---- copia de seguridad: lleva los contratos, y al restaurar no se pierde ninguno ---- */
    r = await call('GET', '/api/backup', undefined, A);
    const bk = r.j;
    t('la copia completa incluye los contratos firmados, su registro y el texto del contrato', r.s === 200 && bk.contratos.length === 5 && bk.contratos.every(c => c.firma.startsWith('data:image/png') && /^[0-9a-f]{64}$/.test(c.hash)) && bk.contratos_log.length >= 9 && bk.contrato_tpl && bk.contrato_tpl.final === true && bk.comodato_modelos && bk.comodato_modelos.lista.length === 2, bk.contratos && bk.contratos.length);
    const hechoDespues = await call('POST', '/api/contrato/' + k3.id + '/borrar', { motivo: 'después de la copia' }, O);
    t('(después de la copia se manda a la papelera el rechazado)', hechoDespues.s === 200 && hechoDespues.j.contrato.estado === 'borrado', hechoDespues.j);
    const malo = Object.assign({}, bk.contratos[0], { id: 'k' + 'a'.repeat(16), num: 99, hash: 'f'.repeat(64), estado: 'archivado' });
    const bk2 = Object.assign({}, bk, { contratos: bk.contratos.concat([malo, { id: 'kzz', num: 100 }]) });
    r = await call('POST', '/api/restore', bk2, A);
    t('restaurar una copia funciona', r.s === 200, r);
    const A2 = await login('mauro', 'claveSegura1');
    r = await call('GET', '/api/contratos', undefined, A2);
    t('restaurar suma el contrato que faltaba y descarta el roto, sin tocar los demás', r.s === 200 && r.j.contratos.length === 4 && r.j.contratos.some(c => c.id === malo.id), r.j.contratos && r.j.contratos.map(c => c.id + ':' + c.estado));
    t('un contrato que se firmó después de la copia sigue ahí y con su estado actual', r.j.contratos.find(c => c.id === k2.id).estado === 'vigente');
    r = await call('GET', '/api/contratos?papelera=1', undefined, A2);
    t('la papelera sigue como estaba (la copia tenía al rechazado, pero se lo borró después y se respeta)', r.j.contratos.some(c => c.id === idPrueba) && r.j.contratos.some(c => c.id === k3.id), r.j.contratos.map(c => c.id + ':' + c.estado));
    r = await call('POST', '/api/contrato/' + malo.id + '/verificar', {}, A2);
    t('la verificación detecta un contrato cuyo contenido no coincide con su código', r.s === 200 && r.j.ok === false, r);
    r = await call('GET', '/api/contrato/plantilla', undefined, A2);
    t('el texto del contrato se conserva', r.s === 200 && r.j.final === true && r.j.ver === 3, r.j);
    r = await call('GET', '/api/comodato/modelos', undefined, A2);
    t('los modelos de equipos se conservan al restaurar', r.s === 200 && r.j.modelos.length === 2 && r.j.modelos[1].d === 'ZTE F670L', r.j);
    sO.close(); sT.close();
    t('sin errores en el registro del servidor', !/Uncaught|\bERROR\b|✘/.test(srv.log()), srv.log().split('\n').filter(l => /Uncaught|ERROR|✘/.test(l)).slice(0, 5));
  } catch (e) {
    failN++; console.log('FAIL excepción', e);
  } finally {
    await srv.stop();
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`\n${okN} ok, ${failN} con fallas`);
    if (failN) console.log('--- log del servidor ---\n' + srv.log().slice(-3000));
    process.exit(failN ? 1 : 0);
  }
})();
