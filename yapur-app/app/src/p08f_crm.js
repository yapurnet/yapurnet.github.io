/* ===== CRM (EN PRUEBA) =====
   Todavía no está en producción: queda oculto y solo lo prende el administrador, en su propio aparato, desde Ajustes → «Funciones en prueba».
   La marca se guarda solo en ese navegador (no en el servidor), así que nadie más lo ve y no escribe nada en la base.
   Esta primera parte solo LEE lo que ya existe (clientes, pagos, órdenes): lista con segmentos y una ficha con la línea de tiempo de cada cliente. */
const crmOn=()=>S.role==='admin'&&lsGet('yapur-crm')==='1';
const CRM={seg:'todos',q:''};
const crmOrdenes=id=>[...S.ordenes.values()].filter(o=>o.clientId===id);
const crmUltPago=c=>{const p=(S.payByClient.get(c.id)||[]).find(x=>!x.anulado);return p?p.fecha:'';};
const crmDiasDesde=f=>f?Math.floor((Date.now()-new Date(f+'T12:00:00').getTime())/864e5):null;
function crmFila(c){
  const b=billing(c),abiertas=crmOrdenes(c.id).filter(ORD_OPEN),up=crmUltPago(c);
  return {c,deuda:b.aplica?b.deuda:0,meses:b.aplica?b.vencidos:0,abiertas,up,dias:crmDiasDesde(up)};
}
const CRM_SEGS=[['todos','Todos'],['deuda','Con deuda'],['pend','Por instalar'],['orden','Con orden abierta'],['sinpago','Sin pagar hace 60+ días']];
function crmFiltrar(filas){
  const q=CRM.q.trim().toLowerCase();
  return filas.filter(f=>{
    if(q&&!(f.c.nombre||'').toLowerCase().includes(q)&&!String(f.c.codigo||'').includes(q)&&!String(f.c.tel||'').includes(q)&&!(f.c.dir||'').toLowerCase().includes(q))return false;
    switch(CRM.seg){
      case 'deuda':return f.deuda>0;
      case 'pend':return f.c.estado==='pendiente';
      case 'orden':return f.abiertas.length>0;
      case 'sinpago':return (f.c.estado==='activo'||f.c.estado==='suspendido')&&f.dias!==null&&f.dias>=60;
      default:return true;
    }
  });
}
function crmHtml(){
  const filas=[...S.clientes.values()].filter(c=>c.estado!=='baja').map(crmFila);
  const n=fn=>filas.filter(fn).length,deudaTot=filas.reduce((s,f)=>s+f.deuda,0);
  const lista=crmFiltrar(filas).sort((a,b)=>(b.deuda-a.deuda)||(a.c.nombre||'').localeCompare(b.c.nombre||'','es'));
  const tile=(k,v,s)=>`<div class="gk"><div class="gt">${esc(k)}</div><b>${v}</b>${s?`<div class="small muted">${s}</div>`:''}</div>`;
  return `<div class="notice info"><b>CRM en prueba.</b> Solo lo ves vos, en este aparato. Por ahora solo muestra lo que ya está cargado: no cambia nada.</div>
    <div class="grid2" style="margin:12px 0">${tile('Clientes activos',n(f=>f.c.estado==='activo'))}${tile('Con deuda',n(f=>f.deuda>0),fmtMoney(deudaTot))}${tile('Por instalar',n(f=>f.c.estado==='pendiente'))}${tile('Con orden abierta',n(f=>f.abiertas.length>0))}</div>
    <div class="seg" id="crm-seg" role="group" aria-label="Segmento">${CRM_SEGS.map(([k,l])=>`<button type="button" data-s="${k}" aria-pressed="${CRM.seg===k}">${l}</button>`).join('')}</div>
    <div style="margin:10px 0"><input id="crm-q" type="search" placeholder="Buscar por nombre, código, teléfono o dirección" value="${esc(CRM.q)}" autocomplete="off"></div>
    <p class="small muted">${lista.length} cliente${lista.length===1?'':'s'}${lista.length>100?' (se muestran los primeros 100)':''}</p>
    ${lista.slice(0,100).map(f=>`<button type="button" class="card" data-crm="${esc(f.c.id)}" style="display:block;width:100%;text-align:left;margin:6px 0;cursor:pointer">
      <div class="head-row"><b style="overflow-wrap:anywhere">${esc(f.c.nombre||'(sin nombre)')}</b><span>${estChip(f.c)}</span></div>
      <div class="small muted">${f.deuda>0?`<span style="color:var(--bad)">Debe ${fmtMoney(f.deuda)} (${f.meses} mes${f.meses===1?'':'es'})</span> · `:''}${f.up?'Último pago '+dmy(f.up):'Sin pagos'}${f.abiertas.length?` · ${f.abiertas.length} orden${f.abiertas.length===1?'':'es'} abierta${f.abiertas.length===1?'':'s'}`:''}</div></button>`).join('')}`;
}
/* línea de tiempo de un cliente, de lo más nuevo a lo más viejo */
function crmEventos(c){
  const ev=[];
  if(c.alta)ev.push({f:c.alta,t:'Alta del cliente',k:''});
  for(const p of S.payByClient.get(c.id)||[])ev.push({f:p.fecha,t:(p.anulado?'Pago anulado · ':'Pago · ')+fmtMoney(p.monto)+(p.metodo?' ('+esc(p.metodo)+')':'')+(p.per?' · '+esc(p.per):''),k:p.anulado?'muted':'ok',r:p.recibo});
  for(const o of crmOrdenes(c.id))ev.push({f:String(o.creado||'').slice(0,10),t:(TIPOS_ORD[o.tipo]||o.tipo)+' · '+(EST_ORD[o.estado]||o.estado)+(o.notas?' — '+esc(String(o.notas).slice(0,120)):''),k:ORD_OPEN(o)?'warn':''});
  return ev.filter(e=>e.f).sort((a,b)=>b.f.localeCompare(a.f));
}
function crmFicha(id){
  const c=S.clientes.get(id);if(!c)return;
  const f=crmFila(c),ev=crmEventos(c);
  openModal({title:c.nombre||'Cliente',wide:true,html:`
    <div class="head-row"><div>${estChip(c)}</div><div class="actions start"><button class="btn small" type="button" data-crm-full>Abrir ficha completa</button>${c.tel?`<a class="btn small" href="${waUrl(c.tel,'')}" target="_blank" rel="noopener">WhatsApp</a>`:''}</div></div>
    <dl class="kv">${c.codigo?`<dt>Código</dt><dd>#${esc(c.codigo)}</dd>`:''}${c.tel?`<dt>Teléfono</dt><dd class="mono">${esc(c.tel)}</dd>`:''}${c.dir?`<dt>Dirección</dt><dd>${esc(c.dir)}${c.loc?', '+esc(c.loc):''}</dd>`:''}${f.deuda>0?`<dt>Deuda</dt><dd style="color:var(--bad)">${fmtMoney(f.deuda)} (${f.meses} mes${f.meses===1?'':'es'})</dd>`:''}<dt>Último pago</dt><dd>${f.up?dmy(f.up)+' (hace '+f.dias+' días)':'—'}</dd></dl>
    <h3>Historial</h3>${ev.length?`<ol style="list-style:none;padding:0;margin:0">${ev.map(e=>`<li style="padding:8px 0;border-top:1px solid var(--line)"><span class="small muted">${dmy(e.f)}</span><div>${e.t}${e.r?` <span class="small muted mono">${esc(e.r)}</span>`:''}</div></li>`).join('')}</ol>`:'<p class="muted">Todavía no hay movimientos.</p>'}`,
    onMount(el){const b=$('[data-crm-full]',el);if(b)b.addEventListener('click',()=>{closeModal();openClient(id);});}});
}
VIEWS.crm={
  mount(el){this.el=el;this.pintar();},
  update(){if(this.el&&this.el.isConnected&&!document.activeElement.matches('#crm-q'))this.pintar();},
  pintar(){
    const el=this.el;if(!el)return;
    const foco=document.activeElement&&document.activeElement.id==='crm-q',pos=foco?document.activeElement.selectionStart:0;
    el.innerHTML='<div class="head-row"><h2>CRM</h2></div>'+crmHtml();
    $$('#crm-seg [data-s]',el).forEach(b=>b.addEventListener('click',()=>{CRM.seg=b.dataset.s;this.pintar();}));
    const q=$('#crm-q',el);q.addEventListener('input',()=>{CRM.q=q.value;this.pintar();});if(foco){q.focus();q.setSelectionRange(pos,pos);}
    $$('[data-crm]',el).forEach(b=>b.addEventListener('click',()=>crmFicha(b.dataset.crm)));
  }
};
/* el interruptor, solo para el administrador, en Ajustes */
{const montar=VIEWS.ajustes.mount;
VIEWS.ajustes.mount=function(el){
  montar.call(this,el);
  if(S.role!=='admin')return;
  el.insertAdjacentHTML('beforeend',`<div class="card"><h2>Funciones en prueba</h2><p class="muted small">Cosas que se están armando y todavía no están para todos. Se prenden solo en este aparato y nadie más las ve.</p>
    <label class="per"><input type="checkbox" id="aj-crm"${crmOn()?' checked':''}> Mostrar el CRM (en prueba)</label></div>`);
  $('#aj-crm',el).addEventListener('change',e=>{lsSet('yapur-crm',e.target.checked?'1':'0');S.tab=e.target.checked?S.tab:(S.tab==='crm'?'ajustes':S.tab);if(typeof renderTabs==='function'){tabsHtml='';renderTabs();}toast(e.target.checked?'CRM activado: aparece como una solapa más':'CRM oculto');});
};}
