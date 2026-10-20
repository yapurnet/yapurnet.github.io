/* ===== sesión y permisos ===== */
const allPerms=()=>{const o={};PERMS.forEach(([k])=>{o[k]=true;});return o;};
function deriveTecnicos(){
  S.ajustes.tecnicos=S.ajustes.perfiles.filter(p=>p.base==='tecnico'&&p.activo!==false).map(p=>({id:p.id,nombre:p.nombre,tel:p.tel||''}));
}
function permsOfPerfil(p){
  const perms=Object.assign({},PERM_DEF[p.base],p.permisos||{});
  if(p.base==='tecnico')MONEY_PERMS.forEach(k=>{perms[k]=false;});
  return perms;
}
/* los permisos reales los decide el servidor; el administrador además puede ver la app como la ve cada usuario */
function computePerms(){
  S.perfil=null;S.preview=false;S.gate=false;
  const me=S.me;
  if(S.realRole==='admin'){
    const prev=lsGet('viewAsP'),pp=prev&&S.ajustes.perfiles.find(p=>p.id===prev&&p.activo!==false);
    if(pp){S.perfil=pp;S.preview=true;S.perms=permsOfPerfil(pp);S.role=pp.base;}
    else{S.perms=allPerms();S.role='admin';}
  }else{
    S.perms=Object.assign({},me.perms);S.role=me.role;
    S.perfil=S.ajustes.perfiles.find(p=>p.id===me.id)||{id:me.id,nombre:me.nombre,base:me.role,tel:me.tel||''};
  }
  S.tecId=S.perfil&&S.perfil.base==='tecnico'?S.perfil.id:'';
  S.pv++;
}

/* ===== navegación ===== */
let tabsHtml='',renderTimer=null;
function allowedTabs(){
  const t=[];if(S.gate)return t;
  if(can('resumen'))t.push(['resumen','Resumen']);
  if(can('cobrar')||can('caja'))t.push(['cobranzas','Cobranzas']);
  const cli=['clientes',can('clientesTodos')?'Clientes':'Mis clientes'],ord=['ordenes','Órdenes'];
  if(S.role==='tecnico')t.push(ord,cli);else t.push(cli,ord);
  if(can('precios'))t.push(['planes','Planes']);
  if(isAdmin())t.push(['ajustes','Ajustes']);
  return t;
}
function renderTabs(){
  const open=[...S.ordenes.values()].filter(ORD_OPEN).length;
  const html=allowedTabs().map(([k,l])=>`<button class="tab" role="tab" type="button" data-tab="${k}" aria-selected="${S.tab===k}">${l}${k==='ordenes'&&open?`<span class="count">${open}</span>`:''}</button>`).join('');
  if(html!==tabsHtml){tabsHtml=html;$('#tabs').innerHTML=html;}
}
function showTab(t){
  const tabs=allowedTabs();if(!tabs.length)return;
  if(!tabs.some(x=>x[0]===t))t=tabs[0][0];
  S.tab=t;lsSet('tab',t);tabsHtml='';renderTabs();
  const v=$('#view');v.innerHTML='';VIEWS[t].mount(v);
  window.scrollTo(0,0);
}
function updateHeader(){
  $('#brandName').textContent=S.ajustes.empresa||'YAPUR.NET';
  const chip=$('#roleChip'),btn=$('#viewAsBtn');
  chip.hidden=false;
  chip.textContent=S.preview?'Vista: '+S.perfil.nombre:(S.me?S.me.nombre:'');
  if(S.realRole==='admin'){btn.hidden=false;btn.textContent=S.preview?'Volver a mi vista':'Ver como…';}
  else btn.hidden=true;
}
function dataChanged(key){
  if(key==='pagos'||key==='clientes'||key==='planes'||key==='ajustes')rebuildDerived();
  if(renderTimer)return;
  renderTimer=setTimeout(()=>{renderTimer=null;if(!S.ready||S.gate)return;updateHeader();renderTabs();const v=VIEWS[S.tab];if(v&&v.update)v.update();},60);
}
$('#tabs').addEventListener('click',e=>{const b=e.target.closest('[data-tab]');if(b)showTab(b.dataset.tab);});
$('#view').addEventListener('click',e=>{
  const g=e.target.closest('[data-go]');
  if(g){if(g.dataset.sub)CB.sub=g.dataset.sub;showTab(g.dataset.go);return;}
  const o=e.target.closest('[data-open-client]');if(o&&S.tab==='resumen')openClient(o.dataset.openClient);
});

