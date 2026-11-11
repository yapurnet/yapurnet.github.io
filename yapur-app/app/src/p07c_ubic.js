/* ===== ubicación de los técnicos en horario laboral =====
   Los técnicos aceptan un aviso y, solo dentro del horario (por defecto de 8 a 20 h), la app manda su posición cada minuto.
   El servidor vuelve a controlar el horario con su reloj y borra todo a los 14 días. Quien tiene el permiso «verTecnicos» la ve en la pestaña Técnicos. */
const UB={st:null,stTs:0,watch:null,queue:[],lastQ:0,sending:false,asked:false,denied:false,gpsOff:false,nat:false,started:false,refr:false,bg:'',bgPedido:false,sOk:false};
const arNow=()=>{const d=new Date(Date.now()-3*3600e3);return {fecha:d.toISOString().slice(0,10),h:d.getUTCHours()+d.getUTCMinutes()/60};};
/* tramos del día: [[8,20]] de corrido, o [[8,13],[17,22]] en un día cortado (con siesta). Los datos viejos traen solo desde/hasta. */
const stTramos=s=>!s?[]:(s.tramos&&s.tramos.length?s.tramos:[[s.desde,s.hasta]]);
const trTxt=tr=>tr.map(t=>t[0]+' a '+t[1]).join(' y de ');   /* «8 a 13 y de 17 a 22»: se usa como «de … h» */
/* la oficina puede cortarle el GPS a un técnico a una hora de hoy: desde ahí no se comparte nada más (el servidor igual descarta lo que llegue) */
const ubCortado=()=>!!(UB.st&&UB.st.corte&&Date.now()>=UB.st.corte);
const ubDentro=()=>{if(ubCortado())return false;const h=arNow().h;return stTramos(UB.st).some(t=>h>=t[0]&&h<t[1]);};
const hhmm=ts=>new Date(ts).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',hour12:false});
const haceTxt=ts=>{
  const m=Math.max(0,Math.round((Date.now()-ts)/60000));
  if(m<1)return 'recién';if(m<60)return 'hace '+m+' min';
  const h=Math.floor(m/60);return 'hace '+h+' h'+(m%60?' '+(m%60)+' min':'');
};

/* ----- modo «siempre activo» (APK nuevo): un servicio que sigue con la app cerrada, para que la jornada se anote sin que nadie abra la app ----- */
const ubNativo=()=>{const b=window.YapurApp;return b&&typeof b.startLocationSiempre==='function'?b:null;};
const ubSiempreOk=()=>{try{return localStorage.getItem('yapur_ub_siempre')==='1';}catch(e){return UB.sOk;}};
const ubSiempreMarcar=()=>{UB.sOk=true;try{localStorage.setItem('yapur_ub_siempre','1');}catch(e){}};
/* lo que ve el técnico del aviso: lo común, y qué cambia en el APK con el servicio siempre activo */
const ubAvisoLista=(st,nat)=>`<ul class="plain"><li>Fuera de ese horario no se toma ni se guarda nada.</li><li>Solo la ven el administrador y quien él habilite.</li><li>Se borra a los ${st.dias} días.</li><li>Dentro del horario la oficina también ve si la ubicación o la app están apagadas y cuánta batería te queda, para saber por qué dejó de llegar tu ubicación. Esto tampoco se toma fuera del horario.</li>${nat
  ?'<li>El celular te va a pedir el permiso de ubicación: elegí «Mientras se usa la app» y, cuando te lo pida de nuevo, <b>«Permitir todo el tiempo»</b>: es lo que deja que se anote tu jornada con la app cerrada.</li><li>Android obliga a dejar una notificación mientras se comparte la ubicación: es la más discreta que existe (sin sonido, sin ícono arriba y abajo de todo en el panel).</li><li>El celular te va a preguntar si la dejás «sin restricción de batería»: aceptá, así no se corta.</li><li>Si cerrás sesión, se corta todo.</li>'
  :'<li>El celular te va a pedir el permiso de ubicación: elegí «Mientras se usa la app».</li><li>En la app instalada Android obliga a dejar una notificación mientras se comparte: es la más discreta que existe (sin sonido, sin ícono arriba y abajo de todo en el panel).</li><li>En la app instalada, el celular te va a preguntar si la dejás «sin restricción de batería»: aceptá, así no se corta cuando apagás la pantalla.</li>'}</ul>`;
/* para quien ya había aceptado el aviso de antes («con la app abierta»): ahora se comparte también con la app cerrada, y eso se avisa aparte */
function ubicSiempreAviso(st){
  return new Promise(res=>{
    let done=false;const fin=v=>{if(!done){done=true;res(v);}};
    openModal({title:'Ubicación también con la app cerrada',html:`<p>Desde esta versión, la oficina ve dónde estás <b>de ${trTxt(stTramos(st))} h</b> <b>aunque la app esté cerrada o el celular bloqueado</b>, así tu ingreso y el fin de tu jornada se anotan solos y no tenés que abrir la app.</p>${ubAvisoLista(st,true)}
      <div class="actions"><button class="btn ghost" type="button" data-act="no">Ahora no</button><button class="btn primary" type="button" data-act="si">Entendido, activar</button></div>`,
      onMount(el){el.addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(!b)return;fin(b.dataset.act==='si');closeModal();});},
      onClose:()=>fin(false)});
  });
}
/* «Permitir todo el tiempo»: Android no lo da con el cuadro común; abre la pantalla de permisos de la app y el técnico lo elige ahí */
function ubicSiempreExplicar(){
  const nat=ubNativo();if(!nat)return;
  openModal({title:'Ubicación «todo el tiempo»',html:`<p>Para que tu jornada se anote aunque no abras la app (y para que vuelva sola si el celular se reinicia), Android necesita que dejes la ubicación en <b>«Permitir todo el tiempo»</b>.</p>
    <ul class="plain"><li>Tocá <b>Activar</b>: se abre la pantalla de permisos de la app.</li><li>Entrá en <b>Ubicación</b> y elegí <b>«Permitir todo el tiempo»</b>, y volvé a la app.</li><li>Solo se comparte dentro del horario de trabajo (de ${trTxt(stTramos(UB.st))} h).</li></ul>
    <div class="actions"><button class="btn ghost" type="button" data-close>Ahora no</button><button class="btn primary" type="button" id="ub-bg">Activar</button></div>`,
    onMount(el){$('#ub-bg',el).addEventListener('click',()=>{
      closeModal();
      let r='';try{r=String(nat.pedirUbicacionSiempre());}catch(e){}
      if(r==='pedido')toast('En la pantalla que se abre, elegí «Permitir todo el tiempo»');
      else if(r==='ya')ubicLoop();
    });}});
}
/* una vez por día, si todavía falta ese permiso, se lo explica y se lo ofrece; el cartelito de arriba queda hasta que lo dé */
function ubicSiemprePermiso(nat){
  if(UB.bg==='si'||UB.bgPedido||document.hidden)return;
  const hoy=arNow().fecha;let ult='';try{ult=localStorage.getItem('yapur_ub_bgpedido')||'';}catch(e){}
  if(ult===hoy)return;
  UB.bgPedido=true;try{localStorage.setItem('yapur_ub_bgpedido',hoy);}catch(e){}
  ubicSiempreExplicar();
}

