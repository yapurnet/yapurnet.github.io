/* ===== equipos: desde qué teléfonos y navegadores entra cada persona =====
   El servidor registra cada equipo (modelo, app o navegador, IP, lugar aproximado, primer y último uso). Un empleado que entra desde un
   equipo nuevo queda «esperando aprobación» y no ve nada hasta que el administrador lo aprueba; cualquier equipo se puede bloquear en el acto. */
const DISP={lista:[],requiere:true,pend:0,loaded:false,loading:false,visto:0};
const dispFecha=ts=>{if(!ts)return '—';const d=new Date(ts);return pad(d.getDate())+'/'+pad(d.getMonth()+1)+' '+pad(d.getHours())+':'+pad(d.getMinutes());};
const DISP_ESTADO={pend:['warn','Esperando tu aprobación'],ok:['ok','Autorizado'],bloq:['bad','Bloqueado']};

/* aviso de arriba (solo el administrador): cuántos equipos esperan */
function dispBar(){
  const b=$('#devBar');if(!b)return;
  const n=S.realRole==='admin'?DISP.pend:0;
  b.hidden=!n;
  if(n)b.textContent=n===1?'1 equipo pide entrar y espera tu aprobación. Tocá para verlo.':n+' equipos piden entrar y esperan tu aprobación. Tocá para verlos.';
}
async function dispRefresh(){
  if(S.realRole!=='admin'||DISP.loading)return;
  DISP.loading=true;
  try{const j=await NET.api('GET','/api/dispositivos');Object.assign(DISP,{lista:j.lista,requiere:j.requiere,pend:j.pend,loaded:true});}
  catch(e){console.error(e);}
  DISP.loading=false;dispBar();dispRender();
}
/* llegó el aviso en vivo de un equipo nuevo */
async function dispAviso(d){
  if(S.realRole!=='admin')return;
  const antes=new Set(DISP.lista.filter(x=>x.estado==='pend').map(x=>x.id));
  await dispRefresh();
  const nuevo=DISP.lista.find(x=>x.estado==='pend'&&!antes.has(x.id));
  if(nuevo)toast(nuevo.nombre+' pide entrar desde '+(nuevo.label||'un equipo nuevo'),'bad');
}
function dispAbrir(){
  showTab('ajustes');
  setTimeout(()=>{const l=$('#aj-disp-list'),c=l&&l.closest('.card');if(c)c.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth',block:'start'});},60);
}
function dispItem(x){
  const [cls,txt]=DISP_ESTADO[x.estado]||['',x.estado];
  const quien=esc(x.nombre)+' · '+esc(ROLE_NAME[x.role]||x.role||'')+' · <span class="mono">'+esc(x.usuario)+'</span>';
  const donde=[x.ip&&'IP <span class="mono">'+esc(x.ip)+'</span>',x.geo&&esc(x.geo)].filter(Boolean).join(' · ');
  const uso=x.estado==='pend'?'Pidió entrar: '+dispFecha(x.creado):'Primer uso: '+dispFecha(x.creado)+' · Último uso: '+dispFecha(x.visto);
  const b=(act,l,c)=>`<button class="btn small${c?' '+c:''}" type="button" data-disp="${esc(x.id)}" data-disp-act="${act}">${l}</button>`;
  const botones=x.estado==='pend'?b('aprobar','Aprobar','primary')+b('bloquear','Bloquear','danger')
    :x.estado==='bloq'?b('aprobar','Permitir de nuevo')+b('quitar','Quitar de la lista')
    :(x.actual?'':b('bloquear','Bloquear','danger')+b('quitar','Cerrar sesión y quitar'));
  return `<div class="item" style="cursor:default"><div><div class="t">${esc(x.label||'Equipo sin datos')}${x.actual?' <span class="muted small">(este equipo)</span>':''}</div>
    <div class="s">${quien}<br>${donde||'<span class="muted">Sin datos de ubicación</span>'}<br>${uso}${x.cod?' · Código <span class="mono">'+esc(x.cod)+'</span>':''}</div></div>
    <div class="side"><span class="chip ${cls}">${txt}</span>${x.estado==='ok'&&x.sesion?'<span class="chip info">Con sesión abierta</span>':''}</div>
    ${botones?`<div class="tags">${botones}</div>`:''}</div>`;
}
function dispRender(){
  const l=$('#aj-disp-list');if(!l)return;
  const req=$('#aj-disp-req');if(req)req.checked=!!DISP.requiere;
  if(!DISP.loaded){l.innerHTML='<div class="hint">Cargando…</div>';return;}
  l.innerHTML=DISP.lista.map(dispItem).join('')||'<div class="empty"><b>Todavía no hay equipos registrados</b><p>Aparecen cuando alguien entra con su usuario.</p></div>';
}
/* tarjeta de Ajustes */
function dispCard(){
  return `<div class="card"><div class="head-row"><h2>Dispositivos</h2><button class="btn small" type="button" id="aj-disp-ref">Actualizar</button></div>
    <p class="muted small">Cada teléfono o navegador desde el que alguien entra con su usuario queda registrado: modelo, si es la app o el navegador, IP, lugar aproximado y cuándo lo usó. Un empleado que entra desde un equipo nuevo <b>no ve nada hasta que lo aprobás</b>, y vos podés bloquear cualquier equipo y se le cierra la sesión en el momento.</p>
    <label class="per"><input type="checkbox" id="aj-disp-req"><span class="grow">Pedir mi aprobación cuando un empleado entra desde un equipo nuevo<br><span class="small muted">Recomendado. Si lo apagás, los equipos nuevos entran solos pero igual quedan en esta lista. Vos (administrador) nunca necesitás aprobación.</span></span></label>
    <div class="list" id="aj-disp-list" style="margin-top:10px"></div>
    <p class="small muted" style="margin:10px 0 0">La ubicación sale de la IP: en datos móviles muestra la ciudad del operador y puede no coincidir con donde está la persona. La app es también un link web, así que no se puede impedir que alguien la abra: lo que se controla es quién <b>entra</b> con una cuenta.</p></div>`;
}
function dispMount(el){
  dispRender();dispRefresh();
  $('#aj-disp-ref',el).addEventListener('click',()=>dispRefresh());
  $('#aj-disp-req',el).addEventListener('change',async e=>{
    const v=e.target.checked;
    try{const j=await NET.api('PATCH','/api/dispositivos',{requiere:v});Object.assign(DISP,{lista:j.lista,requiere:j.requiere,pend:j.pend});dispBar();dispRender();toast(v?'Se pide tu aprobación para los equipos nuevos':'Apagado: los equipos nuevos entran solos');}
    catch(err){e.target.checked=!v;toast(err.network?'No se pudo conectar':err.message,'bad');}
  });
  $('#aj-disp-list',el).addEventListener('click',async e=>{
    const b=e.target.closest('[data-disp-act]');if(!b)return;
    const id=b.dataset.disp,act=b.dataset.dispAct,x=DISP.lista.find(d=>d.id===id);if(!x)return;
    if(act==='bloquear'&&!await askConfirm('¿Bloquear este equipo? Se le cierra la sesión en el momento y no puede volver a entrar con nadie.\n\n'+(x.label||'Equipo')+' · '+x.nombre,'Bloquear'))return;
    if(act==='quitar'&&!await askConfirm('¿Quitar este equipo de la lista? Se cierra su sesión. Si vuelve a entrar, vas a tener que aprobarlo de nuevo.','Quitar'))return;
    b.disabled=true;
    try{
      const j=await NET.api('POST','/api/dispositivos/'+encodeURIComponent(id),{accion:act});
      Object.assign(DISP,{lista:j.lista,requiere:j.requiere,pend:j.pend});dispBar();dispRender();
      toast(act==='aprobar'?'Equipo aprobado: ya puede entrar':act==='bloquear'?'Equipo bloqueado':'Equipo quitado');
    }catch(err){b.disabled=false;toast(err.network?'No se pudo conectar':err.message,'bad');dispRefresh();}
  });
}

/* ===== consumo del servidor: qué gasta el cupo diario del plan gratis de Cloudflare ===== */
async function openUso(){
  let j;
  try{j=await NET.api('GET','/api/uso');}catch(err){return toast(err.message||'No se pudo leer el consumo','bad');}
  const nf=n=>Number(n).toLocaleString('es-AR');
  const hm=s=>Math.floor(s/3600)+' h '+pad(Math.floor(s%3600/60))+' min';
  const pT=Math.round(j.gbs/13000*100),pP=Math.round(j.total/1000)/100;   /* 13.000 GB-s de tiempo y 100.000 pedidos por día */
  const pct=(n,tope)=>Math.round(n/tope*1000)/10;   /* 5.000.000 filas leídas y 100.000 escritas por día */
  const pL=pct(j.leidas||0,5e6),pE=pct(j.escritas||0,1e5);
  const filas=j.pedidos.map(x=>`<tr><td class="mono small" style="overflow-wrap:anywhere">${esc(x.k)}</td><td style="text-align:right">${nf(x.n)}</td><td style="text-align:right">${nf(x.fl||0)}</td><td style="text-align:right">${nf(x.fe||0)}</td></tr>`).join('')||'<tr><td colspan="4" class="muted">Todavía no hay datos de hoy.</td></tr>';
  const sseAviso=j.sse>0?`<div class="notice warn">Hay <b>${j.sse}</b> pantalla${j.sse===1?'':'s'} conectada${j.sse===1?'':'s'} por el método viejo (SSE): mientras estén así, el servidor no se duerme nunca y gasta tiempo las 24 horas. Se corrige solo al volver a abrir la app.</div>`:'';
  openModal({title:'Consumo del servidor · hoy',wide:true,html:`
    <div class="hint">Cuenta el día como Cloudflare: de las 21:00 de ayer a las 21:00 de hoy (hora de Argentina). Los números son aproximados.</div>
    <dl class="kv">
      <dt>Tiempo encendido</dt><dd>${hm(j.despierto)} · <b>${pT} %</b> del tope diario (13.000 GB-s)</dd>
      <dt>Freno de la ubicación</dt><dd>${j.freno&&j.freno.nivel?`<b>Activo (nivel ${j.freno.nivel})</b>: el día va en el ${j.freno.uso} % del cupo, así que la ubicación de los técnicos se guarda más espaciada.`:`Apagado (el día va en el ${j.freno?j.freno.uso:0} % del cupo; se activa al llegar al 60 %).`}</dd>
      <dt>Pedidos</dt><dd>${nf(j.total)} (el tope son 100.000 por día)</dd>
      <dt>Filas leídas de la base</dt><dd>${nf(j.leidas||0)} · <b>${String(pL).replace('.',',')} %</b> del tope diario (5.000.000)</dd>
      <dt>Filas escritas en la base</dt><dd>${nf(j.escritas||0)} · <b>${String(pE).replace('.',',')} %</b> del tope diario (100.000)</dd>
      <dt>Pantallas conectadas ahora</dt><dd>${j.ws} por WebSocket${j.sse?' · '+j.sse+' por SSE':''}</dd>
      <dt>Routers con pruebas de conexión</dt><dd>${j.routersPing}</dd>
    </dl>
    ${sseAviso}
    <h3 style="margin-top:12px">Qué pidió más</h3>
    <div class="tbl-wrap"><table><thead><tr><th>Pedido</th><th style="text-align:right">Veces</th><th style="text-align:right">Filas leídas</th><th style="text-align:right">Filas escritas</th></tr></thead><tbody>${filas}</tbody></table></div>
    <div class="actions"><button class="btn primary" type="button" data-close>Listo</button></div>`});
}
