/* ===== comodato: equipos prestados al cliente y contrato firmado en pantalla ===== */
const CT_ESTADO={vigente:'Vigente',revision:'En revisión',archivado:'Archivado',rechazado:'Rechazado',borrado:'En la papelera'};
const CT_MOTIVO={alta:'Alta',titularidad:'Cambio de titularidad',equipos:'Cambio de equipos'};
const CT_CLS={vigente:'ok',revision:'warn',archivado:'',rechazado:'bad',borrado:'bad'};
const CM_TIPOS=['ONU','Router Wi-Fi','Antena','Cable de fibra','Fuente o adaptador','Otro'];
S.contratos=new Map();   /* id → resumen (sin el texto ni la firma); el detalle se pide al abrir cada contrato */
S.contratosOk=false;
let ctIdx=null,ctCarga=null;
const ctNum=n=>String(n).padStart(4,'0');
const ctFecha=ts=>{try{return new Date(ts).toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});}catch(e){return '';}};
const ctDia=ts=>ctFecha(ts).split(',')[0].split(' ')[0];
/* los contratos de un cliente, del más viejo al más nuevo (sin los de la papelera) */
function ctDe(cid){
  if(!ctIdx){ctIdx=new Map();for(const r of S.contratos.values()){if(r.estado==='borrado')continue;if(!ctIdx.has(r.cid))ctIdx.set(r.cid,[]);ctIdx.get(r.cid).push(r);}ctIdx.forEach(a=>a.sort((x,y)=>x.num-y.num));}
  return ctIdx.get(cid)||[];
}
const ctVig=cid=>ctDe(cid).find(r=>r.estado==='vigente')||null;
const ctRev=cid=>ctDe(cid).find(r=>r.estado==='revision')||null;
const ctPend=()=>{let n=0;for(const r of S.contratos.values())if(r.estado==='revision')n++;return n;};
/* mismas reglas que el servidor: dos listas con los mismos equipos dan el mismo texto, y así se sabe si cambiaron desde que se firmó */
const cmLim=(v,n)=>String(v==null?'':v).replace(/\s+/g,' ').trim().slice(0,n);
function cmLimpio(v){
  return (Array.isArray(v)?v:[]).slice(0,30).filter(x=>x&&typeof x==='object'&&!Array.isArray(x)).map(it=>({t:CM_TIPOS.includes(it.t)?it.t:'Otro',d:cmLim(it.d,80),s:cmLim(it.s,60),n:Math.max(1,Math.min(99,Math.round(Number(it.n))||1)),e:it.e==='nuevo'?'nuevo':'usado',o:cmLim(it.o,120)}));
}
const cmSig=arr=>cmLimpio(arr).map(e=>[e.t,e.d,e.s,e.n,e.e,e.o].map(x=>String(x).toLowerCase()).join('|')).sort().join(';');
const ctGuardar=r=>{if(!r||!r.id)return;if(r.estado==='borrado')S.contratos.delete(r.id);else S.contratos.set(r.id,{id:r.id,num:r.num,cid:r.cid,estado:r.estado,motivo:r.motivo,prev:r.prev||null,prueba:!!r.prueba,ts:r.ts,por:r.por||'',eq:r.eq,tit:r.tit});ctIdx=null;};
function cargarContratos(){
  if(!can('comodato'))return Promise.resolve();
  if(ctCarga)return ctCarga;
  ctCarga=NET.api('GET','/api/contratos',undefined,{noKick:true}).then(j=>{
    S.contratos.clear();ctIdx=null;(j.contratos||[]).forEach(ctGuardar);S.contratosOk=true;dataChanged('contratos');
  }).catch(e=>{if(!(e&&e.network))console.error(e);}).finally(()=>{ctCarga=null;});  /* sin red no es un error: se vuelve a pedir en la próxima sincronización */
  return ctCarga;
}
function ctOnEvent(r){ctGuardar(r);dataChanged('contratos');}
function ctStart(){NET.on('contrato',ctOnEvent);NET.on('sync',cargarContratos);cargarContratos();}
/* en la lista de clientes: solo la oficina ve que hay un contrato esperando su revisión */
const ctChip=c=>can('contratosGestion')&&ctRev(c.id)?'<span class="chip warn">Contrato en revisión</span>':'';
const cmEqLinea=e=>`<li><b>${esc(e.t)}</b>${e.d?' · '+esc(e.d):''}${e.s?' · <span class="mono">'+esc(e.s)+'</span>':''}${e.n>1?' · '+e.n+' unidades':''} <span class="muted small">${e.e==='nuevo'?'nuevo':'usado'}${e.o?' · '+esc(e.o):''}</span></li>`;

/* ----- en la ficha del cliente ----- */
function comodatoBlock(c){
  if(!can('comodato'))return '';
  const eqs=cmLimpio(c.comodato),vig=ctVig(c.id),rev=ctRev(c.id),baja=c.estado==='baja',retirar=bajaPend(c);
  const titulo=retirar?'Equipos a retirar (comodato)':'Equipos en comodato';
  let st='';
  if(S.contratosOk){
    if(vig){
      const cambio=cmSig(eqs)!==vig.eq;
      st+=`<div class="tags"><span class="chip ok">Contrato N° ${ctNum(vig.num)} firmado el ${esc(ctDia(vig.ts))}</span>${vig.prueba?'<span class="chip bad">De prueba</span>':''}</div>`;
      if(cambio&&!rev&&!baja)st+='<div class="notice">Los equipos cambiaron desde que se firmó el contrato. Hay que hacer firmar el cambio de equipos.</div>';
    }
    if(rev)st+=`<div class="notice info"><b>${esc(CT_MOTIVO[rev.motivo]||'Contrato')} (N° ${ctNum(rev.num)}) firmado, esperando la revisión de la oficina.</b>${vig?' Mientras tanto sigue vigente el contrato N° '+ctNum(vig.num)+'.':''}</div>`;
    if(!vig&&!rev&&!baja)st+=eqs.length?'<div class="notice"><b>Falta el contrato de comodato firmado.</b> El cliente lo firma con el dedo en este mismo celular.</div>':'<div class="hint">Cargá los equipos que se le prestaron para poder hacer firmar el contrato.</div>';
  }
  const bt=[];
  bt.push('<button class="btn small" type="button" data-cm="editar">'+(eqs.length?'Editar equipos':'Cargar equipos')+'</button>');
  if(S.contratosOk&&!baja&&eqs.length){
    if(!vig&&!rev)bt.push('<button class="btn small primary" type="button" data-cm="firmar" data-motivo="alta">Hacer firmar el contrato</button>');
    if(vig&&!rev){
      if(cmSig(eqs)!==vig.eq)bt.push('<button class="btn small primary" type="button" data-cm="firmar" data-motivo="equipos">Firmar cambio de equipos</button>');
      bt.push('<button class="btn small" type="button" data-cm="firmar" data-motivo="titularidad">Cambio de titularidad</button>');
    }
  }
  if(vig)bt.push(`<button class="btn small" type="button" data-cm="ver" data-id="${esc(vig.id)}">Ver contrato</button>`);
  if(rev)bt.push(`<button class="btn small" type="button" data-cm="ver" data-id="${esc(rev.id)}">Ver el contrato en revisión</button>`);
  if(can('contratosGestion')&&ctDe(c.id).length>(vig?1:0)+(rev?1:0))bt.push('<button class="btn small ghost" type="button" data-cm="todos">Todos los contratos del cliente</button>');
  return `<div class="card flat cm-block"><h3>${titulo}</h3>${eqs.length?`<ul class="cm-list">${eqs.map(cmEqLinea).join('')}</ul>`:'<div class="hint">No hay equipos cargados.</div>'}${st}<div class="actions start">${bt.join('')}</div></div>`;
}
function comodatoBind(el,c){
  el.addEventListener('click',e=>{
    const b=e.target.closest('[data-cm]');if(!b)return;
    const a=b.dataset.cm;
    if(a==='editar')openComodatoEditor(c.id);
    else if(a==='firmar')openContratoFirma(c.id,b.dataset.motivo);
    else if(a==='ver')openContrato(b.dataset.id,()=>openClient(c.id));
    else if(a==='todos')openContratos({cid:c.id});
  });
}

