/* ===== ubicación de los técnicos en horario laboral =====
   Los técnicos aceptan un aviso y, solo dentro del horario (por defecto de 8 a 20 h), la app manda su posición cada minuto.
   El servidor vuelve a controlar el horario con su reloj y borra todo a los 14 días. Quien tiene el permiso «verTecnicos» la ve en la pestaña Técnicos. */
const UB={st:null,watch:null,queue:[],lastQ:0,sending:false,asked:false,denied:false,nat:false,started:false};
const arNow=()=>{const d=new Date(Date.now()-3*3600e3);return {fecha:d.toISOString().slice(0,10),h:d.getUTCHours()+d.getUTCMinutes()/60};};
const ubDentro=()=>!!UB.st&&arNow().h>=UB.st.desde&&arNow().h<UB.st.hasta;
const hhmm=ts=>new Date(ts).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',hour12:false});
const haceTxt=ts=>{
  const m=Math.max(0,Math.round((Date.now()-ts)/60000));
  if(m<1)return 'recién';if(m<60)return 'hace '+m+' min';
  const h=Math.floor(m/60);return 'hace '+h+' h'+(m%60?' '+(m%60)+' min':'');
};

/* ----- lado del técnico ----- */
function ubicAviso(st){
  return new Promise(res=>{
    let done=false;const fin=v=>{if(!done){done=true;res(v);}};
    openModal({title:'Ubicación en horario laboral',html:`<p>La oficina puede ver dónde estás <b>de ${st.desde} a ${st.hasta} h</b> mientras la app esté abierta o activa en tu celular.</p>
      <ul class="plain"><li>Fuera de ese horario no se toma ni se guarda nada.</li><li>Solo la ven el administrador y quien él habilite.</li><li>Se borra a los ${st.dias} días.</li><li>El celular te va a pedir el permiso de ubicación: elegí «Mientras se usa la app».</li></ul>
      <div class="actions"><button class="btn ghost" type="button" data-act="no">Ahora no</button><button class="btn primary" type="button" data-act="si">Entendido, aceptar</button></div>`,
      onMount(el){el.addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(!b)return;fin(b.dataset.act==='si');closeModal();});},
      onClose:()=>fin(false)});
  });
}
function ubicChip(){
  let c=$('#ubChip');
  if(!UB.st||!UB.st.aplica||!UB.st.acepto||S.realRole!=='tecnico'||S.preview){if(c)c.remove();return;}
  if(!c){c=document.createElement('span');c.id='ubChip';const rc=$('#roleChip');if(!rc||!rc.parentNode)return;rc.parentNode.insertBefore(c,rc);}
  const dentro=ubDentro();
  c.className='chip '+(UB.denied?'bad':dentro?'ok':'quiet');
  c.textContent=UB.denied?'Ubicación sin permiso':dentro?'Ubicación activa':'Ubicación fuera de horario';
  c.title=UB.denied?'Activá el permiso de ubicación de la app en el celular.':`Se comparte con la oficina de ${UB.st.desde} a ${UB.st.hasta} h.`;
}
async function ubicFlush(){
  if(UB.sending||!UB.queue.length||!NET.online)return;
  UB.sending=true;const pts=UB.queue.slice(0,30);
  try{
    await NET.api('POST','/api/ubicacion',{pts},{noKick:true,timeout:20000});
    UB.queue.splice(0,pts.length);
  }catch(e){
    if(e&&e.status===409){UB.st.acepto=false;ubicStop();}
    else if(e&&e.status===403)UB.queue.length=0;
  }
  UB.sending=false;
}
function ubicWatch(){
  if(UB.watch!=null||UB.denied||!navigator.geolocation)return;
  UB.watch=navigator.geolocation.watchPosition(p=>{
    const now=Date.now();if(now-UB.lastQ<45e3)return;   /* un punto por minuto alcanza */
    UB.lastQ=now;
    UB.queue.push({lat:p.coords.latitude,lng:p.coords.longitude,acc:p.coords.accuracy,ts:p.timestamp||now});
    if(UB.queue.length>60)UB.queue.shift();
    ubicFlush();
  },e=>{
    if(e&&e.code===1){UB.denied=true;if(UB.watch!=null)navigator.geolocation.clearWatch(UB.watch);UB.watch=null;toast('Activá el permiso de ubicación de la app para compartirla con la oficina','bad');ubicChip();}
  },{enableHighAccuracy:true,maximumAge:20000,timeout:60000});
}
function ubicStop(){
  if(UB.watch!=null&&navigator.geolocation)navigator.geolocation.clearWatch(UB.watch);
  UB.watch=null;
  const b=window.YapurApp;if(UB.nat&&b&&typeof b.stopLocation==='function'){try{b.stopLocation();}catch(e){}}
  UB.nat=false;
}
function ubicLoop(){
  if(!UB.st||!UB.st.acepto||UB.denied&&!UB.nat){ubicChip();return;}
  if(ubDentro()){
    const b=window.YapurApp;
    if(b&&typeof b.startLocation==='function'){   /* en el APK, un servicio sigue enviando con la pantalla apagada */
      try{UB.nat=String(b.startLocation(NET.token,UB.st.desde,UB.st.hasta)||'')==='ok';}catch(e){UB.nat=false;}
    }
    if(!UB.nat)ubicWatch();
    ubicFlush();
  }else ubicStop();
  ubicChip();
}
async function ubicInit(){
  if(S.realRole!=='tecnico'||S.preview||!NET.token||UB.started)return;
  UB.started=true;
  try{UB.st=await NET.api('GET','/api/ubicacion/estado',undefined,{noKick:true,timeout:15000});}catch(e){UB.started=false;return;}
  if(!UB.st.aplica)return;
  if(!UB.st.acepto){
    if(UB.asked)return;UB.asked=true;
    if(!await ubicAviso(UB.st))return;
    try{UB.st=await NET.api('POST','/api/ubicacion/acepto',{});}catch(e){toast('No se pudo guardar tu respuesta. Probá de nuevo más tarde.','bad');return;}
  }
  ubicLoop();
  setInterval(ubicLoop,60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)ubicLoop();});
}

