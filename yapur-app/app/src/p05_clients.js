/* ===== clientes ===== */
const VIEWS={};
const CL={q:'',estado:'todos',plan:'',tec:'',limit:50};
const ESTADO_CLS={activo:'ok',suspendido:'bad',pendiente:'info',baja:''};
const planName=id=>{const p=S.planes.get(id);return p?p.nombre:'Sin plan';};
const planSpeed=p=>p?`${p.bajada}/${p.subida} Mbps`:'';
function clientHay(c){
  const hv=S.pv+'.'+S.rv;
  if(!c._hay||c._hayV!==hv){c._hay=norm([c.codigo,c.nombre,can('dni')?c.dni:'',can('telefono')?c.tel:'',can('telefono')?c.tel2:'',c.dir,c.loc,c.usuario,c.ip,c.nodo,c.equipo,c.nap?redName(c.nap):''].join(' '));c._hayV=hv;}
  return c._hay;
}
function visibleSet(){
  const s=new Set();
  for(const o of S.ordenes.values())if(ORD_OPEN(o)&&(!o.tecnico||o.tecnico===S.tecId))s.add(o.clientId);
  return s;
}
const clientVisible=c=>can('clientesTodos')||visibleSet().has(c.id);
function searchClients(q,filter,limit){
  const parts=norm(q).trim().split(/\s+/).filter(Boolean);
  const out=[];const vis=can('clientesTodos')?null:visibleSet();
  for(const c of S.clientes.values()){
    if(vis&&!vis.has(c.id))continue;
    if(filter&&!filter(c))continue;
    if(parts.length){const h=clientHay(c);if(!parts.every(p=>h.includes(p)))continue;}
    out.push(c);
  }
  out.sort((a,b)=>norm(a.nombre).localeCompare(norm(b.nombre)));
  return limit?out.slice(0,limit):out;
}
function clientRow(c){
  const pl=S.planes.get(c.planId);
  return `<button class="item" type="button" data-open-client="${esc(c.id)}">
    <div><div class="t">${esc(c.nombre)}${c.codigo?` <span class="muted mono small">#${esc(c.codigo)}</span>`:''}</div>
    <div class="s">${esc(c.dir||'Sin domicilio')}${c.loc?' · '+esc(c.loc):''}</div></div>
    <div class="side">${c.estado==='activo'?'':`<span class="chip ${ESTADO_CLS[c.estado]||''}">${esc(ESTADOS[c.estado]||c.estado)}</span>`}</div>
    <div class="tags">${pl?`<span class="chip accent">${esc(pl.nombre)} · ${esc(planSpeed(pl))}</span>`:(extrasOf(c).length?'':'<span class="chip warn">Sin plan</span>')}${extrasOf(c).map(s=>`<span class="chip info">${esc(s.nombre)}</span>`).join('')}
    ${c.tec?`<span class="chip">${esc(TECNOS[c.tec]||c.tec)}</span>`:''}${c.nap&&redName(c.nap)?`<span class="chip">${esc(redName(c.nap))}${c.napPuerto?' · p. '+esc(c.napPuerto):''}</span>`:''}
    ${hasGeo(c)?'':'<span class="chip quiet">Sin ubicación</span>'}${billChip(c)}</div></button>`;
}
function mountClientPicker(host,opts){
  host.innerHTML=`<input type="search" class="cp-in" placeholder="${esc(opts.placeholder||'Buscar por nombre, DNI, N° de cliente, teléfono o usuario')}" autocomplete="off" aria-label="Buscar cliente"><div class="list cp-list" style="margin-top:8px"></div>`;
  const inp=$('.cp-in',host),list=$('.cp-list',host);
  const draw=()=>{
    const q=inp.value.trim();
    if(!q){list.innerHTML='';return;}
    const rows=searchClients(q,opts.filter,8);
    list.innerHTML=rows.length?rows.map(c=>`<button class="item" type="button" data-pick="${esc(c.id)}"><div><div class="t">${esc(c.nombre)}${c.codigo?` <span class="muted mono small">#${esc(c.codigo)}</span>`:''}</div><div class="s">${esc(c.dir||'')}${c.loc?' · '+esc(c.loc):''}</div></div><div class="side">${billChip(c)}</div></button>`).join(''):'<div class="hint">No hay clientes con esa búsqueda.</div>';
  };
  inp.addEventListener('input',draw);
  list.addEventListener('click',e=>{const b=e.target.closest('[data-pick]');if(b)opts.onPick(S.clientes.get(b.dataset.pick));});
  return {focus:()=>inp.focus(),draw};
}

/* ----- campo de ubicación ----- */
function geoFieldHTML(c,msg){
  const v=hasGeo(c)?parseFloat(c.lat).toFixed(6)+', '+parseFloat(c.lng).toFixed(6):'';
  return `<div class="geo"><div class="field"><label for="cf-geo">Ubicación (coordenadas o link de Google Maps)</label>
    <input id="cf-geo" type="text" autocomplete="off" inputmode="text" placeholder="-27.7345, -62.4678" value="${esc(v)}">
    <div class="hint" id="cf-geo-hint"></div></div>
    <div class="actions start"><button class="btn small" type="button" id="cf-gps">Usar mi ubicación actual (GPS)</button></div>
    <div class="hint" id="cf-gps-st">${esc(msg||'Si estás en el domicilio del cliente, tocá el botón y se completa solo.')}</div></div>`;
}
/* ----- GPS del celular: toma lecturas unos segundos y se queda con la más precisa ----- */
function gpsStart(onProgress){
  let best=null,done=false,lastErr=null,timer=null,id=null,res,rej;
  const promise=new Promise((a,b)=>{res=a;rej=b;});
  const finish=err=>{
    if(done)return;done=true;
    try{if(id!==null)navigator.geolocation.clearWatch(id);}catch(e){}
    clearTimeout(timer);
    if(best)res(best);else rej(err||lastErr||{code:3});
  };
  if(!navigator.geolocation){done=true;rej({code:0});return {promise,stop(){}};}
  try{
    id=navigator.geolocation.watchPosition(p=>{
      const c=p.coords,r={lat:c.latitude,lng:c.longitude,acc:Number(c.accuracy)||0};
      if(!isFinite(r.lat)||!isFinite(r.lng))return;
      if(!best||r.acc<=best.acc)best=r;
      if(onProgress)onProgress(best);
      if(best.acc<=10)finish();
    },e=>{lastErr=e;if(e&&e.code===1)finish(e);},{enableHighAccuracy:true,maximumAge:0,timeout:20000});
  }catch(e){done=true;rej({code:0});return {promise,stop(){}};}
  timer=setTimeout(()=>finish(),25000);
  return {promise,stop:()=>finish()};
}
function gpsErrorText(e){
  const c=e&&e.code;
  if(c===0)return 'Este navegador no permite usar el GPS.';
  if(c===1)return NET.native
    ?'No hay permiso de ubicación. En el celular: Ajustes → Aplicaciones → Gestión YAPUR → Permisos → Ubicación → Permitir (con ubicación precisa). Si ya está permitido, falta instalar la versión nueva del APK.'
    :'El navegador no tiene permiso de ubicación. Tocá el candado junto a la dirección y permitila.';
  return 'No se pudo obtener la ubicación'+(c===3?' (tardó demasiado)':'')+'. Activá el GPS del celular (Ubicación) y probá de nuevo, mejor al aire libre.';
}
function bindGeoField(root){
  const inp=$('#cf-geo',root),hint=$('#cf-geo-hint',root);
  const read=()=>{
    const t=inp.value.trim();
    if(!t)return {empty:true};
    const g=parseCoords(t);
    return g||{invalid:true,short:/goo\.gl|maps\.app/i.test(t)};
  };
  const draw=()=>{
    const g=read();
    if(g.empty){hint.className='hint';hint.textContent='En Google Maps mantené apretado el punto y copiá los números que aparecen arriba. También sirve pegar el link que manda el cliente por WhatsApp.';}
    else if(g.invalid){hint.className='hint bad';hint.textContent=g.short?'Los links cortos (maps.app.goo.gl) no traen coordenadas. Abrilo en Maps y copiá los números.':'No se reconoce. Pegá dos números separados por coma, por ejemplo -27.7345, -62.4678.';}
    else{hint.className='hint '+(g.outside?'bad':'ok');hint.textContent='Se guarda '+g.lat+', '+g.lng+(g.fixed?'. Se corrigió el signo: en Argentina son negativos.':'')+(g.outside?'. Queda fuera de Argentina, revisalo.':'.');}
  };
  inp.addEventListener('input',draw);draw();
  const btn=$('#cf-gps',root),st=$('#cf-gps-st',root);
  if(btn&&st){
    let run=null;const label=btn.textContent;
    const say=(cls,txt)=>{st.className='hint '+cls;st.textContent=txt;};
    btn.addEventListener('click',async()=>{
      if(run){run.stop();return;}   /* segundo toque: usar lo mejor que haya hasta ahora */
      btn.textContent='Buscando señal… (tocá para usar lo mejor hasta ahora)';
      say('','Esperando al GPS. Mejor al aire libre y frente a la casa.');
      run=gpsStart(b=>say('','Buscando… precisión actual ±'+Math.round(b.acc)+' m'));
      try{
        const r=await run.promise,m=Math.round(r.acc);
        inp.value=r.lat.toFixed(6)+', '+r.lng.toFixed(6);
        inp.dispatchEvent(new Event('input',{bubbles:true}));
        say(r.acc<=25?'ok':'bad',r.acc<=25?'Ubicación tomada con el GPS (±'+m+' m). Revisala y guardá.':'Ubicación tomada, pero poco precisa (±'+m+' m). Salí a un lugar abierto y repetí.');
      }catch(e){say('bad',gpsErrorText(e));}
      finally{run=null;btn.textContent=label;}
    });
  }
  return read;
}

/* ----- ficha ----- */
function stripInternal(o){const r=Object.assign({},o);delete r.id;delete r._doc;delete r._hay;delete r._hayV;return r;}
async function saveClient(c,patch){
  const obj=Object.assign(stripInternal(c),patch,{mod:Date.now()});
  await putItem('clientes',clientShard(c.id),c.id,obj);
  return obj;
}
function openClient(id){
  const c=S.clientes.get(id);if(!c||!clientVisible(c)){toast('No se encontró el cliente','bad');return;}
  const pl=S.planes.get(c.planId),b=billing(c);
  const kv=(k,v)=>v?`<dt>${k}</dt><dd>${v}</dd>`:'';
  const tel=t=>t&&can('telefono')?`<span class="mono">${esc(t)}</span> <a class="small" href="${waUrl(t,'')}" target="_blank" rel="noopener">WhatsApp</a>`:'';
  const pays=(S.payByClient.get(c.id)||[]).slice(0,5);
  const cl=can('cobrar')||can('caja')?cutLine(c):null;
  const owes=b.aplica&&b.periods.some(p=>p.per<=todayStr().slice(0,7)&&p.rest>0);
  const ords=[...S.ordenes.values()].filter(o=>o.clientId===c.id).sort((a,b2)=>(b2.creado||'').localeCompare(a.creado||'')).slice(0,4);
  const html=`
    <div class="head-row"><div><span class="chip ${ESTADO_CLS[c.estado]||''}">${esc(ESTADOS[c.estado]||c.estado)}</span> ${billChip(c)}</div>
      <div class="actions start">${can('editarClientes')||can('ubicacion')?`<button class="btn small" type="button" data-act="editar">${can('editarClientes')?'Editar':'Editar datos técnicos'}</button>`:''}</div></div>
    <h2 style="overflow-wrap:anywhere">${esc(c.nombre)}${c.codigo?` <span class="muted mono small">#${esc(c.codigo)}</span>`:''}</h2>
    ${cl?`<div class="notice ${cl.cls}">${esc(cl.txt)}</div>`:''}
    ${deudaAntBlock(c)}
    <dl class="kv">${kv('Domicilio',esc((c.dir||'')+(c.loc?', '+c.loc:'')))}${kv('Referencia',esc(c.ref))}${kv('Teléfono',tel(c.tel))}${kv('Otro teléfono',tel(c.tel2))}${can('dni')?kv('DNI',esc(c.dni)):''}
      ${kv('Plan',pl?esc(pl.nombre)+' · '+esc(planSpeed(pl))+(can('precios')?' · '+fmtMoney(priceBase(c))+'/mes':''):'')}${extrasOf(c).length?kv('Servicios adicionales',extrasOf(c).map(s=>esc(s.nombre)+(can('precios')?' · '+fmtMoney(planNow(s))+'/mes':'')).join('<br>')):''}${can('precios')&&extrasOf(c).length?kv('Total por mes','<b>'+fmtMoney(b.price)+'</b>'):''}${kv('Tecnología',esc(TECNOS[c.tec]||''))}${kv('Usuario',c.usuario?`<span class="mono">${esc(c.usuario)}</span>`:'')}${kv('IP',c.ip?`<span class="mono">${esc(c.ip)}</span>`:'')}${kv('Nodo o torre',esc(c.nodo))}${kv('Caja NAP',napLine(c))}${kv('Equipo',c.equipo?`<span class="mono">${esc(c.equipo)}</span>`:'')}
      ${kv('Alta',esc(dmy(c.alta)))}${can('cobrar')||can('caja')?kv('Ciclo de cobro','Ciclo '+cicloOf(c)+': '+esc(cicloTxt(cicloOf(c)))):''}${kv('Notas',esc(c.notas))}</dl>
    <div class="geo"><div class="legend small muted">Cómo llegar</div><div class="actions start">${geoActions(c)}${can('ubicacion')?`<button class="btn small ghost" type="button" data-act="ubicacion">${hasGeo(c)?'Cambiar ubicación':'Cargar ubicación'}</button>`:''}</div></div>
    <div class="actions start">${can('cobrar')&&b.aplica?'<button class="btn primary" type="button" data-act="cobrar">Cobrar</button>':''}${(can('cobrar')&&!b.aplica)||soloCampo()?'<button class="btn primary" type="button" data-act="cobrar">Cobrar instalación o reclamo</button>':''}${can('crearOrdenes')?'<button class="btn" type="button" data-act="orden">Nueva orden de trabajo</button>':''}${can('ubicacion')&&pl?'<button class="btn" type="button" data-act="queue">Copiar cola de MikroTik</button>':''}</div>
    ${can('promesas')&&b.aplica?promesaBlock(c,owes):''}
    ${(can('cobrar')||can('caja'))&&pays.length?`<div><h3>Últimos pagos</h3><div class="tbl-wrap" style="margin-top:8px"><table><tbody>${pays.map(p=>`<tr><td class="nowrap">${dmy(p.fecha)}</td><td>${esc(p.concepto==='mensualidad'&&p.per?monthLabel(p.per):CONCEPTOS[p.concepto]||'')}${p.anulado?' <span class="chip bad">Anulado</span>':''}</td><td class="right tnum">${fmtMoney(p.monto)}</td></tr>`).join('')}</tbody></table></div></div>`:''}
    ${ords.length?`<div><h3>Órdenes</h3><div class="list" style="margin-top:8px">${ords.map(o=>`<div class="item" style="cursor:default"><div><div class="t">${esc(TIPOS_ORD[o.tipo]||o.tipo)}</div><div class="s">${esc(dmy(o.fecha))} ${o.notas?'· '+esc(o.notas):''}</div></div><div class="side"><span class="chip">${esc(EST_ORD[o.estado]||o.estado)}</span></div></div>`).join('')}</div></div>`:''}`;
  openModal({title:'Ficha del cliente',html,onMount(el){
    el.addEventListener('click',e=>{
      const a=e.target.closest('[data-act]');if(!a)return;
      if(a.dataset.act==='editar')openClientForm(c.id);
      else if(a.dataset.act==='ubicacion')openGeoQuick(c.id);
      else if(a.dataset.act==='nap')openRed(c.nap);
      else if(a.dataset.act==='cobrar')openCobro(c.id);
      else if(a.dataset.act==='cobrar-da')openCobro(c.id,'deuda_anterior');
      else if(a.dataset.act==='saldar-da')saldarDeudaAnt(c.id);
      else if(a.dataset.act==='orden')openOrderForm({clientId:c.id});
      else if(a.dataset.act==='queue'){const cmd=clientQueueCmd(c);if(cmd)copyText(cmd,'Comando');else toast('Cargá la IP del cliente para armar la cola','bad');}
      else if(a.dataset.act==='promesa')openPromesa(c.id);
      else if(a.dataset.act==='promesa-x')anularPromesa(c.id);
    });
  }});
}
/* ----- deuda anterior en la ficha ----- */
function deudaAntBlock(c){
  const d=c.deudaAnt;if(!d||!(Number(d.m)>0)||!(can('cobrar')||can('caja')||can('precios')))return '';
  const rest=deudaAntRest(c),paid=deudaAntPagado(c);
  if(rest<=0)return `<div class="hint ok">Deuda anterior saldada: ${esc(fmtMoney(d.m))}${d.det?' · '+esc(d.det):''}.</div>`;
  return `<div class="notice"><b>Deuda anterior: ${esc(fmtMoney(rest))}</b><div class="small">${d.det?esc(d.det)+'. ':''}Debía ${esc(fmtMoney(d.m))}${paid>0?' y ya pagó '+esc(fmtMoney(paid)):''}. Va aparte de las mensualidades: no genera cortes.</div>
    <div class="actions start" style="margin-top:8px">${can('cobrar')?'<button class="btn small primary" type="button" data-act="cobrar-da">Cobrar deuda anterior</button>':''}${can('editarClientes')?'<button class="btn small" type="button" data-act="saldar-da">Dar por saldada</button>':''}</div></div>`;
}
async function saldarDeudaAnt(id){
  const c=S.clientes.get(id);if(!c||!c.deudaAnt)return;
  if(!await askConfirm(`Se da por saldada la deuda anterior de ${c.nombre} (faltan ${fmtMoney(deudaAntRest(c))}). No se registra ningún cobro: la deuda se perdona. ¿Seguro?`,'Dar por saldada'))return;
  try{await saveClient(c,{deudaAnt:Object.assign({},c.deudaAnt,{m:deudaAntPagado(c),s:todayStr()})});toast('Deuda anterior saldada');closeModal();}catch(e){dbError(e);}
}
/* ----- promesas de pago en la ficha ----- */
function promesaBlock(c,owes){
  const s=cutState(c),pr=promesaActual(c),hist=(Array.isArray(c.promesas)?c.promesas:[]).slice(-3).reverse();
  const vig=s.k==='promesa';
  return `<div><div class="head-row"><h3>Promesa de pago</h3><div class="actions start">${owes?`<button class="btn small primary" type="button" data-act="promesa">${vig?'Cambiar promesa':'Dar promesa de pago'}</button>`:''}${vig?'<button class="btn small ghost" type="button" data-act="promesa-x">Anular</button>':''}</div></div>
    ${hist.length?`<div class="tbl-wrap" style="margin-top:8px"><table><tbody>${hist.map(h=>`<tr><td class="nowrap">${dmy(h.f)}</td><td>${h.d} ${h.d===1?'día':'días'}, hasta el ${dmy(h.h)}${h.n?' · '+esc(h.n):''}</td><td class="right">${h.x?'<span class="chip">Anulada</span>':(h===pr&&vig?'<span class="chip warn">Vigente</span>':'')}</td></tr>`).join('')}</tbody></table></div>`:`<div class="hint">${owes?'No tiene promesas registradas.':'No tiene deuda: no necesita promesa.'}</div>`}</div>`;
}

function openGeoQuick(id){
  const c=S.clientes.get(id);if(!c)return;
  if(!can('ubicacion'))return toast('Tu perfil no puede cargar ubicaciones','bad');
  openModal({title:'Ubicación de '+c.nombre,html:`${geoFieldHTML(c)}<div class="actions"><button class="btn ghost" type="button" data-close>Cancelar</button><button class="btn primary" type="button" id="geo-save">Guardar ubicación</button></div>`,onMount(el){
    const read=bindGeoField(el);
    $('#geo-save',el).addEventListener('click',async()=>{
      const g=read();
      if(g.invalid)return toast('Las coordenadas no son válidas','bad');
      try{await saveClient(c,{lat:g.empty?null:g.lat,lng:g.empty?null:g.lng});toast('Ubicación guardada');closeModal();}catch(e){dbError(e);}
    });
  }});
}

/* ----- alta y edición ----- */
function nextCodigo(){let m=0;for(const c of S.clientes.values()){const n=parseInt(c.codigo,10);if(isFinite(n)&&n>m)m=n;}return String(m+1);}
const F=(label,id,inner,hint)=>`<div class="field"><label for="${id}">${label}</label>${inner}${hint?`<div class="hint">${hint}</div>`:''}</div>`;
const opt=(v,l,sel)=>`<option value="${esc(v)}"${sel?' selected':''}>${esc(l)}</option>`;
/* los cambios de un cliente solo pueden regir después de que empezó su situación actual (si no, se reescribiría el pasado) */
const cfVigMin=c=>{const hp=c&&Array.isArray(c.hp)?c.hp:[];return hp.length?addMonths(hp[hp.length-1].h,1):'';};
const sameExtras=(a,b)=>JSON.stringify([...(a||[])].sort())===JSON.stringify([...(b||[])].sort());
function openClientForm(id){
  const old=id?S.clientes.get(id):null;
  const full=can('editarClientes');
  if(!full&&!can('ubicacion'))return toast('Tu perfil no puede editar clientes','bad');
  if(!old&&!full)return toast('Tu perfil no puede dar de alta clientes','bad');
  const c=old||{estado:'activo',alta:todayStr(),desde:todayStr().slice(0,7),ciclo:1,codigo:nextCodigo()};
  const svcs=serviciosList().filter(s=>s.activo!==false||(c.extras||[]).includes(s.id));
  const plans=[...S.planes.values()].filter(p=>p.activo!==false||p.id===c.planId).sort((a,b)=>(a.bajada-b.bajada)||(planNow(a)-planNow(b)));
  const html=`<form class="form" id="cform" novalidate>
    ${full?`<fieldset class="fgroup" style="border:0;padding:0;margin:0"><legend>Datos del cliente</legend>
      <div class="grid2">${F('Nombre y apellido *','cf-nombre',`<input id="cf-nombre" value="${esc(c.nombre||'')}" autocomplete="off">`)}${F('N° de cliente','cf-codigo',`<input id="cf-codigo" class="mono" value="${esc(c.codigo||'')}">`)}</div>
      <div class="grid2">${F('DNI','cf-dni',`<input id="cf-dni" inputmode="numeric" class="mono" value="${esc(c.dni||'')}">`)}${F('Teléfono *','cf-tel',`<input id="cf-tel" inputmode="tel" value="${esc(c.tel||'')}" placeholder="3844 56-2605">`,'Con código de área, sin 0 ni 15. Se usa para WhatsApp.')}</div>
      ${F('Otro teléfono','cf-tel2',`<input id="cf-tel2" inputmode="tel" value="${esc(c.tel2||'')}">`)}</fieldset>`:''}
    <fieldset class="fgroup" style="border:0;padding:0;margin:0"><legend>Domicilio</legend>
      ${full?`<div class="grid2">${F('Calle y número *','cf-dir',`<input id="cf-dir" value="${esc(c.dir||'')}">`)}${F('Barrio o localidad','cf-loc',`<input id="cf-loc" value="${esc(c.loc||'')}">`)}</div>`:''}
      ${F('Referencia para llegar','cf-ref',`<input id="cf-ref" value="${esc(c.ref||'')}" placeholder="Portón verde, frente a la plaza…">`)}
      ${geoFieldHTML(c)}</fieldset>
    <fieldset class="fgroup" style="border:0;padding:0;margin:0"><legend>Servicio</legend>
      ${full?`<div class="grid2">${F('Plan','cf-plan',`<select id="cf-plan"><option value="">Sin plan</option>${plans.map(p=>opt(p.id,`${p.nombre} · ${p.bajada}/${p.subida} Mbps · ${fmtMoney(planNow(p))}`,p.id===c.planId)).join('')}</select>`)}${F('Estado','cf-estado',`<select id="cf-estado">${Object.entries(ESTADOS).map(([k,v])=>opt(k,v,k===c.estado)).join('')}</select>`)}</div>`:''}
      ${full&&svcs.length?`<div class="field"><label>Servicios adicionales</label><div class="list" id="cf-extras">${svcs.map(s=>`<label class="per"><input type="checkbox" data-extra="${esc(s.id)}"${(c.extras||[]).includes(s.id)?' checked':''}><span class="grow"><b>${esc(s.nombre)}</b>${s.activo===false?' <span class="small muted">(ya no se ofrece)</span>':''}</span>${can('precios')?`<b class="tnum">${fmtMoney(planNow(s))}</b>`:''}</label>`).join('')}</div></div>`:''}
      ${full&&can('precios')?'<div class="hint" id="cf-total"></div>':''}
      ${full&&old?`<div class="notice info" id="cf-vig" hidden><div class="field"><label for="cf-vig-mes">Los cambios de plan, precio o servicios rigen desde</label><input id="cf-vig-mes" type="month" max="${curMonth()}" value="${curMonth()}"${cfVigMin(old)?` min="${cfVigMin(old)}"`:''}></div>
        <div class="hint">Los meses anteriores quedan como estaban: lo que ya pagó no se vuelve deuda.</div>
        <label class="per"><input id="cf-vig-fix" type="checkbox"><span class="grow">Es un error de carga: corregir todos los meses</span></label></div>`:''}
      <div class="grid2">${F('Tecnología','cf-tec',`<select id="cf-tec"><option value="">Sin definir</option>${Object.entries(TECNOS).map(([k,v])=>opt(k,v,k===c.tec)).join('')}</select>`)}${F('Usuario (PPPoE o similar)','cf-usuario',`<input id="cf-usuario" class="mono" autocomplete="off" value="${esc(c.usuario||'')}">`)}</div>
      <div class="grid2">${F('IP del cliente','cf-ip',`<input id="cf-ip" class="mono" inputmode="decimal" autocomplete="off" placeholder="192.168.100.4" value="${esc(c.ip||'')}">`,'Es el target de su cola en MikroTik.')}${F('Nodo o torre','cf-nodo',`<input id="cf-nodo" value="${esc(c.nodo||'')}">`)}</div>
      ${F('Equipo (serie de ONU o MAC)','cf-equipo',`<input id="cf-equipo" class="mono" value="${esc(c.equipo||'')}">`)}
      ${can('red')?napFieldHTML(c):''}</fieldset>
    ${full?`<fieldset class="fgroup" style="border:0;padding:0;margin:0"><legend>Facturación</legend>
      <div class="grid2">${F('Fecha de alta','cf-alta',`<input id="cf-alta" type="date" value="${esc(c.alta||'')}">`)}${F('Cobrar desde (mes)','cf-desde',`<input id="cf-desde" type="month" value="${esc(c.desde||'')}">`,'Antes de este mes no se genera deuda.')}</div>
      <div class="grid2">${F('Ciclo de cobro','cf-ciclo',`<select id="cf-ciclo">${[1,2].map(n=>opt(n,'Ciclo '+n+': '+cicloTxt(n),cicloOf(c)===n)).join('')}</select>`)}${F('Precio especial del plan (opcional)','cf-precio',`<input id="cf-precio" type="text" inputmode="decimal" autocomplete="off" value="${c.precio==null?'':esc(c.precio)}">`,'Reemplaza el precio del plan de internet; los servicios adicionales se suman aparte. <span id="cf-precio-h"></span>')}</div>
      <div class="grid2">${F('Deuda anterior que falta cobrar ($)','cf-da',`<input id="cf-da" type="text" inputmode="decimal" autocomplete="off" value="${deudaAntRest(c)?esc(deudaAntRest(c)):''}">`,'Lo que debía antes de empezar de cero. Va aparte: no genera cortes ni figura como moroso.')}${F('De qué meses','cf-dad',`<input id="cf-dad" autocomplete="off" placeholder="Octubre 2026" value="${esc(c.deudaAnt&&c.deudaAnt.det||'')}">`)}</div>
      ${F('Notas','cf-notas',`<textarea id="cf-notas">${esc(c.notas||'')}</textarea>`)}</fieldset>`:''}
    <div class="actions"><button class="btn ghost" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Guardar</button></div></form>`;
  openModal({title:old?'Editar cliente':'Nuevo cliente',html,onMount(el){
    const read=bindGeoField(el);const readNap=bindNapField(el,old&&old.id);const v=i=>{const n=$('#'+i,el);return n?n.value.trim():undefined;};
    bindMoney($('#cf-precio',el),$('#cf-precio-h',el));
    const upd=()=>{const t=$('#cf-total',el);if(!t)return;const pv=v('cf-precio');t.textContent='Total por mes: '+fmtMoney(priceOf({planId:v('cf-plan')||null,precio:pv?num(pv):null,extras:$$('[data-extra]',el).filter(i=>i.checked).map(i=>i.dataset.extra)}));};
    const billChanged=()=>{
      if(!old||!full)return false;
      const pv=v('cf-precio'),ex=$$('[data-extra]',el);
      return (v('cf-plan')||null)!==(old.planId||null)||String(pv===''?'':num(pv))!==String(hasNum(old.precio)?Number(old.precio):'')||(ex.length&&!sameExtras(ex.filter(i=>i.checked).map(i=>i.dataset.extra),old.extras));
    };
    const vig=()=>{const b=$('#cf-vig',el);if(b)b.hidden=!billChanged();};
    ['cf-plan','cf-precio'].forEach(i=>{const n=$('#'+i,el);if(n){n.addEventListener('input',upd);n.addEventListener('change',upd);n.addEventListener('input',vig);n.addEventListener('change',vig);}});
    $$('[data-extra]',el).forEach(i=>{i.addEventListener('change',upd);i.addEventListener('change',vig);});upd();vig();
    $('#cform',el).addEventListener('submit',async e=>{
      e.preventDefault();
      const g=read();if(g.invalid)return toast('Revisá las coordenadas','bad');
      const patch={ref:v('cf-ref'),lat:g.empty?null:g.lat,lng:g.empty?null:g.lng,tec:v('cf-tec')||null,usuario:v('cf-usuario'),ip:v('cf-ip'),nodo:v('cf-nodo'),equipo:v('cf-equipo')};
      const nf=readNap();if(nf){if(nf.bad)return toast(nf.bad,'bad');patch.nap=nf.nap;patch.napPuerto=nf.puerto;}
      if(full){
        if(!v('cf-nombre'))return toast('Falta el nombre','bad');
        if(!v('cf-dir'))return toast('Falta el domicilio','bad');
        if(!v('cf-tel'))return toast('Falta el teléfono','bad');
        const cod=v('cf-codigo');
        if(cod&&[...S.clientes.values()].some(x=>x.codigo===cod&&x.id!==(old&&old.id)))return toast('Ese N° de cliente ya existe','bad');
        const precio=v('cf-precio');
        if(precio!==''&&num(precio)===null)return toast('El precio especial no se entiende','bad');
        Object.assign(patch,{nombre:v('cf-nombre'),codigo:cod,dni:v('cf-dni'),tel:v('cf-tel'),tel2:v('cf-tel2'),dir:v('cf-dir'),loc:v('cf-loc'),planId:v('cf-plan')||null,estado:v('cf-estado'),
          alta:v('cf-alta')||todayStr(),desde:v('cf-desde')||todayStr().slice(0,7),ciclo:Number(v('cf-ciclo'))===2?2:1,precio:precio===''?null:num(precio),notas:v('cf-notas')});
      }
      if(full&&$('#cf-da',el)){
        const raw=v('cf-da'),n=raw===''?0:num(raw),det=v('cf-dad')||'';
        if(n===null||n<0)return toast('La deuda anterior no se entiende','bad');
        const was=old?deudaAntRest(old):0,wasDet=old&&old.deudaAnt&&old.deudaAnt.det||'';
        if(Math.abs(n-was)>0.004||det!==wasDet){
          const paid=old?deudaAntPagado(old):0;
          patch.deudaAnt=n>0||paid>0?{m:paid+n,det,f:(old&&old.deudaAnt&&old.deudaAnt.f)||todayStr()}:null;
        }
      }
      if(patch.estado&&patch.estado!=='suspendido')patch.corteMora=null;
      if(full&&$('#cf-extras',el))patch.extras=$$('[data-extra]',el).filter(i=>i.checked).map(i=>i.dataset.extra);
      if(old&&full&&billChanged()){
        const fix=$('#cf-vig-fix',el).checked,eff=$('#cf-vig-mes',el).value,min=cfVigMin(old);
        if(!fix){
          if(!/^\d{4}-\d{2}$/.test(eff)||eff>curMonth())return toast('Elegí desde qué mes rigen los cambios (este mes o uno anterior)','bad');
          if(min&&eff<min)return toast('Desde '+monthLabel(min)+' como mínimo: antes de eso ya figuran cambios anteriores','bad');
          if(!min||eff>min){   /* lo anterior queda como estaba hasta el mes previo */
            const h=addMonths(eff,-1),hp=(Array.isArray(old.hp)?old.hp:[]).filter(e=>e.h<h);
            hp.push({h,planId:old.planId||null,precio:hasNum(old.precio)?Number(old.precio):null,extras:Array.isArray(old.extras)?old.extras:[]});
            patch.hp=hp;
          }
        }
      }
      try{
        if(old)await saveClient(old,patch);
        else{const nid=newId();await putItem('clientes',clientShard(nid),nid,Object.assign({creado:Date.now(),mod:Date.now()},patch));}
        toast('Cliente guardado');closeModal();
      }catch(err){dbError(err);}
    });
  }});
}

/* ----- vista ----- */
VIEWS.clientes={
  mount(el){
    el.innerHTML=`<div class="toolbar"><div class="line"><input class="search" id="cl-q" type="search" placeholder="Buscar por nombre, N° de cliente, DNI, teléfono, calle o usuario" autocomplete="off" aria-label="Buscar clientes" value="${esc(CL.q)}">
      ${can('editarClientes')?'<button class="btn primary" type="button" id="cl-new">Nuevo cliente</button>':''}</div>
      <div class="seg" id="cl-seg"></div></div><div id="cl-count" class="hint"></div><div class="list" id="cl-list"></div>`;
    $('#cl-q',el).addEventListener('input',e=>{CL.q=e.target.value;CL.limit=50;this.update();});
    const nb=$('#cl-new',el);if(nb)nb.addEventListener('click',()=>openClientForm(null));
    $('#cl-seg',el).addEventListener('click',e=>{const b=e.target.closest('[data-f]');if(!b)return;CL.estado=b.dataset.f;CL.limit=50;this.update();});
    $('#cl-list',el).addEventListener('click',e=>{
      const b=e.target.closest('[data-open-client]');if(b)return openClient(b.dataset.openClient);
      if(e.target.closest('[data-more]')){CL.limit+=50;this.update();}
    });
    this.update();
  },
  update(){
    const seg=$('#cl-seg');if(!seg)return;
    const fs=[['todos','Todos'],['activo','Activos'],['suspendido','Suspendidos'],['pendiente','Por instalar'],['nogeo','Sin ubicación']];
    if(can('red'))fs.push(['nonap','Sin caja NAP']);
    if(can('caja')||can('cobrar'))fs.splice(4,0,['deuda','Con deuda'],['dant','Deuda anterior'],['c1','Ciclo 1'],['c2','Ciclo 2']);
    serviciosList().filter(s=>s.activo!==false).forEach(s=>fs.push(['sv:'+s.id,s.nombre]));
    seg.innerHTML=fs.map(([k,l])=>`<button type="button" data-f="${k}" aria-pressed="${CL.estado===k}">${l}</button>`).join('');
    const filt=c=>{
      if(CL.estado==='todos')return c.estado!=='baja';
      if(CL.estado==='nogeo')return c.estado!=='baja'&&!hasGeo(c);
      if(CL.estado==='nonap')return c.estado!=='baja'&&c.estado!=='pendiente'&&!(c.nap&&S.red.has(c.nap));
      if(CL.estado==='deuda')return billing(c).vencidos>0;
      if(CL.estado==='dant')return deudaAntRest(c)>0;
      if(CL.estado.startsWith('sv:'))return c.estado!=='baja'&&Array.isArray(c.extras)&&c.extras.includes(CL.estado.slice(3));
      if(CL.estado==='c1'||CL.estado==='c2')return c.estado!=='baja'&&cicloOf(c)===Number(CL.estado[1]);
      return c.estado===CL.estado;
    };
    const rows=searchClients(CL.q,filt);
    $('#cl-count').textContent=S.loaded.clientes?`${rows.length} ${rows.length===1?'cliente':'clientes'}`:'Cargando…';
    const list=$('#cl-list');
    if(!rows.length){
      list.innerHTML=!can('clientesTodos')&&!CL.q?'<div class="empty"><b>No tenés clientes asignados</b><span>Acá aparecen los clientes de tus órdenes abiertas.</span></div>':S.clientes.size?'<div class="empty"><b>Ningún cliente coincide</b><span>Probá con otra búsqueda o cambiá el filtro.</span></div>':`<div class="empty"><b>Todavía no hay clientes</b><span>${can('editarClientes')?'Cargá el primero o importá tu lista desde un archivo CSV en Ajustes.':'La oficina todavía no cargó clientes.'}</span></div>`;
      return;
    }
    list.innerHTML=rows.slice(0,CL.limit).map(clientRow).join('')+(rows.length>CL.limit?`<button class="btn more" type="button" data-more>Ver más (${rows.length-CL.limit})</button>`:'');
  }
};
