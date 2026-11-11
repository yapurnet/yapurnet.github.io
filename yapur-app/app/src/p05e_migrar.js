/* ===== migrar un cliente de antena a fibra óptica ===== */
/* Un cliente que hoy está con antena y pasa a fibra cambia de tecnología, de IP (y a veces de usuario), de caja NAP y de equipos: se retira la antena con su inyector y se instala una ONU.
   Se hace todo junto desde la ficha y queda anotado en el historial del cliente (fecha, quién, IP de antes y de ahora, equipos retirados). Es solo un registro en el sistema:
   la IP y la cola del router se cambian en el MikroTik a mano (el sistema no toca los routers). */
const MG_ONU_FUENTE='Fuente de corriente de la ONU';
/* una sola IP válida con los números como se escriben (sin ceros de más) o vacío */
const mgIp=t=>ipUnica(t);
/* ¿qué otro cliente ya tiene esa IP? (su ficha puede traer varias IP separadas por coma, espacio o /) */
function mgIpDe(ip,idPropio){
  for(const x of S.clientes.values()){
    if(x.id===idPropio||x.estado==='baja')continue;
    if(String(x.ip||'').split(/[\s,;]+/).some(t=>mgIp(t)===ip))return x;
  }
  return null;
}
const mgLinea=m=>{
  const de=TECNOS[m.de]||m.de,a=TECNOS[m.a]||m.a;
  const antes=[de,m.ipAnt?'IP '+m.ipAnt:'',m.nodoAnt||''].filter(Boolean).join(' · ');
  const ahora=[a,m.ip?'IP '+m.ip:''].filter(Boolean).join(' · ');
  const ret=Array.isArray(m.ret)&&m.ret.length?m.ret.map(e=>[e.d||e.t,e.s].filter(Boolean).join(' ')).join(', '):'';
  return `<li><b>Pasó a ${esc(a.toLowerCase())} el ${esc(dmy(m.f))}</b>${m.por?' · '+esc(m.por):''}<br><span class="small">Antes: ${esc(antes)}.<br>Ahora: ${esc(ahora)}.</span>${ret?`<br><span class="small muted">Se retiró: ${esc(ret)}.</span>`:''}${m.obs?`<br><span class="small muted">${esc(m.obs)}</span>`:''}</li>`;
};
/* en la ficha: el botón para migrar (si está por antena) y el historial de migraciones; la tecnología y la IP de hoy ya figuran arriba, en los datos del cliente */
function migBlock(c){
  if(c.estado==='baja')return '';
  const mig=Array.isArray(c.migraciones)?c.migraciones:[];
  const puede=c.tec!=='fibra'&&(can('editarClientes')||can('ubicacion'));   /* también los que todavía no tienen la tecnología cargada: hoy es la mayoría */
  if(!puede&&!mig.length)return '';
  return `<div class="card flat mg-block"><h3>Migración a fibra óptica</h3>
    ${mig.length?`<ul class="cm-list">${mig.slice().reverse().map(mgLinea).join('')}</ul>`:''}
    ${puede?'<div class="hint">Si el cliente pasa de antena a fibra óptica, migralo desde acá: se anotan la IP de la antena y la de la fibra, y se cambian los equipos.</div><div class="actions start"><button class="btn small primary" type="button" data-act="migrar">Migrar a fibra óptica</button></div>':''}</div>`;
}
async function openMigrar(id){
  const c=S.clientes.get(id);if(!c||c.tec==='fibra')return;
  const conEq=can('comodato'),conNap=can('red');
  if(conEq)await cmCargarModelos();
  const eqs=conEq?cmLimpio(c.comodato):[];
  const esAntena=e=>e.t==='Antena'||/inyector|poe/i.test(e.d);
  const modelos=cmLista('ONU'),mod0=cmModeloInicial('ONU');
  const otro0=!modelos.length;
  const eqLinea=(e,i)=>`<label class="per"><input type="checkbox" data-ret="${i}"${esAntena(e)?' checked':''}><span class="grow">${esc(e.t)} · ${esc(e.d||'sin modelo')}${e.s?' · <span class="mono">'+esc(e.s)+'</span>':''}</span></label>`;
  const html=`<div class="hint"><b>${esc(c.nombre)}</b> pasa de <b>${esc(TECNOS[c.tec]||'su conexión actual')}</b> a <b>Fibra óptica</b>. Queda anotado en su ficha con la fecha, quién lo hizo y las dos IP.</div>
    <form class="form" id="mgform" novalidate>
    <fieldset class="fgroup" style="border:0;padding:0;margin:0"><legend>IP</legend>
      <div class="grid2">${F('IP de la antena (hoy)','mg-ipa',`<input id="mg-ipa" class="mono" inputmode="decimal" autocomplete="off" placeholder="Sin IP cargada" value="${esc(c.ip||'')}">`,'Está cargada en su ficha: corregila si no es la que tiene ahora.')}
      ${F('IP que va a tener con la fibra *','mg-ip',`<input id="mg-ip" class="mono" inputmode="decimal" autocomplete="off" placeholder="192.168.100.4">`)}</div>
      <div class="hint" id="mg-ip-h"></div>
      ${F('Usuario (PPPoE o similar)','mg-usu',`<input id="mg-usu" class="mono" autocomplete="off" maxlength="80" value="${esc(c.usuario||'')}">`,'Dejalo como está si no cambia.')}</fieldset>
    <fieldset class="fgroup" style="border:0;padding:0;margin:0"><legend>Dónde queda conectado</legend>
      ${nodoFieldHTML(Object.assign({},c,{nodo:''}),'mg')}${c.nodo?`<div class="hint">Estaba en: ${esc(c.nodo)}. Elegí el nodo de la fibra o dejalo sin definir.</div>`:''}
      ${conNap?napFieldHTML(Object.assign({},c,{nap:null,napPuerto:null})):''}</fieldset>
    ${conEq?`<fieldset class="fgroup" style="border:0;padding:0;margin:0"><legend>Equipos</legend>
      <div class="grid2">${F('ONU que se instala','mg-m',modelos.length?`<select id="mg-m">${modelos.map(d=>`<option value="${esc(d)}"${d===mod0?' selected':''}>${esc(d)}</option>`).join('')}<option value="${CM_OTRO}">Otro modelo (escribirlo)</option></select>`:'<span class="muted small">Sin lista de modelos: escribilo abajo.</span>')}
      ${F('MAC de la ONU (o N° de serie) *','mg-s',`<input id="mg-s" class="mono" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="60" placeholder="Está en la etiqueta del equipo">`)}</div>
      <div id="mg-dw"${otro0?'':' hidden'}>${F('Marca y modelo de la ONU','mg-d',`<input id="mg-d" autocomplete="off" maxlength="80" placeholder="Huawei HG8145V5">`)}</div>
      ${eqs.length?`<div class="field"><label>Equipos que se retiran del cliente</label><div class="list">${eqs.map(eqLinea).join('')}</div><div class="hint">Lo que quede sin tildar sigue en comodato. La ONU y su fuente se agregan solas.</div></div>`:'<div class="hint">La ONU y su fuente quedan cargadas como equipos en comodato.</div>'}</fieldset>`:''}
    ${F('Observaciones (opcional)','mg-obs','<input id="mg-obs" autocomplete="off" maxlength="200" placeholder="Por ejemplo: se dejó la antena para otro cliente">')}
    <div class="actions"><button class="btn ghost" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Migrar a fibra óptica</button></div></form>`;
  openModal({title:'Migrar a fibra óptica',html,onMount(el){
    bindNodoField(el,'mg');
    const readNap=conNap?bindNapField(el,c.id):()=>null;
    const v=i=>{const n=$('#'+i,el);return n?n.value.trim():'';};
    /* avisa mientras escribe si la IP no es válida o ya la tiene otro cliente */
    const ipH=$('#mg-ip-h',el),chkIp=()=>{
      const t=v('mg-ip'),ip=mgIp(t);ipH.className='hint';ipH.textContent='';
      if(!t)return;
      if(!ip){ipH.className='hint bad';ipH.textContent='Esa IP no es válida: tiene que ser una sola, por ejemplo 192.168.100.4.';return;}
      const o=mgIpDe(ip,c.id);
      if(o){ipH.className='hint bad';ipH.textContent='Esa IP ya la tiene '+(clientVisible(o)?o.nombre:'otro cliente')+'. Revisala.';}
    };
    $('#mg-ip',el).addEventListener('input',chkIp);
    const sm=$('#mg-m',el);
    if(sm)sm.addEventListener('change',()=>{const w=$('#mg-dw',el);w.hidden=sm.value!==CM_OTRO;if(!w.hidden)$('#mg-d',el).focus();});
    const sInp=$('#mg-s',el);
    if(sInp){sInp.addEventListener('input',()=>{const p=sInp.selectionStart,u=sInp.value.toUpperCase();if(u!==sInp.value){sInp.value=u;try{sInp.setSelectionRange(p,p);}catch(_){}}});sInp.addEventListener('change',()=>{sInp.value=cmMacFmt(sInp.value);});}
    $('#mgform',el).addEventListener('submit',async e=>{
      e.preventDefault();
      const ipN=mgIp(v('mg-ip'));
      if(!v('mg-ip'))return toast('Falta la IP que va a tener con la fibra','bad');
      if(!ipN)return toast('La IP con la fibra no es válida','bad');
      const dup=mgIpDe(ipN,c.id);if(dup)return toast('Esa IP ya la tiene '+(clientVisible(dup)?dup.nombre:'otro cliente'),'bad');
      const ipA=v('mg-ipa');
      if(ipA&&!mgIp(ipA))return toast('La IP de la antena no es válida (dejala vacía si no la sabés)','bad');
      const nf=readNap();if(nf&&nf.bad)return toast(nf.bad,'bad');
      let onu=null;
      if(conEq){
        const otro=!sm||sm.value===CM_OTRO,d=otro?v('mg-d'):sm.value,s=cmMacFmt(v('mg-s'));
        if(!d)return toast('Falta el modelo de la ONU','bad');
        if(!s)return toast('Escribí la MAC de la ONU (o su N° de serie)','bad');
        const mal=cmMacMal(s);if(mal)return toast(mal,'bad');
        onu={t:'ONU',d,s,n:1,e:'nuevo',o:''};
      }
      const quitar=new Set($$('[data-ret]',el).filter(i=>i.checked).map(i=>Number(i.dataset.ret)));
      const retiro=eqs.filter((x,i)=>quitar.has(i)).map(x=>({t:x.t,d:x.d,s:x.s}));
      const mig={f:todayStr(),ts:Date.now(),de:c.tec||'wireless',a:'fibra'};
      if(ipA)mig.ipAnt=ipA;if(ipN)mig.ip=ipN;if(c.nodo)mig.nodoAnt=String(c.nodo).slice(0,80);if(c.equipo)mig.eqAnt=String(c.equipo).slice(0,80);
      if(retiro.length)mig.ret=retiro;
      const obs=v('mg-obs');if(obs)mig.obs=obs;
      mig.por=(S.me&&S.me.nombre)||'';
      const patch={tec:'fibra',ip:ipN,usuario:v('mg-usu'),nodo:v('mg-nodo'),migraciones:(Array.isArray(c.migraciones)?c.migraciones:[]).concat([mig])};
      if(nf){patch.nap=nf.nap;patch.napPuerto=nf.puerto;}
      if(onu){
        patch.equipo=onu.s;
        patch.comodato=cmLimpio(eqs.filter((x,i)=>!quitar.has(i)).concat([onu,{t:'Fuente o adaptador',d:MG_ONU_FUENTE,s:'',n:1,e:'nuevo',o:''}]));
      }
      const btn=$('button[type=submit]',el);btn.disabled=true;
      try{
        const obj=await saveClient(c,patch);
        S.clientes.set(id,Object.assign({},c,obj));dataChanged('clientes');
        if(onu&&cmLista('ONU').includes(onu.d))cmUltPoner('ONU',onu.d);
        toast('Cliente migrado a fibra óptica');closeModal();openClient(id);
      }catch(err){btn.disabled=false;dbError(err);}
    });
  }});
}
