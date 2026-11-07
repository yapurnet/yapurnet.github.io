/* ===== red: cajas NAP y botellas de empalme ===== */
const RED={q:'',tipo:'todos',sort:'nombre',me:null,limit:60};
const RED_TIPO={nap:'Caja NAP',empalme:'Botella de empalme',splitter:'Splitter',olt:'OLT'};
const RED_TIPO_ORDEN={olt:0,nap:1,splitter:2,empalme:3};
const redTipoCmp=(a,b)=>(RED_TIPO_ORDEN[a.tipo]??9)-(RED_TIPO_ORDEN[b.tipo]??9)||redCmp(a,b);
/* botellas de empalme: los PON (PON 1 = VLAN 41 … PON 8 = VLAN 48), los estados de un pelo y los colores de la fibra (código de 12 colores) */
const PON_LISTA=[1,2,3,4,5,6,7,8];
const ponTxt=n=>'PON '+n+' (VLAN '+(40+n)+')';
const PELO_EST={libre:'Libre',empalmado:'Empalmado',reservado:'Reservado',danado:'Dañado'};
const FIBRA_COL=[['Azul','#2f6fdc'],['Naranja','#f08a24'],['Verde','#2e9e4f'],['Marrón','#8a5a2b'],['Gris','#8c96a3'],['Blanco','#f2f4f7'],['Rojo','#d64545'],['Negro','#1f2328'],['Amarillo','#e8c825'],['Violeta','#8a4fd0'],['Rosa','#ee7fb0'],['Celeste','#3cc0d8']];
const peloEntry=(p,n)=>{const x=p&&p.pelos&&p.pelos[n];return x&&typeof x==='object'?x:null;};
const peloEst=(p,n)=>{const x=peloEntry(p,n);return x&&PELO_EST[x.e]?x.e:'libre';};
const pelosUsados=p=>Object.keys(p.pelos||{}).filter(n=>peloEst(p,n)!=='libre'&&n<=(p.hilos||288)).length;
/* color del pelo y del tubo: xt = pelos por tubo (0 = no mostrar colores) */
function peloInfo(n,xt){
  if(!(xt>0))return {n,color:null,tubo:0,tuboCol:null};
  const tubo=Math.floor((n-1)/xt)+1;
  return {n,color:FIBRA_COL[((n-1)%xt)%12],tubo,tuboCol:FIBRA_COL[(tubo-1)%12]};
}
const xtuboDe=p=>p.xtubo==null?12:p.xtubo;
/* splitters: 1x2, 1x4… hasta 1x64. La OLT en cambio tiene una cantidad libre de puertos (igual que una caja NAP). En los dos casos cada
   salida/puerto se anota igual que un pelo (libre · conectado · reservado · dañada), sin PON: no cambia el PON, reparte o inicia la misma señal. */
const RATIOS_SPLIT=[2,4,8,16,32,64];
const SALIDA_EST={libre:'Libre',conectado:'Conectado',reservado:'Reservado',danado:'Dañada'};
const salidaEntry=(p,n)=>{const x=p&&p.salidas&&p.salidas[n];return x&&typeof x==='object'?x:null;};
const salidaEst=(p,n)=>{const x=salidaEntry(p,n);return x&&SALIDA_EST[x.e]?x.e:'libre';};
/* cuántas salidas tiene un splitter (su relación) o una OLT (su cantidad de puertos) */
const redCantidad=p=>p.tipo==='splitter'?(p.rel||0):p.tipo==='olt'?(p.puertos||0):0;
const salidasUsadas=p=>Object.keys(p.salidas||{}).filter(n=>salidaEst(p,n)!=='libre'&&n<=redCantidad(p)).length;
const fdot=c=>c?`<i class="fdot" style="background:${c[1]}" title="${esc(c[0])}"></i>`:'';
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
  return `<b>${esc(p.nombre)}</b>${c.napPuerto?' · puerto '+esc(c.napPuerto):''} <button class="btn small ghost" type="button" data-act="nap">Ver caja</button>${canMoverNap()?' <button class="btn small ghost" type="button" data-act="mover-nap">Mover</button>':''}`;
}