/* ===== datos ===== */
const started={};
function startData(){
  if(!S.db)return;
  if(!started.planes){started.planes=1;
    S.db.collection('planes').onSnapshot(snap=>{
      S.planes.clear();snap.docs.forEach(d=>S.planes.set(d.id,Object.assign({},d.data(),{id:d.id})));
      S.loaded.planes=true;dataChanged('planes');
    },err=>{S.errors.planes=err;S.loaded.planes=true;dataChanged('planes');});}
  if(!started.clientes){started.clientes=1;watchSharded('clientes',S.clientes,'clientes');}
  if(!started.ordenes){started.ordenes=1;watchSharded('ordenes',S.ordenes,'ordenes');}
  if(!started.pagos){
    if(S.realRole==='admin'||can('cobrar')||can('caja')||can('promesas')||can('resumen')){started.pagos=1;watchSharded('pagos',S.pagos,'pagos');}
    else S.loaded.pagos=true;
  }
}

function refreshAll(){
  computePerms();updateHeader();startData();
  const tabs=allowedTabs(),last=S.tab||lsGet('tab');
  showTab(tabs.some(x=>x[0]===last)?last:tabs[0][0]);
}
function onAjustesChanged(){
  const sig=()=>JSON.stringify([S.perfil&&S.perfil.id,S.perms]);
  const before=sig();
  computePerms();
  if(before!==sig()){updateHeader();startData();const tabs=allowedTabs();showTab(tabs.some(x=>x[0]===S.tab)?S.tab:tabs[0][0]);}
  else dataChanged('ajustes');
}
/* cambió mi tipo o mis permisos en el servidor */
function onMeChanged(m){
  if(!S.ready){S.me=m;return;}
  if(m.role!==S.me.role){location.reload();return;}
  S.me=m;computePerms();updateHeader();startData();
  const tabs=allowedTabs();showTab(tabs.some(x=>x[0]===S.tab)?S.tab:tabs[0][0]);
  toast('Se actualizaron tus permisos');
}
$('#viewAsBtn').addEventListener('click',()=>{
  if(S.preview){lsSet('viewAsP','');S.tab='';lsSet('tab','');refreshAll();toast('Volviste a tu vista');return;}
  const ps=S.ajustes.perfiles.filter(p=>p.activo!==false);
  if(!ps.length)return toast('Primero creá un usuario en Ajustes','bad');
  openModal({title:'Ver como…',html:`<p class="muted small">Mirás la app tal como la ve esa persona.</p><div class="list">${ps.map(p=>`<button class="item" type="button" data-vp="${esc(p.id)}"><div class="t">${esc(p.nombre)}</div><div class="side"><span class="chip">${esc(ROLE_NAME[p.base]||'')}</span></div></button>`).join('')}</div>`,
    onMount(el){el.addEventListener('click',e=>{const b=e.target.closest('[data-vp]');if(!b)return;lsSet('viewAsP',b.dataset.vp);S.tab='';lsSet('tab','');closeModal();refreshAll();});}});
});

