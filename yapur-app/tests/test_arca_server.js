'use strict';
/* Factura ARCA de punta a punta contra un ARCA de mentira: configuración, certificado, acceso, emisión B y A, nota de crédito y permisos. */
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), { execFileSync } = require('child_process');
const { start } = require('./harness');
const { mockArca } = require('./arca_mock');
let BASE = '', okN = 0, failN = 0;
const t = (name, cond, extra) => { if (cond) { okN++; console.log('ok   ' + name); } else { failN++; console.log('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 400) : '')); } };
async function call(method, p, body, token) {
  const r = await fetch(BASE + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) { /* sin cuerpo */ }
  return { s: r.status, j };
}
const sh = (args, o) => execFileSync('openssl', args, Object.assign({ encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }, o));
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
(async () => {
  const code = 'TEST-CODE-1234-ABCD', dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yapur-arca-'));
  const M = mockArca(dir, dir + '/cert.pem'), log = M.log;
  const mockUrl = await M.start();
  const srv = await start({ code, dir, vars: { DISP_APROBAR: '0', ARCA_MOCK: mockUrl } });
  BASE = srv.base;
  try {
    let r = await call('POST', '/api/setup', { codigo: code, usuario: 'mauro', clave: 'claveSegura1', nombre: 'Mauro' });
    const A = r.j.token;
    await call('POST', '/api/users', { usuario: 'cobra', nombre: 'Brenda', role: 'oficina', clave: 'brenda12' }, A);
    await call('POST', '/api/users', { usuario: 'tec', nombre: 'Pedro', role: 'tecnico', clave: 'pedro12' }, A);
    const O = (await call('POST', '/api/login', { usuario: 'cobra', clave: 'brenda12' })).j.token;
    const T = (await call('POST', '/api/login', { usuario: 'tec', clave: 'pedro12' })).j.token;
    r = await call('GET', '/api/arca', undefined, T);
    t('un técnico no ve la configuración de ARCA', r.s === 403, r.s);
    r = await call('GET', '/api/arca', undefined, O);
    t('tampoco la oficina: solo el administrador', r.s === 403, r.s);
    r = await call('POST', '/api/arca/clave', {}, A);
    t('sin CUIT cargado no se puede crear el pedido de certificado', r.s === 400, r);
    await call('PUT', '/api/doc/ajustes/general', { data: { recibo: { leyenda: 'YAPUR.NET', razon: 'YAPUR Miguel Matias', cuit: '20325478307', iibb: '20325478307', dom: 'Lavalle 157' } } }, A);
    r = await call('POST', '/api/arca/clave', {}, A);
    t('el administrador genera el pedido de certificado', r.s === 200 && /BEGIN CERTIFICATE REQUEST/.test(r.j.csr) && r.j.tieneClave && !r.j.tieneCert, r);
    t('la clave privada nunca viaja en la respuesta', !JSON.stringify(r.j).includes('priv') && !/PRIVATE/.test(JSON.stringify(r.j)));
    const csr = r.j.csr;
    r = await call('POST', '/api/arca/clave', {}, A);
    t('no pisa una clave existente sin confirmar', r.s === 409, r.s);
    fs.writeFileSync(dir + '/req.csr', csr);
    t('el pedido lleva el CUIT del emisor', /serialNumber\s*=\s*CUIT 20325478307/.test(sh(['req', '-in', dir + '/req.csr', '-noout', '-text'])));
    /* ARCA firma el pedido con su propia autoridad: acá, una autoridad de prueba */
    sh(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', dir + '/ca.key', '-out', dir + '/ca.pem', '-subj', '/CN=AC Prueba', '-days', '30']);
    sh(['x509', '-req', '-in', dir + '/req.csr', '-CA', dir + '/ca.pem', '-CAkey', dir + '/ca.key', '-CAcreateserial', '-out', dir + '/cert.pem', '-days', '730']);
    const pem = fs.readFileSync(dir + '/cert.pem', 'utf8');
    r = await call('POST', '/api/arca/certificado', { pem: 'esto no es un certificado' }, A);
    t('rechaza un certificado ilegible', r.s === 400, r);
    sh(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', dir + '/otra.key', '-out', dir + '/otro.pem', '-subj', '/CN=otro', '-days', '30']);
    r = await call('POST', '/api/arca/certificado', { pem: fs.readFileSync(dir + '/otro.pem', 'utf8') }, A);
    t('rechaza un certificado que no es el de este pedido', r.s === 400 && /no corresponde/.test(r.j.error || r.j.message || JSON.stringify(r.j)), r);
    r = await call('POST', '/api/arca/certificado', { pem }, A);
    t('acepta el certificado de ARCA', r.s === 200 && r.j.tieneCert && /^\d{4}-\d{2}-\d{2}$/.test(r.j.certHasta), r);
    r = await call('PUT', '/api/arca', { pv: 3, amb: 'homo' }, A);
    t('guarda el punto de venta', r.s === 200 && r.j.pv === 3 && r.j.listo === true, r);
    r = await call('POST', '/api/arca/probar', {}, A);
    t('la prueba de conexión firma bien el acceso y encuentra el punto de venta', r.s === 200 && r.j.puntos && r.j.puntos[0].nro === 3 && log.wsaa === 1 && /loginTicketRequest/.test(log.cms), r);
    /* datos */
    const hoy = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10), mes = hoy.slice(0, 7);
    await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cA: { nombre: 'Ana Alonso', estado: 'activo', dni: '30123456' }, cE: { nombre: 'Distribuidora Sur SRL', estado: 'activo', dni: '30712345678' } } } }, A);
    await call('PATCH', '/api/doc/pagos/' + mes + '-s01', { data: { items: {
      p1: { c: 'cA', concepto: 'mensualidad', per: mes, monto: 12100, fecha: hoy, hora: '10:00', recibo: 'R-1', metodo: 'efectivo' },
      p2: { c: 'cE', concepto: 'mensualidad', per: mes, monto: 24200, fecha: hoy, hora: '11:00', recibo: 'R-2', metodo: 'efectivo' },
      p3: { c: 'cA', concepto: 'mensualidad', per: mes, monto: 5000, fecha: hoy, hora: '12:00', recibo: 'R-3', metodo: 'efectivo', anulado: true },
      p4: { c: 'cA', concepto: 'otro', monto: 3000, fecha: hoy, hora: '12:30', recibo: 'R-4', metodo: 'efectivo' },
      p5: { c: 'cA', concepto: 'otro', monto: 2000, fecha: hoy, hora: '12:30', recibo: 'R-4', metodo: 'transferencia' },
    } } }, A);
    const em = (u, b, tk) => call('POST', '/api/arca/emitir', Object.assign({ doc: mes + '-s01' }, b), tk);
    r = await em(0, { recibo: 'R-1' }, T);
    t('un técnico no puede emitir facturas', r.s === 403, r.s);
    r = await em(0, { recibo: 'R-1' }, O);
    t('la oficina emite una factura B a un consumidor final con DNI', r.s === 200 && r.j.fe.tipo === 6 && r.j.fe.nro === 1 && r.j.fe.docTipo === 96 && /^7\d{13}$/.test(r.j.fe.cae), r);
    t('el IVA se discrimina: 12.100 = 10.000 + 2.100', r.j.fe.neto === 10000 && r.j.fe.iva === 2100 && r.j.fe.total === 12100, r.j && r.j.fe);
    const pedido = log.fe.filter(x => x.name === 'FECAESolicitar').pop().b;
    t('ARCA recibe el servicio del mes, el receptor y la alícuota del 21 %', pedido.includes('<ar:Concepto>2</ar:Concepto>') && pedido.includes('<ar:DocTipo>96</ar:DocTipo>') && pedido.includes('<ar:Id>5</ar:Id>') && pedido.includes('<ar:CondicionIVAReceptorId>5<') && pedido.includes('<ar:FchServDesde>' + mes.replace('-', '') + '01<'), pedido);
    r = await em(0, { recibo: 'R-1' }, O);
    t('no se factura dos veces el mismo recibo', r.s === 409, r);
    r = await em(0, { recibo: 'R-2', tipo: 1 }, O);
    t('a otro responsable inscripto (CUIT) sale Factura A', r.s === 200 && r.j.fe.tipo === 1 && r.j.fe.nro === 1 && r.j.fe.docTipo === 80 && r.j.fe.neto === 20000, r);
    r = await em(0, { recibo: 'R-2' }, O);
    r = await em(0, { recibo: 'R-4' }, O);
    t('un recibo con dos medios de pago sale en una sola factura por el total', r.s === 200 && r.j.fe.total === 5000 && r.j.fe.nro === 2 && r.j.fe.tipo === 6, r);
    r = await em(0, { recibo: 'R-3' }, O);
    t('un recibo anulado no se factura', r.s === 409, r);
    M.est.modo = 'rechazo';
    await call('PATCH', '/api/doc/pagos/' + mes + '-s01', { data: { items: { p6: { c: 'cA', concepto: 'otro', monto: 800, fecha: hoy, hora: '13:00', recibo: 'R-5', metodo: 'efectivo' } } } }, A);
    r = await em(0, { recibo: 'R-5' }, O);
    t('si ARCA rechaza, el error se explica y el recibo queda sin factura', r.s === 422 && /Documento inválido/.test(JSON.stringify(r.j)), r);
    M.est.modo = 'ok';
    r = await em(0, { recibo: 'R-5' }, O);
    t('después se puede volver a intentar', r.s === 200 && r.j.fe.nro === 3, r);
    r = await em(0, { recibo: 'R-1', nc: true }, O);
    t('la nota de crédito anula la factura con el mismo importe', r.s === 200 && r.j.fe.nc && r.j.fe.nc.tipo === 8 && r.j.fe.nc.total === 12100 && r.j.fe.nc.nro === 1, r);
    const ncReq = log.fe.filter(x => x.name === 'FECAESolicitar').pop().b;
    t('y queda asociada a la factura original', ncReq.includes('<ar:CbteAsoc><ar:Tipo>6</ar:Tipo><ar:PtoVta>3</ar:PtoVta><ar:Nro>1</ar:Nro>'), ncReq);
    r = await em(0, { recibo: 'R-1', nc: true }, O);
    t('no se hace dos veces la nota de crédito', r.s === 409, r.s);
    /* los clientes no pueden fabricar facturas */
    r = await call('PATCH', '/api/doc/pagos/' + mes + '-s01', { data: { items: { p9: { c: 'cA', concepto: 'otro', monto: 100, fecha: hoy, hora: '14:00', recibo: 'R-9', metodo: 'efectivo', fe: { cae: '70000000000001', nro: 99 } } } } }, A);
    t('nadie puede cargar una factura a mano en un pago nuevo', r.s === 403, r.s);
    r = await call('PATCH', '/api/doc/pagos/' + mes + '-s01', { data: { items: { p1: { fe: { cae: '1' } } } } }, A);
    t('ni cambiarla en un pago existente', r.s === 403, r.s);
    r = await call('GET', '/api/doc/pagos/' + mes + '-s01', undefined, O);
    t('la factura viaja con el pago para que la vean las pantallas', JSON.stringify(r.j).includes('"cae"'), r.s);
    t('el permiso de acceso se pidió una sola vez (se reutiliza 12 horas)', log.wsaa === 1, log.wsaa);
  } finally { if (failN && process.env.VERLOG) console.log(srv.log().split('\n').filter(l => /rror|arca/i.test(l)).slice(-12).join('\n')); await srv.stop(); await M.stop(); }
  console.log('\n' + okN + ' ok, ' + failN + ' con fallas');
  process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
