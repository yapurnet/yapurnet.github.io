'use strict';
/* ===== utilidades ===== */
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const fmtMoney=n=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',minimumFractionDigits:0,maximumFractionDigits:2}).format(Number(n)||0);
let _today=null;const setToday=d=>{_today=d;};
const todayStr=()=>{if(_today)return _today;const d=new Date();return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());};
const nowTime=()=>{const d=new Date();return pad(d.getHours())+':'+pad(d.getMinutes());};
const addMonths=(ym,n)=>{let [y,m]=ym.split('-').map(Number);m+=n;y+=Math.floor((m-1)/12);m=((m-1)%12+12)%12+1;return y+'-'+pad(m);};
const daysIn=ym=>{const [y,m]=ym.split('-').map(Number);return new Date(y,m,0).getDate();};
const monthLabel=ym=>{const [y,m]=ym.split('-').map(Number);const s=new Date(y,m-1,1).toLocaleDateString('es-AR',{month:'long',year:'numeric'});return s.charAt(0).toUpperCase()+s.slice(1);};
const monthShort=ym=>{const [y,m]=ym.split('-').map(Number);return new Date(y,m-1,1).toLocaleDateString('es-AR',{month:'short'}).replace('.','');};
const dateLabel=d=>{if(!d)return '';const [y,m,dd]=d.split('-').map(Number);return new Date(y,m-1,dd).toLocaleDateString('es-AR',{weekday:'short',day:'numeric',month:'short'});};
const dmy=d=>d?d.split('-').reverse().join('/'):'';
const newId=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const norm=s=>String(s==null?'':s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
/* Número con formato argentino: 17.000 = 17000 · 17.000,50 = 17000.5 · 17,5 = 17.5 · 17000 = 17000 */
const num=v=>{
  let s=String(v==null?'':v).trim().replace(/[^\d.,\-]/g,'');if(!s)return null;
  const dot=s.includes('.'),com=s.includes(',');
  if(dot&&com)s=s.lastIndexOf(',')>s.lastIndexOf('.')?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');
  else if(com)s=s.replace(',','.');
  else if(dot&&/^-?\d{1,3}(\.\d{3})+$/.test(s))s=s.replace(/\./g,'');
  const n=parseFloat(s);return isFinite(n)?n:null;
};
/* campo de dinero: muestra cómo se entiende lo que se escribe */
function bindMoney(inp,hintEl){
  if(!inp||!hintEl)return;
  const f=()=>{const raw=inp.value.trim(),n=num(raw);hintEl.textContent=raw===''?'':(n===null?'No se entiende el número.':'Se guarda '+fmtMoney(n)+'.');};
  inp.addEventListener('input',f);f();
}
const lsGet=k=>{try{return localStorage.getItem(k);}catch(e){return null;}};
const lsSet=(k,v)=>{try{localStorage.setItem(k,v);}catch(e){}};

/* ===== catálogos ===== */
const ESTADOS={activo:'Activo',suspendido:'Suspendido',pendiente:'Por instalar',baja:'Baja'};
const TECNOS={fibra:'Fibra óptica',wireless:'Antena wireless'};
const TIPOS_ORD={instalacion:'Instalación',falla:'Falla o reparación',cambio_plan:'Cambio de plan',reconexion:'Reconexión',retiro:'Retiro de equipo',visita:'Visita técnica'};
const EST_ORD={pendiente:'Pendiente',en_camino:'En camino',en_curso:'En curso',hecha:'Hecha',cancelada:'Cancelada'};
const METODOS={efectivo:'Efectivo',transferencia:'Transferencia',mercadopago:'Mercado Pago',otro:'Otro'};
const CONCEPTOS={mensualidad:'Mensualidad',instalacion:'Instalación',reconexion:'Reconexión',otro:'Otro'};

/* ===== estado global ===== */
const S={
  db:null,me:null,ready:false,uid:null,
  realRole:'tecnico',role:'tecnico',tab:'',perfil:null,preview:false,gate:false,perms:{},pv:0,
  ajustes:{empresa:'YAPUR.NET',tecnicos:[],perfiles:[],diaVenc:10,ciclos:null,feriados:null,servicios:null,promesaMax:10},
  planes:new Map(),clientes:new Map(),ordenes:new Map(),pagos:new Map(),
  loaded:{ajustes:false,planes:false,clientes:false,ordenes:false,pagos:false},
  errors:{},paidIdx:new Map(),payByClient:new Map(),billCache:new Map(),cutCache:new Map(),
  tecId:''
};
const RANK={tecnico:1,oficina:2,admin:3};
const ROLE_NAME={tecnico:'Técnico',oficina:'Oficina',admin:'Administrador'};
/* permisos que el administrador activa o apaga en cada perfil: [clave, título, detalle, grupo] */
const PERMS=[
  ['clientesTodos','Ver todos los clientes','Apagado: solo ve los clientes de sus órdenes abiertas.','Clientes'],
  ['telefono','Ver teléfonos','','Clientes'],
  ['dni','Ver DNI','','Clientes'],
  ['editarClientes','Dar de alta y editar clientes','Ficha completa, plan, estado y facturación.','Clientes'],
  ['ubicacion','Cargar ubicaciones y datos técnicos','Coordenadas, usuario, nodo y equipo.','Clientes'],
  ['ordenesTodas','Ver y asignar las órdenes de todos','Apagado: solo ve las suyas y las que nadie tomó.','Órdenes'],
  ['crearOrdenes','Crear y editar órdenes','','Órdenes'],
  ['operarOrdenes','Cambiar el estado y cerrar órdenes','','Órdenes'],
  ['precios','Ver planes y precios','','Dinero'],
  ['cobrar','Registrar cobros','','Dinero'],
  ['caja','Ver la caja del día y los morosos','','Dinero'],
  ['anular','Anular recibos','','Dinero'],
  ['promesas','Dar promesas de pago','Posponer el corte unos días a un cliente que no llega a pagar.','Dinero'],
  ['resumen','Ver el resumen del negocio','','Dinero']
];
const MONEY_PERMS=['cobrar','caja','anular','promesas','resumen'];
const PERM_DEF={
  tecnico:{clientesTodos:false,telefono:true,dni:false,editarClientes:false,ubicacion:true,ordenesTodas:false,crearOrdenes:true,operarOrdenes:true,precios:false,cobrar:false,caja:false,anular:false,promesas:false,resumen:false},
  oficina:{clientesTodos:true,telefono:true,dni:true,editarClientes:true,ubicacion:true,ordenesTodas:true,crearOrdenes:true,operarOrdenes:true,precios:true,cobrar:true,caja:true,anular:false,promesas:true,resumen:false}
};
const can=k=>!!S.perms[k];
const isAdmin=()=>S.role==='admin'&&!S.preview;

/* ===== almacenamiento por lotes (shards) ===== */
const hash=s=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;};
const clientShard=id=>'c'+pad(hash(id)%16);
const payShard=(fecha,cid)=>fecha.slice(0,4)+'-s'+pad(hash(cid)%32);
const orderShard=ym=>ym;