/* ----- cargar o editar los equipos prestados ----- */
/* Los modelos se eligen de una lista (la edita el administrador en Ajustes) para que el técnico solo escriba la MAC.
   Esta copia es la de arranque: se usa si todavía no se pudo pedir la del servidor (mismos modelos que el servidor). */
const CM_MODELOS_DEF=[{t:'ONU',d:'Huawei HG8145V5'},{t:'Antena',d:'CPE Ubiquiti LiteBeam Gen2'},{t:'Fuente o adaptador',d:'Inyector de corriente PoE'},{t:'Fuente o adaptador',d:'Fuente de corriente de la ONU'}];
const CM_SIN_MAC=['Fuente o adaptador','Cable de fibra'];   /* estos no tienen MAC ni serie que anotar */
const CM_OTRO='__otro';
S.cmModelos=null;
const cmLista=t=>(S.cmModelos||CM_MODELOS_DEF).filter(m=>m.t===t).map(m=>m.d);
async function cmCargarModelos(){
  if(!can('comodato'))return;
  try{const j=await NET.api('GET','/api/comodato/modelos',undefined,{noKick:true,timeout:6000});if(Array.isArray(j.modelos))S.cmModelos=j.modelos;}catch(e){/* sin red: valen los que ya se tenían */}
}
/* el último modelo que se eligió en este celular para cada tipo (si todavía está en la lista), o el primero de la lista */
const cmUlt=t=>{try{return localStorage.getItem('yapur_cm_'+t)||'';}catch(e){return '';}};
const cmUltPoner=(t,d)=>{try{localStorage.setItem('yapur_cm_'+t,d);}catch(e){}};
function cmModeloInicial(t){const l=cmLista(t),u=cmUlt(t);return u&&l.includes(u)?u:(l[0]||'');}
/* la MAC se anota en mayúsculas y con dos puntos si son 12 letras y números; un N° de serie se deja tal cual */
function cmMacFmt(v){
  const s=String(v==null?'':v).trim().toUpperCase(),h=s.replace(/[\s:.\-]/g,'');
  return /^[0-9A-F]{12}$/.test(h)?h.match(/../g).join(':'):s;
}
function cmMacMal(v){
  const s=String(v==null?'':v).trim().toUpperCase();
  if(!/[:\-]/.test(s))return '';
  const h=s.replace(/[\s:.\-]/g,'');
  return /^[0-9A-F]+$/.test(h)&&h.length!==12?'La MAC tiene que tener 12 letras y números y la que escribiste tiene '+h.length+'.':'';
}
/* Los equipos con los que arranca la lista de un cliente sin equipos cargados.
   Antena: siempre es el mismo modelo, así que ya viene puesto. Fibra: la ONU viene con el modelo de la lista y solo falta la MAC.
   Si la ficha del cliente ya tiene el «equipo» (serie o MAC), se usa para no escribirlo dos veces. */
