/* ===== cobranzas ===== */
const CB={sub:'cobrar',fecha:'',mq:'',dq:'',min:1};
const newRecibo=f=>'R'+f.replace(/-/g,'').slice(2)+'-'+Math.random().toString(36).slice(2,5).toUpperCase();
const paymentsOfReceipt=r=>[...S.pagos.values()].filter(p=>p.recibo===r);
const paymentsOn=d=>[...S.pagos.values()].filter(p=>p.fecha===d).sort((a,b)=>(b.hora||'').localeCompare(a.hora||''));
function allocate(sel,received){
  let left=received;const out=[];
  for(const p of sel){if(left<=0)break;const a=Math.min(p.rest,left);out.push({per:p.per,monto:a});left-=a;}
  if(left>0&&out.length)out[out.length-1].monto+=left;
  return out;
}
/* Datos del recibo (formato del recibo en papel): quién emite, a quién, qué se cobra y el período */
function receiptData(recibo){
  const ps=paymentsOfReceipt(recibo).sort((a,b)=>(a.per||'').localeCompare(b.per||''));if(!ps.length)return null;
  const p0=ps[0],c=S.clientes.get(p0.c),R=S.ajustes.recibo||{};
  const total=ps.reduce((s,p)=>s+(Number(p.monto)||0),0);
  const cond=p=>p.metodo==='efectivo'?'Contado':(METODOS[p.metodo]||p.metodo||'');
  const mens=ps.filter(p=>p.concepto==='mensualidad'&&p.per);
  let periodo=null;
  if(mens.length){
    const a=mens[0].per,z=mens[mens.length-1].per;
    periodo={desde:a+'-01',hasta:z+'-'+pad(daysIn(z)),vto:z+'-'+pad(Math.min(cicloCfg(cicloOf(c)).hasta,daysIn(z)))};
  }
  return {
    nro:recibo,anulado:!!p0.anulado,fecha:p0.fecha,hora:p0.hora||'',total,cond:cond(p0),periodo,
    emisor:{leyenda:String(R.leyenda||'').trim(),razon:String(R.razon||'').trim()||S.ajustes.empresa||'',cuit:String(R.cuit||'').trim(),iibb:String(R.iibb||'').trim(),dom:String(R.dom||'').trim(),
      tel:String(R.tel||'').trim(),web:String(R.web||'').trim(),pv:String(R.pv||'').trim(),alias:Array.isArray(R.alias)?R.alias.map(x=>String(x).trim()).filter(Boolean):[]},
    cliente:{nombre:c?c.nombre:'—',codigo:c&&c.codigo||'',dni:c&&c.dni||'',dir:c?[c.dir,c.loc].filter(Boolean).join(', '):'',iva:'Consumidor Final',servicio:c&&mens.length&&servicioTxt(c)!=='Sin plan'?servicioTxt(c):''},
    lineas:ps.map(p=>({
      desc:p.concepto==='mensualidad'?'Abono Mensual Servicio de Internet'+(p.per?' ('+monthLabel(p.per).toLowerCase()+')':''):(CONCEPTOS[p.concepto]||'Otro')+(p.nota?': '+p.nota:''),
      cant:1,cond:cond(p),unit:Number(p.monto)||0})),
    medio:METODOS[p0.metodo]||p0.metodo||''
  };
}
function receiptText(recibo){
  const d=receiptData(recibo);if(!d)return '';
  const e=d.emisor,c=d.cliente,L=[];
  if(e.leyenda)L.push(e.leyenda);
  L.push(e.razon);
  const ident=[e.cuit&&'CUIT: '+e.cuit,e.iibb&&'Ingresos Brutos: '+e.iibb].filter(Boolean).join(' / ');if(ident)L.push(ident);
  if(e.dom)L.push(e.dom);
  const cont=[e.tel,e.web&&'Web: '+e.web].filter(Boolean).join(' / ');if(cont)L.push(cont);
  L.push('','RECIBO - NO VÁLIDO COMO FACTURA (ORIGINAL)',(e.pv?'Punto de venta: '+e.pv+'   ':'')+'Comp. Nro: '+d.nro,'Fecha de emisión: '+dmy(d.fecha)+(d.hora?' '+d.hora:''),'');
  L.push('Cliente: '+c.nombre+(c.codigo?' (#'+c.codigo+')':''));
  if(c.dni)L.push('DNI / CUIT: '+c.dni);
  if(c.dir)L.push('Dirección: '+c.dir);
  L.push('Condición de venta: '+d.cond,'Condición frente al IVA: '+c.iva);
  if(d.periodo)L.push('Período facturado: '+dmy(d.periodo.desde)+' al '+dmy(d.periodo.hasta)+' · Vto. para el pago: '+dmy(d.periodo.vto));
  L.push('');
  d.lineas.forEach(l=>L.push(l.desc+(l.cant>1?'  x'+l.cant:'')+'  '+fmtMoney(l.unit*l.cant)));
  L.push('','IMPORTE TOTAL: '+fmtMoney(d.total));
  if(c.servicio)L.push('Servicio: '+c.servicio);
  if(e.alias.length)L.push('',...e.alias.map(a=>'Alias: '+a));
  if(d.anulado)L.push('','*** RECIBO ANULADO ***');
  return L.join('\n');
}
/* el recibo como en el papel: encabezado, datos del cliente, tabla y total */
const RC_CSS='.rc{background:#fff;color:#111;border:1px solid #222;font:13px/1.45 system-ui,sans-serif;max-width:640px;margin:0 auto;position:relative}.rc *{box-sizing:border-box}.rc .h{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;padding:10px 12px;border-bottom:1px solid #222}.rc .h b{font-size:15px}.rc .tt{text-align:center;font-weight:700;letter-spacing:.04em}.rc .nv{font-size:11px;text-align:right}.rc .b{padding:8px 12px;border-bottom:1px solid #222;overflow-wrap:anywhere}.rc .b div{margin:1px 0}.rc table{width:100%;table-layout:fixed;border-collapse:collapse}.rc .w1{width:12%}.rc .w2{width:20%}.rc .w3{width:19%}.rc th,.rc td{padding:5px 8px;border-bottom:1px solid #ccc;text-align:left;vertical-align:top}.rc th{background:#eee;font-size:11px;text-transform:uppercase}.rc .r{text-align:right;white-space:nowrap}.rc .tot{display:flex;justify-content:flex-end;gap:14px;padding:8px 12px;font-size:15px;font-weight:700;border-bottom:1px solid #222}.rc .al{padding:8px 12px;font-size:12px}.rc .an{position:absolute;inset:40% 0 auto;text-align:center;font-size:34px;font-weight:800;color:#c00;transform:rotate(-12deg);opacity:.55;pointer-events:none}@media (max-width:520px){.rc{font-size:12.5px}.rc .h{display:block}.rc .tt,.rc .nv{text-align:left;margin-top:4px}.rc .cp{display:none}.rc .w1{width:13%}.rc .w2,.rc .w3{width:27%}.rc th,.rc td{padding:5px 5px}}';
function receiptHTML(d){
  const e=d.emisor,c=d.cliente;
  return `<style>${RC_CSS}</style><div class="rc">
    <div class="h"><div><b>${esc(e.leyenda||e.razon)}</b>${e.leyenda?`<div>${esc(e.razon)}</div>`:''}</div><div class="tt">RECIBO</div><div class="nv">ORIGINAL<br>NO VÁLIDO COMO FACTURA</div></div>
    <div class="b">${[e.cuit&&'CUIT: '+e.cuit,e.iibb&&'Ingresos Brutos: '+e.iibb].filter(Boolean).length?`<div>${esc([e.cuit&&'CUIT: '+e.cuit,e.iibb&&'Ingresos Brutos: '+e.iibb].filter(Boolean).join(' / '))}</div>`:''}
      ${e.dom?`<div>${esc(e.dom)}</div>`:''}${e.tel||e.web?`<div>${esc([e.tel,e.web&&'Web: '+e.web].filter(Boolean).join(' / '))}</div>`:''}
      <div>${e.pv?'Punto de venta: <b>'+esc(e.pv)+'</b> · ':''}Comp. Nro: <b>${esc(d.nro)}</b> · Fecha de emisión: <b>${esc(dmy(d.fecha))}</b>${d.hora?' '+esc(d.hora):''}</div></div>
    <div class="b"><div>Cliente: <b>${esc(c.nombre)}</b>${c.codigo?' (#'+esc(c.codigo)+')':''}</div>${c.dni?`<div>DNI / CUIT: ${esc(c.dni)}</div>`:''}${c.dir?`<div>Dirección: ${esc(c.dir)}</div>`:''}
      <div>Condición de venta: ${esc(d.cond)} · Condición frente al IVA: ${esc(c.iva)}</div>
      ${d.periodo?`<div>Período facturado desde: ${esc(dmy(d.periodo.desde))} hasta: ${esc(dmy(d.periodo.hasta))} · Vto. para el pago: ${esc(dmy(d.periodo.vto))}</div>`:''}</div>
    <table><thead><tr><th>Producto / Servicio</th><th class="r w1">Cant.</th><th class="cp w2">Condición de pago</th><th class="r w3">Precio unit.</th><th class="r w3">Subtotal</th></tr></thead><tbody>
      ${d.lineas.map(l=>`<tr><td>${esc(l.desc)}</td><td class="r">${l.cant}</td><td class="cp">${esc(l.cond)}</td><td class="r">${esc(fmtMoney(l.unit))}</td><td class="r">${esc(fmtMoney(l.unit*l.cant))}</td></tr>`).join('')}</tbody></table>
    <div class="tot"><span>Importe total:</span><span>${esc(fmtMoney(d.total))}</span></div>
    ${c.servicio||e.alias.length?`<div class="al">${c.servicio?`<div>Servicio: ${esc(c.servicio)}</div>`:''}${e.alias.map(a=>`<div>Alias: ${esc(a)}</div>`).join('')}</div>`:''}
    ${d.anulado?'<div class="an">ANULADO</div>':''}</div>`;
}
/* imprime solo el recibo, en una hoja aparte (desde la computadora de la oficina) */
function printReceipt(d){
  try{
    const f=document.createElement('iframe');f.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0';document.body.appendChild(f);
    const w=f.contentWindow,doc=w.document;doc.open();doc.write('<!doctype html><meta charset="utf-8"><title>Recibo '+esc(d.nro)+'</title><style>@page{margin:12mm}body{margin:0}</style>'+receiptHTML(d));doc.close();
    setTimeout(()=>{try{w.focus();w.print();}catch(_){toast('Este navegador no puede imprimir. Copiá el recibo.','bad');}setTimeout(()=>f.remove(),2000);},150);
  }catch(_){toast('Este navegador no puede imprimir. Copiá el recibo.','bad');}
}
function openReceipt(recibo){
  const d=receiptData(recibo);if(!d)return toast('No se encontró el recibo','bad');
  const txt=receiptText(recibo),ps=paymentsOfReceipt(recibo),c=S.clientes.get(ps[0].c);
  openModal({title:'Recibo '+recibo,html:`${receiptHTML(d)}
    <div class="actions start" style="margin-top:12px">${d.anulado?'':c&&c.tel?`<a class="btn primary" id="rc-wa" target="_blank" rel="noopener" href="${waUrl(c.tel,txt)}">Enviar por WhatsApp</a>`:'<button class="btn primary" type="button" id="rc-wa">Enviar por WhatsApp</button>'}<button class="btn" type="button" data-copy="${esc(txt)}" data-copy-label="Recibo">Copiar recibo</button>
    <button class="btn" type="button" id="rc-print">Imprimir</button>
    ${ps[0].anulado||!can('anular')?'':`<button class="btn danger" type="button" id="rc-anular">Anular</button>`}<button class="btn ghost" type="button" data-close>Cerrar</button></div>
    <div id="rc-tel" class="card flat" hidden><p class="small muted" style="margin:0 0 8px">Este cliente no tiene teléfono cargado. Escribí su número de WhatsApp (con el código de área, sin 0 ni 15) y se abre el chat con el recibo listo para mandar.</p>
      ${F('WhatsApp del cliente','rc-num','<input id="rc-num" type="tel" inputmode="tel" autocomplete="off" placeholder="3844 56-2605">')}
      ${c&&(can('editarClientes')||can('cobrar'))?'<label class="per"><input type="checkbox" id="rc-save" checked><span class="grow">Guardar este número en la ficha del cliente</span></label>':''}
      <div class="actions"><a class="btn primary" id="rc-wa-go" target="_blank" rel="noopener" href="#">Abrir WhatsApp</a></div></div>`,
    onMount(el){
      const b=$('#rc-anular',el);if(b)b.addEventListener('click',()=>openAnular(recibo));$('#rc-print',el).addEventListener('click',()=>printReceipt(d));
      const wa=$('#rc-wa',el);
      if(wa&&wa.tagName==='BUTTON'){   /* sin teléfono cargado: se pide el número en el momento */
        const box=$('#rc-tel',el),inp=$('#rc-num',el),go=$('#rc-wa-go',el);
        const num2=()=>waNumber(inp.value),ok=()=>{const n=num2();return n.length>=12&&n.length<=14;};
        const sync=()=>{go.href=ok()?waUrl(inp.value,txt):'#';};
        wa.addEventListener('click',()=>{box.hidden=false;inp.focus();});
        inp.addEventListener('input',sync);
        go.addEventListener('click',e=>{
          if(!ok()){e.preventDefault();return toast('Escribí el número con el código de área (por ejemplo 3844 56-2605)','bad');}
          const sv=$('#rc-save',el);
          if(c&&sv&&sv.checked)saveClient(c,{tel:inp.value.trim()}).then(()=>toast('Número guardado en la ficha')).catch(dbError);
        });
      }
    }});
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
function openCobro(clientId,con1){
  const c=S.clientes.get(clientId);if(!c)return toast('No se encontró el cliente','bad');
  if(!can('cobrar')&&!can('cobrarCampo'))return toast('Tu perfil no puede registrar cobros','bad');
  const campo=soloCampo();   /* quien cobra en la calle: solo instalaciones, reclamos, reconexiones y otros */
  const b=campo?{aplica:false,periods:[],price:0}:billing(c,true),cur=todayStr().slice(0,7),cl=campo?null:cutLine(c);
  const open=b.periods.filter(p=>p.rest>0);
  const mens=b.aplica&&!campo,daRest=campo?0:deudaAntRest(c),da=c.deudaAnt&&c.deudaAnt.det?String(c.deudaAnt.det):'';
  const con0=con1==='deuda_anterior'&&daRest>0?'deuda_anterior':mens?'mensualidad':'instalacion';
  const html=`<div><div style="font-weight:700;font-size:17px;overflow-wrap:anywhere">${esc(c.nombre)}${c.codigo?` <span class="muted mono small">#${esc(c.codigo)}</span>`:''}</div>
    <div class="small muted">${esc(servicioTxt(c))}${mens?` · ${fmtMoney(b.price)} por mes · Ciclo ${cicloOf(c)} ${billChip(c)}`:` · ${esc(ESTADOS[c.estado]||c.estado)}`}</div></div>
    ${cl?`<div class="notice ${cl.cls}">${esc(cl.txt)}</div>`:''}
    <div class="seg" id="cb-con">${Object.entries(CONCEPTOS).filter(([k])=>k==='mensualidad'?mens:k==='deuda_anterior'?daRest>0:true).map(([k,v])=>`<button type="button" data-con="${k}" aria-pressed="${k===con0}">${v}</button>`).join('')}</div>
    ${campo?'<div class="hint">Queda registrado a tu nombre y suma a la caja del día.</div>':''}
    <div id="cb-mens" class="list"${con0==='mensualidad'?'':' hidden'}>${open.length?open.map(p=>`<label class="per"><input type="checkbox" data-per="${p.per}" data-rest="${p.rest}"${p.per<=cur?' checked':''}><span class="grow"><b>${esc(monthLabel(p.per))}</b><br><span class="small muted">plazo hasta el ${esc(dm(p.due))} · corte ${esc(dm(p.cut))}${p.paid?' · ya pagó '+fmtMoney(p.paid):''}</span></span>${p.venc&&p.per<=cur?'<span class="chip bad">Vencido</span>':(p.per>cur?'<span class="chip">Adelantado</span>':'<span class="chip info">A vencer</span>')}<b class="tnum">${fmtMoney(p.rest)}</b></label>`).join(''):'<div class="notice info">No hay meses pendientes.</div>'}</div>
    <div id="cb-otro"${con0==='mensualidad'?' hidden':''}>${F('Detalle','cb-nota-o','<input id="cb-nota-o" autocomplete="off">')}</div>
    <div class="grid2">${F('Medio de pago','cb-met',`<select id="cb-met">${Object.entries(METODOS).map(([k,v])=>opt(k,v,k==='efectivo')).join('')}</select>`)}${F('Fecha del cobro','cb-fecha',`<input id="cb-fecha" type="date" value="${todayStr()}"${campo?' disabled':''}>`)}</div>
    ${F('Monto recibido','cb-monto','<input id="cb-monto" type="text" inputmode="decimal" autocomplete="off">')}
    <div class="hint" id="cb-sum"></div>
    <div class="actions"><button class="btn ghost" type="button" data-close>Cancelar</button><button class="btn primary" type="button" id="cb-go">Registrar cobro</button></div>`;
  openModal({title:'Cobrar',html,onMount(el){
    let con=con0,manual=false;
    const sel=()=>$$('[data-per]',el).filter(i=>i.checked).map(i=>({per:i.dataset.per,rest:Number(i.dataset.rest)})).sort((a,b)=>a.per.localeCompare(b.per));
    const total=()=>sel().reduce((s,p)=>s+p.rest,0);
    const sum=()=>{
      const m=$('#cb-monto',el),h=$('#cb-sum',el);
      if(con==='mensualidad'){
        if(!manual)m.value=total()||'';
        const r=num(m.value)||0,t=total();
        h.className='hint'+(r<t?' bad':'');
        h.textContent=!sel().length?'Marcá los meses que paga.':r===t?`Cubre ${sel().length} ${sel().length===1?'mes':'meses'}.`:r<t?`Pago parcial: faltan ${fmtMoney(t-r)}. Se aplica a los meses más viejos primero.`:`Sobran ${fmtMoney(r-t)}: quedan como saldo a favor en el último mes marcado.`;
      }else if(con==='deuda_anterior'){
        const r=num(m.value)||0;h.className='hint'+(r>daRest?' bad':'');
        h.textContent=r>daRest?`Es más que lo que debe: faltan ${fmtMoney(daRest)}.`:r===daRest?`Cancela la deuda anterior (${fmtMoney(daRest)}).`:`Debe ${fmtMoney(daRest)} de deuda anterior${r>0?`: quedan ${fmtMoney(daRest-r)} después de este cobro`:''}.`;
      }else h.textContent='';
    };
    $('#cb-con',el).addEventListener('click',e=>{const x=e.target.closest('[data-con]');if(!x)return;con=x.dataset.con;manual=false;
      $$('#cb-con button',el).forEach(b=>b.setAttribute('aria-pressed',String(b===x)));
      $('#cb-mens',el).hidden=con!=='mensualidad';$('#cb-otro',el).hidden=con==='mensualidad';
      $('#cb-monto',el).value=con==='deuda_anterior'?daRest:'';$('#cb-nota-o',el).value=con==='deuda_anterior'?da:'';sum();});
    $('#cb-mens',el).addEventListener('change',()=>{manual=false;sum();});
    $('#cb-monto',el).addEventListener('input',()=>{manual=true;sum();});
    if(con==='deuda_anterior'){$('#cb-monto',el).value=daRest;$('#cb-nota-o',el).value=da;}
    sum();
    $('#cb-go',el).addEventListener('click',async()=>{
      const monto=num($('#cb-monto',el).value);if(!monto||monto<=0)return toast('Ingresá el monto recibido','bad');
      const fecha=campo?todayStr():($('#cb-fecha',el).value||todayStr()),metodo=$('#cb-met',el).value,recibo=newRecibo(fecha),hora=nowTime();
      const base={c:c.id,metodo,fecha,hora,recibo,por:S.uid||null,porNombre:(S.me&&S.me.nombre)||''};
      const items={};
      if(con==='deuda_anterior'&&monto>daRest+0.005)return toast('Es más que la deuda anterior: faltan '+fmtMoney(daRest),'bad');
      if(con==='mensualidad'){
        if(!mens)return toast('Este cliente todavía no paga mensualidad','bad');
        const s=sel();if(!s.length)return toast('Marcá al menos un mes','bad');
        allocate(s,monto).forEach(a=>{items[newId()+a.per.slice(5)]=Object.assign({concepto:'mensualidad',per:a.per,monto:a.monto},base);});
      }else items[newId()]=Object.assign({concepto:con,per:null,monto,nota:$('#cb-nota-o',el).value.trim()},base);
      const go=$('#cb-go',el);go.disabled=true;
      try{await putMany('pagos',payShard(fecha,c.id),items);toast('Cobro registrado');
        const ids=Object.keys(items);
        // El recibo se muestra con los datos recién escritos aunque la suscripción tarde en llegar.
        ids.forEach(k=>{S.pagos.set(k,Object.assign({},items[k],{id:k,_doc:payShard(fecha,c.id)}));});rebuildDerived();dataChanged('pagos');
        openReceipt(recibo);
        const c2=S.clientes.get(c.id);if(!campo&&c2&&aReconectar(c2))toast('Pagó: figura en «A cortar», sección Para reconectar');
      }catch(err){dbError(err);go.disabled=false;}
    });
  }});
}
/* quién registró el cobro: el servidor guarda su nombre junto al pago (los cobros viejos no lo tienen) */
function cobradorName(p){
  if(p.porNombre)return p.porNombre;
  if(p.por&&S.me&&p.por===S.me.id)return S.me.nombre;
  const u=p.por&&ACC.users.find(x=>x.id===p.por);
  return u?u.nombre:'';
}
/* cobro que no es mensualidad (instalación, reclamo, reconexión, otro): lo usan «Cobrar» y el cierre de una orden */
async function cobrarOtro(c,o){
  const fecha=o.fecha||todayStr(),recibo=newRecibo(fecha),id=newId(),doc=payShard(fecha,c.id);
  const item={c:c.id,metodo:o.metodo||'efectivo',fecha,hora:nowTime(),recibo,por:S.uid||null,porNombre:(S.me&&S.me.nombre)||'',concepto:o.concepto,per:null,monto:o.monto,nota:o.nota||''};
  await putMany('pagos',doc,{[id]:item});
  S.pagos.set(id,Object.assign({},item,{id,_doc:doc}));rebuildDerived();dataChanged('pagos');
  return recibo;
}
function paymentRow(p){
  const c=S.clientes.get(p.c);
  return `<button class="item" type="button" data-receipt="${esc(p.recibo)}"><div><div class="t">${esc(c?c.nombre:'(cliente eliminado)')}</div><div class="s">${esc(p.concepto==='mensualidad'&&p.per?monthLabel(p.per):CONCEPTOS[p.concepto]||'')} · ${esc(METODOS[p.metodo]||p.metodo)}</div><div class="s small">${esc(p.hora||'')}${cobradorName(p)?' · cobró '+esc(cobradorName(p)):''} · <span class="mono">${esc(p.recibo)}</span></div></div>
    <div class="side"><b class="tnum"${p.anulado?' style="text-decoration:line-through"':''}>${fmtMoney(p.monto)}</b>${p.anulado?'<span class="chip bad">Anulado</span>':''}</div></button>`;
}
function deudaAntMsg(c,r){
  const d=c.deudaAnt&&c.deudaAnt.det;
  return `Hola ${c.nombre.split(' ')[0]}, te escribimos de ${S.ajustes.empresa}. Tenés una deuda anterior pendiente de ${fmtMoney(r)}${d?' ('+d+')':''}. Si ya abonaste, avisanos y lo revisamos. ¡Gracias!`;
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
    return `<div class="per cal"><span class="grow"><b>Ciclo ${cy}</b><br><span class="small muted">${esc(cicloTxt(cy))}</span></span><span class="small cal-next">Próximo corte<br><b>${esc(dateLabel(p.fecha))}</b></span>${p.nota?`<span class="small muted cal-note">El ${dm(p.nota.raw)} es ${esc(p.nota.why)}: el corte pasa al día siguiente hábil.</span>`:''}</div>`;}).join('');
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

/* cierre de caja: lo que cobró cada persona (para contar el efectivo que tiene que entregar cada una) */
function cajaPorCobrador(ok){
  const by={};
  ok.forEach(p=>{const k=p.por||'';const o=by[k]||(by[k]={nom:'',rec:new Set(),efectivo:0,otros:0,total:0});if(!o.nom)o.nom=cobradorName(p);const m=Number(p.monto)||0;o.rec.add(p.recibo);o.total+=m;if(p.metodo==='efectivo')o.efectivo+=m;else o.otros+=m;});
  const rows=Object.entries(by).sort((a,b)=>b[1].total-a[1].total);
  if(!rows.length)return '';
  return `<div class="card" style="margin-top:12px"><h3>Por cobrador</h3><div class="tbl-wrap"><table><thead><tr><th>Cobró</th><th class="right">Recibos</th><th class="right">Efectivo</th><th class="right">Otros medios</th><th class="right">Total</th></tr></thead><tbody>${rows.map(([k,o])=>`<tr><td>${esc(o.nom||'Sin dato')}</td><td class="right tnum">${o.rec.size}</td><td class="right tnum">${fmtMoney(o.efectivo)}</td><td class="right tnum">${fmtMoney(o.otros)}</td><td class="right tnum"><b>${fmtMoney(o.total)}</b></td></tr>`).join('')}</tbody></table></div><div class="hint">El efectivo de cada persona es lo que tiene que entregar en el día.</div></div>`;
}

/* ===== Mis cobros (quien cobra en la calle) ===== */
const MC={err:''};
async function loadMisCobros(){
  try{
    const j=await NET.api('GET','/api/mis-cobros?dias=7');
    (j.docs||[]).forEach(d=>{const it=(d.data||{}).items||{};for(const k in it)S.pagos.set(k,Object.assign({},it[k],{id:k,_doc:d.id}));});
    MC.err='';rebuildDerived();dataChanged('pagos');
  }catch(e){MC.err=e&&e.network?'Sin conexión: se muestran los cobros que ya se cargaron.':'No se pudieron actualizar tus cobros.';dataChanged('pagos');}
}
VIEWS.miscobros={
  mount(el){
    el.innerHTML=`<div class="card"><h2>¿A quién le cobrás?</h2><div id="mc-pick"></div></div><div id="mc-body" class="wrap" style="padding:0"></div>`;
    mountClientPicker($('#mc-pick',el),{filter:c=>c.estado!=='baja',onPick:c=>openCobro(c.id),placeholder:'Buscar tu cliente por nombre, calle o N° de cliente'});
    $('#mc-body',el).addEventListener('click',e=>{const r=e.target.closest('[data-receipt]');if(r)openReceipt(r.dataset.receipt);});
    loadMisCobros();this.update();
  },
  update(){
    const body=$('#mc-body');if(!body)return;
    const mine=[...S.pagos.values()].filter(p=>p.por===S.uid).sort((a,b)=>(b.fecha+(b.hora||'')).localeCompare(a.fecha+(a.hora||'')));
    const today=todayStr(),days=[...new Set(mine.map(p=>p.fecha))].slice(0,7);
    const sum=(l,f)=>l.filter(p=>!p.anulado&&(!f||f(p))).reduce((t,p)=>t+(Number(p.monto)||0),0);
    const hoy=mine.filter(p=>p.fecha===today);
    body.innerHTML=`${MC.err?`<div class="notice">${esc(MC.err)}</div>`:''}
      <div class="kpis"><div class="kpi"><span class="n">${fmtMoney(sum(hoy))}</span><span class="l">Cobrado hoy</span></div><div class="kpi"><span class="n">${fmtMoney(sum(hoy,p=>p.metodo==='efectivo'))}</span><span class="l">Efectivo a entregar hoy</span></div></div>
      ${days.length?days.map(d=>{const l=mine.filter(p=>p.fecha===d),seen=new Set(),rows=l.filter(p=>seen.has(p.recibo)?false:(seen.add(p.recibo),true));
        return `<div class="card"><div class="head-row"><h3>${d===today?'Hoy':esc(dateLabel(d))}</h3><b class="tnum">${fmtMoney(sum(l))}</b></div><div class="list">${rows.map(paymentRow).join('')}</div></div>`;}).join(''):'<div class="empty"><b>Todavía no cobraste nada</b><span>Buscá al cliente arriba y tocá «Cobrar». También podés registrar el cobro al terminar una orden.</span></div>'}`;
  }
};

VIEWS.cobranzas={
  mount(el){
    if(!CB.fecha)CB.fecha=todayStr();
    const subs=[['cobrar','Cobrar'],['caja','Caja del día'],['morosos','Morosos'],['dant','Deuda anterior'],['cortes','A cortar']].filter(([k])=>k==='cobrar'?can('cobrar'):can('caja'));
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
      const da=e.target.closest('[data-cobrar-da]');if(da)return openCobro(da.dataset.cobrarDa,'deuda_anterior');
    });
    this.draw(true);
  },
  update(){this.draw(false);},
  draw(full){
    const body=$('#cb-body');if(!body)return;
    if(!S.loaded.pagos&&(can('cobrar')||can('caja'))){body.innerHTML='<div class="notice">Cargando los cobros del servidor… Sin conexión no se pueden ver ni cargar cobros.</div>';return;}
    if(S.errors.pagos&&(can('cobrar')||can('caja'))){body.innerHTML='<div class="notice bad">No tenés permiso para ver los pagos. Pedile al dueño permiso de edición sobre este archivo.</div>';return;}
    if(CB.sub==='cobrar'){
      if(full||!$('#cb-pick')){
        body.innerHTML=`<div class="card"><h2>¿A quién le cobrás?</h2><div id="cb-pick"></div></div><div class="card"><div class="head-row"><h3>Cobrado hoy</h3><b id="cb-hoy" class="tnum"></b></div><div class="list" id="cb-hoylist"></div></div>`;
        const pk=mountClientPicker($('#cb-pick',body),{filter:c=>c.estado!=='baja',onPick:c=>openCobro(c.id)});pk.focus();
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
        ${cajaPorCobrador(ok)}
        <div class="list" style="margin-top:12px">${ps.length?ps.map(paymentRow).join(''):'<div class="empty"><b>Sin movimientos</b><span>No hay cobros registrados en esta fecha.</span></div>'}</div>`;
    }else if(CB.sub==='cortes'){
      drawCortes(body);
    }else if(CB.sub==='dant'){
      if(full||!$('#cb-dq')){
        body.innerHTML=`<p class="muted small">Lo que cada cliente debía antes de empezar a cobrar de cero. Va aparte de las mensualidades: no genera cortes ni figura como moroso.</p>
          <div class="toolbar"><div class="line"><input id="cb-dq" class="search" type="search" placeholder="Buscar por nombre, teléfono o domicilio" value="${esc(CB.dq||'')}"></div></div><div id="cb-dtot" class="hint"></div><div class="list" id="cb-dlist"></div>`;
        $('#cb-dq',body).addEventListener('input',e=>{CB.dq=e.target.value;this.draw(false);});
      }
      const rows=searchClients(CB.dq||'',c=>deudaAntRest(c)>0).sort((a,b)=>deudaAntRest(b)-deudaAntRest(a)||norm(a.nombre).localeCompare(norm(b.nombre)));
      const all=[...S.clientes.values()].filter(c=>c.deudaAnt&&Number(c.deudaAnt.m)>0);
      const orig=all.reduce((s,c)=>s+Number(c.deudaAnt.m),0),rest=all.reduce((s,c)=>s+deudaAntRest(c),0);
      $('#cb-dtot',body).textContent=all.length?`${all.filter(c=>deudaAntRest(c)>0).length} con deuda · ${fmtMoney(rest)} por cobrar${orig>rest?` (se cobraron ${fmtMoney(orig-rest)} de ${fmtMoney(orig)})`:''}`:'Nadie tiene deuda anterior cargada. Para dejar a todos en cero usá Ajustes, «Empezar a cobrar de cero».';
      $('#cb-dlist',body).innerHTML=rows.length?rows.slice(0,80).map(c=>{const r=deudaAntRest(c);return `<div class="item" style="cursor:default"><div><div class="t">${esc(c.nombre)}${c.codigo?` <span class="muted mono small">#${esc(c.codigo)}</span>`:''}</div><div class="s">${can('telefono')?esc(c.tel||'Sin teléfono')+' · ':''}${esc(c.dir||'')}</div>${c.deudaAnt.det?`<div class="s small">${esc(c.deudaAnt.det)}</div>`:''}</div>
        <div class="side"><b class="tnum">${fmtMoney(r)}</b>${r<Number(c.deudaAnt.m)?`<span class="chip">Pagó ${fmtMoney(Number(c.deudaAnt.m)-r)}</span>`:''}</div>
        <div class="tags">${can('cobrar')?`<button class="btn small primary" type="button" data-cobrar-da="${esc(c.id)}">Cobrar</button>`:''}${c.tel&&can('telefono')?`<a class="btn small" target="_blank" rel="noopener" href="${waUrl(c.tel,deudaAntMsg(c,r))}">Recordar por WhatsApp</a>`:''}<button class="btn small ghost" type="button" data-open-client="${esc(c.id)}">Ficha</button></div></div>`;}).join('')+(rows.length>80?`<div class="hint">Se muestran los primeros 80. Usá el buscador para ver el resto.</div>`:''):'<div class="empty"><b>Sin deuda anterior</b><span>Ningún cliente tiene deuda anterior pendiente.</span></div>';
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