function dbError(e){
  console.error(e);
  const c=e&&e.code;
  if(e&&e.network)toast('Sin conexión con el servidor. No se guardó: reintentá cuando vuelva la señal.','bad');
  else if(c==='quota_exceeded')toast('Se llenó el almacenamiento. Avisá al administrador.','bad');
  else if(c==='resource_exhausted')toast('Demasiadas operaciones seguidas. Esperá unos segundos.','bad');
  else if(e&&e.status&&e.message)toast(e.message,'bad');
  else toast('No se pudo guardar. Revisá la conexión y reintentá.','bad');
}
async function putMany(coll,docId,items){
  if(!S.db)throw {code:'unavailable'};
  await S.db.collection(coll).doc(docId).update({items});
}
const putItem=(coll,docId,id,obj)=>putMany(coll,docId,{[id]:obj});

function watchSharded(coll,target,key){
  return S.db.collection(coll).onSnapshot(snap=>{
    target.clear();
    snap.docs.forEach(d=>{const it=(d.data()||{}).items||{};for(const k in it){const v=it[k];if(v&&typeof v==='object')target.set(k,Object.assign({},v,{id:k,_doc:d.id}));}});
    S.loaded[key]=true;dataChanged(key);
  },err=>{S.errors[key]=err;S.loaded[key]=true;dataChanged(key);});
}

