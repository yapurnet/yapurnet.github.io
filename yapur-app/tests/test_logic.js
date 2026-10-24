const fs=require('fs'),vm=require('vm');
const dir=__dirname+'/../app/src/';
const src=['p04_core.js','p05_clients.js','p05b_red.js','p06_plans_settings.js','p06b_import.js','p07_orders.js','p08_pay.js'].map(f=>fs.readFileSync(dir+f,'utf8')).join('\n');
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
console.log(out.join('\\n'));
`;
const ctx={console,document:{addEventListener(){},querySelector(){return null},querySelectorAll(){return []},createElement(){return {style:{}}}},window:{},localStorage:{getItem(){return null},setItem(){}},navigator:{},setTimeout,Intl,Date,Math,FileReader:function(){}};
ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(src+'\n'+test,ctx);
