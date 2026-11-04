/* ===== clientes ===== */
const VIEWS={};
const CL={q:'',estado:'todos',plan:'',tec:'',limit:50};
const ESTADO_CLS={activo:'ok',suspendido:'bad',pendiente:'info',baja:''};
const planName=id=>{const p=S.planes.get(id);return p?p.nombre:'Sin plan';};
const planSpeed=p=>p?`${p.bajada}/${p.subida} Mbps`:'';
/* el plan del cliente tal como lo puede ver esta persona: el técnico no lo ve (el servidor tampoco se lo manda) */
const planVis=c=>can('verPlan')?S.planes.get(c.planId):null;
function clientHay(c){
  const hv=S.pv+'.'+S.rv,h=cuentaHead(c),hn=h&&h!==c?h.nombre:'';
  if(!c._hay||c._hayV!==hv||c._hayH!==hn){c._hay=norm([c.codigo,c.nombre,hn,can('dni')?c.dni:'',can('dni')?docDigits(c.dni):'',can('telefono')?c.tel:'',can('telefono')?c.tel2:'',c.dir,c.loc,c.usuario,c.ip,c.nodo,c.equipo,c.nap?redName(c.nap):''].join(' '));c._hayV=hv;c._hayH=hn;}
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
    if(parts.length){const h=clientHay(c);if(!parts.every(p=>h.includes(p)||(docDigits(p).length>=7&&h.includes(docDigits(p)))))continue;}   /* un CUIT se encuentra con o sin guiones */
    out.push(c);
  }
  out.sort((a,b)=>norm(a.nombre).localeCompare(norm(b.nombre)));
  return limit?out.slice(0,limit):out;
}
/* el estado del cliente tal como lo puede ver esta persona: el técnico no ve «Activo» ni «Suspendido» (por falta de pago) */
const estLabel=c=>{if(!c||!c.estado)return '';if(!veEstado()&&(c.estado==='activo'||c.estado==='suspendido'))return '';return ESTADOS[c.estado]||c.estado;};
const bajaPend=c=>!!c&&c.estado==='baja'&&c.retiro==='pend';   /* de baja, pero todavía no se confirmó que retiraron los equipos en comodato */
const estChip=c=>{if(bajaPend(c))return '<span class="chip warn">Baja · retirar equipo</span>';const l=estLabel(c);return l?`<span class="chip ${ESTADO_CLS[c.estado]||''}">${esc(l)}</span>`:'';};
function clientRow(c){
  const pl=planVis(c);
  return `<button class="item" type="button" data-open-client="${esc(c.id)}">
    <div><div class="t">${esc(c.nombre)}${c.codigo?` <span class="muted mono small">#${esc(c.codigo)}</span>`:''}</div>
    <div class="s">${esc(c.dir||'Sin domicilio')}${c.loc?' · '+esc(c.loc):''}</div></div>
    <div class="side">${c.estado==='activo'?'':estChip(c)}</div>
    <div class="tags">${pl?`<span class="chip accent">${esc(pl.nombre)} · ${esc(planSpeed(pl))}</span>`:(extrasVis(c).length||!can('verPlan')?'':'<span class="chip warn">Sin plan</span>')}${extrasVis(c).map(s=>`<span class="chip info">${esc(s.nombre)}</span>`).join('')}
    ${c.tec?`<span class="chip">${esc(TECNOS[c.tec]||c.tec)}</span>`:''}${c.nap&&redName(c.nap)?`<span class="chip">${esc(redName(c.nap))}${c.napPuerto?' · p. '+esc(c.napPuerto):''}</span>`:''}
    ${hasGeo(c)?'':'<span class="chip quiet">Sin ubicación</span>'}${cuentaChip(c)}${ctChip(c)}${billChip(c)}</div></button>`;
}
/* en la lista: a qué cuenta pertenece cada servicio */
function cuentaChip(c){
  if(!veCuenta())return '';
  const ms=cuentaMiembros(c);if(ms.length<2)return '';
  return `<span class="chip info">${ms[0]===c?'Cuenta · '+ms.length+' servicios':'Cuenta: '+esc(ms[0].nombre)}</span>`;
}
function mountClientPicker(host,opts){
  host.innerHTML=`<input type="search" class="cp-in" placeholder="${esc(opts.placeholder||'Buscar por nombre, DNI o CUIT, N° de cliente, teléfono o usuario')}" autocomplete="off" aria-label="Buscar cliente"><div class="list cp-list" style="margin-top:8px"></div>`;
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
/* Posición de un lugar fijo (la base): en vez de quedarse con UNA lectura, junta varias y las promedia dando más peso a las más precisas.
   Una sola lectura de un celular puede estar corrida varios metros; el promedio de 10 ronda bastante mejor el punto real.
   Termina con 10 lecturas, 20 s después de la primera, 30 s en total, o cuando se la frena. Devuelve {lat,lng,acc,n}:
   acc es la mejor precisión que informó el GPS (no se divide por la raíz de n: las lecturas seguidas se parecen entre sí y eso sería prometer de más). */
function gpsPromedio(onProgress){
  const S=[];let done=false,lastErr=null,id=null,t1=null,t2=null,res,rej;
  const promise=new Promise((a,b)=>{res=a;rej=b;});
  const finish=err=>{
    if(done)return;done=true;
    try{if(id!==null)navigator.geolocation.clearWatch(id);}catch(e){}
    clearTimeout(t1);clearTimeout(t2);
    if(!S.length)return rej(err||lastErr||{code:3});
    const best=Math.min(...S.map(x=>x.acc)),use=S.filter(x=>x.acc<=Math.max(30,best*2));
    let w=0,la=0,ln=0;
    for(const x of use){const k=1/(Math.max(x.acc,3)**2);w+=k;la+=x.lat*k;ln+=x.lng*k;}
    res({lat:la/w,lng:ln/w,acc:best,n:use.length});
  };
  if(!navigator.geolocation){done=true;rej({code:0});return {promise,stop(){}};}
  try{
    id=navigator.geolocation.watchPosition(p=>{
      const c=p.coords,r={lat:c.latitude,lng:c.longitude,acc:Number(c.accuracy)||0};
      if(!isFinite(r.lat)||!isFinite(r.lng))return;
      S.push(r);
      if(S.length===1)t2=setTimeout(()=>finish(),20000);
      if(onProgress)onProgress({n:S.length,acc:Math.min(...S.map(x=>x.acc))});
      if(S.length>=10)finish();
    },e=>{lastErr=e;if(e&&e.code===1)finish(e);},{enableHighAccuracy:true,maximumAge:0,timeout:20000});
  }catch(e){done=true;rej({code:0});return {promise,stop(){}};}
  t1=setTimeout(()=>finish(),30000);
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
function stripInternal(o){const r=Object.assign({},o);delete r.id;delete r._doc;delete r._hay;delete r._hayV;delete r._hayH;return r;}
async function saveClient(c,patch){
  const obj=Object.assign(stripInternal(c),patch,{mod:Date.now()});
  await putItem('clientes',clientShard(c.id),c.id,obj);
  return obj;
}
function openClient(id){
  const c=S.clientes.get(id);if(!c||!clientVisible(c)){toast('No se encontró el cliente','bad');return;}
  const pl=planVis(c),b=billing(c);
  const kv=(k,v)=>v?`<dt>${k}</dt><dd>${v}</dd>`:'';
  const tel=t=>t&&can('telefono')?`<span class="mono">${esc(t)}</span> <a class="small" href="${waUrl(t,'')}" target="_blank" rel="noopener">WhatsApp</a>`:'';
  const pays=(S.payByClient.get(c.id)||[]).slice(0,12);
  const cl=can('cobrar')||can('caja')?cutLine(c):null;
  const owes=b.aplica&&b.periods.some(p=>p.per<=todayStr().slice(0,7)&&p.rest>0);
  const ords=[...S.ordenes.values()].filter(o=>o.clientId===c.id).sort((a,b2)=>(b2.creado||'').localeCompare(a.creado||'')).slice(0,4);
  const html=`
    <div class="head-row"><div>${estChip(c)} ${billChip(c)}</div>
      <div class="actions start">${can('editarClientes')||can('ubicacion')?`<button class="btn small" type="button" data-act="editar">${can('editarClientes')?'Editar':'Editar datos técnicos'}</button>`:''}</div></div>
    <h2 style="overflow-wrap:anywhere">${esc(c.nombre)}${c.codigo?` <span class="muted mono small">#${esc(c.codigo)}</span>`:''}</h2>
    ${cl?`<div class="notice ${cl.cls}">${esc(cl.txt)}</div>`:''}
    ${bajaBlock(c)}
    ${deudaAntBlock(c)}
    ${cuentaBlock(c)}
    <dl class="kv">${kv('Domicilio',esc((c.dir||'')+(c.loc?', '+c.loc:'')))}${kv('Referencia',esc(c.ref))}${kv('Teléfono',tel(c.tel))}${kv('Otro teléfono',tel(c.tel2))}${can('dni')?kv('DNI / CUIT / CUIL',esc(c.dni)):''}
      ${kv('Plan',pl?esc(pl.nombre)+' · '+esc(planSpeed(pl))+(can('precios')?' · '+fmtMoney(priceBase(c))+'/mes':''):'')}${extrasVis(c).length?kv('Servicios adicionales',extrasVis(c).map(s=>esc(s.nombre)+(can('precios')?' · '+fmtMoney(planNow(s))+'/mes':'')).join('<br>')):''}${can('precios')&&extrasVis(c).length?kv('Total por mes','<b>'+fmtMoney(b.price)+'</b>'):''}${kv('Tecnología',esc(TECNOS[c.tec]||''))}${kv('Usuario',c.usuario?`<span class="mono">${esc(c.usuario)}</span>`:'')}${kv('IP',c.ip?`<span class="mono">${esc(c.ip)}</span>`:'')}${kv('Nodo o torre',esc(c.nodo))}${kv('Caja NAP',napLine(c))}${kv('Equipo',c.equipo?`<span class="mono">${esc(c.equipo)}</span>`:'')}
      ${kv('Alta',esc(dmy(c.alta)))}${can('cobrar')||can('caja')?kv('Ciclo de cobro','Ciclo '+cicloOf(c)+': '+esc(cicloTxt(cicloOf(c)))):''}${kv('Notas',esc(c.notas))}</dl>
    <div class="geo"><div class="legend small muted">Cómo llegar</div><div class="actions start">${geoActions(c)}${can('ubicacion')?`<button class="btn small ghost" type="button" data-act="ubicacion">${hasGeo(c)?'Cambiar ubicación':'Cargar ubicación'}</button>`:''}</div></div>
    ${pingBlock(c)}
    ${comodatoBlock(c)}
    <div class="actions start">${can('cobrar')&&!soloCampo()&&tieneDeuda(c)?'<button class="btn primary" type="button" data-act="pagar-deuda">Pagar deuda</button>':''}${can('cobrar')&&b.aplica?`<button class="btn${tieneDeuda(c)?'':' primary'}" type="button" data-act="cobrar">${enCuenta(c)?'Cobrar la cuenta ('+cuentaMiembros(c).length+' servicios)':'Cobrar'}</button>`:''}${(can('cobrar')&&!b.aplica)||soloCampo()?`<button class="btn primary" type="button" data-act="cobrar">${soloCampo()&&instalado(c)?'Cobrar reclamo o reinstalación':'Cobrar instalación o reclamo'}</button>`:''}${can('crearOrdenes')?'<button class="btn" type="button" data-act="orden">Nueva orden de trabajo</button>':''}${can('editarClientes')&&!enCuenta(c)?'<button class="btn" type="button" data-act="cuenta-menu">Cuenta unificada</button>':''}${can('ubicacion')&&pl?'<button class="btn" type="button" data-act="queue">Copiar cola de MikroTik</button>':''}${can('editarClientes')&&c.estado!=='baja'?'<button class="btn" type="button" data-act="baja">Dar de baja</button>':''}${can('editarClientes')&&bajaPend(c)?'<button class="btn primary" type="button" data-act="retiro-ok">Confirmar equipos retirados</button>':''}</div>
    ${can('promesas')&&b.aplica?promesaBlock(c,owes):''}
    ${(can('cobrar')||can('caja'))&&pays.length?`<div><h3>Últimos pagos</h3><div class="hint">Tocá un pago para abrir su recibo: desde ahí se reenvía por WhatsApp, se copia o se imprime.</div><div class="tbl-wrap" style="margin-top:8px"><table><tbody>${pays.map(p=>`<tr${p.recibo?` data-receipt="${esc(p.recibo)}" class="tap" tabindex="0"`:''}><td class="nowrap">${dmy(p.fecha)}</td><td>${esc(p.concepto==='mensualidad'&&p.per?monthLabel(p.per):CONCEPTOS[p.concepto]||'')}${p.anulado?' <span class="chip bad">Anulado</span>':''}</td><td class="right tnum">${fmtMoney(p.monto)}</td>${p.recibo?'<td class="right"><span class="btn small">Recibo</span></td>':'<td></td>'}</tr>`).join('')}</tbody></table></div></div>`:''}
    ${ords.length?`<div><h3>Órdenes</h3><div class="list" style="margin-top:8px">${ords.map(o=>`<div class="item" style="cursor:default"><div><div class="t">${esc(TIPOS_ORD[o.tipo]||o.tipo)}</div><div class="s">${esc(dmy(o.fecha))} ${o.notas?'· '+esc(o.notas):''}</div></div><div class="side"><span class="chip">${esc(EST_ORD[o.estado]||o.estado)}</span></div></div>`).join('')}</div></div>`:''}`;
  openModal({title:'Ficha del cliente',html,onMount(el){
    comodatoBind(el,c);
    el.addEventListener('keydown',e=>{const rc=e.key==='Enter'&&e.target.closest&&e.target.closest('tr[data-receipt]');if(rc)openReceipt(rc.dataset.receipt);});
    el.addEventListener('click',e=>{
      const rc=e.target.closest('[data-receipt]');if(rc)return openReceipt(rc.dataset.receipt);   /* un pago de la lista: abre su recibo (reenviar, copiar, imprimir) */
      const a=e.target.closest('[data-act]');if(!a)return;
      if(a.dataset.act==='editar')openClientForm(c.id);
      else if(a.dataset.act==='ubicacion')openGeoQuick(c.id);
      else if(a.dataset.act==='nap')openRed(c.nap);
      else if(a.dataset.act==='mover-nap')openMoverNap(c.id,c.nap);
      else if(a.dataset.act==='cobrar')openCobro(c.id);
      else if(a.dataset.act==='cobrar-da')openCobro(c.id,'deuda_anterior');
      else if(a.dataset.act==='pagar-deuda')openPagarDeuda(c.id);
      else if(a.dataset.act==='cuenta-abrir')openClient(a.dataset.id);
      else if(a.dataset.act==='cuenta-ubic')openGeoQuick(a.dataset.id);
      else if(a.dataset.act==='cuenta-editar')openClientForm(a.dataset.id);
      else if(a.dataset.act==='cuenta-menu')openCuentaMenu(c.id);
      else if(a.dataset.act==='cuenta-add')openCuentaPicker(c.id,'agregar');
      else if(a.dataset.act==='cuenta-unir')openCuentaPicker(c.id,'unir');
      else if(a.dataset.act==='cuenta-quitar')quitarDeCuenta(c.id);
      else if(a.dataset.act==='saldar-da')saldarDeudaAnt(c.id);
      else if(a.dataset.act==='orden')openOrderForm({clientId:c.id});
      else if(a.dataset.act==='queue'){const cmd=clientQueueCmd(c);if(cmd)copyText(cmd,'Comando');else toast('Cargá la IP del cliente para armar la cola','bad');}
      else if(a.dataset.act==='ping')pingProbar(c,el);
      else if(a.dataset.act==='baja')openBaja(c.id);
      else if(a.dataset.act==='retiro-ok')confirmarRetiro(c.id);
      else if(a.dataset.act==='promesa')openPromesa(c.id);
      else if(a.dataset.act==='promesa-x')anularPromesa(c.id);
    });
  }});
}
/* ----- dar de baja sin que desaparezca hasta que se retiren los equipos en comodato ----- */
function bajaBlock(c){
  if(c.estado!=='baja')return '';
  const f=c.bajaFecha?' desde el '+esc(dmy(c.bajaFecha)):'',mot=c.bajaMotivo?' Motivo: '+esc(c.bajaMotivo)+'.':'';
  if(c.retiro==='pend')return `<div class="notice"><b>De baja${f}.</b>${mot} <b>Falta retirar los equipos en comodato.</b> El cliente sigue en la lista de «Todos» hasta que se confirme el retiro.</div>`;
  return `<div class="notice info"><b>De baja${f}.</b>${mot}${c.retiro==='ok'?' Equipos retirados'+(c.retiroFecha?' el '+esc(dmy(c.retiroFecha)):'')+'.':''} Lo encontrás en «Bajas».</div>`;
}
function openBaja(id){
  const c=S.clientes.get(id);if(!c)return;
  if(!can('editarClientes'))return toast('Tu perfil no puede editar clientes','bad');
  if(c.estado==='baja')return toast('Este cliente ya está de baja','bad');
  const b=billing(c),debe=b.aplica&&b.deuda>0;
  const html=`<form class="form" id="bjform" novalidate>
    <p>Vas a dar de baja a <b>${esc(c.nombre)}</b>. Deja de facturarse y de aparecer en los cobros.</p>
    ${debe?`<div class="notice bad">Debe ${esc(fmtMoney(b.deuda))}. Cobralo antes: al pasar a baja deja de figurar como deuda.</div>`:''}
    <div class="grid2">${F('Fecha de la baja','bj-fecha',`<input id="bj-fecha" type="date" value="${esc(todayStr())}">`)}${F('Motivo (opcional)','bj-mot','<input id="bj-mot" maxlength="120" placeholder="Se mudó, se pasó a otra empresa…">')}</div>
    <label class="per"><input id="bj-eq" type="checkbox" checked><span class="grow">Tiene equipos en comodato que hay que retirar<br><span class="small muted">El cliente <b>sigue apareciendo en la lista</b> (con el aviso «Baja · retirar equipo») hasta que confirmes que se retiraron.</span></span></label>
    ${can('crearOrdenes')?`<label class="per" id="bj-ord-box"><input id="bj-ord" type="checkbox" checked><span class="grow">Crear la orden de «Retiro de equipo»<br><span class="small muted">Queda sin asignar para que la tome un técnico.</span></span></label>`:''}
    <div class="actions"><button class="btn ghost" type="button" data-close>Cancelar</button><button class="btn danger" type="submit">Dar de baja</button></div></form>`;
  openModal({title:'Dar de baja',html,onMount(el){
    const eq=$('#bj-eq',el),ord=$('#bj-ord',el);
    if(ord)eq.addEventListener('change',()=>{ord.disabled=!eq.checked;if(!eq.checked)ord.checked=false;});
    $('#bjform',el).addEventListener('submit',async e=>{
      e.preventDefault();
      const fecha=$('#bj-fecha',el).value||todayStr(),conEq=eq.checked,btn=$('button[type=submit]',el);btn.disabled=true;
      try{
        await saveClient(c,{estado:'baja',bajaFecha:fecha,bajaMotivo:$('#bj-mot',el).value.trim(),retiro:conEq?'pend':'',retiroFecha:conEq?null:fecha,corteMora:null});
        if(conEq&&ord&&ord.checked){const cre=todayStr();await putItem('ordenes',orderShard(cre.slice(0,7)),newId(),{estado:'pendiente',creado:cre,mod:Date.now(),clientId:c.id,tipo:'retiro',tecnico:null,tecNombre:null,fecha:cre,prioridad:'normal',notas:'Retirar los equipos en comodato (baja del servicio).'});}
        toast(conEq?'Cliente de baja: falta retirar los equipos':'Cliente dado de baja');closeModal();
      }catch(err){btn.disabled=false;dbError(err);}
    });
  }});
}
async function confirmarRetiro(id){
  const c=S.clientes.get(id);if(!c||!bajaPend(c))return;
  if(!can('editarClientes'))return toast('Tu perfil no puede editar clientes','bad');
  if(!await askConfirm('¿Confirmás que ya se retiraron todos los equipos en comodato de '+c.nombre+'? Después deja de aparecer en «Todos» (se encuentra en «Bajas»).','Confirmar retiro'))return;
  try{await saveClient(c,{retiro:'ok',retiroFecha:todayStr()});toast('Equipos retirados: baja completa');closeModal();}catch(err){dbError(err);}
}
/* ----- probar la conexión (ping desde un router de la empresa) ----- */
/* una sola IPv4 válida (con /32 opcional); cualquier otra cosa, o varias IP juntas, no se puede probar */
function ipUnica(t){
  const m=String(t==null?'':t).trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/32)?$/);
  if(!m||m.slice(1).some(x=>Number(x)>255))return '';
  const ip=m.slice(1).map(Number).join('.');
  return ip==='0.0.0.0'||ip.startsWith('127.')?'':ip;
}
function pingBlock(c){
  if(!can('ping')||c.estado==='baja')return '';
  const ip=ipUnica(c.ip);
  if(!ip)return `<div class="hint" id="png-box">Para probar la conexión, el cliente tiene que tener <b>una sola IP</b> cargada en su ficha.</div>`;
  return `<div class="card flat" id="png-box"><div class="head-row"><h3>Conexión</h3><button class="btn small" type="button" data-act="ping" id="png-btn">Probar conexión</button></div>
    <div id="png-out" class="hint" aria-live="polite">Un router de la empresa hace el ping a <span class="mono">${esc(ip)}</span> y te dice si responde.</div></div>`;
}
const pingMs=v=>v==null?'':(v>=10?Math.round(v):Math.round(v*10)/10)+' ms';
/* cómo se cuenta el resultado: responde / responde con pérdidas / no responde */
function pingResultado(p){
  const sent=p.sent||0,rec=p.rec||0,quien=p.router?' · desde '+esc(p.router):'',hora=p.hecho?' · '+pad(new Date(p.hecho).getHours())+':'+pad(new Date(p.hecho).getMinutes()):'';
  if(rec>=sent&&sent>0)return ['ok',`<b>Responde</b> · ${rec} de ${sent}${p.avg!=null?' · '+pingMs(p.avg):''}${quien}${hora}`];
  if(rec>0)return ['warn',`<b>Responde con pérdidas</b> · ${rec} de ${sent}${p.avg!=null?' · '+pingMs(p.avg):''}${quien}${hora}<br><span class="small">Contesta a veces: puede ser mala señal, interferencia o un equipo que se reinicia.</span>`];
  return ['bad',`<b>No responde</b> · 0 de ${sent}${quien}${hora}<br><span class="small">Puede estar apagado o sin luz, con el cable desconectado, o con el servicio cortado.</span>`];
}
async function pingProbar(c,el){
  const btn=$('#png-btn',el),out=$('#png-out',el);if(!btn||!out)return;
  const show=(cls,html)=>{out.className=cls?'notice '+cls:'hint';out.innerHTML=html;};
  btn.disabled=true;show('info','Pidiendo la prueba…');
  const alive=()=>el.isConnected&&document.body.contains(out);
  try{
    let p=(await NET.api('POST','/api/ping',{cid:c.id})).ping;
    const fin=Date.now()+60e3;
    while(alive()){
      if(p.estado==='hecho'){const [cls,html]=pingResultado(p);show(cls,html);break;}
      if(p.estado==='vencido'){show('warn','El router no contestó a tiempo. Probá de nuevo en un momento.');break;}
      if(Date.now()>fin){show('warn','Tarda más de lo normal. Probá de nuevo en un momento.');break;}
      show('info',p.estado==='toma'?'El router está haciendo el ping…':'Esperando al router…');
      await new Promise(r=>setTimeout(r,1500));
      if(!alive())break;
      p=(await NET.api('GET','/api/ping/'+encodeURIComponent(p.id))).ping;
    }
  }catch(err){if(alive())show('bad',esc(err.network?'No se pudo conectar. Revisá tu conexión e intentá de nuevo.':err.message));}
  if(alive())btn.disabled=false;
}
/* ----- cuenta unificada en la ficha ----- */
const veCuenta=()=>can('cobrar')||can('caja')||can('editarClientes');
function cuentaBlock(c){
  if(!veCuenta())return '';
  const ms=cuentaMiembros(c),ed=can('editarClientes');
  if(ms.length<2){
    return '';   /* un cliente suelto no muestra nada: el botón «Cuenta unificada» de arriba abre el menú */
  }
  const head=ms[0],verPrecio=can('precios')||can('cobrar')||can('caja'),bs=ms.map(m=>billing(m,false));
  const total=bs.reduce((s,b)=>s+(b.aplica?b.price:0),0),deuda=ms.reduce((s,m,i)=>s+(bs[i].aplica?bs[i].deuda:0),0);
  const rows=ms.map((m,i)=>`<div class="item" style="cursor:default;grid-template-columns:minmax(0,1fr)${m.id===c.id?';border-color:var(--accent-line)':''}"><div><div class="t" style="overflow-wrap:anywhere">${esc(m.nombre)}</div>
      <div class="s">${esc(m.dir||'Sin domicilio')}${m.loc?' · '+esc(m.loc):''}</div>
      <div class="s small">${esc(servicioTxt(m))}${verPrecio&&bs[i].aplica?' · '+esc(fmtMoney(bs[i].price))+'/mes':''}${hasGeo(m)?'':' · sin ubicación'}</div></div>
      <div class="tags">${m===head?'<span class="chip accent">Principal</span>':''}${estChip(m)}${verPrecio&&bs[i].aplica&&bs[i].deuda>0?`<span class="chip bad">Debe ${esc(fmtMoney(bs[i].deuda))}</span>`:''}</div>
      <div class="actions start" style="display:flex;flex-wrap:wrap;gap:6px">${m.id===c.id?'':`<button class="btn small" type="button" data-act="cuenta-abrir" data-id="${esc(m.id)}">Abrir</button>`}${can('ubicacion')?`<button class="btn small ghost" type="button" data-act="cuenta-ubic" data-id="${esc(m.id)}">${hasGeo(m)?'Cambiar ubicación':'Cargar ubicación'}</button>`:''}${can('editarClientes')?`<button class="btn small ghost" type="button" data-act="cuenta-editar" data-id="${esc(m.id)}">Editar domicilio</button>`:''}</div></div>`).join('');
  return `<div class="card flat"><div class="head-row"><h3>Cuenta unificada · ${esc(head.nombre)}</h3></div>
    <div class="hint">${ms.length} servicios. Se cobran juntos y sale un solo recibo. Cada servicio conserva su domicilio, su ubicación y su plan. Toda la cuenta sigue el ciclo ${cicloOf(head)} (${esc(cicloTxt(cicloOf(head)))}).${verPrecio?` Total por mes: <b>${esc(fmtMoney(total))}</b>${deuda>0?` · vencido: <b>${esc(fmtMoney(deuda))}</b>`:''}.`:''}</div>
    <div class="list" style="margin-top:8px">${rows}</div>
    ${ed?`<div class="actions start" style="margin-top:8px">${c===head?'<button class="btn small" type="button" data-act="cuenta-add">Sumar otro servicio a la cuenta</button>':'<button class="btn small ghost" type="button" data-act="cuenta-quitar">Sacar este servicio de la cuenta</button>'}</div>`:''}</div>`;
}
/* «Cuenta unificada» en un cliente que todavía no está en una cuenta: explica y ofrece los dos caminos */
function openCuentaMenu(id){
  const c=S.clientes.get(id);if(!c)return;
  if(!can('editarClientes'))return toast('Tu perfil no puede editar clientes','bad');
  openModal({title:'Cuenta unificada',html:`<p>Sirve para una empresa o una persona con <b>varias conexiones</b> (sucursales, locales, casa y negocio): se cobran juntas y sale <b>un solo recibo</b>. Cada conexión sigue siendo un cliente con su domicilio, su ubicación y su plan.</p>
    <p class="hint">Cargá cada conexión como un cliente aparte (cada una con su domicilio y ubicación) y después juntalas acá.</p>
    <div class="actions start" style="flex-direction:column;align-items:stretch;gap:10px">
      <button class="btn primary" type="button" id="cm-add"><span>Esta es la cuenta principal: sumarle conexiones<br><span class="small">${esc(c.nombre)} lleva el CUIT y el nombre en el recibo</span></span></button>
      <button class="btn" type="button" id="cm-unir"><span>Esta conexión pertenece a otra cuenta: elegir cuál</span></button>
      <button class="btn ghost" type="button" id="cm-volver">Volver</button></div>`,onMount(el){
    $('#cm-add',el).addEventListener('click',()=>openCuentaPicker(c.id,'agregar'));
    $('#cm-unir',el).addEventListener('click',()=>openCuentaPicker(c.id,'unir'));
    $('#cm-volver',el).addEventListener('click',()=>openClient(c.id));
  }});
}
/* guarda el cambio de cuenta y lo deja ya a la vista (la lista llega un instante después) */
async function cuentaGuardar(m,patch){
  await saveClient(m,patch);
  S.clientes.set(m.id,Object.assign({},m,patch,{mod:Date.now()}));dataChanged('clientes');
}
/* modo 'agregar': c es la cuenta principal y se elige el servicio que se suma · modo 'unir': c es el servicio y se elige la cuenta a la que va */
function openCuentaPicker(id,modo){
  const c=S.clientes.get(id);if(!c)return;
  if(!can('editarClientes'))return toast('Tu perfil no puede editar clientes','bad');
  const agregar=modo==='agregar',tiene=x=>(S.cuentaIdx.get(x.id)||[]).length>0;
  if(!agregar&&tiene(c))return toast('Este cliente es la cuenta principal de otros servicios: no puede pasar a otra cuenta','bad');
  if(agregar&&c.cuenta&&cuentaHead(c)!==c)return toast('Este servicio ya pertenece a otra cuenta','bad');
  const filter=x=>x.id!==c.id&&x.estado!=='baja'&&!x.cuenta&&(agregar?!tiene(x):true);
  openModal({title:agregar?'Sumar un servicio a la cuenta de '+c.nombre:'Unir '+c.nombre+' a una cuenta',html:`<p class="hint">${agregar?'Buscá el servicio (el nombre o parte del nombre) para sumarlo a esta cuenta.':'Buscá la cuenta principal (por ejemplo la de la empresa).'} Se cobran juntos y sale un solo recibo; cada servicio mantiene su domicilio y su ubicación.</p><div id="cu-pick"></div>
    <div class="actions"><button class="btn ghost" type="button" id="cu-volver">Volver</button></div>`,onMount(el){
    $('#cu-volver',el).addEventListener('click',()=>openClient(c.id));
    const pk=mountClientPicker($('#cu-pick',el),{filter,placeholder:agregar?'Buscar el servicio por nombre, calle o CUIT':'Buscar la cuenta por nombre o CUIT',onPick:async x=>{
      const m=agregar?x:c,h=agregar?c:x;
      const cambia=cicloOf(m)!==cicloOf(h);
      if(!await askConfirm(`${m.nombre} pasa a la cuenta de ${h.nombre}: se cobran juntos y sale un solo recibo.`+(cambia?` Su ciclo de cobro cambia del ${cicloOf(m)} al ${cicloOf(h)}, así que cambian sus fechas de vencimiento y de corte.`:''),'Unir a la cuenta'))return openClient(c.id);
      try{await cuentaGuardar(m,{cuenta:h.id});toast('Servicio sumado a la cuenta');openClient(h.id);}catch(err){dbError(err);}
    }});pk.focus();
  }});
}
async function quitarDeCuenta(id){
  const c=S.clientes.get(id);if(!c||!c.cuenta)return;
  const h=cuentaHead(c);
  if(!await askConfirm(`${c.nombre} deja la cuenta de ${h&&h!==c?h.nombre:'la empresa'}: vuelve a cobrarse y a recibir recibos por separado. Lo ya cobrado no cambia.`,'Sacar de la cuenta'))return openClient(id);
  try{await cuentaGuardar(c,{cuenta:null,ciclo:cicloOf(c)});toast('Servicio fuera de la cuenta');openClient(id);}catch(err){dbError(err);}   /* conserva el ciclo con el que venía cobrándose */
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

/* ----- reporte del técnico (el texto de WhatsApp con NOMBRE / DNI / IP / PAGO) → datos del cliente y del cobro ----- */
const REP_KEYS={nombre:'nombre',nombreyapellido:'nombre',cliente:'nombre',dni:'dni',documento:'dni',cuit:'dni',cuil:'dni',ip:'ip',pago:'pago',tel:'tel',telefono:'tel',celular:'tel',cel:'tel',whatsapp:'tel',direccion:'dir',domicilio:'dir',dir:'dir',calle:'dir',localidad:'loc',barrio:'loc',plan:'plan'};
/* "65mil", "65 mil pesos", "$65.000", "65000" → 65000 */
function parseMonto(t){
  const m=String(t==null?'':t).match(/(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(mil\b|k\b)?/i);if(!m)return null;
  const s=m[1];let n;
  if(m[2])n=parseFloat(s.replace(',','.'))*1000;
  else if(/^\d{1,3}([.,]\d{3})+$/.test(s))n=parseFloat(s.replace(/[.,]/g,''));
  else n=parseFloat(s.replace(',','.'));
  return isFinite(n)&&n>0?Math.round(n):null;
}
function parsePago(t){
  const n=norm(t),monto=parseMonto(t);if(!monto)return null;
  return {monto,metodo:/transfer|cbu|alias/.test(n)?'transferencia':/mercado\s*pago/.test(n)?'mercadopago':'efectivo',
    concepto:/reconex/.test(n)?'otro':/reclamo|visita/.test(n)?'reclamo':'instalacion',nota:String(t).trim().slice(0,160)};
}
function parseReporte(txt){
  const out={};
  String(txt==null?'':txt).split(/\r?\n/).forEach(raw=>{
    const line=raw.replace(/^[^\p{L}\p{N}]+/u,'').trim();
    const m=line.match(/^(\p{L}[\p{L} .]{0,30}?)\s*[:：]\s*(.+)$/u);if(!m)return;
    const k=REP_KEYS[norm(m[1]).replace(/[^a-z]/g,'')];if(!k||out[k]!=null)return;
    out[k]=m[2].trim();
  });
  if(out.dni!=null)out.dni=fmtDoc(out.dni.replace(/\D/g,''));
  if(out.ip!=null){const ip=out.ip.match(/\d{1,3}(?:\.\d{1,3}){3}/);out.ip=ip?ip[0]:'';}
  if(out.pago!=null)out.pago=parsePago(out.pago);
  return out;
}
/* después de dar de alta con un reporte que traía pago: abre «Cobrar» ya completado (espera a que el cliente nuevo llegue a la lista) */
async function cobrarTrasAlta(id,pre){
  if(!can('cobrar')&&!can('cobrarCampo'))return toast('El reporte traía un pago de '+fmtMoney(pre.monto)+': que lo registre quien cobra','bad');
  for(let i=0;i<40&&!S.clientes.has(id);i++)await new Promise(r=>setTimeout(r,100));
  openCobro(id,null,pre);
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
    ${!old&&full?`<details class="qsec" id="cf-rep"><summary>Completar con el reporte del técnico</summary><div class="form" style="margin-top:10px">
      ${F('Pegá el texto que mandó el técnico','cf-rep-txt','<textarea id="cf-rep-txt" rows="5" autocomplete="off" placeholder="NOMBRE: Ana Ester Paz&#10;DNI: 28354900&#10;IP: 10.20.43.9&#10;PAGO: (Efectivo) 65mil pesos"></textarea>')}
      <div class="actions start"><button class="btn small" type="button" id="cf-rep-go">Completar los datos</button></div><div class="hint" id="cf-rep-out"></div></div></details>`:''}
    ${full?`<fieldset class="fgroup" style="border:0;padding:0;margin:0"><legend>Datos del cliente</legend>
      <div class="grid2">${F('Nombre y apellido *','cf-nombre',`<input id="cf-nombre" value="${esc(c.nombre||'')}" autocomplete="off">`)}${F('N° de cliente','cf-codigo',`<input id="cf-codigo" class="mono" value="${esc(c.codigo||'')}">`)}</div>
      <div class="grid2">${F('DNI / CUIT / CUIL','cf-dni',`<input id="cf-dni" class="mono" autocomplete="off" placeholder="28354900 o 27-23373806-4" value="${esc(c.dni||'')}">`,'<span id="cf-dni-h">Un CUIT o CUIL se escribe con guiones: 27-23373806-4.</span>')}${F('Teléfono *','cf-tel',`<input id="cf-tel" inputmode="tel" value="${esc(c.tel||'')}" placeholder="3844 56-2605">`,'Con código de área, sin 0 ni 15. Se usa para WhatsApp.')}</div>
      ${F('Otro teléfono','cf-tel2',`<input id="cf-tel2" inputmode="tel" value="${esc(c.tel2||'')}">`)}</fieldset>`:''}
    <fieldset class="fgroup" style="border:0;padding:0;margin:0"><legend>Domicilio</legend>
      ${full?`<div class="grid2">${F('Calle y número *','cf-dir',`<input id="cf-dir" value="${esc(c.dir||'')}">`)}${F('Barrio o localidad','cf-loc',`<input id="cf-loc" value="${esc(c.loc||'')}">`)}</div>`:''}
      ${F('Referencia para llegar','cf-ref',`<input id="cf-ref" value="${esc(c.ref||'')}" placeholder="Portón verde, frente a la plaza…">`)}
      ${geoFieldHTML(c)}</fieldset>
    <fieldset class="fgroup" style="border:0;padding:0;margin:0"><legend>Servicio</legend>
      ${full?`<div class="grid2">${can('verPlan')?F('Plan','cf-plan',`<select id="cf-plan"><option value="">Sin plan</option>${plans.map(p=>opt(p.id,`${p.nombre} · ${p.bajada}/${p.subida} Mbps · ${fmtMoney(planNow(p))}`,p.id===c.planId)).join('')}</select>`):'<input type="hidden" id="cf-plan" value="">'}${F('Estado','cf-estado',`<select id="cf-estado">${Object.entries(ESTADOS).map(([k,v])=>opt(k,v,k===c.estado)).join('')}</select>`)}</div>`:''}
      ${full&&svcs.length?`<div class="field"><label>Servicios adicionales</label><div class="list" id="cf-extras">${svcs.map(s=>`<label class="per"><input type="checkbox" data-extra="${esc(s.id)}"${(c.extras||[]).includes(s.id)?' checked':''}><span class="grow"><b>${esc(s.nombre)}</b>${s.activo===false?' <span class="small muted">(ya no se ofrece)</span>':''}</span>${can('precios')?`<b class="tnum">${fmtMoney(planNow(s))}</b>`:''}</label>`).join('')}</div><div class="hint">Son servicios como Multimedia. Si el cliente tiene otras conexiones a su nombre, se juntan desde su ficha con «Cuenta unificada».</div></div>`:''}
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
      <div class="grid2">${F('Ciclo de cobro','cf-ciclo',`<select id="cf-ciclo"${old&&cuentaHead(old)!==old?' disabled':''}>${[1,2].map(n=>opt(n,'Ciclo '+n+': '+cicloTxt(n),cicloOf(c)===n)).join('')}</select>`,old&&cuentaHead(old)!==old?'Sigue el ciclo de la cuenta de '+esc(cuentaHead(old).nombre)+'. Para cambiarlo, cambialo en la cuenta principal.':'')}${F('Precio especial del plan (opcional)','cf-precio',`<input id="cf-precio" type="text" inputmode="decimal" autocomplete="off" value="${c.precio==null?'':esc(c.precio)}">`,'Reemplaza el precio del plan de internet; los servicios adicionales se suman aparte. <span id="cf-precio-h"></span>')}</div>
      <div class="grid2">${F('Deuda anterior que falta cobrar ($)','cf-da',`<input id="cf-da" type="text" inputmode="decimal" autocomplete="off" value="${deudaAntRest(c)?esc(deudaAntRest(c)):''}">`,'Lo que debía antes de empezar de cero. Va aparte: no genera cortes ni figura como moroso.')}${F('De qué meses','cf-dad',`<input id="cf-dad" autocomplete="off" placeholder="Octubre 2026" value="${esc(c.deudaAnt&&c.deudaAnt.det||'')}">`)}</div>
      ${F('Notas','cf-notas',`<textarea id="cf-notas">${esc(c.notas||'')}</textarea>`)}
      ${old?'<div class="hint">¿Tiene otras conexiones a su nombre (sucursales, otro local)? Se juntan desde su ficha, con el botón «Cuenta unificada»: se cobran juntas y sale un solo recibo.</div>':''}</fieldset>`:''}
    <div class="actions"><button class="btn ghost" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Guardar</button></div></form>`;
  openModal({title:old?'Editar cliente':'Nuevo cliente',html,onMount(el){
    const read=bindGeoField(el);const readNap=bindNapField(el,old&&old.id);const v=i=>{const n=$('#'+i,el);return n?n.value.trim():undefined;};
    bindMoney($('#cf-precio',el),$('#cf-precio-h',el));
    const docIn=$('#cf-dni',el),docH=$('#cf-dni-h',el);
    if(docIn&&docH){const dm0=docH.textContent,chk=()=>{const d=docDigits(docIn.value);docH.className='';docH.textContent=dm0;
      if(d.length===11){docH.className=cuitOk(docIn.value)?'ok':'bad';docH.textContent=cuitOk(docIn.value)?'CUIT o CUIL válido. Se guarda como '+fmtDoc(docIn.value)+'.':'El dígito verificador no coincide: revisá que no falte o sobre algún número.';}
      else if(d.length>8||(d.length&&d.length<7))docH.className='bad';};docIn.addEventListener('input',chk);chk();}
    const upd=()=>{const t=$('#cf-total',el);if(!t)return;const pv=v('cf-precio');t.textContent='Total por mes: '+fmtMoney(priceOf({planId:v('cf-plan')||null,precio:pv?num(pv):null,extras:$$('[data-extra]',el).filter(i=>i.checked).map(i=>i.dataset.extra)}));};
    const billChanged=()=>{
      if(!old||!full)return false;
      const pv=v('cf-precio'),ex=$$('[data-extra]',el);
      return (v('cf-plan')||null)!==(old.planId||null)||String(pv===''?'':num(pv))!==String(hasNum(old.precio)?Number(old.precio):'')||(ex.length&&!sameExtras(ex.filter(i=>i.checked).map(i=>i.dataset.extra),old.extras));
    };
    const vig=()=>{const b=$('#cf-vig',el);if(b)b.hidden=!billChanged();};
    ['cf-plan','cf-precio'].forEach(i=>{const n=$('#'+i,el);if(n){n.addEventListener('input',upd);n.addEventListener('change',upd);n.addEventListener('input',vig);n.addEventListener('change',vig);}});
    $$('[data-extra]',el).forEach(i=>{i.addEventListener('change',upd);i.addEventListener('change',vig);});upd();vig();
    let repPago=null;
    const repGo=$('#cf-rep-go',el);
    if(repGo)repGo.addEventListener('click',()=>{
      const r=parseReporte($('#cf-rep-txt',el).value),out=$('#cf-rep-out',el),got=[];
      const put=(id,val,label)=>{const n=$('#'+id,el);if(n&&val){n.value=val;n.dispatchEvent(new Event('input',{bubbles:true}));got.push(label);}};
      put('cf-nombre',r.nombre,'nombre');put('cf-dni',r.dni,'DNI');put('cf-ip',r.ip,'IP');put('cf-tel',r.tel,'teléfono');put('cf-dir',r.dir,'domicilio');put('cf-loc',r.loc,'localidad');
      if(r.plan){const pn=norm(r.plan).trim(),pl=plans.find(x=>norm(x.nombre).trim()===pn)||plans.find(x=>norm(x.nombre).includes(pn));
        if(pl){const sel=$('#cf-plan',el);sel.value=pl.id;sel.dispatchEvent(new Event('change',{bubbles:true}));got.push('plan');}}
      repPago=r.pago||null;
      if(!got.length&&!repPago){out.className='hint bad';out.textContent='No encontré datos. Pegá el texto con líneas como «NOMBRE: …», «DNI: …», «IP: …» y «PAGO: …».';return;}
      $('#cf-estado',el).value='activo';$('#cf-desde',el).value=addMonths(curMonth(),1);
      const falta=[['cf-tel','teléfono'],['cf-dir','calle y número']].filter(([i])=>!v(i)).map(x=>x[1]);
      const dup=[...S.clientes.values()].find(x=>(r.dni&&docDigits(x.dni)===docDigits(r.dni))||(r.ip&&x.ip===r.ip));
      out.className='hint'+(dup?' bad':'');
      out.textContent='Cargué: '+got.join(', ')+'. Quedó activo y empieza a cobrar en '+monthLabel(addMonths(curMonth(),1))+'.'
        +(repPago?' Pago detectado: '+(METODOS[repPago.metodo]||repPago.metodo).toLowerCase()+' '+fmtMoney(repPago.monto)+' ('+(CONCEPTOS[repPago.concepto]||repPago.concepto).toLowerCase()+'): al guardar se abre el cobro ya completado.':'')
        +(falta.length?' Falta completar: '+falta.join(' y ')+'.':'')
        +(dup?' Ojo: ya hay un cliente con ese '+(r.dni&&docDigits(dup.dni)===docDigits(r.dni)?'DNI o CUIT':'IP')+' ('+dup.nombre+').':'');
    });
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
        Object.assign(patch,{nombre:v('cf-nombre'),codigo:cod,dni:fmtDoc(v('cf-dni')),tel:v('cf-tel'),tel2:v('cf-tel2'),dir:v('cf-dir'),loc:v('cf-loc'),planId:v('cf-plan')||null,estado:v('cf-estado'),
          alta:v('cf-alta')||todayStr(),desde:v('cf-desde')||todayStr().slice(0,7),ciclo:Number(v('cf-ciclo'))===2?2:1,precio:precio===''?null:num(precio),notas:v('cf-notas')});
        if(!can('verPlan'))delete patch.planId;   /* sin el permiso no ve el plan: guardar la ficha no puede borrarlo */
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
        let nuevo=null;
        if(old)await saveClient(old,patch);
        else{const nid=newId();await putItem('clientes',clientShard(nid),nid,Object.assign({creado:Date.now(),mod:Date.now()},patch));nuevo=nid;}
        toast('Cliente guardado');closeModal();
        if(nuevo&&repPago)cobrarTrasAlta(nuevo,repPago);
      }catch(err){dbError(err);}
    });
  }});
}

/* ----- vista ----- */
VIEWS.clientes={
  mount(el){
    el.innerHTML=`<div class="toolbar"><div class="line"><input class="search" id="cl-q" type="search" placeholder="Buscar por nombre, N° de cliente, DNI o CUIT, teléfono, calle o usuario" autocomplete="off" aria-label="Buscar clientes" value="${esc(CL.q)}">
      ${can('editarClientes')?'<button class="btn primary" type="button" id="cl-new">Nuevo cliente</button>':''}</div>
      <div class="seg" id="cl-seg"></div></div><div id="cl-ct"></div><div id="cl-count" class="hint"></div><div class="list" id="cl-list"></div>`;
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
    const fs=[['todos','Todos'],...(veEstado()?[['activo','Activos'],['suspendido','Suspendidos']]:[]),['pendiente','Por instalar'],['retirar','Equipos por retirar'],['nogeo','Sin ubicación']];
    if(veEstado())fs.push(['baja','Bajas']);
    if(can('red'))fs.push(['nonap','Sin caja NAP']);
    if(can('comodato')&&S.contratosOk)fs.push(['sincontrato','Sin contrato firmado']);
    if(can('contratosGestion')&&S.contratosOk)fs.push(['conrevision','Contrato en revisión']);
    if(can('caja')||can('cobrar'))fs.splice(4,0,['deuda','Con deuda'],['dant','Deuda anterior'],['c1','Ciclo 1'],['c2','Ciclo 2']);
    if(veServicios())serviciosList().filter(s=>s.activo!==false).forEach(s=>fs.push(['sv:'+s.id,s.nombre]));
    seg.innerHTML=fs.map(([k,l])=>`<button type="button" data-f="${k}" aria-pressed="${CL.estado===k}">${l}</button>`).join('');
    const filt=c=>{
      if(CL.estado==='todos')return c.estado!=='baja'||bajaPend(c);   /* una baja con equipos sin retirar sigue en la lista hasta que se confirme */
      if(CL.estado==='retirar')return bajaPend(c);
      if(CL.estado==='nogeo')return c.estado!=='baja'&&!hasGeo(c);
      if(CL.estado==='sincontrato')return c.estado!=='baja'&&!ctVig(c.id)&&!ctRev(c.id);
      if(CL.estado==='conrevision')return !!ctRev(c.id);
      if(CL.estado==='nonap')return c.estado!=='baja'&&c.estado!=='pendiente'&&!(c.nap&&S.red.has(c.nap));
      if(CL.estado==='deuda')return billing(c).vencidos>0;
      if(CL.estado==='dant')return deudaAntRest(c)>0;
      if(CL.estado.startsWith('sv:'))return c.estado!=='baja'&&Array.isArray(c.extras)&&c.extras.includes(CL.estado.slice(3));
      if(CL.estado==='c1'||CL.estado==='c2')return c.estado!=='baja'&&cicloOf(c)===Number(CL.estado[1]);
      return c.estado===CL.estado;
    };
    const rows=searchClients(CL.q,filt);
    const cta=$('#cl-ct');if(cta){const n=can('contratosGestion')?ctPend():0;cta.innerHTML=n?`<div class="notice info" style="margin-bottom:8px"><b>${n===1?'Hay 1 contrato esperando tu revisión':'Hay '+n+' contratos esperando tu revisión'}.</b> <button class="btn small" type="button" id="cl-ct-go">Revisar</button></div>`:(can('contratosGestion')?'<div class="actions start" style="margin-bottom:8px"><button class="btn small ghost" type="button" id="cl-ct-go">Contratos de comodato</button></div>':'');const g=$('#cl-ct-go');if(g)g.onclick=()=>openContratos();}
    $('#cl-count').textContent=!S.loaded.clientes?'Cargando…':(veTotales()||rows.length<=TOPE_CONTEO)?`${rows.length} ${rows.length===1?'cliente':'clientes'}`:'';   /* sin permiso, solo se cuenta una búsqueda corta */
    const list=$('#cl-list');
    if(!rows.length){
      list.innerHTML=!can('clientesTodos')&&!CL.q?'<div class="empty"><b>No tenés clientes asignados</b><span>Acá aparecen los clientes de tus órdenes abiertas.</span></div>':S.clientes.size?'<div class="empty"><b>Ningún cliente coincide</b><span>Probá con otra búsqueda o cambiá el filtro.</span></div>':`<div class="empty"><b>Todavía no hay clientes</b><span>${can('editarClientes')?'Cargá el primero o importá tu lista desde un archivo CSV en Ajustes.':'La oficina todavía no cargó clientes.'}</span></div>`;
      return;
    }
    list.innerHTML=rows.slice(0,CL.limit).map(clientRow).join('')+(rows.length>CL.limit?`<button class="btn more" type="button" data-more>Ver más${veTotales()?` (${rows.length-CL.limit})`:''}</button>`:'');
  }
};
