/* ===== routers MikroTik: cada router manda su lista (solo lectura) y de ahí se importan clientes =====
   El sistema no se conecta a los routers ni guarda usuario o clave de ninguno. Se pega un script en cada router que
   LEE colas, secretos PPPoE (sin contraseñas) y leases DHCP estáticos y se los manda a este servidor. */
const RT={list:[],loaded:false,loading:false};
const RT_KINDS={q:['IP fija','colas simples'],p:['PPPoE','secretos y perfiles'],d:['DHCP','leases estáticos']};
const RT_TIPO={fija:'IP fija',dhcp:'DHCP',pppoe:'PPPoE'};
const rtClean=v=>{v=String(v==null?'':v).trim();return v==='nil'?'':v;};
/* "20M/10M" · "20000000/10000000" · "512k" → {up,down} en Mbps (en MikroTik el primer número es la subida) */
function rtRate(s){
  const t=rtClean(s).split(/\s+/)[0];if(!t)return null;
  const one=x=>{const m=String(x).match(/^(\d+(?:\.\d+)?)([kKmMgG])?$/);if(!m)return null;const n=Number(m[1]),u=(m[2]||'').toLowerCase();return u==='g'?n*1000:u==='m'?n:u==='k'?n/1000:n/1e6;};
  const p=t.split('/'),up=one(p[0]),down=p.length>1?one(p[1]):up;
  return up==null||down==null||(up<=0&&down<=0)?null:{up,down};
}
const rtRateTxt=r=>r?mbpsStr(r.up)+'/'+mbpsStr(r.down):'';
/* una sola IPv4 (con o sin /32); lo demás (rangos, listas, nombres) no es un cliente */
function rtIpOne(t){
  const m=rtClean(t).match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/32)?$/);
  if(!m||m.slice(1).some(x=>Number(x)>255))return '';
  const ip=m.slice(1).map(Number).join('.');
  return ip==='0.0.0.0'?'':ip;
}
/* junta lo que mandó el router en una lista de clientes posibles (una fila por IP o por usuario PPPoE) */
function rtBuild(lines){
  const Q=[],P=[],D=[],F=new Map();
  (lines||[]).forEach(l=>{
    const t=l[0];
    if(t==='Q')Q.push({name:rtClean(l[1]),target:l[2],max:l[3],dis:l[4]==='true',parent:rtClean(l[5])==='none'?'':rtClean(l[5]),comment:rtClean(l[6])});
    else if(t==='P')P.push({name:rtClean(l[1]),service:rtClean(l[2]),profile:rtClean(l[3]),remote:l[4],dis:l[5]==='true',comment:rtClean(l[6])});
    else if(t==='F')F.set(rtClean(l[1]),rtClean(l[2]));
    else if(t==='D')D.push({ip:l[1],mac:rtClean(l[2]),server:rtClean(l[3]),dis:l[4]==='true',comment:rtClean(l[5])});
  });
  const E=new Map(),res={items:[],otros:0,repetidos:0,vpn:0};
  const mk=key=>{let e=E.get(key);if(!e){e={key,ip:'',nombre:'',tipo:'fija',usuario:'',mac:'',rate:null,perfil:'',dis:false,fuentes:[]};E.set(key,e);}return e;};
  Q.forEach(q=>{
    const ip=rtIpOne(q.target);
    if(!ip){res.otros++;return;}
    const had=E.has(ip),e=mk(ip);
    if(had&&e.fuentes.includes('cola')){res.repetidos++;return;}
    e.ip=ip;e.nombre=q.name;e.rate=rtRate(q.max);e.dis=e.dis||q.dis;e.fuentes.push('cola');
  });
  D.forEach(d=>{
    const ip=rtIpOne(d.ip);if(!ip)return;
    const e=mk(ip);e.ip=ip;e.tipo='dhcp';e.mac=d.mac;if(!e.nombre)e.nombre=d.comment;e.dis=e.dis||d.dis;e.fuentes.push('dhcp');
  });
  P.forEach(p=>{
    if(!p.name)return;
    if(p.service&&!/^(pppoe|any)$/i.test(p.service)){res.vpn++;return;}   // VPN y otros servicios: no son clientes
    const ip=rtIpOne(p.remote),e=mk(ip||'u:'+p.name.toLowerCase());
    if(ip)e.ip=ip;
    e.tipo='pppoe';e.usuario=p.name;e.perfil=p.profile;e.dis=e.dis||p.dis;e.fuentes.push('pppoe');
    if(!e.nombre)e.nombre=p.comment||p.name;
    if(!e.rate&&F.get(p.profile))e.rate=rtRate(F.get(p.profile));
  });
  res.items=[...E.values()].map(e=>{if(!e.nombre)e.nombre=e.ip||e.usuario;return e;}).sort((a,b)=>a.nombre.localeCompare(b.nombre,'es'));
  return res;
}
const rtNameKey=s=>norm(s).replace(/[^a-z0-9]+/g,' ').trim();
/* compara con los clientes ya cargados y con los planes: estado («nuevo» o «existe») y plan por velocidad */
function rtMatch(items){
  const byIp=new Map(),byUser=new Map(),byName=new Map();
  for(const c of S.clientes.values()){
    const ip=rtIpOne(c.ip);if(ip&&!byIp.has(ip))byIp.set(ip,c);
    const u=String(c.usuario||'').trim().toLowerCase();if(u&&!byUser.has(u))byUser.set(u,c);
    const k=rtNameKey(c.nombre);if(k&&!byName.has(k))byName.set(k,c);
  }
  const planes=[...S.planes.values()].filter(p=>Number(p.bajada)>0||Number(p.subida)>0);
  const same=(a,b)=>Math.abs(a-b)<=Math.max(0.01,a*0.02);
  const sinPlan=new Map();
  items.forEach(e=>{
    const c=(e.ip&&byIp.get(e.ip))||(e.usuario&&byUser.get(e.usuario.toLowerCase()))||byName.get(rtNameKey(e.nombre))||null;
    e.existe=c?c.id:null;
    e.planId=null;
    if(e.rate){
      const p=planes.find(p=>same(Number(p.bajada)||0,e.rate.down)&&same(Number(p.subida)||Number(p.bajada)||0,e.rate.up));
      if(p)e.planId=p.id;else sinPlan.set(rtRateTxt(e.rate),(sinPlan.get(rtRateTxt(e.rate))||0)+1);
    }
  });
  return {sinPlan:[...sinPlan.entries()].sort((a,b)=>b[1]-a[1])};
}