/* ===== cálculo de cobranzas ===== */
function rebuildDerived(){
  S.paidIdx=new Map();S.payByClient=new Map();S.billCache=new Map();S.cutCache=new Map();
  for(const p of S.pagos.values()){
    let l=S.payByClient.get(p.c);if(!l){l=[];S.payByClient.set(p.c,l);}l.push(p);
    if(p.anulado||p.concepto!=='mensualidad'||!p.per)continue;
    let m=S.paidIdx.get(p.c);if(!m){m=new Map();S.paidIdx.set(p.c,m);}
    m.set(p.per,(m.get(p.per)||0)+(Number(p.monto)||0));
  }
  for(const l of S.payByClient.values())l.sort((a,b)=>(b.fecha+(b.hora||'')).localeCompare(a.fecha+(a.hora||'')));
}
/* servicios adicionales (Multimedia, Multimedia Net…): se guardan en los ajustes; un cliente puede tener varios */
const SERVICIOS_DEF=[{id:'multimedia',nombre:'Multimedia',precio:15000,activo:true},{id:'multimedia_net',nombre:'Multimedia Net',precio:5000,activo:true}];
const serviciosList=()=>Array.isArray(S.ajustes.servicios)?S.ajustes.servicios:SERVICIOS_DEF;
function extrasOf(c){
  const ids=c&&Array.isArray(c.extras)?c.extras:[];const l=serviciosList();
  return ids.map(id=>l.find(s=>s.id===id)).filter(Boolean);
}
/* precio del plan de internet (el precio especial del cliente lo reemplaza) */
function priceBase(c){
  if(c.precio!==null&&c.precio!==undefined&&c.precio!==''&&isFinite(Number(c.precio)))return Number(c.precio);
  const p=S.planes.get(c.planId);return p?Number(p.precio)||0:0;
}
/* total mensual: plan de internet + servicios adicionales */
const priceOf=c=>priceBase(c)+extrasOf(c).reduce((t,s)=>t+(Number(s.precio)||0),0);
/* "Hogar 50 + Multimedia + Multimedia Net" */
function servicioTxt(c){
  const p=S.planes.get(c.planId);
  return [p?p.nombre:null].concat(extrasOf(c).map(s=>s.nombre)).filter(Boolean).join(' + ')||'Sin plan';
}
/* ----- ciclos de cobro y feriados ----- */
const CICLOS_DEF={1:{desde:1,hasta:10,corte:13},2:{desde:13,hasta:20,corte:23}};
function cicloCfg(n){
  const d=CICLOS_DEF[n]||CICLOS_DEF[1],o=(S.ajustes.ciclos&&S.ajustes.ciclos[n])||{};
  const g=k=>{const v=Number(o[k]);return v>=1&&v<=28?Math.floor(v):d[k];};
  return {desde:g('desde'),hasta:g('hasta'),corte:g('corte')};
}
const cicloOf=c=>c&&Number(c.ciclo)===2?2:1;
const cicloTxt=n=>{const k=cicloCfg(n);return `paga del ${k.desde} al ${k.hasta}, corte el ${k.corte}`;};
const dm=d=>d?d.slice(8,10)+'/'+d.slice(5,7):'';
const dateAdd=(d,n)=>{const [y,m,dd]=d.split('-').map(Number);const x=new Date(y,m-1,dd+n);return x.getFullYear()+'-'+pad(x.getMonth()+1)+'-'+pad(x.getDate());};
const dowOf=d=>{const [y,m,dd]=d.split('-').map(Number);return new Date(y,m-1,dd).getDay();};
const FERIADOS_DEF=[
  ['2026-01-01','Año Nuevo'],['2026-02-16','Carnaval'],['2026-02-17','Carnaval'],['2026-03-23','Día no laborable'],['2026-03-24','Día de la Memoria'],['2026-04-02','Malvinas'],['2026-04-03','Viernes Santo'],['2026-05-01','Día del Trabajador'],['2026-05-25','Revolución de Mayo'],['2026-06-15','Güemes (trasladado)'],['2026-06-20','Día de la Bandera'],['2026-07-09','Día de la Independencia'],['2026-07-10','Día no laborable'],['2026-08-17','San Martín'],['2026-10-12','Diversidad Cultural'],['2026-11-23','Soberanía Nacional (trasladado)'],['2026-12-07','Día no laborable'],['2026-12-08','Inmaculada Concepción'],['2026-12-25','Navidad'],
  ['2027-01-01','Año Nuevo'],['2027-02-08','Carnaval'],['2027-02-09','Carnaval'],['2027-03-24','Día de la Memoria'],['2027-03-26','Viernes Santo'],['2027-04-02','Malvinas'],['2027-05-25','Revolución de Mayo'],['2027-06-21','Güemes (trasladado)'],['2027-07-09','Día de la Independencia'],['2027-08-16','San Martín (trasladado)'],['2027-10-11','Diversidad Cultural (trasladado)'],['2027-12-08','Inmaculada Concepción']
];
const FER_DEF=FERIADOS_DEF.map(([f,n])=>({f,n}));
let _ferSrc=null,_ferMap=null;
const feriadosList=()=>Array.isArray(S.ajustes.feriados)?S.ajustes.feriados:FER_DEF;
function feriadosMap(){const l=feriadosList();if(l!==_ferSrc){_ferSrc=l;_ferMap=new Map(l.map(x=>[x.f,x.n||'Feriado']));}return _ferMap;}
/* motivo por el que un día no es hábil ('' si es hábil) */
function noHabil(d){const w=dowOf(d);if(w===0)return 'domingo';if(w===6)return 'sábado';return feriadosMap().get(d)||'';}
const corteBase=(per,cy)=>per+'-'+pad(Math.min(cicloCfg(cy).corte,daysIn(per)));
function corteFecha(per,cy){let d=corteBase(per,cy);for(let i=0;i<14&&noHabil(d);i++)d=dateAdd(d,1);return d;}
function corteNota(per,cy){const raw=corteBase(per,cy),why=noHabil(raw);return why?{raw,real:corteFecha(per,cy),why}:null;}
function proximoCorte(cy){
  const today=todayStr(),cur=today.slice(0,7);let per=cur,d=corteFecha(per,cy);
  if(d<today){per=addMonths(cur,1);d=corteFecha(per,cy);}
  return {per,fecha:d,nota:corteNota(per,cy)};
}

