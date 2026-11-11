/* ===== cambiar la tecnología de un cliente: de antena a fibra óptica, o de fibra a antena (por ejemplo, en una mudanza a un lugar sin fibra) ===== */
/* Un cliente que cambia de tecnología cambia de IP (y a veces de usuario), de nodo o caja NAP y de equipos: pasando a fibra se retira la antena con su inyector y se instala una ONU;
   pasando a antena se retira la ONU y se instala una antena con su inyector. Si además se mudó, se cargan el domicilio y la ubicación nuevos.
   Se hace todo junto desde la ficha y queda anotado en el historial del cliente (fecha, quién, IP de antes y de ahora, domicilio, equipos retirados). Es solo un registro en el sistema:
   la IP y la cola del router se cambian en el MikroTik a mano (el sistema no toca los routers). */
const MG_ONU_FUENTE='Fuente de corriente de la ONU';
const MG_POE='Inyector de corriente PoE';
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
  return `<li><b>${m.dom?'Se mudó y pasó':'Pasó'} a ${esc(a.toLowerCase())} el ${esc(dmy(m.f))}</b>${m.por?' · '+esc(m.por):''}<br><span class="small">Antes: ${esc(antes)}.<br>Ahora: ${esc(ahora)}.</span>${m.dom?`<br><span class="small">Domicilio: ${m.domAnt?'antes '+esc(m.domAnt)+'; ':''}ahora ${esc(m.dom)}.</span>`:''}${ret?`<br><span class="small muted">Se retiró: ${esc(ret)}.</span>`:''}${m.obs?`<br><span class="small muted">${esc(m.obs)}</span>`:''}</li>`;
};
/* en la ficha: los botones para cambiar de tecnología y el historial; la tecnología y la IP de hoy ya figuran arriba, en los datos del cliente.
   Se ofrecen también a los clientes que todavía no tienen la tecnología cargada (hoy son la mayoría). */
