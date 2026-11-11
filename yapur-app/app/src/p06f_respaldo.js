/* ===== servidor de respaldo =====
   El plan gratis de Cloudflare limita cada cuenta por día. Con un segundo servidor (otra cuenta) que va copiando todo, si el principal llega al tope se sigue trabajando en el otro.
   Hay un solo servidor ACTIVO a la vez; el otro queda EN ESPERA (se puede mirar, no cambiar) y se activa desde acá. Detalle de cómo se configura: LEEME.md. */
const respHace=ts=>{
  if(!ts)return 'nunca';
  const s=Math.max(0,Math.round((Date.now()-ts)/1000));
  if(s<60)return 'hace '+s+' s';
  if(s<3600)return 'hace '+Math.round(s/60)+' min';
  if(s<86400)return 'hace '+Math.round(s/3600)+' h';
  return 'hace '+Math.round(s/86400)+' días';
};
const respHost=u=>{try{return new URL(u).host;}catch(e){return String(u||'');}};

/* cartel de arriba: avisa a todos si este servidor está en espera, o si no responde y hay otro al que ir */
function respBar(){
  const b=$('#respBar');if(!b)return;
  const r=NET.respaldo;
  if(!r||!NET.hasSession()||!S.ready){b.hidden=true;return;}
  if(r.caido&&r.url){
    b.className='jrbar bad';b.hidden=false;
    b.innerHTML=`<span><b>${r.limite?'El servidor llegó al límite de hoy.':'El servidor no responde.'}</b> Hay un servidor de respaldo (${esc(respHost(r.url))}): se abre con tu misma sesión; si te pide entrar, usá tu mismo usuario y clave.</span><span class="jr-btns"><button class="btn small primary" type="button" id="resp-abrir">Abrir el respaldo</button></span>`;
    $('#resp-abrir',b).addEventListener('click',()=>NET.openExternal(NET.enlaceA(r.url)));
    return;
  }
  if(r.rol==='espera'){
    b.className='jrbar warn';b.hidden=false;
    b.innerHTML=`<span><b>Servidor de respaldo en espera.</b> Se puede mirar todo, pero no se puede cambiar nada.${r.url?` El servidor principal está en <a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(respHost(r.url))}</a>.`:''}${S.realRole==='admin'?'':' Si el principal no funciona, avisale al administrador.'}</span>${S.realRole==='admin'?'<span class="jr-btns"><button class="btn small primary" type="button" id="resp-act">Pasar a este servidor</button></span>':''}`;
    const a=$('#resp-act',b);if(a)a.addEventListener('click',respActivar);
    return;
  }
  b.hidden=true;
}

/* el administrador pasa a trabajar en este servidor */
async function respActivar(){
  if(!await askConfirm('¿Pasar a trabajar en ESTE servidor? El otro va a quedar en espera: se podrá mirar pero no cambiar nada. Antes de cambiar, este le pide al otro todo lo que le falte, así no se pierde nada.','Pasar a este servidor'))return;
  try{
    let j;
    try{j=await NET.api('POST','/api/replica/activar',{});}
    catch(err){
      if(err.code!=='par_no_responde')throw err;
      if(!await askConfirm(err.message,'Activar este igual',true))return;
      j=await NET.api('POST','/api/replica/activar',{forzar:true});
    }
    toast(j.modo==='emergencia'?'Este servidor ya trabaja. Cuando el otro vuelva a responder va a recibir todo y quedar en espera.':'Este servidor ya trabaja.');
    setTimeout(()=>location.reload(),1300);
  }catch(err){toast(err.network?'No se pudo conectar con el servidor':err.message,'bad');}
}