/* ----- facturación ----- */
function billing(c,withNext){
  const key=c.id+(withNext?'+':'');
  const hit=S.billCache.get(key);if(hit)return hit;
  const today=todayStr(),cur=today.slice(0,7);
  const out={price:priceOf(c),periods:[],vencidos:0,deuda:0,aplica:c.estado==='activo'||c.estado==='suspendido'};
  if(out.aplica){
    let from=c.desde||(c.alta?c.alta.slice(0,7):cur);
    const floor=addMonths(cur,-35);if(from<floor)from=floor;
    const paidMap=S.paidIdx.get(c.id)||new Map();
    const last=withNext?addMonths(cur,1):cur;
    const cy=cicloOf(c),cfg=cicloCfg(cy);
    for(let p=from;p<=last;p=addMonths(p,1)){
      const paid=paidMap.get(p)||0,rest=Math.max(0,out.price-paid);
      const due=p+'-'+pad(Math.min(cfg.hasta,daysIn(p)));
      const venc=due<today;
      out.periods.push({per:p,paid,rest,due,venc,desde:p+'-'+pad(Math.min(cfg.desde,daysIn(p))),cut:corteFecha(p,cy)});
      if(p<=cur&&rest>0&&venc){out.vencidos++;out.deuda+=rest;}
    }
  }
  S.billCache.set(key,out);return out;
}
/* promesa de pago: la última que no fue anulada */
function promesaActual(c){const l=c&&c.promesas;if(!Array.isArray(l))return null;for(let i=l.length-1;i>=0;i--)if(l[i]&&!l[i].x)return l[i];return null;}
/* Situación de corte de un cliente:
   ok · plazo (dentro del plazo de pago) · vencido (pasó el plazo, falta para el corte) · promesa (vigente)
   cortar (hay que cortarlo) · suspendido (ya cortado y sigue debiendo) */
