/* ===== ubicación de los técnicos en horario laboral =====
   Los técnicos aceptan un aviso y, solo dentro del horario (por defecto de 8 a 20 h), la app manda su posición cada minuto.
   El servidor vuelve a controlar el horario con su reloj y borra todo a los 14 días. Quien tiene el permiso «verTecnicos» la ve en la pestaña Técnicos. */
const UB={st:null,stTs:0,watch:null,queue:[],lastQ:0,sending:false,asked:false,denied:false,nat:false,started:false,refr:false};
const arNow=()=>{const d=new Date(Date.now()-3*3600e3);return {fecha:d.toISOString().slice(0,10),h:d.getUTCHours()+d.getUTCMinutes()/60};};
/* tramos del día: [[8,20]] de corrido, o [[8,13],[17,22]] en un día cortado (con siesta). Los datos viejos traen solo desde/hasta. */
const stTramos=s=>!s?[]:(s.tramos&&s.tramos.length?s.tramos:[[s.desde,s.hasta]]);
const trTxt=tr=>tr.map(t=>t[0]+' a '+t[1]).join(' y de ');   /* «8 a 13 y de 17 a 22»: se usa como «de … h» */
const ubDentro=()=>{const h=arNow().h;return stTramos(UB.st).some(t=>h>=t[0]&&h<t[1]);};
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
    openModal({title:'Ubicación en horario laboral',html:`<p>La oficina puede ver dónde estás <b>hoy de ${trTxt(stTramos(st))} h</b> mientras la app esté abierta o activa en tu celular. Hay días de corrido y días con siesta: la app toma sola el horario de cada día.</p>
      <ul class="plain"><li>Fuera de ese horario no se toma ni se guarda nada.</li><li>Solo la ven el administrador y quien él habilite.</li><li>Se borra a los ${st.dias} días.</li><li>El celular te va a pedir el permiso de ubicación: elegí «Mientras se usa la app».</li><li>En la app instalada vas a ver una notificación fija «ubicación activa» mientras se comparte.</li><li>En la app instalada, el celular te va a preguntar si la dejás «sin restricción de batería»: aceptá, así no se corta cuando apagás la pantalla.</li></ul>
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
  c.title=UB.denied?'Activá el permiso de ubicación de la app en el celular.':`Se comparte con la oficina de ${trTxt(stTramos(UB.st))} h.`;
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
/* el horario cambia de un día a otro (y la oficina puede cambiarlo): se vuelve a pedir al empezar el día y cada 10 minutos */
async function ubicRefrescar(){
  if(!UB.st||UB.refr||(Date.now()-UB.stTs<600e3&&UB.st.fecha===arNow().fecha))return;
  UB.refr=true;
  try{UB.st=await NET.api('GET','/api/ubicacion/estado',undefined,{noKick:true,timeout:15000});UB.stTs=Date.now();}catch(e){/* sin conexión: queda el último horario conocido */}
  UB.refr=false;
}
function ubicLoop(){
  if(!UB.st||!UB.st.acepto||UB.denied&&!UB.nat){ubicChip();return;}
  const b=window.YapurApp,tr=stTramos(UB.st);
  if(ubDentro()){
    if(b&&typeof b.startLocation==='function'){   /* en el APK, un servicio sigue enviando con la pantalla apagada */
      try{
        UB.nat=String((typeof b.startLocationTramos==='function'
          ?b.startLocationTramos(NET.token,tr.map(t=>t[0]+'-'+t[1]).join(','))
          :b.startLocation(NET.token,tr[0][0],tr[tr.length-1][1]))||'')==='ok';
      }catch(e){UB.nat=false;}
    }
    if(UB.nat){if(UB.watch!=null&&navigator.geolocation)navigator.geolocation.clearWatch(UB.watch);UB.watch=null;}   /* ya manda el servicio: que no mande también la página */
    else ubicWatch();
    ubicFlush();
  }else{
    /* en la siesta el servicio de la APK nueva queda en pausa solo (sin tomar posiciones) y retoma a la hora; no hay que pararlo */
    const siesta=UB.nat&&b&&typeof b.startLocationTramos==='function'&&tr.length>1&&arNow().h<tr[tr.length-1][1];
    if(!siesta)ubicStop();
  }
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
  UB.stTs=Date.now();
  ubicLoop();
  const tick=()=>ubicRefrescar().then(ubicLoop,ubicLoop);
  setInterval(tick,60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();});
}

/* ----- jornada, lado del técnico: ingreso y fin del día, anotados solos al llegar y al volver a la base ----- */
const JR={st:null,busy:false,started:false,visto:''};
const jrVisto=dia=>{try{return localStorage.getItem('yapur_jr_visto')===dia;}catch(e){return JR.visto===dia;}};
const jrMarcar=dia=>{JR.visto=dia;try{localStorage.setItem('yapur_jr_visto',dia);}catch(e){}};
const jrAplica=()=>S.realRole==='tecnico'&&!S.preview&&!!NET.token;
function jornadaBarra(){
  const bar=$('#jrBar');if(!bar)return;
  const st=JR.st;
  if(!jrAplica()||!st||!st.aplica){bar.hidden=true;return;}
  const f=st.fila,h=arNow().h,tr2=stTramos(st.horario);
  let cls='',html;
  if(!st.hayBase&&!f){bar.hidden=true;return;}   /* mientras la oficina no cargue la base, la jornada está apagada */
  if(!st.enterado){
    cls='warn';html=`<span>Desde ahora se anota tu jornada: el <b>ingreso</b> cuando tu celular llega a la base y el <b>fin</b> cuando volvés a guardar el vehículo.</span><span class="jr-btns"><button class="btn small ghost" type="button" id="jr-info">Más info</button><button class="btn small" type="button" id="jr-ok">Entendido</button></span>`;
  }else if(!f){
    const tr=stTramos(st.horario);
    if(h<tr[0][0]-1||h>=tr[tr.length-1][1]){bar.hidden=true;return;}
    cls='warn';html=`<span>Todavía no empezó tu jornada.${st.hayBase?' Se anota sola cuando tu celular llega a la base.':''}</span><button class="btn small" type="button" id="jr-ini">Iniciar jornada</button>`;
  }else if(tr2.length>1&&h>=tr2[0][1]&&h<tr2[1][0]){
    cls='quiet';html=`<span>Tu mañana${f.regreso&&f.enBase?' terminó a las <b>'+hhmm(f.regreso)+'</b> al volver a la base':' terminó'}. Retomás a las <b>${tr2[1][0]}</b> h.</span>`;
  }else if(f.regreso&&f.enBase&&!(f.ingreso2&&f.regreso<f.ingreso2)){
    cls='quiet';html=`<span>Tu jornada comenzó a las <b>${hhmm(f.ingreso)}</b>${f.ingreso2?', retomaste a las <b>'+hhmm(f.ingreso2)+'</b>':''} y terminó a las <b>${hhmm(f.regreso)}</b> al volver a la base${tr2.length>1?'':' ('+esc(durTxt((f.regreso-f.ingreso)/60000))+')'}.</span>`;
  }else{
    html=`<span>Tu jornada laboral comenzó a las <b>${hhmm(f.ingreso)}</b>${f.origen==='base'?' · en la base':''}${f.ingreso2?' · retomaste a las <b>'+hhmm(f.ingreso2)+'</b>':''}.</span>`;
  }
  bar.className='jrbar'+(cls?' '+cls:'');bar.innerHTML=html;bar.hidden=false;
  const b=$('#jr-ini',bar);if(b)b.addEventListener('click',jornadaIniciar);
  const ok=$('#jr-ok',bar),inf=$('#jr-info',bar);
  if(ok)ok.addEventListener('click',jornadaEntendido);
  if(inf)inf.addEventListener('click',jornadaAviso);
}
async function jornadaEntendido(){
  try{JR.st=await NET.api('POST','/api/jornada/acepto',{});}catch(err){toast(err&&err.message||'No se pudo guardar. Probá de nuevo.','bad');return;}
  closeModal();jornadaBarra();
}
/* mejor posición de los próximos 8 segundos, o nada si el celular no la da: iniciar la jornada no debe trabarse por el GPS */
async function jornadaPos(){
  try{
    const run=gpsStart(()=>{}),tm=setTimeout(()=>run.stop(),8000);
    try{const r=await run.promise;return {lat:r.lat,lng:r.lng,acc:Math.round(r.acc)};}finally{clearTimeout(tm);}
  }catch(e){return null;}
}
async function jornadaIniciar(){
  const b=$('#jr-ini');if(b){b.disabled=true;b.textContent='Buscando señal…';}
  const pos=await jornadaPos();
  try{JR.st=await NET.api('POST','/api/jornada/ingreso',pos||{},{timeout:20000});if(JR.st.fila)jrMarcar(JR.st.dia);toast('Jornada iniciada a las '+(JR.st.fila?hhmm(JR.st.fila.ingreso):''));}
  catch(e){toast(e&&e.message||'No se pudo iniciar la jornada','bad');}
  jornadaBarra();
}
function jornadaAviso(){
  openModal({title:'Control de jornada',html:`<p>La oficina registra a qué hora empezás y a qué hora terminás el día, con la ubicación del celular:</p>
    <ul class="plain"><li><b>Ingreso:</b> la primera vez que tu celular, con la app abierta, aparece en la base.</li><li><b>Fin:</b> la última vez que volvés a la base a guardar el vehículo.</li><li>Si empezás sin pasar por la base, tocá «Iniciar jornada» en la barra de arriba.</li><li>Ves tus horas en esa misma barra.</li><li>Este registro guarda solo las horas y la distancia a la base, durante 90 días.</li></ul>
    <div class="actions"><button class="btn primary" type="button" id="jr-ok2">Entendido</button></div>`,
    onMount(el){$('#jr-ok2',el).addEventListener('click',jornadaEntendido);}});
}
async function jornadaCargar(){
  if(!jrAplica()||JR.busy)return;JR.busy=true;
  try{
    JR.st=await NET.api('GET','/api/jornada',undefined,{noKick:true,timeout:15000});
    if(JR.st.aplica&&JR.st.enterado&&JR.st.fila&&!jrVisto(JR.st.dia)){jrMarcar(JR.st.dia);toast('Tu jornada laboral comenzó a las '+hhmm(JR.st.fila.ingreso));}
  }catch(e){/* sin conexión: la barra queda como estaba */}
  JR.busy=false;jornadaBarra();
}
function jornadaInit(){
  if(JR.started||!jrAplica())return;JR.started=true;
  jornadaCargar();
  setInterval(()=>{if(!document.hidden)jornadaCargar();},60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)jornadaCargar();});
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
const durTxt=m=>{m=Math.max(1,Math.round(m));if(m<60)return m+' min';const h=Math.floor(m/60);return h+' h'+(m%60?' '+(m%60)+' min':'');};
/* mensaje para que el técnico vuelva a abrir la app; sale del WhatsApp de la oficina */
function tecAvisoUrl(t){
  const nom=String(t.nombre||'').split(' ')[0];
  const txt=t.estado==='sin_datos'
    ?`Hola ${nom}, la oficina todavía no recibe tu ubicación de hoy. Abrí la app YAPUR Gestión y dejala abierta, por favor.`
    :`Hola ${nom}, la oficina no recibe tu ubicación desde las ${hhmm(t.ultima.ts)}. Abrí la app YAPUR Gestión y fijate que el celular tenga datos y la ubicación activada.`;
  return waUrl(t.tel,txt);
}
const tecProblema=t=>t.estado==='sin_senal'||t.estado==='sin_datos';
const tecSinIngreso=(t,d)=>d.dia===d.hoy&&!!t.jornada&&t.jornada.estado==='sin_ingreso';
const tecSinRetomar=(t,d)=>d.dia===d.hoy&&!!t.jornada&&!!t.jornada.sinRetomar;
/* ingreso y fin del día de un técnico: salen solos de si el celular estuvo en la base */
function jornadaTec(t,d){
  const j=t.jornada;if(!j)return '';
  const esHoy=d.dia===d.hoy,chips=[],notas=[];
  const ch=(c,txt)=>chips.push(`<span class="chip ${c}">${esc(txt)}</span>`);
  if(j.ingreso){
    ch(j.tarde?'warn':'ok','Ingresó '+hhmm(j.ingreso)+(j.tarde?' · '+durTxt(j.atrasoMin)+' tarde':''));
    notas.push(j.origen==='base'?'Ingresó en la base':'Inició a mano'+(hasNum(j.dist)?', a '+fmtDist(j.dist)+' de la base':''));
    if(j.estado==='siesta')ch('quiet','En siesta'+(j.regreso&&j.enBase?' · volvió a la base a las '+hhmm(j.regreso):''));
    else if(j.estado==='termino')ch('quiet','Terminó '+hhmm(j.regreso)+(j.cortado?'':' · jornada de '+durTxt((j.regreso-j.ingreso)/60000)));
    else if(j.estado==='sin_cierre')ch('warn',j.regreso?'Último regreso a la base '+hhmm(j.regreso)+', después no volvió':'No volvió a la base');
    else ch('quiet',j.enBase?'En la base':'Fuera de la base');
    if(j.ingreso2)ch(j.tarde2?'warn':'ok','Retomó '+hhmm(j.ingreso2)+(j.tarde2?' · '+durTxt(j.atraso2Min)+' tarde':''));
    else if(j.sinRetomar)ch('bad','No retomó a la tarde');
  }else if(j.estado==='sin_ingreso')ch('bad','Sin ingreso');
  else if(j.estado==='esperando'&&esHoy)ch('quiet','Todavía no ingresó');
  if(esHoy&&!j.enterado&&j.estado!=='no_laborable')notas.push('Todavía no tocó «Entendido» en el aviso de jornada');
  if(!chips.length)return '';
  return `<div class="tjor">${chips.join('')}</div>${notas.length?`<div class="small muted">${esc(notas.join(' · '))}</div>`:''}`;
}
function tecCard(t,d){
  const esHoy=d.dia===d.hoy,u=t.ultima,e=t.estado,m=u?(d.ahora-u.ts)/60000:0;
  let chip;
  if(e==='sin_aceptar')chip='<span class="chip quiet">Todavía no aceptó el aviso</span>';
  else if(e==='sin_datos')chip='<span class="chip warn">Todavía no mandó su posición</span>';
  else if(e==='en_linea')chip=`<span class="chip ok">En línea · ${esc(haceTxt(u.ts))}</span>`;
  else if(e==='sin_senal')chip=`<span class="chip ${m<=60?'warn':'bad'}">Sin señal · ${esc(haceTxt(u.ts))}</span>`;
  else if(e==='fuera_horario')chip=`<span class="chip quiet">Fuera de horario${u?' · visto '+esc(haceTxt(u.ts)):''}</span>`;
  else chip=u?'<span class="chip quiet">'+t.puntos+' '+(t.puntos===1?'punto':'puntos')+'</span>':'<span class="chip quiet">Sin ubicación ese día</span>';
  const detalle=u?`${esHoy?'Última vez':'Último punto'} a las ${hhmm(u.ts)}${hasNum(u.acc)?' · precisión ±'+Math.round(u.acc)+' m':''}${t.ruta.length>1?` · de ${hhmm(t.ruta[0][0])} a ${hhmm(t.ruta[t.ruta.length-1][0])}`:''}`:(e==='sin_datos'?'Todavía no mandó su posición: tiene que abrir la app en el celular.':'');
  const hu=t.huecos||[];
  const huHTML=hu.length?`<details class="small tec-hu"><summary>Sin señal ${esc(durTxt(t.sinSenalMin))} en ${hu.length} ${hu.length===1?'tramo':'tramos'}</summary><ul class="plain">${hu.map(g=>`<li>${hhmm(g.desde)} a ${hhmm(g.hasta)} · ${durTxt((g.hasta-g.desde)/60000)}${g.inicio?' (antes de su primera posición)':''}${g.sigue?' (sigue sin señal)':''}</li>`).join('')}</ul></details>`:'';
  const ruta=rutaUrl(t.ruta),aviso=tecProblema(t)&&t.tel&&can('telefono');
  return `<article class="card tcard"><div class="head-row"><h3 style="overflow-wrap:anywhere">${esc(t.nombre)}</h3>${chip}</div>
    ${jornadaTec(t,d)}${detalle?`<div class="small muted">${esc(detalle)}</div>`:''}${huHTML}
    <div class="actions start">${aviso?`<a class="btn small primary" href="${tecAvisoUrl(t)}" target="_blank" rel="noopener">Avisarle por WhatsApp</a>`:''}${u?`<a class="btn small${aviso?'':' primary'}" href="${mapaUrl(u.lat,u.lng)}" target="_blank" rel="noopener">Ver en el mapa</a>`:''}${ruta?`<a class="btn small" href="${ruta}" target="_blank" rel="noopener">Recorrido del día</a>`:''}${!aviso&&t.tel&&can('telefono')?`<a class="btn small ghost" href="${waUrl(t.tel,'')}" target="_blank" rel="noopener">WhatsApp</a>`:''}</div></article>`;
}
function tecRender(){
  const out=$('#tu-out');if(!out)return;
  const d=TU.data;
  if(!d){out.innerHTML=TU.err?`<div class="notice bad">${esc(TU.err)}</div>`:'<div class="hint">Cargando…</div>';return;}
  const hz=d.horario;
  const tr=stTramos(hz);
  $('#tu-horario').textContent=`${d.dia===d.hoy?'Hoy':'Ese día'} ${tr.length>1?'es cortado (con siesta): ':'es de corrido: '}se comparte de ${trTxt(tr)} h. Se borra a los ${d.dias} días.`;
  const dia=$('#tu-dia');if(dia&&dia.value!==d.dia)dia.value=d.dia;
  const atn=t=>tecProblema(t)||tecSinIngreso(t,d)||tecSinRetomar(t,d);
  const list=[...d.tecnicos].sort((a,b)=>(atn(b)-atn(a))||((b.ultima?b.ultima.ts:0)-(a.ultima?a.ultima.ts:0))||a.nombre.localeCompare(b.nombre));
  const sin=list.filter(tecProblema);
  const banner=sin.length?`<div class="notice" role="status" id="tu-alerta" style="margin-bottom:12px"><b>${sin.length===1?'1 técnico sin señal':sin.length+' técnicos sin señal'}:</b> ${sin.map(t=>esc(t.nombre)+(t.ultima?' ('+esc(haceTxt(t.ultima.ts))+')':' (no mandó nada hoy)')).join(', ')}.</div>`:'';
  const sinIng=list.filter(t=>tecSinIngreso(t,d));
  const bannerIng=sinIng.length?`<div class="notice bad" role="status" id="tu-ingreso" style="margin-bottom:12px"><b>Sin ingreso hoy:</b> ${sinIng.map(t=>esc(t.nombre)).join(', ')}.</div>`:'';
  const sinRet=list.filter(t=>tecSinRetomar(t,d));
  const bannerRet=sinRet.length?`<div class="notice bad" role="status" id="tu-retoma" style="margin-bottom:12px"><b>Sin retomar a la tarde:</b> ${sinRet.map(t=>esc(t.nombre)).join(', ')}.</div>`:'';
  const jc=d.jornada||{tol:10,radio:40,base:null,dias:[1,2,3,4,5,6]},DN=['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  const jb=$('#tu-base');
  if(jb)jb.textContent=`Jornada: se espera el ingreso a las ${tr[0][0]}:00${tr.length>1?' y la retoma a las '+tr[1][0]+':00':''}, con ${jc.tol} min de tolerancia, ${jc.dias.length?'de '+[1,2,3,4,5,6,0].filter(x=>jc.dias.includes(x)).map(x=>DN[x]).join(', '):'ningún día'}. ${jc.base?'Base cargada (radio '+jc.radio+' m): el ingreso y el fin salen solos.':'Todavía sin base: el control de jornada está apagado. Cargala con «Base y jornada».'}`;
  out.innerHTML=list.length?`${bannerIng}${bannerRet}${banner}<div class="plans">${list.map(t=>tecCard(t,d)).join('')}</div>`:'<div class="empty"><b>No hay técnicos cargados</b><span>Los técnicos son los usuarios de tipo «Técnico»: se crean en Ajustes.</span></div>';
}
async function tecCargar(){
  if(TU.busy)return;TU.busy=true;
  try{TU.data=await NET.api('GET','/api/ubicaciones'+(TU.dia?'?dia='+encodeURIComponent(TU.dia):''),undefined,{noKick:true,timeout:20000});TU.err='';if(!TU.dia)TU.dia=TU.data.dia;}
  catch(e){TU.err=e&&e.message||'No se pudo cargar la ubicación de los técnicos.';}
  TU.busy=false;tecRender();
}
/* Horario de la ubicación y de la jornada: de corrido (un tramo) o cortado (mañana y tarde, con siesta), qué días es cada uno y días puntuales */
const HZ_DIAS=[[1,'Lunes'],[2,'Martes'],[3,'Miércoles'],[4,'Jueves'],[5,'Viernes'],[6,'Sábado'],[0,'Domingo']];
function planDe(){
  const pl=(TU.data&&TU.data.plan)||null,hz=(TU.data&&TU.data.horario)||{desde:8,hasta:20};
  return pl||{corrido:{desde:hz.desde,hasta:hz.hasta},cortado:null,dias:{0:'corrido',1:'corrido',2:'corrido',3:'corrido',4:'corrido',5:'corrido',6:'corrido'},fechas:{}};
}
async function guardarPlan(pl){
  return NET.api('POST','/api/ubicacion/plan',{desde:pl.corrido.desde,hasta:pl.corrido.hasta,cortado:pl.cortado,dias:pl.dias,fechas:pl.fechas});
}
function openHorarioUbic(){
  const pl=planDe(),cor=pl.cortado||{m:[8,13],t:[17,22]},fechas=Object.assign({},pl.fechas),hoy=(TU.data&&TU.data.hoy)||arNow().fecha;
  const num=(id,v,mn,mx)=>`<input id="${id}" type="number" min="${mn}" max="${mx}" step="1" inputmode="numeric" value="${v}">`;
  openModal({title:'Horario de la ubicación',html:`<form class="form" id="hz-form" novalidate><div class="hint">Fuera de estos horarios el servidor no guarda nada, aunque el celular lo mande. El ingreso esperado es el «desde» del primer tramo del día.</div>
    <div class="field"><label>De corrido (un solo tramo)</label><div class="grid2">${F('Desde (hora)','hz-d',num('hz-d',pl.corrido.desde,0,23))}${F('Hasta (hora)','hz-h',num('hz-h',pl.corrido.hasta,1,24))}</div></div>
    <div class="field"><label><input type="checkbox" id="hz-c"${pl.cortado?' checked':''}> También hay días con horario cortado (siesta)</label></div>
    <div id="hz-cbox"${pl.cortado?'':' hidden'}>
      <div class="grid2">${F('Mañana desde','hz-m0',num('hz-m0',cor.m[0],0,23))}${F('Mañana hasta','hz-m1',num('hz-m1',cor.m[1],1,24))}</div>
      <div class="grid2">${F('Tarde desde','hz-t0',num('hz-t0',cor.t[0],0,23))}${F('Tarde hasta','hz-t1',num('hz-t1',cor.t[1],1,24))}</div>
      <div class="field"><label>Qué días se trabaja cortado</label><div class="dias">${HZ_DIAS.map(([n,l])=>`<label><input type="checkbox" data-dc="${n}"${pl.dias[n]==='cortado'?' checked':''}>${l}</label>`).join('')}</div></div>
      <div class="field"><label>Un día puntual (por ejemplo, un día de mucho calor)</label>
        <div class="grid2"><input id="hz-fd" type="date" aria-label="Día puntual" value="${hoy}"><select id="hz-fm" aria-label="Horario ese día"><option value="cortado">Cortado</option><option value="corrido">De corrido</option></select></div>
        <div class="actions start"><button class="btn small" type="button" id="hz-fa">Agregar ese día</button></div>
        <ul class="plain" id="hz-fl"></ul></div>
    </div>
    <div class="actions"><button class="btn ghost" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Guardar horario</button></div></form>`,
    onMount(el){
      const caja=$('#hz-cbox',el),lista=$('#hz-fl',el),fmtF=f=>f.split('-').reverse().join('/');
      const pintar=()=>{
        const fs=Object.keys(fechas).filter(f=>f>=hoy).sort();
        lista.innerHTML=fs.length?fs.map(f=>`<li>${esc(fmtF(f))}: <b>${fechas[f]==='cortado'?'cortado':'de corrido'}</b> <button class="btn small ghost" type="button" data-qf="${esc(f)}">Quitar</button></li>`).join(''):'<li class="muted">Ninguno. Los días se rigen por la lista de arriba.</li>';
      };
      pintar();
      $('#hz-c',el).addEventListener('change',e=>{caja.hidden=!e.target.checked;});
      $('#hz-fa',el).addEventListener('click',()=>{const f=$('#hz-fd',el).value;if(!/^\d{4}-\d{2}-\d{2}$/.test(f))return toast('Elegí el día','bad');fechas[f]=$('#hz-fm',el).value;pintar();});
      lista.addEventListener('click',e=>{const b=e.target.closest('[data-qf]');if(!b)return;delete fechas[b.dataset.qf];pintar();});
      $('#hz-form',el).addEventListener('submit',async e=>{
        e.preventDefault();
        const N=id=>Number($('#'+id,el).value),desde=N('hz-d'),hasta=N('hz-h'),usa=$('#hz-c',el).checked;
        const ok=(a,b)=>Number.isInteger(a)&&Number.isInteger(b)&&a>=0&&b<=24&&a<b;
        if(!ok(desde,hasta))return toast('De corrido: «desde» tiene que ser menor que «hasta» (de 0 a 24)','bad');
        const nuevo={corrido:{desde,hasta},cortado:null,dias:{},fechas:{}};
        for(const [n] of HZ_DIAS)nuevo.dias[n]='corrido';
        if(usa){
          const m=[N('hz-m0'),N('hz-m1')],t=[N('hz-t0'),N('hz-t1')];
          if(!ok(m[0],m[1])||!ok(t[0],t[1]))return toast('Cortado: en la mañana y en la tarde «desde» tiene que ser menor que «hasta» (de 0 a 24)','bad');
          if(m[1]>=t[0])return toast('La mañana tiene que terminar antes de que empiece la tarde','bad');
          nuevo.cortado={m,t};
          el.querySelectorAll('[data-dc]').forEach(c=>{nuevo.dias[Number(c.dataset.dc)]=c.checked?'cortado':'corrido';});
          Object.assign(nuevo.fechas,fechas);
        }
        try{await guardarPlan(nuevo);toast('Horario guardado');closeModal();tecCargar();}catch(err){toast(err.message||'No se pudo guardar','bad');}
      });
    }});
}
/* atajo: pasar SOLO el día de hoy a cortado (o de corrido), sin tocar el resto */
async function hoyCambiar(){
  const d=TU.data;if(!d)return;
  const pl=planDe();
  if(!pl.cortado)return openHorarioUbic();
  const esCortado=stTramos(d.horario).length>1&&d.dia===d.hoy,hoy=d.hoy,nuevo=esCortado?'corrido':'cortado';
  if(d.dia!==d.hoy)return toast('Cambiá al día de hoy para usar este botón','bad');
  const copia=JSON.parse(JSON.stringify(pl));copia.fechas[hoy]=nuevo;
  try{await guardarPlan(copia);toast('Hoy queda '+(nuevo==='cortado'?'cortado':'de corrido'));tecCargar();}catch(err){toast(err.message||'No se pudo guardar','bad');}
}
function openBaseJornada(){
  const jc=(TU.data&&TU.data.jornada)||{base:null,radio:40,tol:10,dias:[1,2,3,4,5,6]};
  const DN=['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  openModal({title:'Base y jornada',html:`<form class="form" id="jb-form" novalidate>
    <div class="hint">La base es el lugar al que los técnicos vuelven a guardar los vehículos. La primera vez en el día que el celular de un técnico (con la app abierta) aparece dentro del radio se anota su <b>ingreso</b>; la última vez que vuelve, su <b>fin</b>.</div>
    <div class="hint"><b>Cargala parado en el galpón</b> donde se guardan los vehículos, al aire libre y sin moverte, no en el local de adelante: la ubicación que muestra Google Maps del negocio no sirve porque queda a unos metros.</div>
    ${F('Ubicación de la base','jb-geo',`<input id="jb-geo" autocomplete="off" placeholder="-27.7345, -62.4678" value="${jc.base?jc.base.lat+', '+jc.base.lng:''}">`)}
    <div class="actions start"><button class="btn small" type="button" id="jb-gps">Usar mi ubicación actual (GPS)</button></div>
    <div class="hint" id="jb-st">Tocá el botón: junta unas 10 lecturas (hasta 20 s) y las promedia. Esperá a que diga ±10 m o menos.</div>
    <div class="grid2">${F('Radio (metros)','jb-radio',`<input id="jb-radio" type="number" min="20" max="2000" step="5" inputmode="numeric" value="${jc.radio}">`)}${F('Tolerancia (minutos)','jb-tol',`<input id="jb-tol" type="number" min="0" max="120" step="1" inputmode="numeric" value="${jc.tol}">`)}</div>
    <div class="field"><label>Días de trabajo (los otros no cuentan como falta)</label><div class="dias">${[1,2,3,4,5,6,0].map(x=>`<label><input type="checkbox" data-dia="${x}"${jc.dias.includes(x)?' checked':''}>${DN[x]}</label>`).join('')}</div></div>
    <div class="hint">Radio de 40 m: alcanza para el galpón y el frente. Si un técnico que está adentro del galpón no figura en la base (el GPS se corre bajo techo), subilo a 60. Una lectura con precisión peor que el radio (o que 50 m) se ignora, así no cuenta una entrada o salida falsa.</div>
    <div class="hint">La hora esperada de ingreso es el «Desde» del primer tramo del horario de ubicación (y, en un día cortado, la retoma es el «Desde» de la tarde). Pasada la tolerancia se marca «tarde» o «sin ingreso».</div>
    <div class="actions"><button class="btn ghost" type="button" data-close>Cancelar</button>${jc.base?'<button class="btn ghost" type="button" id="jb-quitar">Quitar la base</button>':''}<button class="btn primary" type="submit">Guardar</button></div></form>`,
    onMount(el){
      const geo=$('#jb-geo',el),st=$('#jb-st',el),gb=$('#jb-gps',el);let run=null;const label=gb.textContent;
      const say=(c,t)=>{st.className='hint '+c;st.textContent=t;};
      gb.addEventListener('click',async()=>{
        if(run){run.stop();return;}
        gb.textContent='Tomando lecturas… (tocá para terminar ahora)';say('','Esperando al GPS. Quedate quieto en el galpón, mejor al aire libre.');
        run=gpsPromedio(b=>say('','Lecturas: '+b.n+' · mejor precisión ±'+Math.round(b.acc)+' m'));
        try{
          const r=await run.promise;geo.value=r.lat.toFixed(6)+', '+r.lng.toFixed(6);
          const t='Promedio de '+r.n+(r.n===1?' lectura':' lecturas')+' (±'+Math.round(r.acc)+' m). ';
          say(r.acc<=15?'ok':'bad',r.acc<=15?t+'Guardá para dejarla como base.':t+'Es poco precisa para una base chica: salí a un lugar abierto y repetí, o subí el radio.');
        }
        catch(e){say('bad',gpsErrorText(e));}
        finally{run=null;gb.textContent=label;}
      });
      const guardar=async quitar=>{
        const radio=Number($('#jb-radio',el).value),tol=Number($('#jb-tol',el).value),dias=[...el.querySelectorAll('[data-dia]')].filter(c=>c.checked).map(c=>Number(c.dataset.dia));
        const body={radio,tol,dias};
        if(!quitar&&geo.value.trim()){const g=parseCoords(geo.value);if(!g)return toast('La ubicación de la base no se entiende: pegá dos números separados por coma','bad');body.lat=g.lat;body.lng=g.lng;}
        if(!Number.isInteger(radio)||radio<20||radio>2000)return toast('El radio tiene que estar entre 20 y 2000 metros','bad');
        if(!Number.isInteger(tol)||tol<0||tol>120)return toast('La tolerancia tiene que estar entre 0 y 120 minutos','bad');
        try{await NET.api('POST','/api/jornada/base',body);toast(quitar?'Base quitada':'Guardado');closeModal();tecCargar();}catch(err){toast(err.message||'No se pudo guardar','bad');}
      };
      $('#jb-form',el).addEventListener('submit',e=>{e.preventDefault();guardar(false);});
      const q=$('#jb-quitar',el);if(q)q.addEventListener('click',()=>guardar(true));
    }});
}
VIEWS.tecnicos={
  mount(el){
    el.innerHTML=`<div class="head-row"><h2>Técnicos</h2><button class="btn small" type="button" id="tu-act">Actualizar</button></div>
      <p class="muted small" id="tu-horario"></p>
      <p class="muted small" id="tu-base"></p>
      <div class="toolbar"><div class="line"><input id="tu-dia" type="date" aria-label="Día" style="width:auto">${isAdmin()?'<button class="btn small ghost" type="button" id="tu-hz">Cambiar el horario</button><button class="btn small ghost" type="button" id="tu-hoy">Hoy: cortado / de corrido</button><button class="btn small ghost" type="button" id="tu-bs">Base y jornada</button>':''}</div></div>
      <div id="tu-out"></div>
      <p class="muted small">La ubicación se toma solo en el horario indicado. En la app instalada sigue con la pantalla apagada una vez que el técnico la abrió; en el navegador, solo con la página abierta. Si pasan más de 10 minutos sin recibir nada, el técnico figura «Sin señal» y el tramo queda anotado. Cada técnico acepta un aviso antes de empezar.</p>`;
    $('#tu-act',el).addEventListener('click',()=>tecCargar());
    $('#tu-dia',el).addEventListener('change',e=>{TU.dia=e.target.value;TU.data=null;tecRender();tecCargar();});
    const hz=$('#tu-hz',el);if(hz)hz.addEventListener('click',openHorarioUbic);
    const hh=$('#tu-hoy',el);if(hh)hh.addEventListener('click',hoyCambiar);
    const bs=$('#tu-bs',el);if(bs)bs.addEventListener('click',openBaseJornada);
    clearInterval(TU.timer);
    TU.timer=setInterval(()=>{if(S.tab==='tecnicos'&&!document.hidden&&TU.data&&TU.dia===TU.data.hoy)tecCargar();},60000);
    TU.dia='';TU.data=null;tecRender();tecCargar();
  },
  update(){tecRender();}
};
