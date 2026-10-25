const fs=require('fs'),vm=require('vm');
const dir=__dirname+'/../app/src/';
const src="const NET={on(){},init:()=>new Promise(()=>{}),native:false,base:'',plugin(){return null},me:null,online:false};\n"+['p04_core.js','p05_clients.js','p05b_red.js','p06_plans_settings.js','p06c_profiles.js','p06b_import.js','p06d_routers.js','p07_orders.js','p08_pay.js','p09_boot.js','p09c_update.js','p09b_boot.js'].map(f=>fs.readFileSync(dir+f,'utf8')).join('\n');
const test=`
const out=[];const t=(n,ok,x)=>out.push((ok?'ok   ':'FAIL ')+n+(ok?'':' -> '+JSON.stringify(x)));
S.planes.set('p1',{id:'p1',nombre:'Hogar',bajada:50,subida:25,precio:20000});
S.perms={cobrar:true,caja:true,promesas:true,clientesTodos:true,telefono:true};
const mk=(id,o)=>Object.assign({id,estado:'activo',planId:'p1',desde:'2026-08',ciclo:1},o||{});
const reset=()=>{S.pagos.clear();S.clientes.clear();rebuildDerived();};
const pay=(id,per,monto)=>{S.pagos.set(id+per+monto,{id:id+per+monto,c:id,concepto:'mensualidad',per,monto,fecha:per+'-05',recibo:'R'+id+per});};

// --- fecha de corte ---
t('ciclo 1, oct 2026: 13 es martes, corta el 13',corteFecha('2026-10',1)==='2026-10-13',corteFecha('2026-10',1));
t('ciclo 2, oct 2026: 23 es viernes, corta el 23',corteFecha('2026-10',2)==='2026-10-23',corteFecha('2026-10',2));
t('ciclo 2, nov 2026: 23 es feriado (lunes) -> martes 24',corteFecha('2026-11',2)==='2026-11-24',corteFecha('2026-11',2));
t('ciclo 1, nov 2026: 13 es viernes, corta el 13',corteFecha('2026-11',1)==='2026-11-13');
t('ciclo 1, sep 2026: 13 es domingo -> lunes 14',corteFecha('2026-09',1)==='2026-09-14',corteFecha('2026-09',1));
t('ciclo 1, jun 2026: 13 sabado y lunes 15 feriado -> martes 16',corteFecha('2026-06',1)==='2026-06-16',corteFecha('2026-06',1));
t('ciclo 2, dic 2026: 23 es miercoles, corta el 23',corteFecha('2026-12',2)==='2026-12-23');
t('nota explica el corrimiento',corteNota('2026-11',2).why.includes('Soberan')&&corteNota('2026-11',2).raw==='2026-11-23'&&corteNota('2026-10',1)===null);
// feriados editados por el admin
S.ajustes.feriados=[{f:'2026-10-13',n:'Local'}];
t('feriado propio corre el corte',corteFecha('2026-10',1)==='2026-10-14');
S.ajustes.feriados=null;
// ciclos configurables
S.ajustes.ciclos={1:{desde:2,hasta:9,corte:12}};
t('ciclo configurable',cicloCfg(1).corte===12&&cicloCfg(1).hasta===9&&cicloCfg(2).corte===23);
S.ajustes.ciclos=null;

// --- estados de corte (ciclo 1) ---
reset();
const c1=mk('a');S.clientes.set('a',c1);
setToday('2026-10-05');rebuildDerived();
let s=cutState(c1);t('5/10 ciclo 1 sin pagar: en plazo',s.k==='plazo'&&s.corte==='2026-10-13'&&s.first.per==='2026-10'||s.first.per==='2026-08',[s.k,s.corte,s.first&&s.first.per]);
reset();S.clientes.set('a',c1);pay('a','2026-08',20000);pay('a','2026-09',20000);rebuildDerived();
setToday('2026-10-05');rebuildDerived();s=cutState(c1);
t('5/10 pagó agosto y septiembre: octubre en plazo',s.k==='plazo'&&s.first.per==='2026-10'&&s.first.due==='2026-10-10',s);
setToday('2026-10-10');rebuildDerived();t('10/10 todavía en plazo',cutState(c1).k==='plazo');
setToday('2026-10-11');rebuildDerived();s=cutState(c1);t('11/10 vencido, sin cortar todavía',s.k==='vencido'&&s.corte==='2026-10-13',s.k);
setToday('2026-10-12');rebuildDerived();t('12/10 sigue sin cortar',cutState(c1).k==='vencido');
setToday('2026-10-13');rebuildDerived();s=cutState(c1);t('13/10 a cortar',s.k==='cortar'&&s.desde==='2026-10-13'&&s.motivo.includes('13/10'),s);
t('chip dice A cortar',billChip(c1).includes('A cortar'),billChip(c1));
// paga y desaparece
pay('a','2026-10',20000);rebuildDerived();t('paga y vuelve a ok',cutState(c1).k==='ok'&&billChip(c1).includes('Al día'));

// --- ciclo 2 ---
reset();const c2=mk('b',{ciclo:2});S.clientes.set('b',c2);pay('b','2026-08',20000);pay('b','2026-09',20000);pay('b','2026-10',20000);
setToday('2026-11-12');rebuildDerived();s=cutState(c2);t('ciclo 2 el 12/11: en plazo (paga del 13 al 20)',s.k==='plazo'&&s.first.desde==='2026-11-13'&&s.first.due==='2026-11-20',s.first);
rebuildDerived();
setToday('2026-11-21');rebuildDerived();s=cutState(c2);t('ciclo 2 el 21/11: vencido, corte el 24 por feriado del 23',s.k==='vencido'&&s.corte==='2026-11-24',[s.k,s.corte]);
setToday('2026-11-23');rebuildDerived();t('ciclo 2 el 23/11 (feriado): todavía no se corta',cutState(c2).k==='vencido');
setToday('2026-11-24');rebuildDerived();t('ciclo 2 el 24/11: a cortar',cutState(c2).k==='cortar');

// --- promesa de pago ---
reset();const c3=mk('c');S.clientes.set('c',c3);pay('c','2026-08',20000);pay('c','2026-09',20000);
setToday('2026-10-12');rebuildDerived();
c3.promesas=[{f:'2026-10-12',h:'2026-10-17',d:5,por:'Ofi'}];rebuildDerived();
t('promesa vigente en el día',cutState(c3).k==='promesa'&&cutState(c3).hasta==='2026-10-17');
setToday('2026-10-13');rebuildDerived();s=cutState(c3);t('13/10 con promesa no se corta, cae el 18',s.k==='promesa'&&s.desde==='2026-10-18',s);
t('chip muestra promesa',billChip(c3).includes('Promesa hasta 17/10'),billChip(c3));
setToday('2026-10-17');rebuildDerived();t('último día de la promesa sigue vigente',cutState(c3).k==='promesa');
setToday('2026-10-18');rebuildDerived();s=cutState(c3);t('18/10 venció la promesa: a cortar (sábado, automático)',s.k==='cortar'&&s.desde==='2026-10-18'&&s.motivo.includes('promesa'),s);
// pago dentro de la promesa
setToday('2026-10-15');pay('c','2026-10',20000);rebuildDerived();t('pagó dentro de la promesa: al día',cutState(c3).k==='ok');
// promesa corta que vence antes del corte no adelanta el corte
reset();const c4=mk('d',{promesas:[{f:'2026-10-09',h:'2026-10-11',d:2,por:'x'}]});S.clientes.set('d',c4);pay('d','2026-08',20000);pay('d','2026-09',20000);
setToday('2026-10-12');rebuildDerived();s=cutState(c4);t('promesa vencida antes del corte: sigue el corte del 13',s.k==='vencido'&&s.corte==='2026-10-13',[s.k,s.corte]);
setToday('2026-10-13');rebuildDerived();t('y el 13 se corta por fecha',cutState(c4).k==='cortar'&&cutState(c4).motivo.includes('corte del 13/10'),cutState(c4).motivo);
// promesa anulada
c4.promesas=[{f:'2026-10-12',h:'2026-10-20',d:8,por:'x',x:1}];rebuildDerived();t('promesa anulada no protege',cutState(c4).k==='cortar');
// una promesa vieja de otro mes no se confunde
reset();const c5=mk('e',{promesas:[{f:'2026-08-12',h:'2026-08-17',d:5,por:'x'}]});S.clientes.set('e',c5);pay('e','2026-08',20000);pay('e','2026-09',20000);
setToday('2026-10-13');rebuildDerived();s=cutState(c5);t('promesa de agosto no cuenta en octubre',s.k==='cortar'&&s.motivo.includes('corte del 13/10'),s.motivo);

// --- suspendido y reconexion ---
reset();const c6=mk('f',{estado:'suspendido',corteMora:'2026-10-13'});S.clientes.set('f',c6);pay('f','2026-08',20000);pay('f','2026-09',20000);
setToday('2026-10-14');rebuildDerived();t('suspendido con deuda queda suspendido, no a cortar',cutState(c6).k==='suspendido'&&!aReconectar(c6));
pay('f','2026-10',20000);rebuildDerived();t('paga: para reconectar',aReconectar(c6)&&cutState(c6).k==='ok');
const c7=mk('g',{estado:'suspendido'});S.clientes.set('g',c7);pay('g','2026-08',20000);pay('g','2026-09',20000);pay('g','2026-10',20000);rebuildDerived();
t('suspendido a mano (sin marca de mora) no entra en reconectar',!aReconectar(c7));
// promesa a un suspendido
c6.estado='suspendido';reset();S.clientes.set('f',c6);pay('f','2026-08',20000);pay('f','2026-09',20000);c6.promesas=[{f:'2026-10-14',h:'2026-10-19',d:5,por:'x'}];rebuildDerived();
t('suspendido con promesa vigente: para reconectar',aReconectar(c6)&&cutState(c6).k==='promesa');

// --- listas ---
reset();
const mkc=(id,o)=>{const c=mk(id,o);S.clientes.set(id,c);return c;};
mkc('x1');mkc('x2',{ciclo:2});mkc('x3',{promesas:[{f:'2026-10-12',h:'2026-10-20',d:8,por:'x'}]});mkc('x4',{estado:'suspendido',corteMora:'2026-10-01'});mkc('x5',{estado:'baja'});
for(const id of ['x1','x2','x3','x4','x5']){pay(id,'2026-08',20000);pay(id,'2026-09',20000);}
pay('x4','2026-10',20000);
setToday('2026-10-14');rebuildDerived();
const cd=cortesData();
t('lista para cortar: solo x1 (x2 ciclo 2 aun en plazo, x3 con promesa, baja no)',cd.cortar.map(x=>x.c.id).join()==='x1',cd.cortar.map(x=>x.c.id));
t('lista para reconectar: x4',cd.reconectar.map(x=>x.c.id).join()==='x4');
t('lista promesas: x3',cd.promesas.map(x=>x.c.id).join()==='x3');
// script mikrotik
S.clientes.get('x1').usuario='juan.perez';S.clientes.get('x2').usuario='ana"; /system reset';
const sc=mikrotikScript([S.clientes.get('x1'),S.clientes.get('x2'),S.clientes.get('x3')],false);
t('script de corte: disable y remove por usuario, sin usuario cuenta aparte',sc.text.includes('/ppp secret disable [find name="juan.perez"]')&&sc.text.includes('/ppp active remove [find name="juan.perez"]')&&sc.n===2&&sc.sin===1,sc);
t('script escapa comillas',!sc.text.includes('ana";')&&sc.text.includes('name="ana; /system reset"'),sc.text);
t('script de reconexion habilita',mikrotikScript([S.clientes.get('x1')],true).text.includes('/ppp secret enable [find name="juan.perez"]'));
// calendario
setToday('2026-11-20');rebuildDerived();
const p2=proximoCorte(2);t('proximo corte ciclo 2 desde 20/11 es el 24/11 con nota',p2.fecha==='2026-11-24'&&p2.nota&&p2.nota.raw==='2026-11-23',p2);
const p1=proximoCorte(1);t('proximo corte ciclo 1 desde 20/11 es el de diciembre (13/12 domingo -> 14)',p1.fecha==='2026-12-14',p1);
// importacion
t('parseCiclo',parseCiclo('2',1)===2&&parseCiclo('Ciclo 1',2)===1&&parseCiclo('13 al 20',1)===2&&parseCiclo('1 al 10',2)===1&&parseCiclo('',2)===2&&parseCiclo('?',1)===1);
const rows=parseCsv('nombre;ciclo;plan\\nAna;2;Hogar\\nLuis;;Hogar\\nPedro;1 al 10;Hogar');
const a=analyzeImport(rows,{estado:'activo',desde:'2026-10',ciclo:1});
t('import: ciclo del archivo y por defecto',a.recs.map(r=>r.ciclo).join()==='2,1,1',a.recs.map(r=>r.ciclo));
// permisos
t('promesas es permiso de dinero (tecnico nunca)',MONEY_PERMS.includes('promesas')&&PERM_DEF.tecnico.promesas===false&&PERM_DEF.oficina.promesas===true);
// formulario guarda ciclo 1 por defecto en clientes viejos
t('cliente viejo sin ciclo es ciclo 1',cicloOf({})===1&&cicloOf({ciclo:'2'})===2);
// numeros con formato argentino
t('num: 17.000 es diecisiete mil',num('17.000')===17000,num('17.000'));
t('num: 17000, 17.000,50, 1.234.567, 17,5, $ 17.000',num('17000')===17000&&num('17.000,50')===17000.5&&num('1.234.567')===1234567&&num('17,5')===17.5&&num('$ 17.000')===17000);
t('num: decimales con punto (17.5, 0.75) y estilo US (1,234.50)',num('17.5')===17.5&&num('0.75')===0.75&&num('1,234.50')===1234.5);
t('num: vacio y basura',num('')===null&&num('abc')===null&&num('-')===null&&num(null)===null);
// colas de MikroTik
const plan15={nombre:'Plan_15',bajada:15,subida:15,q:{burstB:'25M',burstS:'25M',thrB:'8M',thrS:'8M',timeB:'22',timeS:'22',limitB:'1M',limitS:'256k',prioB:'8',prioS:'8',bucketB:'0.1',bucketS:'0.1',typeB:'default-small',typeS:'default-small'}};
t('cola igual a la de Winbox del cliente de ejemplo',queueText(plan15)==='max-limit=15M/15M burst-limit=25M/25M burst-threshold=8M/8M burst-time=22s/22s limit-at=256k/1M priority=8/8 bucket-size=0.1/0.1 queue=default-small/default-small',queueText(plan15));
t('plan sin rafaga: solo max-limit',queueText({bajada:50,subida:25})==='max-limit=25M/50M',queueText({bajada:50,subida:25}));
t('un solo lado copia al otro',queueText({bajada:10,subida:5,q:{burstB:'20M'}})==='max-limit=5M/10M burst-limit=20M/20M');
t('velocidades con decimales van en k',queueText({bajada:7.5,subida:2.5})==='max-limit=2500k/7500k');
t('parent con espacios va entre comillas',queueText({bajada:10,subida:10,q:{parent:'Torre Norte'}}).endsWith('parent="Torre Norte"'));
t('rateNorm',rateNorm('25')==='25M'&&rateNorm('256k')==='256k'&&rateNorm('256 K')==='256k'&&rateNorm('1,5m')==='1.5M'&&rateNorm('')===''&&rateNorm('abc')===null&&rateNorm('10Mbps')===null);
S.planes.set('p15',Object.assign({id:'p15'},plan15));
const cmd=clientQueueCmd({nombre:'Agustin Pacheco',planId:'p15',ip:'192.168.100.4'});
t('comando de cola del cliente',cmd==='/queue simple add name="Agustin Pacheco" target=192.168.100.4 '+queueText(plan15),cmd);
t('sin IP no arma comando',clientQueueCmd({nombre:'X',planId:'p15'})===null&&clientQueueCmd({nombre:'X',planId:'nope',ip:'1.1.1.1'})===null);
t('nombre con comillas no rompe el comando',!clientQueueCmd({nombre:'A"; /x',planId:'p15',ip:'1.1.1.1'}).includes('A";'));
// servicios adicionales
S.ajustes.servicios=null;S.planes.set('p1',{id:'p1',nombre:'Hogar',bajada:50,subida:25,precio:20000});
const base={planId:'p1'};
t('servicios por defecto: Multimedia 15000 y Multimedia Net 5000',serviciosList().length===2&&serviciosList().find(x=>x.id==='multimedia').precio===15000&&serviciosList().find(x=>x.id==='multimedia_net').precio===5000);
t('solo plan',priceOf(base)===20000);
t('plan + Multimedia',priceOf({planId:'p1',extras:['multimedia']})===35000);
t('plan + Multimedia Net',priceOf({planId:'p1',extras:['multimedia_net']})===25000);
t('plan + los dos',priceOf({planId:'p1',extras:['multimedia','multimedia_net']})===40000);
t('solo servicios, sin plan de internet',priceOf({extras:['multimedia']})===15000&&priceOf({extras:['multimedia','multimedia_net']})===20000);
t('precio especial reemplaza al plan, los servicios se suman',priceOf({planId:'p1',precio:15000,extras:['multimedia']})===30000);
t('servicio desconocido se ignora',priceOf({planId:'p1',extras:['nope']})===20000);
t('texto del servicio',servicioTxt({planId:'p1',extras:['multimedia','multimedia_net']})==='Hogar + Multimedia + Multimedia Net'&&servicioTxt({extras:['multimedia']})==='Multimedia'&&servicioTxt({})==='Sin plan');
// cambio de precio desde ajustes
S.ajustes.servicios=[{id:'multimedia',nombre:'Multimedia',precio:18000,activo:true},{id:'multimedia_net',nombre:'Multimedia Net',precio:5000,activo:false}];
t('precio nuevo del servicio se aplica',priceOf({planId:'p1',extras:['multimedia']})===38000);
t('servicio inactivo lo sigue pagando quien ya lo tiene',priceOf({planId:'p1',extras:['multimedia_net']})===25000);
S.ajustes.servicios=null;
// facturacion con servicios
reset();setToday('2026-10-05');
const cx=mk('sx',{extras:['multimedia']});S.clientes.set('sx',cx);pay('sx','2026-08',35000);pay('sx','2026-09',20000);rebuildDerived();
const bx=billing(cx);
t('facturacion: el mes pagado solo con el plan deja el servicio pendiente',bx.price===35000&&bx.periods.find(p=>p.per==='2026-09').rest===15000&&bx.periods.find(p=>p.per==='2026-08').rest===0,bx.periods.map(p=>[p.per,p.rest]));
t('recibo lleva el servicio del cliente',(()=>{S.pagos.set('rx',{id:'rx',c:'sx',concepto:'mensualidad',per:'2026-10',monto:35000,fecha:'2026-10-05',hora:'10:00',recibo:'Rrx',metodo:'efectivo'});S.clientes.set('sx',cx);S.ajustes.empresa='Y';const tx=receiptText('Rrx');return tx.includes('Abono')&&tx.includes('Servicio: Hogar + Multimedia');})());
// --- precios con vigencia por mes: un aumento no cambia los meses ya cobrados ---
reset();setToday('2026-10-05');S.ajustes.servicios=null;
S.planes.set('p1',{id:'p1',nombre:'Hogar',bajada:50,subida:25,precio:20000});
const cv=mk('cv',{desde:'2026-07'});S.clientes.set('cv',cv);pay('cv','2026-07',20000);pay('cv','2026-08',20000);pay('cv','2026-09',20000);rebuildDerived();
let bv=billing(cv);
t('sin aumentos: todo al día',bv.periods.every(p=>p.rest===0||p.per==='2026-10'),bv.periods.map(p=>[p.per,p.rest]));
// aumento del plan a 25.000 desde noviembre
S.planes.set('p1',{id:'p1',nombre:'Hogar',bajada:50,subida:25,precio:25000,hist:histWith({precio:20000},'2026-11',25000)});
S.billCache.clear();S.cutCache.clear();
bv=billing(cv,true);
t('el aumento de noviembre no deja deuda en los meses cobrados',bv.periods.filter(p=>p.per<='2026-09').every(p=>p.rest===0),bv.periods.map(p=>[p.per,p.rest]));
t('octubre sigue a 20.000 y noviembre pasa a 25.000',bv.periods.find(p=>p.per==='2026-10').price===20000&&bv.periods.find(p=>p.per==='2026-11').price===25000,bv.periods.map(p=>[p.per,p.price]));
t('el precio de hoy es el vigente (20.000) hasta que llegue noviembre',priceOf(cv)===20000&&planNow(S.planes.get('p1'))===20000);
setToday('2026-11-03');S.billCache.clear();S.cutCache.clear();
t('en noviembre el precio de hoy pasa a 25.000',priceOf(cv)===25000&&planNow(S.planes.get('p1'))===25000);
t('histWith conserva lo anterior y reemplaza lo posterior',JSON.stringify(histWith({precio:25000,hist:[{d:'0000-00',p:20000},{d:'2026-11',p:25000},{d:'2027-01',p:30000}]},'2026-12',27000))==='[{"d":"0000-00","p":20000},{"d":"2026-11","p":25000},{"d":"2026-12","p":27000}]');
// servicio con aumento programado
setToday('2026-10-05');
S.ajustes.servicios=[{id:'multimedia',nombre:'Multimedia',precio:18000,hist:[{d:'0000-00',p:15000},{d:'2026-11',p:18000}],activo:true},{id:'multimedia_net',nombre:'Multimedia Net',precio:5000,activo:true}];
S.planes.set('p1',{id:'p1',nombre:'Hogar',bajada:50,subida:25,precio:20000});
reset();
const cs=mk('cs',{desde:'2026-08',extras:['multimedia']});S.clientes.set('cs',cs);pay('cs','2026-08',35000);pay('cs','2026-09',35000);rebuildDerived();
const bs=billing(cs,true);
t('servicio: el aumento de Multimedia desde noviembre no toca septiembre',bs.periods.find(p=>p.per==='2026-09').rest===0&&bs.periods.find(p=>p.per==='2026-10').price===35000&&bs.periods.find(p=>p.per==='2026-11').price===38000,bs.periods.map(p=>[p.per,p.price,p.rest]));
// el cliente se agrega un servicio: rige desde el mes que se elige, no hacia atrás
S.ajustes.servicios=null;
reset();
const cn=mk('cn',{desde:'2026-07',extras:['multimedia'],hp:[{h:'2026-09',planId:'p1',precio:null,extras:[]}]});S.clientes.set('cn',cn);
pay('cn','2026-07',20000);pay('cn','2026-08',20000);pay('cn','2026-09',20000);rebuildDerived();
const bn2=billing(cn);
t('cliente que agregó Multimedia en octubre: julio a septiembre siguen pagos',bn2.periods.filter(p=>p.per<='2026-09').every(p=>p.rest===0&&p.price===20000),bn2.periods.map(p=>[p.per,p.price,p.rest]));
t('y octubre ya incluye el servicio',bn2.periods.find(p=>p.per==='2026-10').price===35000&&bn2.price===35000);
t('estado del cliente por mes',stateAt(cn,'2026-09').extras.length===0&&stateAt(cn,'2026-10').extras.length===1);
// cambio de plan del cliente con historial
reset();S.planes.set('p2',{id:'p2',nombre:'Hogar 100',bajada:100,subida:50,precio:30000});
const cp=mk('cp',{desde:'2026-08',planId:'p2',hp:[{h:'2026-09',planId:'p1',precio:null,extras:[]}]});S.clientes.set('cp',cp);pay('cp','2026-08',20000);pay('cp','2026-09',20000);rebuildDerived();
const bp=billing(cp);
t('cambio de plan en octubre: agosto y septiembre conservan el plan anterior',bp.periods.find(p=>p.per==='2026-09').rest===0&&bp.periods.find(p=>p.per==='2026-10').price===30000,bp.periods.map(p=>[p.per,p.price,p.rest]));
// precio especial del cliente reemplaza el plan en el mes que corresponde
const cq=mk('cq',{desde:'2026-08',precio:15000,hp:[{h:'2026-08',planId:'p1',precio:null,extras:[]}]});
t('precio especial desde septiembre, agosto a precio de lista',priceBaseAt(cq,'2026-08')===20000&&priceBaseAt(cq,'2026-09')===15000);
// corrección: Plan_15 guardado en 17 por error
S.planes.set('p15',{id:'p15',nombre:'Plan_15',bajada:15,subida:5,precio:17});
reset();const cr=mk('cr',{planId:'p15',desde:'2026-09'});S.clientes.set('cr',cr);rebuildDerived();
t('con el precio mal cargado ($17) la deuda es $17',billing(cr).periods[0].price===17);
S.planes.set('p15',{id:'p15',nombre:'Plan_15',bajada:15,subida:5,precio:17000});S.billCache.clear();
t('al corregirlo (sin historial) rige en todos los meses',billing(cr).periods.every(p=>p.price===17000));

// importacion de servicios
const rows2=parseCsv('nombre;plan;servicios\\nAna;Hogar;Multimedia + Multimedia Net\\nLuis;Hogar;multimedia_net\\nPedro;Hogar;\\nSofi;Hogar;Multimedia y Netflix');
S.planes.set('p1',{id:'p1',nombre:'Hogar',bajada:50,subida:25,precio:20000});
const a2=analyzeImport(rows2,{estado:'activo',desde:'2026-10',ciclo:1});
t('import: servicios combinados, uno solo, vacio y desconocido',JSON.stringify(a2.recs.map(r=>r.extras))==='[["multimedia","multimedia_net"],["multimedia_net"],[],["multimedia"]]'&&a2.serviciosFalta.has('Netflix'),[a2.recs.map(r=>r.extras),[...a2.serviciosFalta]]);
console.log(out.join('\\n'));
`;
const LS={};
const el=()=>({addEventListener(){},set innerHTML(v){},get innerHTML(){return ''},style:{},hidden:false,textContent:'',classList:{add(){},remove(){}},querySelector(){return null},querySelectorAll(){return []}});
const ctx={console,LS,document:{addEventListener(){},getElementById(){return null},querySelector:el,querySelectorAll(){return []},createElement:el,body:{appendChild(){}}},window:{addEventListener(){}},fetch:()=>Promise.reject(new Error('sin red')),localStorage:{getItem(k){return null},setItem(){}},navigator:{},setTimeout,setInterval:()=>0,Intl,Date,Math,JSON,TextEncoder,Uint8Array,Array,Promise,crypto:require('crypto').webcrypto,FileReader:function(){}};
ctx.window=ctx;ctx.addEventListener=()=>{};vm.createContext(ctx);
vm.runInContext(src+'\n'+test,ctx);