function cutState(c){
  const hit=S.cutCache.get(c.id);if(hit)return hit;
  const today=todayStr(),cur=today.slice(0,7),b=billing(c);
  const r={k:'ok',b,first:null,corte:null,desde:null,hasta:null,motivo:'',pr:null};
  if(b.aplica&&b.price>0){
    const first=b.periods.find(p=>p.per<=cur&&p.rest>0);
    if(first){
      const pr=promesaActual(c);r.pr=pr;r.first=first;r.corte=first.cut;
      if(pr&&today<=pr.h){
        const after=dateAdd(pr.h,1);r.k='promesa';r.hasta=pr.h;r.desde=after>first.cut?after:first.cut;
      }else{
        const porPromesa=!!pr&&pr.h>=first.due&&pr.h>=first.cut;
        r.desde=porPromesa?dateAdd(pr.h,1):first.cut;
        if(today>=r.desde){
          r.k=c.estado==='suspendido'?'suspendido':'cortar';
          r.motivo=porPromesa?'Venció la promesa del '+dm(pr.h):'Pasó la fecha de corte del '+dm(first.cut);
        }else r.k=first.venc?'vencido':'plazo';
      }
    }
  }
  S.cutCache.set(c.id,r);return r;
}
/* suspendido por mora en la app y ya sin motivo para seguir cortado */
const aReconectar=c=>c.estado==='suspendido'&&!!c.corteMora&&['ok','plazo','vencido','promesa'].includes(cutState(c).k);
function cutLine(c){
  const s=cutState(c),b=s.b;if(!b.aplica||b.price<=0)return null;
  if(s.k==='suspendido')return {cls:'bad',txt:`Suspendido por falta de pago${c.corteMora?' desde el '+dmy(c.corteMora):''}. Debe ${fmtMoney(b.deuda)}.`};
  if(s.k==='cortar')return {cls:'bad',txt:`Hay que cortarlo (desde el ${dmy(s.desde)}). ${s.motivo}.`};
  if(s.k==='promesa')return {cls:'',txt:`Promesa de pago hasta el ${dmy(s.hasta)}. Si no paga, se suspende el ${dmy(s.desde)}.`};
  if(s.k==='vencido')return {cls:'',txt:`Pasó el plazo (${dm(s.first.due)}). Se corta el ${dmy(s.corte)} si no paga.`};
  if(s.k==='plazo')return {cls:'info',txt:`${monthLabel(s.first.per)}: paga del ${dm(s.first.desde)} al ${dm(s.first.due)}. Corte el ${dmy(s.corte)}.`};
  return null;
}
function billChip(c){
  if(!(can('cobrar')||can('caja')))return '';
  const s=cutState(c),b=s.b;if(!b.aplica)return '';
  if(b.price<=0)return '<span class="chip warn">Sin precio</span>';
  if(s.k==='cortar')return `<span class="chip bad">A cortar · ${fmtMoney(b.deuda)}</span>`;
  if(s.k==='promesa')return `<span class="chip warn">Promesa hasta ${dm(s.hasta)}</span>`;
  if(b.vencidos>0)return `<span class="chip bad">Debe ${b.vencidos} ${b.vencidos===1?'mes':'meses'} · ${fmtMoney(b.deuda)}</span>`;
  if(s.k==='plazo')return '<span class="chip info">Mes a vencer</span>';
  return '<span class="chip ok">Al día</span>';
}

/* ===== coordenadas y enlaces ===== */
function parseCoords(text){
  if(!text)return null;
  let t=String(text).trim().replace(/%2C/gi,',');
  if(/^-?\d+,\d+\s+-?\d+,\d+$/.test(t))t=t.replace(/,/g,'.');
  const m=t.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/)
    ||t.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)
    ||t.match(/[?&](?:q|ll|query|destination|center)=\+?(-?\d+(?:\.\d+)?),\s*\+?(-?\d+(?:\.\d+)?)/)
    ||t.match(/(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)/);
  if(!m)return null;
  let lat=parseFloat(m[1]),lng=parseFloat(m[2]);
  if(!isFinite(lat)||!isFinite(lng))return null;
  let fixed=false;
  if(lat>0&&lng>0&&lat>=21&&lat<=56&&lng>=53&&lng<=74){lat=-lat;lng=-lng;fixed=true;}
  if(Math.abs(lat)>90||Math.abs(lng)>180)return null;
  const inAR=lat<=-21&&lat>=-56&&lng<=-53&&lng>=-74;
  return {lat:+lat.toFixed(6),lng:+lng.toFixed(6),fixed,outside:!inAR};
}
const hasGeo=o=>!!o&&o.lat!==null&&o.lat!==undefined&&o.lat!==''&&o.lng!==null&&o.lng!==undefined&&o.lng!==''&&isFinite(parseFloat(o.lat))&&isFinite(parseFloat(o.lng));
const llStr=o=>parseFloat(o.lat).toFixed(6)+','+parseFloat(o.lng).toFixed(6);
const mapsView=o=>'https://www.google.com/maps/search/?api=1&query='+llStr(o);
const mapsNav=o=>'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination='+llStr(o);
const wazeNav=o=>'https://waze.com/ul?ll='+llStr(o)+'&navigate=yes';
function waNumber(tel){let d=String(tel||'').replace(/\D/g,'').replace(/^0+/,'');if(!d)return '';if(!d.startsWith('54'))d='54'+(d.startsWith('9')?'':'9')+d;return d;}
const waUrl=(tel,text)=>'https://wa.me/'+waNumber(tel)+'?text='+encodeURIComponent(text);
function geoActions(o){
  if(!hasGeo(o))return '<span class="chip warn">Sin ubicación cargada</span>';
  return `<a class="btn small primary" href="${mapsNav(o)}" target="_blank" rel="noopener">Cómo llegar</a>
  <a class="btn small" href="${wazeNav(o)}" target="_blank" rel="noopener">Waze</a>
  <a class="btn small" href="${mapsView(o)}" target="_blank" rel="noopener">Ver en mapa</a>
  <button class="btn small" type="button" data-copy="${llStr(o).replace(',',', ')}" data-copy-label="Coordenadas"><span class="mono">${parseFloat(o.lat).toFixed(5)}, ${parseFloat(o.lng).toFixed(5)}</span></button>`;
}