function cmInicial(c){
  const eq=c&&c.equipo?cmMacFmt(cmLim(c.equipo,60)):'';
  const f=(t,d,s)=>({t,d,s:s||'',n:1,e:'nuevo',o:''});
  return c&&c.tec==='wireless'?[f('Antena',cmModeloInicial('Antena')||'CPE Ubiquiti LiteBeam Gen2',eq),f('Fuente o adaptador','Inyector de corriente PoE')]:[f('ONU',cmModeloInicial('ONU'),eq),f('Fuente o adaptador','Fuente de corriente de la ONU')];
}
async function openComodatoEditor(id){
  const c=S.clientes.get(id);if(!c)return;
  await cmCargarModelos();
  let rows=cmLimpio(c.comodato).map(r=>Object.assign(r,{otro:!cmLista(r.t).includes(r.d)}));
  if(!rows.length)rows=cmInicial(c).map(r=>Object.assign(r,{otro:!cmLista(r.t).includes(r.d)}));
  const vig=ctVig(id);
  const rowHtml=(r,i)=>{
    const lista=cmLista(r.t),conMac=!CM_SIN_MAC.includes(r.t),otro=!lista.length||r.otro;
    const serie=F(conMac?'MAC (o N° de serie)':'N° de serie (si tiene)','cm-s'+i,`<input id="cm-s${i}" class="mono" value="${esc(r.s)}" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="60" placeholder="${conMac?'Escribí la MAC que está en la etiqueta':'Opcional'}">`);
    return `<div class="card flat cm-row" data-i="${i}">
    <div class="grid2">${F('Tipo','cm-t'+i,`<select id="cm-t${i}">${CM_TIPOS.map(t=>`<option${t===r.t?' selected':''}>${esc(t)}</option>`).join('')}</select>`)}
    ${lista.length?F('Modelo','cm-m'+i,`<select id="cm-m${i}">${lista.map(d=>`<option value="${esc(d)}"${!otro&&d===r.d?' selected':''}>${esc(d)}</option>`).join('')}<option value="${CM_OTRO}"${otro?' selected':''}>Otro modelo (escribirlo)</option></select>`):'<div></div>'}</div>
    <div id="cm-dw${i}"${otro?'':' hidden'}>${F('Marca y modelo','cm-d'+i,`<input id="cm-d${i}" value="${esc(r.d)}" autocomplete="off" maxlength="80" placeholder="Huawei HG8145V5">`)}</div>
    ${conMac?serie:''}
    <details class="cm-mas"><summary class="small muted">Cantidad, estado y observaciones</summary>
      <div class="grid2">${F('Cantidad','cm-n'+i,`<input id="cm-n${i}" type="number" min="1" max="99" inputmode="numeric" value="${r.n}">`)}${F('Estado','cm-e'+i,`<select id="cm-e${i}"><option value="nuevo"${r.e==='nuevo'?' selected':''}>Nuevo</option><option value="usado"${r.e!=='nuevo'?' selected':''}>Usado</option></select>`)}</div>
      ${conMac?'':serie}
      ${F('Observaciones','cm-o'+i,`<input id="cm-o${i}" value="${esc(r.o)}" autocomplete="off" maxlength="120" placeholder="Con caja, con fuente…">`)}</details>
    <div class="actions start"><button class="btn small danger" type="button" data-cm-del="${i}">Quitar este equipo</button></div></div>`;
  };
  openModal({title:'Equipos en comodato',html:`<div class="hint"><b>${esc(c.nombre)}</b> · lo que la empresa le prestó al cliente. Elegí el modelo y escribí la MAC del equipo: es lo que figura en el contrato.</div>
    ${vig?`<div class="notice">Ya hay un contrato firmado (N° ${ctNum(vig.num)}). Si cambiás los equipos, después hay que hacer firmar un cambio de equipos.</div>`:''}
    <form class="form" id="cmform" novalidate><div id="cm-rows"></div>
    <div class="actions start"><button class="btn" type="button" id="cm-add">Agregar otro equipo</button></div>
    <div class="actions"><button class="btn ghost" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Guardar equipos</button></div></form>`,
  onMount(el){
    const leer=()=>rows=rows.map((r,i)=>{
      const m=$('#cm-m'+i,el),otro=!m||m.value===CM_OTRO;
      return {t:$('#cm-t'+i,el).value,d:otro?$('#cm-d'+i,el).value:m.value,otro,s:$('#cm-s'+i,el).value,n:Math.max(1,Math.round(Number($('#cm-n'+i,el).value))||1),e:$('#cm-e'+i,el).value,o:$('#cm-o'+i,el).value};
    });
    const dibujar=()=>{$('#cm-rows',el).innerHTML=rows.map(rowHtml).join('');};
    dibujar();
    $('#cm-add',el).addEventListener('click',()=>{
      if(rows.length>=30)return toast('Son demasiados equipos (máximo 30)','bad');
      leer();const d=cmModeloInicial('ONU');rows.push({t:'ONU',d,s:'',n:1,e:'nuevo',o:'',otro:!d});dibujar();
      const l=$('#cm-s'+(rows.length-1),el);if(l)l.focus();
    });
    $('#cm-rows',el).addEventListener('click',e=>{const b=e.target.closest('[data-cm-del]');if(!b)return;leer();rows.splice(Number(b.dataset.cmDel),1);dibujar();});
    $('#cm-rows',el).addEventListener('change',e=>{
      const id=e.target.id||'',i=Number((id.match(/(\d+)$/)||[])[1]);
      if(/^cm-t\d+$/.test(id)){   /* otro tipo de equipo: otra lista de modelos */
        leer();const r=rows[i],d=cmModeloInicial(r.t);r.d=d;r.otro=!d;dibujar();return;
      }
      if(/^cm-m\d+$/.test(id)){const w=$('#cm-dw'+i,el);w.hidden=e.target.value!==CM_OTRO;if(!w.hidden)$('#cm-d'+i,el).focus();return;}
      if(/^cm-s\d+$/.test(id))e.target.value=cmMacFmt(e.target.value);
    });
    $('#cm-rows',el).addEventListener('input',e=>{if(/^cm-s\d+$/.test(e.target.id||'')){const p=e.target.selectionStart,u=e.target.value.toUpperCase();if(u!==e.target.value){e.target.value=u;try{e.target.setSelectionRange(p,p);}catch(_){}}}});
    $('#cmform',el).addEventListener('submit',async e=>{
      e.preventDefault();leer();
      rows.forEach(r=>{r.s=cmMacFmt(r.s);});
      const list=cmLimpio(rows);
      for(let i=0;i<list.length;i++){
        const r=list[i],sinMac=CM_SIN_MAC.includes(r.t),malMac=cmMacMal(r.s);
        const foco=sel=>{const x=$(sel+i,el);if(x){const d=x.closest('details');if(d)d.open=true;x.focus();}};
        if(!r.d){toast('Equipo '+(i+1)+': falta el modelo','bad');foco('#cm-d');return;}
        if(!sinMac&&!r.s){toast('Equipo '+(i+1)+' ('+r.t+'): escribí la MAC o el N° de serie','bad');foco('#cm-s');return;}
        if(malMac){toast('Equipo '+(i+1)+': '+malMac,'bad');foco('#cm-s');return;}
      }
      const btn=$('button[type=submit]',el);btn.disabled=true;
      try{
        await saveClient(c,{comodato:list});S.clientes.set(id,Object.assign({},c,{comodato:list},{mod:Date.now()}));dataChanged('clientes');
        list.forEach(r=>{if(r.d&&cmLista(r.t).includes(r.d))cmUltPoner(r.t,r.d);});
        toast(list.length?'Equipos guardados':'Se quitaron los equipos');closeModal();openClient(id);
      }
      catch(err){btn.disabled=false;dbError(err);}
    });
  }});
}

