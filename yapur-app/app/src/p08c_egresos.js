/* ===== Egresos de efectivo de la caja =====
   Cada vez que sale plata de la caja (retiro, gasto, devolución, saldo a favor de un cliente que se usó en efectivo…) se registra con su motivo.
   Quedan para siempre: no se editan ni se borran, si hubo un error se anulan con un motivo. Sirven para justificar el faltante del efectivo. */
const EG_CATS={retiro:'Retiro de caja del dueño',proveedor:'Pago a proveedor o gasto',devolucion:'Devolución de plata a un cliente',saldo_favor:'Saldo a favor de un cliente usado en efectivo',equipo:'Compra o entrega de equipo (router, cable…)',sueldo:'Sueldo o adelanto',otro:'Otro motivo'};
const EG={mes:'',q:''};
const egMesDe=f=>String(f||'').slice(0,7);
const egLista=mes=>[...S.egresos.values()].filter(e=>egMesDe(e.f)===mes).sort((a,b)=>(b.f||'').localeCompare(a.f||'')||(b.ts||0)-(a.ts||0));
const egSum=l=>l.filter(e=>!e.anulado).reduce((s,e)=>s+(Number(e.m)||0),0);
const egEfectivoCobrado=mes=>[...S.pagos.values()].filter(p=>!p.anulado&&p.metodo==='efectivo'&&egMesDe(p.fecha)===mes).reduce((s,p)=>s+(Number(p.monto)||0),0);
const egQuien=e=>{const u=S.ajustes.perfiles&&S.ajustes.perfiles.find(p=>p.id===e.por);return u?u.nombre:'';};
function egresosHoy(f){return egLista(egMesDe(f)).filter(e=>e.f===f);}
function egresosNuevo(){
  const hoy=todayStr();
  openModal({title:'Registrar egreso de efectivo',html:`<p class="small muted">Plata en efectivo que sale de la caja. Queda registrada con quién la cargó y no se puede borrar; si te equivocás, se anula con un motivo.</p>
    ${F('Fecha','eg-f','<input id="eg-f" type="date" value="'+hoy+'" max="'+hoy+'">')}
    ${F('Importe','eg-m','<input id="eg-m" inputmode="decimal" placeholder="0,00">')}
    ${F('Motivo','eg-cat','<select id="eg-cat">'+Object.entries(EG_CATS).map(([k,v])=>`<option value="${k}">${esc(v)}</option>`).join('')+'</select>')}
    <div id="eg-cli-box" hidden>${F('Cliente (a quién corresponde el dinero)','eg-q','<input id="eg-q" type="search" placeholder="Buscar por nombre, teléfono o domicilio" autocomplete="off">')}<select id="eg-cli" size="4" style="width:100%;margin-top:6px"></select></div>
    ${F('Detalle (para qué fue el dinero)','eg-det','<input id="eg-det" maxlength="200" placeholder="Ej.: compra de router para el cliente, retiro para pagar proveedor…">','Obligatorio: es lo que justifica la salida.')}
    <div class="actions"><button class="btn primary" type="button" id="eg-go">Registrar egreso</button><button class="btn ghost" type="button" data-close>Cancelar</button></div>`,
    onMount(el){
      const cat=$('#eg-cat',el),q=$('#eg-q',el),sel=$('#eg-cli',el);
      const pideCli=()=>['devolucion','saldo_favor','equipo'].includes(cat.value);
      const fill=()=>{const r=searchClients(q.value,null,8).slice(0,8);sel.innerHTML=r.map(c=>`<option value="${esc(c.id)}">${esc(c.nombre)}${c.codigo?' #'+esc(c.codigo):''} · ${esc(c.dir||'')}</option>`).join('');if(r.length)sel.selectedIndex=0;};
      const sync=()=>{$('#eg-cli-box',el).hidden=!pideCli();};
      cat.addEventListener('change',sync);q.addEventListener('input',fill);sync();
      $('#eg-go',el).addEventListener('click',async ev=>{
        const b=ev.currentTarget,m=Math.round(num($('#eg-m',el).value)*100)/100,det=$('#eg-det',el).value.trim(),f=$('#eg-f',el).value;
        if(!(m>0))return toast('Escribí el importe.','bad');
        if(det.length<3)return toast('Escribí para qué fue el dinero.','bad');
        if(!f||f>todayStr())return toast('La fecha no es válida.','bad');
        let c=null,cn='';
        if(pideCli()){c=sel.value||null;if(!c&&cat.value==='saldo_favor')return toast('Elegí el cliente al que corresponde el saldo a favor.','bad');const cl=c&&S.clientes.get(c);cn=cl?cl.nombre:'';}
        b.disabled=true;
        const id='e'+Date.now().toString(36)+Math.floor(Math.random()*1296).toString(36);
        const it={f,m,cat:cat.value,det};if(c){it.c=c;it.cn=cn;}
        try{await putItem('egresos','e'+f.slice(0,7).replace('-',''),id,it);toast('Egreso registrado');closeModal();}
        catch(err){b.disabled=false;toast(err.network||err.code==='unavailable'?'No se pudo conectar con el servidor':(err.message||'No se pudo registrar'),'bad');}
      });
    }});
}
function egresosAnular(e){
  openModal({title:'Anular egreso',html:`<p>${esc(fmtMoney(e.m))} · ${esc(EG_CATS[e.cat]||'')} · ${esc(dmy(e.f))}<br><span class="muted small">${esc(e.det||'')}</span></p>
    ${F('Motivo de la anulación','eg-an','<input id="eg-an" maxlength="160">','Queda guardado junto al egreso.')}
    <div class="actions"><button class="btn danger" type="button" id="eg-an-go">Anular egreso</button><button class="btn ghost" type="button" data-close>Cancelar</button></div>`,
    onMount(el){$('#eg-an-go',el).addEventListener('click',async ev=>{
      const mot=$('#eg-an',el).value.trim();if(mot.length<3)return toast('Escribí el motivo.','bad');
      ev.currentTarget.disabled=true;
      try{await putItem('egresos',e._doc,e.id,Object.assign({},stripMeta(e),{anulado:true,anuladoMotivo:mot}));toast('Egreso anulado');closeModal();}
      catch(err){ev.currentTarget.disabled=false;toast(err.message||'No se pudo anular','bad');}
    });}});
}
const stripMeta=e=>{const o=Object.assign({},e);delete o.id;delete o._doc;return o;};
function egresosInforme(mes){
  const l=egLista(mes),R=S.ajustes.recibo||{},cob=egEfectivoCobrado(mes),eg=egSum(l);
  const por={};l.filter(e=>!e.anulado).forEach(e=>{por[e.cat]=(por[e.cat]||0)+Number(e.m);});
  const mn=mes.split('-').reverse().join('/');
  return `<div style="font:13px Arial,sans-serif;color:#111"><h2 style="margin:0">${esc(R.razon||S.ajustes.empresa||'')}</h2><h3 style="margin:2px 0 10px">Egresos de efectivo de la caja · ${esc(mn)}</h3>
    <table style="border-collapse:collapse;width:100%;margin-bottom:12px"><tr><td>Efectivo cobrado en el mes</td><td style="text-align:right">${esc(fmtMoney(cob))}</td></tr><tr><td>Egresos de efectivo</td><td style="text-align:right">${esc(fmtMoney(eg))}</td></tr><tr><td><b>Efectivo que debería quedar</b></td><td style="text-align:right"><b>${esc(fmtMoney(cob-eg))}</b></td></tr></table>
    <h4>Por motivo</h4><table style="border-collapse:collapse;width:100%;margin-bottom:12px">${Object.entries(por).map(([k,v])=>`<tr><td>${esc(EG_CATS[k]||k)}</td><td style="text-align:right">${esc(fmtMoney(v))}</td></tr>`).join('')||'<tr><td>Sin egresos</td></tr>'}</table>
    <h4>Detalle</h4><table style="border-collapse:collapse;width:100%" border="1" cellpadding="4"><tr><th>Fecha</th><th>Motivo</th><th>Cliente</th><th>Detalle</th><th>Cargó</th><th>Importe</th></tr>${l.map(e=>`<tr${e.anulado?' style="text-decoration:line-through;color:#777"':''}><td>${esc(dmy(e.f))}</td><td>${esc(EG_CATS[e.cat]||'')}</td><td>${esc(e.cn||'')}</td><td>${esc(e.det||'')}${e.anulado?' (ANULADO: '+esc(e.anuladoMotivo||'')+')':''}</td><td>${esc(egQuien(e))}</td><td style="text-align:right">${esc(fmtMoney(e.m))}</td></tr>`).join('')}</table></div>`;
}
function egresosDraw(body,full){
  if(!EG.mes)EG.mes=todayStr().slice(0,7);
  if(full||!$('#eg-mes')){
    body.innerHTML=`<div class="card"><div class="head-row"><h2>Egresos de efectivo</h2><input id="eg-mes" type="month" style="width:auto" value="${esc(EG.mes)}" aria-label="Mes"></div>
      <p class="small muted">Toda salida de plata en efectivo de la caja se carga acá con su motivo. Con esto se justifica cualquier faltante.</p>
      <div class="actions start"><button class="btn primary" type="button" id="eg-nuevo">Registrar egreso</button><button class="btn" type="button" id="eg-print">Imprimir informe del mes</button></div><div id="eg-cuerpo"></div></div>`;
    $('#eg-mes',body).addEventListener('change',e=>{EG.mes=e.target.value||todayStr().slice(0,7);egresosDraw(body,false);});
    $('#eg-nuevo',body).addEventListener('click',egresosNuevo);
    $('#eg-print',body).addEventListener('click',()=>imprimirHTML(egresosInforme(EG.mes),'Egresos de caja '+EG.mes));
    body.addEventListener('click',e=>{const b=e.target.closest('[data-eg-an]');if(!b)return;const it=S.egresos.get(b.dataset.egAn);if(it)egresosAnular(it);});
  }
  const l=egLista(EG.mes),cob=egEfectivoCobrado(EG.mes),eg=egSum(l);
  const por={};l.filter(e=>!e.anulado).forEach(e=>{por[e.cat]=(por[e.cat]||0)+Number(e.m);});
  const puedeAnular=isAdmin()||can('anular');
  $('#eg-cuerpo',body).innerHTML=`<div class="kpis" style="margin-top:12px"><div class="kpi"><span class="n">${fmtMoney(cob)}</span><span class="l">Efectivo cobrado en el mes</span></div><div class="kpi"><span class="n">${fmtMoney(eg)}</span><span class="l">Egresos de efectivo</span></div><div class="kpi"><span class="n">${fmtMoney(cob-eg)}</span><span class="l">Efectivo que debería quedar</span></div></div>
    ${Object.keys(por).length?`<div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>Motivo</th><th class="right">Total</th></tr></thead><tbody>${Object.entries(por).map(([k,v])=>`<tr><td>${esc(EG_CATS[k]||k)}</td><td class="right">${esc(fmtMoney(v))}</td></tr>`).join('')}</tbody></table></div>`:''}
    <div class="list" style="margin-top:12px">${l.length?l.map(e=>`<div class="item" style="cursor:default${e.anulado?';opacity:.55':''}"><div><div class="t">${esc(fmtMoney(e.m))} · ${esc(EG_CATS[e.cat]||'')}${e.anulado?' <span class="chip warn">Anulado</span>':''}</div><div class="s">${esc(dmy(e.f))}${e.cn?' · '+esc(e.cn):''}${egQuien(e)?' · cargó '+esc(egQuien(e)):''}</div><div class="s small">${esc(e.det||'')}${e.anulado?' · Motivo de la anulación: '+esc(e.anuladoMotivo||''):''}</div></div>${puedeAnular&&!e.anulado?`<button class="btn small" type="button" data-eg-an="${esc(e.id)}">Anular</button>`:''}</div>`).join(''):'<div class="empty"><b>Sin egresos</b><span>No se cargaron egresos de efectivo en este mes.</span></div>'}</div>`;
}