/* ===== mi cuenta ===== */
function openAccount(){
  const me=S.me;if(!me)return;
  openModal({title:'Mi cuenta',html:`<dl class="kv"><dt>Nombre</dt><dd>${esc(me.nombre)}</dd><dt>Usuario</dt><dd class="mono">${esc(me.usuario)}</dd><dt>Tipo</dt><dd>${esc(ROLE_NAME[me.role]||me.role)}</dd><dt>Dirección</dt><dd class="mono" style="word-break:break-all">${esc(serverUrl())}</dd></dl>
    <form class="form" id="ac-form" novalidate><h3>Cambiar mi clave</h3>
      ${F('Clave actual','ac-act','<input id="ac-act" type="password" autocomplete="current-password">')}
      ${F('Clave nueva','ac-new','<input id="ac-new" type="password" autocomplete="new-password">','Mínimo '+(me.role==='admin'?8:6)+' caracteres.')}
      <div class="actions start"><button class="btn primary" type="submit">Cambiar clave</button></div></form>
    <div class="actions"><button class="btn" type="button" id="ac-reload">Actualizar la app</button><button class="btn danger" type="button" id="ac-out">Cerrar sesión</button></div>`,
    onMount(el){
      $('#ac-form',el).addEventListener('submit',async e=>{
        e.preventDefault();
        try{await NET.api('POST','/api/me/clave',{actual:$('#ac-act',el).value,nueva:$('#ac-new',el).value});toast('Clave cambiada');closeModal();}
        catch(err){toast(err.message||'No se pudo cambiar','bad');}
      });
      $('#ac-reload',el).addEventListener('click',()=>location.reload());
      $('#ac-out',el).addEventListener('click',async()=>{await NET.logout();location.reload();});
    }});
}
$('#roleChip').addEventListener('click',openAccount);

/* ===== pantallas de entrada ===== */
function authCard(inner){$('#view').innerHTML=`<div class="card" style="max-width:420px;margin:24px auto;width:100%">${inner}</div>`;return $('#view .card');}
function takeFlash(){try{const m=sessionStorage.getItem('yg_msg');sessionStorage.removeItem('yg_msg');return m||'';}catch(e){return '';}}
function showAuth(state,info){
  S.ready=false;tabsHtml='';$('#tabs').innerHTML='';closeModal();
  $('#roleChip').hidden=true;$('#viewAsBtn').hidden=true;
  if(state==='noserver'||state==='offline')return showNoServer(state,info);
  if(state==='setup')return showSetup();
  showLogin(takeFlash());
}
function showNoServer(state,info){
  const off=state==='offline';
  const el=authCard(`<h2>${off?'Sin conexión':'No se pudo conectar'}</h2><p class="muted">${off?'No hay señal y todavía no hay datos guardados en este equipo. Conectate a internet y probá de nuevo.':'No se pudo hablar con el servidor. Revisá la señal e intentá de nuevo.'}</p>
    <div class="actions"><button class="btn primary" type="button" id="ns-retry">Reintentar</button></div>`);
  $('#ns-retry',el).addEventListener('click',()=>location.reload());
}
function showLogin(flash){
  const el=authCard(`<h2>Entrar</h2>${flash?`<div class="notice bad">${esc(flash)}</div>`:''}
    <form class="form" id="lg-form" novalidate>${F('Usuario','lg-user','<input id="lg-user" autocomplete="username" autocapitalize="none" spellcheck="false">')}
    ${F('Clave','lg-pass','<input id="lg-pass" type="password" autocomplete="current-password">')}
    <div class="actions"><button class="btn primary" type="submit">Entrar</button></div></form>`);
  $('#lg-user',el).value=lsGet('lastUser')||'';
  setTimeout(()=>{(lsGet('lastUser')?$('#lg-pass',el):$('#lg-user',el)).focus();},50);
  $('#lg-form',el).addEventListener('submit',async e=>{
    e.preventDefault();const u=$('#lg-user',el).value.trim(),p=$('#lg-pass',el).value;
    if(!u||!p)return toast('Escribí tu usuario y tu clave','bad');
    const b=$('button[type=submit]',el);b.disabled=true;b.textContent='Entrando…';
    try{await NET.login(u,p);lsSet('lastUser',u.toLowerCase());location.reload();}
    catch(err){b.disabled=false;b.textContent='Entrar';toast(err.network?'No se pudo conectar con el servidor':err.message,'bad');$('#lg-pass',el).value='';}
  });
}
function showSetup(){
  const el=authCard(`<h2>Instalación</h2><p class="muted small">Creá la cuenta del administrador. El código de instalación (16 letras y números, en grupos de 4) te lo dio quien instaló el sistema. Se usa una sola vez.</p>
    <form class="form" id="su-form" novalidate>${F('Código de instalación','su-code','<input id="su-code" autocomplete="off" autocapitalize="characters" spellcheck="false">')}
    ${F('Nombre de la empresa','su-emp','<input id="su-emp" value="YAPUR.NET" autocomplete="off">')}
    ${F('Tu nombre','su-nom','<input id="su-nom" autocomplete="name">')}
    <div class="grid2">${F('Tu usuario','su-user','<input id="su-user" autocomplete="username" autocapitalize="none" spellcheck="false">','Sin espacios.')}${F('Tu clave','su-pass','<input id="su-pass" type="password" autocomplete="new-password">','Mínimo 8 caracteres.')}</div>
    <div class="actions"><button class="btn primary" type="submit">Crear administrador</button></div></form>`);
  $('#su-form',el).addEventListener('submit',async e=>{
    e.preventDefault();const g=i=>$('#'+i,el).value.trim();
    if(!g('su-code')||!g('su-nom')||!g('su-user')||!$('#su-pass',el).value)return toast('Completá todos los datos','bad');
    const b=$('button[type=submit]',el);b.disabled=true;
    try{await NET.setup({codigo:g('su-code'),empresa:g('su-emp'),nombre:g('su-nom'),usuario:g('su-user'),clave:$('#su-pass',el).value});lsSet('lastUser',g('su-user').toLowerCase());location.reload();}
    catch(err){b.disabled=false;toast(err.network?'No se pudo conectar con el servidor':err.message,'bad');}
  });
}