/* ----- Ajustes (administrador): los modelos de equipos que se ofrecen al cargar el comodato ----- */
async function openComodatoModelos(){
  let r;try{r=await NET.api('GET','/api/comodato/modelos');}catch(err){return dbError(err);}
  let rows=(r.modelos||[]).map(m=>({t:m.t,d:m.d}));
  const orden=()=>{rows=rows.map((x,i)=>[x,i]).sort((a,b)=>CM_TIPOS.indexOf(a[0].t)-CM_TIPOS.indexOf(b[0].t)||a[1]-b[1]).map(x=>x[0]);};
  orden();
  const dibujar=el=>{
    $('#cmm-rows',el).innerHTML=rows.length?rows.map((x,i)=>`<div class="cm-modelo" data-i="${i}"><div class="grid2">${F('Tipo','cmm-t'+i,`<select id="cmm-t${i}">${CM_TIPOS.map(t=>`<option${t===x.t?' selected':''}>${esc(t)}</option>`).join('')}</select>`)}${F('Marca y modelo','cmm-d'+i,`<input id="cmm-d${i}" value="${esc(x.d)}" autocomplete="off" maxlength="80">`)}</div>
      <div class="actions start"><button class="btn small danger" type="button" data-cmm-del="${i}">Quitar</button></div></div>`).join(''):'<div class="hint">No hay modelos cargados: los técnicos van a tener que escribir el modelo de cada equipo.</div>';
  };
  openModal({title:'Modelos de equipos',html:`<div class="hint">Estos son los modelos que los técnicos eligen de una lista al cargar los equipos de un cliente, y así solo escriben la MAC. En cada tipo, el primero es el que viene puesto en un cliente nuevo (después queda el último que eligió cada técnico). Siempre pueden elegir «Otro modelo» y escribirlo.</div>
    <form class="form" id="cmmform" novalidate><div id="cmm-rows"></div>
    <div class="actions start"><button class="btn" type="button" id="cmm-add">Agregar un modelo</button></div>
    <div class="actions"><button class="btn ghost" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Guardar modelos</button></div></form>`,
  onMount(el){
    const leer=()=>{rows=rows.map((x,i)=>({t:$('#cmm-t'+i,el).value,d:$('#cmm-d'+i,el).value}));};
    dibujar(el);
    $('#cmm-add',el).addEventListener('click',()=>{leer();rows.push({t:'ONU',d:''});dibujar(el);const i=rows.length-1,x=$('#cmm-d'+i,el);if(x)x.focus();});
    $('#cmm-rows',el).addEventListener('click',e=>{const b=e.target.closest('[data-cmm-del]');if(!b)return;leer();rows.splice(Number(b.dataset.cmmDel),1);dibujar(el);});
    $('#cmmform',el).addEventListener('submit',async e=>{
      e.preventDefault();leer();
      const lista=rows.map(x=>({t:x.t,d:cmLim(x.d,80)})).filter(x=>x.d);
      const btn=$('button[type=submit]',el);btn.disabled=true;
      try{const j=await NET.api('PUT','/api/comodato/modelos',{modelos:lista});S.cmModelos=j.modelos;toast('Modelos guardados');closeModal();}
      catch(err){btn.disabled=false;dbError(err);}
    });
  }});
}