/* ----- script que se pega en el router ----- */
function rtScript(r,token){
  const k=r.kinds,has=x=>k.includes(x);
  const flush=`    :if ((!$abort) && ([:len $lines] > $tanda)) do={
      :local ok [$enviar url=$url token=$token run=$run part=$part fin=0 body=$lines]
      :if (!$ok) do={ :set ok [$enviar url=$url token=$token run=$run part=$part fin=0 body=$lines] }
      :if ($ok) do={ :set part ($part + 1); :set lines "" } else={ :set abort true }
    }`;
  /* cada propiedad se lee por separado: si una no existe, el registro igual se manda */
  const props=(path,list)=>list.map(([v,n])=>`      :local ${v} ""\n      :do { :set ${v} [:tostr [${path} get $i ${n}]] } on-error={}`).join('\n');
  const section=(find,path,tag,list,extra)=>`:foreach i in=[${find}] do={
  :if (!$abort) do={
    :do {
${props(path,list)}
${extra||''}      :set lines ($lines . "${tag}\\t" . ${list.map(x=>'$'+x[0]).join(' . "\\t" . ')} . "\\n")
      :set total ($total + 1)
    } on-error={}
${flush}
  }
}`;
  const cut='      :if ([:len $cm] > 50) do={ :set cm [:pick $cm 0 50] }\n';
  const parts=[];
  if(has('q'))parts.push('# --- colas simples (clientes con IP fija) ---\n'+section('/queue simple find where dynamic=no','/queue simple','Q',[['nm','name'],['tg','target'],['ml','max-limit'],['ds','disabled'],['pr','parent'],['cm','comment']],cut));
  if(has('d'))parts.push('# --- leases DHCP estáticos ---\n'+section('/ip dhcp-server lease find where dynamic=no','/ip dhcp-server lease','D',[['ad','address'],['mc','mac-address'],['sv','server'],['ds','disabled'],['cm','comment']],cut));
  if(has('p')){
    parts.push('# --- perfiles PPPoE (solo nombre y velocidad) ---\n'+section('/ppp profile find','/ppp profile','F',[['nm','name'],['rl','rate-limit']]));
    parts.push('# --- secretos PPPoE (la contraseña NO se lee ni se envía) ---\n'+section('/ppp secret find','/ppp secret','P',[['nm','name'],['sv','service'],['pf','profile'],['ra','remote-address'],['ds','disabled'],['cm','comment']],cut));
  }
  const lee=[has('q')&&'las colas simples',has('d')&&'los leases DHCP estáticos',has('p')&&'los secretos y perfiles PPPoE (sin contraseñas)'].filter(Boolean).join(', ');
  const body=`# YAPUR.NET - envío de clientes (SOLO LECTURA)
# Lee ${lee} de este router y los manda a ${location.origin}.
# No cambia nada en el router y no envía contraseñas.
:local url "${location.origin}/api/router/ingest"
:local token "${token}"
:local tanda 3000
:local run [:rndnum from=100000 to=999999999]
:local part 1
:local total 0
:local abort false
:local ident [/system identity get name]
:local ros [/system resource get version]
:local lines ("#\\t" . $ident . "\\t" . $ros . "\\n")
:local enviar do={
  :local ok false
  :do {
    /tool fetch url=($url . "?run=" . $run . "&part=" . $part . "&fin=" . $fin) http-method=post http-header-field=("Content-Type: text/plain,Authorization: Bearer " . $token) http-data=$body output=none keep-result=no check-certificate=no
    :set ok true
  } on-error={ :set ok false }
  :return $ok
}
${parts.join('\n')}
# --- cierre ---
:if (!$abort) do={
  :set lines ($lines . "#\\tfin\\n")
  :local ok [$enviar url=$url token=$token run=$run part=$part fin=1 body=$lines]
  :if (!$ok) do={ :set ok [$enviar url=$url token=$token run=$run part=$part fin=1 body=$lines] }
  :if (!$ok) do={ :set abort true }
}
:if ($abort) do={
  :put "YAPUR: NO se pudo enviar la lista (la anterior queda como estaba)."
  :do { :log warning "YAPUR: no se pudo enviar la lista de clientes" } on-error={}
} else={
  :put ("YAPUR: listo, " . $total . " registros enviados en " . $part . " tanda(s).")
  :do { :log info ("YAPUR: " . $total . " registros enviados") } on-error={}
}`;
  /* el terminal de MikroTik no siempre respeta las tildes: el script va en ASCII puro */
  const ascii=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x09\x0a\x20-\x7e]/g,'?');
  return ascii(`:do { /system script remove [find name="yapur-clientes"] } on-error={}\n/system script add name=yapur-clientes policy=read,test comment="YAPUR.NET envia clientes (solo lectura)" source={\n${body}\n}`);
}
const rtSched=()=>`/system scheduler add name=yapur-clientes interval=1d start-time=03:30:00 policy=read,test comment="YAPUR.NET envia clientes" on-event="/system script run yapur-clientes"`;
const rtTest=()=>`/tool fetch url="${location.origin}/api/status" output=user`;

