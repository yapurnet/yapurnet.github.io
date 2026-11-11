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
  const mk=key=>{let e=E.get(key);if(!e){e={key,ip:'',nombre:'',tipo:'fija',usuario:'',mac:'',rate:null,perfil:'',dis:false,fuentes:[],alias:[]};E.set(key,e);}return e;};
  const al=(e,...xs)=>xs.forEach(x=>{x=rtClean(x);if(x&&!/^PON[_ ]?\d+$/i.test(x)&&!e.alias.includes(x))e.alias.push(x);});   /* los otros nombres con que aparece (para emparejar con la ficha) */
  Q.forEach(q=>{
    const ip=rtIpOne(q.target);
    if(!ip){res.otros++;return;}
    const had=E.has(ip),e=mk(ip);
    al(e,q.name,q.comment);
    if(had&&e.fuentes.includes('cola')){res.repetidos++;return;}
    e.ip=ip;e.nombre=q.name;e.rate=rtRate(q.max);e.dis=e.dis||q.dis;e.fuentes.push('cola');
  });
  D.forEach(d=>{
    const ip=rtIpOne(d.ip);if(!ip)return;
    const e=mk(ip);al(e,d.comment);e.ip=ip;e.tipo='dhcp';e.mac=d.mac;if(!e.nombre)e.nombre=d.comment;e.dis=e.dis||d.dis;e.fuentes.push('dhcp');
  });
  P.forEach(p=>{
    if(!p.name)return;
    if(p.service&&!/^(pppoe|any)$/i.test(p.service)){res.vpn++;return;}   // VPN y otros servicios: no son clientes
    const ip=rtIpOne(p.remote),e=mk(ip||'u:'+p.name.toLowerCase());
    al(e,p.comment,p.name.split('@')[0].replace(/[._]+/g,' '));
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
    return `<div class="item" style="cursor:default"><div><div class="t">${esc(r.nombre)}</div><div class="s">${r.kinds.map(k=>esc(RT_KINDS[k][0])).join(' · ')}</div><div class="s">${st}</div><div class="s">${rtPingEstado(r)}</div></div>
      <div class="tags">${r.hayDatos?`<button class="btn small primary" type="button" data-rt="det" data-id="${esc(r.id)}">Clientes detectados</button>`:''}<button class="btn small" type="button" data-rt="script" data-id="${esc(r.id)}">Script</button><button class="btn small" type="button" data-rt="pscript" data-id="${esc(r.id)}">Script de ping</button><button class="btn small" type="button" data-rt="edit" data-id="${esc(r.id)}">Editar</button></div></div>`;
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

/* ----- pruebas de conexión (ping a un cliente): el router consulta si alguien pidió una (cada 10 s mientras alguien prueba, una vez por minuto el resto del tiempo) ----- */
const rtAscii=s=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^\x09\x0a\x20-\x7e]/g,'?');
function rtPingEstado(r){
  if(!r.ping)return '<span class="muted">Pruebas de conexión: sin configurar</span>';
  const seg=r.pingVisto?Math.round((Date.now()-r.pingVisto)/1000):null;
  if(seg!=null&&seg<=150)return '<span style="color:var(--ok)">Pruebas de conexión: atendiendo (hace '+seg+' s)</span>';
  return '<span style="color:var(--bad)">Pruebas de conexión: el router no está consultando'+(r.pingVisto?' (última vez '+esc(rtAgo(r.pingVisto))+')':' todavía')+'</span>';
}
function rtPingScript(token){
  const body=`# YAPUR.NET - pruebas de conexion (ping a la IP de un cliente)
# Pregunta a ${location.origin} si alguien pidio probar un cliente: cada 10 segundos mientras alguien esta probando
# y una sola vez por minuto el resto del tiempo (asi no gasta el cupo diario del sistema).
# Si hay una prueba pedida, le hace 4 pings y avisa cuantos contestaron. No cambia nada en el router.
:global yapurSalto
:if ([:typeof $yapurSalto] != "num") do={ :set yapurSalto 0 }
:if ($yapurSalto > 0) do={
  :set yapurSalto ($yapurSalto - 1)
} else={
  :local base "${location.origin}/api/router/ping"
  :local h "Authorization: Bearer ${token}"
  :local data ""
  :local salto 0
  :do {
    :local r [/tool fetch url=$base http-method=get http-header-field=$h output=user as-value check-certificate=no]
    :set data ($r->"data")
  } on-error={ :set data "" }
  :if ([:len $data] > 0) do={
    :foreach item in=[:toarray $data] do={
      :local p [:find $item ":"]
      :if ([:typeof $p] = "num") do={
        :local id [:pick $item 0 $p]
        :local ip [:pick $item ($p + 1) [:len $item]]
        :local rec 0
        :do { :set rec [/ping address=$ip count=4 interval=250ms] } on-error={ :set rec 0 }
        :do {
          /tool fetch url=($base . "?id=" . $id . "&sent=4&rec=" . $rec) http-method=post http-header-field=$h http-data="x" output=none keep-result=no check-certificate=no
        } on-error={}
        :put ("YAPUR ping: " . $ip . " respondio " . $rec . " de 4")
        :do { :log info ("YAPUR ping: " . $ip . " respondio " . $rec . " de 4") } on-error={}
      } else={
        :if ([:pick $item 0 1] = "s") do={
          :do { :set salto [:tonum [:pick $item 1 [:len $item]]] } on-error={ :set salto 0 }
        }
      }
    }
  }
  :if ($salto > 12) do={ :set salto 12 }
  :set yapurSalto $salto
}`;
  return rtAscii(`:do { /system script remove [find name="yapur-ping"] } on-error={}\n/system script add name=yapur-ping policy=read,test comment="YAPUR.NET prueba de conexion de clientes" source={\n${body}\n}`);
}
const rtPingSched=()=>`/system scheduler add name=yapur-ping interval=10s policy=read,test comment="YAPUR.NET prueba de conexion" on-event="/system script run yapur-ping"`;
function openPingScript(r,token){
  const script=rtPingScript(token);
  const step=(n,t,body)=>`<div class="card flat"><h3>${n}. ${t}</h3>${body}</div>`;
  const html=`<div class="notice info">Con esto, <b>La oficina y los técnicos</b> pueden tocar «Probar conexión» en la ficha de un cliente y ver si contesta. El router solo hace el <b>ping a la IP del cliente</b> y avisa cuántos paquetes volvieron: no lee ni cambia nada más y no lleva contraseñas.</div>
    ${step(1,'Probar que el router llega al sistema',`<p class="small muted">En WinBox: <b>Nuevo terminal</b>. Pegá esto; tiene que mostrar un texto con <span class="mono">"ok":true</span>. Si ya lo probaste con el script de clientes, salteá este paso.</p><div class="actions start"><button class="btn small" type="button" data-copy="${esc(rtTest())}" data-copy-label="Prueba">Copiar prueba</button></div>`)}
    ${step(2,'Pegar el script',`<p class="small muted">Pegalo entero en el terminal del router. Crea un script llamado <span class="mono">yapur-ping</span> (si ya existía, lo reemplaza). Lleva el acceso de este router: no lo compartas.</p><div class="actions start"><button class="btn primary small" type="button" data-copy="${esc(script)}" data-copy-label="Script">Copiar script</button></div>`)}
    ${step(3,'Dejarlo programado',`<p class="small muted">El router corre el script cada 10 segundos, pero el script solo le pregunta al sistema <b>una vez por minuto</b> cuando nadie está probando (y cada 10 segundos mientras alguien prueba). Pegalo en el mismo terminal. <b>Si este router ya tenía la programación, salteá este paso:</b> alcanza con pegar el script nuevo del paso 2.</p><div class="actions start"><button class="btn small" type="button" data-copy="${esc(rtPingSched())}" data-copy-label="Programación">Copiar programación</button></div>`)}
    ${step(4,'Revisar que quedó andando',`<p class="small muted">En un minuto, en <b>Ajustes → Routers</b>, este router tiene que decir <b>«Pruebas de conexión: atendiendo»</b> (tocá <b>Actualizar</b>). Después probalo de verdad: abrí un cliente con IP cargada y tocá <b>Probar conexión</b>.</p>`)}
    <p class="small muted">¿Qué router hace la prueba? Si el <b>Nodo</b> del cliente tiene el nombre de un router con pruebas activas, lo hace ese router; si no, cualquiera que esté atendiendo. Con un solo router, es ese.</p>
    <details class="small"><summary>Si algo falla</summary><ul class="small muted">
      <li><b>«not enough permissions»</b>: en algunas versiones <span class="mono">/tool fetch</span> pide también el permiso <span class="mono">write</span>. Cambiá <span class="mono">policy=read,test</span> por <span class="mono">policy=read,write,test</span> en el script y en la programación.</li>
      <li><b>«expected end of command … check-certificate»</b>: tu RouterOS es viejo; borrá <span class="mono">check-certificate=no</span> del script (las tres veces).</li>
      <li>Para ver los pings que hizo: <span class="mono">/log print where message~"YAPUR"</span></li>
      <li>Para correrlo a mano y ver qué pasa: <span class="mono">/system script run yapur-ping</span></li>
      <li><b>Consultas:</b> en reposo son unas 1.440 por día por router (una por minuto). La primera prueba después de un rato puede tardar hasta un minuto en empezar, salvo que hayas abierto antes la ficha del cliente: ahí el router pasa a consultar cada 10 segundos y contesta enseguida.</li>
      <li>Para apagarlo: <span class="mono">/system scheduler remove [find name=yapur-ping]</span></li></ul></details>
    <div class="actions"><button class="btn primary" type="button" data-close>Listo</button></div>`;
  openModal({title:'Pruebas de conexión · '+r.nombre,html,wide:true});
}
async function regenPing(id){
  const r=RT.list.find(x=>x.id===id);if(!r)return;
  if(!await askConfirm(`Para mostrar el script se genera un acceso nuevo de pruebas para ${r.nombre}: el anterior deja de valer. Si el router ya tiene el script de ping, hay que pegarlo de nuevo. El acceso de la lista de clientes no cambia. ¿Seguir?`,'Generar de nuevo'))return;
  try{const j=await NET.api('POST','/api/routers/'+id+'/ping-token',{});openPingScript(r,j.token);loadRouters();}catch(err){toast(err.message||'No se pudo generar','bad');}
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
/* ----- completar la IP de los clientes ya cargados con los archivos .rsc (export de cada router) -----
   Los archivos se leen en este equipo: no se suben ni se guardan, y de ellos solo se toman nombre, IP, MAC y velocidad
   (las contraseñas y claves que traen no se leen). */
/* RouterOS escribe lo que no es ASCII como \C3\B1 (UTF-8) o \F1 (Latin-1), y escapa \" \\ \$ \? */
function rscDecode(s){
  return String(s).replace(/(?:\\[0-9A-Fa-f]{2})+/g,m=>{
    const h=m.slice(1).split('\\');
    try{return decodeURIComponent('%'+h.join('%'));}catch(e){return h.map(x=>String.fromCharCode(parseInt(x,16))).join('');}
  }).replace(/\\(["\\$?])/g,'$1');
}
function rscKV(s){
  const o={},re=/([A-Za-z][A-Za-z0-9_.-]*)=("(?:[^"\\]|\\.)*"|[^\s"]*)/g;let m;
  while((m=re.exec(s))){let v=m[2];if(v[0]==='"')v=v.slice(1,-1);o[m[1]]=rscDecode(v);}
  return o;
}
/* un .rsc → las mismas líneas que manda el script del router (Q, P, F, D), para usar rtBuild */
function rscLines(txt){
  const L=[];let sec='',cur='';
  for(const raw of String(txt||'').split(/\r?\n/)){
    const l=raw.replace(/\s+$/,'');
    if(l.endsWith('\\')){cur+=cur?l.slice(0,-1).replace(/^\s+/,''):l.slice(0,-1);continue;}
    const line=(cur?cur+l.replace(/^\s+/,''):l).trim();cur='';
    if(!line||line[0]==='#')continue;
    let path,rest;const m=line.match(/^(\/[a-z0-9 -]+?)\s+add\s+(.*)$/i);
    if(m){path=m[1];rest=m[2];}
    else if(/^\/[a-z0-9 \/-]+$/i.test(line)){sec=line;continue;}
    else if(/^add\s/i.test(line)&&sec){path=sec;rest=line.replace(/^add\s+/i,'');}
    else continue;
    path=path.toLowerCase().replace(/\s+/g,' ');
    if(!/^\/(queue simple|ppp secret|ppp profile|ip dhcp-server lease)$/.test(path))continue;
    const o=rscKV(rest),b=k=>o[k]==='yes'?'true':'false';
    if(path==='/queue simple')L.push(['Q',o.name||'',o.target||'',o['max-limit']||'',b('disabled'),o.parent||'none',o.comment||'']);
    else if(path==='/ppp secret')L.push(['P',o.name||'',o.service||'',o.profile||'',o['remote-address']||'',b('disabled'),o.comment||'']);
    else if(path==='/ppp profile')L.push(['F',o.name||'',o['rate-limit']||'']);
    else L.push(['D',o.address||'',o['mac-address']||'',o.server||'',b('disabled'),o.comment||'']);
  }
  return L;
}
const rscRouter=n=>String(n||'').replace(/\.rsc$/i,'').replace(/[-_ ]*\d{1,2}[-_.]\d{1,2}[-_.]\d{2,4}.*$/,'').trim()||String(n||'').replace(/\.rsc$/i,'');
/* palabras de un nombre para compararlo: sin tildes, sin números (los routers agregan «-104») ni conectores; lo que está entre paréntesis se mira aparte */
const RT_STOP=new Set(['de','del','la','las','el','los','y','ftth','fibra','wifi','sr','sra']);
function rtToks(s){return norm(s).replace(/[^a-z0-9]+/g,' ').trim().split(' ').filter(t=>t&&!/^\d+$/.test(t)&&!RT_STOP.has(t));}
function rtVars(s){
  s=String(s||'');const dentro=[...s.matchAll(/\(([^)]*)\)/g)].map(m=>m[1]).join(' '),fuera=s.replace(/\([^)]*\)/g,' ');
  const v=[],add=t=>{if(t.length&&!v.some(x=>x.k===t.slice().sort().join(' ')))v.push({t,k:t.slice().sort().join(' ')});};
  add(rtToks(fuera));if(rtToks(dentro).length>=2)add(rtToks(dentro));
  if(!v.length)add(rtToks(s));
  return v;
}
function rtLev(a,b){if(a===b)return 0;const m=a.length,n=b.length;if(!m||!n)return Math.max(m,n);let p=Array.from({length:n+1},(_,j)=>j);for(let i=1;i<=m;i++){const c=[i];for(let j=1;j<=n;j++)c[j]=Math.min(p[j]+1,c[j-1]+1,p[j-1]+(a[i-1]===b[j-1]?0:1));p=c;}return p[n];}
/* dos palabras «iguales» aunque haya un error de tipeo (Caseres/Caceres) o falte el final (Municipalid/Municipalidad) */
const rtSame=(a,b)=>a===b||(Math.min(a.length,b.length)>=4&&rtLev(a,b)<=1)||(Math.min(a.length,b.length)>=4&&Math.abs(a.length-b.length)<=3&&(a.startsWith(b)||b.startsWith(a)));
/* Empareja los clientes que NO tienen IP con lo que se leyó de los routers.
   seguro: mismo usuario PPPoE o mismo nombre (en cualquier orden) con una sola IP · parecido: el nombre de uno está dentro del otro, con una sola IP ·
   revisar: varias IP posibles, nombres con error de tipeo, o una IP que reclaman dos clientes (no se marca solo) · sin: no se encontró */