/* ===== aviso de conexión ===== */
let netT=null;
function updateNetBar(){
  const bar=$('#netBar');if(!bar)return;
  clearTimeout(netT);
  if(NET.online){bar.hidden=true;return;}
  netT=setTimeout(()=>{if(NET.online||!S.ready){bar.hidden=true;return;}bar.hidden=false;bar.textContent='Sin conexión con el servidor. Ves los últimos datos guardados y no se puede guardar nada nuevo hasta que vuelva la señal.';},2500);
}
/* botón "atrás" de Android: la envoltura nativa llama a esto; devuelve true si la app se ocupó (cerró una hoja o volvió a la primera pestaña) */
window.yapurBack=function(){
  try{
    if($('#modalRoot').firstChild){closeModal();return true;}
    if(!S.ready)return false;
    const tabs=allowedTabs();
    if(S.tab&&tabs.length&&S.tab!==tabs[0][0]){showTab(tabs[0][0]);return true;}
  }catch(e){console.error(e);}
  return false;
};

/* ===== cambio de día con la app abierta: recalcula plazos y cortes ===== */
let _dia=todayStr();
setInterval(()=>{const t=todayStr();if(t!==_dia){_dia=t;if(S.ready)dataChanged('pagos');}},60000);

/* ===== arranque ===== */
(async function boot(){
  NET.on('kick',()=>location.reload());
  NET.on('me',onMeChanged);
  NET.on('status',updateNetBar);
  let st;
  try{st=await NET.init();}catch(e){console.error(e);st={state:'noserver',error:e};}
  if(st.state!=='ready'){showAuth(st.state,st);return;}
  S.me=NET.me;S.realRole=S.me.role;S.uid=S.me.id;S.db=NET.db;
  await new Promise(res=>{
    let first=true;
    S.db.doc('ajustes/general').onSnapshot(snap=>{
      const d=snap.exists?snap.data():null;
      S.ajustes=Object.assign({empresa:'YAPUR.NET',diaVenc:10,perfiles:[],ciclos:null,feriados:null,servicios:null,promesaMax:10},d||{},{tecnicos:[]});
      if(!Array.isArray(S.ajustes.perfiles))S.ajustes.perfiles=[];
      deriveTecnicos();S.loaded.ajustes=true;
      if(first){first=false;res();}else{rebuildDerived();onAjustesChanged();}
    },err=>{S.errors.ajustes=err;S.loaded.ajustes=true;if(first){first=false;res();}});
  });
  S.ready=true;refreshAll();updateNetBar();
})();

/* ===== abrir sin señal: el service worker guarda la pantalla principal (solo con https o en la propia computadora) ===== */
if('serviceWorker' in navigator&&(location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1')){
  window.addEventListener('load',()=>{navigator.serviceWorker.register('sw.js',{updateViaCache:'none'}).catch(()=>{});});
}