/* ----- la hoja para firmar con el dedo ----- */
function sigPad(canvas,onChange){
  const g=canvas.getContext('2d');
  let dibujando=false,last=null,largo=0,trazos=0,minX=1e9,maxX=-1e9;
  const limpiar=()=>{g.fillStyle='#fff';g.fillRect(0,0,canvas.width,canvas.height);g.lineWidth=2.6;g.lineCap='round';g.lineJoin='round';g.strokeStyle='#111';largo=0;trazos=0;minX=1e9;maxX=-1e9;};
  const pos=ev=>{const r=canvas.getBoundingClientRect();return {x:(ev.clientX-r.left)*canvas.width/r.width,y:(ev.clientY-r.top)*canvas.height/r.height};};
  canvas.style.touchAction='none';
  canvas.addEventListener('pointerdown',ev=>{ev.preventDefault();try{canvas.setPointerCapture(ev.pointerId);}catch(_){}dibujando=true;last=pos(ev);trazos++;g.beginPath();g.arc(last.x,last.y,1.3,0,7);g.fillStyle='#111';g.fill();});
  canvas.addEventListener('pointermove',ev=>{
    if(!dibujando)return;ev.preventDefault();
    const p=pos(ev);g.beginPath();g.moveTo(last.x,last.y);g.lineTo(p.x,p.y);g.stroke();
    largo+=Math.hypot(p.x-last.x,p.y-last.y);minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);last=p;if(onChange)onChange();
  });
  const fin=ev=>{if(!dibujando)return;dibujando=false;if(onChange)onChange();};
  canvas.addEventListener('pointerup',fin);canvas.addEventListener('pointercancel',fin);canvas.addEventListener('pointerleave',fin);
  limpiar();
  return {
    clear(){limpiar();if(onChange)onChange();},
    /* una firma de verdad: varios trazos largos, no un toque suelto */
    ok:()=>largo>=150&&(maxX-minX)>=60,
    url:()=>canvas.toDataURL('image/png')
  };
}
const CT_MOTIVO_TXT={
  alta:'Contrato de comodato: el cliente firma por los equipos que se le prestan.',
  titularidad:'Cambio de titularidad: cargá los datos de la persona que pasa a ser titular. El contrato actual sigue vigente hasta que la oficina revise y apruebe este.',
  equipos:'Cambio de equipos: el titular firma un contrato nuevo con la lista de equipos actual. El anterior se archiva cuando la oficina lo aprueba.'
};
function openContratoFirma(cid,motivo){
  const c=S.clientes.get(cid);if(!c)return;
  const eqs=cmLimpio(c.comodato);
  if(!eqs.length)return toast('Cargá primero los equipos en comodato','bad');
  const tit={nombre:motivo==='titularidad'?'':(c.nombre||''),dni:motivo==='titularidad'||!can('dni')?'':(c.dni||''),dir:c.dir||'',loc:c.loc||'',tel:motivo==='titularidad'||!can('telefono')?'':(c.tel||'')};
  let vista=null,pad=null,ocupado=false;
  openModal({title:motivo==='alta'?'Contrato de comodato':CT_MOTIVO[motivo],wide:true,html:'<div id="ctw"></div>',onMount(el){
    const w=$('#ctw',el);
    const paso1=()=>{
      w.innerHTML=`<div class="notice info">${esc(CT_MOTIVO_TXT[motivo])}</div>
        <form class="form" id="ctf1" novalidate>
        ${F('Nombre completo del titular *','ct-nom',`<input id="ct-nom" value="${esc(tit.nombre)}" autocomplete="off" maxlength="80">`)}
        <div class="grid2">${F('DNI o CUIT *','ct-dni',`<input id="ct-dni" value="${esc(tit.dni)}" inputmode="numeric" autocomplete="off" maxlength="14" placeholder="Solo números">`)}${F('Teléfono','ct-tel',`<input id="ct-tel" type="tel" value="${esc(tit.tel)}" autocomplete="off" maxlength="30">`)}</div>
        <div class="grid2">${F('Domicilio *','ct-dir',`<input id="ct-dir" value="${esc(tit.dir)}" autocomplete="off" maxlength="120">`)}${F('Localidad','ct-loc',`<input id="ct-loc" value="${esc(tit.loc)}" autocomplete="off" maxlength="60">`)}</div>
        <div><div class="legend small muted">Equipos que figuran en el contrato</div><ul class="cm-list">${eqs.map(cmEqLinea).join('')}</ul><div class="hint">Si falta o sobra alguno, cancelá y editá los equipos antes de seguir.</div></div>
        <div class="actions"><button class="btn ghost" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Leer el contrato</button></div></form>`;
      $('#ctf1',w).addEventListener('submit',async e=>{
        e.preventDefault();if(ocupado)return;
        tit.nombre=$('#ct-nom',w).value.trim();tit.dni=$('#ct-dni',w).value.trim();tit.tel=$('#ct-tel',w).value.trim();tit.dir=$('#ct-dir',w).value.trim();tit.loc=$('#ct-loc',w).value.trim();
        if(tit.nombre.length<3)return toast('Falta el nombre completo del titular','bad');
        const dd=tit.dni.replace(/\D/g,'');if(dd.length<7||dd.length>11)return toast('El DNI o CUIT no es válido','bad');
        if(tit.dir.length<3)return toast('Falta el domicilio','bad');
        ocupado=true;const btn=$('button[type=submit]',w);btn.disabled=true;btn.textContent='Preparando…';
        try{vista=await NET.api('POST','/api/contrato/vista',{cid,motivo,titular:tit});paso2();}
        catch(err){btn.disabled=false;btn.textContent='Leer el contrato';dbError(err);}
        finally{ocupado=false;}
      });
    };
    const paso2=()=>{
      w.innerHTML=`${vista.prueba?'<div class="notice bad"><b>Texto de prueba.</b> Todavía no está cargado el texto definitivo del contrato: lo que firmes acá queda marcado «de prueba».</div>':''}
        <div class="ct-doc" id="ct-doc" tabindex="0" role="document" aria-label="Texto del contrato">${esc(vista.texto)}</div>
        <div class="hint">Pedile al titular que lea el contrato completo (deslizá el texto) antes de firmar.</div>
        ${F('Aclaración (nombre de quien firma) *','ct-acl',`<input id="ct-acl" value="${esc(vista.titular.nombre)}" autocomplete="off" maxlength="80">`)}
        <div class="field"><label>Firma del titular *</label><canvas id="ct-sig" class="sig-pad" width="480" height="180" aria-label="Espacio para firmar con el dedo"></canvas>
          <div class="actions start"><button class="btn small ghost" type="button" id="ct-clr">Borrar y firmar de nuevo</button><span class="hint" id="ct-sig-h">Firmá con el dedo dentro del recuadro.</span></div></div>
        <label class="per"><input type="checkbox" id="ct-ok"><span class="grow">El titular leyó el contrato y está de acuerdo.</span></label>
        <div class="actions"><button class="btn ghost" type="button" id="ct-back">Volver</button><button class="btn primary" type="button" id="ct-go" disabled>Firmar y guardar</button></div>`;
      const go=$('#ct-go',w),act=()=>{const ok=pad.ok();go.disabled=!(ok&&$('#ct-ok',w).checked&&$('#ct-acl',w).value.trim().length>=3);$('#ct-sig-h',w).textContent=ok?'Firma tomada. Podés borrarla si querés repetirla.':'Firmá con el dedo dentro del recuadro.';};
      pad=sigPad($('#ct-sig',w),act);
      $('#ct-clr',w).addEventListener('click',()=>pad.clear());
      $('#ct-ok',w).addEventListener('change',act);$('#ct-acl',w).addEventListener('input',act);
      $('#ct-back',w).addEventListener('click',paso1);
      go.addEventListener('click',async()=>{
        if(ocupado||go.disabled)return;ocupado=true;go.disabled=true;go.textContent='Guardando…';
        try{
          const r=await NET.api('POST','/api/contrato',{cid,motivo,titular:tit,firma:pad.url(),aclar:$('#ct-acl',w).value.trim(),acepto:true,tver:vista.tver,eq:vista.eq});
          ctGuardar(r.contrato);dataChanged('contratos');paso3(r.contrato);
        }catch(err){
          go.textContent='Firmar y guardar';act();dbError(err);
          if(err&&err.status===409)paso1();
        }finally{ocupado=false;}
      });
    };
    const paso3=k=>{
      w.innerHTML=`<div class="notice ok"><b>Contrato N° ${ctNum(k.num)} firmado y guardado.</b>${k.estado==='revision'?' Quedó en revisión: la oficina lo revisa y, si está todo bien, reemplaza al anterior.':''}${k.prueba?' (De prueba.)':''}</div>
        <div class="hint">Quedó registrado con la fecha, la hora, la firma y un código de verificación. Si el cliente quiere una copia, podés imprimirla o guardarla en PDF.</div>
        <div class="actions"><button class="btn primary" type="button" id="ct-ver">Ver el contrato</button><button class="btn" type="button" id="ct-print">Imprimir o guardar en PDF</button><button class="btn ghost" type="button" id="ct-fin">Terminar</button></div>`;
      $('#ct-ver',w).addEventListener('click',()=>openContrato(k.id,()=>openClient(cid)));
      $('#ct-print',w).addEventListener('click',()=>ctImprimir(k));
      $('#ct-fin',w).addEventListener('click',()=>{closeModal();openClient(cid);});
    };
    paso1();
  }});
}