/* ===== modal, avisos, portapapeles ===== */
let modalCtl=null;
function openModal({title,html,onMount,onClose,wide}){
  closeModal();
  const root=$('#modalRoot');
  root.innerHTML=`<div class="scrim" data-close></div><section class="sheet${wide?' wide':''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header class="sheet-head"><h2>${esc(title)}</h2><button class="btn small ghost" type="button" data-close>Cerrar</button></header><div class="sheet-body">${html}</div></section>`;
  const body=$('.sheet-body',root);
  modalCtl={onClose};
  root.onclick=e=>{if(e.target.closest('[data-close]'))closeModal();};
  if(onMount)onMount(body);
  return body;
}
function closeModal(){
  const root=$('#modalRoot');if(!root||!root.firstChild)return;
  const cb=modalCtl&&modalCtl.onClose;modalCtl=null;root.innerHTML='';
  if(cb)cb();
}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
function askConfirm(msg,okLabel,danger){
  return new Promise(res=>{
    let done=false;const fin=v=>{if(!done){done=true;res(v);}};
    openModal({title:'Confirmar',html:`<p>${esc(msg)}</p><div class="actions"><button class="btn ghost" type="button" data-act="no">Cancelar</button><button class="btn ${danger?'danger':'primary'}" type="button" data-act="yes">${esc(okLabel||'Confirmar')}</button></div>`,
      onMount(el){el.addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(!b)return;fin(b.dataset.act==='yes');closeModal();});},
      onClose:()=>fin(false)});
  });
}
function toast(msg,kind){
  const el=document.createElement('div');el.className='toast '+(kind||'');el.textContent=msg;$('#toastRoot').appendChild(el);
  setTimeout(()=>el.classList.add('out'),3200);setTimeout(()=>el.remove(),3700);
}
async function copyText(t,label){
  try{await navigator.clipboard.writeText(t);toast((label||'Texto')+' copiado');return;}catch(e){}
  try{const ta=document.createElement('textarea');ta.value=t;ta.style.cssText='position:fixed;opacity:0';document.body.appendChild(ta);ta.select();const ok=document.execCommand('copy');ta.remove();if(ok){toast((label||'Texto')+' copiado');return;}}catch(e){}
  toast('No se pudo copiar. Seleccioná el texto a mano.','bad');
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-copy]');if(b){e.preventDefault();copyText(b.dataset.copy,b.dataset.copyLabel);}});
function saveFile(filename,data){
  return NET.saveFile(filename,data).then(r=>{toast(NET.native?'Guardado en Descargas: '+filename:'Archivo descargado');},err=>{console.error(err);const m=String(err&&err.message||'');toast(!m?'No se pudo guardar el archivo.':/^No se pudo/.test(m)?m:'No se pudo guardar el archivo: '+m,'bad');});
}
function csvCell(v){v=v==null?'':String(v);return /[",;\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;}
const toCsv=rows=>'﻿'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n');
