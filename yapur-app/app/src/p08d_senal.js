/* ===== Señal de las ONU (potencia óptica recibida) =====
   Un lector dentro de la red consulta la OLT y manda las lecturas; acá se ven las ONU con mala señal (peor que el umbral, -27 dBm de arranque). */
const SENAL={d:null,t:0};
async function senalCargar(forzar){
  if(!forzar&&SENAL.d&&Date.now()-SENAL.t<60e3)return SENAL.d;
  SENAL.d=await NET.api('GET','/api/olt');SENAL.t=Date.now();senalBadge();return SENAL.d;
}
function senalBadge(){tabsHtml='';try{renderTabs();}catch(e){}}
/* aviso para todos los que ven la red: cada 15 minutos mientras la app está abierta */
function senalVigilar(){
  if(!can('red')||senalVigilar.on)return;senalVigilar.on=true;
  const go=()=>{if(document.hidden||!NET.token)return;senalCargar(true).catch(()=>{});};
  setTimeout(go,4000);setInterval(go,15*60e3);
}
const senalHace=ts=>{if(!ts)return 'nunca';const m=Math.round((Date.now()-ts)/6e4);return m<1?'recién':m<60?'hace '+m+' min':m<1440?'hace '+Math.round(m/60)+' h':'hace '+Math.round(m/1440)+' días';};
/* ----- caídas: duración legible, hora legible y gráficas simples en SVG (sin librerías) ----- */
const cdDur=ms=>{const m=Math.round(ms/6e4);if(m<1)return 'menos de 1 min';if(m<60)return m+' min';const h=Math.floor(m/60);if(h<24)return h+' h'+(m%60?' '+(m%60)+' min':'');const d=Math.floor(h/24);return d+' d'+(h%24?' '+(h%24)+' h':'');};
const cdFecha=ts=>{const d=new Date(ts-3*36e5),p=n=>String(n).padStart(2,'0');return p(d.getUTCDate())+'/'+p(d.getUTCMonth()+1)+' '+p(d.getUTCHours())+':'+p(d.getUTCMinutes());};
const cdColor=p=>p<0?'var(--line)':p===0?'var(--ok)':p<50?'var(--warn)':'var(--bad)';
function cdTira(tira){   /* 144 tramos de 10 minutos = las últimas 24 horas; verde sin pérdidas, amarillo con pérdidas, rojo sin respuesta, gris sin datos */
  return `<svg viewBox="0 0 144 12" preserveAspectRatio="none" style="width:100%;height:20px;display:block" role="img" aria-label="Estado de las últimas 24 horas">${tira.map((p,i)=>`<rect x="${i}" y="0" width="0.82" height="12" rx="0.2" fill="${cdColor(p)}"/>`).join('')}</svg><div class="between small muted"><span>hace 24 h</span><span>ahora</span></div>`;
}
function cdBarras(dias){   /* caídas de ONU por día, últimos 14 días */
  const max=Math.max(3,...dias.map(x=>x.n)),w=20,H=56;
  return `<svg viewBox="0 0 ${dias.length*w} ${H+16}" style="width:100%;height:auto;display:block" role="img" aria-label="Caídas de ONU por día">${dias.map((x,i)=>{const h=Math.round(x.n/max*H);return `<g><title>${x.d}: ${x.n}</title><rect x="${i*w+3}" y="${H-h}" width="${w-6}" height="${Math.max(h,x.n?2:1)}" rx="2" fill="${x.n?'var(--bad)':'var(--line)'}"/>${x.n?`<text x="${i*w+w/2}" y="${H-h-2}" font-size="7" text-anchor="middle" fill="currentColor">${x.n}</text>`:''}<text x="${i*w+w/2}" y="${H+11}" font-size="7" text-anchor="middle" fill="currentColor" opacity=".6">${+x.d.slice(8)}</text></g>`;}).join('')}</svg>`;
}
function caidasHtml(c){
  const tec=S.role==='tecnico',n=c.nodos||[],o=c.onus||{dias:[],top:[],ahoraCaidas:[]};
  let h='';
  if(!tec){
    h+=`<div class="card"><h3>Nodos</h3>${n.length?n.map(x=>{
      const est=x.on===1?`<span class="chip ok">Activo hace ${cdDur(c.ahora-x.desde)}</span>`:x.on===0?`<span class="chip bad">Caído hace ${cdDur(c.ahora-x.desde)}</span>`:'<span class="chip">Sin respuesta desde que se empezó a medir</span>';
      const caidas=x.ult.filter(e=>e.ts>c.ahora-7*864e5);
      return `<div class="sn-nodo" style="margin:12px 0 18px"><div class="between"><b>${esc(x.n)}</b>${est}</div>${cdTira(x.tira)}<div class="small muted">${x.disp7!=null?`Disponibilidad 7 días: <b>${x.disp7}%</b> · `:''}${x.caidas7} ${x.caidas7===1?'caída':'caídas'} en 7 días${x.min7?` (${cdDur(x.min7*6e4)} sin servicio)`:''}${x.ms!=null?` · ping ${x.ms} ms`:''}${x.on===1?` · hace ${cdDur(c.ahora-x.visto)} la última medición`:''}</div>${caidas.length?`<ul class="small" style="margin:6px 0 0;padding-left:18px">${caidas.slice(0,4).map(e=>`<li>${cdFecha(e.ts)} · ${e.dur==null?'<b>sigue caído</b>':'estuvo '+cdDur(e.dur)+' sin respuesta'}</li>`).join('')}</ul>`:''}</div>`;
    }).join(''):`<p class="muted small">Todavía no llegan mediciones de los nodos. Para medirlos, el programa que corre en la PC de la EMS tiene que tener la lista de nodos (archivo <span class="mono">nodos.txt</span>) y estar instalado el «Monitor de nodos».</p>`}<p class="small muted">Se mide con un ping por minuto desde la red. Un nodo se da por caído cuando dos mediciones seguidas no tienen ninguna respuesta; si es un corte corto o un reinicio también queda anotado.</p></div>`;
  }
  const caidasTot=o.dias.reduce((a,d)=>a+d.n,0);
  h+=`<div class="card"><h3>Caídas de las ONU (14 días)</h3><p class="small">${o.caidas?`<span class="chip bad">${o.caidas} ${o.caidas===1?'caída ahora':'caídas ahora'}</span> `:'<span class="chip ok">Ninguna ONU caída ahora</span> '}${caidasTot} ${caidasTot===1?'caída':'caídas'} en 14 días${o.total!=null?' · '+o.total+' ONU controladas':''}</p>${cdBarras(o.dias)}`;
  if(o.ahoraCaidas.length)h+=`<h4>Caídas ahora</h4><p class="small muted">Las que figuran desde la primera medición pueden estar caídas desde antes: se anota desde que se empezó a medir.</p><div class="list">${o.ahoraCaidas.map(x=>`<div class="sn-cd" data-cid="${esc(x.cid||'')}"><div class="between"><b>${esc(x.cn||x.name||'ONU sin cliente')}</b><span class="small muted">desde ${cdFecha(x.desde)} · ${cdDur(c.ahora-x.desde)}</span></div><div class="small muted">${x.port?'Puerto '+esc(x.port)+' · ':''}<span class="mono">${esc(x.k)}</span></div></div>`).join('')}</div>`;
  if(o.top.length)h+=`<h4>Las que más se cayeron (7 días)</h4><div class="list">${o.top.map(x=>`<div class="sn-cd" data-cid="${esc(x.cid||'')}"><div class="between"><b>${esc(x.cn||x.name||'ONU sin cliente')}</b><span class="chip ${x.caidas>=3?'bad':'warn'}">${x.caidas} ${x.caidas===1?'caída':'caídas'}</span></div><div class="small muted">${x.port?'Puerto '+esc(x.port)+' · ':''}${cdDur(x.min*6e4)} sin servicio en total</div></div>`).join('')}</div>`;
  h+=`<p class="small muted">Una ONU se da por caída cuando no responde en dos lecturas seguidas de la OLT (cada 10 minutos). Un corte de luz en la casa del cliente también cuenta como caída.</p></div>`;
  return h;
}
VIEWS.senal={
  mount(el){this.el=el;el.innerHTML='<div class="head-row"><h2>Señal de las ONU</h2><button class="btn small" type="button" id="sn-re">Actualizar</button></div><div id="sn-cuerpo" class="muted">Cargando…</div>';$('#sn-re',el).addEventListener('click',()=>this.recargar(true));this.recargar(true);},
  update(){},
  async recargar(f){
    const el=this.el,box=el&&$('#sn-cuerpo',el);if(!box)return;
    try{const d=await senalCargar(f);box.className='';box.innerHTML=this.html(d);this.bind(box,d);}
    catch(err){box.textContent=err.network?'No se pudo conectar con el servidor.':err.message;return;}
    const cd=$('#sn-caidas',box);if(cd)NET.api('GET','/api/caidas').then(c=>{cd.innerHTML=caidasHtml(c);$$('.sn-cd',cd).forEach(r=>r.addEventListener('click',()=>{const id=r.dataset.cid;if(id&&S.clientes.has(id))openClient(id);}));}).catch(()=>{cd.innerHTML='<div class="card"><p class="small muted">No se pudieron cargar las caídas.</p></div>';});
  },
  html(d){
    const viejo=d.visto&&Date.now()-d.visto>3*36e5,tec=S.role==='tecnico';   /* al técnico no se le muestran totales: solo las que tienen mala señal */
    let h=`<div class="card"><p>${d.visto?`Última lectura de la OLT: <b>${senalHace(d.visto)}</b>.${tec?'':' '+d.total+' ONU leídas.'}`:'Todavía no llegó ninguna lectura de la OLT.'}</p>
      ${viejo?'<p class="chip bad">Hace más de 3 horas que no llega ninguna lectura: revisá el lector.</p>':''}
      <p class="small muted">Se avisa cuando una ONU recibe <b>peor que ${d.umbral} dBm</b> (por ejemplo -29). Una potencia mejor, como -20, está bien.${d.sinCliente&&!tec?` ${d.sinCliente} ONU leídas no coinciden con ningún cliente (revisá la serie o MAC cargada en su ficha).`:''}</p></div>`;
    if(d.visto){
      h+=d.lista.length?`<h3>Con mala señal (${d.lista.length})</h3><div class="list">${d.lista.map(o=>`<div class="card sn-row" data-cid="${esc(o.cid||'')}"><div class="between"><b>${esc(o.cn||'ONU sin cliente')}</b><span class="chip bad">${o.rx} dBm</span></div><div class="small muted">${o.cd?esc(o.cd)+' · ':''}${o.port?'Puerto '+esc(o.port)+' · ':''}<span class="mono">${esc(o.k)}</span>${o.est?' · '+esc(o.est):''}</div></div>`).join('')}</div>`
        :'<div class="card"><p>✔ Ninguna ONU está por debajo del límite.</p></div>';
    }
    if(!tec&&d.sin&&d.sin.length)h+=`<div class="card"><details><summary><b>ONU sin cliente (${d.sin.length})</b></summary><p class="small muted">Buscá el cliente por su nombre o su IP y tocalo: la ONU queda vinculada y su potencia aparece en su ficha.</p><div class="list" id="sn-sin">${d.sin.map(o=>`<div class="sn-sin" data-k="${esc(o.k)}"><div class="between"><b>${esc(o.name||'(sin nombre en la OLT)')}</b>${o.rx!=null?`<span class="chip ${o.rx<d.umbral?'bad':''}">${o.rx} dBm</span>`:''}</div><div class="small muted">Puerto ${esc(o.port||'?')} · <span class="mono">${esc(o.k)}</span></div><input class="sn-q" placeholder="Buscar cliente por nombre o IP…" autocomplete="off"><div class="sn-res"></div></div>`).join('')}</div></details></div>`;
    h+='<div id="sn-caidas"></div>';
    if(isAdmin())h+=`<div class="card"><h3>Configuración (administrador)</h3>
      ${F('Límite de alerta (dBm)','sn-um',`<input id="sn-um" inputmode="decimal" value="${d.umbral}">`,'Se avisa cuando la potencia recibida es peor (más negativa) que este valor.')}
      <div class="actions start"><button class="btn" type="button" id="sn-um-go">Guardar límite</button><button class="btn" type="button" id="sn-tok">${d.tok?'Generar otro token del lector':'Generar token del lector'}</button></div>
      <p class="small muted">El lector es un script dentro de tu red que consulta la OLT y manda las lecturas a <span class="mono">/api/olt/ingest</span> con este token (solo puede enviar, no leer nada). Al generar uno nuevo, el anterior deja de servir.</p><div id="sn-tokbox"></div></div>`;
    return h;
  },
  bind(box,d){
    const norm=t=>String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    $$('.sn-sin',box).forEach(fila=>{
      const q=$('.sn-q',fila),res=$('.sn-res',fila);
      q.addEventListener('input',()=>{
        const w=norm(q.value).split(/\s+/).filter(x=>x.length>1);res.innerHTML='';if(!w.length)return;
        const hit=[...S.clientes.values()].filter(c=>c.estado!=='baja'&&w.every(x=>norm(c.nombre).includes(x)||String(c.ip||'').includes(x))).slice(0,6);
        res.innerHTML=hit.length?hit.map(c=>`<button class="btn small" type="button" data-cid="${esc(c.id)}">${esc(c.nombre)}${c.ip?' · '+esc(c.ip):''}${c.dir?' · '+esc(c.dir):''}</button>`).join(''):'<span class="small muted">Ningún cliente con ese nombre.</span>';
      });
      res.addEventListener('click',async ev=>{
        const bt=ev.target.closest('button[data-cid]');if(!bt)return;
        try{const r=await NET.api('POST','/api/olt/vincular',{cid:bt.dataset.cid,q:fila.dataset.k});toast('ONU vinculada a '+bt.textContent.split(' · ')[0]);this.recargar(true);}
        catch(err){toast(err.message,'bad');}
      });
    });
    $$('.sn-row',box).forEach(r=>r.addEventListener('click',()=>{const id=r.dataset.cid;if(id&&S.clientes.has(id))openClient(id);}));
    const um=$('#sn-um-go',box);if(um)um.addEventListener('click',async()=>{try{await NET.api('PUT','/api/olt/config',{umbral:num($('#sn-um',box).value)});toast('Límite guardado');this.recargar(true);}catch(err){toast(err.message,'bad');}});
    const tk=$('#sn-tok',box);if(tk)tk.addEventListener('click',async()=>{if(d.tok&&!confirm('El token anterior dejará de servir. ¿Generar uno nuevo?'))return;try{const r=await NET.api('POST','/api/olt/token',{});$('#sn-tokbox',box).innerHTML=`<p class="small">Copialo ahora, no se vuelve a mostrar:</p><p class="mono" style="word-break:break-all">${esc(r.token)}</p><button class="btn small" type="button" id="sn-cp">Copiar</button>`;$('#sn-cp',box).addEventListener('click',()=>copyText(r.token,'Token'));}catch(err){toast(err.message,'bad');}});
  }
};