/* ----- latido, lado del técnico: si la ubicación o la app están apagadas y cuánta batería queda, solo dentro del horario -----
   No lleva ninguna posición. En el APK nuevo lo manda el servicio (también con la app cerrada); en el navegador o en un APK anterior, la página mientras está abierta.
   Empieza recién cuando el técnico tocó «Entendido» en el cartel que lo explica (si aceptó el aviso después de esta versión, ya lo leyó dentro del aviso). */
const LAT={ts:0,busy:false,ok:false};
const latKey=()=>'yapur_ub_lat_'+(S.me&&S.me.id||'');
const latVisto=()=>{try{return localStorage.getItem(latKey())==='1';}catch(e){return LAT.ok;}};
const latMarcar=()=>{LAT.ok=true;try{localStorage.setItem(latKey(),'1');}catch(e){}};
const latNativoNuevo=()=>{const b=window.YapurApp;return b&&typeof b.activarLatido==='function'?b:null;};
const latNativoActivar=si=>{const b=latNativoNuevo();if(b){try{b.activarLatido(!!si);}catch(e){}}};
async function latBateria(){try{if(navigator.getBattery){const b=await navigator.getBattery();const n=Math.round(b.level*100);return n>=0&&n<=100?n:null;}}catch(e){}return null;}
async function latPermiso(){
  if(UB.denied)return 0;
  try{if(navigator.permissions&&navigator.permissions.query){const r=await navigator.permissions.query({name:'geolocation'});if(r.state==='denied')return 0;if(r.state==='granted')return 1;}}catch(e){}
  return null;   /* no se sabe: no se dice nada */
}
async function ubicLatido(){
  if(!LAT.ok||LAT.busy||!NET.online||!UB.st||!UB.st.acepto||!ubDentro())return;
  if(UB.nat&&latNativoNuevo())return;   /* el servicio del APK nuevo manda el suyo */
  if(Date.now()-LAT.ts<Math.max(50e3,(UB.freno||0)*1e3))return;
  LAT.busy=true;LAT.ts=Date.now();
  try{
    const body={via:'web'},p=await latPermiso(),bat=await latBateria();
    if(p!==null)body.perm=p;if(bat!==null)body.bat=bat;
    ubFreno(await NET.api('POST','/api/ubicacion/latido',body,{noKick:true,timeout:15000}));
  }catch(e){/* sin conexión o sin aceptar: se reintenta en el próximo minuto */}
  LAT.busy=false;
}
function latBarra(){
  const bar=$('#latBar');if(!bar)return;
  if(LAT.ok||!UB.st||!UB.st.aplica||!UB.st.acepto||S.realRole!=='tecnico'||S.preview){bar.hidden=true;return;}
  bar.innerHTML=`<span>Desde esta versión, <b>de ${esc(trTxt(stTramos(UB.st)))} h</b> la oficina también ve si la <b>ubicación o la app están apagadas</b> y cuánta <b>batería</b> te queda, para saber por qué dejó de llegar tu ubicación. No lleva ninguna posición y no se toma nada fuera del horario.</span><button class="btn small" type="button" id="lat-ok">Entendido</button>`;
  bar.hidden=false;
  $('#lat-ok',bar).addEventListener('click',()=>{latMarcar();latNativoActivar(true);bar.hidden=true;ubicLatido();});
}

