'use strict';
/* Cuenta unificada (una empresa con varios servicios o sucursales) y DNI / CUIT / CUIL: la lógica, sin pantalla.
   El caso de Manaos distribuidora: la principal y tres servicios de la dueña (dos en ciclo 2) que se cobran juntos y salen en un solo recibo. */
const fs=require('fs'),vm=require('vm');
const dir=__dirname+'/../app/src/';
const src="const NET={on(){},init:()=>new Promise(()=>{}),native:false,base:'',plugin(){return null},me:null,online:false};\n"+['p04_core.js','p05_clients.js','p05b_red.js','p06_plans_settings.js','p06c_profiles.js','p06e_devices.js','p06b_import.js','p06d_routers.js','p07_orders.js','p08_pay.js','p09_boot.js','p09c_update.js','p09b_boot.js'].map(f=>fs.readFileSync(dir+f,'utf8')).join('\n');
const test=`
const out=[];const t=(n,ok,x)=>out.push((ok?'ok   ':'FAIL ')+n+(ok?'':' -> '+JSON.stringify(x)));
S.perms={cobrar:true,caja:true,promesas:true,clientesTodos:true,telefono:true,dni:true,editarClientes:true,ubicacion:true,precios:true};
S.ajustes.empresa='YAPUR.NET';
const cur=todayStr().slice(0,7),prev=addMonths(cur,-1);

// --- DNI, CUIT y CUIL ---
t('fmtDoc: un CUIT escrito con espacios y guiones sale 27-23373806-4',fmtDoc('27- 23373806-4')==='27-23373806-4'&&fmtDoc('27233738064')==='27-23373806-4'&&fmtDoc(' 27.23373806.4 ')==='27-23373806-4',[fmtDoc('27- 23373806-4'),fmtDoc('27233738064')]);
t('fmtDoc: un DNI (con o sin puntos) se deja como lo escribieron',fmtDoc('28354900')==='28354900'&&fmtDoc('23.373.806')==='23.373.806'&&fmtDoc('')===''&&fmtDoc(null)==='');
t('fmtDoc: texto con letras no se toca',fmtDoc('CUIT 27233738064')==='CUIT 27233738064');
t('cuitOk: el CUIT 27-23373806-4 es válido y uno con un dígito cambiado no',cuitOk('27-23373806-4')&&cuitOk('20111111112')&&!cuitOk('27-23373806-5')&&!cuitOk('28354900'));

// --- la cuenta: Manaos y las tres conexiones de la dueña ---
S.planes.set('p20',{id:'p20',nombre:'Plan 20',bajada:20,subida:10,precio:23000});
const mk=(id,nombre,o)=>{const c=Object.assign({id,nombre,estado:'activo',planId:'p20',desde:prev,ciclo:1,dni:'',dir:'',tel:''},o||{});S.clientes.set(id,c);return c;};
mk('man','Manaos distribuidora',{dni:'27-23373806-4',tel:'3844 56-2605',dir:'Belgrano 100',precio:23000,planId:null});
mk('pc','Pachilla Maria Carolina (C. Central)',{cuenta:'man',dni:'23373806'});
mk('pe','Pachilla Maria Carolina suc. España',{cuenta:'man',ciclo:2,dir:'España 450'});
mk('pf','Pachilla Maria Carolina FM',{cuenta:'man',ciclo:2});
mk('otro','Lopez Eva');
rebuildDerived();
const ids=l=>l.map(x=>x.id).join(',');
t('la principal y sus servicios se arman juntos, la principal primero',ids(cuentaMiembros(S.clientes.get('man')))==='man,pc,pf,pe'||ids(cuentaMiembros(S.clientes.get('man')))==='man,pc,pe,pf',ids(cuentaMiembros(S.clientes.get('man'))));
t('desde cualquier servicio se llega a la misma cuenta',ids(cuentaMiembros(S.clientes.get('pf')))===ids(cuentaMiembros(S.clientes.get('man')))&&cuentaHead(S.clientes.get('pe')).id==='man');
t('un cliente suelto no es una cuenta',cuentaMiembros(S.clientes.get('otro')).length===0&&!enCuenta(S.clientes.get('otro'))&&cuentaHead(S.clientes.get('otro')).id==='otro');
t('toda la cuenta sigue el ciclo de la principal (los de ciclo 2 pasan al 1)',cicloOf(S.clientes.get('pe'))===1&&cicloOf(S.clientes.get('pf'))===1&&cicloOf(S.clientes.get('man'))===1);
S.clientes.get('man').ciclo=2;rebuildDerived();
t('si la principal cambia de ciclo, cambian todos',cicloOf(S.clientes.get('pc'))===2&&billing(S.clientes.get('pc')).periods[0].due.endsWith('-20'),billing(S.clientes.get('pc')).periods[0]);
S.clientes.get('man').ciclo=1;rebuildDerived();
t('un servicio cuya principal no existe se cobra solo',cicloOf({id:'x',cuenta:'nadie',ciclo:2})===2&&cuentaMiembros({id:'x',cuenta:'nadie'}).length===0);
t('una cadena (principal que a su vez está en otra cuenta) no se sigue: queda suelto',(()=>{mk('z1','Z uno',{cuenta:'z2'});mk('z2','Z dos',{cuenta:'man'});rebuildDerived();const r=cuentaHead(S.clientes.get('z1')).id==='z1';S.clientes.delete('z1');S.clientes.delete('z2');rebuildDerived();return r;})());
// cada servicio conserva su facturación
const bpc=billing(S.clientes.get('pc'),true),bm=billing(S.clientes.get('man'),true);
t('cada servicio factura lo suyo: 23.000 por mes cada uno',bpc.price===23000&&bm.price===23000&&bpc.periods.length===3,[bpc.price,bm.price,bpc.periods.length]);

// --- cobro de la cuenta: reparto entre servicios ---
const todos=['man','pc','pe','pf'].map(id=>({cid:id,per:cur,rest:23000}));
let al=allocate(todos,92000);
t('allocate: guarda a qué servicio va cada pago',al.length===4&&al.every(a=>a.cid&&a.monto===23000)&&ids(al.map(a=>({id:a.cid})))==='man,pc,pe,pf',al);
al=allocate(todos,50000);
t('allocate: pago parcial cubre los primeros servicios y deja lo demás pendiente',al.length===3&&al[2].monto===4000&&al[2].cid==='pe',al);
t('allocate: sin cid sigue igual que antes (un solo cliente)',JSON.stringify(allocate([{per:'2026-08',rest:15000}],15000))==='[{"per":"2026-08","monto":15000}]');

// --- recibo único de la cuenta ---
const R='R261104-CTA',base={recibo:R,fecha:cur+'-04',hora:'09:30',metodo:'efectivo',concepto:'mensualidad',per:cur};
['man','pc','pe','pf'].forEach((id,i)=>S.pagos.set('q'+i,Object.assign({id:'q'+i,c:id,monto:23000},base)));
rebuildDerived();
const d=receiptData(R),rt=receiptText(R);
t('recibo de la cuenta: un solo comprobante con el total de los cuatro servicios',d.total===92000&&rt.includes('IMPORTE TOTAL: ')&&rt.includes('92.000'),d.total);
t('recibo de la cuenta: los 4 servicios iguales salen en UN renglón (cant. 4 x 23.000), para que entre en media hoja',d.lineas.length===1&&d.lineas[0].cant===4&&d.lineas[0].unit===23000&&d.lineas[0].desc.includes('4 conexiones')&&d.lineas[0].desc.includes(monthLabel(cur).toLowerCase())&&rt.includes('x4')&&rt.includes('4 conexiones'),d.lineas);
t('recibo de la cuenta: va a nombre de la principal con su CUIT',d.cliente.nombre==='Manaos distribuidora'&&d.cliente.dni==='27-23373806-4'&&rt.includes('DNI / CUIT / CUIL: 27-23373806-4')&&rt.includes('Cliente: Manaos distribuidora'),d.cliente);
// si los servicios no son iguales, cada distinto lleva el nombre de su servicio y solo se juntan los iguales
const R2='R261104-MIX';
[['man',23000],['pc',23000],['pe',23000],['pf',30000]].forEach(([id,m],i)=>S.pagos.set('x'+i,Object.assign({id:'x'+i,c:id,monto:m},base,{recibo:R2})));
rebuildDerived();
const dmx=receiptData(R2);
t('recibo de la cuenta: con precios distintos junta los iguales y deja aparte el distinto con su nombre',dmx.total===99000&&dmx.lineas.length===2&&dmx.lineas[0].cant===3&&dmx.lineas[0].desc.includes('3 conexiones')&&dmx.lineas[1].cant===1&&dmx.lineas[1].unit===30000&&dmx.lineas[1].desc.includes('Carolina FM'),dmx.lineas);
for(const k of ['x0','x1','x2','x3'])S.pagos.delete(k);rebuildDerived();
t('recibo de la cuenta: el período sale con el ciclo de la cuenta (1: del 01 al 01 siguiente, vto. 10)',d.periodo&&d.periodo.desde===cur+'-01'&&d.periodo.vto===addMonths(cur,1)+'-10',d.periodo);
t('recibo de la cuenta: el HTML lleva el CUIT y la cantidad',receiptHTML(d).includes('27-23373806-4')&&receiptHTML(d).includes('4 conexiones'));
// un pago de un solo servicio mantiene su nombre y no cambia (los recibos viejos se reimprimen igual)
S.pagos.set('v1',Object.assign({id:'v1',c:'pf',monto:23000},base,{recibo:'R-VIEJO',per:prev}));rebuildDerived();
const dv=receiptData('R-VIEJO');
t('recibo de un solo servicio: sigue a nombre de ese servicio, sin sufijo',dv.cliente.nombre==='Pachilla Maria Carolina FM'&&!dv.lineas[0].desc.includes(' - Pachilla'),[dv.cliente,dv.lineas]);
// los cobros de la cuenta se ven en cada servicio
t('cada servicio ve lo cobrado en el recibo de la cuenta',billing(S.clientes.get('pe')).periods.find(p=>p.per===cur).rest===0&&billing(S.clientes.get('pf')).periods.find(p=>p.per===prev).rest===0);

// --- búsqueda ---
const q=txt=>searchClients(txt).map(c=>c.id).sort().join(',');
t('buscar por el nombre de la empresa encuentra todos sus servicios',q('manaos')==='man,pc,pe,pf',q('manaos'));
t('buscar el CUIT con guiones o sin nada encuentra la empresa (y el DNI de la dueña, sus dos conexiones con ese DNI)',q('27-23373806-4')==='man'&&q('27233738064')==='man'&&q('23373806')==='man,pc',[q('27-23373806-4'),q('27233738064'),q('23373806')]);
S.perms.dni=false;S.clientes.forEach(c=>{delete c._hay;});
t('sin permiso para ver DNI, el CUIT no se puede buscar',q('27233738064')==='',q('27233738064'));
S.perms.dni=true;S.clientes.forEach(c=>{delete c._hay;});
// la lista marca la cuenta
const ch=cuentaChip(S.clientes.get('pf')),chm=cuentaChip(S.clientes.get('man'));
t('la lista marca la cuenta: «Cuenta: empresa» en el servicio y «Cuenta · 4 servicios» en la principal',ch.includes('Cuenta: Manaos distribuidora')&&chm.includes('Cuenta · 4 servicios')&&cuentaChip(S.clientes.get('otro'))==='',[ch,chm]);
// la ficha muestra la cuenta con la dirección y la ubicación de cada servicio
const blk=cuentaBlock(S.clientes.get('pe'));
t('la ficha lista los servicios con domicilio y ubicación',blk.includes('Cuenta unificada')&&blk.includes('España 450')&&blk.includes('Sin domicilio')&&blk.includes('Cargar ubicación')&&blk.includes('4 servicios'),blk.slice(0,300));
t('un cliente suelto no muestra bloque en la ficha (tiene su botón «Cuenta unificada»)',cuentaBlock(S.clientes.get('otro'))==='');
S.perms.editarClientes=false;S.perms.cobrar=false;S.perms.caja=false;
t('quien no cobra ni edita no ve la cuenta',cuentaBlock(S.clientes.get('pe'))===''&&cuentaChip(S.clientes.get('pe'))==='');
S.perms.editarClientes=true;S.perms.cobrar=true;S.perms.caja=true;

// --- importar: el CUIT queda con guiones ---
const a=analyzeImport([['Nombre','D.N.I  / CUIT','Ciclo'],['Empresa Uno SRL','27233738064','1 al 10'],['Juan Perez','28.354.900','13 al 20']],{estado:'activo',desde:cur,ciclo:1});
t('importar: un CUIT sin guiones se guarda 27-23373806-4 y un DNI queda igual',a.recs.length===2&&a.recs[0].dni==='27-23373806-4'&&a.recs[1].dni==='28.354.900',a.recs.map(r=>r.dni));
// reporte del técnico: CUIT también
const rp=parseReporte('NOMBRE: Empresa Dos\\nCUIT: 27-23373806-4\\nIP: 10.0.0.5');
t('reporte del técnico: acepta CUIT y lo guarda con guiones',rp.dni==='27-23373806-4'&&parseReporte('DNI: 28.354.900').dni==='28354900',rp);
console.log(out.join('\\n'));console.log('\\n'+out.filter(x=>x.startsWith('ok')).length+' ok, '+out.filter(x=>x.startsWith('FAIL')).length+' con fallas');
`;
const LS={};
const el=()=>({addEventListener(){},set innerHTML(v){},get innerHTML(){return ''},style:{},hidden:false,textContent:'',classList:{add(){},remove(){}},querySelector(){return null},querySelectorAll(){return []}});
const ctx={console,LS,document:{addEventListener(){},getElementById(){return null},querySelector:el,querySelectorAll(){return []},createElement:el,body:{appendChild(){}}},window:{addEventListener(){}},fetch:()=>Promise.reject(new Error('sin red')),localStorage:{getItem(k){return null},setItem(){}},navigator:{},setTimeout,setInterval:()=>0,Intl,Date,Math,JSON,TextEncoder,Uint8Array,Array,Promise,crypto:require('crypto').webcrypto,FileReader:function(){}};
ctx.window=ctx;ctx.addEventListener=()=>{};vm.createContext(ctx);
let bad=0;
const log=ctx.console.log;ctx.console={log:(...a)=>{const s=a.join(' ');bad+=(s.match(/^FAIL/gm)||[]).length;log(s);}};
vm.runInContext(src+'\n'+test,ctx);
process.exit(bad?1:0);