/* tarjeta de Ajustes (solo administrador) */
function respAjustesCard(){
  return `<div class="card"><h2>Servidor de respaldo</h2>
    <p class="muted small">Un segundo servidor, en otra cuenta de Cloudflare, que va copiando todo lo que se carga acá. Si este llega al límite diario del plan gratis, se sigue trabajando en el otro.</p>
    <div id="resp-st" class="hint">Mirando el estado…</div>
    <div class="actions start" id="resp-btns" hidden></div></div>`;
}
async function respAjustesMount(el){
  const st=$('#resp-st',el),btns=$('#resp-btns',el);if(!st)return;
  let e;
  try{e=await NET.api('GET','/api/replica/estado');}
  catch(err){
    if(err.status===404){
      st.innerHTML=`<b>No está configurado.</b> Para tenerlo hay que crear una segunda cuenta de Cloudflare con este mismo sistema y cargar en las dos las variables <span class="mono">REPLICA_URL</span> y <span class="mono">REPLICA_KEY</span>. Los pasos están en el manual (LEEME.md, «Servidor de respaldo»).`;
      return;
    }
    st.textContent=err.network?'No se pudo conectar para ver el estado.':(err.message||'No se pudo ver el estado.');return;
  }
  if(!e.configurado){
    st.innerHTML=`<b>Está a medio configurar.</b> ${e.tieneUrl?'':'Falta una <span class="mono">REPLICA_URL</span> válida (la dirección https del otro servidor). '}${e.tieneClave?'':'Falta la <span class="mono">REPLICA_KEY</span> (una clave larga, de 20 caracteres o más, igual en los dos servidores). '}`;
    return;
  }
  const activo=e.rol==='activo',par=e.par||{};
  const filas=[];
  filas.push(['Este servidor',activo?'<b>Activo</b>: es el que está trabajando':'<b>En espera</b>: solo se puede mirar, recibe lo que cambia en el otro']);
  filas.push(['El otro servidor',`<span class="mono">${esc(respHost(e.otro))}</span> · ${par.error?`<span style="color:var(--bad)">no responde (${esc(par.error)})</span>`:par.rol==='activo'?'activo':'en espera'}`]);
  if(activo){
    filas.push(['Cambios por copiar',e.pendientes?`${e.pendientes} (el más viejo, ${respHace(e.masViejo)})`:'ninguno: el otro está al día']);
    if(par.recibido)filas.push(['Última copia recibida por el otro',respHace(par.recibido)]);
    if(e.completoPendiente)filas.push(['Copia completa','pendiente: se manda apenas el otro responda']);
  }else{
    filas.push(['Última copia recibida',par.error?'—':respHace(par.recibido||0)]);
    if(!e.ini)filas.push(['Primera copia','todavía no llegó']);
  }
  if(e.error)filas.push(['Último problema',`${esc(e.error.msg)} (${respHace(e.error.ts)}). Se reintenta solo.`]);
  st.innerHTML=(e.esMismo?'<div class="notice bad">La dirección del otro servidor (<span class="mono">REPLICA_URL</span>) es la de este mismo servidor. Tiene que ser la del otro.</div>':'')+`<dl class="kv">${filas.map(f=>`<dt>${f[0]}</dt><dd>${f[1]}</dd>`).join('')}</dl>`;
  btns.hidden=false;
  btns.innerHTML=`<button class="btn" type="button" id="resp-ref">Actualizar</button>${activo?'<button class="btn" type="button" id="resp-sync">Mandar la copia completa ahora</button>':'<button class="btn primary" type="button" id="resp-act2">Pasar a este servidor</button>'}`;
  $('#resp-ref',el).addEventListener('click',()=>{st.textContent='Mirando el estado…';respAjustesMount(el);});
  const sy=$('#resp-sync',el);
  if(sy)sy.addEventListener('click',async()=>{
    sy.disabled=true;
    try{await NET.api('POST','/api/replica/sincronizar',{});toast('El otro servidor recibió la copia completa');}
    catch(err){toast(err.network?'No se pudo conectar':err.message,'bad');}
    respAjustesMount(el);
  });
  const ac=$('#resp-act2',el);if(ac)ac.addEventListener('click',respActivar);
}
