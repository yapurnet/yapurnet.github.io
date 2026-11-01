/* ===== órdenes de trabajo ===== */
const OR={scope:'mias',estado:'abiertas',tec:''};
const ORD_OPEN=o=>o.estado!=='hecha'&&o.estado!=='cancelada';
const tecById=id=>S.ajustes.tecnicos.find(t=>t.id===id);
const tecLabel=o=>{const t=tecById(o.tecnico);return t?t.nombre:(o.tecNombre||'');};
const ESTADO_ORD_CLS={pendiente:'warn',en_camino:'info',en_curso:'info',hecha:'ok',cancelada:''};
async function saveOrder(o,patch){
  const obj=Object.assign(stripInternal(o),patch,{mod:Date.now()});
  await putItem('ordenes',o._doc,o.id,obj);
}
function orderText(o,c){
  const lines=[`Orden de trabajo: ${TIPOS_ORD[o.tipo]||o.tipo}${o.prioridad==='urgente'?' (URGENTE)':''}`,`Cliente: ${c?c.nombre:'(sin cliente)'}`];
  if(c){lines.push(`Dirección: ${c.dir||''}${c.loc?', '+c.loc:''}`);if(c.ref)lines.push(`Referencia: ${c.ref}`);if(c.tel&&can('telefono'))lines.push(`Teléfono: ${c.tel}`);
    lines.push(hasGeo(c)?`Cómo llegar: ${mapsNav(c)}`:'Ubicación: sin coordenadas cargadas');}
  if(o.fecha)lines.push(`Fecha: ${dmy(o.fecha)}`);if(o.notas)lines.push(`Notas: ${o.notas}`);
  return lines.join('\n');
}
function orderCard(o){
  const c=S.clientes.get(o.clientId),open=ORD_OPEN(o);
  const tec=tecLabel(o),t=tecById(o.tecnico);
  const next={pendiente:['en_camino','Salgo para allá'],en_camino:['en_curso','Llegué, empiezo'],en_curso:['hecha','Terminar']}[o.estado];
  return `<article class="card ord${o.prioridad==='urgente'&&open?' urgent':''}" data-oid="${esc(o.id)}">
    <div class="head-row"><div class="stripe"><span class="chip accent">${esc(TIPOS_ORD[o.tipo]||o.tipo)}</span><span class="chip ${ESTADO_ORD_CLS[o.estado]||''}">${esc(EST_ORD[o.estado]||o.estado)}</span>${o.prioridad==='urgente'?'<span class="chip bad">Urgente</span>':''}</div>
      <span class="small muted">${o.fecha?esc(dateLabel(o.fecha)):''}</span></div>
    <div><div class="t" style="font-weight:700;overflow-wrap:anywhere">${esc(c?c.nombre:'Cliente no encontrado')}</div>
      <div class="s muted" style="overflow-wrap:anywhere">${esc(c?(c.dir||'')+(c.loc?', '+c.loc:''):'')}${c&&c.ref?' · '+esc(c.ref):''}</div></div>
    ${o.notas?`<div>${esc(o.notas)}</div>`:''}${o.resultado?`<div class="notice info"><b>Resultado:</b> ${esc(o.resultado)}</div>`:''}
    <div class="small muted">${tec?'Asignada a <b>'+esc(tec)+'</b>':'Sin técnico asignado'}${o.cierre?' · cerrada '+esc(o.cierre):''}</div>
    ${open&&c?`<div class="actions start">${geoActions(c)}${hasGeo(c)||!can('ubicacion')?'':'<button class="btn small" type="button" data-oact="geo">Cargar ubicación</button>'}</div>
      ${c.tel&&can('telefono')?`<div class="small">Cliente: <span class="mono">${esc(c.tel)}</span> · <a href="${waUrl(c.tel,'')}" target="_blank" rel="noopener">WhatsApp</a> · <button class="btn small ghost" type="button" data-copy="${esc(c.tel)}" data-copy-label="Teléfono">Copiar</button></div>`:''}`:''}
    ${open?`<div class="actions start">${next&&can('operarOrdenes')?`<button class="btn primary" type="button" data-oact="next">${next[1]}</button>`:''}
      ${!o.tecnico&&S.tecId&&!can('ordenesTodas')&&can('operarOrdenes')?'<button class="btn" type="button" data-oact="take">Tomar esta orden</button>':''}
      ${can('crearOrdenes')?'<button class="btn small" type="button" data-oact="edit">Editar</button>':''}
      ${can('ordenesTodas')?`<a class="btn small" target="_blank" rel="noopener" href="${waUrl(t?t.tel:'',orderText(o,c))}">Enviar por WhatsApp</a><button class="btn small danger" type="button" data-oact="cancel">Cancelar</button>`:''}</div>`:''}
  </article>`;
}
function openOrderForm({id,clientId}){
  if(!can('crearOrdenes'))return toast('Tu perfil no puede crear órdenes','bad');
  const old=id?S.ordenes.get(id):null;
  const o=old||{tipo:'visita',prioridad:'normal',fecha:todayStr(),tecnico:can('ordenesTodas')?'':S.tecId};
  let cid=old?old.clientId:clientId;
  const html=`<form class="form" id="oform" novalidate>
    <div id="of-client"></div>
    <div class="grid2">${F('Tipo de trabajo','of-tipo',`<select id="of-tipo">${Object.entries(TIPOS_ORD).map(([k,v])=>opt(k,v,k===o.tipo)).join('')}</select>`)}
    ${F('Técnico','of-tec',`<select id="of-tec"><option value="">Sin asignar</option>${S.ajustes.tecnicos.filter(t=>can('ordenesTodas')||t.id===S.tecId||t.id===o.tecnico).map(t=>opt(t.id,t.nombre,t.id===o.tecnico)).join('')}</select>`)}</div>
    <div class="grid2">${F('Fecha','of-fecha',`<input id="of-fecha" type="date" value="${esc(o.fecha||'')}">`)}
    ${F('Prioridad','of-prio',`<select id="of-prio">${opt('normal','Normal',o.prioridad!=='urgente')}${opt('urgente','Urgente',o.prioridad==='urgente')}</select>`)}</div>
    ${F('Qué hay que hacer','of-notas',`<textarea id="of-notas" placeholder="Sin internet desde ayer, revisar ONU y conector…">${esc(o.notas||'')}</textarea>`)}
    <div class="actions"><button class="btn ghost" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">${old?'Guardar cambios':'Crear orden'}</button></div></form>`;
  openModal({title:old?'Editar orden':'Nueva orden de trabajo',html,onMount(el){
    const box=$('#of-client',el);
    const drawClient=()=>{
      const c=cid?S.clientes.get(cid):null;
      if(c){
        box.innerHTML=`<div class="geo"><div class="head-row"><div><div style="font-weight:700">${esc(c.nombre)}</div><div class="small muted">${esc(c.dir||'')}${c.loc?', '+esc(c.loc):''}</div></div>${old?'':'<button class="btn small ghost" type="button" id="of-chg">Cambiar</button>'}</div>
          ${hasGeo(c)?'<span class="chip ok">Con ubicación para llegar</span>':'<span class="chip warn">Sin ubicación: cargala desde la ficha del cliente</span>'}</div>`;
        const ch=$('#of-chg',box);if(ch)ch.addEventListener('click',()=>{cid=null;drawClient();});
      }else{
        box.innerHTML='<div class="field"><label>Cliente *</label><div id="of-pick"></div></div>';
        const pk=mountClientPicker($('#of-pick',box),{onPick:c=>{cid=c.id;drawClient();}});pk.focus();
      }
    };
    drawClient();
    $('#oform',el).addEventListener('submit',async e=>{
      e.preventDefault();
      if(!cid)return toast('Elegí el cliente','bad');
      const tid=$('#of-tec',el).value,t=tecById(tid);
      const patch={clientId:cid,tipo:$('#of-tipo',el).value,tecnico:tid||null,tecNombre:t?t.nombre:null,fecha:$('#of-fecha',el).value||todayStr(),prioridad:$('#of-prio',el).value,notas:$('#of-notas',el).value.trim()};
      try{
        if(old)await saveOrder(old,patch);
        else{const nid=newId(),cre=todayStr();await putItem('ordenes',orderShard(cre.slice(0,7)),nid,Object.assign({estado:'pendiente',creado:cre,mod:Date.now()},patch));}
        toast(old?'Orden actualizada':'Orden creada');closeModal();
      }catch(err){dbError(err);}
    });
  }});
}
/* cobro que se hace en el mismo momento en que se termina el trabajo (instalación, reclamo). Una reconexión solo se cobra si el cliente tiene deuda y la cobra la oficina: el técnico nunca */
const CONC_ORD={instalacion:'instalacion',falla:'reclamo',visita:'reclamo',reconexion:'reconexion'};
const puedeCobrarOrden=(c,o)=>!!c&&!!o&&(o.tipo==='reconexion'?can('cobrar')&&conDeuda(c):(can('cobrar')||can('cobrarCampo')));
function cobroOrdenHTML(o,c){
  const lista=conceptosCobro(c,soloCampo());
  let con0=CONC_ORD[o.tipo]||'otro';
  if(con0==='instalacion'&&instalado(c))con0='reinstalacion';   /* una instalación sobre un cliente ya instalado es una mudanza */
  if(!lista.includes(con0))con0=lista.includes('otro')?'otro':lista[0];
  return `<div class="fgroup"><div class="legend">Cobro del trabajo</div>
    <label class="per"><input id="ff-cobro" type="checkbox"><span class="grow">Cobré este trabajo<br><span class="small muted">Queda a tu nombre y suma a la caja del día.</span></span></label>
    <div id="ff-cobro-box" hidden>
      <div class="grid2">${F('Concepto','ff-con',`<select id="ff-con">${Object.entries(CONCEPTOS).filter(([k])=>lista.includes(k)).map(([k,v])=>opt(k,v,k===con0)).join('')}</select>`)}
      ${F('Medio de pago','ff-met',`<select id="ff-met">${Object.entries(METODOS).map(([k,v])=>opt(k,v,k==='efectivo')).join('')}</select>`)}</div>
      ${F('Monto cobrado','ff-monto',`<input id="ff-monto" type="text" inputmode="decimal" autocomplete="off"${precioFijo(con0)?` value="${precioFijo(con0)}"${soloCampo()?' readonly':''}`:''}>`,'')}
      <div class="hint" id="ff-fijo">${precioFijo(con0)&&soloCampo()?'Precio fijo: '+fmtMoney(precioFijo(con0))+'. Lo define el administrador.':''}</div>
      ${soloCampo()?compHTML('ff'):''}
    </div></div>`;
}
function openFinishOrder(o){
  const c=S.clientes.get(o.clientId);
  /* activar / reactivar / dar de baja cambia la facturación: solo se ofrece a quien puede editar clientes (al técnico le fallaba y se perdía hasta la ubicación) */
  const sug=c&&can('editarClientes')&&((o.tipo==='instalacion'&&c.estado==='pendiente')?['activo','Dejar al cliente como activo y empezar a cobrarle este mes']:(o.tipo==='reconexion'&&c.estado==='suspendido')?['activo','Reactivar al cliente (levantar la suspensión)']:(o.tipo==='retiro'&&c.estado!=='baja')?['baja','Dar de baja al cliente']:null);
  const html=`<form class="form" id="fform" novalidate>${F('Qué se hizo','ff-res','<textarea id="ff-res" placeholder="Se instaló ONU, señal -19 dBm, cliente conforme."></textarea>')}
    ${c&&!hasGeo(c)?`<div class="notice">Este cliente no tiene ubicación. Si estás en el domicilio, cargala ahora.</div>${geoFieldHTML(c)}`:''}
    ${c&&o.tipo==='instalacion'&&can('red')?`<div class="fgroup"><div class="legend">Caja NAP de la que sale</div>${napFieldHTML(c)}</div>`:''}
    ${puedeCobrarOrden(c,o)?cobroOrdenHTML(o,c):''}
    ${sug?`<label class="per"><input id="ff-est" type="checkbox" checked><span class="grow">${sug[1]}</span></label>`:''}
    <div class="actions"><button class="btn ghost" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Marcar como hecha</button></div></form>`;
  openModal({title:'Terminar orden',html,onMount(el){
    const read=c&&!hasGeo(c)?bindGeoField(el):null;
    const readNap=c&&o.tipo==='instalacion'&&can('red')?bindNapField(el,c.id):null;
    const ckc=$('#ff-cobro',el);
    const comp=ckc&&soloCampo()?mountComp(el,'ff',()=>$('#ff-met',el).value):null;
    if(comp){$('#ff-met',el).addEventListener('change',comp.sync);comp.sync();}
    if(ckc)ckc.addEventListener('change',()=>{$('#ff-cobro-box',el).hidden=!ckc.checked;if(ckc.checked)$('#ff-monto',el).focus();});
    /* al cambiar el concepto: instalación y reinstalación llevan su precio fijo (el técnico no lo puede cambiar) */
    const selCon=$('#ff-con',el);
    if(selCon)selCon.addEventListener('change',()=>{
      const m=$('#ff-monto',el),pf=precioFijo(selCon.value),campo=soloCampo();
      if(pf){m.value=pf;m.readOnly=campo;}else{if(m.readOnly)m.value='';m.readOnly=false;}
      $('#ff-fijo',el).textContent=pf&&campo?'Precio fijo: '+fmtMoney(pf)+'. Lo define el administrador.':'';
    });
    $('#fform',el).addEventListener('submit',async e=>{
      e.preventDefault();
      const g=read?read():{empty:true};if(g.invalid)return toast('Revisá las coordenadas','bad');
      const nf=readNap?readNap():null;if(nf&&nf.bad)return toast(nf.bad,'bad');
      const cobra=ckc&&ckc.checked,fijoC=cobra&&soloCampo()?precioFijo($('#ff-con',el).value):null,monto=cobra?(fijoC||num($('#ff-monto',el).value)):0;
      if(cobra&&(!monto||monto<=0))return toast('Ingresá el monto que cobraste','bad');
      const sinFoto=cobra&&comp?comp.falta():'';if(sinFoto)return toast(sinFoto,'bad');   /* antes de cerrar la orden: si falta la foto no se cierra nada */
      try{
        await saveOrder(o,{estado:'hecha',resultado:$('#ff-res',el).value.trim(),cierre:todayStr()+' '+nowTime()});
        const cp={};
        if(!g.empty&&c)Object.assign(cp,{lat:g.lat,lng:g.lng});
        if(nf&&c&&(nf.nap!==(c.nap||null)||nf.puerto!==(c.napPuerto||null)))Object.assign(cp,{nap:nf.nap,napPuerto:nf.puerto});
        const ck=$('#ff-est',el);
        if(ck&&ck.checked&&sug){cp.estado=sug[0];if(sug[0]==='activo'){cp.corteMora=null;if(c.estado==='pendiente'){cp.alta=todayStr();cp.desde=todayStr().slice(0,7);}}}
        if(c&&Object.keys(cp).length)await saveClient(c,cp);
        let rec=null;
        if(cobra){
          /* la orden ya quedó cerrada: si el cobro falla se avisa claro y se carga a mano, sin repetir nada */
          try{rec=await cobrarOtro(c,{concepto:$('#ff-con',el).value,monto,metodo:$('#ff-met',el).value,nota:TIPOS_ORD[o.tipo]||'',comp:comp?comp.id():null});}
          catch(err2){toast('La orden se cerró, pero el cobro NO se registró. Cargalo con «Cobrar».','bad');}
        }
        toast(rec?'Orden cerrada y cobro registrado':'Orden cerrada');closeModal();
        if(rec)openReceipt(rec);
      }catch(err){dbError(err);}
    });
  }});
}
async function orderAction(o,act){
  try{
    if(act==='next'){
      if(o.estado==='pendiente')await saveOrder(o,{estado:'en_camino',tecnico:o.tecnico||S.tecId||null,tecNombre:o.tecNombre||(tecById(S.tecId)||{}).nombre||null});
      else if(o.estado==='en_camino')await saveOrder(o,{estado:'en_curso'});
      else openFinishOrder(o);
    }else if(act==='take'){const t=tecById(S.tecId);await saveOrder(o,{tecnico:S.tecId,tecNombre:t?t.nombre:null});toast('Orden asignada a vos');}
    else if(act==='edit')openOrderForm({id:o.id});
    else if(act==='geo')openGeoQuick(o.clientId);
    else if(act==='cancel'){if(await askConfirm('¿Cancelar esta orden de trabajo?','Cancelar orden',true)){await saveOrder(o,{estado:'cancelada',cierre:todayStr()+' '+nowTime()});toast('Orden cancelada');}}
  }catch(err){dbError(err);}
}
VIEWS.ordenes={
  mount(el){
    const tech=!can('ordenesTodas');
    el.innerHTML=`<div class="head-row"><h2>Órdenes de trabajo</h2>${can('crearOrdenes')?'<button class="btn primary" type="button" id="or-new">Nueva orden</button>':''}</div>
      <div id="or-who"></div><div class="toolbar"><div class="seg" id="or-seg"></div>
      ${tech?'':`<div class="line"><select id="or-tec" class="search" aria-label="Filtrar por técnico"></select></div>`}</div>
      <div class="list" id="or-list"></div>`;
    const nb=$('#or-new',el);if(nb)nb.addEventListener('click',()=>openOrderForm({}));
    $('#or-seg',el).addEventListener('click',e=>{const b=e.target.closest('[data-f]');if(!b)return;
      if(b.dataset.f==='mias'||b.dataset.f==='libres')OR.scope=b.dataset.f;else OR.estado=b.dataset.f;this.update();});
    const tsel=$('#or-tec',el);if(tsel)tsel.addEventListener('change',()=>{OR.tec=tsel.value;this.update();});
    $('#or-who',el).addEventListener('click',e=>{const b=e.target.closest('[data-iam]');if(!b)return;S.tecId=b.dataset.iam;lsSet('tecId',S.tecId);this.update();});
    $('#or-list',el).addEventListener('click',e=>{
      const b=e.target.closest('[data-oact]');if(!b)return;
      const card=b.closest('[data-oid]');const o=card&&S.ordenes.get(card.dataset.oid);if(o)orderAction(o,b.dataset.oact);
    });
    this.update();
  },
  update(){
    const seg=$('#or-seg');if(!seg)return;
    const tech=!can('ordenesTodas'),techs=S.ajustes.tecnicos;
    const iam=tech&&!!S.tecId&&!!S.perfil;
    const who=$('#or-who');
    who.innerHTML=iam?`<div class="hint">Trabajás como <b>${esc(S.perfil.nombre)}</b>.</div>`:'';
    const fs=[['abiertas','Abiertas'],['hechas','Cerradas'],['todas_est','Todas']];
    seg.innerHTML=(iam?[['mias','Mías'],['libres','Sin asignar']].map(([k,l])=>`<button type="button" data-f="${k}" aria-pressed="${OR.scope===k}">${l}</button>`).join('')+'<span style="width:8px"></span>':'')
      +fs.map(([k,l])=>`<button type="button" data-f="${k}" aria-pressed="${OR.estado===k}">${l}</button>`).join('');
    const tsel=$('#or-tec');
    if(tsel){const cur=OR.tec;tsel.innerHTML=`<option value="">Todos los técnicos</option><option value="_none">Sin asignar</option>${techs.map(t=>opt(t.id,t.nombre,t.id===cur)).join('')}`;tsel.value=cur;}
    let rows=[...S.ordenes.values()].filter(o=>{
      if(OR.estado==='abiertas'&&!ORD_OPEN(o))return false;
      if(OR.estado==='hechas'&&ORD_OPEN(o))return false;
      if(tech){const sc=iam?OR.scope:'libres';if(sc==='mias'?o.tecnico!==S.tecId:!!o.tecnico)return false;}
      if(!tech&&OR.tec){if(OR.tec==='_none'?!!o.tecnico:o.tecnico!==OR.tec)return false;}
      return true;
    });
    rows.sort((a,b)=>{
      if(OR.estado==='abiertas'){const u=(b.prioridad==='urgente')-(a.prioridad==='urgente');if(u)return u;return (a.fecha||'').localeCompare(b.fecha||'')||(a.creado||'').localeCompare(b.creado||'');}
      return (b.cierre||b.creado||'').localeCompare(a.cierre||a.creado||'');
    });
    const list=$('#or-list');
    list.innerHTML=rows.length?rows.slice(0,100).map(orderCard).join('')+(rows.length>100?`<div class="hint">Se muestran las primeras 100 de ${rows.length}.</div>`:''):`<div class="empty"><b>${S.loaded.ordenes?'No hay órdenes para mostrar':'Cargando…'}</b><span>${OR.estado==='abiertas'?'Cuando se cree una orden aparece acá con el botón para llegar al domicilio.':'Cambiá el filtro para ver otras.'}</span></div>`;
  }
};