/* ----- ver un contrato, imprimirlo y (oficina) aprobar, rechazar, borrar ----- */
const CT_PRINT_CSS='@page{size:A4;margin:18mm}body{font-family:Georgia,"Times New Roman",serif;color:#000;font-size:12.5pt;line-height:1.45}.ct-doc{white-space:pre-wrap}.ct-firma{display:flex;gap:16px;align-items:flex-end;margin-top:22px;page-break-inside:avoid}.ct-firma img{width:260px;border-bottom:1px solid #000}.ct-meta{margin-top:18px;font-size:9.5pt;color:#333;border-top:1px solid #999;padding-top:8px;word-break:break-all}h1{font-size:14pt}';
function contratoDocHtml(d){
  return `<div class="ct-paper"><div class="ct-doc">${esc(d.texto)}</div>
    <div class="ct-firma"><img class="sig-img" src="${esc(d.firma)}" alt="Firma del titular"><div><b>${esc(d.aclar)}</b><br><span class="small">Firma del titular · ${esc(ctFecha(d.ts))}</span></div></div>
    <div class="ct-meta small">Contrato N° ${ctNum(d.num)} · ${esc(CT_MOTIVO[d.motivo]||'')}${d.prueba?' · DE PRUEBA':''} · firma tomada por ${esc(d.por||'-')} desde el equipo de la empresa<br>Código de verificación: <span class="mono">${esc(d.hash)}</span></div></div>`;
}
function ctImprimir(d){
  const html='<!doctype html><meta charset="utf-8"><title>Contrato de comodato N° '+ctNum(d.num)+'</title>'+contratoDocHtml(d)+'<style>'+CT_PRINT_CSS+'</style>',b=window.YapurApp;
  if(b){
    if(typeof b.printHtml!=='function')return toast('Para imprimir desde el celular instalá la última versión de la app.','bad');
    let r='';try{r=String(b.printHtml(html,'Contrato '+ctNum(d.num))||'');}catch(_){r='No se pudo abrir la impresión.';}
    if(r!=='ok')toast(r||'No se pudo abrir la impresión.','bad');
    return;
  }
  try{
    const f=document.createElement('iframe');f.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0';document.body.appendChild(f);
    const w=f.contentWindow,doc=w.document;doc.open();doc.write(html);doc.close();
    setTimeout(()=>{try{w.focus();w.print();}catch(_){toast('Este navegador no puede imprimir.','bad');}setTimeout(()=>f.remove(),2000);},200);
  }catch(_){toast('Este navegador no puede imprimir.','bad');}
}
function ctAskMotivo(titulo,msg,ok,danger,opcional){
  return new Promise(res=>{
    let done=false;const fin=v=>{if(!done){done=true;res(v);}};
    openModal({title:titulo,html:`<p>${esc(msg)}</p><div class="field"><textarea id="cm-mot" rows="3" maxlength="200" placeholder="${opcional?'Opcional':'Escribí el motivo'}"></textarea></div>
      <div class="actions"><button class="btn ghost" type="button" data-act="no">Cancelar</button><button class="btn ${danger?'danger':'primary'}" type="button" data-act="yes">${esc(ok)}</button></div>`,
      onMount(el){el.addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(!b)return;
        if(b.dataset.act==='yes'){const v=$('#cm-mot',el).value.trim();if(!opcional&&v.length<3)return toast('Escribí el motivo','bad');fin(v);}else fin(null);
        closeModal();});},onClose:()=>fin(null)});
  });
}
async function openContrato(id,back){
  let d;
  try{d=(await NET.api('GET','/api/contrato/'+encodeURIComponent(id))).contrato;}catch(err){return dbError(err);}
  const gest=can('contratosGestion'),cli=S.clientes.get(d.cid);
  const botones=[];
  if(gest&&d.estado==='revision')botones.push('<button class="btn primary" type="button" data-ct="aprobar">Aprobar y archivar el anterior</button>','<button class="btn" type="button" data-ct="rechazar">Rechazar</button>');
  botones.push('<button class="btn" type="button" data-ct="imprimir">Imprimir o guardar en PDF</button>');
  if(gest){
    if(d.estado==='borrado')botones.push('<button class="btn" type="button" data-ct="restaurar">Restaurar</button>');
    else botones.push('<button class="btn danger" type="button" data-ct="borrar">Mandar a la papelera</button>');
    botones.push('<button class="btn ghost" type="button" data-ct="verificar">Verificar integridad</button>');
  }
  const prev=d.prevResumen;
  const logHtml=gest&&d.log&&d.log.length?`<div><h3>Registro</h3><div class="list">${d.log.map(l=>`<div class="item" style="cursor:default"><div><div class="t">${esc(({firmado:'Firmado',aprobado:'Aprobado',rechazado:'Rechazado',archivado:'Archivado',borrado:'Mandado a la papelera',restaurado:'Restaurado',verificado:'Verificado'})[l.acc]||l.acc)}${l.uname?' · '+esc(l.uname):''}</div><div class="s">${esc(ctFecha(l.ts))}${l.det?' · '+esc(l.det):''}</div></div></div>`).join('')}</div></div>`:'';
  openModal({title:'Contrato N° '+ctNum(d.num),wide:true,html:`<div class="tags"><span class="chip ${CT_CLS[d.estado]||''}">${esc(CT_ESTADO[d.estado]||d.estado)}</span><span class="chip info">${esc(CT_MOTIVO[d.motivo]||d.motivo)}</span>${d.prueba?'<span class="chip bad">De prueba</span>':''}</div>
    <dl class="kv"><dt>Cliente</dt><dd>${cli?esc(cli.nombre):'-'}${cli&&cli.codigo?' <span class="muted mono small">#'+esc(cli.codigo)+'</span>':''}</dd><dt>Titular</dt><dd>${esc(d.titular.nombre)}</dd><dt>Firmado</dt><dd>${esc(ctFecha(d.ts))} · la firma la tomó ${esc(d.por||'-')}</dd>${gest&&d.ip?`<dt>Desde</dt><dd class="small">IP ${esc(d.ip)}<br>${esc((d.ua||'').slice(0,120))}</dd>`:''}${prev?`<dt>Reemplaza al</dt><dd>contrato N° ${ctNum(prev.num)}${prev.tit?' ('+esc(prev.tit)+')':''} · ${esc(CT_ESTADO[prev.estado]||prev.estado)} <button class="btn small ghost" type="button" data-ct="prev" data-id="${esc(prev.id)}">Ver</button></dd>`:''}</dl>
    ${d.estado==='revision'&&gest?'<div class="notice info">Este contrato espera tu revisión. Al aprobarlo pasa a ser el vigente y el anterior se archiva (queda guardado, no se borra).</div>':''}
    ${contratoDocHtml(d)}
    <div class="actions start" id="ct-bt">${botones.join('')}</div>${logHtml}
    <div class="actions"><button class="btn ghost" type="button" id="ct-cerrar">${back?'Volver':'Cerrar'}</button></div>`,
  onMount(el){
    const volver=()=>{closeModal();if(back)back();};
    $('#ct-cerrar',el).addEventListener('click',volver);
    el.addEventListener('click',async e=>{
      const b=e.target.closest('[data-ct]');if(!b)return;
      const a=b.dataset.ct;
      if(a==='imprimir')return ctImprimir(d);
      if(a==='prev')return openContrato(b.dataset.id,()=>openContrato(id,back));
      if(a==='verificar'){
        try{const r=await NET.api('POST','/api/contrato/'+id+'/verificar',{});toast(r.ok?'Íntegro: el contrato coincide con su código de verificación':'¡ATENCIÓN! El contenido NO coincide con su código de verificación',r.ok?'':'bad');}catch(err){dbError(err);}
        return;
      }
      if(a==='aprobar')return ctAprobar(d,cli,back);
      let mot='';
      if(a==='rechazar'){mot=await ctAskMotivo('Rechazar el contrato','El contrato queda guardado como rechazado y el anterior sigue vigente. ¿Por qué se rechaza?','Rechazar',true);if(mot===null)return openContrato(id,back);}
      if(a==='borrar'){mot=await ctAskMotivo('Mandar a la papelera','No se borra de verdad: queda en la papelera, la oficina lo puede restaurar y todo queda en el registro. ¿Por qué se manda a la papelera?','Mandar a la papelera',true);if(mot===null)return openContrato(id,back);}
      try{
        const r=await NET.api('POST','/api/contrato/'+id+'/'+a,{motivo:mot});
        ctGuardar(r.contrato);dataChanged('contratos');
        toast(({rechazar:'Contrato rechazado',borrar:'Contrato en la papelera',restaurar:'Contrato restaurado'})[a]||'Listo');
        openContrato(id,back);
      }catch(err){dbError(err);}
    });
  }});
}
async function ctAprobar(d,cli,back){
  const prev=d.prevResumen,cambia=d.motivo==='titularidad'&&cli&&can('editarClientes');
  openModal({title:'Aprobar el contrato',html:`<p>El contrato N° ${ctNum(d.num)} pasa a ser el vigente${prev?' y el N° '+ctNum(prev.num)+' se archiva (queda guardado)':''}.</p>
    ${cambia?`<label class="per"><input type="checkbox" id="ap-cli" checked><span class="grow">Actualizar la ficha del cliente con los datos del nuevo titular: <b>${esc(d.titular.nombre)}</b>, DNI/CUIT ${esc(d.titular.dniTxt||d.titular.dni)}${d.titular.tel?', tel. '+esc(d.titular.tel):''}.</span></label>`:''}
    ${F('Nota (opcional)','ap-nota','<input id="ap-nota" maxlength="200" autocomplete="off" placeholder="Por ejemplo: vi el DNI del nuevo titular">')}
    <div class="actions"><button class="btn ghost" type="button" data-act="no">Cancelar</button><button class="btn primary" type="button" data-act="yes">Aprobar</button></div>`,
  onMount(el){el.addEventListener('click',async e=>{
    const b=e.target.closest('[data-act]');if(!b)return;
    if(b.dataset.act==='no'){closeModal();return openContrato(d.id,back);}
    b.disabled=true;
    try{
      const r=await NET.api('POST','/api/contrato/'+d.id+'/aprobar',{motivo:$('#ap-nota',el).value.trim()});
      ctGuardar(r.contrato);
      if(cambia&&$('#ap-cli',el).checked){
        const patch={nombre:d.titular.nombre,dni:fmtDoc(d.titular.dni)};if(d.titular.tel)patch.tel=d.titular.tel;
        try{await saveClient(cli,patch);}catch(err){dbError(err);}
      }
      await cargarContratos();dataChanged('contratos');
      toast('Contrato aprobado');closeModal();openContrato(d.id,back);
    }catch(err){b.disabled=false;dbError(err);}
  });}});
}