function rtCompletarIp(items,clientes){
  const usadas=new Map();
  for(const c of clientes){const ip=rtIpOne(c.ip);if(ip&&!usadas.has(ip))usadas.set(ip,c);}
  const fuentes=[];
  items.forEach(e=>{if(!e.ip)return;const vs=[];(e.alias&&e.alias.length?e.alias:[e.nombre]).forEach(a=>rtVars(a).forEach(v=>vs.push(Object.assign({a},v))));fuentes.push({e,vs});});
  const porClave=new Map(),porUsuario=new Map(),porPal=new Map(),porIni=new Map(),push=(m,k,x)=>{let l=m.get(k);if(!l)m.set(k,l=[]);l.push(x);};
  fuentes.forEach(f=>{
    f.vs.forEach(v=>{const h={f,v};push(porClave,v.k,h);v.t.forEach(x=>push(porPal,x,h));new Set(v.t.filter(x=>x.length>=3).map(x=>x.slice(0,2))).forEach(x=>push(porIni,x,h));});
    if(f.e.usuario)porUsuario.set(f.e.usuario.toLowerCase(),f);
  });
  /* solo se comparan los que comparten palabras (o las 2 primeras letras de al menos 2 palabras) */
  const cerca=(v,m,corte)=>{const c=new Map();new Set(v.t.map(x=>corte?(x.length>=3?x.slice(0,2):''):x)).forEach(k=>(m.get(k)||[]).forEach(h=>c.set(h,(c.get(h)||0)+1)));return [...c.entries()].filter(([,n])=>n>=(corte?2:1)).map(([h])=>h);};
  const res={rows:[],sin:[],yaTienen:0,bajas:0,fuentes:fuentes.length};
  const opt=(f,a)=>({ip:f.e.ip,nombre:a||f.e.nombre,router:f.e.router||'',tipo:f.e.tipo});
  const juntar=(hits)=>{const m=new Map();hits.forEach(h=>{if(!usadas.has(h.f.e.ip)&&!m.has(h.f.e.ip))m.set(h.f.e.ip,opt(h.f,h.v.a));});return [...m.values()];};
  for(const c of clientes){
    if(String(c.ip==null?'':c.ip).trim()){res.yaTienen++;continue;}
    if(c.estado==='baja'){res.bajas++;continue;}
    const cv=rtVars(c.nombre);let opts=[],tier='';
    const u=String(c.usuario||'').trim().toLowerCase(),fu=u&&porUsuario.get(u);
    if(fu){opts=juntar([{f:fu,v:{a:fu.e.nombre}}]);tier='seguro';}
    if(!opts.length){opts=juntar(cv.flatMap(v=>porClave.get(v.k)||[]));tier='seguro';}
    if(!opts.length){   /* un nombre contenido en el otro (2 palabras o más) */
      const hits=[];
      cv.forEach(v=>{if(v.t.length<2)return;cerca(v,porPal).forEach(h=>{const w=h.v;if(w.t.length<2)return;
        const [a,b]=v.t.length<=w.t.length?[v.t,w.t]:[w.t,v.t];if(a.every(x=>b.includes(x)))hits.push(h);});});
      opts=juntar(hits);tier='parecido';
    }
    if(!opts.length){   /* con errores de tipeo: al menos 2 palabras iguales y casi todo el nombre */
      const hits=[];
      cv.forEach(v=>{if(v.t.length<2)return;cerca(v,porIni,true).forEach(h=>{const w=h.v;if(w.t.length<2)return;
        const usd=new Set();let sh=0;v.t.forEach(x=>{const j=w.t.findIndex((y,i)=>!usd.has(i)&&rtSame(x,y));if(j>=0){usd.add(j);sh++;}});
        if(sh>=2&&(sh===Math.min(v.t.length,w.t.length)||sh/Math.max(v.t.length,w.t.length)>=0.6))hits.push({f:h.f,v:w,sh});});});
      hits.sort((x,y)=>y.sh-x.sh);opts=juntar(hits).slice(0,4);tier='revisar';
    }
    if(!opts.length){res.sin.push(c);continue;}
    if(opts.length>1)tier='revisar';
    res.rows.push({id:c.id,shard:c._doc||clientShard(c.id),nombre:c.nombre,tier,opts,sel:0,marcado:tier!=='revisar'});
  }
  const reclaman=new Map();   /* una IP no es de dos clientes: si dos la reclaman, los dos pasan a revisar */
  res.rows.forEach(r=>{if(r.tier!=='revisar'){const ip=r.opts[0].ip;reclaman.set(ip,(reclaman.get(ip)||0)+1);}});
  res.rows.forEach(r=>{if(r.tier!=='revisar'&&reclaman.get(r.opts[0].ip)>1){r.tier='revisar';r.marcado=false;}});
  return res;
}
const RSC_TABS=[['seguro','Seguros'],['parecido','Parecidos'],['revisar','A revisar'],['sin','Sin coincidencia']];
function openRscIp(){
  if(!S.loaded.clientes)return toast('Esperá a que terminen de cargar los clientes','bad');
  const st={res:null,tab:'seguro',q:'',info:''};
  openModal({title:'Completar IP con archivos .rsc',wide:true,html:`<div class="notice info">Elegí los archivos <b>.rsc</b> que exportaste de los routers (por ejemplo admin, fm, bomberos y leo). Se leen en este equipo: <b>no se suben ni se guardan</b>, y las contraseñas que traen no se leen. Solo se completa la IP de los clientes que no la tienen, y no se cambia nada en los routers.</div>
    <div class="actions start"><button class="btn primary" type="button" id="rs-pick">Elegir archivos .rsc</button><input type="file" id="rs-file" multiple hidden></div>
    <div id="rs-out"></div>`,onMount(el){
    const out=$('#rs-out',el);
    const rowsOf=t=>t==='sin'?st.res.sin:st.res.rows.filter(r=>r.tier===t);
    const marcados=()=>st.res.rows.filter(r=>r.marcado);
    function draw(){
      const r=st.res,kp=RSC_TABS.map(([k,l])=>[k,l,rowsOf(k).length]);
      const q=rtNameKey(st.q),l=rowsOf(st.tab).filter(x=>!q||rtNameKey(x.nombre||'').includes(q)||(x.opts||[]).some(o=>rtNameKey(o.nombre+' '+o.ip).includes(q)));
      const n=marcados().length;
      out.innerHTML=`<div class="hint">${esc(st.info)}</div>
        <div class="kpis">${kp.map(([k,lb,c])=>`<div class="kpi"><span class="n">${c}</span><span class="l">${lb}</span></div>`).join('')}<div class="kpi"><span class="n">${r.yaTienen}</span><span class="l">Ya tienen IP</span></div></div>
        <div class="toolbar"><div class="line"><input id="rs-q" class="search" type="search" placeholder="Buscar cliente, nombre en el router o IP" value="${esc(st.q)}"></div>
          <div class="seg" id="rs-tab">${kp.map(([k,lb,c])=>`<button type="button" data-t="${k}" aria-pressed="${k===st.tab}">${lb} (${c})</button>`).join('')}</div></div>
        ${st.tab==='sin'?`<div class="hint">Estos clientes no aparecen en los archivos (o la IP que les correspondería ya la tiene otro cliente). Se cargan a mano desde la ficha.</div>`:
          `<div class="hint">${st.tab==='seguro'?'Mismo nombre (en cualquier orden) o mismo usuario PPPoE, con una sola IP. Vienen marcados.':st.tab==='parecido'?'El nombre de uno está dentro del otro (por ejemplo «Figueredo Emiliano Ricardo» y «Emiliano Figueredo»). Vienen marcados: mirá que sea la misma persona.':'Hay varias IP posibles, el nombre tiene un error de tipeo o dos clientes reclaman la misma IP. No vienen marcados: elegí la IP y marcá los que sean.'}</div>
          <div class="actions start"><button class="btn small" type="button" data-all="1">Marcar todos</button><button class="btn small ghost" type="button" data-all="0">Desmarcar todos</button></div>`}
        <div class="tbl-wrap"><table><thead><tr>${st.tab==='sin'?'<th>Cliente</th>':'<th></th><th>Cliente</th><th>En el router</th><th>IP</th>'}</tr></thead><tbody>${l.length?l.slice(0,150).map(x=>st.tab==='sin'?`<tr><td>${esc(x.nombre)}</td></tr>`:
          `<tr><td><input type="checkbox" data-k="${esc(x.id)}" aria-label="Marcar a ${esc(x.nombre)}"${x.marcado?' checked':''}></td><td>${esc(x.nombre)}</td>${x.opts.length>1?`<td colspan="2">${x.opts.map((o,i)=>`<label style="display:flex;gap:8px;align-items:baseline;margin:2px 0"><input type="radio" name="o-${esc(x.id)}" data-r="${esc(x.id)}" value="${i}"${i===x.sel?' checked':''}><span><span class="mono">${esc(o.ip)}</span> · ${esc(o.nombre)}${o.router?` <span class="muted small">(${esc(o.router)})</span>`:''}</span></label>`).join('')}</td>`:`<td>${esc(x.opts[0].nombre)}${x.opts[0].router?` <span class="muted small">(${esc(x.opts[0].router)})</span>`:''}</td><td class="mono">${esc(x.opts[0].ip)}</td>`}</tr>`).join(''):`<tr><td colspan="4" class="muted">No hay nada con ese filtro</td></tr>`}</tbody></table></div>
        ${l.length>150?`<div class="hint">Se muestran 150 de ${l.length}. Usá la búsqueda para ver otros.</div>`:''}
        <div class="actions"><button class="btn ghost" type="button" data-close>Cerrar</button><button class="btn primary" type="button" id="rs-go"${n?'':' disabled'}>Guardar la IP de ${n} ${n===1?'cliente':'clientes'}</button></div><div class="hint" id="rs-prog"></div>`;
      const qi=$('#rs-q',out);qi.addEventListener('input',e=>{st.q=e.target.value;const p=e.target.selectionStart;draw();const n2=$('#rs-q',out);n2.focus();try{n2.setSelectionRange(p,p);}catch(_){}});
      $('#rs-tab',out).addEventListener('click',e=>{const b=e.target.closest('[data-t]');if(!b)return;st.tab=b.dataset.t;draw();});
      $$('[data-k]',out).forEach(i=>i.addEventListener('change',()=>{const r2=st.res.rows.find(x=>x.id===i.dataset.k);if(r2){r2.marcado=i.checked;$('#rs-go',out).disabled=!marcados().length;$('#rs-go',out).textContent=`Guardar la IP de ${marcados().length} ${marcados().length===1?'cliente':'clientes'}`;}}));
      $$('[data-r]',out).forEach(i=>i.addEventListener('change',()=>{   /* elegir una IP marca al cliente */
        const r2=st.res.rows.find(x=>x.id===i.dataset.r);if(!r2)return;r2.sel=Number(i.value)||0;r2.marcado=true;
        const cb=$$('[data-k]',out).find(x=>x.dataset.k===r2.id);if(cb)cb.checked=true;
        const g=$('#rs-go',out),m=marcados().length;g.disabled=!m;g.textContent=`Guardar la IP de ${m} ${m===1?'cliente':'clientes'}`;}));
      $$('[data-all]',out).forEach(b=>b.addEventListener('click',()=>{const on=b.dataset.all==='1';l.forEach(x=>{x.marcado=on;});draw();}));
      $('#rs-go',out).addEventListener('click',guardar);
    }
    async function guardar(){
      const sel=marcados();if(!sel.length)return;
      /* una misma IP no puede quedar en dos clientes */
      const ips=new Map();sel.forEach(r=>{const ip=r.opts[r.sel].ip;(ips.get(ip)||ips.set(ip,[]).get(ip)).push(r.nombre);});
      const dup=[...ips.entries()].find(([,n])=>n.length>1);
      if(dup)return toast(`La IP ${dup[0]} está marcada para ${dup[1].length} clientes (${dup[1].slice(0,2).join(', ')}…). Dejá uno solo.`,'bad');
      if(!await askConfirm(`Se va a escribir la IP de ${sel.length} ${sel.length===1?'cliente que no la tenía':'clientes que no la tenían'}. No se cambia nada en los routers. ¿Guardar?`,'Guardar'))return;
      const go=$('#rs-go',out);go.disabled=true;
      try{
        await updateImported(sel.map(r=>({id:r.id,shard:r.shard,patch:{ip:r.opts[r.sel].ip}})),(d,t)=>{$('#rs-prog',out).textContent=`Guardando… ${d} de ${t}`;});
        toast('IP guardada en '+sel.length+' clientes');closeModal();
      }catch(err){dbError(err);go.disabled=false;$('#rs-prog',out).textContent='No se pudo terminar. Los que ya se guardaron no se repiten: volvé a abrir esta pantalla.';}
    }
    $('#rs-pick',el).addEventListener('click',()=>$('#rs-file',el).click());
    $('#rs-file',el).addEventListener('change',async e=>{
      const fl=[...e.target.files].slice(0,12);e.target.value='';if(!fl.length)return;
      out.innerHTML='<div class="hint">Leyendo…</div>';
      try{
        const items=[],lab=[],cnt={q:0,d:0,p:0};
        for(const f of fl){
          if(f.size>30e6)throw new Error(f.name+' pesa demasiado para ser un export de un router.');
          const lines=rscLines(await f.text());
          if(!lines.length){lab.push(rscRouter(f.name)+' (sin colas ni clientes)');continue;}
          const b=rtBuild(lines),nm=rscRouter(f.name);
          b.items.forEach(x=>{x.router=nm;items.push(x);});
          lines.forEach(l=>{if(l[0]==='Q')cnt.q++;else if(l[0]==='D')cnt.d++;else if(l[0]==='P')cnt.p++;});lab.push(nm);
        }
        st.res=rtCompletarIp(items,[...S.clientes.values()]);
        st.info=`Leí ${fl.length} ${fl.length===1?'archivo':'archivos'} (${lab.join(', ')}): ${cnt.q} colas, ${cnt.d} leases DHCP y ${cnt.p} usuarios PPPoE; ${st.res.fuentes} con IP.`+(st.res.bajas?` ${st.res.bajas} clientes de baja no se tocan.`:'');
        st.tab=st.res.rows.some(r=>r.tier==='seguro')?'seguro':'revisar';draw();
      }catch(err){out.innerHTML=`<div class="notice bad">${esc(err.message||'No se pudo leer el archivo')}</div>`;}
    });
  }});
}
function bindRouters(el){
  $('#aj-newr',el).addEventListener('click',()=>openRouterForm(null));
  $('#aj-refr',el).addEventListener('click',()=>loadRouters());
  $('#aj-rsc',el).addEventListener('click',openRscIp);
  $('#aj-routers',el).addEventListener('click',e=>{
    const b=e.target.closest('[data-rt]');if(!b)return;
    const id=b.dataset.id,a=b.dataset.rt;
    if(a==='edit')openRouterForm(id);else if(a==='script')regenScript(id);else if(a==='pscript')regenPing(id);else if(a==='det')openDetected(id);
  });
  loadRouters();
}