/* ----- lado del técnico ----- */
function ubicAviso(st){
  const nat=!!ubNativo();
  return new Promise(res=>{
    let done=false;const fin=v=>{if(!done){done=true;res(v);}};
    openModal({title:'Ubicación en horario laboral',html:`<p>La oficina puede ver dónde estás <b>hoy de ${trTxt(stTramos(st))} h</b> ${nat?'<b>aunque la app esté cerrada o el celular bloqueado</b>, así tu ingreso y el fin de tu jornada se anotan solos':'mientras la app esté abierta o activa en tu celular'}. Hay días de corrido y días con siesta: la app toma sola el horario de cada día.</p>
      ${ubAvisoLista(st,nat)}
      <div class="actions"><button class="btn ghost" type="button" data-act="no">Ahora no</button><button class="btn primary" type="button" data-act="si">Entendido, aceptar</button></div>`,
      onMount(el){el.addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(!b)return;fin(b.dataset.act==='si');closeModal();});},
      onClose:()=>fin(false)});
  });
}
function ubicChip(){
  let c=$('#ubChip'),g=$('#ubChipBg');
  /* en el APK nuevo, mientras falte el permiso «todo el tiempo»: un botón para darlo */
  if(UB.st&&UB.st.aplica&&UB.st.acepto&&S.realRole==='tecnico'&&!S.preview&&UB.nat&&UB.bg==='no'&&ubNativo()&&ubSiempreOk()){
    if(!g){g=document.createElement('button');g.id='ubChipBg';g.type='button';g.className='chip warn';g.textContent='Activar ubicación «todo el tiempo»';g.addEventListener('click',ubicSiempreExplicar);const rc=$('#roleChip');if(rc&&rc.parentNode)rc.parentNode.insertBefore(g,rc);}
  }else if(g)g.remove();
  if(!UB.st||!UB.st.aplica||!UB.st.acepto||S.realRole!=='tecnico'||S.preview){if(c)c.remove();return;}
  if(!c){c=document.createElement('span');c.id='ubChip';const rc=$('#roleChip');if(!rc||!rc.parentNode)return;rc.parentNode.insertBefore(c,rc);}
  const dentro=ubDentro();
  c.className='chip '+(UB.denied?'bad':dentro?'ok':'quiet');
  c.textContent=UB.denied?'Ubicación sin permiso':ubCortado()?'Ubicación cortada por la oficina':dentro?'Ubicación activa':'Ubicación fuera de horario';
  c.title=UB.denied?'Activá el permiso de ubicación de la app en el celular.':ubCortado()?'La oficina dio por terminado tu día: no se comparte más tu ubicación hoy.':`Se comparte con la oficina de ${trTxt(stTramos(UB.st))} h.`;
}
/* freno automático del servidor: si el día va camino a gastar el cupo, pide que la ubicación se mande más espaciada */
function ubFreno(r){UB.freno=r&&r.freno&&Number(r.freno.seg)>0?Math.min(300,Number(r.freno.seg)):0;}
async function ubicFlush(){
  if(UB.sending||!UB.queue.length||!NET.online)return;
  UB.sending=true;const pts=UB.queue.slice(0,30);
  try{
    const r=await NET.api('POST','/api/ubicacion',{pts},{noKick:true,timeout:20000});
    ubFreno(r);
    UB.queue.splice(0,pts.length);
    if(r&&r.cortado&&!ubCortado())ubicActualizar();   /* el servidor descartó todo porque la oficina cortó el GPS: se pide el estado ya mismo */
  }catch(e){
    if(e&&e.status===409){UB.st.acepto=false;ubicStop();}
    else if(e&&e.status===403)UB.queue.length=0;
  }
  UB.sending=false;
}
function ubicWatch(){
  if(UB.watch!=null||UB.denied||!navigator.geolocation)return;
  UB.watch=navigator.geolocation.watchPosition(p=>{
    const now=Date.now();if(now-UB.lastQ<Math.max(45e3,(UB.freno||0)*1e3))return;   /* un punto por minuto alcanza */
    UB.lastQ=now;
    UB.queue.push({lat:p.coords.latitude,lng:p.coords.longitude,acc:p.coords.accuracy,ts:p.timestamp||now});
    if(UB.queue.length>60)UB.queue.shift();
    ubicFlush();
  },e=>{
    if(e&&e.code===1){UB.denied=true;if(UB.watch!=null)navigator.geolocation.clearWatch(UB.watch);UB.watch=null;toast('Activá el permiso de ubicación de la app para compartirla con la oficina','bad');ubicChip();LAT.ts=0;ubicLatido();gateCheck();}   /* si ya era horario y hacía falta el permiso, que bloquee apenas se sabe (no recién en el próximo minuto) */
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
/* se pide el horario ya mismo (sin esperar los 10 minutos) y se aplica: lo usa el aviso en vivo de que la oficina cortó o reanudó el GPS */
function ubicActualizar(){
  if(!UB.st)return;
  UB.stTs=0;UB.refr=false;
  ubicRefrescar().then(ubicLoop,ubicLoop);
  if(typeof jornadaCargar==='function')jornadaCargar();
}
function ubicLoop(){
  ubicEstadoNativoAplicar();
  ubicLoopCore();
  gateCheck();
}
function ubicLoopCore(){
  ubicLatido();
  if(!UB.st||!UB.st.acepto||UB.denied&&!UB.nat){ubicChip();return;}
  const b=window.YapurApp,tr=stTramos(UB.st),nat=ubNativo();
  if(nat&&ubSiempreOk()){
    /* APK nuevo: el servicio queda siempre andando (también fuera de horario y con la app cerrada) y decide solo cuándo tomar posiciones.
       La página solo lo mantiene al día con la sesión; no lo detiene al terminar el horario. */
    let r='';try{r=String(nat.startLocationSiempre(NET.token));}catch(e){}
    UB.nat=r==='ok';
    try{UB.bg=String(nat.ubicacionSiempre());}catch(e){UB.bg='no';}
    if(UB.nat){
      if(UB.watch!=null&&navigator.geolocation)navigator.geolocation.clearWatch(UB.watch);UB.watch=null;   /* ya manda el servicio */
      ubicSiemprePermiso(nat);
    }else if(ubDentro())ubicWatch();   /* todavía sin permiso: la ventana lo pide con el GPS */
    if(ubDentro())ubicFlush();
    ubicChip();return;
  }
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
  let recien=false;
  if(!UB.st.acepto){
    /* si no acepta (o se corta la conexión al guardarlo), se sigue igual: dentro del horario, el bloqueo de abajo (gateCheck)
       se encarga de no dejarlo usar la app hasta que lo acepte */
    if(!UB.asked){
      UB.asked=true;
      if(await ubicAviso(UB.st)){
        try{UB.st=await NET.api('POST','/api/ubicacion/acepto',{});if(ubNativo())ubSiempreMarcar();recien=true;}   /* el aviso de recién ya decía que se comparte también con la app cerrada */
        catch(e){toast('No se pudo guardar tu respuesta. Probá de nuevo más tarde.','bad');}
      }
    }
  }else if(ubNativo()&&!ubSiempreOk()&&!UB.asked){
    /* aceptó el aviso de antes («con la app abierta»): lo nuevo se avisa aparte y, si no quiere, sigue como antes */
    UB.asked=true;
    if(await ubicSiempreAviso(UB.st))ubSiempreMarcar();
  }
  if(recien){latMarcar();latNativoActivar(true);}   /* el aviso que aceptó recién ya lo explicaba */
  else if(latVisto()){LAT.ok=true;latNativoActivar(true);}
  else{latNativoActivar(false);latBarra();}   /* ya había aceptado antes: se lo explica un cartel y el latido arranca cuando toca «Entendido» */
  UB.stTs=Date.now();
  NET.on('ubic',ubicActualizar);
  ubicLoop();
  const tick=()=>ubicRefrescar().then(ubicLoop,ubicLoop);
  setInterval(tick,60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();});
}

/* ----- bloqueo de la app por ubicación, dentro del horario laboral -----
   Si el técnico no aceptó compartir la ubicación, le sacaron el permiso, o (en el APK, que es quien puede saberlo con certeza)
   tiene la ubicación del celular apagada, no puede usar la app para nada mientras dure el horario de hoy: se lo explica en una
   pantalla sin forma de cerrarla, y se destraba solo apenas se soluciona (sin tener que reabrir la app). Fuera de horario, o si
   la función de ubicación está apagada para este técnico, no se exige nada: es la misma regla de siempre, «fuera del horario
   no se toma ni se exige nada». No es a prueba de alguien decidido a esquivarlo (puede cerrar la app), pero si la quiere usar,
   tiene que tenerla prendida. */
const GATE={on:false,motivo:'',timer:null};
/* «permiso» (1/0) y «gps» (1/0) según lo que el propio Android informa (no lo que la página pudo o no pudo leer); solo existe
   en el APK que ya trae este bridge (ubicEstado) — en el navegador, o con un APK más viejo, no cambia nada de lo que ya había. */
function ubicEstadoNativo(){
  const b=ubNativo();if(!b||typeof b.ubicEstado!=='function')return null;
  try{const s=String(b.ubicEstado());return s.length===2?{perm:s[0]==='1',gps:s[1]==='1'}:null;}catch(e){return null;}
}
function ubicEstadoNativoAplicar(){
  const ne=ubicEstadoNativo();if(ne){UB.denied=!ne.perm;UB.gpsOff=!ne.gps;}
}
function ubicGateMotivo(){
  if(S.realRole!=='tecnico'||S.preview)return '';
  if(!UB.st||!UB.st.aplica||!ubDentro())return '';
  if(!UB.st.acepto)return 'aviso';
  if(UB.denied)return 'permiso';
  if(ubNativo()&&UB.gpsOff)return 'gps';
  return '';
}
function gateHTML(m){
  if(m==='aviso')return `<div class="card auth"><h2>Ubicación en horario laboral</h2><p>Para usar la app en este horario hace falta aceptar compartir tu ubicación con la oficina:</p>${ubAvisoLista(UB.st,!!ubNativo())}<div class="actions"><button class="btn primary" type="button" id="gt-ok">Entendido, aceptar</button></div></div>`;
  if(m==='permiso')return `<div class="card auth"><h2>Falta el permiso de ubicación</h2><p>Para usar la app en este horario hace falta darle a la app el permiso de ubicación.</p><div class="actions">${ubNativo()?'<button class="btn primary" type="button" id="gt-perm">Dar el permiso</button>':''}<button class="btn${ubNativo()?' ghost':' primary'}" type="button" id="gt-retry">Ya lo di: revisar de nuevo</button></div></div>`;
  if(m==='gps')return `<div class="card auth"><h2>La ubicación del celular está apagada</h2><p>Para usar la app en este horario hace falta prender la ubicación del celular.</p><div class="actions"><button class="btn primary" type="button" id="gt-gps">Prender ubicación</button><button class="btn ghost" type="button" id="gt-retry">Ya la prendí: revisar de nuevo</button></div></div>`;
  return '';
}
function gateMount(){
  tabsHtml='';$('#tabs').innerHTML='';closeModal();
  const el=$('#view');el.innerHTML=gateHTML(GATE.motivo);window.scrollTo(0,0);
  const ok=$('#gt-ok',el);
  if(ok)ok.addEventListener('click',async()=>{
    ok.disabled=true;ok.textContent='Guardando…';
    try{UB.st=await NET.api('POST','/api/ubicacion/acepto',{});if(ubNativo())ubSiempreMarcar();gateCheck();}
    catch(e){toast('No se pudo guardar tu respuesta. Probá de nuevo.','bad');ok.disabled=false;ok.textContent='Entendido, aceptar';}
  });
  const rt=$('#gt-retry',el);
  if(rt)rt.addEventListener('click',()=>{ubicEstadoNativoAplicar();if(UB.denied&&UB.watch==null)ubicWatch();gateCheck();});
  const pm=$('#gt-perm',el);
  if(pm)pm.addEventListener('click',()=>{const b=ubNativo();try{b&&b.abrirAjustesPermiso&&b.abrirAjustesPermiso();}catch(e){}});
  const gp=$('#gt-gps',el);
  if(gp)gp.addEventListener('click',()=>{const b=ubNativo();try{b&&b.abrirAjustesUbicacion&&b.abrirAjustesUbicacion();}catch(e){}});
}
function gateCheck(){
  const m=ubicGateMotivo();
  if(m){
    if(!GATE.on||GATE.motivo!==m){GATE.on=true;GATE.motivo=m;S.ubicGate=true;gateMount();}
    if(!GATE.timer)GATE.timer=setInterval(()=>{ubicEstadoNativoAplicar();gateCheck();},4000);
  }else if(GATE.on){
    GATE.on=false;GATE.motivo='';S.ubicGate=false;
    if(GATE.timer){clearInterval(GATE.timer);GATE.timer=null;}
    refreshAll();
  }
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
    cls='warn';html=`<span>Todavía no empezó tu jornada. Empieza sola cuando tu celular llega a la base. Si ya estuviste en la base y no figura, avisale a la oficina.</span>`;
  }else if(tr2.length>1&&h>=tr2[0][1]&&h<tr2[1][0]){
    cls='quiet';html=`<span>Tu mañana${f.regreso&&f.enBase?' terminó a las <b>'+hhmm(f.regreso)+'</b> al volver a la base':' terminó'}. Retomás a las <b>${tr2[1][0]}</b> h.</span>`;
  }else if(f.regreso&&f.enBase&&!(f.ingreso2&&f.regreso<f.ingreso2)){
    cls='quiet';html=`<span>Tu jornada comenzó a las <b>${hhmm(f.ingreso)}</b>${f.ingreso2?', retomaste a las <b>'+hhmm(f.ingreso2)+'</b>':''} y terminó a las <b>${hhmm(f.regreso)}</b>${st.corte?' (la oficina cortó tu ubicación)':' al volver a la base'}${tr2.length>1?'':' ('+esc(durTxt((f.regreso-f.ingreso)/60000))+')'}.</span>`;
  }else{
    html=`<span>Tu jornada laboral comenzó a las <b>${hhmm(f.ingreso)}</b>${f.origen==='base'?' · en la base':''}${f.ingreso2?' · retomaste a las <b>'+hhmm(f.ingreso2)+'</b>':''}.</span>`;
  }
  if(st.enterado&&st.horas)html+=jrHorasTxt(st);
  bar.className='jrbar'+(cls?' '+cls:'');bar.innerHTML=html;bar.hidden=false;
  const hs=$('#jr-hs',bar);if(hs)hs.addEventListener('click',jornadaMisHoras);
  const ok=$('#jr-ok',bar),inf=$('#jr-info',bar);
  if(ok)ok.addEventListener('click',jornadaEntendido);
  if(inf)inf.addEventListener('click',jornadaAviso);
}
/* horas de hoy y de la semana, con el botón para ver cada día */
function jrHorasTxt(st){
  const hx=st.horas,hoy=hx.dias.find(x=>x.dia===st.dia),m=hoy?hoy.min:0;
  if(!hx.semana&&!m)return '';
  return `<div class="jr-h"><span>Hoy <b>${esc(horasTxt(m))}</b> · semana <b>${esc(horasTxt(hx.semana))}</b></span><button class="btn small ghost" type="button" id="jr-hs">Mis horas</button></div>`;
}
function jornadaMisHoras(){
  const st=JR.st;if(!st||!st.horas)return;
  const hx=st.horas,dias=hx.dias.filter(x=>x.estado!=='sin_registro'||x.dia===st.dia);
  const nota=x=>x.estado==='incompleto'?'<span class="chip warn">Sin cerrar</span>':x.estado==='corregido'?'<span class="chip quiet">Corregido por la oficina</span>':x.estado==='en_curso'?'<span class="chip ok">En curso</span>':'';
  openModal({title:'Mis horas',html:`<div class="hr-big">${esc(horasTxt(hx.semana))}</div><div class="small muted">Esta semana (lunes a domingo), ${esc(horasDec(hx.semana))} horas</div>
    <ul class="plain hr-list">${dias.length?dias.map(x=>`<li><span>${esc(diaNombre(x.dia))} ${esc(fechaCorta(x.dia))}</span><b>${esc(x.estado==='sin_registro'?'–':horasTxt(x.min))}</b>${nota(x)}</li>`).join(''):'<li>Todavía no hay días registrados esta semana.</li>'}</ul>
    <p class="small muted">Se cuenta desde que tu celular llega a la base hasta que volvés a guardar el vehículo${tramosCortado(st)?' (la siesta no se cuenta)':''}. Si un día figura «Sin cerrar» o ves un error, avisale a la oficina para que lo corrija.</p>
    <div class="actions"><button class="btn primary" type="button" data-close>Cerrar</button></div>`});
}
const tramosCortado=st=>!!(st&&st.horario&&st.horario.tramos&&st.horario.tramos.length>1);
async function jornadaEntendido(){
  try{JR.st=await NET.api('POST','/api/jornada/acepto',{});}catch(err){toast(err&&err.message||'No se pudo guardar. Probá de nuevo.','bad');return;}
  closeModal();jornadaBarra();
}
function jornadaAviso(){
  openModal({title:'Control de jornada',html:`<p>La oficina registra a qué hora empezás y a qué hora terminás el día, con la ubicación del celular:</p>
    <ul class="plain"><li><b>Ingreso:</b> la primera vez que tu celular${ubNativo()&&ubSiempreOk()?'':', con la app abierta,'} aparece en la base.</li><li><b>Fin:</b> la última vez que volvés a la base a guardar el vehículo.</li><li>Las horas se cuentan desde que llegás a la base (ahí buscás materiales, herramientas y vehículo). Si ya estuviste y no se anotó, avisale a la oficina para que te cargue la hora.</li><li>Ves tus horas en esa misma barra.</li><li>Este registro guarda solo las horas y la distancia a la base, durante 90 días.</li></ul>
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
  setInterval(()=>{if(!document.hidden)jornadaCargar();},180000);   /* cada 3 minutos alcanza (la barra muestra horas, no segundos) y al volver a la app se pide de nuevo */
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)jornadaCargar();});
}

/* ----- lado de quien mira: pestaña Técnicos ----- */
const TU={dia:'',data:null,err:'',busy:false,timer:null,vista:'pos'};
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
  const mt=t.motivo&&t.motivo.tipo;
  const extra=mt==='ubicacion_apagada'?' Veo que tenés la ubicación del celular apagada: prendela, por favor.':mt==='sin_permiso'?' Veo que la app no tiene permiso de ubicación: dáselo en Ajustes del celular (Aplicaciones > YAPUR Gestión > Permisos > Ubicación).':mt==='bateria'?' Veo que el celular se quedó sin batería: cargalo y abrí la app.':'';
  return waUrl(t.tel,txt+extra);
}
/* por qué dejaron de llegar posiciones, según lo que dijo el propio celular (latido): se dice lo que se sabe y lo que no */
function motTxt(m){
  if(!m)return '';
  const h=hhmm(m.desde);
  if(m.tipo==='ubicacion_apagada')return `Tiene la <b>ubicación del celular apagada</b> desde las ${h}.`;
  if(m.tipo==='sin_permiso')return `La app <b>no tiene permiso de ubicación</b> desde las ${h}.`;
  if(m.tipo==='sin_posicion')return `La app responde (último aviso a las ${h}) y la ubicación está prendida, pero <b>el celular no da posiciones</b>: puede estar en un lugar cerrado o con mala señal de GPS.`;
  if(m.tipo==='bateria')return `La app dejó de responder a las ${h} con la <b>batería en ${esc(String(m.bat))} %</b>: lo más probable es que el celular se haya apagado por falta de batería.`;
  return `La app <b>dejó de responder a las ${h}</b> (cerrada, celular sin datos o apagado)${hasNum(m.bat)?' · batería '+esc(String(m.bat))+' %':''}. Con esto no se puede saber cuál de esas fue.`;
}
const motCorto=m=>!m?'':m.tipo==='ubicacion_apagada'?'ubicación apagada':m.tipo==='sin_permiso'?'app sin permiso':m.tipo==='sin_posicion'?'el celular no da posiciones':m.tipo==='bateria'?'sin batería':'app sin responder';
/* sin ningún «latido» en lo que va del tramo no hay motivo puntual que afirmar (lo decide el servidor), pero sí vale la explicación más común */
const MOT_SIN_DATO='No se sabe seguro: el celular no mandó ningún control desde que arrancó este horario. Es lo típico de <b>no tener instalada la app YAPUR Gestión</b> (usar el sitio en el navegador): ahí la ubicación se manda solo mientras la página sigue abierta, y se corta en cuanto se bloquea la pantalla o se cambia de app. Convendría instalarle la app y, al abrirla, dejar el permiso de ubicación en <b>«Permitir todo el tiempo»</b> y <b>«sin restricción de batería»</b>.';
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
    else if(j.estado==='termino')ch('quiet','Terminó '+hhmm(j.regreso)+(j.cortado?'':' · jornada de '+durTxt((j.regreso-j.ingreso)/60000))+(j.corte?' · GPS cortado a mano':''));
    else if(j.estado==='sin_cierre')ch('warn',j.regreso?'Último regreso a la base '+hhmm(j.regreso)+', después no volvió':'No volvió a la base');
    else ch('quiet',j.enBase?'En la base':'Fuera de la base');
    if(j.ingreso2)ch(j.tarde2?'warn':'ok','Retomó '+hhmm(j.ingreso2)+(j.tarde2?' · '+durTxt(j.atraso2Min)+' tarde':''));
    else if(j.sinRetomar)ch('bad','No retomó a la tarde');
  }else if(j.estado==='sin_ingreso')ch('bad','Sin ingreso');
  else if(j.estado==='esperando'&&esHoy)ch('quiet','Todavía no ingresó');
  if(j.horasMin>0)ch(j.horasEstado==='incompleto'?'warn':j.horasEstado==='corregido'?'accent':j.horasEstado==='en_curso'?'ok':'info','Horas: '+horasTxt(j.horasMin)+(j.horasEstado==='incompleto'?' · sin cerrar':j.horasEstado==='corregido'?' · corregido':j.horasEstado==='en_curso'?' · hasta ahora':''));
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
  else if(e==='cortado')chip=`<span class="chip warn">GPS cortado a las ${esc(hhmmAR(t.corte))}</span>`;
  else chip=u?'<span class="chip quiet">'+t.puntos+' '+(t.puntos===1?'punto':'puntos')+(t.corte?' · cortado '+esc(hhmmAR(t.corte)):'')+'</span>':'<span class="chip quiet">Sin ubicación ese día</span>';
  const rb=(d.jornada&&d.jornada.radio)||40,dBase=u&&hasNum(u.dist)?(u.dist<=rb?' · en la base':' · a '+fmtDist(u.dist)+' de la base'):'';
  const detalle=u?`${esHoy?'Última vez':'Último punto'} a las ${hhmm(u.ts)}${hasNum(u.acc)?' · precisión ±'+Math.round(u.acc)+' m':''}${dBase}${t.ruta.length>1?` · de ${hhmm(t.ruta[0][0])} a ${hhmm(t.ruta[t.ruta.length-1][0])}`:''}`:(e==='sin_datos'?'Todavía no mandó su posición: tiene que abrir la app en el celular.':'');
  const hu=t.huecos||[];
  const huHTML=hu.length?`<details class="small tec-hu"><summary>Sin señal ${esc(durTxt(t.sinSenalMin))} en ${hu.length} ${hu.length===1?'tramo':'tramos'}</summary><ul class="plain">${hu.map(g=>`<li>${hhmm(g.desde)} a ${hhmm(g.hasta)} · ${durTxt((g.hasta-g.desde)/60000)}${g.inicio?' (antes de su primera posición)':''}${g.sigue?' (sigue sin señal)':''}</li>`).join('')}</ul></details>`:'';
  const motHTML=t.motivo?`<div class="small tec-mot"><b>Motivo probable:</b> ${motTxt(t.motivo)}</div>`:(esHoy&&tecProblema(t)?`<div class="small tec-mot"><b>Motivo probable:</b> ${MOT_SIN_DATO}</div>`:'');
  const ap=t.apagados||[];
  const apHTML=ap.length?`<details class="small tec-hu"><summary>Ubicación apagada o sin permiso ${esc(durTxt(t.apagadoMin))} en ${ap.length} ${ap.length===1?'tramo':'tramos'}</summary><ul class="plain">${ap.map(g=>`<li>${hhmm(g.desde)} a ${g.hasta==null?'ahora':hhmm(g.hasta)} · ${g.tipo==='permiso'?'la app sin permiso de ubicación':'ubicación del celular apagada'}${g.hasta!=null&&g.hasta>g.desde?' · '+durTxt((g.hasta-g.desde)/60000):''}</li>`).join('')}</ul></details>`:'';
  const ruta=rutaUrl(t.ruta),aviso=tecProblema(t)&&t.tel&&can('telefono');
  return `<article class="card tcard"><div class="head-row"><h3 style="overflow-wrap:anywhere">${esc(t.nombre)}</h3>${chip}</div>
    ${jornadaTec(t,d)}${detalle?`<div class="small muted">${esc(detalle)}</div>`:''}${motHTML}${huHTML}${apHTML}
    <div class="actions start">${aviso?`<a class="btn small primary" href="${tecAvisoUrl(t)}" target="_blank" rel="noopener">Avisarle por WhatsApp</a>`:''}${u?`<a class="btn small${aviso?'':' primary'}" href="${mapaUrl(u.lat,u.lng)}" target="_blank" rel="noopener">Ver en el mapa</a>`:''}${ruta?`<a class="btn small" href="${ruta}" target="_blank" rel="noopener">Recorrido del día</a>`:''}${!aviso&&t.tel&&can('telefono')?`<a class="btn small ghost" href="${waUrl(t.tel,'')}" target="_blank" rel="noopener">WhatsApp</a>`:''}${esHoy&&isAdmin()&&t.acepto?(t.corte?`<button class="btn small" type="button" data-gps-reanudar="${esc(t.id)}">Reanudar GPS</button>`:`<button class="btn small ghost" type="button" data-gps-cortar="${esc(t.id)}">Cortar GPS</button>`):''}</div></article>`;
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
  const banner=sin.length?`<div class="notice" role="status" id="tu-alerta" style="margin-bottom:12px"><b>${sin.length===1?'1 técnico sin señal':sin.length+' técnicos sin señal'}:</b> ${sin.map(t=>esc(t.nombre)+(t.ultima?' ('+esc(haceTxt(t.ultima.ts))+')':' (no mandó nada hoy)')+(t.motivo?' · '+esc(motCorto(t.motivo)):'')).join(', ')}.</div>`:'';
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
/* ----- alerta para quien ve a los técnicos: contador en la pestaña y barra arriba cuando alguien lleva 15 min o más sin señal dentro del horario -----
   Se consulta cada 2 minutos con la app abierta (y cada 10 fuera de horario, cuando no hay nada que avisar). Es solo una pregunta liviana: no baja ninguna posición. */
const TAL={sin:[],umbral:15,busy:false,avisados:{},started:false,fuera:false,ts:0,oculta:{k:'',hasta:0}};
async function tecAlertaCargar(){
  if(TAL.busy||!can('verTecnicos')||!NET.token||document.hidden)return;
  if(TAL.fuera&&Date.now()-TAL.ts<600e3)return;
  TAL.busy=true;
  try{
    const r=await NET.api('GET','/api/ubicaciones/alerta',undefined,{noKick:true,timeout:15000});
    TAL.ts=Date.now();TAL.umbral=r.umbral;TAL.fuera=!r.dentro;TAL.sin=r.dentro?r.sin:[];
    const ids=new Set(TAL.sin.map(x=>x.id));
    Object.keys(TAL.avisados).forEach(k=>{if(!ids.has(k))delete TAL.avisados[k];});   /* volvió: si se vuelve a cortar, se avisa otra vez */
    const nuevos=TAL.sin.filter(x=>!TAL.avisados[x.id]);
    if(nuevos.length){
      nuevos.forEach(x=>{TAL.avisados[x.id]=1;});
      toast(nuevos.length===1?nuevos[0].nombre+' lleva '+durTxt(nuevos[0].min)+' sin señal':nuevos.length+' técnicos llevan más de '+TAL.umbral+' min sin señal','bad');
      try{if(navigator.vibrate)navigator.vibrate([200,100,200]);}catch(e){}
    }
  }catch(e){/* sin conexión: queda lo último que se supo */}
  TAL.busy=false;tecAlertaBarra();renderTabs();
}
function tecAlertaBarra(){
  const bar=$('#tecBar');if(!bar)return;
  const key=TAL.sin.map(x=>x.id).sort().join(',');
  if(!can('verTecnicos')||S.gate||!TAL.sin.length||S.tab==='tecnicos'||(TAL.oculta.k===key&&Date.now()<TAL.oculta.hasta)){bar.hidden=true;return;}
  bar.innerHTML=`<span><b>${TAL.sin.length===1?'1 técnico':TAL.sin.length+' técnicos'} sin señal en horario:</b> ${TAL.sin.map(x=>esc(x.nombre)+' ('+esc(durTxt(x.min))+(x.motivo?' · '+esc(motCorto(x.motivo)):'')+')').join(', ')}.</span><span class="jr-btns"><button class="btn small ghost" type="button" id="tb-ocultar">Ocultar 30 min</button><button class="btn small" type="button" id="tb-ver">Ver técnicos</button></span>`;
  bar.hidden=false;
  $('#tb-ver',bar).addEventListener('click',()=>showTab('tecnicos'));
  $('#tb-ocultar',bar).addEventListener('click',()=>{TAL.oculta={k:key,hasta:Date.now()+30*60e3};tecAlertaBarra();});
}
function tecAlertaInit(){
  if(TAL.started||!can('verTecnicos'))return;TAL.started=true;
  tecAlertaCargar();
  setInterval(tecAlertaCargar,120000);   /* la alerta salta a los 15 min sin señal: preguntar cada 2 minutos alcanza */
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)tecAlertaCargar();});
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
/* ----- horas trabajadas: resumen por día y por semana (la oficina) y «mis horas» (cada técnico) ----- */
const HR={desde:'',data:null,err:'',busy:false};
/* la hora de Argentina (UTC−3), sin importar en qué zona esté el celular: así lo que se ve coincide con lo que el servidor cuenta */
const hhmmAR=ts=>new Date(ts-3*36e5).toISOString().slice(11,16);
const hm=m=>Math.floor(m/60)+':'+String(m%60).padStart(2,'0');   /* 5:10 */
const horasTxt=m=>m>0?durTxt(m):'0 h';                              /* 5 h 10 min */
const horasDec=m=>(m/60).toFixed(2).replace('.',',');               /* 5,17 */
const fechaCorta=f=>f.slice(8)+'/'+f.slice(5,7);
const diaLetra=f=>['D','L','M','M','J','V','S'][new Date(f+'T12:00:00Z').getUTCDay()];
const diaNombre=f=>['domingo','lunes','martes','miércoles','jueves','viernes','sábado'][new Date(f+'T12:00:00Z').getUTCDay()];
const sumaDias=(f,n)=>new Date(Date.parse(f+'T12:00:00Z')+n*864e5).toISOString().slice(0,10);
const mapHoras=x=>x.estado==='sin_registro'?'–':hm(x.min);
/* qué quiere decir cada estado del día, en una frase */
function horasEstadoTxt(x){
  if(x.estado==='corregido')return 'Cargado a mano por '+(x.ajuste&&x.ajuste.por||'la oficina')+(x.ajuste&&x.ajuste.nota?': '+x.ajuste.nota:'')+'.';
  if(x.estado==='incompleto')return 'Falta el regreso a la base: se cuenta hasta la última posición recibida. Revisalo y corregilo si hace falta.';
  if(x.estado==='en_curso')return 'En curso: se cuenta hasta ahora.';
  if(x.estado==='sin_registro')return 'Sin registro ese día.';
  return 'Completo.'+(x.estimado?' La tarde se cuenta desde que empezó, porque no se vio al técnico en la base al retomar.':'');
}
const horasSegsTxt=x=>(x.segs||[]).map(g=>hhmmAR(g[0])+'-'+hhmmAR(g[1])).join(' | ');
async function horasCargar(){
  if(HR.busy)return;HR.busy=true;
  try{HR.data=await NET.api('GET','/api/jornada/horas'+(HR.desde?'?desde='+encodeURIComponent(HR.desde)+'&dias=7':''),undefined,{noKick:true,timeout:20000});HR.err='';if(!HR.desde)HR.desde=HR.data.desde;}
  catch(e){HR.err=e&&e.message||'No se pudieron cargar las horas.';}
  HR.busy=false;horasRender();
}
function horasRender(){
  const out=$('#hr-out');if(!out)return;
  const d=HR.data;
  if(!d){out.innerHTML=HR.err?`<div class="notice bad">${esc(HR.err)}</div>`:'<div class="hint">Cargando…</div>';return;}
  const esAct=d.desde<=d.hoy&&d.hoy<=d.hasta;
  const nav=`<div class="line hr-nav"><button class="btn small ghost" type="button" data-hr-nav="-7" aria-label="Semana anterior">‹</button><b>Semana del ${esc(fechaCorta(d.desde))} al ${esc(fechaCorta(d.hasta))}</b><button class="btn small ghost" type="button" data-hr-nav="7" aria-label="Semana siguiente"${d.hasta>=d.hoy?' disabled':''}>›</button>${esAct?'':'<button class="btn small ghost" type="button" data-hr-nav="0">Esta semana</button>'}</div>`;
  const tot=d.tecnicos.reduce((a,t)=>a+t.total,0),inc=d.tecnicos.reduce((a,t)=>a+t.incompletos,0);
  const alerta=inc?`<div class="notice" role="status" id="hr-alerta">Hay <b>${inc} ${inc===1?'día':'días'} sin cerrar</b> (no se vio volver a la base). Tocalos para revisarlos.</div>`:'';
  const tarjetas=d.tecnicos.length?d.tecnicos.map(t=>`<article class="card tcard"><div class="head-row"><h3 style="overflow-wrap:anywhere">${esc(t.nombre)}</h3><div class="hr-tot" title="${esc(horasDec(t.total))} h">${esc(horasTxt(t.total))}</div></div>
    <div class="hrgrid">${t.dias.map(x=>`<button type="button" class="hrc ${x.estado}${x.dia===d.hoy?' hoy':''}" data-hr="${esc(t.id)}|${esc(x.dia)}" aria-label="${esc(t.nombre+', '+diaNombre(x.dia)+' '+fechaCorta(x.dia)+': '+(x.estado==='sin_registro'?'sin registro':horasTxt(x.min)))}"><span class="hrl">${diaLetra(x.dia)} ${esc(x.dia.slice(8))}</span><b>${esc(mapHoras(x))}${x.estado==='corregido'?'*':''}</b></button>`).join('')}</div>
    <div class="small muted">Promedio por día trabajado: ${esc(promDia(t))}${t.corregidos?' · * cargado a mano':''}</div></article>`).join(''):'<div class="empty"><b>No hay técnicos cargados</b></div>';
  out.innerHTML=`${nav}${alerta}<div class="small muted">Horas de todos los técnicos en la semana: <b>${esc(horasTxt(tot))}</b>. Cada casilla es un día (horas:minutos). Tocá una para ver el detalle${isAdmin()?' y corregirla':''}.</div>${tarjetas}
    <div class="actions start"><button class="btn small" type="button" id="hr-copy">Copiar el resumen</button><button class="btn small" type="button" id="hr-csv">Descargar CSV</button></div>`;
}
function promDia(t){const dd=t.dias.filter(x=>x.min>0);return dd.length?horasTxt(Math.round(t.total/dd.length)):'–';}
function horasTexto(d){
  const L=['Horas trabajadas · semana del '+fechaCorta(d.desde)+' al '+fechaCorta(d.hasta)];
  for(const t of d.tecnicos){
    L.push('',t.nombre+': '+horasTxt(t.total)+' ('+horasDec(t.total)+' h)');
    for(const x of t.dias)if(x.estado!=='sin_registro')L.push('  '+diaNombre(x.dia).slice(0,3)+' '+fechaCorta(x.dia)+': '+horasTxt(x.min)+(x.estado==='incompleto'?' (sin cerrar)':x.estado==='corregido'?' (corregido)':x.estado==='en_curso'?' (en curso)':''));
  }
  return L.join('\n');
}
function horasCsv(d){
  const rows=[['Técnico','Fecha','Día','Horas (h:mm)','Horas (decimal)','Estado','Tramos','Nota']];
  for(const t of d.tecnicos){
    for(const x of t.dias)if(x.estado!=='sin_registro')rows.push([t.nombre,x.dia,diaNombre(x.dia),hm(x.min),horasDec(x.min),x.estado,horasSegsTxt(x),x.ajuste&&x.ajuste.nota||'']);
    rows.push([t.nombre,'TOTAL','',hm(t.total),horasDec(t.total),'','','']);
  }
  return toCsv(rows);
}
/* detalle de un día de un técnico (con «Corregir» para el administrador) */
function horaDetalle(tid,dia){
  const d=HR.data;if(!d)return;
  const t=d.tecnicos.find(x=>x.id===tid),x=t&&t.dias.find(y=>y.dia===dia);if(!x)return;
  const origen=x.origen==='base'?'Ingresó en la base':x.origen==='manual'?'Inició a mano':x.origen==='oficina'?'Cargado por la oficina':'';
  openModal({title:`${t.nombre} · ${diaNombre(dia)} ${fechaCorta(dia)}`,html:`<div class="hr-big">${esc(x.estado==='sin_registro'?'Sin registro':horasTxt(x.min))}</div>
    ${x.estado==='sin_registro'?'':`<div class="small muted">${esc(horasDec(x.min))} horas</div>`}
    <p class="${x.estado==='incompleto'?'notice':'small'}">${esc(horasEstadoTxt(x))}</p>
    ${x.segs&&x.segs.length?`<ul class="plain">${x.segs.map(g=>`<li>${esc(hhmmAR(g[0]))} a ${esc(hhmmAR(g[1]))} · ${esc(horasTxt(Math.round((g[1]-g[0])/60000)))}</li>`).join('')}</ul>`:''}
    ${origen&&x.estado!=='corregido'?`<div class="small muted">${esc(origen)}${x.regreso?' · último regreso a la base '+esc(hhmmAR(x.regreso)):''}</div>`:''}
    <div class="actions">${d.puedeAjustar?'<button class="btn primary" type="button" id="hd-corr">Corregir las horas</button>':''}<button class="btn ghost" type="button" data-close>Cerrar</button></div>`,
    onMount(el){const b=$('#hd-corr',el);if(b)b.addEventListener('click',()=>{closeModal();horaCorregir(t,x);});}});
}
function horaCorregir(t,x){
  const dia=x.dia,tr=(x.tramos&&x.tramos.length?x.tramos:[[8,20]]),dos=tr.length>1||(x.segs&&x.segs.length>1);
  const segs=(x.segs&&x.segs.length?x.segs:[]).map(g=>[hhmmAR(g[0]),hhmmAR(g[1])]);
  while(segs.length<(dos?2:1))segs.push(['','']);
  const campo=(i,k,v)=>`<input id="hc-${k}${i}" type="time" step="60" value="${esc(v)}" aria-label="${k==='a'?'Desde':'Hasta'} (tramo ${i+1})">`;
  openModal({title:`Corregir · ${t.nombre} · ${fechaCorta(dia)}`,html:`<form class="form" id="hc-form" novalidate><div class="hint">Cargá a qué hora empezó y a qué hora terminó de trabajar${dos?' en cada tramo (mañana y tarde)':''}. Lo que cargues reemplaza el cálculo automático de ese día y queda marcado como corregido.</div>
    ${segs.map((g,i)=>`<div class="grid2">${F((dos?(i?'Tarde':'Mañana')+' · ':'')+'Desde','hc-a'+i,campo(i,'a',g[0]))}${F((dos?(i?'Tarde':'Mañana')+' · ':'')+'Hasta','hc-b'+i,campo(i,'b',g[1]))}</div>`).join('')}
    ${F('Motivo (queda anotado)','hc-n',`<input id="hc-n" maxlength="200" autocomplete="off" placeholder="Ej.: se le apagó el celular" value="${esc(x.ajuste&&x.ajuste.nota||'')}">`)}
    <div class="actions"><button class="btn ghost" type="button" data-close>Cancelar</button>${x.estado==='corregido'?'<button class="btn ghost" type="button" id="hc-auto">Volver al cálculo automático</button>':''}<button class="btn primary" type="submit">Guardar</button></div></form>`,
    onMount(el){
      const enviar=async body=>{try{await NET.api('POST','/api/jornada/ajuste',Object.assign({uid:t.id,dia},body));toast('Horas guardadas');closeModal();HR.data=null;horasRender();horasCargar();}catch(err){toast(err&&err.message||'No se pudo guardar','bad');}};
      $('#hc-form',el).addEventListener('submit',e=>{
        e.preventDefault();const out=[];
        for(let i=0;i<segs.length;i++){
          const a=$('#hc-a'+i,el).value,b=$('#hc-b'+i,el).value;
          if(!a&&!b)continue;
          if(!a||!b)return toast('Completá «desde» y «hasta» del tramo','bad');
          const ta=Date.parse(dia+'T'+a+':00-03:00');let tb=Date.parse(dia+'T'+b+':00-03:00');if(b==='00:00'&&tb<=ta)tb+=864e5;   /* 00:00 de «hasta» = fin del día */
          if(!(tb>ta))return toast('«Hasta» tiene que ser después de «desde»','bad');
          out.push([ta,tb]);
        }
        if(!out.length)return toast('Cargá al menos un tramo (o tocá «Volver al cálculo automático»)','bad');
        enviar({segs:out,nota:$('#hc-n',el).value});
      });
      const au=$('#hc-auto',el);if(au)au.addEventListener('click',()=>enviar({quitar:true}));
    }});
}
/* ----- cortar el GPS de un técnico a la hora en que se fue (solo el administrador) -----
   Desde esa hora el servidor no guarda más su ubicación, borra lo que ya hubiera guardado y deja esa hora como el fin de su jornada de hoy. */
function openCortarGps(t){
  const d=TU.data;if(!d||d.dia!==d.hoy)return;
  const ahoraAR=hhmmAR(Date.now()),sinIngreso=!t.jornada||!t.jornada.ingreso;
  openModal({title:'Cortar el GPS de '+t.nombre,html:`<form class="form" id="cg-form" novalidate>
    <div class="hint">Elegí <b>a qué hora se fue</b>. Desde esa hora no se guarda más su ubicación, se borra lo que se haya guardado después y esa hora queda como el <b>fin de su jornada de hoy</b>. Mañana arranca normal.</div>
    ${F('Hora a la que se fue (hoy)','cg-h',`<input id="cg-h" type="time" step="60" required value="${ahoraAR}" max="${ahoraAR}">`)}
    ${sinIngreso?'<div class="hint">Todavía no tiene el ingreso anotado hoy, así que solo se corta el GPS (no queda ninguna jornada para cerrar).</div>':''}
    <div class="hint">En el celular del técnico se entera enseguida si tiene la app abierta, y si no, en menos de 10 minutos. Mientras tanto el servidor descarta lo que mande. Si te equivocás, tocá «Reanudar GPS».</div>
    <div class="actions"><button class="btn ghost" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Cortar el GPS</button></div></form>`,
    onMount(el){
      $('#cg-form',el).addEventListener('submit',async e=>{
        e.preventDefault();
        const v=$('#cg-h',el).value;if(!/^\d{2}:\d{2}$/.test(v))return toast('Elegí la hora','bad');
        const ts=Date.parse(d.hoy+'T'+v+':00-03:00');
        if(!(ts<=Date.now()+60e3))return toast('Esa hora todavía no llegó','bad');
        const b=$('#cg-form button[type=submit]',el);b.disabled=true;
        try{
          const r=await NET.api('POST','/api/ubicacion/cortar',{uid:t.id,ts});
          toast('GPS de '+t.nombre+' cortado a las '+hhmmAR(r.corte)+(r.jornada==='cerrada'?' · su jornada terminó ahí':''));
          closeModal();tecCargar();
        }catch(err){b.disabled=false;toast(err&&err.message||'No se pudo cortar','bad');}
      });
    }});
}
async function reanudarGps(t){
  try{await NET.api('POST','/api/ubicacion/reanudar',{uid:t.id});toast('GPS de '+t.nombre+' reanudado');tecCargar();}
  catch(err){toast(err&&err.message||'No se pudo reanudar','bad');}
}
VIEWS.tecnicos={
  mount(el){
    el.innerHTML=`<div class="head-row"><h2>Técnicos</h2><button class="btn small" type="button" id="tu-act">Actualizar</button></div>
      <div class="seg" id="tu-vista" role="group" aria-label="Ver"><button type="button" data-v="pos" aria-pressed="true">Dónde están</button><button type="button" data-v="horas" aria-pressed="false">Horas trabajadas</button></div>
      <div id="tu-pos">
      <p class="muted small" id="tu-horario"></p>
      <p class="muted small" id="tu-base"></p>
      <div class="toolbar"><div class="line"><input id="tu-dia" type="date" aria-label="Día" style="width:auto">${isAdmin()?'<button class="btn small ghost" type="button" id="tu-hz">Cambiar el horario</button><button class="btn small ghost" type="button" id="tu-hoy">Hoy: cortado / de corrido</button><button class="btn small ghost" type="button" id="tu-bs">Base y jornada</button>':''}</div></div>
      <div id="tu-out"></div>
      <p class="muted small">La ubicación se toma solo en el horario indicado. En la app instalada sigue con la pantalla apagada una vez que el técnico la abrió; en el navegador, solo con la página abierta. Si pasan más de 10 minutos sin recibir nada, el técnico figura «Sin señal» y el tramo queda anotado. Cada técnico acepta un aviso antes de empezar.</p>
      </div>
      <div id="hr-wrap" hidden><div id="hr-out"></div><p class="muted small">Las horas salen de la jornada: desde que el celular del técnico llega a la base hasta que vuelve a guardar el vehículo (en un día cortado se cuenta cada tramo y no la siesta). Si un día quedó sin cerrar, se cuenta hasta la última posición recibida y queda marcado para revisar.</p></div>`;
    const vista=v=>{
      TU.vista=v;$('#tu-pos',el).hidden=v!=='pos';$('#hr-wrap',el).hidden=v!=='horas';
      el.querySelectorAll('#tu-vista [data-v]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.v===v)));
      if(v==='horas'){horasRender();horasCargar();}
    };
    $('#tu-vista',el).addEventListener('click',e=>{const b=e.target.closest('[data-v]');if(b)vista(b.dataset.v);});
    $('#hr-wrap',el).addEventListener('click',e=>{
      const n=e.target.closest('[data-hr-nav]');
      if(n){const k=Number(n.dataset.hrNav),base=HR.data?HR.data.desde:'';HR.desde=k===0?'':sumaDias(base,k);HR.data=null;horasRender();horasCargar();return;}
      const c=e.target.closest('[data-hr]');if(c){const [tid,dia]=c.dataset.hr.split('|');horaDetalle(tid,dia);return;}
      if(e.target.closest('#hr-copy')&&HR.data)copyText(horasTexto(HR.data),'Resumen');
      if(e.target.closest('#hr-csv')&&HR.data)saveFile('horas-'+HR.data.desde+'.csv',horasCsv(HR.data));
    });
    $('#tu-out',el).addEventListener('click',e=>{
      const c=e.target.closest('[data-gps-cortar]'),r=e.target.closest('[data-gps-reanudar]'),id=c?c.dataset.gpsCortar:r?r.dataset.gpsReanudar:'';
      const t=id&&TU.data&&TU.data.tecnicos.find(x=>x.id===id);if(!t||!isAdmin())return;
      if(c)openCortarGps(t);else reanudarGps(t);
    });
    $('#tu-act',el).addEventListener('click',()=>{if(TU.vista==='horas')horasCargar();else tecCargar();});
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
