const fs=require('fs'),vm=require('vm');
const dir=__dirname+'/../app/src/';
const src=['p04_core.js','p05_clients.js','p05b_red.js','p06_plans_settings.js','p06b_import.js','p06d_routers.js','p07_orders.js','p08_pay.js'].map(f=>fs.readFileSync(dir+f,'utf8')).join('\n');
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
t('precio especial manda',priceOf({planId:'p1',precio:15000})===15000&&priceOf({planId:'p1',precio:null})===20000);
// reparto de pagos
let al=allocate([{per:'2026-08',rest:15000},{per:'2026-09',rest:20000}],20000);
t('parcial se aplica al mas viejo',al.length===2&&al[0].monto===15000&&al[1].monto===5000,al);
al=allocate([{per:'2026-08',rest:15000}],18000);t('sobrante al ultimo mes',al.length===1&&al[0].monto===18000,al);
// recibo
S.ajustes.empresa='YAPUR.NET';S.clientes.set('c1',{id:'c1',nombre:'Cliente Prueba',codigo:'7'});
S.pagos.set('r1',{id:'r1',c:'c1',concepto:'mensualidad',per:'2026-09',monto:15000,fecha:'2026-10-19',hora:'13:40',recibo:'R261019-ABC',metodo:'efectivo'});
const rt=receiptText('R261019-ABC');t('recibo trae total y cliente',rt.includes('TOTAL')&&rt.includes('Cliente Prueba')&&rt.includes('RECIBO N° R261019-ABC'),rt);
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
console.log(out.join('\\n'));
`;
const ctx={console,document:{addEventListener(){},querySelector(){return null},querySelectorAll(){return []},createElement(){return {style:{}}}},window:{},localStorage:{getItem(){return null},setItem(){}},navigator:{},setTimeout,Intl,Date,Math,FileReader:function(){}};
ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(src+'\n'+test,ctx);
