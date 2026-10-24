/* ===== red: cajas NAP y botellas de empalme ===== */
const RED={q:'',tipo:'todos',sort:'nombre',me:null,limit:60};
const RED_TIPO={nap:'Caja NAP',empalme:'Botella de empalme'};
const redName=id=>{const p=id&&S.red.get(id);return p?p.nombre:'';};
const redCmp=(a,b)=>norm(a.nombre).localeCompare(norm(b.nombre),'es',{numeric:true});
/* distancia en metros entre dos puntos con lat/lng (fórmula del haversine) */
function distM(a,b){
  const R=6371000,r=x=>parseFloat(x)*Math.PI/180;
  const dLat=r(b.lat)-r(a.lat),dLng=r(b.lng)-r(a.lng);
  const h=Math.sin(dLat/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
}
const fmtDist=m=>m<1000?Math.round(m)+' m':(m/1000).toFixed(1).replace('.',',')+' km';
/* clientes que hoy cuelgan de una caja (los dados de baja ya no ocupan puerto) */
const napClients=id=>[...S.clientes.values()].filter(c=>c.nap===id&&c.estado!=='baja');
const napUsed=id=>napClients(id).length;
const redKids=id=>[...S.red.values()].filter(p=>p.padre===id);
function redDescendants(id){
  const out=new Set(),todo=[id];
  while(todo.length){const x=todo.pop();for(const k of redKids(x))if(!out.has(k.id)){out.add(k.id);todo.push(k.id);}}
  return out;
}
function napLine(c){
  if(!c||!c.nap)return '';
  const p=S.red.get(c.nap);if(!p)return '';
  return `<b>${esc(p.nombre)}</b>${c.napPuerto?' · puerto '+esc(c.napPuerto):''} <button class="btn small ghost" type="button" data-act="nap">Ver caja</button>`;
}

/* ----- campo «Caja NAP» + puerto del cliente (formulario y cierre de instalación) ----- */
function napOptionsHTML(sel,from){
  const l=[...S.red.values()].filter(p=>p.tipo==='nap').map(p=>({p,d:from&&hasGeo(p)?distM(from,p):null}));
  l.sort((a,b)=>(a.d!=null&&b.d!=null)?a.d-b.d:(a.d!=null?-1:(b.d!=null?1:redCmp(a.p,b.p))));
  return '<option value="">Sin caja asignada</option>'+l.map(({p,d})=>{
    const u=napUsed(p.id);
    return opt(p.id,p.nombre+' · '+(p.puertos?u+'/'+p.puertos+' puertos':u+(u===1?' cliente':' clientes'))+(d!=null?' · a '+fmtDist(d):''),p.id===sel);
  }).join('');
}
function napFieldHTML(c){
  const from=hasGeo(c)?c:null,none=![...S.red.values()].some(p=>p.tipo==='nap');
  return `<div class="grid2">${F('Caja NAP de la que sale','cf-nap',`<select id="cf-nap">${napOptionsHTML(c&&c.nap,from)}</select>`,none?'Todavía no hay cajas NAP cargadas: se cargan en la pestaña «Red».':'Con la ubicación cargada, las más cercanas aparecen primero.')}
    ${F('Puerto','cf-nap-puerto',`<input id="cf-nap-puerto" type="number" min="1" max="288" step="1" inputmode="numeric" value="${c&&c.napPuerto?esc(c.napPuerto):''}">`)}</div>
    <div class="hint" id="cf-nap-hint"></div>`;
}
/* devuelve una función que lee el campo: null si no está en pantalla, {nap,puerto} o {bad:'texto'} */
function bindNapField(root,selfId){
  const sel=$('#cf-nap',root),pu=$('#cf-nap-puerto',root),hint=$('#cf-nap-hint',root),geo=$('#cf-geo',root);
  if(!sel)return ()=>null;
  const sort=()=>{   /* si cambian las coordenadas (por ejemplo con el GPS), las cajas más cercanas pasan arriba */
    const g=geo&&parseCoords(geo.value),cur=sel.value;
    if(!g)return;
    sel.innerHTML=napOptionsHTML(cur,g);sel.value=cur;
  };
  const check=()=>{
    const id=sel.value,n=parseInt(pu.value,10),p=id&&S.red.get(id);
    hint.className='hint';hint.textContent='';
    if(pu.value&&!id){hint.className='hint bad';hint.textContent='Elegí la caja a la que corresponde ese puerto.';return;}
    if(!p)return;
    if(pu.value&&!(n>=1)){hint.className='hint bad';hint.textContent='El puerto tiene que ser un número.';return;}
    if(p.puertos&&n>p.puertos){hint.className='hint bad';hint.textContent=p.nombre+' tiene '+p.puertos+' puertos: el '+n+' no existe.';return;}
    const other=pu.value?napClients(id).find(c=>c.id!==selfId&&parseInt(c.napPuerto,10)===n):null;
    if(other){hint.className='hint bad';hint.textContent='El puerto '+n+' de '+p.nombre+' ya figura usado'+(clientVisible(other)?' por '+other.nombre:' por otro cliente')+'. Revisalo.';return;}
    const used=napClients(id).filter(c=>c.id!==selfId).map(c=>parseInt(c.napPuerto,10)).filter(x=>x>=1);
    if(p.puertos){
      const free=[];for(let i=1;i<=p.puertos&&free.length<12;i++)if(!used.includes(i))free.push(i);
      hint.textContent=free.length?'Puertos sin usar: '+free.join(', ')+(free.length===12?'…':'')+'.':(napUsed(id)-(napClients(id).some(c=>c.id===selfId)?1:0)>=p.puertos?'Esta caja está llena.':'');
    }
  };
  sel.addEventListener('change',check);pu.addEventListener('input',check);
  if(geo)geo.addEventListener('input',sort);
  check();
  return ()=>{
    const id=sel.value||null,raw=pu.value.trim(),n=raw===''?null:parseInt(raw,10);
    if(raw!==''&&!(n>=1))return {bad:'El puerto tiene que ser un número.'};
    if(raw!==''&&!id)return {bad:'Elegí la caja NAP de ese puerto.'};
    return {nap:id,puerto:id?n:null};
  };
}

/* ----- lista ----- */
function redRow(p,d){
  const nap=p.tipo==='nap',u=nap?napUsed(p.id):0,kids=redKids(p.id).length,par=p.padre?redName(p.padre):'';
  const use=nap?(p.puertos?`<span class="chip ${u>=p.puertos?'bad':'ok'}">${u}/${p.puertos} puertos</span>`:`<span class="chip">${u} ${u===1?'cliente':'clientes'}</span>`):(kids?`<span class="chip info">Alimenta ${kids}</span>`:'');
  return `<button class="item" type="button" data-open-red="${esc(p.id)}">
    <div><div class="t">${esc(p.nombre)} <span class="chip ${nap?'accent':'info'}">${esc(RED_TIPO[p.tipo]||p.tipo)}</span></div>
    <div class="s">${esc([p.ref,par?'Sale de '+par:''].filter(Boolean).join(' · ')||'Sin referencia')}</div></div>
    <div class="side">${use}</div>
    <div class="tags">${hasGeo(p)?'':'<span class="chip warn">Sin ubicación</span>'}${d!=null?`<span class="chip info">a ${esc(fmtDist(d))}</span>`:''}</div></button>`;
}
function redRows(){
  const parts=norm(RED.q).trim().split(/\s+/).filter(Boolean);
  let l=[...S.red.values()].filter(p=>{
    if(RED.tipo==='nap'&&p.tipo!=='nap')return false;
    if(RED.tipo==='empalme'&&p.tipo!=='empalme')return false;
    if(RED.tipo==='nogeo'&&hasGeo(p))return false;
    if(RED.tipo==='llenas'&&!(p.tipo==='nap'&&p.puertos&&napUsed(p.id)>=p.puertos))return false;
    if(parts.length){const h=norm([p.nombre,p.ref,p.notas,RED_TIPO[p.tipo],redName(p.padre)].join(' '));if(!parts.every(x=>h.includes(x)))return false;}
    return true;
  }).map(p=>({p,d:RED.sort==='cerca'&&RED.me&&hasGeo(p)?distM(RED.me,p):null}));
  if(RED.sort==='cerca'&&RED.me)l.sort((a,b)=>(a.d!=null&&b.d!=null)?a.d-b.d:(a.d!=null?-1:(b.d!=null?1:redCmp(a.p,b.p))));
  else l.sort((a,b)=>redCmp(a.p,b.p));
  return l;
}
let redRun=null;
function exportRed(){
  const rows=[['tipo','nombre','latitud','longitud','puertos','clientes conectados','sale de','referencia','notas']];
  [...S.red.values()].sort((a,b)=>(a.tipo===b.tipo?0:a.tipo==='nap'?-1:1)||redCmp(a,b)).forEach(p=>{
    rows.push([RED_TIPO[p.tipo]||p.tipo,p.nombre,hasGeo(p)?p.lat:'',hasGeo(p)?p.lng:'',p.puertos||'',p.tipo==='nap'?napUsed(p.id):'',redName(p.padre),p.ref||'',p.notas||'']);
  });
  saveFile('red-'+todayStr()+'.csv',toCsv(rows));
}
VIEWS.red={
  mount(el){
    el.innerHTML=`<div class="toolbar"><div class="line"><input class="search" id="rd-q" type="search" placeholder="Buscar caja o empalme por nombre o referencia" autocomplete="off" aria-label="Buscar en la red" value="${esc(RED.q)}"></div>
      <div class="line"><button class="btn primary" type="button" id="rd-new-nap">Nueva caja NAP</button><button class="btn" type="button" id="rd-new-emp">Nueva botella de empalme</button></div>
      <div class="seg" id="rd-seg"></div>
      <div class="line"><button class="btn small" type="button" id="rd-near">Ordenar por cercanía (GPS)</button><button class="btn small ghost" type="button" id="rd-name" hidden>Ordenar por nombre</button><button class="btn small ghost" type="button" id="rd-csv">Descargar lista</button></div>
      <div class="hint" id="rd-near-st"></div></div><div id="rd-count" class="hint"></div><div class="list" id="rd-list"></div>`;
    $('#rd-q',el).addEventListener('input',e=>{RED.q=e.target.value;RED.limit=60;this.update();});
    $('#rd-new-nap',el).addEventListener('click',()=>openRedForm(null,'nap'));
    $('#rd-new-emp',el).addEventListener('click',()=>openRedForm(null,'empalme'));
    $('#rd-seg',el).addEventListener('click',e=>{const b=e.target.closest('[data-f]');if(!b)return;RED.tipo=b.dataset.f;RED.limit=60;this.update();});
    $('#rd-csv',el).addEventListener('click',exportRed);
    $('#rd-name',el).addEventListener('click',()=>{RED.sort='nombre';$('#rd-near-st').textContent='';this.update();});
    const near=$('#rd-near',el),st=$('#rd-near-st',el);
    near.addEventListener('click',()=>{
      if(redRun){redRun.stop();return;}   /* segundo toque: usar la mejor lectura que haya */
      near.textContent='Buscando señal… (tocá para usar lo que haya)';st.className='hint';st.textContent='Buscando tu ubicación…';
      redRun=gpsStart(b=>{st.textContent='Buscando… precisión ±'+Math.round(b.acc)+' m';if(b.acc<=40&&redRun)redRun.stop();});
      redRun.promise.then(r=>{
        RED.me={lat:r.lat,lng:r.lng,acc:r.acc};RED.sort='cerca';
        st.className='hint ok';st.textContent='Ordenadas por distancia a tu ubicación actual (±'+Math.round(r.acc)+' m).';
        this.update();
      },e=>{st.className='hint bad';st.textContent=gpsErrorText(e);}).finally(()=>{redRun=null;const n=$('#rd-near');if(n)n.textContent=RED.sort==='cerca'?'Actualizar mi ubicación':'Ordenar por cercanía (GPS)';});
    });
    $('#rd-list',el).addEventListener('click',e=>{
      const b=e.target.closest('[data-open-red]');if(b)return openRed(b.dataset.openRed);
      if(e.target.closest('[data-more]')){RED.limit+=60;this.update();}
    });
    this.update();
  },
  update(){
    const seg=$('#rd-seg');if(!seg)return;
    const fs=[['todos','Todos'],['nap','Cajas NAP'],['empalme','Empalmes'],['nogeo','Sin ubicación'],['llenas','Cajas llenas']];
    seg.innerHTML=fs.map(([k,l])=>`<button type="button" data-f="${k}" aria-pressed="${RED.tipo===k}">${l}</button>`).join('');
    const nm=$('#rd-name');if(nm)nm.hidden=RED.sort!=='cerca';
    const rows=redRows();
    $('#rd-count').textContent=S.loaded.red?`${rows.length} ${rows.length===1?'punto':'puntos'}`:'Cargando…';
    const list=$('#rd-list');
    if(!rows.length){
      list.innerHTML=S.red.size?'<div class="empty"><b>Ningún punto coincide</b><span>Probá con otra búsqueda o cambiá el filtro.</span></div>':'<div class="empty"><b>Todavía no hay cajas NAP ni empalmes</b><span>Parado al lado de la caja, tocá «Nueva caja NAP» y después «Usar mi ubicación actual (GPS)».</span></div>';
      return;
    }
    list.innerHTML=rows.slice(0,RED.limit).map(({p,d})=>redRow(p,d)).join('')+(rows.length>RED.limit?`<button class="btn more" type="button" data-more>Ver más (${rows.length-RED.limit})</button>`:'');
  }
};

/* ----- ficha de una caja o empalme ----- */
function openRed(id){
  const p=S.red.get(id);if(!p){toast('No se encontró ese punto de la red','bad');return;}
  const nap=p.tipo==='nap',cl=nap?napClients(p.id):[],kids=redKids(p.id),par=p.padre?S.red.get(p.padre):null;
  const kv=(k,v)=>v?`<dt>${k}</dt><dd>${v}</dd>`:'';
  const nums=cl.map(c=>parseInt(c.napPuerto,10)).filter(n=>n>=1);
  let libres='';
  if(nap&&p.puertos&&cl.length<p.puertos){const f=[];for(let i=1;i<=p.puertos&&f.length<24;i++)if(!nums.includes(i))f.push(i);libres=f.join(', ')+(f.length===24?'…':'');}
  const vis=cl.filter(clientVisible).sort((a,b)=>((parseInt(a.napPuerto,10)||999)-(parseInt(b.napPuerto,10)||999))||norm(a.nombre).localeCompare(norm(b.nombre)));
  const html=`
    <div class="head-row"><div><span class="chip ${nap?'accent':'info'}">${esc(RED_TIPO[p.tipo]||p.tipo)}</span>${nap?` <span class="chip ${p.puertos&&cl.length>=p.puertos?'bad':'ok'}">${cl.length}${p.puertos?'/'+p.puertos+' puertos':(cl.length===1?' cliente':' clientes')}</span>`:''}</div>
      <div class="actions start">${can('red')?'<button class="btn small" type="button" data-act="editar">Editar</button>':''}</div></div>
    <h2 style="overflow-wrap:anywhere">${esc(p.nombre)}</h2>
    <dl class="kv">${kv('Referencia',esc(p.ref))}${kv('Sale de',par?`<button class="btn small ghost" type="button" data-red="${esc(par.id)}">${esc(par.nombre)}</button>`:'')}${kv('Puertos sin usar',esc(libres))}${kv('Notas',esc(p.notas))}</dl>
    <div class="geo"><div class="legend small muted">Cómo llegar</div><div class="actions start">${geoActions(p)}${can('red')?`<button class="btn small ghost" type="button" data-act="ubicacion">${hasGeo(p)?'Cambiar ubicación':'Cargar ubicación'}</button>`:''}</div></div>
    ${kids.length?`<div><h3>De acá salen</h3><div class="list" style="margin-top:8px">${kids.sort(redCmp).map(k=>`<button class="item" type="button" data-red="${esc(k.id)}"><div><div class="t">${esc(k.nombre)}</div></div><div class="side"><span class="chip ${k.tipo==='nap'?'accent':'info'}">${esc(RED_TIPO[k.tipo]||k.tipo)}</span></div></button>`).join('')}</div></div>`:''}
    ${nap?`<div><h3>Clientes conectados</h3>${vis.length?`<div class="list" style="margin-top:8px">${vis.map(c=>`<button class="item" type="button" data-open-client="${esc(c.id)}"><div><div class="t">${c.napPuerto?'Puerto '+esc(c.napPuerto)+' · ':''}${esc(c.nombre)}</div><div class="s">${esc(c.dir||'Sin domicilio')}${c.loc?' · '+esc(c.loc):''}</div></div><div class="side"><span class="chip ${ESTADO_CLS[c.estado]||''}">${esc(ESTADOS[c.estado]||c.estado)}</span></div></button>`).join('')}</div>`:`<div class="hint">${cl.length?'No tenés acceso a ver los datos de esos clientes.':'Todavía no hay clientes conectados a esta caja. Se asignan desde la ficha del cliente o al terminar una instalación.'}</div>`}
      ${cl.length>vis.length&&vis.length?`<div class="hint">Y ${cl.length-vis.length} más que tu perfil no puede ver.</div>`:''}</div>`:''}`;
  openModal({title:RED_TIPO[p.tipo]||'Red',html,onMount(el){
    el.addEventListener('click',e=>{
      const o=e.target.closest('[data-open-client]');if(o){openClient(o.dataset.openClient);return;}
      const r=e.target.closest('[data-red]');if(r){openRed(r.dataset.red);return;}
      const a=e.target.closest('[data-act]');if(!a)return;
      if(a.dataset.act==='editar')openRedForm(p.id);
      else if(a.dataset.act==='ubicacion')openRedGeo(p.id);
    });
  }});
}
function openRedGeo(id){
  const p=S.red.get(id);if(!p)return;
  if(!can('red'))return toast('Tu perfil no puede modificar la red','bad');
  openModal({title:'Ubicación de '+p.nombre,html:`${geoFieldHTML(p,'Si estás al lado de '+(p.tipo==='nap'?'la caja':'la botella')+', tocá el botón y se completa solo.')}<div class="actions"><button class="btn ghost" type="button" data-close>Cancelar</button><button class="btn primary" type="button" id="geo-save">Guardar ubicación</button></div>`,onMount(el){
    const read=bindGeoField(el);
    $('#geo-save',el).addEventListener('click',async()=>{
      const g=read();
      if(g.invalid)return toast('Las coordenadas no son válidas','bad');
      try{await putItem('red','puntos',p.id,{lat:g.empty?null:g.lat,lng:g.empty?null:g.lng,mod:Date.now()});toast('Ubicación guardada');openRed(p.id);}catch(e){dbError(e);}
    });
  }});
}

/* ----- alta y edición ----- */
function openRedForm(id,tipoNuevo){
  const old=id?S.red.get(id):null;
  if(!can('red'))return toast('Tu perfil no puede modificar la red','bad');
  const p=old||{tipo:tipoNuevo==='empalme'?'empalme':'nap',puertos:tipoNuevo==='empalme'?null:16};
  const bloqueados=old?redDescendants(old.id):new Set();
  const padres=[...S.red.values()].filter(x=>x.tipo==='empalme'&&(!old||(x.id!==old.id&&!bloqueados.has(x.id)))).sort(redCmp);
  const html=`<form class="form" id="rform" novalidate>
    <div class="grid2">${F('Qué es','rf-tipo',`<select id="rf-tipo"${old?' disabled':''}>${opt('nap','Caja NAP (de acá salen los clientes)',p.tipo==='nap')}${opt('empalme','Botella de empalme',p.tipo==='empalme')}</select>`)}
    ${F('Nombre o número *','rf-nombre',`<input id="rf-nombre" value="${esc(p.nombre||'')}" autocomplete="off" placeholder="NAP-12">`)}</div>
    <div class="grid2" id="rf-fila"><div id="rf-puertos-w">${F('Cantidad de puertos','rf-puertos',`<input id="rf-puertos" type="number" min="1" max="288" step="1" inputmode="numeric" value="${p.puertos?esc(p.puertos):''}">`,'Salidas de la caja (8, 16…).')}</div>
    ${F('Sale de la botella de empalme','rf-padre',`<select id="rf-padre"><option value="">No indicar</option>${padres.map(x=>opt(x.id,x.nombre,x.id===p.padre)).join('')}</select>`)}</div>
    ${F('Referencia para encontrarla','rf-ref',`<input id="rf-ref" value="${esc(p.ref||'')}" placeholder="Poste frente a la plaza, esquina Belgrano y Mitre">`)}
    ${geoFieldHTML(p,'Si estás al lado de la caja o de la botella, tocá el botón y se completa solo.')}
    ${F('Notas','rf-notas',`<textarea id="rf-notas">${esc(p.notas||'')}</textarea>`)}
    <div class="actions">${old&&can('editarClientes')?'<button class="btn danger" type="button" id="rf-del">Eliminar</button>':''}<button class="btn ghost" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Guardar</button></div></form>`;
  openModal({title:old?'Editar '+(RED_TIPO[p.tipo]||'punto').toLowerCase():(p.tipo==='nap'?'Nueva caja NAP':'Nueva botella de empalme'),html,onMount(el){
    const read=bindGeoField(el),v=i=>$('#'+i,el).value.trim();
    const kind=()=>$('#rf-tipo',el).value;
    const sync=()=>{$('#rf-puertos-w',el).hidden=kind()!=='nap';};
    $('#rf-tipo',el).addEventListener('change',sync);sync();
    $('#rform',el).addEventListener('submit',async e=>{
      e.preventDefault();
      const g=read();if(g.invalid)return toast('Revisá las coordenadas','bad');
      const tipo=kind(),nombre=v('rf-nombre');
      if(!nombre)return toast('Falta el nombre','bad');
      if([...S.red.values()].some(x=>x.tipo===tipo&&x.id!==(old&&old.id)&&norm(x.nombre)===norm(nombre)))return toast('Ya hay '+(tipo==='nap'?'una caja NAP':'una botella de empalme')+' con ese nombre','bad');
      let puertos=null;
      if(tipo==='nap'&&v('rf-puertos')!==''){puertos=parseInt(v('rf-puertos'),10);if(!(puertos>=1&&puertos<=288))return toast('Los puertos tienen que ser un número entre 1 y 288','bad');}
      if(old&&puertos&&puertos<napUsed(old.id))return toast('La caja ya tiene '+napUsed(old.id)+' clientes conectados: no puede tener menos puertos','bad');
      const obj={tipo,nombre,lat:g.empty?null:g.lat,lng:g.empty?null:g.lng,puertos,padre:v('rf-padre')||null,ref:v('rf-ref'),notas:v('rf-notas'),mod:Date.now()};
      try{
        if(old)await putItem('red','puntos',old.id,obj);
        else{const nid=newId();await putItem('red','puntos',nid,Object.assign({creado:Date.now()},obj));}
        toast(old?'Cambios guardados':(tipo==='nap'?'Caja NAP guardada':'Botella de empalme guardada'));closeModal();
      }catch(err){dbError(err);}
    });
    const del=$('#rf-del',el);
    if(del)del.addEventListener('click',async()=>{
      const n=napUsed(old.id),k=redKids(old.id).length;
      if(n)return toast('No se puede eliminar: tiene '+n+(n===1?' cliente conectado':' clientes conectados')+'. Pasalos primero a otra caja.','bad');
      if(k)return toast('No se puede eliminar: de ahí salen '+k+(k===1?' punto':' puntos')+' de la red. Cambiales primero de dónde salen.','bad');
      if(!await askConfirm('¿Eliminar «'+old.nombre+'»? No se puede deshacer.','Eliminar',true))return;
      try{await putItem('red','puntos',old.id,null);toast('Eliminado');closeModal();}catch(err){dbError(err);}
    });
  }});
}