function migBlock(c){
  if(c.estado==='baja')return '';
  const mig=Array.isArray(c.migraciones)?c.migraciones:[];
  const permiso=can('editarClientes')||can('ubicacion');
  const aFibra=permiso&&c.tec!=='fibra',aAntena=permiso&&c.tec!=='wireless';
  if(!aFibra&&!aAntena&&!mig.length)return '';
  return `<div class="card flat mg-block"><h3>Migración y mudanza</h3>
    ${mig.length?`<ul class="cm-list">${mig.slice().reverse().map(mgLinea).join('')}</ul>`:''}
    ${aFibra||aAntena?`<div class="hint">${aFibra?'Si el cliente pasa de antena a fibra óptica, migralo desde acá: se anotan la IP de la antena y la de la fibra, y se cambian los equipos. ':''}${aAntena?'Si se muda a un lugar donde no hay fibra, pasalo a antena: se carga el domicilio nuevo, la IP de la antena y se retira la ONU.':''}</div><div class="actions start">${aFibra?'<button class="btn small primary" type="button" data-act="migrar">Migrar a fibra óptica</button>':''}${aAntena?'<button class="btn small'+(aFibra?'':' primary')+'" type="button" data-act="migrar-ant">Pasar a antena (mudanza)</button>':''}</div>`:''}</div>`;
}
/* destino: 'fibra' (de antena a fibra) o 'wireless' (de fibra a antena) */
async function openMigrar(id,destino){
  const c=S.clientes.get(id),fib=destino!=='wireless',dest=fib?'fibra':'wireless';
  if(!c||c.tec===dest)return;
  const conEq=can('comodato'),conNap=fib&&can('red');
  if(conEq)await cmCargarModelos();
  const eqs=conEq?cmLimpio(c.comodato):[];
  /* lo que se retira por defecto: pasando a fibra, la antena y su inyector; pasando a antena, la ONU y su fuente */
  const sale=fib?e=>e.t==='Antena'||/inyector|poe/i.test(e.d):e=>e.t==='ONU'||/\bonu\b/i.test(e.d);
  const tipoNuevo=fib?'ONU':'Antena',cosa=fib?'ONU':'antena',nombreNuevo=fib?'la ONU':'la antena';
  const modelos=cmLista(tipoNuevo),mod0=cmModeloInicial(tipoNuevo);
  const otro0=!modelos.length;
  const eqLinea=(e,i)=>`<label class="per"><input type="checkbox" data-ret="${i}"${sale(e)?' checked':''}><span class="grow">${esc(e.t)} · ${esc(e.d||'sin modelo')}${e.s?' · <span class="mono">'+esc(e.s)+'</span>':''}</span></label>`;
  const titulo=fib?'Migrar a fibra óptica':'Pasar a antena';
  const dom0=[c.dir,c.loc].filter(Boolean).join(', ');
  const html=`<div class="hint"><b>${esc(c.nombre)}</b> pasa de <b>${esc(TECNOS[c.tec]||'su conexión actual')}</b> a <b>${esc(TECNOS[dest])}</b>. Queda anotado en su ficha con la fecha, quién lo hizo y las dos IP.</div>
    <form class="form" id="mgform" novalidate>
    <fieldset class="fgroup" style="border:0;padding:0;margin:0"><legend>IP</legend>
      <div class="grid2">${F(fib?'IP de la antena (hoy)':'IP de la fibra (hoy)','mg-ipa',`<input id="mg-ipa" class="mono" inputmode="decimal" autocomplete="off" placeholder="Sin IP cargada" value="${esc(c.ip||'')}">`,'Está cargada en su ficha: corregila si no es la que tiene ahora.')}
      ${F(fib?'IP que va a tener con la fibra *':'IP que va a tener con la antena *','mg-ip',`<input id="mg-ip" class="mono" inputmode="decimal" autocomplete="off" placeholder="${fib?'192.168.100.4':'10.20.43.9'}">`)}</div>
      <div class="hint" id="mg-ip-h"></div>
      ${F('Usuario (PPPoE o similar)','mg-usu',`<input id="mg-usu" class="mono" autocomplete="off" maxlength="80" value="${esc(c.usuario||'')}">`,'Dejalo como está si no cambia.')}</fieldset>
    <fieldset class="fgroup" style="border:0;padding:0;margin:0"><legend>Domicilio</legend>
      <label class="per"><input type="checkbox" id="mg-mud"><span class="grow">${fib?'También cambió de domicilio':'Se mudó: tiene un domicilio nuevo'}</span></label>
      <div id="mg-mudw" hidden style="margin-top:10px">
        <div class="grid2">${F('Calle y número nuevo *','mg-dir','<input id="mg-dir" autocomplete="off" maxlength="120">')}${F('Barrio o localidad','mg-loc',`<input id="mg-loc" autocomplete="off" maxlength="80" value="${esc(c.loc||'')}">`)}</div>
        ${F('Referencia para llegar','mg-ref','<input id="mg-ref" autocomplete="off" maxlength="120" placeholder="Portón verde, frente a la plaza…">')}
        ${geoFieldHTML(Object.assign({},c,{lat:null,lng:null}),'Si estás en el domicilio nuevo, tocá el botón y se completa solo. Si lo dejás vacío se borra la ubicación del domicilio anterior.')}
        ${dom0?`<div class="hint">Domicilio anterior: ${esc(dom0)}.</div>`:''}</div></fieldset>
    <fieldset class="fgroup" style="border:0;padding:0;margin:0"><legend>Dónde queda conectado</legend>
      ${nodoFieldHTML(Object.assign({},c,{nodo:''}),'mg')}${c.nodo?`<div class="hint">Estaba en: ${esc(c.nodo)}. ${fib?'Elegí el nodo de la fibra o dejalo sin definir.':'Elegí la torre o el nodo al que se conecta la antena.'}</div>`:''}
      ${conNap?napFieldHTML(Object.assign({},c,{nap:null,napPuerto:null})):''}</fieldset>
    ${conEq?`<fieldset class="fgroup" style="border:0;padding:0;margin:0"><legend>Equipos</legend>
      <div class="grid2">${F(fib?'ONU que se instala':'Antena que se instala','mg-m',modelos.length?`<select id="mg-m">${modelos.map(d=>`<option value="${esc(d)}"${d===mod0?' selected':''}>${esc(d)}</option>`).join('')}<option value="${CM_OTRO}">Otro modelo (escribirlo)</option></select>`:'<span class="muted small">Sin lista de modelos: escribilo abajo.</span>')}
      ${F(fib?'MAC de la ONU (o N° de serie) *':'MAC de la antena (o N° de serie) *','mg-s',`<input id="mg-s" class="mono" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="60" placeholder="Está en la etiqueta del equipo">`)}</div>
      <div id="mg-dw"${otro0?'':' hidden'}>${F('Marca y modelo de '+nombreNuevo,'mg-d',`<input id="mg-d" autocomplete="off" maxlength="80" placeholder="${fib?'Huawei HG8145V5':'Ubiquiti LiteBeam 5AC Gen2'}">`)}</div>
      ${eqs.length?`<div class="field"><label>Equipos que se retiran del cliente</label><div class="list">${eqs.map(eqLinea).join('')}</div><div class="hint">Lo que quede sin tildar sigue en comodato. ${fib?'La ONU y su fuente se agregan solas.':'La antena y su inyector se agregan solos.'}</div></div>`:`<div class="hint">${fib?'La ONU y su fuente quedan cargadas como equipos en comodato.':'La antena y su inyector quedan cargados como equipos en comodato.'}</div>`}</fieldset>`:''}
    ${F('Observaciones (opcional)','mg-obs',`<input id="mg-obs" autocomplete="off" maxlength="200" placeholder="${fib?'Por ejemplo: se dejó la antena para otro cliente':'Por ejemplo: la fibra no llega a la casa nueva'}">`)}
    <div class="actions"><button class="btn ghost" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">${titulo}</button></div></form>`;
  openModal({title:titulo,html,onMount(el){
    bindNodoField(el,'mg');
    const readGeo=bindGeoField(el);
    const readNap=conNap?bindNapField(el,c.id):()=>null;
    const v=i=>{const n=$('#'+i,el);return n?n.value.trim():'';};
    const mud=$('#mg-mud',el),mudw=$('#mg-mudw',el);
    mud.addEventListener('change',()=>{mudw.hidden=!mud.checked;if(mud.checked)$('#mg-dir',el).focus();});
    /* avisa mientras escribe si la IP no es válida o ya la tiene otro cliente */
    const ipH=$('#mg-ip-h',el),chkIp=()=>{
      const t=v('mg-ip'),ip=mgIp(t);ipH.className='hint';ipH.textContent='';
      if(!t)return;
      if(!ip){ipH.className='hint bad';ipH.textContent='Esa IP no es válida: tiene que ser una sola, por ejemplo '+(fib?'192.168.100.4':'10.20.43.9')+'.';return;}
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
      const ipN=mgIp(v('mg-ip')),conque=fib?'la fibra':'la antena';
      if(!v('mg-ip'))return toast('Falta la IP que va a tener con '+conque,'bad');
      if(!ipN)return toast('La IP con '+conque+' no es válida','bad');
      const dup=mgIpDe(ipN,c.id);if(dup)return toast('Esa IP ya la tiene '+(clientVisible(dup)?dup.nombre:'otro cliente'),'bad');
      const ipA=v('mg-ipa');
      if(ipA&&!mgIp(ipA))return toast('La IP de '+(fib?'la antena':'la fibra')+' no es válida (dejala vacía si no la sabés)','bad');
      let dom=null,geo=null;
      if(mud.checked){
        if(!v('mg-dir'))return toast('Falta la calle y el número del domicilio nuevo','bad');
        geo=readGeo();if(geo.invalid)return toast('La ubicación del domicilio nuevo no es válida','bad');
        dom={dir:v('mg-dir'),loc:v('mg-loc'),ref:v('mg-ref')};
      }
      const nf=readNap();if(nf&&nf.bad)return toast(nf.bad,'bad');
      let nuevo=null;
      if(conEq){
        const otro=!sm||sm.value===CM_OTRO,d=otro?v('mg-d'):sm.value,s=cmMacFmt(v('mg-s'));
        if(!d)return toast('Falta el modelo de '+nombreNuevo,'bad');
        if(!s)return toast('Escribí la MAC de '+nombreNuevo+(fib?' (o su N° de serie)':''),'bad');
        const mal=cmMacMal(s);if(mal)return toast(mal,'bad');
        nuevo={t:tipoNuevo,d,s,n:1,e:'nuevo',o:''};
      }
      const quitar=new Set($$('[data-ret]',el).filter(i=>i.checked).map(i=>Number(i.dataset.ret)));
      const retiro=eqs.filter((x,i)=>quitar.has(i)).map(x=>({t:x.t,d:x.d,s:x.s}));
      /* si la tecnología de hoy no estaba cargada, se anota que venía de la otra */
      const mig={f:todayStr(),ts:Date.now(),de:c.tec||(fib?'wireless':'fibra'),a:dest};
      if(ipA)mig.ipAnt=ipA;if(ipN)mig.ip=ipN;if(c.nodo)mig.nodoAnt=String(c.nodo).slice(0,80);if(c.equipo)mig.eqAnt=String(c.equipo).slice(0,80);
      if(retiro.length)mig.ret=retiro;
      if(dom){mig.dom=[dom.dir,dom.loc].filter(Boolean).join(', ').slice(0,160);if(dom0)mig.domAnt=dom0.slice(0,160);}
      const obs=v('mg-obs');if(obs)mig.obs=obs;
      mig.por=(S.me&&S.me.nombre)||'';
      const patch={tec:dest,ip:ipN,usuario:v('mg-usu'),nodo:v('mg-nodo'),migraciones:(Array.isArray(c.migraciones)?c.migraciones:[]).concat([mig])};
      if(nf){patch.nap=nf.nap;patch.napPuerto=nf.puerto;}
      if(!fib){patch.nap=null;patch.napPuerto=null;}   /* una antena no sale de una caja NAP */
      if(dom){patch.dir=dom.dir;patch.loc=dom.loc;patch.ref=dom.ref;patch.lat=geo.empty?null:geo.lat;patch.lng=geo.empty?null:geo.lng;}
      if(nuevo){
        patch.equipo=nuevo.s;
        patch.comodato=cmLimpio(eqs.filter((x,i)=>!quitar.has(i)).concat([nuevo,{t:'Fuente o adaptador',d:fib?MG_ONU_FUENTE:MG_POE,s:'',n:1,e:'nuevo',o:''}]));
      }
      const btn=$('button[type=submit]',el);btn.disabled=true;
      try{
        const obj=await saveClient(c,patch);
        S.clientes.set(id,Object.assign({},c,obj));dataChanged('clientes');
        if(nuevo&&cmLista(tipoNuevo).includes(nuevo.d))cmUltPoner(tipoNuevo,nuevo.d);
        toast(fib?'Cliente migrado a fibra óptica':'Cliente pasado a antena');closeModal();openClient(id);
      }catch(err){btn.disabled=false;dbError(err);}
    });
  }});
}
