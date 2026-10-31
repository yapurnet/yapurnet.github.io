/* ===== planes ===== */
const TEC_PLAN={fibra:'Fibra óptica',wireless:'Antena wireless',ambas:'Fibra y wireless'};
const mbpsStr=v=>{v=Number(v)||0;return Number.isInteger(v)?v+'M':Math.round(v*1000)+'k';};
/* "25", "25M", "256k", "1,5M" → "25M" · "256k" · "1.5M" (un número solo se toma como M). null si no se entiende, '' si está vacío */
function rateNorm(v){
  const t=String(v==null?'':v).trim().replace(',','.');if(!t)return '';
  const m=t.match(/^(\d+(?:\.\d+)?)\s*([kKmMgG])?$/);if(!m)return null;
  return m[1]+(m[2]?(m[2].toLowerCase()==='k'?'k':m[2].toUpperCase()):'M');
}
/* parámetros de la Simple Queue de MikroTik: [clave, título, nombre en MikroTik, tipo, ejemplo] */
const Q_FIELDS=[
  ['burst','Ráfaga máxima','burst-limit','rate','25M'],
  ['thr','Umbral de ráfaga','burst-threshold','rate','8M'],
  ['time','Tiempo de ráfaga (segundos)','burst-time','int','22'],
  ['limit','Velocidad garantizada','limit-at','rate','256k'],
  ['prio','Prioridad (1 a 8)','priority','prio','8'],
  ['bucket','Tamaño de bucket','bucket-size','ratio','0.1'],
  ['type','Tipo de cola','queue','text','default-small']
];
/* argumentos en el orden de MikroTik: subida/bajada */
function queueArgs(p){
  const q=p.q||{},out=['max-limit='+mbpsStr(p.subida)+'/'+mbpsStr(p.bajada)];
  const has=x=>x!=null&&x!=='';
  const add=(name,k,suf)=>{
    let s=q[k+'S'],b=q[k+'B'];if(!has(s))s=b;if(!has(b))b=s;if(!has(s))return;
    out.push(name+'='+s+(suf||'')+'/'+b+(suf||''));
  };
  Q_FIELDS.forEach(([k,,name])=>add(name,k,k==='time'?'s':''));
  if(q.parent)out.push('parent='+(/\s/.test(q.parent)?'"'+q.parent+'"':q.parent));
  return out;
}
const queueText=p=>queueArgs(p).join(' ');
/* comando completo para un cliente (necesita su IP y su plan) */
function clientQueueCmd(c){
  const p=S.planes.get(c.planId),ip=String(c.ip||'').trim();
  if(!p||!ip)return null;
  return '/queue simple add name="'+String(c.nombre||'').replace(/["\\$]/g,'')+'" target='+ip+' '+queueText(p);
}
/* ----- planes de noviembre: velocidades y ráfaga salen de las colas reales de los routers (ráfaga = velocidad + 10M, umbral 8M, 22 s, garantizada 256k subida / 1M bajada) ----- */
const PLANES_NOV=[['Plan 100',15,18000],['Plan 200',15,19000],['Plan 20 Mbps',20,23000],['Plan 25 Mbps',25,24000],['Plan 30 Mbps',30,35000]];
const planNovObj=([nombre,v,precio])=>({nombre,bajada:v,subida:v,precio,tecnologia:'ambas',perfil:'',q:{burstB:(v+10)+'M',burstS:(v+10)+'M',thrB:'8M',thrS:'8M',timeB:'22',timeS:'22',limitB:'1M',limitS:'256k'},activo:true,mod:Date.now()});
const planesNovFaltan=()=>{const have=new Set([...S.planes.values()].map(p=>norm(p.nombre)));return PLANES_NOV.filter(x=>!have.has(norm(x[0])));};
/* planes que ya no se usan: activos, que no son de noviembre y sin clientes activos (solo se ofrecen cuando los de noviembre ya están cargados y hay clientes) */
const planesViejos=()=>!S.clientes.size||planesNovFaltan().length?[]:[...S.planes.values()].filter(p=>p.activo!==false&&!PLANES_NOV.some(x=>norm(x[0])===norm(p.nombre))&&planClientCount(p.id)===0);
async function cargarPlanesNov(){
  const falta=planesNovFaltan();if(!falta.length)return toast('Los planes de noviembre ya están cargados');
  if(!await askConfirm(`Se crean ${falta.length} planes: ${falta.map(x=>x[0]+' ('+fmtMoney(x[2])+')').join(', ')}. Después podés editar el precio, la ráfaga o cualquier dato. ¿Los cargo?`,'Cargar planes'))return;
  try{for(const x of falta)await S.db.collection('planes').doc(newId()).set(planNovObj(x));toast(falta.length+' planes cargados');}catch(err){dbError(err);}
}
async function desactivarPlanesViejos(){
  const v=planesViejos();if(!v.length)return;
  if(!await askConfirm(`Se desactivan ${v.length} planes sin clientes: ${v.map(p=>p.nombre).join(', ')}. Dejan de ofrecerse a clientes nuevos y no se borran: se pueden volver a activar desde «Editar».`,'Desactivar planes'))return;
  try{for(const p of v){const o=Object.assign({},p);delete o.id;o.activo=false;o.mod=Date.now();await S.db.collection('planes').doc(p.id).set(o);}toast(v.length+' planes desactivados');}catch(err){dbError(err);}
}
function planClientCount(id){let n=0;for(const c of S.clientes.values())if(c.planId===id&&c.estado==='activo')n++;return n;}
/* ----- precios con vigencia: aviso del cambio programado y bloque «rige desde» de los formularios ----- */
function nextChangeHTML(item){
  const cur=curMonth(),e=Array.isArray(item.hist)?item.hist.find(x=>x.d>cur):null;
  return e?`<div class="small"><span class="chip info">Desde ${esc(monthLabel(e.d))}: ${esc(fmtMoney(e.p))}</span></div>`:'';
}
function vigHTML(pre,item){
  const cur=curMonth(),noHist=!(Array.isArray(item&&item.hist)&&item.hist.length);
  return `<div class="notice info" id="${pre}-vig" hidden>
    <div class="field"><label for="${pre}-vig-mes">El precio nuevo rige desde</label><input id="${pre}-vig-mes" type="month" min="${cur}" value="${addMonths(cur,1)}"></div>
    <div class="hint">Los meses anteriores conservan el precio que tenían: a quien ya pagó no le aparece deuda. Se puede dejar el mes siguiente o elegir otro.</div>
    ${noHist?`<label class="per"><input id="${pre}-vig-fix" type="checkbox"><span class="grow">Es un error de carga (por ejemplo $17 en vez de $17.000): corregir el precio de todos los meses</span></label>`:''}</div>`;
}
/* arma {precio,hist} para guardar; null si falta o no es válido el mes. */
function readVig(pre,el,item,precio){
  if(!item)return {precio};
  if(precio===planNow(item))return {precio:item.precio,hist:item.hist};
  const fix=$('#'+pre+'-vig-fix',el);
  if(fix&&fix.checked)return {precio};
  const eff=$('#'+pre+'-vig-mes',el).value;
  if(!/^\d{4}-\d{2}$/.test(eff)||eff<curMonth()){toast('Elegí desde qué mes rige el precio nuevo (este mes o uno futuro)','bad');return null;}
  return {precio,hist:histWith(item,eff,precio)};
}
function bindVig(pre,el,item,get){
  const box=$('#'+pre+'-vig',el);if(!box||!item)return;
  const f=()=>{const n=get();box.hidden=!(n!==null&&n>=0&&n!==planNow(item));};
  const inp=$('#'+pre+'-precio',el);inp.addEventListener('input',f);f();
}
function planCard(p){
  const n=planClientCount(p.id);
  return `<article class="plan${p.activo===false?' off':''}">
    <div class="head-row"><h3 style="overflow-wrap:anywhere">${esc(p.nombre)}</h3><div class="tags-inline">${TEC_PLAN[p.tecnologia]?`<span class="chip accent">${esc(TEC_PLAN[p.tecnologia])}</span>`:''}${p.activo===false?'<span class="chip">Inactivo</span>':''}${isAdmin()?`<button class="btn small" type="button" data-edit-plan="${esc(p.id)}">Editar</button>`:''}</div></div>
    <div><div class="speed">${esc(p.bajada)}<small>Mbps de bajada</small></div><div class="speed-up">subida ${esc(p.subida)} Mbps</div></div>
    ${can('precios')?`<div class="price">${fmtMoney(planNow(p))}<span class="muted small" style="font-family:var(--f-body);font-weight:500"> / mes</span></div>${nextChangeHTML(p)}`:''}
    <div class="qbox">${esc(queueText(p))}</div>
    <div class="actions start"><button class="btn small ghost" type="button" data-copy="${esc(queueText(p))}" data-copy-label="Parámetros de la cola">Copiar parámetros de la cola</button></div>
    ${p.perfil?`<div class="small muted">Perfil: <span class="mono">${esc(p.perfil)}</span></div>`:''}
    <div class="small muted">${n} ${n===1?'cliente activo':'clientes activos'}${can('precios')&&n?' · '+fmtMoney(n*planNow(p))+' por mes':''}</div></article>`;
}
function qRowHTML([k,label,key,kind,ex],q){
  const val=s=>esc(q[k+s]==null?'':q[k+s]);
  return F(`${label} <span class="muted small mono">${key}</span>`,`q-${k}B`,`<div class="qpair"><input id="q-${k}B" autocomplete="off" inputmode="${kind==='rate'||kind==='text'?'text':'decimal'}" placeholder="${esc(ex)}" aria-label="${esc(label)}, bajada" value="${val('B')}"><input id="q-${k}S" autocomplete="off" inputmode="${kind==='rate'||kind==='text'?'text':'decimal'}" placeholder="${esc(ex)}" aria-label="${esc(label)}, subida" value="${val('S')}"></div>`);
}
/* a quiénes alcanza un plan: clientes activos, dados de baja y los que lo tuvieron antes (historial de precios) */
function planUso(id){
  let act=0,baja=0,hist=0;
  for(const c of S.clientes.values()){
    if(c.planId===id){if(c.estado==='baja')baja++;else act++;}
    else if(Array.isArray(c.hp)&&c.hp.some(e=>e&&e.planId===id))hist++;
  }
  const partes=[];
  if(act)partes.push(act+(act===1?' cliente':' clientes'));
  if(baja)partes.push(baja+(baja===1?' cliente dado de baja':' clientes dados de baja'));
  if(hist)partes.push('el historial de precios de '+hist+(hist===1?' cliente':' clientes'));
  return {act,baja,hist,total:act+baja+hist,txt:partes.join(', ')};
}
function openPlanForm(id){
  const old=id?S.planes.get(id):null;const p=old||{activo:true,tecnologia:'fibra'};
  const q=p.q||{},hasQ=Object.keys(q).length>0,uso=old?planUso(old.id):{total:0};
  const html=`<form class="form" id="pform" novalidate>
    ${F('Nombre del plan *','pf-nombre',`<input id="pf-nombre" value="${esc(p.nombre||'')}" placeholder="Hogar 100" autocomplete="off">`)}
    <div class="grid2">${F('Bajada (Mbps) *','pf-bajada','<input id="pf-bajada" type="text" inputmode="decimal" autocomplete="off" value="'+esc(p.bajada||'')+'">')}${F('Subida (Mbps) *','pf-subida','<input id="pf-subida" type="text" inputmode="decimal" autocomplete="off" value="'+esc(p.subida||'')+'">')}</div>
    <div class="grid2">${F('Precio mensual (ARS) *','pf-precio',`<input id="pf-precio" type="text" inputmode="decimal" autocomplete="off" placeholder="17000" value="${p.precio==null?'':esc(old?planNow(old):p.precio)}">`,'<span id="pf-precio-h"></span>')}${F('Tecnología','pf-tec',`<select id="pf-tec">${Object.entries(TEC_PLAN).map(([k,v])=>opt(k,v,k===p.tecnologia)).join('')}</select>`)}</div>
    ${old?vigHTML('pf',old):''}
    <details class="qsec"${hasQ?' open':''}><summary>Ráfaga y parámetros de la cola (MikroTik)</summary>
      <div class="form" style="margin-top:10px">
      <div class="hint">Completá solo lo que usás, igual que en la Simple Queue. Escribí como en MikroTik: <span class="mono">25M</span>, <span class="mono">256k</span>. Un número solo se toma como M. Si cargás un solo lado, el otro copia el mismo valor.</div>
      <div class="qpair qhead"><b>Bajada (download)</b><b>Subida (upload)</b></div>
      ${Q_FIELDS.map(f=>qRowHTML(f,q)).join('')}
      ${F('Parent (opcional)','q-parent',`<input id="q-parent" autocomplete="off" placeholder="none" value="${esc(q.parent||'')}">`)}
      <div class="hint">Así queda: <span class="mono" id="q-prev"></span></div></div></details>
    ${F('Nombre del perfil en el router (opcional)','pf-perfil',`<input id="pf-perfil" class="mono" value="${esc(p.perfil||'')}" placeholder="plan-100M">`,'Sirve de referencia para quien configura MikroTik.')}
    <label class="per"><input id="pf-activo" type="checkbox"${p.activo!==false?' checked':''}><span class="grow">Plan disponible para clientes nuevos</span></label>
    ${old&&isAdmin()&&uso.total?`<div class="hint" id="pf-uso">No se puede eliminar: este plan figura en ${esc(uso.txt)}. Si ya no lo querés ofrecer, destildá «Plan disponible para clientes nuevos».</div>`:''}
    <div class="actions">${old&&isAdmin()&&!uso.total?'<button class="btn danger" type="button" id="pf-del">Eliminar plan</button>':''}<button class="btn ghost" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Guardar plan</button></div></form>`;
  openModal({title:old?'Editar plan':'Nuevo plan',html,onMount(el){
    bindMoney($('#pf-precio',el),$('#pf-precio-h',el));
    const v=i=>$('#'+i,el).value.trim();
    bindVig('pf',el,old,()=>num(v('pf-precio')));
    /* lee y valida los parámetros de la cola; devuelve {q} o {error} */
    const readQ=()=>{
      const q2={};
      for(const [k,label,,kind] of Q_FIELDS)for(const side of ['B','S']){
        const raw=v('q-'+k+side);if(raw==='')continue;
        let val=null;
        if(kind==='rate'){val=rateNorm(raw);}
        else if(kind==='int'){val=/^\d+$/.test(raw)?raw:null;}
        else if(kind==='prio'){val=/^[1-8]$/.test(raw)?raw:null;}
        else if(kind==='ratio'){const n=parseFloat(raw.replace(',','.'));val=/^\d+([.,]\d+)?$/.test(raw)&&n>0?String(n):null;}
        else val=/^[\w.\-]+$/.test(raw)?raw:null;
        if(val===null)return {error:`${label}: «${raw}» no es un valor válido`};
        q2[k+side]=val;
      }
      const par=v('q-parent');
      if(par&&par!=='none'){if(/["\\]/.test(par))return {error:'Parent: no uses comillas'};q2.parent=par;}
      return {q:q2};
    };
    const prev=()=>{
      const r=readQ(),b=num(v('pf-bajada')),s=num(v('pf-subida')),el2=$('#q-prev',el);
      el2.textContent=r.error?r.error:(b&&s?queueText({bajada:b,subida:s,q:r.q}):'Completá bajada y subida.');
    };
    $('#pform',el).addEventListener('input',prev);prev();
    const del=$('#pf-del',el);
    if(del)del.addEventListener('click',async()=>{
      const u2=planUso(old.id);
      if(u2.total)return toast('No se puede eliminar: figura en '+u2.txt+'.','bad');
      if(!await askConfirm('¿Eliminar el plan «'+old.nombre+'»? Ningún cliente lo usa. No se puede deshacer.','Eliminar',true))return;
      try{await S.db.collection('planes').doc(old.id).delete();toast('Plan eliminado');closeModal();}catch(err){dbError(err);}
    });
    $('#pform',el).addEventListener('submit',async e=>{
      e.preventDefault();
      const bajada=num(v('pf-bajada')),subida=num(v('pf-subida')),precio=num(v('pf-precio'));
      if(!v('pf-nombre'))return toast('Falta el nombre del plan','bad');
      if(!bajada||!subida)return toast('Completá bajada y subida','bad');
      if(precio===null||precio<0)return toast('Completá el precio','bad');
      const r=readQ();if(r.error)return toast(r.error,'bad');
      const vg=readVig('pf',el,old,precio);if(!vg)return;
      const obj={nombre:v('pf-nombre'),bajada,subida,precio:vg.precio,tecnologia:v('pf-tec'),perfil:v('pf-perfil'),q:Object.keys(r.q).length?r.q:null,activo:$('#pf-activo',el).checked,mod:Date.now()};
      if(vg.hist)obj.hist=vg.hist;
      try{await S.db.collection('planes').doc(old?old.id:newId()).set(obj);toast('Plan guardado');closeModal();}catch(err){dbError(err);}
    });
  }});
}

/* ===== servicios adicionales (Multimedia, Multimedia Net…) ===== */
function servicioClientCount(id){let n=0;for(const c of S.clientes.values())if(c.estado==='activo'&&Array.isArray(c.extras)&&c.extras.includes(id))n++;return n;}
function servicioRow(s){
  const n=servicioClientCount(s.id);
  return `<div class="item" style="cursor:default"><div><div class="t">${esc(s.nombre)}${s.activo===false?' <span class="chip">Ya no se ofrece</span>':''}</div><div class="s">${n} ${n===1?'cliente activo':'clientes activos'}${can('precios')&&n?' · '+fmtMoney(n*planNow(s))+' por mes':''}</div></div>
    ${can('precios')?`<div class="side"><b class="tnum">${fmtMoney(planNow(s))}</b><span class="muted small">por mes</span>${nextChangeHTML(s)}</div>`:''}
    ${isAdmin()?`<div class="tags"><button class="btn small" type="button" data-edit-sv="${esc(s.id)}">Editar</button></div>`:''}</div>`;
}
function openServicioForm(id){
  const list=serviciosList(),old=id?list.find(s=>s.id===id):null,s=old||{activo:true};
  const html=`<form class="form" id="svform" novalidate>
    ${F('Nombre del servicio *','sv-nombre',`<input id="sv-nombre" autocomplete="off" placeholder="Multimedia" value="${esc(s.nombre||'')}">`)}
    ${F('Precio mensual (ARS) *','sv-precio',`<input id="sv-precio" type="text" inputmode="decimal" autocomplete="off" placeholder="15000" value="${s.precio==null?'':esc(old?planNow(old):s.precio)}">`,'<span id="sv-precio-h"></span>')}
    ${old?vigHTML('sv',old):''}
    <label class="per"><input id="sv-activo" type="checkbox"${s.activo!==false?' checked':''}><span class="grow"><b>Se ofrece a clientes</b><br><span class="small muted">Si lo apagás, los clientes que ya lo tienen lo siguen pagando, pero no se puede asignar a otros.</span></span></label>
    <div class="actions"><button class="btn ghost" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Guardar servicio</button></div></form>`;
  openModal({title:old?'Editar servicio':'Nuevo servicio',html,onMount(el){
    bindMoney($('#sv-precio',el),$('#sv-precio-h',el));
    bindVig('sv',el,old,()=>num($('#sv-precio',el).value));
    $('#svform',el).addEventListener('submit',async e=>{
      e.preventDefault();
      const nombre=$('#sv-nombre',el).value.trim(),precio=num($('#sv-precio',el).value);
      if(!nombre)return toast('Falta el nombre','bad');
      if(precio===null||precio<0)return toast('Completá el precio','bad');
      if(list.some(x=>x.id!==(old&&old.id)&&norm(x.nombre)===norm(nombre)))return toast('Ya hay un servicio con ese nombre','bad');
      const activo=$('#sv-activo',el).checked;
      let next;
      if(old){
        const vg=readVig('sv',el,old,precio);if(!vg)return;
        next=list.map(x=>{if(x.id!==old.id)return x;const y=Object.assign({},x,{nombre,precio:vg.precio,activo});if(vg.hist)y.hist=vg.hist;else delete y.hist;return y;});
      }
      else{
        const base=norm(nombre).replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')||'servicio';let sid=base,i=2;
        while(list.some(x=>x.id===sid))sid=base+'_'+(i++);
        next=[...list,{id:sid,nombre,precio,activo}];
      }
      try{await saveAjustes({servicios:next});toast('Servicio guardado');closeModal();}catch(err){dbError(err);}
    });
  }});
}
VIEWS.planes={
  mount(el){
    el.innerHTML=`<div class="head-row"><h2>Planes de velocidad</h2>${isAdmin()?'<button class="btn primary" type="button" id="pl-new">Nuevo plan</button>':''}</div>
      ${isAdmin()?'':'<div class="notice info">Solo el administrador puede crear o cambiar planes.</div>'}<div id="pl-nov"></div><div class="plans" id="pl-list"></div>
      <div class="head-row" style="margin-top:20px"><h2>Servicios adicionales</h2>${isAdmin()?'<button class="btn primary" type="button" id="sv-new">Nuevo servicio</button>':''}</div>
      <p class="muted small">Se suman al plan de internet. Cada cliente puede tener uno, otro o los dos.</p><div class="list" id="sv-list"></div>`;
    const sn=$('#sv-new',el);if(sn)sn.addEventListener('click',()=>openServicioForm(null));
    $('#sv-list',el).addEventListener('click',e=>{const b=e.target.closest('[data-edit-sv]');if(b)openServicioForm(b.dataset.editSv);});
    const nb=$('#pl-new',el);if(nb)nb.addEventListener('click',()=>openPlanForm(null));
    $('#pl-list',el).addEventListener('click',e=>{const b=e.target.closest('[data-edit-plan]');if(b)openPlanForm(b.dataset.editPlan);});
    $('#pl-nov',el).addEventListener('click',e=>{const b=e.target.closest('[data-nov]');if(!b)return;if(b.dataset.nov==='cargar')cargarPlanesNov();else desactivarPlanesViejos();});
    this.update();
  },
  update(){
    const l=$('#pl-list');if(!l)return;
    const nov=$('#pl-nov');
    if(nov){
      const f=isAdmin()&&S.loaded.planes?planesNovFaltan():[],v=isAdmin()&&S.loaded.planes&&S.loaded.clientes?planesViejos():[];
      nov.innerHTML=(f.length?`<div class="notice info" style="margin-bottom:12px"><b>Planes de noviembre</b><div class="small">Faltan ${f.length}: ${esc(f.map(x=>x[0]+' ('+fmtMoney(x[2])+')').join(', '))}. Se crean con la velocidad y la ráfaga que usan los routers.</div><div class="actions start"><button class="btn primary small" type="button" data-nov="cargar">Cargar planes de noviembre</button></div></div>`:'')
        +(v.length?`<div class="notice info" style="margin-bottom:12px"><b>${v.length} ${v.length===1?'plan viejo sin clientes':'planes viejos sin clientes'}</b><div class="small">${esc(v.map(p=>p.nombre).join(', '))}. Si ya no existen, desactivalos para que no se ofrezcan.</div><div class="actions start"><button class="btn small" type="button" data-nov="viejos">Desactivar planes sin clientes</button></div></div>`:'');
    }
    const sl=$('#sv-list');if(sl)sl.innerHTML=serviciosList().length?serviciosList().map(servicioRow).join(''):'<div class="hint">Todavía no hay servicios adicionales.</div>';
    const rows=[...S.planes.values()].sort((a,b)=>(a.bajada-b.bajada)||(planNow(a)-planNow(b)));
    l.innerHTML=rows.length?rows.map(planCard).join(''):`<div class="empty" style="grid-column:1/-1"><b>Todavía no hay planes</b><span>${isAdmin()?'Creá el primero para poder asignarlo a los clientes.':'El administrador todavía no cargó planes.'}</span></div>`;
  }
};