/* ----- panel de la oficina: todos los contratos ----- */
const CTP={tab:'revision',q:'',cid:'',papelera:[]};
async function openContratos(opt){
  if(!can('contratosGestion'))return;
  CTP.cid=(opt&&opt.cid)||'';CTP.tab=CTP.cid?'todos':(opt&&opt.tab)||(ctPend()?'revision':'vigente');CTP.q='';
  openModal({title:CTP.cid?'Contratos del cliente':'Contratos de comodato',wide:true,html:`<div class="seg" id="ctp-seg"></div><input class="search" id="ctp-q" type="search" placeholder="Buscar por cliente, titular o N° de contrato" autocomplete="off" aria-label="Buscar contratos"><div id="ctp-n" class="hint"></div><div class="list" id="ctp-list"></div>`,
  onMount(el){
    const tabs=CTP.cid?[['todos','Todos']]:[['revision','En revisión'],['vigente','Vigentes'],['archivado','Archivados'],['rechazado','Rechazados'],['borrado','Papelera']];
    const dibujar=()=>{
      let rows=CTP.tab==='borrado'?CTP.papelera:[...S.contratos.values()];
      if(CTP.cid)rows=rows.filter(r=>r.cid===CTP.cid);
      if(CTP.tab!=='todos')rows=rows.filter(r=>r.estado===CTP.tab);
      const q=norm(CTP.q).trim();
      if(q)rows=rows.filter(r=>{const c=S.clientes.get(r.cid);return norm([ctNum(r.num),String(r.num),r.tit||'',c?c.nombre:'',c&&c.codigo?c.codigo:''].join(' ')).includes(q);});
      rows.sort((a,b)=>b.num-a.num);
      const cnt=s=>[...S.contratos.values()].filter(r=>r.estado===s&&(!CTP.cid||r.cid===CTP.cid)).length;
      $('#ctp-seg',el).innerHTML=tabs.map(([k,l])=>`<button type="button" data-t="${k}" aria-pressed="${CTP.tab===k}">${l}${k==='revision'||k==='vigente'?' ('+cnt(k)+')':''}</button>`).join('');
      $('#ctp-n',el).textContent=rows.length+(rows.length===1?' contrato':' contratos');
      $('#ctp-list',el).innerHTML=rows.length?rows.slice(0,100).map(r=>{const c=S.clientes.get(r.cid);return `<button class="item" type="button" data-open="${esc(r.id)}"><div><div class="t">N° ${ctNum(r.num)} · ${esc(r.tit||'-')}</div><div class="s">${c?'Cliente: '+esc(c.nombre)+' · ':''}${esc(CT_MOTIVO[r.motivo]||r.motivo)} · ${esc(ctDia(r.ts))}${r.por?' · '+esc(r.por):''}</div></div><div class="side"><span class="chip ${CT_CLS[r.estado]||''}">${esc(CT_ESTADO[r.estado]||r.estado)}</span>${r.prueba?'<span class="chip bad">Prueba</span>':''}</div></button>`;}).join(''):'<div class="empty"><b>No hay contratos acá</b><span>'+(CTP.tab==='revision'?'Cuando un técnico haga firmar un cambio de titularidad o de equipos, aparece en esta lista para que lo revises.':'Probá con otra pestaña o otra búsqueda.')+'</span></div>';
    };
    const cambiar=async t=>{
      CTP.tab=t;
      if(t==='borrado'){try{CTP.papelera=(await NET.api('GET','/api/contratos?papelera=1')).contratos;}catch(err){dbError(err);}}
      dibujar();
    };
    $('#ctp-seg',el).addEventListener('click',e=>{const b=e.target.closest('[data-t]');if(b)cambiar(b.dataset.t);});
    $('#ctp-q',el).addEventListener('input',e=>{CTP.q=e.target.value;dibujar();});
    $('#ctp-list',el).addEventListener('click',e=>{const b=e.target.closest('[data-open]');if(b)openContrato(b.dataset.open,()=>openContratos(opt));});
    cambiar(CTP.tab);
  }});
}

