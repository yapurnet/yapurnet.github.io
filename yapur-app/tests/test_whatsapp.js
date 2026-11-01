'use strict';
/* Recibo por WhatsApp: cuando un técnico cobra en la calle, el servidor le manda el recibo al cliente con la API de WhatsApp (acá, un servidor de mentira).
   Se prueba qué se manda, a quién, qué queda anotado en el cobro, los reintentos, los permisos y que la clave nunca salga del servidor. */
const { start } = require('./harness');
const { mock } = require('./wa_mock');
let BASE = '', okN = 0, failN = 0;
const t = (name, cond, extra) => { if (cond) { okN++; console.log('ok   ' + name); } else { failN++; console.log('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); } };
async function call(method, p, body, token) {
  const r = await fetch(BASE + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) { /* sin cuerpo */ }
  return { s: r.status, j };
}
const until = async (fn, ms) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > (ms || 8000)) return null; await new Promise(r => setTimeout(r, 80)); } };
const CODE = 'TEST-CODE-1234-ABCD', TOKEN = 'TOKEN-DE-PRUEBA-XYZ', PHONE_ID = '123456789012345';
const HOY = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10), PG = HOY.slice(0, 4) + '-s07', DMY = HOY.slice(8) + '/' + HOY.slice(5, 7) + '/' + HOY.slice(0, 4);

async function usuarios() {
  let r = await call('POST', '/api/setup', { codigo: CODE, usuario: 'mauro', clave: 'claveSegura1', nombre: 'Mauro' });
  const A = r.j.token;
  await call('POST', '/api/users', { usuario: 'pedro', nombre: 'Pedro', role: 'tecnico', clave: 'pedro123', permisos: { cobrarCampo: true } }, A);
  await call('POST', '/api/users', { usuario: 'laura', nombre: 'Laura', role: 'oficina', clave: 'laura123' }, A);
  const tok = async (u, c) => (await call('POST', '/api/login', { usuario: u, clave: c })).j.token;
  return { A, T: await tok('pedro', 'pedro123'), O: await tok('laura', 'laura123') };
}
let n = 0;
const cobro = async (tok, cid, o) => {
  const id = 'w' + (++n), recibo = 'RW' + n + 'X';
  const r = await call('PATCH', '/api/doc/pagos/' + PG, { data: { items: { [id]: Object.assign({ c: cid, concepto: 'instalacion', monto: 65000, fecha: HOY, hora: '10:00', recibo, metodo: 'efectivo' }, o || {}) } } }, tok);
  return { id, recibo, r };
};
const waDe = async (A, id, pred) => {
  let w = null;
  await until(async () => { const r = await call('GET', '/api/doc/pagos/' + PG, undefined, A); const it = r.j && r.j.data && r.j.data.items && r.j.data.items[id]; w = it ? it.wa : null; return w && (!pred || pred(w)); });
  return w;
};

async function sinConfigurar() {
  const w = await start({ code: CODE });
  BASE = w.base;
  try {
    const { A, T, O } = await usuarios();
    await call('PATCH', '/api/doc/clientes/c01', { data: { items: { ana: { nombre: 'Ana Paz', tel: '3844 56-2605', estado: 'pendiente' } } } }, A);
    const c = await cobro(T, 'ana');
    t('sin configurar: el técnico cobra igual', c.r.s === 200, c.r);
    await new Promise(r => setTimeout(r, 400));
    let r = await call('GET', '/api/doc/pagos/' + PG, undefined, A);
    t('sin configurar: el cobro no lleva ningún aviso de WhatsApp', r.j.data.items[c.id] && !('wa' in r.j.data.items[c.id]), r.j.data.items[c.id]);
    r = await call('GET', '/api/whatsapp', undefined, A);
    t('sin configurar: el administrador ve que falta conectarlo', r.s === 200 && r.j.configurado === false && r.j.plantilla === 'recibo_cobro' && r.j.idioma === 'es_AR', r);
    r = await call('GET', '/api/whatsapp', undefined, O);
    t('sin configurar: la oficina no ve la configuración', r.s === 403, r);
    r = await call('GET', '/api/whatsapp', undefined, T);
    t('sin configurar: el técnico tampoco', r.s === 403, r);
    r = await call('POST', '/api/whatsapp/prueba', { tel: '3844 56-2605' }, A);
    t('sin configurar: la prueba avisa que falta conectar', r.s === 409, r);
    r = await call('POST', '/api/recibos/reenviar', { recibo: c.recibo }, O);
    t('sin configurar: reenviar avisa que no está configurado', r.s === 409, r);
    r = await call('PUT', '/api/doc/ajustes/general', { data: { empresa: 'YAPUR.NET', waActivo: true } }, A);
    t('sin configurar: nadie puede declarar «activo» desde afuera', r.s === 200 && r.j.data.waActivo === false, r);
    r = await call('GET', '/api/doc/ajustes/general', undefined, T);
    t('sin configurar: al técnico le llega «no activo»', r.s === 200 && r.j.data.waActivo === false, r.j);
  } finally { await w.stop(); }
}

