/* ===== ajustes y usuarios del equipo (solo administrador) ===== */
async function saveAjustes(patch){
  const next=Object.assign({},S.ajustes,patch);
  await S.db.doc('ajustes/general').set({empresa:next.empresa,diaVenc:next.diaVenc||10,ciclos:next.ciclos||null,feriados:Array.isArray(next.feriados)?next.feriados:null,servicios:Array.isArray(next.servicios)?next.servicios:null,promesaMax:Number(next.promesaMax)||10,recibo:next.recibo&&typeof next.recibo==='object'?next.recibo:null,precioInstalacion:precioFijo('instalacion',next),precioReinstalacion:precioFijo('reinstalacion',next)});
}
function permsBoxHTML(base,cur){
  const defs=PERM_DEF[base];let g='',html='';
  PERMS.forEach(([k,l,d,grp])=>{
    if(base==='tecnico'&&MONEY_PERMS.includes(k))return;
    if(k==='cobrarCampo'&&base!=='tecnico')return;
    if(grp!==g){if(g)html+='</div>';html+=`<div class="fgroup"><div class="legend">${grp}</div>`;g=grp;}
    const on=cur&&k in cur?!!cur[k]:!!defs[k];
    html+=`<label class="per"><input type="checkbox" data-perm="${k}"${on?' checked':''}><span class="grow">${l}${d?`<br><span class="small muted">${d}</span>`:''}</span></label>`;
  });
  return html+'</div>';
}
/* ----- usuarios: cada persona entra con su usuario y su clave (las claves viven en el servidor) ----- */
const ACC={users:[],loaded:false,loading:false,sig:''};
const fmtLogin=ts=>{if(!ts)return 'Todavía no entró';const d=new Date(ts);return 'Último ingreso: '+pad(d.getDate())+'/'+pad(d.getMonth()+1)+' '+pad(d.getHours())+':'+pad(d.getMinutes());};
function genClave(){const a='abcdefghjkmnpqrstuvwxyz23456789',b=new Uint8Array(8);crypto.getRandomValues(b);return Array.from(b,x=>a[x%a.length]).join('');}
const serverUrl=()=>location.origin;
async function loadUsers(){
  if(ACC.loading)return;ACC.loading=true;
  try{const j=await NET.api('GET','/api/users');ACC.users=j.users;ACC.loaded=true;}catch(e){console.error(e);}
  ACC.loading=false;renderUsers();
}
function renderUsers(){
  const l=$('#aj-users');if(!l)return;
  if(!ACC.loaded){l.innerHTML='<div class="hint">Cargando…</div>';return;}
  l.innerHTML=ACC.users.map(u=>{
    const mine=NET.me&&u.id===NET.me.id;
    return `<div class="item" style="cursor:default"><div><div class="t">${esc(u.nombre)}${mine?' <span class="muted small">(vos)</span>':''}</div><div class="s"><span class="mono">${esc(u.usuario)}</span> · ${esc(ROLE_NAME[u.role]||u.role)}${u.tel?' · <span class="mono">'+esc(u.tel)+'</span>':''}<br>${esc(fmtLogin(u.last_login))}</div></div>
      <div class="side"><span class="chip ${u.activo?'ok':'bad'}">${u.activo?'Activo':'Desactivado'}</span></div>
      <div class="tags"><button class="btn small" type="button" data-u="${esc(u.id)}" data-u-act="edit">Editar</button><button class="btn small" type="button" data-u="${esc(u.id)}" data-u-act="clave">Cambiar clave</button>
      ${mine?'':(u.activo?`<button class="btn small danger" type="button" data-u="${esc(u.id)}" data-u-act="off">Desactivar</button>`:`<button class="btn small" type="button" data-u="${esc(u.id)}" data-u-act="on">Activar</button>`)}</div></div>`;
  }).join('')||'<div class="empty"><b>No hay usuarios</b></div>';
}
function credsModal(u,clave,title){
  const txt=`Hola ${u.nombre}, este es tu acceso a Gestión ${S.ajustes.empresa||'YAPUR.NET'}:\nUsuario: ${u.usuario}\nClave: ${clave}\nDirección: ${serverUrl()}\nCambiá tu clave desde «Mi cuenta» cuando entres.`;
  openModal({title:title||'Datos de acceso',html:`<p class="muted small">Anotalos o mandáselos ahora: la clave no se vuelve a mostrar.</p>
    <dl class="kv"><dt>Usuario</dt><dd class="mono">${esc(u.usuario)}</dd><dt>Clave</dt><dd class="mono">${esc(clave)}</dd><dt>Dirección</dt><dd class="mono" style="word-break:break-all">${esc(serverUrl())}</dd></dl>
    <div class="actions"><button class="btn" type="button" data-copy="${esc(txt)}" data-copy-label="Datos de acceso">Copiar mensaje</button>${u.tel?`<a class="btn" target="_blank" rel="noopener" href="${waUrl(u.tel,txt)}">Enviar por WhatsApp</a>`:''}<button class="btn primary" type="button" data-close>Listo</button></div>`});
}
function openUserForm(id){
  const old=id?ACC.users.find(u=>u.id===id):null;
  const u=old||{role:'tecnico',activo:true};
  const mine=old&&NET.me&&old.id===NET.me.id;
  const html=`<form class="form" id="uform" novalidate>
    <div class="grid2">${F('Nombre *','uf-nombre',`<input id="uf-nombre" value="${esc(u.nombre||'')}" autocomplete="off">`)}
    ${F('Usuario para entrar *','uf-user',`<input id="uf-user" value="${esc(u.usuario||'')}" autocomplete="off" autocapitalize="none" spellcheck="false"${old?' disabled':''}>`,old?'No se puede cambiar.':'Sin espacios. Por ejemplo: pedro o laura.')}</div>
    <div class="grid2">${F('Tipo de usuario','uf-role',`<select id="uf-role"${mine?' disabled':''}>${opt('tecnico','Técnico (trabajo en la calle)',u.role==='tecnico')}${opt('oficina','Oficina (cobranzas y clientes)',u.role==='oficina')}${opt('admin','Administrador (todo)',u.role==='admin')}</select>`)}
    ${F('Teléfono (opcional)','uf-tel',`<input id="uf-tel" inputmode="tel" value="${esc(u.tel||'')}">`,'Sirve para mandarle órdenes por WhatsApp.')}</div>
    ${old?'':F('Clave *','uf-clave','<div style="display:flex;gap:8px"><input id="uf-clave" autocomplete="off" autocapitalize="none" spellcheck="false" style="flex:1"><button class="btn" type="button" id="uf-gen">Generar</button></div>','Mínimo 6 caracteres (8 si es administrador). Después se la pasás a la persona.')}
    <div class="fgroup" id="uf-permwrap"><div class="legend">Qué puede hacer</div><div id="uf-perms" class="form"></div></div>
    ${old&&!mine?`<label class="per"><input id="uf-activo" type="checkbox"${u.activo!==false?' checked':''}><span class="grow"><b>Usuario activo</b><br><span class="small muted">Si lo desactivás, se le cierra la sesión al instante y no puede volver a entrar.</span></span></label>`:''}
    <div class="notice info">Los permisos se controlan desde el servidor: aunque alguien modifique la app, no puede leer pagos ni cambiar precios si no le corresponde.</div>
    <div class="actions"><button class="btn ghost" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">${old?'Guardar':'Crear usuario'}</button></div></form>`;
  openModal({title:old?'Editar usuario':'Nuevo usuario',html,onMount(el){
    const draw=(role,cur)=>{$('#uf-permwrap',el).hidden=role==='admin';if(role!=='admin')$('#uf-perms',el).innerHTML=permsBoxHTML(role,cur);};
    draw(u.role,old?old.permisos:null);
    $('#uf-role',el).addEventListener('change',e=>draw(e.target.value,null));
    const gen=$('#uf-gen',el);if(gen)gen.addEventListener('click',()=>{$('#uf-clave',el).value=genClave();});
    $('#uform',el).addEventListener('submit',async e=>{
      e.preventDefault();
      const nombre=$('#uf-nombre',el).value.trim(),role=$('#uf-role',el).value,tel=$('#uf-tel',el).value.trim();
      if(!nombre)return toast('Falta el nombre','bad');
      let permisos=null;
      if(role!=='admin'){permisos={};PERMS.forEach(([k])=>{permisos[k]=false;});$$('[data-perm]',el).forEach(i=>{permisos[i.dataset.perm]=i.checked;});}
      const btn=$('button[type=submit]',el);btn.disabled=true;
      try{
        if(old){
          const body={nombre,tel,permisos};if(!mine)body.role=role;const ac=$('#uf-activo',el);if(ac)body.activo=ac.checked;
          await NET.api('PATCH','/api/users/'+encodeURIComponent(old.id),body);toast('Cambios guardados');closeModal();
        }else{
          const usuario=$('#uf-user',el).value.trim().toLowerCase(),clave=$('#uf-clave',el).value;
          if(!/^[a-z0-9._-]{2,32}$/.test(usuario)){btn.disabled=false;return toast('El usuario va sin espacios: letras, números, punto o guion','bad');}
          if(clave.length<(role==='admin'?8:6)){btn.disabled=false;return toast('La clave es muy corta','bad');}
          const j=await NET.api('POST','/api/users',{usuario,nombre,role,tel,clave,permisos});
          closeModal();credsModal(j.user,clave,'Usuario creado');
        }
        loadUsers();
      }catch(err){btn.disabled=false;toast(err.message||'No se pudo guardar','bad');}
    });
  }});
}
function openClaveForm(id){
  const u=ACC.users.find(x=>x.id===id);if(!u)return;
  openModal({title:'Nueva clave de '+u.nombre,html:`<form class="form" id="cform" novalidate>${F('Clave nueva','cf-clave','<div style="display:flex;gap:8px"><input id="cf-clave" autocomplete="off" autocapitalize="none" spellcheck="false" style="flex:1"><button class="btn" type="button" id="cf-gen">Generar</button></div>','Se le cierran las sesiones abiertas y tiene que entrar con la clave nueva.')}
    <div class="actions"><button class="btn ghost" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Cambiar clave</button></div></form>`,
    onMount(el){
      $('#cf-gen',el).addEventListener('click',()=>{$('#cf-clave',el).value=genClave();});
      $('#cform',el).addEventListener('submit',async e=>{
        e.preventDefault();const clave=$('#cf-clave',el).value;
        if(clave.length<(u.role==='admin'?8:6))return toast('La clave es muy corta','bad');
        try{await NET.api('POST','/api/users/'+encodeURIComponent(u.id)+'/clave',{clave});closeModal();credsModal(u,clave,'Clave cambiada');loadUsers();}
        catch(err){toast(err.message||'No se pudo cambiar','bad');}
      });
    }});
}
async function downloadBackup(){
  try{const j=await NET.api('GET','/api/backup',undefined,{timeout:120000});await saveFile('yapur-copia-'+todayStr()+'.json',JSON.stringify(j));}
  catch(err){toast(err.message||'No se pudo descargar la copia','bad');}
}
function restoreFromFile(file){
  const rd=new FileReader();
  rd.onerror=()=>toast('No se pudo leer el archivo','bad');
  rd.onload=async()=>{
    let obj;try{obj=JSON.parse(String(rd.result));}catch(e){return toast('El archivo no es una copia válida','bad');}
    if(!obj||!Array.isArray(obj.docs))return toast('El archivo no es una copia válida','bad');
    const nCli=obj.docs.filter(d=>d.coll==='clientes').reduce((n,d)=>n+Object.keys((d.data&&d.data.items)||{}).length,0);
    if(!await askConfirm(`Esta copia trae ${nCli} clientes. Restaurarla REEMPLAZA todos los datos actuales (se guarda una copia de seguridad antes). Se cierran todas las sesiones y los usuarios tienen que entrar de nuevo. ¿Seguimos?`,'Restaurar',true))return;
    try{
      showRestored(await NET.api('POST','/api/restore',obj,{timeout:300000,noKick:true}));
    }catch(err){toast(err.message||'No se pudo restaurar','bad');}
  };
  rd.readAsText(file);
}

