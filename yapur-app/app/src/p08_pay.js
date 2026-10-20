/* ===== cobranzas ===== */
const CB={sub:'cobrar',fecha:'',mq:'',min:1};
const newRecibo=f=>'R'+f.replace(/-/g,'').slice(2)+'-'+Math.random().toString(36).slice(2,5).toUpperCase();
const paymentsOfReceipt=r=>[...S.pagos.values()].filter(p=>p.recibo===r);
const paymentsOn=d=>[...S.pagos.values()].filter(p=>p.fecha===d).sort((a,b)=>(b.hora||'').localeCompare(a.hora||''));
function allocate(sel,received){
  let left=received;const out=[];
  for(const p of sel){if(left<=0)break;const a=Math.min(p.rest,left);out.push({per:p.per,monto:a});left-=a;}
  if(left>0&&out.length)out[out.length-1].monto+=left;
  return out;
}
function receiptText(recibo){
  const ps=paymentsOfReceipt(recibo).sort((a,b)=>(a.per||'').localeCompare(b.per||''));if(!ps.length)return '';
  const p0=ps[0],c=S.clientes.get(p0.c);
  const total=ps.reduce((s,p)=>s+(Number(p.monto)||0),0);
  const lines=[S.ajustes.empresa,'RECIBO N° '+recibo,'Fecha: '+dmy(p0.fecha)+(p0.hora?' '+p0.hora:''),'Cliente: '+(c?c.nombre+(c.codigo?' (#'+c.codigo+')':''):'—'),''];
  ps.forEach(p=>lines.push((p.concepto==='mensualidad'&&p.per?'Abono '+monthLabel(p.per):(CONCEPTOS[p.concepto]||'Otro')+(p.nota&&p.concepto!=='mensualidad'?': '+p.nota:''))+'  '+fmtMoney(p.monto)));
  lines.push('','TOTAL  '+fmtMoney(total),'Medio de pago: '+(METODOS[p0.metodo]||p0.metodo));
  if(c&&p0.concepto==='mensualidad'&&servicioTxt(c)!=='Sin plan')lines.push('Servicio: '+servicioTxt(c));
  if(p0.anulado)lines.push('','*** RECIBO ANULADO ***');
  return lines.join('\n');
}
function openReceipt(recibo){
  const txt=receiptText(recibo);if(!txt)return toast('No se encontró el recibo','bad');
  const ps=paymentsOfReceipt(recibo),c=S.clientes.get(ps[0].c);
  openModal({title:'Recibo '+recibo,html:`<div class="receipt">${esc(txt)}</div>
    <div class="actions start"><button class="btn primary" type="button" data-copy="${esc(txt)}" data-copy-label="Recibo">Copiar recibo</button>
    ${c&&c.tel?`<a class="btn" target="_blank" rel="noopener" href="${waUrl(c.tel,txt)}">Enviar por WhatsApp</a>`:''}
    ${ps[0].anulado||!can('anular')?'':`<button class="btn danger" type="button" id="rc-anular">Anular</button>`}<button class="btn ghost" type="button" data-close>Cerrar</button></div>`,
    onMount(el){const b=$('#rc-anular',el);if(b)b.addEventListener('click',()=>openAnular(recibo));}});
}
function openAnular(recibo){
  openModal({title:'Anular recibo',html:`<p>El recibo <span class="mono">${esc(recibo)}</span> queda marcado como anulado y los meses vuelven a figurar como pendientes. No se borra, queda en la caja del día.</p>
    ${F('Motivo *','an-mot','<input id="an-mot" autocomplete="off" placeholder="Error de monto, cobro duplicado…">')}
    <div class="actions"><button class="btn ghost" type="button" data-close>Volver</button><button class="btn danger" type="button" id="an-go">Anular recibo</button></div>`,
    onMount(el){$('#an-go',el).addEventListener('click',async()=>{
      const m=$('#an-mot',el).value.trim();if(!m)return toast('Escribí el motivo','bad');
      const by={};paymentsOfReceipt(recibo).forEach(p=>{(by[p._doc]=by[p._doc]||{})[p.id]={anulado:true,anuladoMotivo:m,anuladoFecha:todayStr()+' '+nowTime(),anuladoPor:S.uid||null};});
      try{for(const d of Object.keys(by))await putMany('pagos',d,by[d]);toast('Recibo anulado');closeModal();}catch(err){dbError(err);}
    });}});
}
function openCobro(clientId){
  const c=S.clientes.get(clientId);if(!c)return toast('No se encontró el cliente','bad');
  if(!can('cobrar'))return toast('Tu perfil no puede registrar cobros','bad');
  const b=billing(c,true),cur=todayStr().slice(0,7),cl=cutLine(c);
  const open=b.periods.filter(p=>p.rest>0);
  const html=`<div><div style="font-weight:700;font-size:17px;overflow-wrap:anywhere">${esc(c.nombre)}${c.codigo?` <span class="muted mono small">#${esc(c.codigo)}</span>`:''}</div>
    <div class="small muted">${esc(servicioTxt(c))} · ${fmtMoney(b.price)} por mes · Ciclo ${cicloOf(c)} ${billChip(c)}</div></div>
    ${cl?`<div class="notice ${cl.cls}">${esc(cl.txt)}</div>`:''}
    <div class="seg" id="cb-con">${Object.entries(CONCEPTOS).map(([k,v])=>`<button type="button" data-con="${k}" aria-pressed="${k==='mensualidad'}">${v}</button>`).join('')}</div>
    <div id="cb-mens" class="list">${open.length?open.map(p=>`<label class="per"><input type="checkbox" data-per="${p.per}" data-rest="${p.rest}"${p.per<=cur?' checked':''}><span class="grow"><b>${esc(monthLabel(p.per))}</b><br><span class="small muted">plazo hasta el ${esc(dm(p.due))} · corte ${esc(dm(p.cut))}${p.paid?' · ya pagó '+fmtMoney(p.paid):''}</span></span>${p.venc&&p.per<=cur?'<span class="chip bad">Vencido</span>':(p.per>cur?'<span class="chip">Adelantado</span>':'<span class="chip info">A vencer</span>')}<b class="tnum">${fmtMoney(p.rest)}</b></label>`).join(''):'<div class="notice info">No hay meses pendientes.</div>'}</div>
    <div id="cb-otro" hidden>${F('Detalle','cb-nota-o','<input id="cb-nota-o" autocomplete="off">')}</div>
    <div class="grid2">${F('Medio de pago','cb-met',`<select id="cb-met">${Object.entries(METODOS).map(([k,v])=>opt(k,v,k==='efectivo')).join('')}</select>`)}${F('Fecha del cobro','cb-fecha',`<input id="cb-fecha" type="date" value="${todayStr()}">`)}</div>
    ${F('Monto recibido','cb-monto','<input id="cb-monto" type="text" inputmode="decimal" autocomplete="off">')}
    <div class="hint" id="cb-sum"></div>
    <div class="actions"><button class="btn ghost" type="button" data-close>Cancelar</button><button class="btn primary" type="button" id="cb-go">Registrar cobro</button></div>`;
  openModal({title:'Cobrar',html,onMount(el){
    let con='mensualidad',manual=false;
    const sel=()=>$$('[data-per]',el).filter(i=>i.checked).map(i=>({per:i.dataset.per,rest:Number(i.dataset.rest)})).sort((a,b)=>a.per.localeCompare(b.per));
    const total=()=>sel().reduce((s,p)=>s+p.rest,0);
    const sum=()=>{
      const m=$('#cb-monto',el),h=$('#cb-sum',el);
      if(con==='mensualidad'){
        if(!manual)m.value=total()||'';
        const r=num(m.value)||0,t=total();
        h.className='hint'+(r<t?' bad':'');
        h.textContent=!sel().length?'Marcá los meses que paga.':r===t?`Cubre ${sel().length} ${sel().length===1?'mes':'meses'}.`:r<t?`Pago parcial: faltan ${fmtMoney(t-r)}. Se aplica a los meses más viejos primero.`:`Sobran ${fmtMoney(r-t)}: quedan como saldo a favor en el último mes marcado.`;
      }else h.textContent='';
    };
    $('#cb-con',el).addEventListener('click',e=>{const x=e.target.closest('[data-con]');if(!x)return;con=x.dataset.con;manual=false;
      $$('#cb-con button',el).forEach(b=>b.setAttribute('aria-pressed',String(b===x)));
      $('#cb-mens',el).hidden=con!=='mensualidad';$('#cb-otro',el).hidden=con==='mensualidad';
      $('#cb-monto',el).value=con==='mensualidad'?'':'';sum();});
    $('#cb-mens',el).addEventListener('change',()=>{manual=false;sum();});
    $('#cb-monto',el).addEventListener('input',()=>{manual=true;sum();});
    sum();
    $('#cb-go',el).addEventListener('click',async()=>{
      const monto=num($('#cb-monto',el).value);if(!monto||monto<=0)return toast('Ingresá el monto recibido','bad');
      const fecha=$('#cb-fecha',el).value||todayStr(),metodo=$('#cb-met',el).value,recibo=newRecibo(fecha),hora=nowTime();
      const base={c:c.id,metodo,fecha,hora,recibo,por:S.uid||null};
      const items={};
      if(con==='mensualidad'){
        const s=sel();if(!s.length)return toast('Marcá al menos un mes','bad');
        allocate(s,monto).forEach(a=>{items[newId()+a.per.slice(5)]=Object.assign({concepto:'mensualidad',per:a.per,monto:a.monto},base);});
      }else items[newId()]=Object.assign({concepto:con,per:null,monto,nota:$('#cb-nota-o',el).value.trim()},base);
      const go=$('#cb-go',el);go.disabled=true;
      try{await putMany('pagos',payShard(fecha,c.id),items);toast('Cobro registrado');
        const ids=Object.keys(items);
        // El recibo se muestra con los datos recién escritos aunque la suscripción tarde en llegar.
        ids.forEach(k=>{S.pagos.set(k,Object.assign({},items[k],{id:k,_doc:payShard(fecha,c.id)}));});rebuildDerived();dataChanged('pagos');
        openReceipt(recibo);
        const c2=S.clientes.get(c.id);if(c2&&aReconectar(c2))toast('Pagó: figura en «A cortar», sección Para reconectar');
      }catch(err){dbError(err);go.disabled=false;}
    });
  }});
}
function paymentRow(p){
  const c=S.clientes.get(p.c);
  return `<button class="item" type="button" data-receipt="${esc(p.recibo)}"><div><div class="t">${esc(c?c.nombre:'(cliente eliminado)')}</div><div class="s">${esc(p.hora||'')} · ${esc(p.concepto==='mensualidad'&&p.per?monthLabel(p.per):CONCEPTOS[p.concepto]||'')} · ${esc(METODOS[p.metodo]||p.metodo)} · <span class="mono">${esc(p.recibo)}</span></div></div>
    <div class="side"><b class="tnum"${p.anulado?' style="text-decoration:line-through"':''}>${fmtMoney(p.monto)}</b>${p.anulado?'<span class="chip bad">Anulado</span>':''}</div></button>`;
}
function morosoMsg(c,b){
  const meses=b.periods.filter(p=>p.rest>0&&p.venc&&p.per<=todayStr().slice(0,7)).map(p=>monthLabel(p.per));
  return `Hola ${c.nombre.split(' ')[0]}, te escribimos de ${S.ajustes.empresa}. Tenés pendiente el pago del servicio: ${meses.join(', ')} (total ${fmtMoney(b.deuda)}). Si ya abonaste, avisanos y lo revisamos. ¡Gracias!`;
}

/* ===== promesas de pago ===== */
const actorName=()=>S.preview&&S.perfil?S.perfil.nombre:(S.me&&S.me.nombre)||ROLE_NAME[S.realRole]||'';
const diasHasta=h=>{const [y,m,d]=h.split('-').map(Number),[y2,m2,d2]=todayStr().split('-').map(Number);return Math.round((new Date(y,m-1,d)-new Date(y2,m2-1,d2))/864e5);};
function openPromesa(id){
  const c=S.clientes.get(id);if(!c)return toast('No se encontró el cliente','bad');
  if(!can('promesas'))return toast('Tu perfil no puede dar promesas de pago','bad');
  const b=billing(c),today=todayStr(),cur=today.slice(0,7);
  const owed=b.periods.filter(p=>p.per<=cur&&p.rest>0);
  if(!b.aplica||!owed.length)return toast('Este cliente no tiene deuda para prometer','bad');
  const max=isAdmin()?60:(Number(S.ajustes.promesaMax)||10),pr=promesaActual(c),vig=cutState(c).k==='promesa';
  const quick=[2,3,5,7,10].filter(n=>n<=max),def=Math.min(5,max);
  const total=owed.reduce((t,p)=>t+p.rest,0);
  openModal({title:'Promesa de pago',html:`<div id="pm-main"><div style="font-weight:700;font-size:17px;overflow-wrap:anywhere">${esc(c.nombre)}</div>
    <div class="small muted">Debe ${owed.map(p=>esc(monthLabel(p.per))).join(', ')} · ${fmtMoney(total)}</div>
    ${vig?`<div class="notice" style="margin-top:8px">Ya tiene una promesa hasta el ${esc(dmy(pr.h))}. La nueva la reemplaza.</div>`:''}
    <div class="form" style="margin-top:12px"><div class="field"><label for="pm-dias">¿Cuántos días le das para pagar?</label>
      <div class="seg" id="pm-quick">${quick.map(n=>`<button type="button" data-d="${n}" aria-pressed="${n===def}">${n} días</button>`).join('')}</div>
      <input id="pm-dias" type="number" min="1" max="${max}" step="1" inputmode="numeric" value="${def}" style="margin-top:8px">
      <div class="hint" id="pm-hint"></div></div>
      ${F('Nota (opcional)','pm-nota','<input id="pm-nota" autocomplete="off" placeholder="Cobra el viernes, pidió hablar con…">')}
      ${c.estado==='suspendido'?'<label class="per"><input id="pm-recon" type="checkbox" checked><span class="grow"><b>Reconectar ahora</b><br><span class="small muted">Está suspendido: queda activo mientras dure la promesa.</span></span></label>':''}
      <div class="actions"><button class="btn ghost" type="button" data-close>Cancelar</button><button class="btn primary" type="button" id="pm-go">Registrar promesa</button></div></div></div>`,
    onMount(el){
      const inp=$('#pm-dias',el),hint=$('#pm-hint',el);
      const val=()=>Math.floor(Number(inp.value)||0);
      const draw=()=>{
        const d=val(),ok=d>=1&&d<=max;
        $$('#pm-quick button',el).forEach(b2=>b2.setAttribute('aria-pressed',String(Number(b2.dataset.d)===d)));
        hint.className='hint'+(ok?'':' bad');
        hint.textContent=ok?`Tiene tiempo hasta el ${dateLabel(dateAdd(today,d))}. Si no paga, se suspende el ${dateLabel(dateAdd(today,d+1))}.`:`Poné entre 1 y ${max} días.`;
      };
      inp.addEventListener('input',draw);
      $('#pm-quick',el).addEventListener('click',e=>{const x=e.target.closest('[data-d]');if(!x)return;inp.value=x.dataset.d;draw();});
      draw();
      $('#pm-go',el).addEventListener('click',async()=>{
        const d=val();if(d<1||d>max)return toast(`Poné entre 1 y ${max} días`,'bad');
        const cc=S.clientes.get(id)||c,h=dateAdd(today,d),nota=$('#pm-nota',el).value.trim();
        const entry={f:today,h,d,por:actorName()};if(nota)entry.n=nota;
        const patch={promesas:[...(Array.isArray(cc.promesas)?cc.promesas:[]).slice(-7),entry]};
        const rc=$('#pm-recon',el);if(rc&&rc.checked)Object.assign(patch,{estado:'activo',corteMora:null,reconectado:today});
        const go=$('#pm-go',el);go.disabled=true;
        try{
          await saveClient(cc,patch);toast('Promesa registrada');
          const msg=`Hola ${(c.nombre||'').split(' ')[0]}, te confirmamos tu promesa de pago: tenés tiempo hasta el ${dmy(h)} para abonar. Pasada esa fecha el servicio se suspende automáticamente. ¡Gracias! - ${S.ajustes.empresa}`;
          $('#pm-main',el).innerHTML=`<div class="notice ok">Promesa registrada hasta el <b>${esc(dmy(h))}</b>${rc&&rc.checked?'. El cliente quedó activo.':'.'}</div>
            <div class="actions start" style="margin-top:12px">${c.tel&&can('telefono')?`<a class="btn primary" target="_blank" rel="noopener" href="${waUrl(c.tel,msg)}">Avisarle por WhatsApp</a>`:''}<button class="btn ghost" type="button" data-close>Listo</button></div>`;
        }catch(err){dbError(err);go.disabled=false;}
      });
    }});
}
async function anularPromesa(id){
  const c=S.clientes.get(id);if(!c)return;
  if(!can('promesas'))return toast('Tu perfil no puede anular promesas','bad');
  const pr=promesaActual(c);if(!pr)return;
  if(!await askConfirm(`¿Anular la promesa de ${c.nombre} (hasta el ${dmy(pr.h)})? Si sigue debiendo, queda para cortar.`,'Anular promesa',true))return;
  try{await saveClient(c,{promesas:c.promesas.map(x=>x===pr?Object.assign({},x,{x:1,xf:todayStr()}):x)});toast('Promesa anulada');closeModal();}catch(err){dbError(err);}
}

/* ===== cortes y reconexiones ===== */
function cortesData(){
  const cortar=[],reconectar=[],promesas=[];
  const vis=can('clientesTodos')?null:visibleSet();
  for(const c of S.clientes.values()){
    if(c.estado!=='activo'&&c.estado!=='suspendido')continue;
    if(vis&&!vis.has(c.id))continue;
    const s=cutState(c);
    if(c.estado==='activo'&&s.k==='cortar')cortar.push({c,s});
    else if(aReconectar(c))reconectar.push({c,s});
    if(s.k==='promesa')promesas.push({c,s});
  }
  const byName=(a,b)=>norm(a.c.nombre).localeCompare(norm(b.c.nombre));
  cortar.sort((a,b)=>a.s.desde.localeCompare(b.s.desde)||byName(a,b));
  reconectar.sort(byName);
  promesas.sort((a,b)=>a.s.hasta.localeCompare(b.s.hasta)||byName(a,b));
  return {cortar,reconectar,promesas};
}
async function setSuspension(clients,on){
  if(!can('editarClientes'))return toast('Tu perfil no puede cambiar el estado de los clientes','bad');
  const by={},now=Date.now(),today=todayStr();
  clients.forEach(c=>{
    const o=Object.assign(stripInternal(c),on?{estado:'suspendido',corteMora:today}:{estado:'activo',corteMora:null,reconectado:today},{mod:now});
    (by[clientShard(c.id)]=by[clientShard(c.id)]||{})[c.id]=o;
  });
  try{for(const sh of Object.keys(by))await putMany('clientes',sh,by[sh]);toast(on?`${clients.length} marcados como suspendidos`:`${clients.length} reconectados`);}
  catch(err){dbError(err);}
}
/* script de MikroTik para clientes con usuario PPPoE cargado */
function mikrotikScript(list,enable){
  const withU=list.filter(c=>c.usuario&&String(c.usuario).trim());
  const q=u=>String(u).trim().replace(/["\\$\r\n]/g,'');
  const lines=[`# ${enable?'Reconexiones':'Cortes'} ${S.ajustes.empresa} - ${dmy(todayStr())} - revisalo antes de pegarlo`];
  withU.forEach(c=>lines.push(`/ppp secret ${enable?'enable':'disable'} [find name="${q(c.usuario)}"]`));
  if(!enable)withU.forEach(c=>lines.push(`/ppp active remove [find name="${q(c.usuario)}"]`));
  return {text:lines.join('\n'),n:withU.length,sin:list.length-withU.length};
}
function copyScript(list,enable){
  const r=mikrotikScript(list,enable);
  if(!r.n)return toast('Ninguno tiene usuario cargado','bad');
  copyText(r.text,'Script');
  if(r.sin)setTimeout(()=>toast(`${r.sin} sin usuario quedaron afuera`,'bad'),900);
}
function copyUsers(list){
  const u=list.map(c=>String(c.usuario||'').trim()).filter(Boolean);
  if(!u.length)return toast('Ninguno tiene usuario cargado','bad');
  copyText(u.join('\n'),'Usuarios');
}
async function bulkCortes(kind){
  const cd=cortesData();
  const cs=(kind==='susp'||kind==='script-off'||kind==='users-off')?cd.cortar.map(x=>x.c):cd.reconectar.map(x=>x.c);
  if(!cs.length)return;
  if(kind==='script-off')return copyScript(cs,false);
  if(kind==='script-on')return copyScript(cs,true);
  if(kind==='users-off'||kind==='users-on')return copyUsers(cs);
  const on=kind==='susp';
  if(!await askConfirm(on?`¿Marcar ${cs.length} clientes como suspendidos? Solo cambia el estado en la app: el corte en el router lo hacés vos.`:`¿Marcar ${cs.length} clientes como reconectados? Solo cambia el estado en la app.`,on?'Marcar suspendidos':'Marcar reconectados',on))return;
  await setSuspension(cs,on);
}
function cutRow(c,s,kind){
  const tel=c.tel&&can('telefono');
  const sub=(c.usuario?`<span class="mono">${esc(c.usuario)}</span>`:'<span class="chip warn">Sin usuario</span>')+(c.dir?' · '+esc(c.dir):'');
  let side='',btns='';
  if(kind==='cortar'){
    side=`<b class="tnum">${fmtMoney(s.b.deuda)}</b><span class="chip bad">${esc(s.motivo)}</span>`;
    btns=(can('editarClientes')?`<button class="btn small primary" type="button" data-susp="${esc(c.id)}">Marcar suspendido</button>`:'')+(can('cobrar')?`<button class="btn small" type="button" data-cobrar="${esc(c.id)}">Cobrar</button>`:'')+(can('promesas')?`<button class="btn small" type="button" data-prom="${esc(c.id)}">Promesa</button>`:'');
  }else if(kind==='reconectar'){
    side=s.k==='promesa'?`<span class="chip warn">Promesa hasta ${dm(s.hasta)}</span>`:'<span class="chip ok">Ya no debe</span>';
    btns=(can('editarClientes')?`<button class="btn small primary" type="button" data-recon="${esc(c.id)}">Marcar reconectado</button>`:'');
  }else{
    const d=diasHasta(s.hasta);
    side=`<span class="chip warn">Hasta el ${dm(s.hasta)}</span><span class="small muted">${d===0?'vence hoy':d===1?'queda 1 día':'quedan '+d+' días'}</span>`;
    btns=(can('cobrar')?`<button class="btn small" type="button" data-cobrar="${esc(c.id)}">Cobrar</button>`:'');
  }
  return `<div class="item" style="cursor:default"><div><div class="t">${esc(c.nombre)}${c.codigo?` <span class="muted mono small">#${esc(c.codigo)}</span>`:''}</div><div class="s">${sub}</div></div><div class="side">${side}</div>
    <div class="tags">${btns}${kind!=='reconectar'&&tel?`<a class="btn small" target="_blank" rel="noopener" href="${waUrl(c.tel,morosoMsg(c,s.b))}">WhatsApp</a>`:''}<button class="btn small ghost" type="button" data-open-client="${esc(c.id)}">Ficha</button></div></div>`;
}
function calendarHTML(){
  return [1,2].map(cy=>{const p=proximoCorte(cy);
    return `<div class="per"><span class="grow"><b>Ciclo ${cy}</b><br><span class="small muted">${esc(cicloTxt(cy))}</span></span><span class="small" style="text-align:right">Próximo corte<br><b>${esc(dateLabel(p.fecha))}</b>${p.nota?`<br><span class="muted">el ${dm(p.nota.raw)} es ${esc(p.nota.why)}</span>`:''}</span></div>`;}).join('');
}
function drawCortes(body){
  const cd=cortesData(),cap=100;
  const sect=(title,rows,kind,tools,empty)=>`<div class="card"><div class="head-row"><h3>${title} (${rows.length})</h3></div>${rows.length?`${tools?`<div class="actions start">${tools}</div>`:''}<div class="list">${rows.slice(0,cap).map(x=>cutRow(x.c,x.s,kind)).join('')}</div>${rows.length>cap?`<div class="hint">Se muestran los primeros ${cap} de ${rows.length}.</div>`:''}`:`<div class="hint">${empty}</div>`}</div>`;
  const toolsCut=(can('editarClientes')?`<button class="btn small primary" type="button" data-bulk="susp">Marcar suspendidos (${cd.cortar.length})</button>`:'')+`<button class="btn small" type="button" data-bulk="script-off">Copiar script MikroTik</button><button class="btn small" type="button" data-bulk="users-off">Copiar usuarios</button>`;
  const toolsRec=(can('editarClientes')?`<button class="btn small primary" type="button" data-bulk="recon">Marcar reconectados (${cd.reconectar.length})</button>`:'')+`<button class="btn small" type="button" data-bulk="script-on">Copiar script MikroTik</button>`;
  body.innerHTML=`<div class="card"><h3>Calendario de cortes</h3><div class="list">${calendarHTML()}</div><div class="hint">Si el día de corte cae sábado, domingo o feriado, pasa al siguiente día hábil. La promesa vencida se suspende al día siguiente, sin esperar.</div></div>
    ${sect('Para cortar',cd.cortar,'cortar',toolsCut,'Nadie para cortar por ahora.')}
    ${sect('Para reconectar',cd.reconectar,'reconectar',toolsRec,'Nadie para reconectar.')}
    ${sect('Promesas vigentes',cd.promesas,'promesa','','No hay promesas de pago vigentes.')}
    <div class="notice info">La app te dice a quién cortar y a quién reconectar, pero no toca el router. El script sirve para clientes PPPoE con el usuario cargado; revisalo antes de pegarlo en MikroTik.</div>`;
}

VIEWS.cobranzas={
  mount(el){
    if(!CB.fecha)CB.fecha=todayStr();
    const subs=[['cobrar','Cobrar'],['caja','Caja del día'],['morosos','Morosos'],['cortes','A cortar']].filter(([k])=>k==='cobrar'?can('cobrar'):can('caja'));
    if(!subs.some(s=>s[0]===CB.sub))CB.sub=subs.length?subs[0][0]:'cobrar';
    el.innerHTML=`<div class="seg" id="cb-sub">${subs.map(([k,l])=>`<button type="button" data-s="${k}" aria-pressed="${CB.sub===k}">${l}</button>`).join('')}</div><div id="cb-body" class="wrap" style="padding:0"></div>`;
    $('#cb-sub',el).addEventListener('click',e=>{const b=e.target.closest('[data-s]');if(!b)return;CB.sub=b.dataset.s;$$('#cb-sub button',el).forEach(x=>x.setAttribute('aria-pressed',String(x===b)));this.draw(true);});
    $('#cb-body',el).addEventListener('click',e=>{
      const r=e.target.closest('[data-receipt]');if(r)return openReceipt(r.dataset.receipt);
      const k=e.target.closest('[data-cobrar]');if(k)return openCobro(k.dataset.cobrar);
      const o=e.target.closest('[data-open-client]');if(o)return openClient(o.dataset.openClient);
      const sb=e.target.closest('[data-susp]');if(sb)return setSuspension([S.clientes.get(sb.dataset.susp)].filter(Boolean),true);
      const rb=e.target.closest('[data-recon]');if(rb)return setSuspension([S.clientes.get(rb.dataset.recon)].filter(Boolean),false);
      const pb=e.target.closest('[data-prom]');if(pb)return openPromesa(pb.dataset.prom);
      const bk=e.target.closest('[data-bulk]');if(bk)return bulkCortes(bk.dataset.bulk);
    });
    this.draw(true);
  },
  update(){this.draw(false);},
  draw(full){
    const body=$('#cb-body');if(!body)return;
    if(S.errors.pagos&&(can('cobrar')||can('caja'))){body.innerHTML='<div class="notice bad">No tenés permiso para ver los pagos. Pedile al dueño permiso de edición sobre este archivo.</div>';return;}
    if(CB.sub==='cobrar'){
      if(full||!$('#cb-pick')){
        body.innerHTML=`<div class="card"><h2>¿A quién le cobrás?</h2><div id="cb-pick"></div></div><div class="card"><div class="head-row"><h3>Cobrado hoy</h3><b id="cb-hoy" class="tnum"></b></div><div class="list" id="cb-hoylist"></div></div>`;
        const pk=mountClientPicker($('#cb-pick',body),{filter:c=>c.estado==='activo'||c.estado==='suspendido',onPick:c=>openCobro(c.id)});pk.focus();
      }
      const ps=paymentsOn(todayStr()),tot=ps.filter(p=>!p.anulado).reduce((s,p)=>s+(Number(p.monto)||0),0);
      $('#cb-hoy',body).textContent=fmtMoney(tot);
      const seen=new Set(),rows=ps.filter(p=>seen.has(p.recibo)?false:(seen.add(p.recibo),true));
      $('#cb-hoylist',body).innerHTML=rows.length?rows.slice(0,6).map(paymentRow).join(''):'<div class="hint">Todavía no hay cobros hoy.</div>';
    }else if(CB.sub==='caja'){
      if(full||!$('#cb-fecha-caja')){
        body.innerHTML=`<div class="card"><div class="head-row"><h2>Caja</h2><input id="cb-fecha-caja" type="date" style="width:auto" value="${esc(CB.fecha)}" aria-label="Fecha de la caja"></div><div id="cb-caja"></div></div>`;
        $('#cb-fecha-caja',body).addEventListener('change',e=>{CB.fecha=e.target.value||todayStr();this.draw(false);});
      }
      const ps=paymentsOn(CB.fecha),ok=ps.filter(p=>!p.anulado),tot=ok.reduce((s,p)=>s+(Number(p.monto)||0),0);
      const byM={};ok.forEach(p=>{byM[p.metodo]=(byM[p.metodo]||0)+(Number(p.monto)||0);});
      const recs=new Set(ok.map(p=>p.recibo)).size;
      $('#cb-caja',body).innerHTML=`<div class="kpis"><div class="kpi"><span class="n">${fmtMoney(tot)}</span><span class="l">Total cobrado · ${recs} ${recs===1?'recibo':'recibos'}</span></div>
        ${Object.entries(METODOS).filter(([k])=>byM[k]).map(([k,v])=>`<div class="kpi"><span class="n">${fmtMoney(byM[k])}</span><span class="l">${v}</span></div>`).join('')}</div>
        <div class="list" style="margin-top:12px">${ps.length?ps.map(paymentRow).join(''):'<div class="empty"><b>Sin movimientos</b><span>No hay cobros registrados en esta fecha.</span></div>'}</div>`;
    }else if(CB.sub==='cortes'){
      drawCortes(body);
    }else{
      if(full||!$('#cb-mq')){
        body.innerHTML=`<div class="toolbar"><div class="line"><input id="cb-mq" class="search" type="search" placeholder="Buscar moroso por nombre, teléfono o domicilio" value="${esc(CB.mq)}"></div>
          <div class="seg" id="cb-min">${[[1,'1 mes o más'],[2,'2 meses o más'],[3,'3 meses o más']].map(([k,l])=>`<button type="button" data-m="${k}" aria-pressed="${CB.min===k}">${l}</button>`).join('')}</div></div><div id="cb-mtot" class="hint"></div><div class="list" id="cb-mlist"></div>`;
        $('#cb-mq',body).addEventListener('input',e=>{CB.mq=e.target.value;this.draw(false);});
        $('#cb-min',body).addEventListener('click',e=>{const x=e.target.closest('[data-m]');if(!x)return;CB.min=Number(x.dataset.m);$$('#cb-min button',body).forEach(y=>y.setAttribute('aria-pressed',String(y===x)));this.draw(false);});
      }
      const rows=searchClients(CB.mq,c=>billing(c).vencidos>=CB.min).sort((a,b)=>billing(b).vencidos-billing(a).vencidos||billing(b).deuda-billing(a).deuda);
      const tot=rows.reduce((s,c)=>s+billing(c).deuda,0);
      $('#cb-mtot',body).textContent=`${rows.length} ${rows.length===1?'cliente':'clientes'} · ${fmtMoney(tot)} vencido`;
      $('#cb-mlist',body).innerHTML=rows.length?rows.slice(0,80).map(c=>{const b=billing(c);return `<div class="item" style="cursor:default"><div><div class="t">${esc(c.nombre)}${c.codigo?` <span class="muted mono small">#${esc(c.codigo)}</span>`:''}</div><div class="s">${can('telefono')?esc(c.tel||'Sin teléfono')+' · ':''}${esc(c.dir||'')}</div></div>
        <div class="side"><b class="tnum">${fmtMoney(b.deuda)}</b><span class="chip bad">${b.vencidos} ${b.vencidos===1?'mes':'meses'}</span></div>
        <div class="tags">${can('cobrar')?`<button class="btn small primary" type="button" data-cobrar="${esc(c.id)}">Cobrar</button>`:''}${c.tel&&can('telefono')?`<a class="btn small" target="_blank" rel="noopener" href="${waUrl(c.tel,morosoMsg(c,b))}">Recordar por WhatsApp</a>`:''}<button class="btn small ghost" type="button" data-open-client="${esc(c.id)}">Ficha</button>${c.estado==='suspendido'?'<span class="chip bad">Suspendido</span>':''}</div></div>`;}).join('')+(rows.length>80?`<div class="hint">Se muestran los primeros 80 de ${rows.length}. Usá el buscador para ver otros.</div>`:''):'<div class="empty"><b>Nadie con deuda vencida</b><span>Los clientes activos están al día con los meses que vencieron.</span></div>';
    }
  }
};