/* ----- Ajustes: el texto del contrato (solo el administrador) ----- */
function ctAjustesCard(){
  return `<div class="card"><h2>Contrato de comodato</h2><p class="muted small">El texto que firman los clientes por los equipos que se les prestan. Mientras sea un borrador, los técnicos no pueden hacer firmar. Una vez firmado, un contrato no cambia nunca (aunque después edites el texto). En «Modelos de equipos» están las ONU, antenas y fuentes que los técnicos eligen de una lista: así solo escriben la MAC.</p>
    <div id="ct-aj-st" class="hint">Mirando el contrato…</div>
    <div class="actions start"><button class="btn primary" type="button" id="ct-aj-edit">Editar el texto del contrato</button><button class="btn" type="button" id="ct-aj-list">Ver los contratos firmados</button><button class="btn" type="button" id="ct-aj-mod">Modelos de equipos</button></div></div>`;
}
async function ctAjustesMount(el){
  const st=$('#ct-aj-st',el);if(!st)return;
  $('#ct-aj-list',el).addEventListener('click',()=>{if(can('contratosGestion'))openContratos();});
  $('#ct-aj-edit',el).addEventListener('click',()=>openContratoPlantilla(()=>ctAjustesMount.estado(el)));
  $('#ct-aj-mod',el).addEventListener('click',openComodatoModelos);
  ctAjustesMount.estado=async el2=>{
    try{const t=await NET.api('GET','/api/contrato/plantilla');st.innerHTML=t.final?`<span class="chip ok">Texto definitivo</span> versión ${t.ver}${t.mod?' · cambiado el '+esc(ctFecha(t.mod))+(t.modPor?' por '+esc(t.modPor):''):''}`:'<span class="chip warn">Borrador</span> Todavía no es el texto definitivo: nadie puede hacer firmar a un cliente.';}
    catch(err){st.textContent='No se pudo leer el contrato.';}
  };
  ctAjustesMount.estado(el);
}
async function openContratoPlantilla(done){
  let t;try{t=await NET.api('GET','/api/contrato/plantilla');}catch(err){return dbError(err);}
  const em=t.empresa||{};
  openModal({title:'Texto del contrato de comodato',wide:true,html:`<form class="form" id="ctpl" novalidate>
    <div class="hint">Escribí o pegá el contrato. Donde va un dato del cliente o de la empresa, tocá el nombre de abajo para insertarlo en el lugar del cursor: se reemplaza solo al firmar. El texto se muestra tal cual lo escribas (sin formato).</div>
    <div class="tags" id="ctpl-vars">${t.vars.map(v=>`<button type="button" class="chip info" data-v="${esc(v)}">{{${esc(v)}}}</button>`).join('')}</div>
    ${t.sugerido&&t.sugerido!==t.texto?'<div class="actions start"><button class="btn small" type="button" id="ctpl-sug">Cargar el texto sugerido (fibra y antena)</button></div>':''}
    <textarea id="ctpl-txt" rows="16" spellcheck="true" style="font-family:Georgia,serif;font-size:14px;line-height:1.5">${esc(t.texto)}</textarea>
    <fieldset class="fgroup" style="border:0;padding:0;margin:0"><legend>Datos de la empresa para el contrato</legend>
    <div class="grid2">${F('Nombre o razón social','ctpl-raz',`<input id="ctpl-raz" value="${esc(em.razon||'')}" maxlength="100" autocomplete="off">`)}${F('CUIT','ctpl-cuit',`<input id="ctpl-cuit" value="${esc(em.cuit||'')}" maxlength="30" autocomplete="off">`)}</div>
    <div class="grid2">${F('Domicilio','ctpl-dom',`<input id="ctpl-dom" value="${esc(em.domicilio||'')}" maxlength="150" autocomplete="off">`)}${F('Quién representa a la empresa','ctpl-rep',`<input id="ctpl-rep" value="${esc(em.rep||'')}" maxlength="120" autocomplete="off">`)}</div>
    ${F('Lugar donde se firma','ctpl-lug',`<input id="ctpl-lug" value="${esc(em.lugar||'')}" maxlength="80" autocomplete="off">`)}</fieldset>
    <label class="per"><input type="checkbox" id="ctpl-fin"${t.final?' checked':''}><span class="grow"><b>Este es el texto definitivo.</b> Recién entonces los técnicos pueden hacer firmar a los clientes. No se puede marcar si todavía dice «BORRADOR» o tiene partes «[COMPLETAR…]».</span></label>
    <div class="actions"><button class="btn ghost" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Guardar</button></div></form>`,
  onMount(el){
    const ta=$('#ctpl-txt',el);
    const sug=$('#ctpl-sug',el);
    /* el texto que viene con el sistema: reemplaza lo que está escrito (hay que tocar dos veces, para no pisarlo sin querer) y no se guarda hasta tocar «Guardar».
       No se usa askConfirm porque abre otra ventana encima y cierra esta */
    if(sug){
      const rotulo=sug.textContent;let armado=false;
      sug.addEventListener('click',()=>{
        if(!armado){armado=true;sug.textContent='Tocá otra vez: reemplaza el texto de arriba (no se guarda hasta «Guardar»)';return;}
        armado=false;sug.textContent=rotulo;
        ta.value=t.sugerido;$('#ctpl-fin',el).checked=!/BORRADOR|\[COMPLETAR/i.test(t.sugerido);ta.scrollTop=0;toast('Texto sugerido cargado: se guarda cuando toques «Guardar»');
      });
    }
    $('#ctpl-vars',el).addEventListener('click',e=>{const b=e.target.closest('[data-v]');if(!b)return;const ins='{{'+b.dataset.v+'}}',s=ta.selectionStart,f=ta.selectionEnd;ta.value=ta.value.slice(0,s)+ins+ta.value.slice(f);ta.focus();ta.selectionStart=ta.selectionEnd=s+ins.length;});
    $('#ctpl',el).addEventListener('submit',async e=>{
      e.preventDefault();const btn=$('button[type=submit]',el);btn.disabled=true;
      try{
        await NET.api('PUT','/api/contrato/plantilla',{texto:ta.value,final:$('#ctpl-fin',el).checked,empresa:{razon:$('#ctpl-raz',el).value,cuit:$('#ctpl-cuit',el).value,domicilio:$('#ctpl-dom',el).value,rep:$('#ctpl-rep',el).value,lugar:$('#ctpl-lug',el).value}});
        toast('Contrato guardado');closeModal();if(done)done();
      }catch(err){btn.disabled=false;dbError(err);}
    });
  }});
}