/* ----- lado de quien mira: pestaña Técnicos ----- */
const TU={dia:'',data:null,err:'',busy:false,timer:null};
const mapaUrl=(lat,lng)=>'https://www.google.com/maps/search/?api=1&query='+lat+','+lng;
/* recorrido aproximado: primer punto, hasta 8 intermedios repartidos parejo y el último */
function rutaUrl(ruta){
  if(!ruta||ruta.length<2)return '';
  const pt=r=>r[1]+','+r[2],mid=[],n=Math.min(8,ruta.length-2);
  for(let i=1;i<=n;i++)mid.push(pt(ruta[Math.round(i*(ruta.length-1)/(n+1))]));
  return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&origin='+pt(ruta[0])+'&destination='+pt(ruta[ruta.length-1])+(mid.length?'&waypoints='+encodeURIComponent(mid.join('|')):'');
}
function tecCard(t,d){
  const esHoy=d.dia===d.hoy,u=t.ultima;
  let chip;
  if(!t.acepto)chip='<span class="chip quiet">Todavía no aceptó el aviso</span>';
  else if(!u)chip='<span class="chip quiet">Sin ubicación '+(esHoy?'hoy':'ese día')+'</span>';
  else if(!esHoy)chip='<span class="chip quiet">'+t.puntos+' '+(t.puntos===1?'punto':'puntos')+'</span>';
  else{const m=(d.ahora-u.ts)/60000;chip=`<span class="chip ${m<=10?'ok':m<=60?'warn':'bad'}">${m<=10?'En línea · ':'Visto '}${esc(haceTxt(u.ts))}</span>`;}
  const detalle=u?`${esHoy?'Última vez':'Último punto'} a las ${hhmm(u.ts)}${hasNum(u.acc)?' · precisión ±'+Math.round(u.acc)+' m':''}${t.ruta.length>1?` · de ${hhmm(t.ruta[0][0])} a ${hhmm(t.ruta[t.ruta.length-1][0])}`:''}`:(t.acepto&&esHoy?'Todavía no mandó su posición: tiene que abrir la app en el celular.':'');
  const ruta=rutaUrl(t.ruta);
  return `<article class="card tcard"><div class="head-row"><h3 style="overflow-wrap:anywhere">${esc(t.nombre)}</h3>${chip}</div>
    ${detalle?`<div class="small muted">${esc(detalle)}</div>`:''}
    <div class="actions start">${u?`<a class="btn small primary" href="${mapaUrl(u.lat,u.lng)}" target="_blank" rel="noopener">Ver en el mapa</a>`:''}${ruta?`<a class="btn small" href="${ruta}" target="_blank" rel="noopener">Recorrido del día</a>`:''}${t.tel&&can('telefono')?`<a class="btn small ghost" href="${waUrl(t.tel,'')}" target="_blank" rel="noopener">WhatsApp</a>`:''}</div></article>`;
}
function tecRender(){
  const out=$('#tu-out');if(!out)return;
  const d=TU.data;
  if(!d){out.innerHTML=TU.err?`<div class="notice bad">${esc(TU.err)}</div>`:'<div class="hint">Cargando…</div>';return;}
  const hz=d.horario;
  $('#tu-horario').textContent=`Se comparte de ${hz.desde} a ${hz.hasta} h y se borra a los ${d.dias} días.`;
  const dia=$('#tu-dia');if(dia&&dia.value!==d.dia)dia.value=d.dia;
  const list=[...d.tecnicos].sort((a,b)=>((b.ultima?b.ultima.ts:0)-(a.ultima?a.ultima.ts:0))||a.nombre.localeCompare(b.nombre));
  out.innerHTML=list.length?`<div class="plans">${list.map(t=>tecCard(t,d)).join('')}</div>`:'<div class="empty"><b>No hay técnicos cargados</b><span>Los técnicos son los usuarios de tipo «Técnico»: se crean en Ajustes.</span></div>';
}
async function tecCargar(){
  if(TU.busy)return;TU.busy=true;
  try{TU.data=await NET.api('GET','/api/ubicaciones'+(TU.dia?'?dia='+encodeURIComponent(TU.dia):''),undefined,{noKick:true,timeout:20000});TU.err='';if(!TU.dia)TU.dia=TU.data.dia;}
  catch(e){TU.err=e&&e.message||'No se pudo cargar la ubicación de los técnicos.';}
  TU.busy=false;tecRender();
}
function openHorarioUbic(){
  const hz=(TU.data&&TU.data.horario)||{desde:8,hasta:20};
  openModal({title:'Horario de la ubicación',html:`<form class="form" id="hz-form" novalidate><div class="hint">Fuera de este horario el servidor no guarda nada, aunque el celular lo mande.</div>
    <div class="grid2">${F('Desde (hora)','hz-d',`<input id="hz-d" type="number" min="0" max="23" step="1" inputmode="numeric" value="${hz.desde}">`)}${F('Hasta (hora)','hz-h',`<input id="hz-h" type="number" min="1" max="24" step="1" inputmode="numeric" value="${hz.hasta}">`)}</div>
    <div class="actions"><button class="btn ghost" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Guardar horario</button></div></form>`,
    onMount(el){$('#hz-form',el).addEventListener('submit',async e=>{
      e.preventDefault();const desde=Number($('#hz-d',el).value),hasta=Number($('#hz-h',el).value);
      if(!Number.isInteger(desde)||!Number.isInteger(hasta)||desde<0||hasta>24||desde>=hasta)return toast('«Desde» tiene que ser menor que «hasta» (de 0 a 24)','bad');
      try{await NET.api('POST','/api/ubicacion/horario',{desde,hasta});toast('Horario guardado');closeModal();tecCargar();}catch(err){toast(err.message||'No se pudo guardar','bad');}
    });}});
}
VIEWS.tecnicos={
  mount(el){
    el.innerHTML=`<div class="head-row"><h2>Técnicos</h2><button class="btn small" type="button" id="tu-act">Actualizar</button></div>
      <p class="muted small" id="tu-horario"></p>
      <div class="toolbar"><div class="line"><input id="tu-dia" type="date" aria-label="Día" style="width:auto">${isAdmin()?'<button class="btn small ghost" type="button" id="tu-hz">Cambiar el horario</button>':''}</div></div>
      <div id="tu-out"></div>
      <p class="muted small">La ubicación se toma solo en el horario indicado, mientras la app del técnico esté abierta o activa. Cada técnico acepta un aviso antes de empezar.</p>`;
    $('#tu-act',el).addEventListener('click',()=>tecCargar());
    $('#tu-dia',el).addEventListener('change',e=>{TU.dia=e.target.value;TU.data=null;tecRender();tecCargar();});
    const hz=$('#tu-hz',el);if(hz)hz.addEventListener('click',openHorarioUbic);
    clearInterval(TU.timer);
    TU.timer=setInterval(()=>{if(S.tab==='tecnicos'&&!document.hidden&&TU.data&&TU.dia===TU.data.hoy)tecCargar();},60000);
    TU.dia='';TU.data=null;tecRender();tecCargar();
  },
  update(){tecRender();}
};