/* ----- campo «Caja NAP» + puerto del cliente (formulario y cierre de instalación) ----- */
function napOptionsHTML(sel,from,vacio){
  const l=[...S.red.values()].filter(p=>p.tipo==='nap').map(p=>({p,d:from&&hasGeo(p)?distM(from,p):null}));
  l.sort((a,b)=>(a.d!=null&&b.d!=null)?a.d-b.d:(a.d!=null?-1:(b.d!=null?1:redCmp(a.p,b.p))));
  return '<option value="">'+esc(vacio||'Sin caja asignada')+'</option>'+l.map(({p,d})=>{
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
  const nap=p.tipo==='nap',split=p.tipo==='splitter',olt=p.tipo==='olt',u=nap?napUsed(p.id):0,kids=redKids(p.id).length,par=p.padre?redName(p.padre):'';
  const cant=redCantidad(p);
  const use=nap?(p.puertos?`<span class="chip ${u>=p.puertos?'bad':'ok'}">${u}/${p.puertos} puertos</span>`:`<span class="chip">${u} ${u===1?'cliente':'clientes'}</span>`)
    :split?(cant?`<span class="chip">1x${cant} · ${salidasUsadas(p)}/${cant}</span>`:`<span class="chip warn">Sin relación</span>`)
    :olt?(cant?`<span class="chip">${cant} puertos · ${salidasUsadas(p)}/${cant}</span>`:`<span class="chip warn">Sin puertos cargados</span>`)
    :[kids?`<span class="chip info">Alimenta ${kids}</span>`:'',...(p.pons||[]).map(n=>`<span class="chip ok">PON ${n}</span>`)].join(' ');
  return `<button class="item" type="button" data-open-red="${esc(p.id)}">
    <div><div class="t">${esc(p.nombre)} <span class="chip ${nap?'accent':(split||olt)?'quiet':'info'}">${esc(RED_TIPO[p.tipo]||p.tipo)}</span></div>
    <div class="s">${esc([p.ref,par?'Sale de '+par:''].filter(Boolean).join(' · ')||'Sin referencia')}</div></div>
    <div class="side">${use}</div>
    <div class="tags">${nap&&!p.iluminada?'<span class="chip quiet">Sin empalmar</span>':''}${hasGeo(p)?'':'<span class="chip warn">Sin ubicación</span>'}${d!=null?`<span class="chip info">a ${esc(fmtDist(d))}</span>`:''}</div></button>`;
}
function redRows(){
  const parts=norm(RED.q).trim().split(/\s+/).filter(Boolean);
  let l=[...S.red.values()].filter(p=>{
    if(RED.tipo==='nap'&&p.tipo!=='nap')return false;
    if(RED.tipo==='empalme'&&p.tipo!=='empalme')return false;
    if(RED.tipo==='splitter'&&p.tipo!=='splitter')return false;
    if(RED.tipo==='olt'&&p.tipo!=='olt')return false;
    if(RED.tipo==='nogeo'&&hasGeo(p))return false;
    if(RED.tipo==='llenas'&&!(p.tipo==='nap'&&p.puertos&&napUsed(p.id)>=p.puertos))return false;
    if(RED.tipo==='sinempalmar'&&!(p.tipo==='nap'&&!p.iluminada))return false;
    if(parts.length){const h=norm([p.nombre,p.ref,p.notas,p.fibra,p.hacer,RED_TIPO[p.tipo],redName(p.padre)].join(' '));if(!parts.every(x=>h.includes(x)))return false;}
    return true;
  }).map(p=>({p,d:RED.sort==='cerca'&&RED.me&&hasGeo(p)?distM(RED.me,p):null}));
  if(RED.sort==='cerca'&&RED.me)l.sort((a,b)=>(a.d!=null&&b.d!=null)?a.d-b.d:(a.d!=null?-1:(b.d!=null?1:redCmp(a.p,b.p))));
  else l.sort((a,b)=>redCmp(a.p,b.p));
  return l;
}
let redRun=null;
function exportRed(){
  const rows=[['tipo','nombre','latitud','longitud','puertos','clientes conectados','iluminada','relación splitter','salidas usadas','sale de','referencia','notas','fibra','pelos','pelos en uso','PON vivos','qué hay que hacer']];
  [...S.red.values()].sort(redTipoCmp).forEach(p=>{
    rows.push([RED_TIPO[p.tipo]||p.tipo,p.nombre,hasGeo(p)?p.lat:'',hasGeo(p)?p.lng:'',p.puertos||'',p.tipo==='nap'?napUsed(p.id):'',p.tipo==='nap'?(p.iluminada?'Sí':'No'):'',p.tipo==='splitter'&&p.rel?'1x'+p.rel:'',(p.tipo==='splitter'||p.tipo==='olt')&&redCantidad(p)?salidasUsadas(p):'',redName(p.padre),p.ref||'',p.notas||'',p.fibra||'',p.tipo==='empalme'&&p.hilos?p.hilos:'',p.tipo==='empalme'&&p.hilos?pelosUsados(p):'',(p.pons||[]).map(n=>'PON '+n).join(' + '),p.hacer||'']);
  });
  saveFile('red-'+todayStr()+'.csv',toCsv(rows));
}
VIEWS.red={
  mount(el){
    el.innerHTML=`<div class="toolbar"><div class="line"><input class="search" id="rd-q" type="search" placeholder="Buscar caja o empalme por nombre o referencia" autocomplete="off" aria-label="Buscar en la red" value="${esc(RED.q)}"></div>
      <div class="line"><button class="btn primary" type="button" id="rd-new-nap">Nueva caja NAP</button><button class="btn" type="button" id="rd-new-split">Nuevo splitter</button><button class="btn" type="button" id="rd-new-emp">Nueva botella de empalme</button><button class="btn" type="button" id="rd-new-olt">Nueva OLT</button></div>
      <div class="seg" id="rd-seg"></div>
      <div class="line"><button class="btn small" type="button" id="rd-near">Ordenar por cercanía (GPS)</button><button class="btn small ghost" type="button" id="rd-name" hidden>Ordenar por nombre</button><button class="btn small ghost" type="button" id="rd-csv">Descargar lista</button>${can('redPlano')?'<button class="btn small ghost" type="button" id="rd-plano">Ver plano de la red</button>':(can('redPlanoCajas')?'<button class="btn small ghost" type="button" id="rd-plano">Ver cajas NAP</button>':'')}</div>
      <div class="hint" id="rd-near-st"></div></div><div id="rd-count" class="hint"></div><div class="list" id="rd-list"></div>`;
    $('#rd-q',el).addEventListener('input',e=>{RED.q=e.target.value;RED.limit=60;this.update();});
    $('#rd-new-nap',el).addEventListener('click',()=>openRedForm(null,'nap'));
    $('#rd-new-split',el).addEventListener('click',()=>openRedForm(null,'splitter'));
    $('#rd-new-emp',el).addEventListener('click',()=>openRedForm(null,'empalme'));
    $('#rd-new-olt',el).addEventListener('click',()=>openRedForm(null,'olt'));
    $('#rd-seg',el).addEventListener('click',e=>{const b=e.target.closest('[data-f]');if(!b)return;RED.tipo=b.dataset.f;RED.limit=60;this.update();});
    $('#rd-csv',el).addEventListener('click',exportRed);
    const plano=$('#rd-plano',el);if(plano)plano.addEventListener('click',openRedPlano);
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
    const fs=[['todos','Todos'],['olt','OLT'],['nap','Cajas NAP'],['splitter','Splitters'],['empalme','Empalmes'],['nogeo','Sin ubicación'],['llenas','Cajas llenas'],['sinempalmar','Sin empalmar']];
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

/* ----- los puertos de una caja: la mitad de adelante y la mitad de atrás, con el cliente de cada uno ----- */
const portLados=n=>{const h=Math.ceil(n/2);return n>=2?[['Adelante',1,h],['Atrás',h+1,n]]:[['Puertos',1,n]];};
const callePuerto=c=>[c.dir,c.loc].filter(Boolean).join(' · ');
/* quién está en cada puerto (by), los que no tienen un puerto válido (sin), los puertos repetidos (dup) y los libres */
function napMap(p){
  const by=new Map(),sin=[];
  napClients(p.id).forEach(c=>{const k=parseInt(c.napPuerto,10);if(k>=1&&k<=p.puertos){if(!by.has(k))by.set(k,[]);by.get(k).push(c);}else sin.push(c);});
  const libres=[];for(let i=1;i<=p.puertos;i++)if(!by.has(i))libres.push(i);
  return {by,sin,libres,dup:[...by.entries()].filter(([,l])=>l.length>1)};
}
/* la caja dibujada como es: la tapa de adelante y la de atrás, con los puertos (conectores) en filas de a 4 · o.pick: se está eligiendo un puerto libre para mover un cliente · o.self: el cliente que se está moviendo · o.sel: el puerto elegido */
function portGridHTML(p,m,o){
  o=o||{};
  const tocable=!o.pick&&canMoverNap();   /* en la ficha de la caja, tocar un puerto libre sirve para elegir qué cliente está ahí */
  const jack=(i,cls,nm,aria,attrs,tag)=>`<${tag} class="jack ${cls}" ${attrs} aria-label="${esc(aria)}" title="${esc(aria)}"><span class="ring"><b>${i}</b></span><span class="nm">${esc(nm)}</span></${tag}>`;
  const cell=i=>{
    const l=m.by.get(i)||[];
    if(!l.length){
      if(o.pick)return jack(i,'free'+(o.sel===i?' sel':''),'Libre','Puerto '+i+': libre','data-pick="'+i+'" aria-pressed="'+(o.sel===i)+'" type="button"','button');
      return tocable?jack(i,'free','Libre','Puerto '+i+': libre. Tocá para elegir el cliente','data-free="'+i+'" type="button"','button'):jack(i,'free','Libre','Puerto '+i+': libre','','div');
    }
    const c=l[0],mine=!!o.self&&l.some(x=>x.id===o.self),est=c.estado!=='activo'&&estLabel(c)?' · '+estLabel(c):'';
    if(o.pick&&mine)return jack(i,'self','Acá está hoy','Puerto '+i+': acá está hoy '+c.nombre,'','div');
    if(l.length>1)return jack(i,'dup','Repetido','Puerto '+i+': '+l.length+' clientes en este puerto','','div');
    const aria='Puerto '+i+': '+c.nombre+' · '+(callePuerto(c)||'Sin domicilio')+est;
    if(o.pick)return jack(i,'used',c.nombre,aria,'','div');
    return jack(i,'used',c.nombre,aria,'data-cl="'+esc(c.id)+'" type="button"','button');
  };
  return portLados(p.puertos).map(([lab,a,b])=>{
    const nums=[];for(let i=a;i<=b;i++)nums.push(i);
    const lib=nums.filter(i=>!m.by.has(i)).length;
    return `<div class="nap-face"><div class="head-row"><b>${lab}</b><span class="small muted">puertos ${a} a ${b} · ${lib} ${lib===1?'libre':'libres'}</span></div><div class="ports">${nums.map(cell).join('')}</div></div>`;
  }).join('');
}
function portsSectionHTML(p,m){
  const n=m.libres.length;
  const resumen=n?`Quedan <b>${n}</b> ${n===1?'puerto libre':'puertos libres'}.`:'<b>Caja llena</b>: no queda ningún puerto libre.';
  const aviso=m.sin.length?` Hay ${m.sin.length} ${m.sin.length===1?'cliente':'clientes'} sin puerto válido cargado: alguno de los lugares libres puede estar usado.`:'';
  const rev=[...m.sin.map(c=>[c,c.napPuerto?'El puerto '+c.napPuerto+' no existe en esta caja':'Sin puerto cargado']),...m.dup.flatMap(([k,l])=>l.map(c=>[c,'Puerto '+k+' repetido']))];
  return `<div><h3>Puertos</h3><div class="hint ${n?'ok':'bad'}" style="margin-bottom:8px">${resumen}${aviso}</div>${canMoverNap()?'<div class="hint">Tocá un puerto <b>libre</b> para elegir al cliente que está conectado ahí (uno por instalar o uno ya instalado), o uno <b>ocupado</b> para ver de quién es, cambiarlo de puerto o sacarlo.</div>':''}${portGridHTML(p,m)}
    ${rev.length?`<h3 style="margin-top:14px">Para revisar</h3><div class="list" style="margin-top:8px">${rev.map(([c,why])=>`<button class="item" type="button" data-cl="${esc(c.id)}"><div><div class="t">${esc(c.nombre)}</div><div class="s">${esc(why)}${callePuerto(c)?' · '+esc(callePuerto(c)):''}</div></div></button>`).join('')}</div>`:''}</div>`;
}
/* mover un cliente de caja o de puerto: el puerto de origen queda libre y el de destino ocupado en una sola escritura (el puerto vive en el propio cliente) */
/* la app recibe el dato guardado un instante después de que el servidor responde: se espera (hasta 2 s) a tenerlo antes de dibujar la ficha de la caja destino */
async function esperarCliente(id,ok){for(let i=0;i<40&&!ok(S.clientes.get(id)||{});i++)await new Promise(r=>setTimeout(r,50));}
const canMoverNap=()=>can('red')&&(can('editarClientes')||can('ubicacion')||can('operarOrdenes'));

/* ----- ficha de una caja o empalme ----- */
function openRed(id){
  const p=S.red.get(id);if(!p){toast('No se encontró ese punto de la red','bad');return;}
  const nap=p.tipo==='nap',split=p.tipo==='splitter',olt=p.tipo==='olt',hasSalidas=split||olt,grid=nap&&p.puertos>0,cl=nap?napClients(p.id):[],par=p.padre?S.red.get(p.padre):null;
  const cant=redCantidad(p);
  const conecta=redConecta(p),llega=llegaPorDe(p);
  const kv=(k,v)=>v?`<dt>${k}</dt><dd>${v}</dd>`:'';
  const m=grid?napMap(p):null;
  const libres=grid&&m.libres.length?m.libres.slice(0,24).join(', ')+(m.libres.length>24?'…':''):'';
  const vis=cl.filter(clientVisible).sort((a,b)=>((parseInt(a.napPuerto,10)||999)-(parseInt(b.napPuerto,10)||999))||norm(a.nombre).localeCompare(norm(b.nombre)));
  const usoChip=nap?` <span class="chip ${p.puertos&&cl.length>=p.puertos?'bad':'ok'}">${cl.length}${p.puertos?'/'+p.puertos+' puertos':(cl.length===1?' cliente':' clientes')}</span>`
    :p.tipo==='empalme'?(p.hilos?` <span class="chip">${pelosUsados(p)}/${p.hilos} pelos en uso</span>`:'')
    :(hasSalidas&&cant?` <span class="chip">${salidasUsadas(p)}/${cant} ${olt?'puertos':'salidas'} en uso</span>`:'');
  const iluminadaChip=nap?` <span class="chip ${p.iluminada?'ok':'quiet'}">${p.iluminada?'Iluminada':'Sin empalmar'}</span>`:'';
  const html=`
    <div class="head-row"><div><span class="chip ${nap?'accent':hasSalidas?'quiet':'info'}">${esc(RED_TIPO[p.tipo]||p.tipo)}</span>${usoChip}${iluminadaChip}</div>
      <div class="actions start">${can('red')?'<button class="btn small" type="button" data-act="editar">Editar</button>':''}${can('red')&&nap?`<button class="btn small ghost" type="button" data-act="iluminada">${p.iluminada?'Marcar sin empalmar':'Marcar iluminada'}</button>`:''}${can('red')&&p.tipo!=='olt'?'<button class="btn small ghost" type="button" data-act="clonar">Clonar con todo lo que cuelga</button>':''}</div></div>
    <h2 style="overflow-wrap:anywhere">${esc(p.nombre)}</h2>
    <dl class="kv">${kv('Referencia',esc(p.ref))}${kv('Fibra',esc(p.fibra))}${split&&cant?kv('Relación','1x'+cant):''}${olt&&cant?kv('Puertos',String(cant)):''}${kv('Sale de',par?`<button class="btn small ghost" type="button" data-red="${esc(par.id)}">${esc(par.nombre)}</button>`:'')}${kv('Llega por',llega.map(x=>`<button class="btn small ghost" type="button" data-red="${esc(x.e.id)}">${esc(x.e.nombre)} · ${x.e.tipo==='splitter'||x.e.tipo==='olt'?'salida':'pelo'} ${x.n}${x.pon?' · PON '+x.pon:''}</button>`).join(' '))}${kv('Puertos sin usar',esc(libres))}${kv('Notas',esc(p.notas))}</dl>
    ${p.tipo==='empalme'?empalmeFichaHTML(p):hasSalidas?salidasFichaHTML(p):''}
    <div class="geo"><div class="legend small muted">Cómo llegar</div><div class="actions start">${geoActions(p)}${can('red')?`<button class="btn small ghost" type="button" data-act="ubicacion">${hasGeo(p)?'Cambiar ubicación':'Cargar ubicación'}</button>`:''}</div></div>
    ${conecta.length?`<div><h3>${nap||hasSalidas?'De acá salen':'Cajas que conecta'}</h3><div class="list" style="margin-top:8px">${conecta.map(({r:k,pelos})=>{
      const lab=split?'Salida':olt?'Puerto':'Pelo';
      return `<button class="item" type="button" data-red="${esc(k.id)}"><div><div class="t">${esc(k.nombre)}</div>${pelos.length?`<div class="s">${pelos.length>1?lab+'s ':lab+' '}${pelos.map(x=>x.n).join(', ')}${[...new Set(pelos.map(x=>x.pon).filter(Boolean))].map(n=>' · PON '+n).join('')}</div>`:''}</div><div class="side"><span class="chip ${k.tipo==='nap'?'accent':(k.tipo==='splitter'||k.tipo==='olt')?'quiet':'info'}">${esc(RED_TIPO[k.tipo]||k.tipo)}</span></div></button>`;
    }).join('')}</div></div>`:''}
    ${grid?portsSectionHTML(p,m):''}
    ${nap&&!grid?`<div><h3>Clientes conectados</h3>${vis.length?`<div class="list" style="margin-top:8px">${vis.map(c=>`<button class="item" type="button" data-open-client="${esc(c.id)}"><div><div class="t">${c.napPuerto?'Puerto '+esc(c.napPuerto)+' · ':''}${esc(c.nombre)}</div><div class="s">${esc(c.dir||'Sin domicilio')}${c.loc?' · '+esc(c.loc):''}</div></div><div class="side">${estChip(c)}</div></button>`).join('')}</div>`:`<div class="hint">${cl.length?'No tenés acceso a ver los datos de esos clientes.':'Todavía no hay clientes conectados a esta caja. Se asignan desde la ficha del cliente o al terminar una instalación.'}</div>`}
      ${cl.length>vis.length&&vis.length?`<div class="hint">Y ${cl.length-vis.length} más que tu perfil no puede ver.</div>`:''}</div>`:''}`;
  openModal({title:RED_TIPO[p.tipo]||'Red',html,onMount(el){
    el.addEventListener('click',e=>{
      const o=e.target.closest('[data-open-client]');if(o){openClient(o.dataset.openClient);return;}
      const g=e.target.closest('[data-cl]');if(g){openNapClient(p.id,g.dataset.cl);return;}
      const pl=e.target.closest('[data-pelo]');if(pl){openPelo(p.id,parseInt(pl.dataset.pelo,10));return;}
      const sl=e.target.closest('[data-salida]');if(sl){openSalida(p.id,parseInt(sl.dataset.salida,10));return;}
      const fr=e.target.closest('[data-free]');if(fr){openAsignarPuerto(p.id,parseInt(fr.dataset.free,10));return;}
      const r=e.target.closest('[data-red]');if(r){openRed(r.dataset.red);return;}
      const a=e.target.closest('[data-act]');if(!a)return;
      if(a.dataset.act==='editar')openRedForm(p.id);
      else if(a.dataset.act==='ubicacion')openRedGeo(p.id);
      else if(a.dataset.act==='clonar')openRedClonar(p.id);
      else if(a.dataset.act==='iluminada')toggleIluminada(p.id);
    });
  }});
}
/* ----- botella de empalme: PON vivos, qué hay que hacer y los pelos de la fibra ----- */
/* las cajas y botellas a las que llega esta botella: las que salen de ella y las que algún pelo dice que lleva */
function empalmeConecta(p){
  const m=new Map();
  redKids(p.id).forEach(k=>m.set(k.id,{r:k,pelos:[]}));
  Object.keys(p.pelos||{}).forEach(n=>{
    const x=peloEntry(p,n);if(!x||!x.a||!S.red.has(x.a)||peloEst(p,n)==='libre')return;
    if(!m.has(x.a))m.set(x.a,{r:S.red.get(x.a),pelos:[]});
    m.get(x.a).pelos.push({n:Number(n),pon:x.p||null});
  });
  m.forEach(v=>v.pelos.sort((a,b)=>a.n-b.n));
  return [...m.values()].sort((a,b)=>redCmp(a.r,b.r));
}
/* por dónde llega la señal a este punto (desde el pelo de una botella, o desde la salida de un splitter que dicen llevarle) */
function llegaPorDe(p){
  const out=[];
  S.red.forEach(e=>{
    if(e.id===p.id)return;
    if(e.tipo==='empalme'&&e.pelos)Object.keys(e.pelos).forEach(n=>{const x=peloEntry(e,n);if(x&&x.a===p.id&&peloEst(e,n)!=='libre')out.push({e,n:Number(n),pon:x.p||null});});
    if((e.tipo==='splitter'||e.tipo==='olt')&&e.salidas)Object.keys(e.salidas).forEach(n=>{const x=salidaEntry(e,n);if(x&&x.a===p.id&&salidaEst(e,n)!=='libre')out.push({e,n:Number(n),pon:null});});
  });
  return out.sort((a,b)=>redCmp(a.e,b.e)||a.n-b.n);
}
/* a dónde salen las salidas de un splitter o los puertos de una OLT, igual que empalmeConecta para los pelos de una botella */
function splitterConecta(p){
  const m=new Map();
  redKids(p.id).forEach(k=>m.set(k.id,{r:k,pelos:[]}));
  Object.keys(p.salidas||{}).forEach(n=>{
    const x=salidaEntry(p,n);if(!x||!x.a||!S.red.has(x.a)||salidaEst(p,n)==='libre')return;
    if(!m.has(x.a))m.set(x.a,{r:S.red.get(x.a),pelos:[]});
    m.get(x.a).pelos.push({n:Number(n),pon:null});
  });
  m.forEach(v=>v.pelos.sort((a,b)=>a.n-b.n));
  return [...m.values()].sort((a,b)=>redCmp(a.r,b.r));
}
/* qué conecta un punto, según su tipo: una caja solo lo que declaran sus hijos (padre), una botella sus pelos, un splitter o una OLT sus salidas */
function redConecta(p){
  if(p.tipo==='empalme')return empalmeConecta(p);
  if(p.tipo==='splitter'||p.tipo==='olt')return splitterConecta(p);
  return redKids(p.id).map(k=>({r:k,pelos:[]}));
}
/* el árbol que cuelga de un punto, armado con redConecta (la misma función que arma «De acá salen» en la ficha): cada
   nodo trae sus hijos y, por cada hijo, los pelos o salidas del padre que lo señalan. Lo usan el plano (para dibujar)
   y «Clonar con todo lo que cuelga» (para copiar la rama entera), así las dos cosas nunca se pueden contradecir */
function redArbol(p,visitado){
  const nodo={p,hijos:[]};
  redConecta(p).forEach(({r,pelos})=>{
    if(visitado.has(r.id))return;
    visitado.add(r.id);
    nodo.hijos.push({pelos,nodo:redArbol(r,visitado)});
  });
  return nodo;
}
/* ficha de un splitter o de una OLT: su cantidad de salidas (relación 1x2, 1x4… o cantidad de puertos) y cada una, igual que los pelos de una botella pero sin tubos ni PON */
function salidasFichaHTML(p){
  const cant=redCantidad(p),puede=can('red'),olt=p.tipo==='olt',tit=olt?'Puertos':'Salidas';
  if(!cant)return `<div><h3>${tit}</h3><div class="hint">${puede?(olt?'Cargá la cantidad de puertos de la OLT en «Editar» para poder anotar cada uno.':'Elegí la relación del splitter en «Editar» (1x2, 1x4…) para poder anotar cada salida.'):(olt?'Todavía no se cargó la cantidad de puertos de esta OLT.':'Todavía no se cargó la relación de este splitter.')}</div></div>`;
  const cell=n=>{
    const x=salidaEntry(p,n),e=salidaEst(p,n),dest=x&&x.a&&S.red.has(x.a)?S.red.get(x.a):null,col=FIBRA_COL[(n-1)%12];
    const lbl=e==='libre'?'Libre':dest?dest.nombre:SALIDA_EST[e];
    const aria=(olt?'Puerto ':'Salida ')+n+' ('+col[0].toLowerCase()+'): '+SALIDA_EST[e]+(dest?' · lleva a '+dest.nombre:'');
    const body=`<span class="pn">${fdot(col)}${n}</span><span class="pl">${esc(lbl)}</span>`;
    const cls=e==='conectado'?'empalmado':e;
    return puede?`<button class="pelo est-${cls}" type="button" data-salida="${n}" aria-label="${esc(aria)}" title="${esc(aria)}">${body}</button>`:`<div class="pelo est-${cls}" aria-label="${esc(aria)}">${body}</div>`;
  };
  const cells=[];for(let n=1;n<=cant;n++)cells.push(cell(n));
  const usados=Object.keys(p.salidas||{}).map(Number).filter(n=>n>=1&&n<=cant&&salidaEst(p,n)!=='libre').sort((a,b)=>a-b);
  const lista=usados.map(n=>{
    const x=salidaEntry(p,n),col=FIBRA_COL[(n-1)%12],dest=x.a&&S.red.get(x.a),est=salidaEst(p,n);
    const linea=[dest?'lleva a '+dest.nombre:'',x.n||''].filter(Boolean).join(' · ');
    const tag=`<${puede?'button':'div'} class="item" type="button" ${puede?`data-salida="${n}"`:''}><div><div class="t">${fdot(col)} ${olt?'Puerto':'Salida'} ${n} · ${esc(col[0].toLowerCase())}</div><div class="s">${esc(linea||SALIDA_EST[est])}</div></div><div class="side"><span class="chip ${est==='reservado'?'warn':est==='danado'?'bad':'ok'}">${esc(SALIDA_EST[est])}</span></div></${puede?'button':'div'}>`;
    return tag;
  }).join('');
  const titulo=olt?('Puertos ('+cant+')'):('Salidas (1x'+cant+')');
  return `<div><h3>${titulo}</h3><div class="hint">${usados.length} de ${cant} en uso.${puede?(olt?' Tocá un puerto para anotar a dónde lleva.':' Tocá una salida para anotar a dónde lleva.'):''}</div><div class="pelos">${cells.join('')}</div>${lista?`<h3 style="margin-top:14px">A dónde lleva cada ${olt?'puerto':'salida'}</h3><div class="list" style="margin-top:8px">${lista}</div>`:''}</div>`;
}
/* anotar una salida (de un splitter) o un puerto (de una OLT): a dónde lleva (otra caja, otro splitter o una botella) y una nota */
function openSalida(id,n){
  const p=S.red.get(id);if(!p||!(p.tipo==='splitter'||p.tipo==='olt'))return;
  if(!can('red'))return toast('Tu perfil no puede modificar la red','bad');
  const olt=p.tipo==='olt',lab=olt?'Puerto':'Salida';
  const x=salidaEntry(p,n),col=FIBRA_COL[(n-1)%12];
  const e0=x&&SALIDA_EST[x.e]?x.e:'conectado';
  const otros=[...S.red.values()].filter(r=>r.id!==p.id).sort(redTipoCmp);
  const html=`<div class="head-row"><span class="chip">${fdot(col)} ${esc(col[0])}</span></div>
    <form class="form" id="sl-form" novalidate>
    ${F('Estado '+(olt?'del puerto':'de la salida'),'sl-e',`<select id="sl-e">${Object.entries(SALIDA_EST).map(([k,v])=>opt(k,v,k===e0)).join('')}</select>`)}
    <div id="sl-det">
    ${F('Lleva a (caja, splitter o botella)','sl-a',`<select id="sl-a"><option value="">No indicar</option>${otros.map(r=>opt(r.id,r.nombre+' · '+(RED_TIPO[r.tipo]||r.tipo),x&&x.a===r.id)).join('')}</select>`,'Si la caja, el splitter o la botella todavía no está cargada, cargala primero en Red.')}
    </div>
    ${F('Nota','sl-n',`<input id="sl-n" maxlength="120" autocomplete="off" value="${esc(x&&x.n||'')}" placeholder="Ej.: pigtail verde, sigue al poste 4">`)}
    <div class="actions"><button class="btn ghost" type="button" id="sl-cancel">Cancelar</button>${x?'<button class="btn danger" type="button" id="sl-libre">Dejar libre</button>':''}<button class="btn primary" type="submit">Guardar</button></div></form>`;
  openModal({title:lab+' '+n+' · '+p.nombre,html,onMount(el){
    const sync=()=>{$('#sl-det',el).hidden=$('#sl-e',el).value==='libre';};
    $('#sl-e',el).addEventListener('change',sync);sync();
    $('#sl-cancel',el).addEventListener('click',()=>openRed(id));
    const guardar=async patch=>{
      try{
        await putItem('red','puntos',id,{salidas:{[n]:patch},mod:Date.now()});
        await esperarRed(id,q=>{const y=salidaEntry(q,n);return patch?!!y&&y.e===patch.e&&(y.a||null)===patch.a&&(y.n||'')===patch.n:!y;});
        toast(patch?lab+' '+n+(olt?' guardado':' guardada'):lab+' '+n+' libre');openRed(id);
      }catch(err){dbError(err);}
    };
    $('#sl-form',el).addEventListener('submit',e=>{
      e.preventDefault();
      const est=$('#sl-e',el).value,a=$('#sl-a',el).value||null,nota=$('#sl-n',el).value.trim();
      if(est==='libre'&&!nota)return guardar(null);
      guardar({e:est,a:est==='libre'?null:a,n:nota});
    });
    const lib=$('#sl-libre',el);if(lib)lib.addEventListener('click',()=>guardar(null));
  }});
}
function empalmeFichaHTML(p){
  const hil=p.hilos||0,xt=xtuboDe(p),puede=can('red');
  const pons=(p.pons||[]).slice().sort((a,b)=>a-b);
  const ponsH=`<div><h3>PON vivos</h3>${pons.length?`<div class="actions start" style="gap:6px;margin-top:6px">${pons.map(n=>`<span class="chip ok">${esc(ponTxt(n))}</span>`).join('')}</div>`:`<div class="hint">Todavía no se marcó qué PON está vivo en esta fibra.${puede?' Se marca en «Editar».':''}</div>`}</div>`;
  const hacerH=p.hacer?`<div class="todo"><b>Qué hay que hacer</b><div style="white-space:pre-wrap;overflow-wrap:anywhere;margin-top:2px">${esc(p.hacer)}</div></div>`:'';
  if(!hil)return `${hacerH}${ponsH}<div><h3>Pelos de la fibra</h3><div class="hint">${puede?'Cargá en «Editar» cuántos pelos tiene la fibra para poder anotar qué lleva cada uno.':'Todavía no se cargaron los pelos de esta fibra.'}</div></div>`;
  const cell=n=>{
    const x=peloEntry(p,n),e=peloEst(p,n),info=peloInfo(n,xt);
    const lbl=e==='libre'?'Libre':e==='empalmado'?(x.p?'PON '+x.p:'Empalmado'):PELO_EST[e];
    const aria='Pelo '+n+(info.color?' ('+info.color[0].toLowerCase()+')':'')+': '+PELO_EST[e]+(x&&x.p?' · '+ponTxt(x.p):'')+(x&&x.a&&S.red.has(x.a)?' · lleva a '+S.red.get(x.a).nombre:'');
    const body=`<span class="pn">${fdot(info.color)}${n}</span><span class="pl">${esc(lbl)}</span>`;
    return puede?`<button class="pelo est-${e}" type="button" data-pelo="${n}" aria-label="${esc(aria)}" title="${esc(aria)}">${body}</button>`:`<div class="pelo est-${e}" aria-label="${esc(aria)}">${body}</div>`;
  };
  const tubos=xt>0&&hil>xt?Math.ceil(hil/xt):1,partes=[];
  for(let t=0;t<tubos;t++){
    const a=tubos===1?1:t*xt+1,b=tubos===1?hil:Math.min(hil,(t+1)*xt),cells=[];
    for(let n=a;n<=b;n++)cells.push(cell(n));
    const tc=tubos>1?FIBRA_COL[t%12]:null;
    partes.push(`<div class="nap-tubo">${tubos>1?`<div class="head-row"><b>${fdot(tc)} Tubo ${t+1}${tc?' · '+esc(tc[0].toLowerCase()):''}</b><span class="small muted">pelos ${a} a ${b}</span></div>`:''}<div class="pelos">${cells.join('')}</div></div>`);
  }
  const usados=Object.keys(p.pelos||{}).map(Number).filter(n=>n>=1&&n<=hil&&peloEst(p,n)!=='libre').sort((a,b)=>a-b);
  const lista=usados.map(n=>{
    const x=peloEntry(p,n),info=peloInfo(n,xt),dest=x.a&&S.red.get(x.a);
    const linea=[x.p?ponTxt(x.p):'',dest?'lleva a '+dest.nombre:'',x.n||''].filter(Boolean).join(' · ');
    return `<${puede?'button':'div'} class="item" type="button" ${puede?`data-pelo="${n}"`:''}><div><div class="t">${fdot(info.color)} Pelo ${n}${info.color?' · '+esc(info.color[0].toLowerCase()):''}${info.tubo&&hil>xt?' · tubo '+info.tubo:''}</div><div class="s">${esc(linea||PELO_EST[peloEst(p,n)])}</div></div><div class="side"><span class="chip ${peloEst(p,n)==='empalmado'?'accent':peloEst(p,n)==='danado'?'bad':'warn'}">${esc(PELO_EST[peloEst(p,n)])}</span></div></${puede?'button':'div'}>`;
  }).join('');
  return `${hacerH}${ponsH}<div><h3>Pelos de la fibra</h3><div class="hint">${usados.length} de ${hil} en uso.${puede?' Tocá un pelo para anotar cuál está empalmado y qué lleva.':''}</div>${partes.join('')}${lista?`<h3 style="margin-top:14px">Qué lleva cada pelo</h3><div class="list" style="margin-top:8px">${lista}</div>`:''}</div>`;
}
/* anotar un pelo: si está empalmado, qué PON lleva y a qué caja o botella va */
async function esperarRed(id,ok){for(let i=0;i<40&&!ok(S.red.get(id)||{});i++)await new Promise(r=>setTimeout(r,50));}
function openPelo(id,n){
  const p=S.red.get(id);if(!p||p.tipo!=='empalme')return;
  if(!can('red'))return toast('Tu perfil no puede modificar la red','bad');
  const x=peloEntry(p,n),info=peloInfo(n,xtuboDe(p));
  const e0=x&&PELO_EST[x.e]?x.e:'empalmado';
  const otros=[...S.red.values()].filter(r=>r.id!==p.id).sort(redTipoCmp);
  const pons=[...new Set([...PON_LISTA,...(p.pons||[]),...(x&&x.p?[x.p]:[])])].sort((a,b)=>a-b);
  const html=`<div class="head-row"><div>${info.color?`<span class="chip">${fdot(info.color)} ${esc(info.color[0])}</span> `:''}${info.tubo&&p.hilos>xtuboDe(p)?`<span class="chip">Tubo ${info.tubo}${info.tuboCol?' · '+esc(info.tuboCol[0].toLowerCase()):''}</span>`:''}</div></div>
    <form class="form" id="pl-form" novalidate>
    ${F('Estado del pelo','pl-e',`<select id="pl-e">${Object.entries(PELO_EST).map(([k,v])=>opt(k,v,k===e0)).join('')}</select>`)}
    <div id="pl-det">
    ${F('PON que lleva','pl-pon',`<select id="pl-pon"><option value="">No indicar</option>${pons.map(k=>opt(k,ponTxt(k)+((p.pons||[]).includes(k)?' · vivo':''),x&&x.p===k)).join('')}</select>`)}
    ${F('Lleva a (caja, splitter o botella)','pl-a',`<select id="pl-a"><option value="">No indicar</option>${otros.map(r=>opt(r.id,r.nombre+' · '+(RED_TIPO[r.tipo]||r.tipo),x&&x.a===r.id)).join('')}</select>`,'Si todavía no está cargada, cargala primero en Red.')}
    </div>
    ${F('Nota','pl-n',`<input id="pl-n" maxlength="120" autocomplete="off" value="${esc(x&&x.n||'')}" placeholder="Ej.: empalmado con el pelo 3 de la botella siguiente">`)}
    <div class="actions"><button class="btn ghost" type="button" id="pl-cancel">Cancelar</button>${x?'<button class="btn danger" type="button" id="pl-libre">Dejar libre</button>':''}<button class="btn primary" type="submit">Guardar</button></div></form>`;
  openModal({title:'Pelo '+n+' · '+p.nombre,html,onMount(el){
    const sync=()=>{$('#pl-det',el).hidden=$('#pl-e',el).value==='libre';};
    $('#pl-e',el).addEventListener('change',sync);sync();
    $('#pl-cancel',el).addEventListener('click',()=>openRed(id));
    const guardar=async patch=>{
      try{
        await putItem('red','puntos',id,{pelos:{[n]:patch},mod:Date.now()});
        await esperarRed(id,q=>{const y=peloEntry(q,n);return patch?!!y&&y.e===patch.e&&(y.p||null)===patch.p&&(y.a||null)===patch.a&&(y.n||'')===patch.n:!y;});
        toast(patch?'Pelo '+n+' guardado':'Pelo '+n+' libre');openRed(id);
      }catch(err){dbError(err);}
    };
    $('#pl-form',el).addEventListener('submit',e=>{
      e.preventDefault();
      const est=$('#pl-e',el).value,pon=parseInt($('#pl-pon',el).value,10)||null,a=$('#pl-a',el).value||null,nota=$('#pl-n',el).value.trim();
      if(est==='libre'&&!nota)return guardar(null);
      guardar({e:est,p:est==='libre'?null:pon,a:est==='libre'?null:a,n:nota});
    });
    const lib=$('#pl-libre',el);if(lib)lib.addEventListener('click',()=>guardar(null));
  }});
}
/* un cliente dentro de una caja: quién es, dónde está y las acciones (ver su ficha, mover) */
function openNapClient(napId,cid){
  const p=S.red.get(napId),c=S.clientes.get(cid);
  if(!p||!c)return openRed(napId);
  const vis=clientVisible(c),kv=(k,v)=>v?`<dt>${k}</dt><dd>${v}</dd>`:'';
  const html=`<div class="head-row">${estChip(c)}</div>
    <h2 style="overflow-wrap:anywhere">${esc(c.nombre)}</h2>
    <dl class="kv">${kv('Caja',esc(p.nombre))}${kv('Puerto',c.napPuerto?esc(c.napPuerto):'Sin puerto cargado')}${kv('Domicilio',esc(callePuerto(c)))}${vis&&can('telefono')&&c.tel?kv('Teléfono',esc(c.tel)):''}</dl>
    <div class="actions">${vis?'<button class="btn" type="button" data-act="ficha">Ver ficha del cliente</button>':''}${canMoverNap()?'<button class="btn primary" type="button" data-act="mover">Mover a otra caja o puerto</button>':''}${canMoverNap()&&c.nap===napId?'<button class="btn danger" type="button" data-act="sacar">Sacar de esta caja</button>':''}<button class="btn ghost" type="button" data-act="volver">Volver a la caja</button></div>`;
  openModal({title:'Cliente en '+p.nombre,html,onMount(el){
    el.addEventListener('click',e=>{
      const a=e.target.closest('[data-act]');if(!a)return;
      if(a.dataset.act==='ficha')openClient(c.id);
      else if(a.dataset.act==='mover')openMoverNap(c.id,napId);
      else if(a.dataset.act==='sacar')sacarDeCaja(c.id,napId);
      else if(a.dataset.act==='volver')openRed(napId);
    });
  }});
}
/* sacar a un cliente de la caja: queda libre su puerto (el cliente no se borra ni se da de baja) */
async function sacarDeCaja(cid,napId){
  const p=S.red.get(napId),c=S.clientes.get(cid);if(!p||!c)return openRed(napId);
  if(!canMoverNap())return toast('Tu perfil no puede cambiar de caja a un cliente','bad');
  if(!await askConfirm('¿Sacar a '+c.nombre+' de '+p.nombre+'?'+(c.napPuerto?' El puerto '+c.napPuerto+' queda libre.':'')+' El cliente sigue en el sistema.','Sacar de la caja',true))return openNapClient(napId,cid);
  try{
    await putItem('clientes',clientShard(c.id),c.id,{nap:null,napPuerto:null,mod:Date.now()});
    await esperarCliente(c.id,x=>!x.nap);
    toast('Listo: el puerto'+(c.napPuerto?' '+c.napPuerto:'')+' quedó libre');openRed(napId);
  }catch(err){dbError(err);}
}
/* el total de clientes ya instalados no se muestra a nadie (ni en la solapa ni en el aviso): solo se ofrecen los más cercanos y se pide escribir el nombre para buscar a otro */
/* un puerto libre: se elige al cliente que está conectado ahí. Sin escribir nada se ofrecen dos listas, «Por instalar» (los abonados nuevos) y «Ya instalados» (los que todavía no tienen caja), con los más cercanos a la caja primero;
   escribiendo se busca entre todos por nombre o calle (un técnico busca con 3 letras como mínimo y ve pocos resultados: no es una lista de todos los clientes) */
function openAsignarPuerto(napId,port,q0,tab0){
  const p=S.red.get(napId);if(!p)return;
  if(!canMoverNap())return toast('Tu perfil no puede cargar clientes en una caja','bad');
  const todos=can('clientesTodos'),min=todos?2:3,lim=todos?30:8,limYa=todos?15:8;
  const vis=todos?null:visibleSet();   /* un técnico ve «Por instalar» solo con los abonados de sus órdenes */
  const m=napMap(p),sinPto=new Set(m.sin.map(c=>c.id)),geo=hasGeo(p);
  const dist=c=>geo&&hasGeo(c)?distM(p,c):null;
  const puesto=c=>c.nap===napId&&!sinPto.has(c.id);              /* ya ocupa un puerto de esta caja: se ve en el dibujo */
  const enCaja=c=>!!(c.nap&&S.red.has(c.nap));
  const abierta=new Set();for(const o of S.ordenes.values())if(o.tipo==='instalacion'&&ORD_OPEN(o))abierta.add(o.clientId);
  const nombre=(a,b)=>norm(a.nombre).localeCompare(norm(b.nombre),'es',{numeric:true});
  /* primero los de esta caja que no tienen puerto, después los más cercanos, al final los que no tienen ubicación */
  const cerca=(a,b,conOrden)=>{
    const sa=sinPto.has(a.id),sb=sinPto.has(b.id);if(sa!==sb)return sa?-1:1;
    if(conOrden){const oa=abierta.has(a.id),ob=abierta.has(b.id);if(oa!==ob)return oa?-1:1;}   /* en «Por instalar», los que tienen una instalación abierta antes */
    const da=dist(a),db=dist(b);if(da!==null&&db!==null&&da!==db)return da-db;if((da===null)!==(db===null))return da===null?1:-1;
    return nombre(a,b);
  };
  const nuevos=[...S.clientes.values()].filter(c=>c.estado==='pendiente'&&!puesto(c)&&(!enCaja(c)||sinPto.has(c.id))&&(!vis||vis.has(c.id))).sort((a,b)=>cerca(a,b,true));
  const ya=[...S.clientes.values()].filter(c=>c.estado!=='pendiente'&&c.estado!=='baja'&&!puesto(c)&&(!enCaja(c)||sinPto.has(c.id))).sort(cerca);
  let tab=tab0||(nuevos.length?'nuevo':'ya');
  const html=`<p>¿Qué cliente está conectado en el <b>puerto ${port}</b> de <b>${esc(p.nombre)}</b>?</p>
    <div class="seg" id="as-seg" role="group" aria-label="Qué clientes mostrar"><button type="button" data-t="nuevo">Por instalar (${nuevos.length})</button><button type="button" data-t="ya">Ya instalados</button></div>
    <input class="search" id="as-q" type="search" placeholder="Buscar por nombre o calle (entre todos)" autocomplete="off" aria-label="Buscar cliente por nombre o calle" value="${esc(q0||'')}" style="flex:none">
    <div class="hint" id="as-hint"></div><div class="list" id="as-list"></div>
    <div class="actions"><button class="btn ghost" type="button" id="as-back">Volver a la caja</button></div>`;
  openModal({title:'Puerto '+port+' · '+p.nombre,html,onMount(el){
    const q=$('#as-q',el),hint=$('#as-hint',el),list=$('#as-list',el),seg=$('#as-seg',el);
    const fila=(c,buscando)=>{
      const nm=c.nap&&redName(c.nap),d=dist(c),est=buscando&&c.estado==='pendiente'?estLabel(c):'';
      return `<button class="item" type="button" data-as="${esc(c.id)}"><div><div class="t">${esc(c.nombre)}</div><div class="s">${esc(callePuerto(c)||'Sin domicilio')}</div></div><div class="side">${d!==null?`<span class="chip info">a ${esc(fmtDist(d))}</span>`:''}${est?`<span class="chip warn">${esc(est)}</span>`:''}${nm?`<span class="chip">${esc(nm)}${c.napPuerto?' · p. '+esc(c.napPuerto):''}</span>`:(buscando?'<span class="chip quiet">Sin caja</span>':'')}</div></button>`;
    };
    const buscar=()=>{
      const parts=norm(q.value).trim().split(/\s+/).filter(Boolean),txt=parts.join('');
      $$('button',seg).forEach(b=>b.setAttribute('aria-pressed',String(!txt&&b.dataset.t===tab)));
      if(!txt){   /* sin escribir: las dos listas */
        const l=tab==='nuevo'?nuevos:ya,mas=tab==='ya'&&l.length>limYa;
        hint.className='hint';
        hint.textContent=!l.length?(tab==='nuevo'?(todos?'No hay abonados por instalar.':'No tenés instalaciones pendientes.')+' Para elegir a otro, escribí su nombre.':'No hay clientes sin caja. Para uno que figura en otra caja, escribí su nombre.')
          :(tab==='nuevo'?'Tocá al cliente que va en este puerto.':'Clientes que todavía no tienen caja'+(geo?', de la más cercana a esta caja en adelante.':'.'))+(mas?(geo?' Se muestran solo los '+limYa+' más cercanos.':' Se muestran solo '+limYa+'.')+' Si no está, escribí su nombre.':'');
        list.innerHTML=(tab==='nuevo'?l.slice(0,lim):l.slice(0,limYa)).map(c=>fila(c,false)).join('');
        return;
      }
      if(txt.length<min){list.innerHTML='';hint.className='hint';hint.textContent='Escribí al menos '+min+' letras del nombre o de la calle.';return;}
      const out=[];
      for(const c of S.clientes.values()){
        if(c.estado==='baja')continue;
        const h=norm([c.nombre,c.dir,c.loc,c.codigo].join(' '));
        if(parts.every(x=>h.includes(x)))out.push(c);
      }
      out.sort(nombre);
      hint.className='hint';hint.textContent=out.length?(out.length>lim?'Hay más: escribí más letras para acotar.':''):'No hay ningún cliente con ese nombre. Si es nuevo, cargalo primero en Clientes.';
      list.innerHTML=out.slice(0,lim).map(c=>fila(c,true)).join('');
    };
    seg.addEventListener('click',e=>{const b=e.target.closest('[data-t]');if(!b)return;tab=b.dataset.t;q.value='';buscar();});
    q.addEventListener('input',buscar);buscar();
    $('#as-back',el).addEventListener('click',()=>openRed(napId));
    list.addEventListener('click',async e=>{
      const b=e.target.closest('[data-as]');if(!b)return;
      const c=S.clientes.get(b.dataset.as);if(!c)return;
      const otro=napClients(napId).find(x=>x.id!==c.id&&parseInt(x.napPuerto,10)===port);
      if(otro)return toast('El puerto '+port+' acaba de ser ocupado por '+otro.nombre+'. Elegí otro.','bad');
      const hoy=c.nap&&!(c.nap===napId&&sinPto.has(c.id))&&redName(c.nap);   /* el que figura en esta caja pero sin puerto no deja ningún lugar: no hay nada que confirmar */
      if(hoy&&!(c.nap===napId&&parseInt(c.napPuerto,10)===port)){
        if(!await askConfirm(c.nombre+' figura hoy en '+hoy+(c.napPuerto?' · puerto '+c.napPuerto:'')+'. ¿Pasarlo al puerto '+port+' de '+p.nombre+'? El lugar que deja queda libre.','Pasarlo acá'))return openAsignarPuerto(napId,port,q.value,tab);
      }
      try{
        await putItem('clientes',clientShard(c.id),c.id,{nap:napId,napPuerto:port,mod:Date.now()});
        await esperarCliente(c.id,x=>x.nap===napId&&parseInt(x.napPuerto,10)===port);
        toast(c.nombre+' · puerto '+port);openRed(napId);
      }catch(err){dbError(err);}
    });
    if(q0)q.focus();
  }});
}
function openMoverNap(cid,volverA){
  const c=S.clientes.get(cid);if(!c)return;
  if(!canMoverNap())return toast('Tu perfil no puede cambiar de caja a un cliente','bad');
  const cur=c.nap&&S.red.get(c.nap),from=hasGeo(c)?c:null;
  let dest=cur&&cur.tipo==='nap'?cur.id:'',sel=null;
  const html=`<p>Pasar a <b>${esc(c.nombre)}</b> ${cur?'de <b>'+esc(cur.nombre)+(c.napPuerto?' · puerto '+esc(c.napPuerto):'')+'</b>':'(hoy sin caja)'} a otra caja o a otro puerto. Al confirmar queda libre el puerto de origen y ocupado el de destino.</p>
    ${F('Caja NAP de destino','mv-nap',`<select id="mv-nap">${napOptionsHTML(dest,from,'Elegí la caja de destino')}</select>`,from?'Las más cercanas a la casa del cliente aparecen primero.':'')}
    <div id="mv-ports"></div><div class="hint" id="mv-hint"></div>
    <div class="actions"><button class="btn ghost" type="button" id="mv-cancel">Cancelar</button><button class="btn primary" type="button" id="mv-go" disabled>Mover</button></div>`;
  openModal({title:'Mover cliente de caja',html,onMount(el){
    const box=$('#mv-ports',el),go=$('#mv-go',el),hint=$('#mv-hint',el);
    const draw=()=>{
      const p=dest&&S.red.get(dest);
      hint.textContent='';hint.className='hint';go.disabled=!p||!sel;
      if(!p){box.innerHTML='';return;}
      if(!p.puertos){
        box.innerHTML=F('Puerto','mv-num',`<input id="mv-num" type="number" min="1" max="288" step="1" inputmode="numeric" value="${sel||''}">`,'Esta caja no tiene cargada la cantidad de puertos.');
        $('#mv-num',el).addEventListener('input',e=>{const n=parseInt(e.target.value,10);sel=n>=1?n:null;go.disabled=!sel;});
        return;
      }
      const m=napMap(p),n=m.libres.length;
      box.innerHTML=`<div class="hint ${n?'ok':'bad'}" style="margin-bottom:8px">${n?'Elegí un puerto libre: quedan '+n+'.':'Esta caja está llena: no hay puertos libres.'}</div>${portGridHTML(p,m,{pick:true,self:c.id,sel})}`;
    };
    $('#mv-nap',el).addEventListener('change',e=>{dest=e.target.value;sel=null;draw();});
    box.addEventListener('click',e=>{const b=e.target.closest('[data-pick]');if(!b)return;sel=parseInt(b.dataset.pick,10);draw();});
    const volver=()=>{if(volverA&&S.red.has(volverA))openRed(volverA);else if(cur)openRed(cur.id);else closeModal();};
    $('#mv-cancel',el).addEventListener('click',volver);
    go.addEventListener('click',async()=>{
      const p=S.red.get(dest);if(!p||!sel)return;
      if(p.puertos&&sel>p.puertos)return toast(p.nombre+' tiene '+p.puertos+' puertos: el '+sel+' no existe','bad');
      if(dest===c.nap&&sel===parseInt(c.napPuerto,10))return toast('Ya está en ese puerto','bad');
      const otro=napClients(dest).find(x=>x.id!==c.id&&parseInt(x.napPuerto,10)===sel);
      if(otro){toast('El puerto '+sel+' de '+p.nombre+' acaba de ser ocupado por '+otro.nombre+'. Elegí otro.','bad');sel=null;draw();return;}
      go.disabled=true;
      try{
        await putItem('clientes',clientShard(c.id),c.id,{nap:dest,napPuerto:sel,mod:Date.now()});
        await esperarCliente(c.id,x=>x.nap===dest&&parseInt(x.napPuerto,10)===sel);
        toast('Movido a '+p.nombre+' · puerto '+sel);openRed(dest);
      }catch(err){dbError(err);go.disabled=false;}
    });
    draw();
  }});
}
/* ----- caja NAP «iluminada» (ya empalmada y lista) o «sin empalmar» (todavía gris en el plano) -----
   Es un dato de ese punto físico en particular (no se copia al clonar una rama, ver prepararClon):
   una caja nueva arranca sin empalmar hasta que alguien la marca. */
async function toggleIluminada(id){
  const p=S.red.get(id);if(!p||p.tipo!=='nap')return;
  if(!can('red'))return toast('Tu perfil no puede modificar la red','bad');
  const nuevo=!p.iluminada;
  try{await putItem('red','puntos',p.id,{iluminada:nuevo,mod:Date.now()});await esperarRed(p.id,x=>!!x.iluminada===nuevo);toast(nuevo?'Caja marcada como iluminada':'Caja marcada como sin empalmar');openRed(p.id);}catch(e){dbError(e);}
}
function openRedGeo(id){
  const p=S.red.get(id);if(!p)return;
  if(!can('red'))return toast('Tu perfil no puede modificar la red','bad');
  const ART_LUGAR={nap:'la caja',splitter:'el splitter',olt:'la OLT',empalme:'la botella'};
  openModal({title:'Ubicación de '+p.nombre,html:`${geoFieldHTML(p,'Si estás al lado de '+(ART_LUGAR[p.tipo]||'el punto')+', tocá el botón y se completa solo.')}<div class="actions"><button class="btn ghost" type="button" data-close>Cancelar</button><button class="btn primary" type="button" id="geo-save">Guardar ubicación</button></div>`,onMount(el){
    const read=bindGeoField(el);
    $('#geo-save',el).addEventListener('click',async()=>{
      const g=read();
      if(g.invalid)return toast('Las coordenadas no son válidas','bad');
      try{await putItem('red','puntos',p.id,{lat:g.empty?null:g.lat,lng:g.empty?null:g.lng,mod:Date.now()});toast('Ubicación guardada');openRed(p.id);}catch(e){dbError(e);}
    });
  }});
}
/* ----- clonar una rama completa (splitter, botella o caja, con todo lo que cuelga de ella) -----
   Sirve para repetir rápido un esquema ya armado (por ejemplo, la rama de un puerto PON) en otro punto de la red: arma
   una copia de cada punto de la rama (mismo tipo, puertos, relación del splitter, pelos del empalme) con un nombre
   nuevo (el prefijo elegido + el nombre original), colgada de un padre nuevo. La copia no trae ubicación, referencia,
   notas, fibra, PON vivos ni «qué hay que hacer»: son datos de ese punto físico en particular, no de la estructura. */
function prepararClon(raizId,nuevoPadreId,prefijo,buscar,reemplazar){
  const raiz=S.red.get(raizId);if(!raiz)return {ok:false,msg:'No se encontró ese punto de la red'};
  const visitado=new Set([raiz.id]);
  const arbol=redArbol(raiz,visitado);
  const idMap=new Map();
  (function asignar(nodo){idMap.set(nodo.p.id,newId());nodo.hijos.forEach(h=>asignar(h.nodo));})(arbol);
  const items={},usados=new Map();
  [...S.red.values()].forEach(x=>{if(!usados.has(x.tipo))usados.set(x.tipo,new Set());usados.get(x.tipo).add(norm(x.nombre));});
  const CAMPOS=['tipo','puertos','rel','hilos','xtubo'];   /* solo lo estructural: ni ubicación, ni texto libre de este punto físico */
  let dup=null;
  (function construir(nodo,padreNuevo){
    if(dup)return;
    const old=nodo.p,nid=idMap.get(old.id),obj={};
    CAMPOS.forEach(k=>{if(old[k]!==undefined)obj[k]=old[k];});
    let nombre=old.nombre;
    if(buscar)nombre=nombre.split(buscar).join(reemplazar||'');
    obj.nombre=prefijo?prefijo+' '+nombre:nombre;
    const set=usados.get(obj.tipo)||new Set();usados.set(obj.tipo,set);
    if(set.has(norm(obj.nombre))){dup=obj.nombre;return;}
    set.add(norm(obj.nombre));
    obj.padre=padreNuevo;obj.creado=Date.now();obj.mod=Date.now();
    if(old.tipo==='empalme'){
      const pelos={};
      nodo.hijos.forEach(h=>h.pelos.forEach(({n})=>{const e=peloEntry(old,n);if(e)pelos[n]={e:e.e,p:null,a:idMap.get(h.nodo.p.id),n:''};}));
      if(Object.keys(pelos).length)obj.pelos=pelos;
    }else if(old.tipo==='splitter'||old.tipo==='olt'){
      const salidas={};
      nodo.hijos.forEach(h=>h.pelos.forEach(({n})=>{const e=salidaEntry(old,n);if(e)salidas[n]={e:e.e,a:idMap.get(h.nodo.p.id),n:''};}));
      if(Object.keys(salidas).length)obj.salidas=salidas;
    }
    items[nid]=obj;
    nodo.hijos.forEach(h=>construir(h.nodo,nid));
  })(arbol,nuevoPadreId);
  if(dup)return {ok:false,msg:'Ya hay un punto llamado «'+dup+'»: probá con otro prefijo o cambiá el buscar/reemplazar.'};
  return {ok:true,items,count:Object.keys(items).length,nuevaRaiz:idMap.get(raiz.id)};
}
function openRedClonar(id){
  const p=S.red.get(id);if(!p||p.tipo==='olt')return;
  if(!can('red'))return toast('Tu perfil no puede modificar la red','bad');
  const bloqueados=redDescendants(p.id);
  const padres=[...S.red.values()].filter(x=>(x.tipo==='empalme'||x.tipo==='splitter'||x.tipo==='olt')&&x.id!==p.id&&!bloqueados.has(x.id)).sort(redTipoCmp);
  const html=`<p>Crea una copia de <b>${esc(p.nombre)}</b> y de todo lo que cuelga de ella (splitters, botellas y cajas), con la misma estructura. La copia no trae ubicación, referencia, notas, fibra, PON vivos ni «qué hay que hacer»: eso es de cada punto físico y hay que cargarlo de nuevo.</p>
    <form class="form" id="cl-form" novalidate>
    ${F('De dónde sale la copia','cl-padre',`<select id="cl-padre"><option value="">No indicar</option>${padres.map(x=>opt(x.id,x.nombre+' · '+(RED_TIPO[x.tipo]||x.tipo))).join('')}</select>`,'La OLT, la botella o el splitter del que va a salir esta copia.')}
    ${F('Prefijo para los nombres de la copia','cl-prefijo',`<input id="cl-prefijo" maxlength="30" autocomplete="off" placeholder="Ej.: PON 2">`,'Se agrega adelante del nombre de cada punto copiado, para no repetir nombres.')}
    <div class="grid2">${F('Buscar en los nombres','cl-buscar',`<input id="cl-buscar" maxlength="60" autocomplete="off" placeholder="Ej.: pon 41">`,'Opcional: texto a cambiar en cada nombre copiado.')}
    ${F('Reemplazar por','cl-reemplazar',`<input id="cl-reemplazar" maxlength="60" autocomplete="off" placeholder="Ej.: pon 42">`,'Con qué se reemplaza lo que pusiste en «Buscar».')}</div>
    <div class="actions"><button class="btn ghost" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Clonar</button></div></form>`;
  openModal({title:'Clonar con todo lo que cuelga',html,onMount(el){
    $('#cl-form',el).addEventListener('submit',async e=>{
      e.preventDefault();
      const prefijo=$('#cl-prefijo',el).value.trim();
      const buscar=$('#cl-buscar',el).value.trim();
      const reemplazar=$('#cl-reemplazar',el).value.trim();
      if(!prefijo&&!buscar)return toast('Poné un prefijo o un buscar/reemplazar para los nombres de la copia','bad');
      const nuevoPadre=$('#cl-padre',el).value||null;
      const r=prepararClon(p.id,nuevoPadre,prefijo,buscar,reemplazar);
      if(!r.ok)return toast(r.msg,'bad');
      if(!await askConfirm('Se van a crear '+r.count+' puntos nuevos, copia de «'+p.nombre+'» y de todo lo que cuelga de ella. ¿Confirmás?','Clonar '+r.count+' puntos'))return;
      try{
        await putMany('red','puntos',r.items);
        await esperarRed(r.nuevaRaiz,x=>!!x.nombre);
        toast(r.count+' puntos creados');
        if(S.red.has(r.nuevaRaiz))openRed(r.nuevaRaiz);else closeModal();
      }catch(err){dbError(err);}
    });
  }});
}

/* ----- alta y edición ----- */
function openRedForm(id,tipoNuevo){
  const old=id?S.red.get(id):null;
  if(!can('red'))return toast('Tu perfil no puede modificar la red','bad');
  const p=old||{tipo:tipoNuevo==='empalme'?'empalme':tipoNuevo==='splitter'?'splitter':tipoNuevo==='olt'?'olt':'nap',puertos:tipoNuevo==='nap'||!tipoNuevo?16:null};
  const bloqueados=old?redDescendants(old.id):new Set();
  const padres=[...S.red.values()].filter(x=>(x.tipo==='empalme'||x.tipo==='splitter'||x.tipo==='olt')&&(!old||(x.id!==old.id&&!bloqueados.has(x.id)))).sort(redTipoCmp);
  const html=`<form class="form" id="rform" novalidate>
    <div class="grid2">${F('Qué es','rf-tipo',`<select id="rf-tipo"${old?' disabled':''}>${opt('olt','OLT (origen de la fibra)',p.tipo==='olt')}${opt('nap','Caja NAP (de acá salen los clientes)',p.tipo==='nap')}${opt('splitter','Splitter (divide la señal)',p.tipo==='splitter')}${opt('empalme','Botella de empalme',p.tipo==='empalme')}</select>`)}
    ${F('Nombre o número *','rf-nombre',`<input id="rf-nombre" value="${esc(p.nombre||'')}" autocomplete="off" placeholder="NAP-12">`)}</div>
    <div class="grid2" id="rf-fila"><div id="rf-puertos-w">${F('Cantidad de puertos','rf-puertos',`<input id="rf-puertos" type="number" min="1" max="288" step="1" inputmode="numeric" value="${p.puertos?esc(p.puertos):''}">`,'Salidas de la caja (8, 16…).')}</div>
    <div id="rf-rel-w">${F('Relación (salidas)','rf-rel',`<select id="rf-rel"><option value="">Elegí…</option>${RATIOS_SPLIT.map(n=>opt(n,'1x'+n,p.rel===n)).join('')}</select>`,'Cuántas salidas tiene el splitter.')}</div>
    <div id="rf-oltp-w">${F('Cantidad de puertos','rf-oltp',`<input id="rf-oltp" type="number" min="1" max="288" step="1" inputmode="numeric" value="${p.tipo==='olt'&&p.puertos?esc(p.puertos):''}">`,'Puertos GPON de la OLT (4, 8, 16, 24…). Cada uno sale con su propia fibra.')}</div></div>
    <div class="grid2" id="rf-padre-w">${F('Sale de','rf-padre',`<select id="rf-padre"><option value="">No indicar</option>${padres.map(x=>opt(x.id,x.nombre+' · '+(RED_TIPO[x.tipo]||x.tipo),x.id===p.padre)).join('')}</select>`,'La OLT, la botella de empalme o el splitter del que sale la señal.')}</div>
    <div id="rf-emp-w">
    ${F('Qué fibra es','rf-fibra',`<input id="rf-fibra" maxlength="120" autocomplete="off" value="${esc(p.fibra||'')}" placeholder="Fibra de 24 pelos, tendido desde ADMIN02">`)}
    <div class="grid2">${F('Cantidad de pelos','rf-hilos',`<input id="rf-hilos" type="number" min="1" max="288" step="1" inputmode="numeric" value="${p.hilos?esc(p.hilos):(old?'':24)}">`,'Los que tiene el cable (12, 24, 48…).')}
    ${F('Pelos por tubo','rf-xtubo',`<select id="rf-xtubo">${[[12,'12 por tubo'],[6,'6 por tubo'],[4,'4 por tubo'],[8,'8 por tubo'],[2,'2 por tubo'],[0,'No mostrar colores']].map(([k,l])=>opt(k,l,k===xtuboDe(p))).join('')}</select>`,'Sirve para mostrar el color de cada pelo y de cada tubo.')}</div>
    <div class="field"><label>PON vivos</label><div class="seg" id="rf-pons">${PON_LISTA.map(n=>`<button type="button" data-pon="${n}" aria-pressed="${(p.pons||[]).includes(n)}">PON ${n}</button>`).join('')}</div><div class="hint">Marcá los PON que tienen luz en esta fibra: pueden ser varios (PON 1 = VLAN 41, PON 2 = VLAN 42…).</div></div>
    ${F('Qué hay que hacer','rf-hacer',`<textarea id="rf-hacer" maxlength="500" placeholder="Ej.: empalmar el pelo 5 con la caja 3">${esc(p.hacer||'')}</textarea>`,'Pendientes o instrucciones para quien vaya a la botella.')}
    </div>
    ${F('Referencia para encontrarla','rf-ref',`<input id="rf-ref" value="${esc(p.ref||'')}" placeholder="Poste frente a la plaza, esquina Belgrano y Mitre">`)}
    ${geoFieldHTML(p,'Si estás al lado de la caja o de la botella, tocá el botón y se completa solo.')}
    ${F('Notas','rf-notas',`<textarea id="rf-notas">${esc(p.notas||'')}</textarea>`)}
    <div class="actions">${old&&can('editarClientes')?'<button class="btn danger" type="button" id="rf-del">Eliminar</button>':''}<button class="btn ghost" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Guardar</button></div></form>`;
  openModal({title:old?'Editar '+(RED_TIPO[p.tipo]||'punto').toLowerCase():(p.tipo==='nap'?'Nueva caja NAP':p.tipo==='splitter'?'Nuevo splitter':p.tipo==='olt'?'Nueva OLT':'Nueva botella de empalme'),html,onMount(el){
    const read=bindGeoField(el),v=i=>$('#'+i,el).value.trim();
    const kind=()=>$('#rf-tipo',el).value;
    const sync=()=>{const k=kind();$('#rf-puertos-w',el).hidden=k!=='nap';$('#rf-rel-w',el).hidden=k!=='splitter';$('#rf-oltp-w',el).hidden=k!=='olt';$('#rf-emp-w',el).hidden=k!=='empalme';$('#rf-padre-w',el).hidden=k==='olt';};
    $('#rf-pons',el).addEventListener('click',e=>{const b=e.target.closest('[data-pon]');if(b)b.setAttribute('aria-pressed',String(b.getAttribute('aria-pressed')!=='true'));});
    $('#rf-tipo',el).addEventListener('change',sync);sync();
    $('#rform',el).addEventListener('submit',async e=>{
      e.preventDefault();
      const g=read();if(g.invalid)return toast('Revisá las coordenadas','bad');
      const tipo=kind(),nombre=v('rf-nombre');
      if(!nombre)return toast('Falta el nombre','bad');
      const DUP_ART={nap:'una caja NAP',splitter:'un splitter',empalme:'una botella de empalme',olt:'una OLT'};
      if([...S.red.values()].some(x=>x.tipo===tipo&&x.id!==(old&&old.id)&&norm(x.nombre)===norm(nombre)))return toast('Ya hay '+(DUP_ART[tipo]||'un punto')+' con ese nombre','bad');
      let puertos=null,rel=null;
      if(tipo==='nap'&&v('rf-puertos')!==''){puertos=parseInt(v('rf-puertos'),10);if(!(puertos>=1&&puertos<=288))return toast('Los puertos tienen que ser un número entre 1 y 288','bad');}
      if(old&&tipo==='nap'&&puertos&&puertos<napUsed(old.id))return toast('La caja ya tiene '+napUsed(old.id)+' clientes conectados: no puede tener menos puertos','bad');
      if(tipo==='splitter'){
        if(v('rf-rel')==='')return toast('Elegí la relación del splitter (1x2, 1x4…)','bad');
        rel=parseInt(v('rf-rel'),10);
        if(!RATIOS_SPLIT.includes(rel))return toast('La relación no es válida','bad');
        if(old&&old.rel&&rel<old.rel){
          const sobran=Object.keys(old.salidas||{}).filter(n=>Number(n)>rel&&salidaEst(old,n)!=='libre');
          if(sobran.length)return toast('La salida '+Math.max(...sobran.map(Number))+' tiene datos cargados: no puede tener menos salidas. Dejala libre primero.','bad');
        }
      }
      if(tipo==='olt'){
        if(v('rf-oltp')==='')return toast('Cargá la cantidad de puertos de la OLT','bad');
        puertos=parseInt(v('rf-oltp'),10);
        if(!(puertos>=1&&puertos<=288))return toast('Los puertos tienen que ser un número entre 1 y 288','bad');
        if(old&&old.puertos&&puertos<old.puertos){
          const sobran=Object.keys(old.salidas||{}).filter(n=>Number(n)>puertos&&salidaEst(old,n)!=='libre');
          if(sobran.length)return toast('El puerto '+Math.max(...sobran.map(Number))+' tiene datos cargados: no puede tener menos puertos. Dejalo libre primero.','bad');
        }
      }
      const obj={tipo,nombre,lat:g.empty?null:g.lat,lng:g.empty?null:g.lng,puertos,padre:tipo==='olt'?null:(v('rf-padre')||null),ref:v('rf-ref'),notas:v('rf-notas'),mod:Date.now()};
      if(tipo==='splitter')obj.rel=rel;
      if(tipo==='empalme'){
        const hilos=v('rf-hilos')===''?null:parseInt(v('rf-hilos'),10);
        if(hilos!==null&&!(hilos>=1&&hilos<=288))return toast('Los pelos tienen que ser un número entre 1 y 288','bad');
        const sobran=old&&hilos?Object.keys(old.pelos||{}).filter(n=>Number(n)>hilos&&peloEst(old,n)!=='libre'):[];
        if(sobran.length)return toast('El pelo '+Math.max(...sobran.map(Number))+' tiene datos cargados: no puede tener menos pelos. Dejalo libre primero.','bad');
        if(old&&!hilos&&pelosUsados(old))return toast('La fibra ya tiene pelos anotados: no se puede quitar la cantidad de pelos.','bad');
        Object.assign(obj,{fibra:v('rf-fibra')||null,hilos,xtubo:parseInt($('#rf-xtubo',el).value,10)||0,pons:[...el.querySelectorAll('#rf-pons [aria-pressed="true"]')].map(b=>parseInt(b.dataset.pon,10)),hacer:v('rf-hacer')||null});
      }
      try{
        let nid=null;
        if(old)await putItem('red','puntos',old.id,obj);
        else{nid=newId();await putItem('red','puntos',nid,Object.assign({creado:Date.now()},obj));}
        const NUEVO_TXT={nap:'Caja NAP guardada',splitter:'Splitter guardado',empalme:'Botella de empalme guardada',olt:'OLT guardada'};
        toast(old?'Cambios guardados':(NUEVO_TXT[tipo]||'Guardado'));closeModal();
        /* una caja o una OLT recién creada se abre sola, ya dibujada, para ir cargando qué cliente o qué puerto va en cada lugar */
        if(nid&&((tipo==='nap'&&puertos)||(tipo==='empalme'&&obj.hilos)||(tipo==='splitter'&&obj.rel)||(tipo==='olt'&&puertos))){for(let k=0;k<40&&!S.red.has(nid);k++)await new Promise(r=>setTimeout(r,50));if(S.red.has(nid))openRed(nid);}
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
