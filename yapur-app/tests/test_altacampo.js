'use strict';
/* Alta de clientes de instalaciones ocasionales en la calle: el técnico da de alta a un abonado «por instalar» (sin facturación)
   y la orden de instalación a su nombre; no puede dar de alta clientes activos ni cargar planes o precios. */
const fs = require('fs'), path = require('path'), os = require('os');
const { start } = require('./harness');
let BASE = '', okN = 0, failN = 0;
const t = (name, cond, extra) => { if (cond) { okN++; console.log('ok   ' + name); } else { failN++; console.log('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 300) : '')); } };
async function call(method, p, body, token) {
  const r = await fetch(BASE + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) { /* sin cuerpo */ }
  return { s: r.status, j };
}
(async () => {
  const code = 'TEST-CODE-1234-ABCD', dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yapur-alta-'));
  const srv = await start({ code, dir, vars: { DISP_APROBAR: '0' } });
  BASE = srv.base;
  try {
    let r = await call('POST', '/api/setup', { codigo: code, usuario: 'mauro', clave: 'claveSegura1', nombre: 'Mauro' });
    const A = r.j.token;
    await call('POST', '/api/users', { usuario: 'tec1', nombre: 'Pedro', role: 'tecnico', clave: 'pedro1' }, A);
    await call('POST', '/api/users', { usuario: 'tec2', nombre: 'Sin alta', role: 'tecnico', clave: 'pedro2', permisos: { altaCampo: false } }, A);
    const T = (await call('POST', '/api/login', { usuario: 'tec1', clave: 'pedro1' })).j.token;
    const T2 = (await call('POST', '/api/login', { usuario: 'tec2', clave: 'pedro2' })).j.token;
    r = await call('GET', '/api/me', undefined, T);
    t('el técnico trae por defecto el permiso de alta en la calle', r.j.me.perms.altaCampo === true && r.j.me.perms.editarClientes === false, r.j.me && r.j.me.perms);
    const nuevo = { nombre: 'Rosa Paz', dir: 'Calle 9 N° 123', loc: 'Añatuya', tel: '3844123456', ref: 'Portón verde', lat: -28.46, lng: -62.83, tec: 'fibra', estado: 'pendiente', creado: Date.now(), mod: Date.now() };
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cN1: nuevo } } }, T);
    t('el técnico da de alta un cliente «por instalar»', r.s === 200, r);
    r = await call('PATCH', '/api/doc/ordenes/2026-11', { data: { items: { oN1: { estado: 'pendiente', creado: '2026-11-11', mod: Date.now(), clientId: 'cN1', tipo: 'instalacion', tecnico: 'x', fecha: '2026-11-11', prioridad: 'normal', notas: 'Instalación ocasional' } } } }, T);
    t('y crea la orden de instalación a su nombre', r.s === 200, r);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cN2: Object.assign({}, nuevo, { estado: 'activo' }) } } }, T);
    t('no puede darlo de alta como activo', r.s >= 400, r);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cN3: Object.assign({}, nuevo, { precio: 1 }) } } }, T);
    t('no puede cargar precios al darlo de alta', r.s >= 400, r);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cN4: Object.assign({}, nuevo, { planId: 'p1' }) } } }, T);
    t('el plan (con el permiso de elegir plan) sí se puede indicar', r.s === 200, r);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cN5: Object.assign({}, nuevo, { sinCargo: true }) } } }, T);
    t('no puede marcarlo «sin cargo»', r.s >= 400, r);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cN6: nuevo } } }, T2);
    t('sin el permiso no puede dar de alta', r.s >= 400, r);
    r = await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cN1: { precio: 5 } } } }, T);
    t('sobre el cliente ya creado sigue sin poder cambiar la facturación', r.s >= 400, r);
    /* fichas parecidas: pista al dar de alta (una misma persona puede tener varias conexiones) */
    await call('PATCH', '/api/doc/clientes/c01', { data: { items: { cX: { nombre: 'Pachilla María Carolina', dni: '27-23373806-4', dir: 'Centro 1', loc: 'Añatuya', estado: 'activo' } } } }, A);
    r = await call('POST', '/api/clientes/parecidos', { nombre: 'carolina pachilla', dni: '23373806', dir: 'Otra calle 5' }, T);
    t('el técnico ve que ya hay una ficha con ese nombre y documento (sin DNI ni id)', r.s === 200 && r.j.lista.length === 1 && r.j.lista[0].why.includes('dni') && r.j.lista[0].why.includes('nombre') && r.j.lista[0].id === null && !JSON.stringify(r.j).includes('23373806'), r.j);
    r = await call('POST', '/api/clientes/parecidos', { nombre: 'Pachilla Maria', dni: '', dir: 'centro 1' }, A);
    t('el administrador recibe el id para poder juntarlas en una cuenta', r.s === 200 && r.j.lista.length === 1 && /^cX$/.test(r.j.lista[0].id), r.j);
    r = await call('POST', '/api/clientes/parecidos', { nombre: 'Juan Gomez', dni: '11111111', dir: 'Nada 1' }, T);
    t('sin coincidencias, lista vacía', r.s === 200 && r.j.lista.length === 0, r.j);
    r = await call('POST', '/api/clientes/parecidos', { nombre: 'Juan Gomez' }, T2);
    t('sin el permiso de alta no se puede consultar', r.s === 403, r);
    r = await call('GET', '/api/doc/clientes/c01', undefined, A);
    t('la oficina ve el cliente por instalar', r.j.data.items.cN1 && r.j.data.items.cN1.estado === 'pendiente' && !r.j.data.items.cN2 && !r.j.data.items.cN3, r.j.data && Object.keys(r.j.data.items));
  } catch (e) { failN++; console.log('FAIL excepción', e); }
  finally { await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); console.log(`\n${okN} ok, ${failN} con fallas`); process.exit(failN ? 1 : 0); }
})();