function showRestored(r){
  const rows=(r.usuarios||[]).map(u=>`${u.nombre} (${ROLE_NAME[u.rol]||u.rol}) — usuario: ${u.usuario} — clave: ${u.clave}`);
  const txt=rows.join('\n');
  openModal({title:'Copia restaurada',html:`<p>Se restauraron ${r.docs} registros de datos.</p>${rows.length?`<div class="notice info">Las personas de la versión anterior pasaron a usuarios nuevos. Estas son sus claves provisorias (se muestran una sola vez). Cada una puede cambiarla desde «Mi cuenta».</div><pre class="mono small" style="white-space:pre-wrap;user-select:all">${esc(txt)}</pre><div class="actions start"><button class="btn" type="button" data-copy="${esc(txt)}" data-copy-label="Claves">Copiar</button></div>`:''}
    <div class="actions"><button class="btn primary" type="button" data-close>Entendido</button></div>`,onClose:async()=>{await NET.logout();location.reload();}});
}
const snapLabel=n=>{const m=/^yapur-(\d{4})-(\d{2})-(\d{2})(b?)$/.exec(n);if(m)return 'Del '+m[3]+'/'+m[2]+'/'+m[1]+(m[4]?' — a media jornada':' — al empezar el día');const t=/^antes-de-restaurar-(\d+)$/.exec(n);return t?'Guardada antes de restaurar ('+new Date(Number(t[1])).toLocaleString('es-AR')+')':n;};
async function openAutoBackups(){
  let list;
  try{list=(await NET.api('GET','/api/backups')).copias||[];}catch(err){return toast(err.message||'No se pudo leer las copias','bad');}
  openModal({title:'Copias automáticas del servidor',html:`<p class="muted small">El servidor guarda dos copias por día (las de los últimos 14 días). Restaurar una reemplaza todos los datos actuales; antes se guarda otra copia para poder volver atrás.</p>
    <div class="list">${list.length?list.map(c=>`<div class="item" style="cursor:default"><div><div class="t">${esc(snapLabel(c.name))}</div><div class="s">${Math.max(1,Math.round(c.bytes/1024))} KB</div></div><div class="tags"><button class="btn small" type="button" data-snap="${esc(c.name)}">Restaurar</button></div></div>`).join(''):'<div class="empty"><b>Todavía no hay copias</b><span>La primera se hace con el primer movimiento del día.</span></div>'}</div>
    <div class="actions"><button class="btn primary" type="button" data-close>Cerrar</button></div>`,
    onMount(el){el.addEventListener('click',async e=>{
      const b=e.target.closest('[data-snap]');if(!b)return;
      if(!await askConfirm('Esto REEMPLAZA todos los datos actuales por los de esa copia y cierra las sesiones de todos. ¿Seguimos?','Restaurar',true))return;
      try{closeModal();showRestored(await NET.api('POST','/api/backups/restore',{name:b.dataset.snap},{timeout:300000,noKick:true}));}
      catch(err){toast(err.message||'No se pudo restaurar','bad');}
    });}});
}