/* ----- pantalla en Ajustes ----- */
function rtAgo(ts){
  if(!ts)return '';
  const m=Math.max(0,Math.round((Date.now()-ts)/60000));
  return m<2?'recién':m<60?'hace '+m+' min':m<2880?'hace '+Math.round(m/60)+' h':'hace '+Math.round(m/1440)+' días';
}
async function loadRouters(){
  if(RT.loading)return;RT.loading=true;
  try{const j=await NET.api('GET','/api/routers');RT.list=j.routers;RT.loaded=true;}catch(e){console.error(e);}
  RT.loading=false;renderRouters();
}
function renderRouters(){
  const l=$('#aj-routers');if(!l)return;
  if(!RT.loaded){l.innerHTML='<div class="hint">Cargando…</div>';return;}
  l.innerHTML=RT.list.map(r=>{
    const old=r.visto&&Date.now()-r.visto>36*3600e3;
    const st=r.hayDatos?`<span class="${old?'bad':''}">Última lista ${esc(rtAgo(r.visto))}${old?' (hace mucho: revisá que el router siga enviando)':''}</span> · ${r.total} registros${r.ident?' · '+esc(r.ident):''}${r.ros?' · RouterOS '+esc(r.ros):''}`:'Todavía no mandó ninguna lista';
    return `<div class="item" style="cursor:default"><div><div class="t">${esc(r.nombre)}</div><div class="s">${r.kinds.map(k=>esc(RT_KINDS[k][0])).join(' · ')}</div><div class="s">${st}</div></div>
      <div class="tags">${r.hayDatos?`<button class="btn small primary" type="button" data-rt="det" data-id="${esc(r.id)}">Clientes detectados</button>`:''}<button class="btn small" type="button" data-rt="script" data-id="${esc(r.id)}">Script</button><button class="btn small" type="button" data-rt="edit" data-id="${esc(r.id)}">Editar</button></div></div>`;
  }).join('')||'<div class="empty"><b>No hay routers cargados</b><span>Agregá el primero para que mande la lista de sus clientes.</span></div>';
}
function kindsBoxHTML(cur){
  return Object.entries(RT_KINDS).map(([k,[a,b]])=>`<label class="per"><input type="checkbox" data-kind="${k}"${cur.includes(k)?' checked':''}><span class="grow">${esc(a)}<br><span class="small muted">Lee ${esc(b)}</span></span></label>`).join('');
}
const readKinds=el=>$$('[data-kind]',el).filter(i=>i.checked).map(i=>i.dataset.kind);
function openRouterForm(id){
  const r=id?RT.list.find(x=>x.id===id):null;
  const html=`<form class="form" id="rtform" novalidate>${F('Nombre del router','rt-nombre',`<input id="rt-nombre" autocomplete="off" maxlength="40" placeholder="ADMIN02" value="${esc(r?r.nombre:'')}">`)}
    <div class="fgroup"><div class="legend">Qué clientes tiene este router</div>${kindsBoxHTML(r?r.kinds:['q'])}<div class="hint">Marcá solo lo que usa: cada opción hace que el script lea esa parte del router.</div></div>
    <div class="actions">${r?'<button class="btn danger" type="button" id="rt-del">Borrar</button>':''}<button class="btn ghost" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">${r?'Guardar':'Crear y ver el script'}</button></div></form>`;
  openModal({title:r?'Editar router':'Agregar router',html,onMount(el){
    $('#rtform',el).addEventListener('submit',async e=>{
      e.preventDefault();
      const nombre=$('#rt-nombre',el).value.trim(),kinds=readKinds(el);
      if(!nombre)return toast('Falta el nombre del router','bad');
      if(!kinds.length)return toast('Marcá al menos una opción','bad');
      try{
        if(r){await NET.api('PATCH','/api/routers/'+r.id,{nombre,kinds});toast('Router guardado');closeModal();await loadRouters();}
        else{const j=await NET.api('POST','/api/routers',{nombre,kinds});await loadRouters();openRouterScript(j.router,j.token);}
      }catch(err){toast(err.message||'No se pudo guardar','bad');}
    });
    const del=$('#rt-del',el);
    if(del)del.addEventListener('click',async()=>{
      if(!await askConfirm(`¿Borrar el router ${r.nombre}? Se borra la lista que mandó. Los clientes que ya importaste no se tocan. Si el router tiene el script, deja de poder enviar.`,'Borrar',true))return;
      try{await NET.api('DELETE','/api/routers/'+r.id);toast('Router borrado');closeModal();loadRouters();}catch(err){toast(err.message||'No se pudo borrar','bad');}
    });
  }});
}
function openRouterScript(r,token){
  const script=rtScript(r,token);
  const step=(n,t,body)=>`<div class="card flat"><h3>${n}. ${t}</h3>${body}</div>`;
  const html=`<div class="notice info">Este script <b>solo lee</b> el router y manda la lista a este sistema. No tiene usuario ni clave del router: desde acá no se puede cortar ni cambiar nada. No lleva contraseñas.</div>
    ${step(1,'Probar que el router llega al sistema',`<p class="small muted">En WinBox: <b>Nuevo terminal</b>. Pegá esto; tiene que mostrar un texto con <span class="mono">"ok":true</span>.</p><div class="actions start"><button class="btn small" type="button" data-copy="${esc(rtTest())}" data-copy-label="Prueba">Copiar prueba</button></div>`)}
    ${step(2,'Pegar el script',`<p class="small muted">Pegalo entero en el terminal del router. Crea un script llamado <span class="mono">yapur-clientes</span> (si ya existía, lo reemplaza). Lleva el acceso de este router: no lo compartas.</p><div class="actions start"><button class="btn primary small" type="button" data-copy="${esc(script)}" data-copy-label="Script">Copiar script</button></div>`)}
    ${step(3,'Ejecutarlo una vez a mano',`<p class="small muted">Con <span class="mono">/system script run yapur-clientes</span>. Con miles de clientes puede tardar unos minutos. Al terminar dice «YAPUR: listo, N registros enviados».</p><div class="actions start"><button class="btn small" type="button" data-copy="/system script run yapur-clientes" data-copy-label="Comando">Copiar comando</button></div>`)}
    ${step(4,'Dejarlo programado',`<p class="small muted">Una vez que funcionó, que lo mande solo todos los días a las 03:30.</p><div class="actions start"><button class="btn small" type="button" data-copy="${esc(rtSched())}" data-copy-label="Programación">Copiar programación</button></div>`)}
    <details class="small"><summary>Si algo falla</summary><ul class="small muted">
      <li><b>«not enough permissions»</b>: en algunas versiones <span class="mono">/tool fetch</span> pide también el permiso <span class="mono">write</span>. Cambiá <span class="mono">policy=read,test</span> por <span class="mono">policy=read,write,test</span> en el script y en la programación; el script igual no escribe nada.</li>
      <li><b>«expected end of command … check-certificate»</b>: tu RouterOS es viejo; borrá <span class="mono">check-certificate=no</span> del script.</li>
      <li><b>Error de certificado</b>: dejá <span class="mono">check-certificate=no</span> (el router no trae los certificados de internet). Lo único que viaja es la lista de clientes y el acceso de solo envío.</li>
      <li>Para ver cómo le fue: <span class="mono">/log print where message~"YAPUR"</span></li></ul></details>
    <div class="actions"><button class="btn primary" type="button" data-close>Listo</button></div>`;
  openModal({title:'Script para '+r.nombre,html,wide:true});
}
async function regenScript(id){
  const r=RT.list.find(x=>x.id===id);if(!r)return;
  if(!await askConfirm(`Para mostrar el script se genera un acceso nuevo para ${r.nombre}: el anterior deja de valer. Si el router ya tiene el script puesto, hay que pegarlo de nuevo. ¿Seguir?`,'Generar de nuevo'))return;
  try{const j=await NET.api('POST','/api/routers/'+id+'/token',{});openRouterScript(r,j.token);}catch(err){toast(err.message||'No se pudo generar','bad');}
}

