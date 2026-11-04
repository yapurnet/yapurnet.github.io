'use strict';
/* Completar la IP de los clientes ya cargados con los exports .rsc de los routers: lectura del archivo y emparejamiento. */
const fs = require('fs'), vm = require('vm');
const dir = __dirname + '/../app/src/';
const src = ['p04_core.js', 'p05_clients.js','p05c_comodato.js', 'p05b_red.js', 'p06_plans_settings.js', 'p06b_import.js', 'p06d_routers.js', 'p07_orders.js', 'p08_pay.js'].map(f => fs.readFileSync(dir + f, 'utf8')).join('\n');
const test = String.raw`
const out=[];const t=(n,ok,x)=>out.push((ok?'ok   ':'FAIL ')+n+(ok?'':' -> '+JSON.stringify(x)));
const ADMIN=[
 '# nov/02/2026 10:00:00 by RouterOS 6.49.10',
 '/ip pool add name=p1 ranges=10.0.0.2-10.0.0.9',
 '/queue simple add max-limit=10M/10M name="Mu\\C3\\B1oz Ana-12" target=10.1.0.5/32 comment="00012 - Mu\\C3\\B1oz Ana"',
 '/queue simple add max-limit=10M/10M name="Casta\\F1o Luis" target=10.1.0.6/32',
 '/queue simple add name="Rojas Ines" target=10.1.0.8/32 \\',
 '    comment="Ines Rojas" max-limit=5M/5M disabled=yes',
 '/queue simple add name="Vlan Leandro" target=vlan102_Leandro',
 '/queue simple add name="Sosa Raul" target=10.1.0.20/32',
 '/queue simple add name="Sosa Raul" target=10.1.0.21/32',
 '/queue simple add name="Eva Lopez" target=10.1.0.30/32',
 '/queue simple add name="Usada Uno" target=10.1.0.40/32',
 '/ppp secret add name=jperez@yapur password=SECRETO123 profile=p1 service=pppoe remote-address=10.1.0.7 comment="Juan Perez"',
 '/ip dhcp-server lease add address=10.1.0.9 mac-address=AA:BB:CC:DD:EE:01 comment="Pedro Diaz" server=s1',
 '/ip dhcp-server lease add address=10.1.0.10 comment="Gomez Lopez Marta" server=s1',
 '/interface wireless security-profiles add name=wifi wpa2-pre-shared-key=CLAVEWIFI99 mode=dynamic-keys'].join('\r\n');
const FM=['/queue simple','add name="Beto Bos" target=192.168.101.4/32 comment="Bos Beto"','/ppp secret','add name=mgarcia@yapur password=OTRA777 service=pppoe remote-address=192.168.101.9'].join('\n');
const LA=rscLines(ADMIN),LF=rscLines(FM);
t('rsc: lee colas, PPPoE y DHCP del export (y nada más)',LA.filter(l=>l[0]==='Q').length===8&&LA.filter(l=>l[0]==='P').length===1&&LA.filter(l=>l[0]==='D').length===2&&LA.length===11,LA.map(l=>l[0]).join(''));
t('rsc: las contraseñas y claves del archivo nunca pasan',!/SECRETO123|CLAVEWIFI99|OTRA777|password|pre-shared/i.test(JSON.stringify(LA)+JSON.stringify(LF)));
t('rsc: decodifica \\C3\\B1 (UTF-8) y \\F1 (Latin-1) como ñ',LA[0][1]==='Muñoz Ana-12'&&LA[0][6]==='00012 - Muñoz Ana'&&LA[1][1]==='Castaño Luis',[LA[0],LA[1]]);
t('rsc: une las líneas cortadas con «\\» y lee disabled',LA[2][1]==='Rojas Ines'&&LA[2][6]==='Ines Rojas'&&LA[2][3]==='5M/5M'&&LA[2][4]==='true',LA[2]);
t('rsc: también lee el formato con la ruta aparte (RouterOS 7)',LF.length===2&&LF[0][0]==='Q'&&LF[0][2]==='192.168.101.4/32'&&LF[1][0]==='P'&&LF[1][4]==='192.168.101.9',LF);
t('rsc: el nombre del router sale del archivo',rscRouter('admin-31-10-26.rsc')==='admin'&&rscRouter('fm.rsc')==='fm'&&rscRouter('Leo 02-11-2026.rsc')==='Leo'&&rscRouter('bomberos_31.10.26.rsc')==='bomberos');
const bA=rtBuild(LA);bA.items.forEach(x=>x.router='admin');const bF=rtBuild(LF);bF.items.forEach(x=>x.router='fm');
t('rsc: la cola hacia una interfaz no es un cliente',bA.otros===1);
t('rsc: cada cliente conserva todos los nombres con que aparece',(bA.items.find(e=>e.ip==='10.1.0.5').alias||[]).includes('Muñoz Ana-12')&&bA.items.find(e=>e.ip==='10.1.0.5').alias.includes('00012 - Muñoz Ana')&&bF.items.find(e=>e.ip==='192.168.101.4').alias.includes('Bos Beto'),bA.items.map(e=>e.alias));
S.clientes.clear();
const C=(id,nombre,o)=>S.clientes.set(id,Object.assign({id,nombre,estado:'activo'},o||{}));
C('k1','Ana Muñoz');C('k2','CASTAÑO LUIS');C('k3','Rojas, Ines');C('k4','Cliente Con Otro Nombre',{usuario:'jperez@yapur'});C('k5','Diaz Pedro Alberto');
C('k6','Gomez Marta Elena');C('k7','Sosa Raul');C('k8','Lopez Eva');C('k9','Eva Lopez Casa');C('k10','Torres Ivan',{ip:'10.1.0.99'});C('k11','Ex Cliente',{estado:'baja'});
C('k12','Nadie Nunca');C('k13','Usada Uno');C('k14','Otro Dueño',{ip:'10.1.0.40'});C('k15','Bos Beto');C('k16','Garcia Mario',{usuario:'mgarcia@yapur'});C('k17','Pedro Dias');
const before=JSON.stringify([...S.clientes.values()]);
const R=rtCompletarIp(bA.items.concat(bF.items),[...S.clientes.values()]);
const row=id=>R.rows.find(r=>r.id===id);
t('IP: no toca a los clientes (solo devuelve propuestas)',JSON.stringify([...S.clientes.values()])===before);
t('IP: mismo nombre en otro orden y con tildes → seguro',row('k1')&&row('k1').tier==='seguro'&&row('k1').opts[0].ip==='10.1.0.5'&&row('k1').marcado===true,row('k1'));
t('IP: nombre con ñ leído en Latin-1 y en mayúsculas → seguro',row('k2')&&row('k2').tier==='seguro'&&row('k2').opts[0].ip==='10.1.0.6',row('k2'));
t('IP: cola deshabilitada, unida en dos líneas, nombre con coma → seguro',row('k3')&&row('k3').tier==='seguro'&&row('k3').opts[0].ip==='10.1.0.8',row('k3'));
t('IP: mismo usuario PPPoE aunque el nombre no se parezca → seguro',row('k4')&&row('k4').tier==='seguro'&&row('k4').opts[0].ip==='10.1.0.7',row('k4'));
t('IP: un nombre dentro del otro (Diaz Pedro Alberto / Pedro Diaz) → parecido y marcado',row('k5')&&row('k5').tier==='parecido'&&row('k5').opts[0].ip==='10.1.0.9'&&row('k5').marcado===true,row('k5'));
t('IP: dos palabras iguales y una distinta → a revisar, sin marcar, con su IP para elegir',row('k6')&&row('k6').tier==='revisar'&&row('k6').marcado===false&&row('k6').opts[0].ip==='10.1.0.10',row('k6'));
t('IP: varias IP para el mismo nombre → a revisar con las dos opciones',row('k7')&&row('k7').tier==='revisar'&&row('k7').opts.map(o=>o.ip).sort().join()==='10.1.0.20,10.1.0.21'&&!row('k7').marcado,row('k7'));
t('IP: dos clientes que reclaman la misma IP → los dos a revisar y sin marcar',row('k8')&&row('k9')&&row('k8').tier==='revisar'&&row('k9').tier==='revisar'&&!row('k8').marcado&&!row('k9').marcado,[row('k8'),row('k9')]);
t('IP: ya tienen IP y las bajas no se tocan, y se cuentan',!row('k10')&&!row('k11')&&R.yaTienen===2&&R.bajas===1,[R.yaTienen,R.bajas]);
t('IP: una IP que ya tiene otro cliente no se ofrece (queda sin coincidencia)',!row('k13')&&R.sin.some(c=>c.id==='k13'),R.sin.map(c=>c.id));
t('IP: sin coincidencia',R.sin.some(c=>c.id==='k12'));
t('IP: nombres de los dos archivos y usuario PPPoE de otro router',row('k15')&&row('k15').opts[0].ip==='192.168.101.4'&&row('k15').opts[0].router==='fm'&&row('k16')&&row('k16').opts[0].ip==='192.168.101.9',[row('k15'),row('k16')]);
t('IP: «Pedro Dias» (tipeo) se ofrece a revisar',row('k17')&&row('k17').tier==='revisar'&&row('k17').opts[0].ip==='10.1.0.9',row('k17'));
t('IP: cada fila trae lo necesario para guardar (id, bloque y IP)',R.rows.every(r=>r.id&&/^c\d\d$/.test(r.shard)&&r.opts.length&&/^\d+\.\d+\.\d+\.\d+$/.test(r.opts[0].ip)),R.rows.map(r=>r.shard));
{
  const L=n=>{let s='';n++;while(n>0){s=String.fromCharCode(97+(n-1)%26)+s;n=Math.floor((n-1)/26);}return s;};   /* palabras distintas para cada persona */
  const items=[],cl=[];
  for(let i=0;i<3000;i++)items.push({ip:'10.'+(i>>8)+'.'+(i&255)+'.1',nombre:'nom'+L(i)+' ape'+L(i*7+3),alias:['nom'+L(i)+' ape'+L(i*7+3)+'-'+i],tipo:'fija',router:'x'});
  for(let i=0;i<5000;i++)cl.push({id:'z'+i,nombre:i<3000?'ape'+L(i*7+3)+' nom'+L(i):'otro'+L(i)+' sin'+L(i+9),estado:'activo'});
  const t0=Date.now(),r2=rtCompletarIp(items,cl),ms=Date.now()-t0;
  t('IP: 5.000 clientes contra 3.000 IP se procesan en menos de 8 s y los 3.000 que existen se emparejan',ms<8000&&r2.rows.filter(r=>r.tier==='seguro').length===3000&&r2.sin.length===2000,[ms,r2.rows.length,r2.sin.length]);
}
console.log(out.join('\n'));
`;
const ctx = { console, document: { addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, createElement() { return { style: {} }; } }, window: {}, localStorage: { getItem() { return null; }, setItem() {} }, navigator: {}, setTimeout, Intl, Date, Math, FileReader: function () {} };
ctx.window = ctx; vm.createContext(ctx);
const lines = [];
ctx.console = { log: s => lines.push(String(s)) };
vm.runInContext(src + '\n' + test, ctx);
const txt = lines.join('\n');
console.log(txt);
const bad = (txt.match(/^FAIL /gm) || []).length;
console.log(`\n${(txt.match(/^ok /gm) || []).length} ok, ${bad} con fallas`);
process.exit(bad ? 1 : 0);
