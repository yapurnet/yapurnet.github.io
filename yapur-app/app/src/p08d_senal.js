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
    const viejo=d.visto&&Date.now()-d.visto>3*36e5;
    let h=`<div class="card"><p>${d.visto?`Última lectura de la OLT: <b>${senalHace(d.visto)}</b>. ${d.total} ONU leídas.`:'Todavía no llegó ninguna lectura de la OLT.'}</p>
      ${viejo?'<p class="chip bad">Hace más de 3 horas que no llega ninguna lectura: revisá el lector.</p>':''}
      <p class="small muted">Se avisa cuando una ONU recibe <b>peor que ${d.umbral} dBm</b> (por ejemplo -29). Una potencia mejor, como -20, está bien.${d.sinCliente?` ${d.sinCliente} ONU leídas no coinciden con ningún cliente (revisá la serie o MAC cargada en su ficha).`:''}</p></div>`;
    if(d.visto){
      h+=d.lista.length?`<h3>Con mala señal (${d.lista.length})</h3><div class="list">${d.lista.map(o=>`<div class="card sn-row" data-cid="${esc(o.cid||'')}"><div class="between"><b>${esc(o.cn||'ONU sin cliente')}</b><span class="chip bad">${o.rx} dBm</span></div><div class="small muted">${o.cd?esc(o.cd)+' · ':''}${o.port?'Puerto '+esc(o.port)+' · ':''}<span class="mono">${esc(o.k)}</span>${o.est?' · '+esc(o.est):''}</div></div>`).join('')}</div>`
        :'<div class="card"><p>✔ Ninguna ONU está por debajo del límite.</p></div>';
    }
    if(isAdmin())h+=`<div class="card"><h3>Configuración (administrador)</h3>
      ${F('Límite de alerta (dBm)','sn-um',`<input id="sn-um" inputmode="decimal" value="${d.umbral}">`,'Se avisa cuando la potencia recibida es peor (más negativa) que este valor.')}
      <div class="actions start"><button class="btn" type="button" id="sn-um-go">Guardar límite</button><button class="btn" type="button" id="sn-tok">${d.tok?'Generar otro token del lector':'Generar token del lector'}</button></div>
      <p class="small muted">El lector es un script dentro de tu red que consulta la OLT y manda las lecturas a <span class="mono">/api/olt/ingest</span> con este token (solo puede enviar, no leer nada). Al generar uno nuevo, el anterior deja de servir.</p><div id="sn-tokbox"></div></div>`;
    return h;
  },
  bind(box,d){
    $$('.sn-row',box).forEach(r=>r.addEventListener('click',()=>{const id=r.dataset.cid;if(id&&S.clientes.has(id))openClient(id);}));
    const um=$('#sn-um-go',box);if(um)um.addEventListener('click',async()=>{try{await NET.api('PUT','/api/olt/config',{umbral:num($('#sn-um',box).value)});toast('Límite guardado');this.recargar(true);}catch(err){toast(err.message,'bad');}});
    const tk=$('#sn-tok',box);if(tk)tk.addEventListener('click',async()=>{if(d.tok&&!confirm('El token anterior dejará de servir. ¿Generar uno nuevo?'))return;try{const r=await NET.api('POST','/api/olt/token',{});$('#sn-tokbox',box).innerHTML=`<p class="small">Copialo ahora, no se vuelve a mostrar:</p><p class="mono" style="word-break:break-all">${esc(r.token)}</p><button class="btn small" type="button" id="sn-cp">Copiar</button>`;$('#sn-cp',box).addEventListener('click',()=>copyText(r.token,'Token'));}catch(err){toast(err.message,'bad');}});
  }
};
