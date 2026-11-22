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
const gb1=b=>(b/1e9).toFixed(1).replace('.',',');
function consArea(serie,col,alto,unidad){   /* área de los totales por día (GB): con escala, promedio y el último día marcado */
  const n=serie.length;if(n<2)return '<p class="small muted">Todavía hay muy pocos días para dibujar la gráfica.</p>';
  const gbs=serie.map(x=>x[col]/1e9),mx0=Math.max(...gbs),paso=mx0>400?200:mx0>200?100:mx0>80?50:mx0>40?20:mx0>16?10:5,top=Math.max(paso,Math.ceil(mx0/paso)*paso),W=366,H=alto,P=8,yv=v=>H+P-v/top*H,xv=i=>i*W/(n-1),avg=gbs.reduce((a,v)=>a+v,0)/n;
  const ln=gbs.map((v,i)=>(i?'L':'M')+xv(i).toFixed(1)+','+yv(v).toFixed(1)).join(' '),colr=col==='bi'?'var(--accent)':'var(--info)',gid='ag'+col;
  const marcas=[0,1,2,3,4,5].map(k=>Math.round(k*(n-1)/5));
  return `<svg viewBox="0 0 400 ${H+P+16}" style="width:100%;height:auto;display:block" role="img" aria-label="${col==='bi'?'Bajada':'Subida'} por día en GB. Promedio ${gb1(avg*1e9)} GB por día. Hoy ${gb1(gbs[n-1]*1e9)} GB.">
    <defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${colr}" stop-opacity=".28"/><stop offset="1" stop-color="${colr}" stop-opacity=".02"/></linearGradient></defs>
    ${[0,1,2,3].map(k=>{const v=top*k/3,y=yv(v);return `<line x1="0" x2="${W}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-width="1"${k?' stroke-dasharray="2 3"':''}/><text x="${W+4}" y="${(y+3).toFixed(1)}" font-size="9" fill="currentColor" opacity=".6">${Math.round(v)}</text>`;}).join('')}
    <path d="${ln} L${W},${yv(0)} L0,${yv(0)} Z" fill="url(#${gid})"/><path d="${ln}" fill="none" stroke="${colr}" stroke-width="2" stroke-linejoin="round"/>
    <line x1="0" x2="${W}" y1="${yv(avg).toFixed(1)}" y2="${yv(avg).toFixed(1)}" stroke="var(--ink)" stroke-width="1.1" stroke-dasharray="5 3" opacity=".55"/>
    <circle cx="${W}" cy="${yv(gbs[n-1]).toFixed(1)}" r="4" fill="var(--surface)" stroke="${colr}" stroke-width="2"/>
    ${serie.map((x,i)=>`<rect x="${(xv(i)-W/(n-1)/2).toFixed(1)}" y="0" width="${(W/(n-1)).toFixed(1)}" height="${H+P}" fill="transparent"><title>${x.d.slice(8)}/${x.d.slice(5,7)}: ${gb1(x[col])} GB</title></rect>`).join('')}
    ${marcas.map((i,k)=>`<text x="${xv(i).toFixed(1)}" y="${H+P+13}" font-size="9" fill="currentColor"${i===n-1?' font-weight="700"':' opacity=".6"'} text-anchor="${k===0?'start':i===n-1?'end':'middle'}">${i===n-1?'hoy':serie[i].d.slice(8)+'/'+serie[i].d.slice(5,7)}</text>`).join('')}</svg>
    <div class="gleg"><span><i style="background:${colr}"></i>${col==='bi'?'Bajada':'Subida'} (${unidad})</span><span><i style="background:var(--ink);height:2px;vertical-align:3px;opacity:.55"></i>Promedio ${gb1(avg*1e9)} GB</span></div>`;
}
function consHtml(d){
  const f=consFilas(d);
  if(!f.length)return `<div class="card"><p>Todavía no llegan mediciones de consumo.</p><p class="small muted">Para medirlo, el programa que corre en la PC de la EMS tiene que estar instalado («Consumo clientes YAPUR»). El primer dato aparece en la primera hora.</p></div>`;
  const tot=f.reduce((a,x)=>a+x.bi,0),tots=f.reduce((a,x)=>a+x.bo,0),dd=Math.max(1,...f.map(x=>x.dias));
  const redes=new Map();for(const x of f){const k=consIp(x.ip),r=redes.get(k)||{k,n:0,bi:0,pk:0};r.n++;r.bi+=x.bi;redes.set(k,r);}
  const rl=[...redes.values()].sort((a,b)=>b.bi-a.bi);
  const q=CONS.q.trim().toLowerCase(),vis=f.filter(x=>!q||(x.n+' '+x.ip).toLowerCase().includes(q)).sort((a,b)=>CONS.orden==='pk'?b.pk-a.pk:CONS.orden==='nom'?a.n.localeCompare(b.n):b.bi-a.bi);
  const lim=f.filter(x=>x.mb&&x.pk>=x.mb*0.9&&x.dias>=3).length,poco=f.filter(x=>x.dias>=5&&x.prom<2e8).length;
  const se=d.serie||[],pico=se.length?se.reduce((m,x)=>x.bi>m.bi?x:m,se[0]):null,hoyBi=se.length?se[se.length-1].bi:0,avgBi=se.length?se.reduce((a,x)=>a+x.bi,0)/se.length:0;
  let h=`<div class="gk g2 big"><div class="gt"><b>${f.length}</b><span>clientes medidos</span></div><div class="gt"><b>${fmtB(tot/f.length/dd)}</b><span>promedio por cliente al día</span></div><div class="gt"><b style="color:var(--accent)">${fmtB(tot)}</b><span>bajaron en total</span></div><div class="gt"><b style="color:var(--info)">${fmtB(tots)}</b><span>subieron en total</span></div></div>
    ${lim||poco?`<p class="small" style="margin:0">${lim?`<span class="chip warn">${lim} llegan al límite de su plan</span> `:''}${poco?`<span class="chip">${poco} casi no usan</span>`:''}</p>`:''}`;
  if(se.length>1)h+=`<div class="card"><div class="between"><h3 style="margin:0">Tráfico por día</h3><span class="small muted">GB de todos los clientes</span></div>${consArea(se,'bi',118,'GB')}<p class="small muted" style="margin:6px 0 0">${pico&&pico.d===se[se.length-1].d?'Hoy fue el día de mayor bajada del período':'Mayor bajada: el '+pico.d.slice(8)+'/'+pico.d.slice(5,7)+' ('+gb1(pico.bi)+' GB)'}. Promedio ${gb1(avgBi)} GB por día.</p>
    <div style="border-top:1px solid var(--line);margin-top:10px;padding-top:8px"><div class="between"><b class="small">Subida</b><span class="small muted">hoy ${gb1(se[se.length-1].bo)} GB</span></div>${consArea(se,'bo',50,'GB')}</div></div>`;
  const maxr=Math.max(1,...rl.map(r=>r.bi));
  h+=`<div class="card"><div class="between"><h3 style="margin:0">Por red</h3><span class="small muted">Bajada del período</span></div><div style="margin-top:4px">${rl.map(r=>`<div class="gnet"><span><b class="mono small">${esc(r.k)}</b><br><span class="small muted">${r.n} ${r.n===1?'cliente':'clientes'}</span></span><div class="gtrk"><i style="width:${Math.max(2,Math.round(r.bi/maxr*100))}%"></i></div><span style="text-align:right"><b>${fmtB(r.bi)}</b><br><span class="small muted">${Math.round(r.bi/Math.max(1,tot)*100)} %</span></span></div>`).join('')}</div><p class="small muted" style="margin:6px 0 0">${rl.length>1?'La red '+esc(rl[0].k)+' concentra el '+Math.round(rl[0].bi/Math.max(1,tot)*100)+' % del tráfico. ':''}Sirve para ver en qué red se concentra antes de que se sature.</p></div>`;
  h+=`<div class="card"><div class="between"><h3 style="margin:0">Clientes</h3><div><select id="cn-ord"><option value="bi"${CONS.orden==='bi'?' selected':''}>Más consumo</option><option value="pk"${CONS.orden==='pk'?' selected':''}>Mayor pico</option><option value="nom"${CONS.orden==='nom'?' selected':''}>Nombre</option></select></div></div>
    <input id="cn-q" placeholder="Buscar por nombre o IP…" autocomplete="off" value="${esc(CONS.q)}" style="margin:8px 0">
    <div>${vis.slice(0,120).map(x=>{const pc=x.mb?Math.min(100,Math.round(x.pk/x.mb*100)):0,col=pc>=90?'var(--warn)':'var(--accent)';return `<div class="cn-row" data-k="${esc(x.k)}" style="padding:10px 0;border-top:1px solid var(--line);cursor:pointer"><div class="between"><div style="min-width:0"><b>${esc(x.c?x.c.nombre:x.n)}</b><div class="small muted">Baja ${fmtB(x.prom)} al día · sube ${fmtB(x.subProm)}${x.c?'':' · <i>sin cliente con esa IP</i>'}</div></div>${consSpark(x.u7)}</div>${x.mb?`<div class="gmeter"><i style="width:${pc}%;background:${col}"></i><u></u></div><div class="between small"><span class="muted">Pico <b style="color:var(--ink)">${x.pk}</b> de ${x.mb} Mbps (${pc} %)${x.plan?' · '+esc(x.plan):''}</span>${consEtiqueta(x)}</div>`:`<div class="small muted">Pico ${x.pk} Mbps · sin plan asignado ${consEtiqueta(x)}</div>`}</div>`;}).join('')||'<p class="muted small">Ningún cliente coincide.</p>'}</div>
    ${vis.length>120?`<p class="small muted">Se muestran los primeros 120 de ${vis.length}: usá el buscador.</p>`:''}</div>
    <p class="small muted">La bajada es lo que descargó el cliente de internet y la subida lo que mandó. El pico es la velocidad más alta medida en un tramo de 5 minutos. La marca negra de la barra es el 90 % de la velocidad del plan. «Llega al límite» significa que en algún tramo usó el 90% o más de la velocidad de su plan.</p>`;
  return h;
}
async function consDetalle(k,nombre,mb){
  let r;try{r=await NET.api('GET','/api/consumo/cliente?'+(/^\d/.test(k)?'ip=':'n=')+encodeURIComponent(k));}catch(err){toast(err.message,'bad');return;}
  const dias=(r.dias||[]).slice().reverse(),fd=d=>d.slice(8)+'/'+d.slice(5,7);
  if(!dias.length){openModal({title:'Consumo · '+nombre,html:'<div class="stack"><p class="muted">Todavía no hay datos de este cliente.</p><div class="actions"><button class="btn ghost" type="button" data-close>Cerrar</button></div></div>'});return;}
  const n=dias.length,mxg=Math.max(...dias.map(x=>x.bi))/1e9,paso=mxg>40?20:mxg>16?10:mxg>8?5:2,top=Math.max(paso*2,Math.ceil(mxg/paso)*paso),H=118,P=8,W=366,bw=W/n,yv=v=>H+P-v/top*H;
  const avgBi=dias.reduce((a,x)=>a+x.bi,0)/n,avgBo=dias.reduce((a,x)=>a+x.bo,0)/n,pkMax=Math.max(...dias.map(x=>x.pk)),mx=dias.reduce((m,x)=>x.bi>m.bi?x:m,dias[0]);
  const marcas=[0,Math.round((n-1)/2),n-1].filter((v,i,a)=>a.indexOf(v)===i);
  const eje=marcas.map(i=>`<text x="${(i*bw+bw/2).toFixed(1)}" y="${H+P+13}" font-size="9" fill="currentColor"${i===n-1?' font-weight="700"':' opacity=".6"'} text-anchor="${i===0?'start':i===n-1?'end':'middle'}">${i===n-1?'hoy':fd(dias[i].d)}</text>`).join('');
  const barras=`<svg viewBox="0 0 400 ${H+P+16}" style="width:100%;height:auto;display:block" role="img" aria-label="Bajada y subida por día en GB. Promedio ${gb1(avgBi)} GB de bajada por día.">${[0,1,2,3].map(q=>{const v=top*q/3,y=yv(v);return `<line x1="0" x2="${W}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-width="1"${q?' stroke-dasharray="2 3"':''}/><text x="${W+4}" y="${(y+3).toFixed(1)}" font-size="9" fill="currentColor" opacity=".6">${Math.round(v)}</text>`;}).join('')}${dias.map((x,i)=>{const h=Math.max(1,x.bi/1e9/top*H),h2=Math.max(1,x.bo/1e9/top*H),bx=i*bw+Math.min(2,bw*.15),w=Math.max(2,bw-2*Math.min(2,bw*.15));return `<g><title>${fd(x.d)}: baja ${fmtB(x.bi)}, sube ${fmtB(x.bo)}, pico ${Math.round(x.pk)} Mbps</title><rect x="${bx.toFixed(1)}" y="${(H+P-h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="var(--accent)"${i===n-1?'':' fill-opacity=".5"'}/><rect x="${(bx+w*.25).toFixed(1)}" y="${(H+P-h2).toFixed(1)}" width="${(w*.5).toFixed(1)}" height="${h2.toFixed(1)}" rx="1" fill="var(--info)"/></g>`;}).join('')}<line x1="0" x2="${W}" y1="${yv(avgBi/1e9).toFixed(1)}" y2="${yv(avgBi/1e9).toFixed(1)}" stroke="var(--ink)" stroke-width="1.1" stroke-dasharray="5 3" opacity=".6"/>${eje}</svg><div class="gleg"><span><i style="background:var(--accent)"></i>Bajada</span><span><i style="background:var(--info)"></i>Subida</span><span><i style="background:var(--ink);height:2px;vertical-align:3px;opacity:.6"></i>Promedio ${gb1(avgBi)} GB</span></div>`;
  const ptop=Math.max(10,Math.ceil(Math.max(pkMax,mb||0)*1.1/10)*10),py=v=>H+P-v/ptop*H,xp=i=>i*bw+bw/2;
  const dentro=mb?dias.filter(x=>x.pk>=mb*.9).length:0;
  const linea=`<svg viewBox="0 0 400 ${H+P+16}" style="width:100%;height:auto;display:block" role="img" aria-label="Pico de velocidad por día en Mbps${mb?' contra el límite del plan de '+mb+' Mbps':''}.">${mb?`<rect x="0" y="${py(mb).toFixed(1)}" width="${W}" height="${(py(mb*.9)-py(mb)).toFixed(1)}" fill="var(--warn)" opacity=".16"/>`:''}${[0,1,2,3].map(q=>{const v=ptop*q/3,y=py(v);return `<line x1="0" x2="${W}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-width="1"${q?' stroke-dasharray="2 3"':''}/><text x="${W+4}" y="${(y+3).toFixed(1)}" font-size="9" fill="currentColor" opacity=".6">${Math.round(v)}</text>`;}).join('')}${mb?`<line x1="0" x2="${W}" y1="${py(mb).toFixed(1)}" y2="${py(mb).toFixed(1)}" stroke="var(--bad)" stroke-width="1.5"/>`:''}<path d="${dias.map((x,i)=>(i?'L':'M')+xp(i).toFixed(1)+','+py(x.pk).toFixed(1)).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linejoin="round"/>${dias.map((x,i)=>mb&&x.pk>=mb*.9?`<circle cx="${xp(i).toFixed(1)}" cy="${py(x.pk).toFixed(1)}" r="3.3" fill="var(--surface)" stroke="var(--warn)" stroke-width="1.8"><title>${fd(x.d)}: pico ${Math.round(x.pk)} Mbps</title></circle>`:'').join('')}<circle cx="${xp(n-1).toFixed(1)}" cy="${py(dias[n-1].pk).toFixed(1)}" r="3.6" fill="var(--accent)"/>${eje}</svg><div class="gleg"><span><i style="background:var(--accent)"></i>Pico del día</span>${mb?`<span><i style="background:var(--bad);height:2px;vertical-align:3px"></i>Límite del plan (${mb})</span><span><i style="background:var(--warn);opacity:.45"></i>Zona 90 %</span>`:''}</div>${mb?`<p class="small muted" style="margin:6px 0 0">${dentro?`Tocó la zona del 90 % en ${dentro} ${dentro===1?'día':'días'}.${dentro>=3?' Si se repite, conviene ofrecerle un plan mayor.':''}`:'No llegó al 90 % de su plan en ningún día.'}</p>`:'<p class="small muted" style="margin:6px 0 0">El cliente no tiene plan asignado, por eso no se dibuja el límite.</p>'}`;
  openModal({title:'Consumo · '+nombre,html:`<div class="stack"><div class="gk g3"><div class="gt"><b>${fmtB(avgBi)}</b><span>baja por día</span></div><div class="gt"><b style="color:var(--info)">${fmtB(avgBo)}</b><span>sube por día</span></div><div class="gt"><b${mb&&pkMax>=mb*.9?' style="color:var(--warn)"':''}>${mb?Math.min(100,Math.round(pkMax/mb*100))+' %':Math.round(pkMax)+' Mbps'}</b><span>${mb?'pico del plan':'pico máximo'}</span></div></div>
    <div style="margin-top:12px"><div class="between"><b>Consumo por día</b><span class="small muted">GB · ${n} días</span></div>${barras}<p class="small muted" style="margin:6px 0 0">Mayor consumo: el ${fd(mx.d)}, con ${gb1(mx.bi)} GB.</p></div>
    <div style="margin-top:12px"><div class="between"><b>Pico de velocidad${mb?' vs. plan':''}</b><span class="small muted">Mbps</span></div>${linea}</div>
    <div style="margin-top:12px"><b>Últimos 7 días</b><table style="width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums;margin-top:4px"><tr class="small muted"><th style="text-align:left;font-weight:600">Día</th><th style="text-align:right;font-weight:600">Bajada</th><th style="text-align:right;font-weight:600">Subida</th><th style="text-align:right;font-weight:600">Pico</th></tr>${dias.slice().reverse().slice(0,7).map((x,i)=>`<tr style="border-top:1px solid var(--line)"><td style="padding:5px 0">${i===0&&x.d===dias[n-1].d?'Hoy':fd(x.d)}</td><td style="text-align:right">${x.bi===mx.bi?`<b style="color:var(--warn)">${fmtB(x.bi)}</b>`:fmtB(x.bi)}</td><td style="text-align:right">${fmtB(x.bo)}</td><td style="text-align:right">${Math.round(x.pk)} Mbps</td></tr>`).join('')}</table></div>
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
    $$('.cn-row',box).forEach(r=>r.addEventListener('click',()=>{const f=CONS.d.clientes.find(x=>x.k===r.dataset.k);if(f){const fl=consFilas(CONS.d).find(x=>x.k===f.k)||{};consDetalle(f.k,(consClienteDe(f)||{}).nombre||f.n,fl.mb);}}));
  }
};