/* ----- el técnico en el cliente: ver la última potencia de su ONU y cargar la que midió (EMS o medidor) ----- */
async function openSenalCliente(id){
  const c=S.clientes.get(id);if(!c)return;
  let d;try{d=await NET.api('GET','/api/olt/cliente/'+encodeURIComponent(id));}catch(err){toast(err.message,'bad');return;}
  const est=rx=>rx==null?'':rx<d.umbral?'bad':rx<d.umbral+3?'warn':'ok';
  const fresca=d.rx!=null&&!d.manual&&Date.now()-d.ts<36e5;
  const campo_=F('Potencia medida (dBm)','sg-rx','<input id="sg-rx" inputmode="decimal" placeholder="-22,5">',(S.realRole==='tecnico'?`Medí con el medidor de potencia óptica, en la fibra que llega a la ONU. Va en negativo. Por debajo de ${d.umbral} dBm se avisa a todos.`:`Se ve en la EMS: ONU → «Onu Basic Information» → Received OpticalPower, o con el medidor de potencia. Va en negativo. Por debajo de ${d.umbral} dBm se avisa a todos.`));
  const ult=d.rx!=null?`<p>Última potencia: <span class="chip ${est(d.rx)}">${d.rx} dBm</span> · ${senalHace(d.ts)}${d.manual?' · cargada a mano'+(d.por?' por '+esc(d.por):''):' · leída de la OLT'}</p>${d.rx<d.umbral?`<p class="chip bad">Peor que ${d.umbral} dBm: tiene mala señal.</p>`:''}`:'<p class="muted">Todavía no hay ninguna lectura de esta ONU.</p>';
  openModal({title:'Potencia de la ONU · '+c.nombre,html:`<div class="stack">
    ${ult}
    ${d.hist?`<div class="stack"><p class="small"><b>Caídas en 14 días: ${d.hist.caidas}</b>${d.hist.caidas?` · ${cdDur(d.hist.min*6e4)} sin servicio en total`:''}${d.hist.on?'':' · <span class="chip bad">caída ahora, desde '+cdFecha(d.hist.desde)+'</span>'}</p>${d.hist.ult.length?`<ul class="small muted" style="margin:0;padding-left:18px">${d.hist.ult.map(e=>`<li>${cdFecha(e.ts)} · ${e.dur==null?'sigue caída':cdDur(e.dur)+' sin respuesta'}</li>`).join('')}</ul>`:''}</div>`:''}
    ${d.sn?'':`<div class="stack"><p class="small">Para ver la potencia automática, vinculá la ONU: escribí los últimos 6 caracteres de la serie (están en la etiqueta de la ONU, empieza con TPLG).</p><input id="sg-sn" placeholder="Ej: C70AD" autocapitalize="characters" autocomplete="off"><div class="actions"><button class="btn" type="button" id="sg-vinc">Vincular ONU</button></div></div>`}
    <p class="small muted">${d.sn?`Serie <span class="mono">${esc(d.sn)}</span>`:'Este cliente no tiene la serie de la ONU cargada (campo «Equipo» en su ficha).'}${d.port?` · Puerto/ID en la OLT: <b>${esc(d.port)}</b>`:''}</p>
    ${fresca?`<p class="small muted">La OLT actualiza esta lectura cada 10 minutos. No hace falta medir.</p><details><summary class="small">Cargar una medida a mano</summary>${campo_}</details>`:campo_}
    <div class="actions"><button class="btn primary" type="button" id="sg-go">Guardar medida</button></div></div>`,
  onClose:()=>setTimeout(()=>{if(S.clientes.has(id))openClient(id);},0),
  onMount(box){
    const vb=$('#sg-vinc',box);if(vb)vb.addEventListener('click',async()=>{
      try{const r=await NET.api('POST','/api/olt/vincular',{cid:id,q:$('#sg-sn',box).value});toast('ONU vinculada · puerto/ID '+(r.port||'?'));SENAL.t=0;closeModal();}
      catch(err){toast(err.message,'bad');}
    });
    $('#sg-go',box).addEventListener('click',async()=>{
      const v=num($('#sg-rx',box).value);if(!(v<0)){toast('Escribí la potencia en dBm, en negativo (por ejemplo -22,5)','bad');return;}
      try{const r=await NET.api('POST','/api/olt/medida',{cid:id,rx:v});toast(r.mala?'Guardada: mala señal, se avisa a todos':'Medida guardada');SENAL.t=0;closeModal();}
      catch(err){toast(err.message,'bad');}
    });
  }});
}