/* ----- clientes detectados e importación ----- */
async function openDetected(id){
  const r0=RT.list.find(x=>x.id===id);if(!r0)return;
  let j;
  try{j=await NET.api('GET','/api/routers/'+id+'/items');}catch(err){return toast(err.message||'No se pudo leer la lista','bad');}
  const r=j.router,built=rtBuild(j.lines),info=rtMatch(built.items),items=built.items;
  const cur=todayStr().slice(0,7);
  const f={tipo:'todos',est:'nuevo',q:''};
  const rows=()=>items.filter(e=>(f.tipo==='todos'||e.tipo===f.tipo)&&(f.est==='todos'||(f.est==='nuevo')===!e.existe)&&(!f.q||rtNameKey(e.nombre+' '+e.ip+' '+e.usuario+' '+e.mac).includes(rtNameKey(f.q))));
  const cnt=fn=>items.filter(fn).length;
  const html=`<div class="kpis"><div class="kpi"><span class="n">${items.length}</span><span class="l">Detectados</span></div><div class="kpi"><span class="n">${cnt(e=>!e.existe)}</span><span class="l">Nuevos</span></div><div class="kpi"><span class="n">${cnt(e=>e.existe)}</span><span class="l">Ya cargados</span></div></div>
    <div class="hint">Lista de ${esc(r.nombre)} de ${esc(rtAgo(r.visto))}. ${built.otros?built.otros+' colas con rangos o varias IP no se toman como clientes. ':''}${built.repetidos?built.repetidos+' colas repetidas con la misma IP. ':''}${built.vpn?built.vpn+' usuarios PPP que no son PPPoE (VPN). ':''}</div>
    <div class="toolbar"><div class="line"><input id="dt-q" class="search" type="search" placeholder="Buscar por nombre, IP, usuario o MAC"></div>
      <div class="seg" id="dt-tipo">${[['todos','Todos'],...Object.entries(RT_TIPO)].map(([k,l])=>`<button type="button" data-t="${k}" aria-pressed="${k==='todos'}">${l}</button>`).join('')}</div>
      <div class="seg" id="dt-est">${[['nuevo','Nuevos'],['existe','Ya cargados'],['todos','Todos']].map(([k,l])=>`<button type="button" data-e="${k}" aria-pressed="${k==='nuevo'}">${l}</button>`).join('')}</div></div>
    <div id="dt-list"></div>
    ${info.sinPlan.length?`<div class="notice">Velocidades que no coinciden con ningún plan: ${info.sinPlan.slice(0,8).map(([k,n])=>esc(k)+' ('+n+')').join(', ')}. Esos clientes se importan sin plan; creá los planes antes si querés que se asignen solos.</div>`:''}
    <div class="grid2">${F('Cobrar desde (mes)','dt-desde',`<input id="dt-desde" type="month" value="${cur}">`,'Antes de este mes no se genera deuda.')}
    ${F('Ciclo de cobro','dt-ciclo',`<select id="dt-ciclo">${[1,2].map(n=>opt(n,'Ciclo '+n+': '+cicloTxt(n),n===1)).join('')}</select>`)}</div>
    <div class="hint">Las colas, secretos o leases deshabilitados se importan como clientes suspendidos. Se guardan IP, usuario PPPoE, MAC y el nombre del router; el resto (teléfono, dirección, DNI) se completa después.</div>
    <div class="actions"><button class="btn ghost" type="button" data-close>Cerrar</button><button class="btn primary" type="button" id="dt-go"></button></div><div class="hint" id="dt-prog"></div>`;
  openModal({title:'Clientes detectados en '+r.nombre,html,wide:true,onMount(el){
    const draw=()=>{
      const l=rows();
      $('#dt-list',el).innerHTML=l.length?`<div class="tbl-wrap"><table><thead><tr><th>Nombre</th><th>IP</th><th>Tipo</th><th>Velocidad</th><th>Plan</th><th></th></tr></thead><tbody>${l.slice(0,80).map(e=>{const p=e.planId&&S.planes.get(e.planId);return `<tr><td>${esc(e.nombre)}${e.usuario&&e.usuario!==e.nombre?` <span class="muted small">(${esc(e.usuario)})</span>`:''}</td><td class="mono">${esc(e.ip||'—')}</td><td>${esc(RT_TIPO[e.tipo])}</td><td>${esc(rtRateTxt(e.rate)||'—')}</td><td>${p?esc(p.nombre):'<span class="muted">sin plan</span>'}</td><td>${e.existe?'<span class="chip">Ya cargado</span>':e.dis?'<span class="chip bad">Suspendido</span>':'<span class="chip ok">Nuevo</span>'}</td></tr>`;}).join('')}</tbody></table></div>${l.length>80?`<div class="hint">Se muestran 80 de ${l.length}. Usá la búsqueda para ver otros.</div>`:''}`:'<div class="empty"><b>No hay nada con ese filtro</b></div>';
      const nuevos=importables();
      const go=$('#dt-go',el);go.textContent=`Importar ${nuevos.length} ${nuevos.length===1?'cliente nuevo':'clientes nuevos'}`;go.disabled=!nuevos.length;
    };
    const importables=()=>items.filter(e=>!e.existe&&(f.tipo==='todos'||e.tipo===f.tipo)&&(!f.q||rtNameKey(e.nombre+' '+e.ip+' '+e.usuario+' '+e.mac).includes(rtNameKey(f.q))));
    $('#dt-q',el).addEventListener('input',e=>{f.q=e.target.value;draw();});
    $('#dt-tipo',el).addEventListener('click',e=>{const b=e.target.closest('[data-t]');if(!b)return;f.tipo=b.dataset.t;$$('#dt-tipo button',el).forEach(x=>x.setAttribute('aria-pressed',String(x===b)));draw();});
    $('#dt-est',el).addEventListener('click',e=>{const b=e.target.closest('[data-e]');if(!b)return;f.est=b.dataset.e;$$('#dt-est button',el).forEach(x=>x.setAttribute('aria-pressed',String(x===b)));draw();});
    $('#dt-go',el).addEventListener('click',async()=>{
      const sel=importables();if(!sel.length)return;
      if(!await askConfirm(`Se van a crear ${sel.length} clientes con lo que tiene el router ${r.nombre}. No se corta ni se cambia nada en el router. ¿Importar?`,'Importar'))return;
      const rowsCsv=[['nombre','ip','usuario','equipo','plan','estado','nodo','notas']].concat(sel.map(e=>{
        const p=e.planId&&S.planes.get(e.planId);
        return [e.nombre,e.ip,e.usuario,e.mac,p?p.nombre:'',e.dis?'suspendido':'',r.nombre,'Importado de '+r.nombre+' ('+RT_TIPO[e.tipo]+(e.rate?', '+rtRateTxt(e.rate):'')+')'];
      }));
      const a=analyzeImport(rowsCsv,{estado:'activo',desde:$('#dt-desde',el).value||cur,ciclo:Number($('#dt-ciclo',el).value)===2?2:1});
      const go=$('#dt-go',el);go.disabled=true;
      try{
        await saveImported(a.recs,(d,t)=>{$('#dt-prog',el).textContent=`Importando… ${d} de ${t}`;});
        toast(a.recs.length+' clientes importados');closeModal();
      }catch(err){dbError(err);go.disabled=false;$('#dt-prog',el).textContent='No se pudo terminar. Revisá cuántos se cargaron y volvé a intentar: los que ya están no se repiten.';}
    });
    draw();
  }});
}
function bindRouters(el){
  $('#aj-newr',el).addEventListener('click',()=>openRouterForm(null));
  $('#aj-refr',el).addEventListener('click',()=>loadRouters());
  $('#aj-routers',el).addEventListener('click',e=>{
    const b=e.target.closest('[data-rt]');if(!b)return;
    const id=b.dataset.id,a=b.dataset.rt;
    if(a==='edit')openRouterForm(id);else if(a==='script')regenScript(id);else if(a==='det')openDetected(id);
  });
  loadRouters();
}
