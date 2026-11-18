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
VIEWS.senal={
  mount(el){this.el=el;el.innerHTML='<div class="head-row"><h2>Señal de las ONU</h2><button class="btn small" type="button" id="sn-re">Actualizar</button></div><div id="sn-cuerpo" class="muted">Cargando…</div>';$('#sn-re',el).addEventListener('click',()=>this.recargar(true));this.recargar(true);},
  update(){},
  async recargar(f){
    const el=this.el,box=el&&$('#sn-cuerpo',el);if(!box)return;
    try{const d=await senalCargar(f);box.className='';box.innerHTML=this.html(d);this.bind(box,d);}
    catch(err){box.textContent=err.network?'No se pudo conectar con el servidor.':err.message;}
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