let kn = 0;
async function cli(A) {   /* un cliente nuevo con su propio teléfono: el aviso automático tiene tope diario por número */
  const id = 'k' + (++kn);
  await call('PATCH', '/api/doc/clientes/c01', { data: { items: { [id]: { nombre: 'Ana Ester Paz Gómez', tel: '3844 5' + String(10000 + kn), estado: 'pendiente' } } } }, A);
  return id;
}
async function configurado() {
  const mk = mock(TOKEN); await mk.start();
  const w = await start({ code: CODE, vars: { WA_TOKEN: TOKEN, WA_PHONE_ID: PHONE_ID, WA_API: mk.url, WA_RETRY_MS: '40' } });
  BASE = w.base;
  try {
    const { A, T, O } = await usuarios();
    await call('PATCH', '/api/doc/clientes/c01', { data: { items: {
      ana: { nombre: 'Ana Ester Paz Gómez', tel: '3844 56-2605', estado: 'pendiente' },
      sin: { nombre: 'Sin Teléfono', estado: 'pendiente' },
      mal: { nombre: 'Mal Teléfono', tel: '12345', estado: 'pendiente' },
      dos: { nombre: 'Dos Teléfonos', tel: 'no tiene', tel2: '(03844) 11-2233', estado: 'pendiente' },
      cap: { nombre: 'Cupo Diario', tel: '3844 99-0000', estado: 'pendiente' },
      bar: { nombre: 'Barra\nSalto  Doble', tel: '+54 9 3844 77-1234', estado: 'pendiente' }
    } } }, A);

    let r = await call('GET', '/api/whatsapp', undefined, A);
    t('conectado: el administrador lo ve activo', r.s === 200 && r.j.configurado === true && r.j.auto === true && r.j.hoy === 0, r);
    const todo = JSON.stringify([r.j, (await call('GET', '/api/doc/ajustes/general', undefined, A)).j, (await call('GET', '/api/doc/ajustes/general', undefined, T)).j, (await call('GET', '/api/me', undefined, T)).j]);
    t('la clave y el identificador del número no salen del servidor', !todo.includes(TOKEN) && !todo.includes(PHONE_ID), todo.slice(0, 300));
    r = await call('GET', '/api/doc/ajustes/general', undefined, T);
    t('conectado: al técnico le llega «activo» para saber que el recibo sale solo', r.s === 200 && r.j.data.waActivo === true, r.j);

    /* --- el caso normal --- */
    mk.clear();
    let c = await cobro(T, 'ana');
    t('el técnico cobra y la respuesta no espera a WhatsApp', c.r.s === 200 && c.r.j.data === null, c.r);
    let wa = await waDe(A, c.id, x => x.e === 'enviado');
    t('el cobro queda «enviado» con el número de mensaje de WhatsApp', wa && wa.e === 'enviado' && /^wamid\.TEST\d+$/.test(wa.id) && wa.tel === '5493844562605' && wa.err === null && wa.n === 1, wa);
    t('se hizo un solo pedido a WhatsApp', mk.reqs.length === 1, mk.reqs.length);
    const q = mk.reqs[0] || {}, b = q.body || {}, ps = ((((b.template || {}).components || [])[0]) || {}).parameters || [];
    t('va a la dirección del número de WhatsApp de la empresa, con la clave en el encabezado', q.method === 'POST' && q.url === '/v23.0/' + PHONE_ID + '/messages' && q.auth === 'Bearer ' + TOKEN, q);
    t('manda una plantilla (type=template) al número de Argentina con 549', b.messaging_product === 'whatsapp' && b.type === 'template' && b.to === '5493844562605', b);
    t('la plantilla es «recibo_cobro» en es_AR', b.template && b.template.name === 'recibo_cobro' && b.template.language.code === 'es_AR', b.template);
    t('los 5 datos: nombre (3 palabras), monto, concepto, número de recibo y fecha', ps.length === 5 && ps.every(p => p.type === 'text') && ps.map(p => p.text).join('|') === ['Ana Ester Paz', '$ 65.000', 'Instalación', c.recibo, DMY].join('|'), ps);
    r = await call('GET', '/api/mis-cobros', undefined, T);
    t('el técnico, en «Mis cobros», ve que el recibo salió', r.s === 200 && r.j.docs.some(d => d.data.items[c.id] && d.data.items[c.id].wa && d.data.items[c.id].wa.e === 'enviado'), r.j);
    r = await call('GET', '/api/doc/pagos/' + PG, undefined, T);
    t('el técnico sigue sin poder leer la caja', r.s === 200 && r.j.exists === false, r);
    r = await call('GET', '/api/doc/pagos/' + PG, undefined, O);
    t('la oficina ve el cobro del técnico con su aviso de WhatsApp', r.s === 200 && r.j.data.items[c.id].porNombre === 'Pedro' && r.j.data.items[c.id].wa.e === 'enviado', r.j.data && r.j.data.items[c.id]);

    /* --- datos del cliente --- */
    mk.clear();
    c = await cobro(T, 'sin');
    wa = await waDe(A, c.id, x => x.e !== 'pendiente');
    t('cliente sin teléfono: queda «sin_tel» y no se manda nada', wa && wa.e === 'sin_tel' && /no tiene teléfono/.test(wa.err) && mk.reqs.length === 0, [wa, mk.reqs.length]);
    c = await cobro(T, 'mal');
    wa = await waDe(A, c.id, x => x.e !== 'pendiente');
    t('teléfono que no sirve: «sin_tel» con el motivo', wa && wa.e === 'sin_tel' && /no sirve/.test(wa.err) && mk.reqs.length === 0, [wa, mk.reqs.length]);
    c = await cobro(T, 'dos');
    wa = await waDe(A, c.id, x => x.e !== 'pendiente');
    t('si el primer teléfono no sirve usa el segundo (sin el 0 de la característica)', wa && wa.e === 'enviado' && wa.tel === '5493844112233' && mk.reqs.length === 1 && mk.reqs[0].body.to === '5493844112233', [wa, mk.reqs.length]);
    mk.clear();
    c = await cobro(T, 'bar');
    wa = await waDe(A, c.id, x => x.e !== 'pendiente');
    const pn = (mk.reqs[0] && mk.reqs[0].body.template.components[0].parameters) || [];
    t('el nombre va sin saltos de línea ni espacios dobles (WhatsApp los rechaza) y +54 9 se entiende', wa && wa.e === 'enviado' && wa.tel === '5493844771234' && pn[0] && pn[0].text === 'Barra Salto Doble', [wa, pn[0]]);
    mk.clear();
    c = await cobro(T, 'sin', { wa: { e: 'enviado', id: 'wamid.FALSO', ts: 1 } });
    wa = await waDe(A, c.id, x => x.e !== 'pendiente');
    t('un «enviado» falso mandado por el técnico se descarta: manda el servidor', wa && wa.e === 'sin_tel' && wa.id === null, wa);

    /* --- conceptos --- */
    mk.clear();
    c = await cobro(T, await cli(A), { concepto: 'reclamo', monto: 8000 });
    wa = await waDe(A, c.id, x => x.e === 'enviado');
    const pc = (mk.reqs[0] && mk.reqs[0].body.template.components[0].parameters.map(p => p.text)) || [];
    t('un reclamo sale con su concepto y su monto', wa && wa.e === 'enviado' && pc[1] === '$ 8.000' && pc[2] === 'Reclamo o visita técnica', pc);

    /* --- fallas de WhatsApp --- */
    mk.clear(); mk.set('e400');
    c = await cobro(T, await cli(A), { monto: 65000 });
    wa = await waDe(A, c.id, x => x.e !== 'pendiente');
    t('si WhatsApp lo rechaza (número no permitido) queda «error» con el motivo y sin reintentos', wa && wa.e === 'error' && /131030/.test(wa.err) && /not in allowed list/.test(wa.err) && wa.n === 1 && mk.reqs.length === 1, [wa, mk.reqs.length]);
    const falla1 = c;
    mk.clear(); mk.set('flaky2');
    c = await cobro(T, await cli(A));
    wa = await waDe(A, c.id, x => x.e !== 'pendiente');
    t('si WhatsApp falla dos veces y después anda, se reintenta solo y sale', wa && wa.e === 'enviado' && wa.n === 3 && mk.reqs.length === 3, [wa, mk.reqs.length]);
    mk.clear(); mk.set('e500');
    c = await cobro(T, 'dos');
    wa = await waDe(A, c.id, x => x.e !== 'pendiente');
    t('si falla siempre: tres intentos y queda «error»', wa && wa.e === 'error' && wa.n === 3 && mk.reqs.length === 3, [wa, mk.reqs.length]);
    const falla2 = c;
    mk.clear(); mk.set('token');
    c = await cobro(T, 'bar');
    wa = await waDe(A, c.id, x => x.e !== 'pendiente');
    t('si el error de WhatsApp repite la clave, no se guarda ni se le muestra a nadie', wa && wa.e === 'error' && /190/.test(wa.err) && !JSON.stringify(wa).includes(TOKEN), wa);

    /* --- reenviar --- */
    mk.clear(); mk.set('ok');
    r = await call('POST', '/api/recibos/reenviar', { recibo: falla1.recibo }, O);
    t('la oficina reintenta un recibo que había fallado y sale', r.s === 200 && r.j.ok === true && r.j.wa.e === 'enviado' && mk.reqs.length === 1, r);
    wa = await waDe(A, falla1.id, x => x.e === 'enviado');
    t('y el cobro queda «enviado»', wa && wa.e === 'enviado', wa);
    r = await call('POST', '/api/recibos/reenviar', { recibo: falla1.recibo }, T);
    t('el técnico no puede reenviar', r.s === 403, r);
    r = await call('POST', '/api/recibos/reenviar', { recibo: falla1.recibo });
    t('sin sesión tampoco', r.s === 401, r);
    r = await call('POST', '/api/recibos/reenviar', { recibo: 'NOEXISTE9' }, O);
    t('un recibo que no existe: 404', r.s === 404, r);
    r = await call('POST', '/api/recibos/reenviar', { recibo: '"; DROP' }, O);
    t('un número de recibo con caracteres raros se rechaza', r.s === 404, r);
    mk.clear();
    r = await call('POST', '/api/recibos/reenviar', { todos: true }, O);
    t('«reintentar todos»: toma solo los que fallaron, no los «enviados» ni los «sin teléfono»', r.s === 200 && r.j.ok === true && r.j.intentados === 2 && r.j.enviados === 2 && mk.reqs.length === 2, r.j);
    wa = await waDe(A, falla2.id, x => x.e === 'enviado');
    t('el que fallaba siempre sale ahora', wa && wa.e === 'enviado', wa);

    /* --- recibo anulado --- */
    c = await cobro(T, await cli(A));
    await waDe(A, c.id, x => x.e === 'enviado');
    r = await call('PATCH', '/api/doc/pagos/' + PG, { data: { items: { [c.id]: { anulado: true, anuladoMotivo: 'error de carga' } } } }, A);
    t('el administrador anula el recibo', r.s === 200, r);
    mk.clear();
    r = await call('POST', '/api/recibos/reenviar', { recibo: c.recibo }, O);
    t('un recibo anulado no se reenvía', r.s === 200 && r.j.ok === false && /anulado/.test(r.j.wa.err) && mk.reqs.length === 0, r);

    /* --- topes --- */
    mk.clear();
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push(await cobro(T, 'cap'));
    const was = [];
    for (const x of ids) was.push(await waDe(A, x.id, y => y.e !== 'pendiente'));
    t('tope diario por número: los primeros 3 salen y el cuarto no', was.slice(0, 3).every(x => x && x.e === 'enviado') && was[3] && was[3].e === 'error' && /máximo/.test(was[3].err) && mk.reqs.length === 3, was.map(x => x && x.e));

    /* --- quién dispara el aviso --- */
    mk.clear();
    c = await cobro(O, 'ana', { monto: 12345 });
    await new Promise(r => setTimeout(r, 500));
    r = await call('GET', '/api/doc/pagos/' + PG, undefined, A);
    t('un cobro de la oficina no manda nada solo', c.r.s === 200 && !('wa' in r.j.data.items[c.id]) && mk.reqs.length === 0, [r.j.data.items[c.id], mk.reqs.length]);
    c = await cobro(A, 'ana', { monto: 100 });
    await new Promise(r2 => setTimeout(r2, 300));
    r = await call('GET', '/api/doc/pagos/' + PG, undefined, A);
    t('ni uno del administrador', !('wa' in r.j.data.items[c.id]) && mk.reqs.length === 0, mk.reqs.length);
    r = await call('PATCH', '/api/doc/pagos/' + PG, { data: { items: { [falla2.id]: { wa: { e: 'enviado' } } } } }, A);
    t('nadie puede cambiar a mano el aviso de un cobro ya registrado', r.s === 403, r);
    r = await call('PATCH', '/api/doc/pagos/' + PG, { data: { items: { [falla2.id]: { wa: { e: 'enviado' } } } } }, O);
    t('ni la oficina', r.s === 403, r);

    /* --- apagarlo --- */
    r = await call('PUT', '/api/doc/ajustes/general', { data: { empresa: 'YAPUR.NET', waAuto: false } }, A);
    t('el administrador apaga el envío automático', r.s === 200 && r.j.data.waAuto === false && r.j.data.waActivo === false, r);
    r = await call('GET', '/api/whatsapp', undefined, A);
    t('el estado dice conectado pero apagado', r.j.configurado === true && r.j.auto === false, r.j);
    mk.clear();
    c = await cobro(T, 'ana');
    await new Promise(r2 => setTimeout(r2, 500));
    r = await call('GET', '/api/doc/pagos/' + PG, undefined, A);
    t('apagado: el técnico cobra y no se manda nada', c.r.s === 200 && !('wa' in r.j.data.items[c.id]) && mk.reqs.length === 0, [r.j.data.items[c.id], mk.reqs.length]);
    r = await call('POST', '/api/recibos/reenviar', { recibo: c.recibo }, O);
    t('apagado: la oficina igual puede mandarlo a mano desde el recibo', r.s === 200 && r.j.ok === true && mk.reqs.length === 1, r);
    r = await call('PUT', '/api/doc/ajustes/general', { data: { empresa: 'YAPUR.NET' } }, A);
    t('una pantalla vieja que guarda otros ajustes lo vuelve a encender (no trae el interruptor)', r.s === 200 && r.j.data.waActivo === true, r);

    /* --- prueba --- */
    mk.clear();
    r = await call('POST', '/api/whatsapp/prueba', { tel: '3844 56-2605' }, A);
    const pp = (mk.reqs[0] && mk.reqs[0].body.template.components[0].parameters.map(p => p.text)) || [];
    t('la prueba manda la plantilla con datos de ejemplo', r.s === 200 && r.j.ok === true && mk.reqs[0].body.to === '5493844562605' && pp.join('|') === ['Prueba', '$ 1', 'Mensaje de prueba', 'R-PRUEBA', DMY].join('|'), [r.j, pp]);
    r = await call('POST', '/api/whatsapp/prueba', { tel: '12' }, A);
    t('la prueba con un número que no sirve: 400', r.s === 400, r);
    r = await call('POST', '/api/whatsapp/prueba', { tel: '3844 56-2605' }, O);
    t('la oficina no puede mandar pruebas', r.s === 403, r);
    mk.set('e400');
    r = await call('POST', '/api/whatsapp/prueba', { tel: '3844 56-2605' }, A);
    t('si WhatsApp la rechaza, el administrador ve el motivo', r.s === 422 && /131030/.test(r.j.error), r);
  } finally { await w.stop(); await mk.stop(); }
}

(async () => {
  await sinConfigurar();
  await configurado();
  console.log('\n' + okN + ' ok, ' + failN + ' con fallas');
  process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
