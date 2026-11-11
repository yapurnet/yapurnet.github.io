const fs=require('fs'),vm=require('vm');
const dir=__dirname+'/../app/src/';
const src=['p04_core.js','p05_clients.js','p05c_comodato.js','p05b_red.js','p06_plans_settings.js','p06b_import.js','p06d_routers.js','p07_orders.js','p07d_instal.js','p08_pay.js'].map(f=>fs.readFileSync(dir+f,'utf8')).join('\n');
const test=`
const out=[];const t=(n,ok,x)=>out.push((ok?'ok   ':'FAIL ')+n+(ok?'':' -> '+JSON.stringify(x)));
// coordenadas
let g=parseCoords('-27.7345, -62.4678');t('coords simples',g&&g.lat===-27.7345&&g.lng===-62.4678&&!g.fixed,g);
g=parseCoords('27.7345, 62.4678');t('coords sin signo se corrigen',g&&g.lat===-27.7345&&g.lng===-62.4678&&g.fixed,g);
g=parseCoords('https://www.google.com/maps/place/Anatuya/@-28.4600,-62.8300,15z/data=x');t('link @',g&&g.lat===-28.46&&g.lng===-62.83,g);
g=parseCoords('https://maps.google.com/?q=-27.7345,-62.4678');t('link q=',g&&g.lat===-27.7345,g);
g=parseCoords('https://www.google.com/maps/search/?api=1&query=-27.7,-62.4');t('link query=',g&&g.lat===-27.7,g);
g=parseCoords('-27,7345 -62,4678');t('coma decimal con espacio',g&&g.lat===-27.7345&&g.lng===-62.4678,g);
g=parseCoords('40.4168, -3.7038');t('fuera de Argentina marcado',g&&g.outside,g);
t('texto invalido',parseCoords('hola')===null);
t('link corto no resuelve',parseCoords('https://maps.app.goo.gl/abc123')===null);
g=parseCoords('-62.8300, -28.4600');t('long y lat al revés se acomodan solas',g&&g.lat===-28.46&&g.lng===-62.83&&g.swapped&&!g.outside,g);
g=parseCoords('-27.7345, -62.4678');t('en el orden correcto no marca swapped',g&&!g.swapped,g);
g=parseCoords('-28,4698100, -62,8369850');t('coma decimal como en el «Acerca de» de Maps',g&&Math.abs(g.lat+28.46981)<0.0001&&Math.abs(g.lng+62.836985)<0.0001,g);
g=parseCoords('28°28′11.3″S 62°50′13.2″W');t('grados, minutos y segundos',g&&Math.abs(g.lat+28.4698)<0.001&&Math.abs(g.lng+62.837)<0.001,g);
g=parseCoords('https://www.google.com/maps/place/Anatuya/@-28.4600,-62.8300,15z/data=x');t('el link @ sigue andando (no se confunde con coma decimal)',g&&g.lat===-28.46&&g.lng===-62.83,g);
// whatsapp
t('wa numero',waNumber('3844 56-2605')==='5493844562605',waNumber('3844 56-2605'));
t('wa con +54 9',waNumber('+54 9 3844 58-9351')==='5493844589351',waNumber('+54 9 3844 58-9351'));
// facturacion
S.planes.set('p1',{id:'p1',nombre:'Hogar 100',bajada:100,subida:50,precio:20000});
const cur=todayStr().slice(0,7);const m1=addMonths(cur,-2),m2=addMonths(cur,-1);
const c={id:'c1',estado:'activo',planId:'p1',desde:m1,dia:10};
S.pagos.set('a',{id:'a',c:'c1',concepto:'mensualidad',per:m1,monto:20000,fecha:m1+'-05',recibo:'R1'});
S.pagos.set('b',{id:'b',c:'c1',concepto:'mensualidad',per:m2,monto:5000,fecha:m2+'-05',recibo:'R2'});
S.pagos.set('x',{id:'x',c:'c1',concepto:'mensualidad',per:m2,monto:15000,fecha:m2+'-06',recibo:'R3',anulado:true});
rebuildDerived();
let b=billing(c);
const dia=Number(todayStr().slice(8,10));
const curVenc=dia>10;
t('periodos desde',b.periods.length===3,b.periods);
t('mes pagado completo sin deuda',b.periods[0].rest===0,b.periods[0]);
t('pago parcial deja 15000 (anulado no cuenta)',b.periods[1].rest===15000,b.periods[1]);
t('vencidos',b.vencidos===(curVenc?2:1)&&b.deuda===(curVenc?35000:15000),b);
t('mes actual vence dia 10',b.periods[2].venc===curVenc,b.periods[2]);
let bn=billing(c,true);t('con proximo mes suma un periodo',bn.periods.length===4&&bn.vencidos===b.vencidos,bn.periods.length);
t('baja no factura',billing({id:'c2',estado:'baja',planId:'p1'}).periods.length===0);
// «sin cargo» (la casa del dueño, de la familia): sigue activo, pero no se factura ni se corta
{
  const e={id:'sc1',estado:'activo',planId:'p1',desde:m1,dia:10,sinCargo:true,sinCargoMotivo:'Casa de Mauro'},n={id:'sc2',estado:'activo',planId:'p1',desde:m1,dia:10};
  const perms0=S.perms;S.perms=Object.assign({},S.perms,{cobrar:true,caja:true,clientesTodos:true,editarClientes:true});
  const be=billing(e);
  t('sin cargo: no hay meses, ni deuda, ni vencidos (aunque no pagó nada)',be.periods.length===0&&be.vencidos===0&&be.deuda===0&&be.aplica===false&&be.sinCargo===true,be);
  t('sin cargo: el mismo cliente sin la marca sí debe',billing(n).deuda>0&&billing(n).sinCargo===false,billing(n));
  t('sin cargo: no figura para cortar y el control de cortes lo da por «ok»',cutState(e).k==='ok'&&cutState(n).k==='cortar',[cutState(e).k,cutState(n).k]);
  t('sin cargo: no tiene deuda (no se cobra reconexión)',conDeuda(e)===false&&conDeuda(n)===true);
  t('sin cargo: figura «Sin cargo · Al día»',billChip0(e).includes('Sin cargo · Al día')&&!billChip0(e).includes('Debe'),billChip0(e));
  t('sin cargo: una baja con la marca no es «sin cargo»',billing({id:'sc3',estado:'baja',planId:'p1',sinCargo:true}).sinCargo===false);
  t('sin cargo: suspendido por mora tampoco se corta',billing({id:'sc4',estado:'suspendido',planId:'p1',desde:m1,sinCargo:true}).sinCargo===true&&cutState({id:'sc4',estado:'suspendido',planId:'p1',desde:m1,sinCargo:true}).k==='ok');
  S.clientes.set('sc1',e);S.clientes.set('sc2',n);S.billCache.clear();S.cutCache.clear();
  const cd=cortesData();
  t('sin cargo: «A cortar» trae al que debe y no al que no se factura',cd.cortar.some(x=>x.c.id==='sc2')&&!cd.cortar.some(x=>x.c.id==='sc1'),cd.cortar.map(x=>x.c.id));
  t('sin cargo: no es moroso en el cobro (deudaDe en cero)',deudaDe(e).total===0&&deudaDe(n).total>0,[deudaDe(e).total,deudaDe(n).total]);
  S.clientes.delete('sc1');S.clientes.delete('sc2');S.billCache.clear();S.cutCache.clear();S.perms=perms0;
}
// reconexión: solo se cobra si el cliente tiene deuda
t('conDeuda: con un mes vencido sin pagar',conDeuda(c)===true);
t('conDeuda: al día (ni siquiera empezó a pagar)',conDeuda({id:'c5',estado:'activo',planId:'p1',desde:addMonths(cur,1)})===false);
t('conDeuda: con deuda anterior pendiente',conDeuda({id:'c6',estado:'activo',planId:'p1',desde:addMonths(cur,1),deudaAnt:{m:5000,det:'x'}})===true);
t('conDeuda: sin cliente o dado de baja sin deuda',conDeuda(null)===false&&conDeuda({id:'c7',estado:'baja',planId:'p1'})===false);
t('conceptosCobro: la oficina con deuda ve «reconexion»; al día no; el técnico nunca',conceptosCobro(c,false).includes('reconexion')&&!conceptosCobro({id:'c5',estado:'activo',planId:'p1',desde:addMonths(cur,1)},false).includes('reconexion')&&!conceptosCobro(c,true).includes('reconexion'));
t('precio especial manda',priceOf({planId:'p1',precio:15000})===15000&&priceOf({planId:'p1',precio:null})===20000);
// reparto de pagos
let al=allocate([{per:'2026-08',rest:15000},{per:'2026-09',rest:20000}],20000);
t('parcial se aplica al mas viejo',al.length===2&&al[0].monto===15000&&al[1].monto===5000,al);
al=allocate([{per:'2026-08',rest:15000}],18000);t('sobrante al ultimo mes',al.length===1&&al[0].monto===18000,al);
/* pagar deuda: lo que se paga se reparte entre lo adeudado (lo más viejo primero) y los medios de pago, en centavos */
{
  const d={da:2000,meses:[{cid:'a',per:'2026-10',rest:17000,nombre:'X'},{cid:'a',per:'2026-11',rest:17000,nombre:'X'}]};
  const r=repartirDeuda(d,[{metodo:'efectivo',monto:15000},{metodo:'transferencia',monto:4000}]);
  t('pagar deuda: 15.000 efectivo + 4.000 transferencia cancelan la deuda anterior y entran en octubre',r.length===3&&r[0].k==='da'&&r[0].monto===2000&&r[0].metodo==='efectivo'&&r[1].per==='2026-10'&&r[1].monto===13000&&r[1].metodo==='efectivo'&&r[2].per==='2026-10'&&r[2].monto===4000&&r[2].metodo==='transferencia',r);
  t('pagar deuda: la suma de lo repartido es lo que se pagó',r.reduce((s,x)=>s+x.monto,0)===19000);
  const r2=repartirDeuda(d,[{metodo:'efectivo',monto:36000}]);
  t('pagar deuda: pagando todo cancela cada mes con un renglón',r2.length===3&&r2.reduce((s,x)=>s+x.monto,0)===36000&&r2[2].per==='2026-11'&&r2[2].monto===17000,r2);
  const r3=repartirDeuda(d,[{metodo:'efectivo',monto:0.1},{metodo:'otro',monto:0.2}]);
  t('pagar deuda: los centavos no se pierden ni sobran',r3.reduce((s,x)=>Math.round((s+x.monto)*100)/100,0)===0.3&&r3.length===2,r3);
  t('pagar deuda: no reparte más de lo que se debe',repartirDeuda(d,[{metodo:'efectivo',monto:99999}]).reduce((s,x)=>s+x.monto,0)===36000);
  t('pagar deuda: sin monto no hay renglones',repartirDeuda(d,[{metodo:'efectivo',monto:0}]).length===0);
}
// recibo
S.ajustes.empresa='YAPUR.NET';S.clientes.set('c1',{id:'c1',nombre:'Cliente Prueba',codigo:'7'});
S.pagos.set('r1',{id:'r1',c:'c1',concepto:'mensualidad',per:'2026-09',monto:15000,fecha:'2026-10-19',hora:'13:40',recibo:'R261019-ABC',metodo:'efectivo'});
const rt=receiptText('R261019-ABC');t('recibo trae total, cliente y número',rt.includes('IMPORTE TOTAL')&&rt.includes('Cliente Prueba')&&rt.includes('Comp. Nro: R261019-ABC')&&rt.includes('NO VÁLIDO COMO FACTURA'),rt);
t('recibo sin datos de la empresa usa el nombre de la empresa',rt.split('\\n')[0]==='YAPUR.NET'&&!rt.includes('CUIT')&&!rt.includes('Alias'),rt);
S.ajustes.recibo={leyenda:'SOLUCIONES INFORMATICAS',razon:'EMISOR DE PRUEBA',cuit:'20111111112',iibb:'20111111112',dom:'Calle 1 500, Pueblo',tel:'Ana: 3844-000000',web:'www.ejemplo.net',pv:'00004',alias:['mi.alias','otro.alias']};
S.clientes.set('c1',{id:'c1',nombre:'Cliente Prueba',codigo:'7',dni:'30111222',dir:'Lavalle 100',loc:'Pueblo',ciclo:1});
const rt2=receiptText('R261019-ABC'),L2=rt2.split('\\n');
t('recibo con datos: encabezado como el de papel',L2[0]==='SOLUCIONES INFORMATICAS'&&L2[1]==='EMISOR DE PRUEBA'&&rt2.includes('CUIT: 20111111112 / Ingresos Brutos: 20111111112')&&rt2.includes('Calle 1 500, Pueblo')&&rt2.includes('Ana: 3844-000000 / Web: www.ejemplo.net'),rt2);
t('recibo con datos: punto de venta, cliente, condiciones y alias',rt2.includes('Punto de venta: 00004')&&rt2.includes('DNI / CUIT / CUIL: 30111222')&&rt2.includes('Dirección: Lavalle 100, Pueblo')&&rt2.includes('Condición de venta: Contado')&&rt2.includes('Condición frente al IVA: Consumidor Final')&&rt2.includes('Alias: mi.alias')&&rt2.includes('Alias: otro.alias'),rt2);
t('recibo: período facturado del 1 al 1 del mes siguiente y vencimiento el 10 del mes siguiente',rt2.includes('Período facturado: 01/09/2026 al 01/10/2026 · Vto. para el pago: 10/10/2026')&&rt2.includes('Abono Mensual Servicio de Internet (septiembre de 2026)'),rt2);
const rh=receiptHTML(receiptData('R261019-ABC'));
t('recibo HTML: tabla con el servicio, total y alias',rh.includes('Producto / Servicio')&&rh.includes('Importe total')&&rh.includes('Alias: mi.alias')&&!rh.includes('ANULADO'),rh.slice(0,200));
S.clientes.set('c1',{id:'c1',nombre:'Cliente Prueba',codigo:'7',ciclo:2});
t('recibo del ciclo 2: período del 13 al 13 y vencimiento el 20 del mes siguiente',receiptText('R261019-ABC').includes('Período facturado: 13/09/2026 al 13/10/2026 · Vto. para el pago: 20/10/2026'),receiptText('R261019-ABC'));
S.clientes.set('c1',{id:'c1',nombre:'<b>Hack</b> & Cía',codigo:'7'});
t('recibo HTML: escapa lo que viene de los datos',!receiptHTML(receiptData('R261019-ABC')).includes('<b>Hack</b>')&&receiptHTML(receiptData('R261019-ABC')).includes('&lt;b&gt;Hack'));
S.pagos.set('r2',{id:'r2',c:'c1',concepto:'instalacion',nota:'Cable y ficha',monto:10000,fecha:'2026-10-19',hora:'13:50',recibo:'R261019-XYZ',metodo:'transferencia',anulado:true});
const rt3=receiptText('R261019-XYZ');
t('recibo de instalación: sin período, con el medio de pago y anulado',!rt3.includes('Período')&&rt3.includes('Instalación: Cable y ficha')&&rt3.includes('Condición de venta: Transferencia')&&rt3.includes('RECIBO ANULADO')&&receiptHTML(receiptData('R261019-XYZ')).includes('ANULADO'),rt3);
S.ajustes.recibo=null;S.pagos.delete('r2');
// shards
const sh=new Set();for(let i=0;i<2000;i++)sh.add(clientShard(newId()+i));
t('clientes reparten en 16 lotes',sh.size===16,sh.size);
// csv
const rows=parseCsv('\\ufeffcodigo;nombre;direccion;latitud;longitud;plan\\r\\n12;"Pérez, Juan";Lavalle 100;-27,7345;-62,4678;Hogar 100\\r\\n;;sin nombre;;;\\r\\n13;Ana;Belgrano 5;;;Plan X\\r\\n');
t('csv separador ; y comillas',rows.length===4&&rows[1][1]==='Pérez, Juan',rows);
S.clientes.clear();
const a=analyzeImport(rows,{estado:'activo',desde:cur,dia:10});
t('import: 2 validos, 1 sin nombre',a.recs.length===2&&a.sinNombre===1,[a.recs.length,a.sinNombre]);
t('import: plan reconocido y plan faltante',a.recs[0].planId==='p1'&&a.planesFalta.has('Plan X'),[a.recs[0].planId,[...a.planesFalta]]);
t('import: coordenadas con coma decimal',a.recs[0].lat===-27.7345&&a.recs[0].lng===-62.4678,a.recs[0]);
// routers MikroTik: lectura de lo que manda el router
var location={origin:'https://yapur.test'};
t('router: velocidad en M',JSON.stringify(rtRate('20M/10M'))===JSON.stringify({up:20,down:10}),rtRate('20M/10M'));
t('router: velocidad en bps',rtRate('20000000/10000000').up===20&&rtRate('20000000/10000000').down===10,rtRate('20000000/10000000'));
t('router: velocidad en k',rtRate('512k/1M').up===0.512&&rtRate('512k/1M').down===1,rtRate('512k/1M'));
t('router: perfil PPP con ráfaga toma la primera velocidad',rtRate('20M/20M 30M/30M 15M/15M 8s').down===20);
t('router: velocidad vacía o cero no vale',rtRate('')===null&&rtRate('0/0')===null&&rtRate('nil')===null);
t('router: una sola IP vale con o sin /32',rtIpOne('10.0.0.5/32')==='10.0.0.5'&&rtIpOne('10.0.0.5')==='10.0.0.5');
t('router: rangos, listas e IP inválidas no son clientes',rtIpOne('10.0.0.0/24')===''&&rtIpOne('10.0.0.1,10.0.0.2')===''&&rtIpOne('999.1.1.1')===''&&rtIpOne('0.0.0.0')===''&&rtIpOne('')==='');
S.planes.set('p20',{id:'p20',nombre:'Hogar 20',bajada:20,subida:20,precio:12000});
S.clientes.clear();
S.clientes.set('k1',{id:'k1',nombre:'Juan Pérez',ip:'10.10.0.5',estado:'activo'});
S.clientes.set('k2',{id:'k2',nombre:'PEDRO DIAZ',estado:'activo'});
const rb=rtBuild([
 ['Q','Juan Perez','10.10.0.5/32','20000000/20000000','false','none',''],
 ['Q','Juan Perez (otra)','10.10.0.5/32','1M/1M','false','none',''],
 ['Q','Rango','10.20.0.0/24','5M/5M','false','none',''],
 ['Q','Maria Gomez','10.50.0.7/32','10M/10M','false','none','calle 4'],
 ['P','maria','pppoe','plan20','10.50.0.7','false','María Gómez'],
 ['P','sinip','pppoe','plan20','','true','Luis Sosa'],
 ['P','vpn-admin','ovpn','default','','false',''],
 ['F','plan20','20M/20M 30M/30M'],
 ['D','10.40.0.9','AA:BB:CC:DD:EE:FF','dhcp1','false','Pedro Díaz'],
 ['D','0.0.0.0','AA:BB:CC:DD:EE:00','dhcp1','false','sin ip']]);
t('router: junta colas, PPPoE y DHCP en una fila por cliente',rb.items.length===4,rb.items.map(e=>e.nombre));
t('router: cuenta lo que descarta (rangos, repetidas, VPN)',rb.otros===1&&rb.repetidos===1&&rb.vpn===1,[rb.otros,rb.repetidos,rb.vpn]);
const eM=rb.items.find(e=>e.usuario==='maria'),eL=rb.items.find(e=>e.usuario==='sinip'),eP=rb.items.find(e=>e.tipo==='dhcp');
t('router: PPPoE con cola por IP conserva el nombre de la cola y su velocidad',eM&&eM.tipo==='pppoe'&&eM.nombre==='Maria Gomez'&&eM.ip==='10.50.0.7'&&eM.rate.down===10,eM);
t('router: PPPoE sin IP toma nombre del comentario, velocidad del perfil y queda suspendido si está deshabilitado',eL&&eL.ip===''&&eL.nombre==='Luis Sosa'&&eL.rate.up===20&&eL.dis===true,eL);
t('router: DHCP con MAC y nombre del comentario',eP&&eP.ip==='10.40.0.9'&&eP.mac==='AA:BB:CC:DD:EE:FF'&&eP.nombre==='Pedro Díaz',eP);
const mt=rtMatch(rb.items);
const eJ=rb.items.find(e=>e.ip==='10.10.0.5');
t('router: reconoce al cliente ya cargado por IP y al otro por nombre (sin tildes ni mayúsculas)',eJ.existe==='k1'&&eP.existe==='k2'&&!eM.existe&&!eL.existe,[eJ.existe,eP.existe,eM.existe]);
t('router: asigna el plan por velocidad y avisa las que no tienen plan',eJ.planId==='p20'&&eL.planId==='p20'&&!eM.planId&&mt.sinPlan.length===1&&mt.sinPlan[0][0]==='10M/10M',[eJ.planId,mt.sinPlan]);
const scr=rtScript({nombre:'ADMIN02',kinds:['q','p','d']},'rabc.secreto123');
const scq=rtScript({nombre:'FM04',kinds:['q']},'rabc.secreto123');
t('router: el script es solo lectura (sin set/add/remove/enable/disable sobre colas, PPP o DHCP)',!/(queue simple|ppp secret|ppp profile|dhcp-server lease)\\s+(set|add|remove|disable|enable)/.test(scr),scr.slice(0,200));
t('router: el script pide solo los permisos read y test y nunca lee la contraseña',scr.includes('policy=read,test')&&!/password/i.test(scr)&&!/sensitive/.test(scr));
t('router: el script va en ASCII y con llaves balanceadas',/^[\\x09\\x0a\\x20-\\x7e]+$/.test(scr)&&scr.split('{').length===scr.split('}').length,[scr.split('{').length,scr.split('}').length]);
t('router: el script lleva la dirección y el token una sola vez',scr.split('https://yapur.test/api/router/ingest').length===2&&scr.split('rabc.secreto123').length===2);
t('router: con solo IP fija no lee PPPoE ni DHCP',scq.includes('/queue simple')&&!scq.includes('/ppp')&&!scq.includes('dhcp-server'),scq.slice(0,300));
t('router: con las tres lee colas, DHCP, perfiles y secretos',scr.includes('/queue simple find')&&scr.includes('/ip dhcp-server lease find')&&scr.includes('/ppp profile find')&&scr.includes('/ppp secret find'));
{
  const grande=[];for(let i=0;i<6000;i++)grande.push(['Q','Cliente '+i,'10.'+(i>>8)+'.'+(i&255)+'.1/32','20M/20M','false','none','']);
  for(let i=0;i<6000;i++)S.clientes.set('g'+i,{id:'g'+i,nombre:'Otro '+i,ip:'10.'+(i>>8)+'.'+(i&255)+'.2'});
  const t0=Date.now(),rg=rtBuild(grande);rtMatch(rg.items);const ms=Date.now()-t0;
  t('router: 6.000 clientes detectados contra 6.000 cargados se procesan en menos de 2 s',rg.items.length===6000&&ms<2000,[rg.items.length,ms]);
  for(let i=0;i<6000;i++)S.clientes.delete('g'+i);
}
// importar: velocidad → plan, cobrar desde por cliente, precio igual al del plan y clientes que ya existen
{
  S.planes.clear();S.clientes.clear();S.pagos.clear();
  S.planes.set('p5',{id:'p5',nombre:'Plan_5',bajada:5,subida:5,precio:17000});
  S.planes.set('p35',{id:'p35',nombre:'Plan_3.5',bajada:3.5,subida:3.5,precio:17000});
  S.planes.set('p10',{id:'p10',nombre:'Plan_10',bajada:10,subida:10,precio:18000});
  const hd='nombre;dni;velocidad;ciclo;precio especial;cobrar desde;notas';
  const r1=parseCsv(hd+'\\r\\nAna Pérez;30111222;5.0;1;17000;2026-11;sin novedad\\r\\nBeto Díaz;;3,5;2;$ 28.000;2026-10;con tv\\r\\nCarla Ruiz;;10;1;;11/2026;\\r\\nDaniel Sosa;;40;2;18000;;\\r\\nEsteban Luna;;;1;;;\\r\\n');
  const ai=analyzeImport(r1,{estado:'activo',desde:'2026-09',ciclo:1});
  const R=n=>ai.recs.find(x=>x.nombre===n);
  t('import vel: la velocidad elige el plan (5.0 y 3,5)',R('Ana Pérez').planId==='p5'&&R('Beto Díaz').planId==='p35',[R('Ana Pérez').planId,R('Beto Díaz').planId]);
  t('import vel: precio igual al del plan no queda como precio especial; distinto sí',R('Ana Pérez').precio===null&&R('Beto Díaz').precio===28000&&R('Carla Ruiz').precio===null,[R('Ana Pérez').precio,R('Beto Díaz').precio]);
  t('import vel: cobrar desde por fila (yyyy-mm, mm/yyyy) o el general',R('Ana Pérez').desde==='2026-11'&&R('Beto Díaz').desde==='2026-10'&&R('Carla Ruiz').desde==='2026-11'&&R('Daniel Sosa').desde==='2026-09',ai.recs.map(x=>x.desde));
  t('import vel: velocidad sin plan avisa y deja el precio',!R('Daniel Sosa').planId&&R('Daniel Sosa').precio===18000&&ai.velFalta.get('40')===1&&!ai.velFalta.has('null'),[...ai.velFalta]);
  t('import vel: ciclo por fila',R('Ana Pérez').ciclo===1&&R('Beto Díaz').ciclo===2&&R('Daniel Sosa').ciclo===2);
  t('import vel: sin velocidad queda sin plan sin avisar',!R('Esteban Luna').planId&&ai.velFalta.size===1);
  t('parseMes entiende varios formatos',parseMes('2026-11')==='2026-11'&&parseMes('2026-11-05')==='2026-11'&&parseMes('11/2026')==='2026-11'&&parseMes('05/11/2026')==='2026-11'&&parseMes('hola')===''&&parseMes('2026-13')==='');
  // ya existentes
  S.clientes.set('e1',{id:'e1',_doc:'s1',nombre:'Pérez Ana',estado:'activo',ciclo:1,desde:'2026-10',ip:'10.0.0.9'});
  S.clientes.set('e2',{id:'e2',_doc:'s1',nombre:'Beto Díaz',estado:'activo',tel:'3844111111',precio:30000,ciclo:1,desde:'2026-10'});
  const sk=analyzeImport(r1,{estado:'activo',desde:'2026-09',ciclo:1,existentes:'saltear'});
  t('import existentes: por nombre, sin importar el orden, no se vuelven a crear',sk.recs.length===3&&sk.existen===2&&!sk.recs.some(x=>x.nombre==='Ana Pérez'||x.nombre==='Beto Díaz')&&sk.upd.length===0,[sk.recs.length,sk.existen,sk.upd.length]);
  S.loaded.pagos=true;S.paidIdx.clear();S.paidIdx.set('e2',new Map([['2026-10',30000]]));
  const co=analyzeImport(r1,{estado:'activo',desde:'2026-09',ciclo:1,existentes:'completar'});
  const u1=co.upd.find(x=>x.id==='e1'),u2=co.upd.find(x=>x.id==='e2');
  t('import completar: llena lo que faltaba (dni, plan, notas) y no pisa lo que ya tenía (ip)',u1&&u1.patch.dni==='30111222'&&u1.patch.planId==='p5'&&u1.patch.notas==='sin novedad'&&!('ip' in u1.patch),u1);
  t('import completar: sin pagos cargados toma cobrar desde y ciclo del archivo',u1.patch.desde==='2026-11'&&u1.shard==='s1',u1);
  t('import completar: con pagos no toca cobrar desde ni ciclo, ni el precio que ya tenía',u2&&!('desde' in u2.patch)&&!('ciclo' in u2.patch)&&!('precio' in u2.patch)&&!('tel' in u2.patch)&&u2.patch.planId==='p35',u2);
  S.loaded.pagos=false;
  const nx=analyzeImport(r1,{estado:'activo',desde:'2026-09',ciclo:1});
  t('import sin opción existentes: no cambia el comportamiento anterior',nx.recs.length===5&&nx.existen===0&&nx.upd.length===0,nx.recs.length);
  S.clientes.clear();S.planes.clear();S.paidIdx.clear();
}
// subir precios en bloque
{
  S.planes.clear();S.clientes.clear();S.pagos.clear();S.ajustes.servicios=null;
  S.planes.set('p5',{id:'p5',nombre:'Plan_5',bajada:5,subida:5,precio:18000});
  S.planes.set('p7',{id:'p7',nombre:'Plan_7',bajada:7,subida:7,precio:17000});
  const mk=(id,o)=>S.clientes.set(id,Object.assign({id,_doc:'s1',nombre:id,estado:'activo',desde:'2026-08',ciclo:1},o));
  mk('a',{planId:'p5',precio:17000});             // plan a 18.000 con precio viejo: vuelve al plan
  mk('b',{precio:15000,notas:'Personal'});       // sin plan: queda en 18.000 explícito
  mk('c',{precio:18000});                          // ya está
  mk('d',{precio:2700});                           // adicional: no se toca
  mk('e',{precio:15000,notas:'cambio | SOLO TV'});  // excluido por la nota
  mk('f',{planId:'p7'});                           // sin precio especial, plan viejo a 17.000
  mk('g',{precio:17000,estado:'baja'});            // de baja: no cuenta
  mk('h',{precio:17000,hp:[{h:'2026-10',planId:null,precio:16000,extras:[]}]}); // cambio posterior: se saltea
  mk('i',{precio:23000});                          // otro nivel
  const o={max:17000,min:10000,nuevo:18000,desde:'2026-11',excluir:'solo tv'};
  const r=bulkPrecios(o);
  const by=Object.fromEntries(r.cambian.map(x=>[x.id,x]));
  t('bloque: cambia a, b y f; no toca c, d, e, g, h ni i',Object.keys(by).sort().join()==='a,b,f',Object.keys(by));
  t('bloque: cuenta lo que dejó afuera por monto, por nota y por otro cambio',r.bajo===1&&r.nota===1&&r.hist===1,[r.bajo,r.nota,r.hist]);
  t('bloque: si el plan ya vale lo nuevo, el precio especial se saca',by.a.patch.precio===null&&by.b.patch.precio===18000&&by.f.patch.precio===18000,[by.a.patch.precio,by.b.patch.precio,by.f.patch.precio]);
  t('bloque: guarda el estado anterior hasta octubre',by.a.patch.hp.length===1&&by.a.patch.hp[0].h==='2026-10'&&by.a.patch.hp[0].precio===17000&&by.a.patch.hp[0].planId==='p5'&&by.f.patch.hp[0].precio===null&&by.f.patch.hp[0].planId==='p7',[by.a.patch.hp,by.f.patch.hp]);
  t('bloque: porPrecio agrupa lo que se cambia',r.porPrecio.get(17000)===2&&r.porPrecio.get(15000)===1,[...r.porPrecio]);
  // aplicado: octubre conserva el precio, noviembre toma el nuevo
  for(const x of r.cambian)Object.assign(S.clientes.get(x.id),x.patch);
  const ca=S.clientes.get('a'),cb=S.clientes.get('b'),cf=S.clientes.get('f');
  t('bloque aplicado: octubre sigue en el precio viejo y noviembre en el nuevo',priceAt(ca,'2026-10')===17000&&priceAt(ca,'2026-11')===18000&&priceAt(cb,'2026-10')===15000&&priceAt(cb,'2026-11')===18000&&priceAt(cf,'2026-10')===17000&&priceAt(cf,'2026-11')===18000,[priceAt(ca,'2026-10'),priceAt(ca,'2026-11'),priceAt(cb,'2026-10'),priceAt(cb,'2026-11'),priceAt(cf,'2026-10'),priceAt(cf,'2026-11')]);
  t('bloque aplicado: meses anteriores a octubre también conservan el precio viejo',priceAt(cb,'2026-08')===15000&&priceAt(cb,'2026-09')===15000);
  t('bloque: correrlo de nuevo no cambia a nadie más',bulkPrecios(o).cambian.length===0,bulkPrecios(o).cambian.map(x=>x.id));
  // «completar» al asignar el plan: un precio especial igual al del plan se saca
  S.clientes.clear();
  S.clientes.set('z',{id:'z',_doc:'s1',nombre:'Zeta Zoe',estado:'activo',precio:18000,ciclo:1,desde:'2026-11'});
  S.clientes.set('y',{id:'y',_doc:'s1',nombre:'Yepes Yago',estado:'activo',precio:28000,ciclo:1,desde:'2026-11'});
  const cz=analyzeImport(parseCsv('nombre;velocidad;precio especial\\r\\nZoe Zeta;5;18000\\r\\nYago Yepes;5;28000\\r\\n'),{estado:'activo',desde:'2026-11',ciclo:1,existentes:'completar'});
  const uz=cz.upd.find(x=>x.id==='z'),uy=cz.upd.find(x=>x.id==='y');
  t('completar: al asignarle el plan, el precio especial igual al del plan se saca; uno distinto se respeta',uz&&uz.patch.planId==='p5'&&uz.patch.precio===null&&uy&&uy.patch.planId==='p5'&&!('precio' in uy.patch),[uz,uy]);
  S.clientes.clear();S.planes.clear();
}
// deuda anterior: aparte de las mensualidades y se cobra con su propio concepto
{
  S.clientes.clear();S.pagos.clear();S.planes.clear();
  S.planes.set('p1',{id:'p1',nombre:'Hogar',bajada:50,subida:20,precio:20000});
  const cu=todayStr().slice(0,7),nx=addMonths(cu,1),m3=addMonths(cu,-2);
  const cc={id:'dc',_doc:'s1',estado:'activo',planId:'p1',desde:m3,ciclo:1,deudaAnt:{m:30000,det:'Septiembre 2026',f:cu+'-01'}};
  S.clientes.set('dc',cc);
  S.pagos.set('d1',{id:'d1',c:'dc',concepto:'deuda_anterior',per:null,monto:12000.5,fecha:cu+'-02',recibo:'RD1'});
  S.pagos.set('d2',{id:'d2',c:'dc',concepto:'deuda_anterior',per:null,monto:5000,fecha:cu+'-03',recibo:'RD2',anulado:true});
  S.pagos.set('m1',{id:'m1',c:'dc',concepto:'mensualidad',per:addMonths(cu,-1),monto:20000,fecha:cu+'-01',recibo:'RM1'});
  rebuildDerived();
  t('deuda anterior: lo que falta es lo original menos lo cobrado, sin contar anulados',deudaAntRest(cc)===17999.5,deudaAntRest(cc));
  t('deuda anterior: un cobro de deuda anterior no paga mensualidades',billing(cc).periods.find(p=>p.per===m3).paid===0&&billing(cc).periods.find(p=>p.per===addMonths(cu,-1)).paid===20000);
  const dp=deudaPrevia(cc,nx);
  t('deudaPrevia: suma los meses sin pagar antes del mes elegido (mes pagado no cuenta)',dp.monto===40000&&dp.meses.length===2&&dp.meses.includes(m3)&&dp.meses.includes(cu),dp);
  const rb=bulkCero(nx);
  t('bulkCero: pasa a cobrar desde el mes elegido y suma lo nuevo a la deuda anterior que ya tenía',rb.cambian.length===1&&rb.cambian[0].patch.desde===nx&&rb.cambian[0].patch.deudaAnt.m===70000&&/Septiembre 2026 \\+ /.test(rb.cambian[0].patch.deudaAnt.det)&&rb.conDeuda===1&&rb.monto===40000,rb);
  const rp=bulkCero(nx,true),pp=rp.cambian[0]&&rp.cambian[0].patch;
  t('bulkCero perdonando: empieza desde el mes elegido, no anota deuda nueva y da por saldada la que ya tenía',rp.cambian.length===1&&pp.desde===nx&&pp.deudaAnt.m===12000.5&&rp.conDeuda===1&&rp.monto===40000&&rp.perdonados===1&&rp.perdon===17999.5,rp);
  S.clientes.set('dc',Object.assign({},cc,pp));rebuildDerived();
  t('bulkCero perdonando: después de aplicarlo no debe deuda anterior ni mensualidades',deudaAntRest(S.clientes.get('dc'))===0&&billing(S.clientes.get('dc')).deuda===0&&bulkCero(nx,true).cambian.length===0);
  S.clientes.set('dc',cc);rebuildDerived();
  S.clientes.set('dc',Object.assign({},cc,{desde:nx}));rebuildDerived();
  const rq=bulkCero(nx,true);
  t('bulkCero perdonando: a quien ya empieza ese mes solo le salda la deuda anterior que tenga (sin tocar «cobrar desde»)',rq.cambian.length===1&&!('desde' in rq.cambian[0].patch)&&rq.perdonados===1&&rq.perdon===17999.5&&rq.yaDesde===0,rq);
  t('bulkCero sin perdonar: no toca a ese cliente',bulkCero(nx).cambian.length===0);
  t('bulkCero: no mueve dos veces a quien ya empieza ese mes',bulkCero(nx).cambian.length===0&&bulkCero(nx).yaDesde===1);
  t('con «cobrar desde» el mes que viene, hoy no debe mensualidades',billing(S.clientes.get('dc')).deuda===0&&billing(S.clientes.get('dc')).vencidos===0);
  S.clientes.clear();S.pagos.clear();S.planes.clear();rebuildDerived();
}
// importar en modo «actualizar»: plan, servicios y precio nuevos; lo anterior queda como vigencia
{
  S.clientes.clear();S.pagos.clear();S.planes.clear();
  S.planes.set('p100',{id:'p100',nombre:'Plan 100',bajada:100,subida:100,precio:18000});
  S.planes.set('p200',{id:'p200',nombre:'Plan 200',bajada:200,subida:200,precio:19000});
  const base={estado:'activo',ciclo:1,desde:'2026-11',_doc:'s1'};
  S.clientes.set('a',Object.assign({},base,{id:'a',nombre:'Ana Alda',precio:17000}));
  S.clientes.set('b',Object.assign({},base,{id:'b',nombre:'Beto Bos',precio:18000,hp:[{h:'2026-10',planId:null,precio:17000,extras:[]}]}));
  S.clientes.set('c',Object.assign({},base,{id:'c',nombre:'Carlos Cruz',precio:32000}));
  S.clientes.set('d',Object.assign({},base,{id:'d',nombre:'Dora Dix',precio:15000}));
  S.clientes.set('f',Object.assign({},base,{id:'f',nombre:'Fede Fax',planId:'p200',precio:null}));
  S.clientes.set('g',Object.assign({},base,{id:'g',nombre:'Gaby Gil',precio:28000}));
  rebuildDerived();
  const csv='nombre;plan;servicios;precio especial\\r\\nAna Alda;Plan 100;;\\r\\nBeto Bos;Plan 100;;\\r\\nCarlos Cruz;Plan 100;Multimedia;\\r\\nDora Dix;Sin plan;Multimedia;\\r\\nFede Fax;Plan 200;;\\r\\nNadie Nunca;Plan 100;;\\r\\nGaby Gil;;;\\r\\n';
  const ca=analyzeImport(parseCsv(csv),{estado:'activo',desde:'2026-11',ciclo:1,existentes:'actualizar',vigencia:'2026-11'});
  const P=id=>{const u=ca.upd.find(x=>x.id===id);return u&&u.patch;};
  const ap=(id)=>Object.assign({},S.clientes.get(id),P(id));
  t('actualizar: no crea clientes nuevos (el que no existe se cuenta aparte)',ca.recs.length===0&&ca.sinMatch===1,[ca.recs.length,ca.sinMatch]);
  t('actualizar: resumen de lo que cambia',ca.act.n===4&&ca.act.igual===1&&ca.act.conServ===2&&ca.act.porPlan.get('Plan 100')===3&&ca.act.porPlan.get('Sin plan')===1,[ca.act.n,ca.act.igual,ca.act.conServ,[...ca.act.porPlan]]);
  t('actualizar: precio especial 17.000 → Plan 100 sin precio propio; octubre sigue en 17.000 y noviembre en 18.000',P('a').planId==='p100'&&P('a').precio===null&&priceAt(ap('a'),'2026-10')===17000&&priceAt(ap('a'),'2026-11')===18000,[P('a'),priceAt(ap('a'),'2026-10'),priceAt(ap('a'),'2026-11')]);
  t('actualizar: quien ya tenía historial de octubre no suma otro; octubre 17.000 y noviembre 18.000',P('b').hp===undefined&&priceAt(ap('b'),'2026-10')===17000&&priceAt(ap('b'),'2026-11')===18000,[P('b'),priceAt(ap('b'),'2026-10'),priceAt(ap('b'),'2026-11')]);
  t('actualizar: Plan 100 + Multimedia = 33.000 desde noviembre (antes pagaba 32.000 todo junto)',priceAt(ap('c'),'2026-11')===33000&&priceAt(ap('c'),'2026-10')===32000&&P('c').extras.length===1,[priceAt(ap('c'),'2026-11'),priceAt(ap('c'),'2026-10'),P('c').extras]);
  t('actualizar: «Sin plan» + Multimedia deja solo el servicio',P('d').planId===null&&P('d').extras.length===1&&priceAt(ap('d'),'2026-11')===15000,[P('d'),priceAt(ap('d'),'2026-11')]);
  t('actualizar: si ya estaba así no cambia nada; una fila sin plan ni servicios no toca a nadie',!P('f')&&!P('g'));
  S.clientes.clear();S.planes.clear();S.pagos.clear();rebuildDerived();
}

// instalaciones por día, semana y mes
{
  setToday('2026-11-06');   /* viernes */
  t('semana: el lunes de un viernes, de un domingo y de un lunes',inLunes('2026-11-06')==='2026-11-02'&&inLunes('2026-11-08')==='2026-11-02'&&inLunes('2026-11-09')==='2026-11-09'&&inLunes('2026-11-01')==='2026-10-26',[inLunes('2026-11-06'),inLunes('2026-11-08'),inLunes('2026-11-09'),inLunes('2026-11-01')]);
  t('períodos: fin de mes (también bisiesto), mes anterior, semana anterior y cambio de año',inFin('mes','2026-02-10')==='2026-02-28'&&inFin('mes','2028-02-10')==='2028-02-29'&&inMover('mes','2026-01-15',-1)==='2025-12-01'&&inMover('sem','2026-11-06',-1)==='2026-10-26'&&inAddDays('2026-12-31',1)==='2027-01-01'&&inFin('sem','2026-11-06')==='2026-11-08');
  t('títulos: día, semana (en un mes y entre dos) y mes',instTitulo('dia','2026-11-06','2026-11-06')==='Viernes 6 de noviembre'&&instTitulo('sem','2026-11-06','2026-11-06')==='Semana del 2 al 8 de noviembre'&&instTitulo('sem','2026-10-30','2026-11-06')==='Semana del 26 de octubre al 1 de noviembre'&&instTitulo('mes','2026-11-20','2026-11-06')===monthLabel('2026-11'),[instTitulo('sem','2026-10-30','2026-11-06')]);
  t('título de otro año lleva el año',instTitulo('dia','2025-12-31','2026-11-06')==='Miércoles 31 de diciembre de 2025',instTitulo('dia','2025-12-31','2026-11-06'));
  t('«hoy», «ayer» y nada para lo más viejo',instRel('dia','2026-11-06','2026-11-06')==='Hoy'&&instRel('sem','2026-11-03','2026-11-06')==='Esta semana'&&instRel('mes','2026-10-05','2026-11-06')==='El mes pasado'&&instRel('dia','2026-11-01','2026-11-06')==='');
  S.ordenes.clear();S.pagos.clear();S.clientes.clear();
  S.ajustes.tecnicos=[{id:'t1',nombre:'Pedro'},{id:'t2',nombre:'Juan'}];
  for(const id of 'abcdefgh')S.clientes.set(id,{id,nombre:'Cliente '+id,estado:'activo'});
  const O=(id,x)=>S.ordenes.set(id,Object.assign({id,tipo:'instalacion',estado:'hecha',clientId:'a',fecha:'2026-11-01',creado:'2026-11-01'},x));
  O('o1',{clientId:'a',tecnico:'t1',cierre:'2026-11-06 10:30'});
  O('o2',{clientId:'b',tecnico:'t2',cierre:'2026-11-06 15:00'});
  O('o3',{clientId:'c',tecnico:'t1',cierre:'2026-11-04 09:00',sinCobro:'oficina'});
  O('o4',{clientId:'d',tecnico:'t1',fecha:'2026-10-28',cierre:'2026-10-30 11:00'});
  O('o5',{clientId:'e',estado:'pendiente',fecha:'2026-11-07'});
  O('o6',{tipo:'falla',cierre:'2026-11-06 12:00'});
  O('o7',{estado:'cancelada',fecha:'2026-11-06'});
  O('o8',{clientId:'e',tecnico:'t2',fecha:'2026-11-05'});
  const P=(id,x)=>S.pagos.set(id,Object.assign({id,concepto:'instalacion',monto:65000,metodo:'efectivo',por:'t1',porNombre:'Pedro'},x));
  P('p1',{c:'f',fecha:'2026-11-03',hora:'16:00'});
  P('p2',{c:'f',fecha:'2026-11-05',hora:'09:00'});   /* el mismo cliente pagó otra parte: no es otra instalación */
  P('p3',{c:'a',fecha:'2026-11-06'});               /* ya tiene su orden cerrada */
  P('p4',{c:'g',fecha:'2026-11-04',anulado:true});
  P('p5',{c:'h',fecha:'2026-11-02',por:'u9',porNombre:'Laura'});   /* lo cargó la oficina */
  P('p6',{c:'e',fecha:'2026-11-04',concepto:'mensualidad'});
  rebuildDerived();
  const dia=instCalc('dia','2026-11-06','2026-11-06'),sem=instCalc('sem','2026-11-06','2026-11-06'),mes=instCalc('mes','2026-11-06','2026-11-06');
  t('día: 2 instaladas, 1 el día anterior, nada sin hacer',dia.n===2&&dia.prev===1&&dia.sinHacer===0,[dia.n,dia.prev,dia.sinHacer]);
  t('semana: 6 (órdenes cerradas + cobros sin orden), 1 la semana anterior, 1 sin hacer, 1 sin cobrar',sem.n===6&&sem.prev===1&&sem.sinHacer===1&&sem.sinCobrar===1&&sem.d1==='2026-11-02'&&sem.d2==='2026-11-08',[sem.n,sem.prev,sem.sinHacer,sem.sinCobrar,sem.d1,sem.d2]);
  t('mes: 6 en noviembre y 1 en octubre (cuenta por el día de cierre, no por el programado)',mes.n===6&&mes.prev===1,[mes.n,mes.prev]);
  t('van de la más nueva a la más vieja y se cuenta una vez por cliente',sem.sel.map(e=>e.id).join()==='o2,o1,o8,o3,pf,ph',sem.sel.map(e=>e.id).join());
  t('el cobro sin orden queda marcado; el que tiene orden y el anulado no suman',sem.sel.filter(e=>e.sinOrden).length===2&&!sem.sel.some(e=>e.cid==='g')&&sem.sel.filter(e=>e.cid==='a').length===1);
  t('no cuenta lo que no es instalación, la orden cancelada ni la abierta',!sem.sel.some(e=>e.id==='o5'||e.id==='o6'||e.id==='o7'));
  t('una orden cerrada sin fecha de cierre cuenta el día programado',sem.sel.some(e=>e.id==='o8'&&e.f==='2026-11-05'));
  const pt=instPorTec(sem.sel);
  t('por técnico: Pedro 3, Juan 2 y 1 sin técnico (lo cargó la oficina)',pt.map(x=>x.nombre+':'+x.n).join()==='Pedro:3,Juan:2,Sin técnico:1',pt.map(x=>x.nombre+':'+x.n).join());
  t('no se puede mirar un período que todavía no empezó',instCalc('dia','2026-11-20','2026-11-06').ref==='2026-11-06'&&instCalc('mes','2027-03-05','2026-11-06').ref==='2026-11-01');
  const rs=instResumen();t('resumen: hoy 2 y en el mes 6',rs.hoy===2&&rs.mes===6,rs);
  /* una instalación que se cobró después de cerrar la orden ya no figura «sin cobrar» */
  P('p7',{c:'c',fecha:'2026-11-06'});rebuildDerived();
  t('al cobrarla deja de estar «sin cobrar» (y sigue contando una sola vez)',instCalc('sem','2026-11-06','2026-11-06').sinCobrar===0&&instCalc('sem','2026-11-06','2026-11-06').n===6);
  S.ordenes.clear();S.pagos.clear();S.clientes.clear();S.ajustes.tecnicos=[];rebuildDerived();setToday(null);
}
console.log(out.join('\\n'));
`;
const ctx={console,document:{addEventListener(){},querySelector(){return null},querySelectorAll(){return []},createElement(){return {style:{}}}},window:{},localStorage:{getItem(){return null},setItem(){}},navigator:{},setTimeout,Intl,Date,Math,FileReader:function(){}};
ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(src+'\n'+test,ctx);
