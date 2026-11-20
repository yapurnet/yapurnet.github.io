/* ===== Consumo de los clientes (lo que bajan y suben) =====
   Un programa en la PC de la EMS lee los contadores de las colas de ADMIN02 y manda los totales por día. Acá se ven los que más consumen,
   quién se pasa todo el tiempo al límite de su plan y quién casi no usa. Solo para quien administra o la oficina (el técnico no la ve). */
const CONS={d:null,dias:30,q:'',orden:'bi'};
const fmtB=b=>{b=Number(b)||0;if(b>=1e12)return (b/1e12).toFixed(2).replace('.',',')+' TB';if(b>=1e9)return (b/1e9).toFixed(b>=1e11?0:1).replace('.',',')+' GB';return Math.round(b/1e6)+' MB';};
const consIp=ip=>{const m=/^(\d+\.\d+\.\d+)\./.exec(ip||'');return m?m[1]+'.x':'sin IP';};
function consClienteDe(f){
  if(f.ip)for(const c of S.clientes.values())if(c.ip===f.ip)return c;
  return null;
}
function consFilas(d){
  return d.clientes.map(f=>{
    const c=consClienteDe(f),pl=c&&c.planId?S.planes.get(c.planId):null,prom=f.dias?f.bi/f.dias:0;
    return Object.assign({},f,{c,plan:pl?pl.nombre:'',mb:pl?Number(pl.bajada)||0:0,prom,subProm:f.dias?f.bo/f.dias:0});
  });
}
function consEtiqueta(f){
  if(f.mb&&f.pk>=f.mb*0.9&&f.dias>=3)return '<span class="chip warn">Llega al límite de su plan</span>';
  if(f.dias>=5&&f.prom<2e8)return '<span class="chip">Casi no usa</span>';
  return '';
}
function consSpark(u7){
  const max=Math.max(1,...u7);
  return `<svg viewBox="0 0 28 10" style="width:56px;height:20px" role="img" aria-label="Últimos 7 días">${u7.map((v,i)=>`<rect x="${i*4}" y="${10-Math.round(v/max*10)}" width="3" height="${Math.max(1,Math.round(v/max*10))}" rx=".6" fill="${v?'var(--accent,#0a7c7c)':'var(--line)'}"/>`).join('')}</svg>`;
}
function consHtml(d){
  const f=consFilas(d);
  if(!f.length)return `<div class="card"><p>Todavía no llegan mediciones de consumo.</p><p class="small muted">Para medirlo, el programa que corre en la PC de la EMS tiene que estar instalado («Consumo clientes YAPUR»). El primer dato aparece en la primera hora.</p></div>`;
  const tot=f.reduce((a,x)=>a+x.bi,0),tots=f.reduce((a,x)=>a+x.bo,0),dd=Math.max(1,...f.map(x=>x.dias));
  const redes=new Map();for(const x of f){const k=consIp(x.ip),r=redes.get(k)||{k,n:0,bi:0,pk:0};r.n++;r.bi+=x.bi;redes.set(k,r);}
  const rl=[...redes.values()].sort((a,b)=>b.bi-a.bi);
  const q=CONS.q.trim().toLowerCase(),vis=f.filter(x=>!q||(x.n+' '+x.ip).toLowerCase().includes(q)).sort((a,b)=>CONS.orden==='pk'?b.pk-a.pk:CONS.orden==='nom'?a.n.localeCompare(b.n):b.bi-a.bi);
  const lim=f.filter(x=>x.mb&&x.pk>=x.mb*0.9&&x.dias>=3).length,poco=f.filter(x=>x.dias>=5&&x.prom<2e8).length;
  let h=`<div class="card"><p><b>${f.length}</b> clientes medidos · ${CONS.dias===7?'últimos 7 días':'últimos 30 días'}${d.desde?' · medimos desde el '+d.desde.slice(8)+'/'+d.desde.slice(5,7):''}</p>
    <p class="small">Bajaron <b>${fmtB(tot)}</b> y subieron <b>${fmtB(tots)}</b> en total · promedio por cliente: <b>${fmtB(tot/f.length/dd)}</b> por día de bajada.</p>
    <p class="small">${lim?`<span class="chip warn">${lim} llegan al límite de su plan</span> `:''}${poco?`<span class="chip">${poco} casi no usan</span>`:''}</p></div>`;
  h+=`<div class="card"><h3>Por red</h3><div class="list">${rl.map(r=>`<div class="between small"><span>Red <span class="mono">${esc(r.k)}</span> · ${r.n} clientes</span><b>${fmtB(r.bi)}</b></div>`).join('')}</div><p class="small muted">Sirve para ver en qué red se concentra el tráfico antes de que se sature.</p></div>`;
  h+=`<div class="card"><div class="between"><h3 style="margin:0">Clientes</h3><div><select id="cn-ord"><option value="bi"${CONS.orden==='bi'?' selected':''}>Más consumo</option><option value="pk"${CONS.orden==='pk'?' selected':''}>Mayor pico</option><option value="nom"${CONS.orden==='nom'?' selected':''}>Nombre</option></select></div></div>
    <input id="cn-q" placeholder="Buscar por nombre o IP…" autocomplete="off" value="${esc(CONS.q)}" style="margin:8px 0">
    <div class="list">${vis.slice(0,120).map(x=>`<div class="card cn-row" data-k="${esc(x.k)}"><div class="between"><b>${esc(x.c?x.c.nombre:x.n)}</b>${consSpark(x.u7)}</div>
      <div class="small muted">Baja <b>${fmtB(x.prom)}</b>/día · sube ${fmtB(x.subProm)}/día · pico ${x.pk} Mbps${x.plan?' · plan '+esc(x.plan):''}${x.c?'':' · <i>sin cliente con esa IP</i>'}</div>${consEtiqueta(x)}</div>`).join('')||'<p class="muted small">Ningún cliente coincide.</p>'}</div>
    ${vis.length>120?`<p class="small muted">Se muestran los primeros 120 de ${vis.length}: usá el buscador.</p>`:''}</div>
    <p class="small muted">La bajada es lo que descargó el cliente de internet y la subida lo que mandó. El pico es la velocidad más alta medida en un tramo de 5 minutos. «Llega al límite» significa que en algún tramo usó el 90% o más de la velocidad de su plan.</p>`;
  return h;
}
async function consDetalle(k,nombre){
  let r;try{r=await NET.api('GET','/api/consumo/cliente?'+(/^\d/.test(k)?'ip=':'n=')+encodeURIComponent(k));}catch(err){toast(err.message,'bad');return;}
  const dias=(r.dias||[]).slice().reverse(),max=Math.max(1,...dias.map(x=>x.bi));
  openModal({title:'Consumo · '+nombre,html:`<div class="stack">${dias.length?`<svg viewBox="0 0 ${dias.length*10} 64" style="width:100%;height:auto" role="img" aria-label="Bajada por día">${dias.map((x,i)=>{const h=Math.max(1,Math.round(x.bi/max*56));return `<g><title>${x.d}: baja ${fmtB(x.bi)}, sube ${fmtB(x.bo)}, pico ${Math.round(x.pk)} Mbps</title><rect x="${i*10+1}" y="${58-h}" width="8" height="${h}" rx="1.5" fill="var(--accent,#0a7c7c)"/></g>`;}).join('')}</svg><div class="between small muted"><span>${esc(dias[0].d.slice(8)+'/'+dias[0].d.slice(5,7))}</span><span>${esc(dias[dias.length-1].d.slice(8)+'/'+dias[dias.length-1].d.slice(5,7))}</span></div>
    <div class="list">${dias.slice().reverse().slice(0,14).map(x=>`<div class="between small"><span>${esc(x.d.slice(8)+'/'+x.d.slice(5,7))}</span><span>baja <b>${fmtB(x.bi)}</b> · sube ${fmtB(x.bo)} · pico ${Math.round(x.pk)} Mbps</span></div>`).join('')}</div>`:'<p class="muted">Todavía no hay datos de este cliente.</p>'}
    <div class="actions"><button class="btn ghost" type="button" data-close>Cerrar</button></div></div>`});
}
VIEWS.consumo={
  mount(el){
    this.el=el;el.innerHTML=`<div class="head-row"><h2>Consumo</h2><div><select id="cn-dias"><option value="30"${CONS.dias===30?' selected':''}>30 días</option><option value="7"${CONS.dias===7?' selected':''}>7 días</option></select> <button class="btn small" type="button" id="cn-re">Actualizar</button></div></div><div id="cn-cuerpo" class="muted">Cargando…</div>`;
    $('#cn-re',el).addEventListener('click',()=>this.recargar());
    $('#cn-dias',el).addEventListener('change',e=>{CONS.dias=+e.target.value;this.recargar();});
    this.recargar();
  },
  update(){},
  async recargar(){
    const box=this.el&&$('#cn-cuerpo',this.el);if(!box)return;
    try{CONS.d=await NET.api('GET','/api/consumo?dias='+CONS.dias);box.className='';this.pintar();}
    catch(err){box.textContent=err.network?'No se pudo conectar con el servidor.':err.message;}
  },
  pintar(){
    const box=$('#cn-cuerpo',this.el);if(!box||!CONS.d)return;
    const foco=document.activeElement&&document.activeElement.id==='cn-q',pos=foco?document.activeElement.selectionStart:0;
    box.innerHTML=consHtml(CONS.d);
    const q=$('#cn-q',box);if(q){q.addEventListener('input',()=>{CONS.q=q.value;this.pintar();});if(foco){q.focus();q.setSelectionRange(pos,pos);}}
    const o=$('#cn-ord',box);if(o)o.addEventListener('change',()=>{CONS.orden=o.value;this.pintar();});
    $$('.cn-row',box).forEach(r=>r.addEventListener('click',()=>{const f=CONS.d.clientes.find(x=>x.k===r.dataset.k);if(f)consDetalle(f.k,(consClienteDe(f)||{}).nombre||f.n);}));
  }
};