VIEWS.ajustes={
  mount(el){
    const cicField=(cy,k,l)=>F(l,`aj-c${cy}${k}`,`<input id="aj-c${cy}${k}" type="number" min="1" max="28" inputmode="numeric" value="${cicloCfg(cy)[k]}">`);
    el.innerHTML=`<div class="card"><h2>Empresa</h2><form class="form" id="aj-emp" novalidate>
      ${F('Nombre que se muestra arriba','aj-nombre',`<input id="aj-nombre" value="${esc(S.ajustes.empresa)}">`)}
      <div class="actions start"><button class="btn primary" type="submit">Guardar</button></div></form></div>
    <div class="card"><h2>Precios de instalación</h2><p class="muted small">Son los montos que cobra el técnico en la calle: él no puede cambiarlos ni poner otro importe. Solo vos podés modificarlos. La reconexión no se cobra.</p>
      <form class="form" id="aj-pre" novalidate><div class="grid2">
      ${F('Instalación','aj-pi',`<input id="aj-pi" type="text" inputmode="numeric" autocomplete="off" value="${esc(precioFijo('instalacion'))}">`)}
      ${F('Reinstalación (mudanza)','aj-pr',`<input id="aj-pr" type="text" inputmode="numeric" autocomplete="off" value="${esc(precioFijo('reinstalacion'))}">`,'Suele ser la mitad de la instalación, redondeada.')}</div>
      <div class="actions start"><button class="btn primary" type="submit">Guardar precios</button></div></form></div>
    <div class="card"><h2>Datos del recibo</h2><p class="muted small">Es lo que sale arriba y abajo de cada recibo, como en tu recibo de papel. Se carga una sola vez.</p>
      <form class="form" id="aj-rec" novalidate>
      ${F('Nombre comercial (arriba del recibo)','aj-r-ley',`<input id="aj-r-ley" value="${esc((S.ajustes.recibo||{}).leyenda||'')}" autocomplete="off" placeholder="Soluciones Informáticas">`)}
      ${F('Razón social','aj-r-raz',`<input id="aj-r-raz" value="${esc((S.ajustes.recibo||{}).razon||'')}" autocomplete="off">`)}
      <div class="grid2">${F('CUIT','aj-r-cuit',`<input id="aj-r-cuit" value="${esc((S.ajustes.recibo||{}).cuit||'')}" inputmode="numeric" autocomplete="off">`)}${F('Ingresos Brutos','aj-r-iibb',`<input id="aj-r-iibb" value="${esc((S.ajustes.recibo||{}).iibb||'')}" inputmode="numeric" autocomplete="off">`)}</div>
      ${F('Domicilio comercial','aj-r-dom',`<input id="aj-r-dom" value="${esc((S.ajustes.recibo||{}).dom||'')}" autocomplete="off">`)}
      ${F('Teléfonos de contacto','aj-r-tel',`<input id="aj-r-tel" value="${esc((S.ajustes.recibo||{}).tel||'')}" autocomplete="off" placeholder="Nombre: 3844-000000 / Nombre: 3844-111111">`)}
      <div class="grid2">${F('Sitio web','aj-r-web',`<input id="aj-r-web" value="${esc((S.ajustes.recibo||{}).web||'')}" autocomplete="off">`)}${F('Punto de venta','aj-r-pv',`<input id="aj-r-pv" value="${esc((S.ajustes.recibo||{}).pv||'')}" inputmode="numeric" autocomplete="off" placeholder="00004">`)}</div>
      ${F('Alias para pagar (uno por línea)','aj-r-ali',`<textarea id="aj-r-ali" rows="3">${esc(((S.ajustes.recibo||{}).alias||[]).join('\n'))}</textarea>`)}
      <div class="actions start"><button class="btn primary" type="submit">Guardar datos del recibo</button></div></form></div>
    <div class="card"><h2>Ciclos de cobro y promesas</h2><p class="muted small">Cada cliente paga en uno de los dos ciclos. Si el día de corte cae sábado, domingo o feriado, el corte pasa al siguiente día hábil.</p>
      <form class="form" id="aj-cic" novalidate>
      ${[1,2].map(cy=>`<fieldset class="fgroup" style="border:0;padding:0;margin:0"><legend>Ciclo ${cy}</legend><div class="grid2">${cicField(cy,'desde','Paga desde el día')}${cicField(cy,'hasta','Paga hasta el día')}</div>${cicField(cy,'corte','Se corta el día')}</fieldset>`).join('')}
      ${F('Promesa de pago: máximo de días','aj-pm',`<input id="aj-pm" type="number" min="1" max="60" inputmode="numeric" value="${esc(Number(S.ajustes.promesaMax)||10)}">`,'Es lo máximo que puede dar la oficina. Vos podés dar más.')}
      <div class="actions start"><button class="btn primary" type="submit">Guardar ciclos</button></div></form></div>
    <div class="card"><h2>Feriados</h2><p class="muted small">Vienen cargados los feriados nacionales de 2026 y 2027. Agregá los provinciales y locales, y los días no laborables que anuncie el Gobierno.</p>
      <form class="form" id="aj-fer" novalidate><div class="grid2">${F('Fecha','aj-ff','<input id="aj-ff" type="date">')}${F('Nombre','aj-fn','<input id="aj-fn" autocomplete="off" placeholder="Día de la ciudad">')}</div>
      <div class="actions start"><button class="btn primary" type="submit">Agregar feriado</button><button class="btn ghost" type="button" id="aj-fer-reset">Volver a la lista sugerida</button></div></form>
      <div class="hint" id="aj-fer-hint"></div><div class="list" id="aj-fer-list"></div></div>
    <div class="card"><div class="head-row"><h2>Usuarios y accesos</h2><button class="btn primary" type="button" id="aj-newp">Nuevo usuario</button></div>
      <p class="muted small">Cada persona entra con su usuario y su clave. Vos elegís qué puede ver y hacer. Los técnicos aparecen para asignarles órdenes.</p>
      <div class="list" id="aj-users"></div></div>
    <div class="card"><h2>Clientes y cobranzas</h2><p class="muted small">Importá tu lista actual desde un CSV y descargá copias de resguardo cuando quieras.</p>
      <div class="actions start"><button class="btn primary" type="button" id="aj-imp">Importar clientes (CSV)</button><button class="btn" type="button" id="aj-prb">Subir precios en bloque</button><button class="btn" type="button" id="aj-cero">Empezar a cobrar de cero</button><button class="btn" type="button" id="aj-exc">Descargar clientes</button><button class="btn" type="button" id="aj-exp">Descargar pagos</button></div></div>
    <div class="card"><div class="head-row"><h2>Routers MikroTik</h2><div class="tags"><button class="btn small" type="button" id="aj-refr">Actualizar</button><button class="btn primary" type="button" id="aj-newr">Agregar router</button></div></div>
      <p class="muted small">Cada router le manda al sistema la lista de sus clientes con un script de solo lectura, y de ahí los importás. El sistema <b>no entra</b> a los routers ni guarda sus claves: no puede cortar ni cambiar nada en ellos.</p>
      <div class="list" id="aj-routers"></div></div>
    <div class="card"><h2>Copias de seguridad</h2><p class="muted small">El servidor guarda dos copias automáticas por día (las de los últimos 14 días). Esas copias viven en el mismo lugar que los datos, así que de vez en cuando bajá una a tu equipo y guardala aparte.</p>
      <div class="actions start"><button class="btn primary" type="button" id="aj-bk">Descargar copia completa</button><button class="btn" type="button" id="aj-bks">Copias automáticas…</button><button class="btn" type="button" id="aj-rs">Restaurar desde un archivo…</button><input type="file" id="aj-rs-file" hidden></div></div>
    <div class="card"><h2>Cómo se protege</h2><dl class="kv"><dt>Entrada</dt><dd>Cada persona tiene su usuario y su clave. Si alguien deja la empresa, lo desactivás y se le cierra la sesión en el momento.</dd>
      <dt>Permisos</dt><dd>Los controla el servidor, no solo la pantalla: un técnico no recibe los pagos ni puede cambiar precios aunque pruebe con otra herramienta.</dd>
      <dt>Pagos</dt><dd>Un pago registrado no se edita: solo se anula, y queda anotado quién lo hizo.</dd></dl></div>`;
    /* índice: saltar a cada sección sin recorrer toda la pantalla */
    const secs=$$('.card',el).filter(c=>c.parentElement===el&&$('h2',c));
    el.insertAdjacentHTML('afterbegin',`<div class="toolbar aj-index"><div class="seg">${secs.map((c,i)=>{c.id='aj-sec'+i;return `<button type="button" data-sec="aj-sec${i}">${esc($('h2',c).textContent)}</button>`;}).join('')}</div></div>`);
    $('.aj-index',el).addEventListener('click',e=>{const b=e.target.closest('[data-sec]');if(!b)return;const t=$('#'+b.dataset.sec,el);if(t)t.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth',block:'start'});});
    $('#aj-emp',el).addEventListener('submit',async e=>{e.preventDefault();
      const nombre=$('#aj-nombre',el).value.trim();
      if(!nombre)return toast('Falta el nombre','bad');
      try{await saveAjustes({empresa:nombre});toast('Ajustes guardados');}catch(err){dbError(err);}});
    $('#aj-pre',el).addEventListener('submit',async e=>{e.preventDefault();
      const pi=Math.round(num($('#aj-pi',el).value)||0),pr=Math.round(num($('#aj-pr',el).value)||0);
      if(pi<=0||pr<=0||pi>1e7||pr>1e7)return toast('Cargá los dos precios (números mayores que cero)','bad');
      try{await saveAjustes({precioInstalacion:pi,precioReinstalacion:pr});toast('Precios guardados: instalación '+fmtMoney(pi)+' · reinstalación '+fmtMoney(pr));}catch(err){dbError(err);}});
    $('#aj-rec',el).addEventListener('submit',async e=>{e.preventDefault();
      const v=id=>$('#aj-r-'+id,el).value.trim().slice(0,200);
      const recibo={leyenda:v('ley'),razon:v('raz'),cuit:v('cuit'),iibb:v('iibb'),dom:v('dom'),tel:v('tel'),web:v('web'),pv:v('pv'),alias:$('#aj-r-ali',el).value.split(/\r?\n/).map(x=>x.trim().slice(0,80)).filter(Boolean).slice(0,6)};
      try{await saveAjustes({recibo});toast('Datos del recibo guardados');}catch(err){dbError(err);}});
    $('#aj-cic',el).addEventListener('submit',async e=>{e.preventDefault();
      const ciclos={};
      for(const cy of [1,2]){
        const g=k=>Math.floor(Number($('#aj-c'+cy+k,el).value)||0);
        const o={desde:g('desde'),hasta:g('hasta'),corte:g('corte')};
        if(o.desde<1||o.corte>28||!(o.desde<=o.hasta&&o.hasta<o.corte))return toast(`Ciclo ${cy}: los días tienen que ir de menor a mayor (paga desde, paga hasta, corte) y hasta el 28.`,'bad');
        ciclos[cy]=o;
      }
      const pm=Math.floor(Number($('#aj-pm',el).value)||0);
      if(pm<1||pm>60)return toast('Las promesas pueden ser de 1 a 60 días','bad');
      try{await saveAjustes({ciclos,promesaMax:pm});toast('Ciclos guardados');}catch(err){dbError(err);}});
    $('#aj-fer',el).addEventListener('submit',async e=>{e.preventDefault();
      const f=$('#aj-ff',el).value,n=$('#aj-fn',el).value.trim();
      if(!f)return toast('Elegí la fecha','bad');
      if(!n)return toast('Escribí el nombre del feriado','bad');
      const list=feriadosList().filter(x=>x.f!==f).concat([{f,n}]).sort((a,b)=>a.f.localeCompare(b.f));
      try{await saveAjustes({feriados:list});toast('Feriado agregado');$('#aj-ff',el).value='';$('#aj-fn',el).value='';}catch(err){dbError(err);}});
    $('#aj-fer-reset',el).addEventListener('click',async()=>{
      if(!await askConfirm('¿Volver a la lista sugerida? Se pierden los feriados que agregaste.','Volver a la lista'))return;
      try{await saveAjustes({feriados:null});toast('Lista sugerida restaurada');}catch(err){dbError(err);}});
    $('#aj-fer-list',el).addEventListener('click',async e=>{
      const b=e.target.closest('[data-fer-del]');if(!b)return;
      try{await saveAjustes({feriados:feriadosList().filter(x=>x.f!==b.dataset.ferDel)});toast('Feriado quitado');}catch(err){dbError(err);}});
    $('#aj-newp',el).addEventListener('click',()=>openUserForm(null));
    $('#aj-users',el).addEventListener('click',async e=>{
      const b=e.target.closest('[data-u-act]');if(!b)return;
      const u=ACC.users.find(x=>x.id===b.dataset.u);if(!u)return;
      const act=b.dataset.uAct;
      if(act==='edit')return openUserForm(u.id);
      if(act==='clave')return openClaveForm(u.id);
      try{
        if(act==='off'){
          if(!await askConfirm(`¿Desactivar a ${u.nombre}? Se le cierra la sesión ahora mismo y no puede volver a entrar hasta que lo actives.`,'Desactivar',true))return;
          await NET.api('PATCH','/api/users/'+encodeURIComponent(u.id),{activo:false});toast('Usuario desactivado');
        }else if(act==='on'){
          await NET.api('PATCH','/api/users/'+encodeURIComponent(u.id),{activo:true});toast('Usuario activado');
        }
        loadUsers();
      }catch(err){toast(err.message||'No se pudo cambiar','bad');}
    });
    $('#aj-bk',el).addEventListener('click',downloadBackup);
    $('#aj-bks',el).addEventListener('click',openAutoBackups);
    $('#aj-rs',el).addEventListener('click',()=>$('#aj-rs-file',el).click());
    $('#aj-rs-file',el).addEventListener('change',e=>{const f=e.target.files[0];e.target.value='';if(f)restoreFromFile(f);});
    loadUsers();bindRouters(el);
    $('#aj-imp',el).addEventListener('click',()=>openImport());
    $('#aj-prb',el).addEventListener('click',()=>openPreciosBloque());
    $('#aj-cero',el).addEventListener('click',()=>openCeroBloque());
    $('#aj-exc',el).addEventListener('click',exportClientes);
    $('#aj-exp',el).addEventListener('click',exportPagos);
    this.update();
  },
  update(){
    const fl=$('#aj-fer-list');
    if(fl){
      const today=todayStr(),all=feriadosList(),up=all.filter(x=>x.f>=today).sort((a,b)=>a.f.localeCompare(b.f));
      const last=all.reduce((m,x)=>x.f>m?x.f:m,'');
      $('#aj-fer-hint').textContent=last?`Cargados hasta el ${dmy(last)}.`:'No hay feriados cargados.';
      $('#aj-fer-hint').className='hint'+(!last||last<dateAdd(today,120)?' bad':'');
      fl.innerHTML=up.length?up.slice(0,40).map(x=>`<div class="item" style="cursor:default"><div><div class="t">${esc(x.n||'Feriado')}</div><div class="s">${esc(dateLabel(x.f))} ${esc(x.f.slice(0,4))}</div></div><div class="tags"><button class="btn small ghost" type="button" data-fer-del="${esc(x.f)}">Quitar</button></div></div>`).join(''):'<div class="empty"><b>No hay feriados por delante</b><span>Agregalos para que el corte se corra solo.</span></div>';
    }
    const sig=JSON.stringify(S.ajustes.perfiles.map(p=>[p.id,p.activo,p.nombre,p.base,p.tel]));
    if(sig!==ACC.sig){ACC.sig=sig;if(ACC.loaded)loadUsers();}
  }
};
