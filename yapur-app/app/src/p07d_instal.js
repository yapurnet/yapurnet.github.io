/* ===== instalaciones por día, semana y mes ===== */
/* Una instalación cuenta el día en que se cerró su orden. Si un cliente pagó la instalación pero no tiene ninguna orden de instalación cerrada
   (la cargó la oficina a mano), también cuenta, el día del primer cobro, y se marca «Sin orden». */
const INST={k:'dia',ref:'',fin:{dia:'',sem:'',mes:''}};   /* k: escala · ref: un día cualquiera del período elegido · fin: último período que muestra el gráfico (uno por escala) */
const INST_N={dia:14,sem:8,mes:12};
const INST_DIAS=['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const INST_MESES=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const INST_ESC=[['dia','Día'],['sem','Semana'],['mes','Mes']];
const INST_ANT={dia:'Día anterior',sem:'Semana anterior',mes:'Mes anterior'};
const INST_QUE={dia:'el día anterior',sem:'la semana anterior',mes:'el mes anterior'};
const INST_HOY={dia:'Hoy',sem:'Esta semana',mes:'Este mes'};
const INST_AYER={dia:'Ayer',sem:'La semana pasada',mes:'El mes pasado'};

/* ----- fechas (YYYY-MM-DD, la semana empieza el lunes) ----- */
const inUTC=d=>{const [y,m,dd]=d.split('-').map(Number);return new Date(Date.UTC(y,m-1,dd));};
const inStr=t=>t.getUTCFullYear()+'-'+pad(t.getUTCMonth()+1)+'-'+pad(t.getUTCDate());
const inAddDays=(d,n)=>{const t=inUTC(d);t.setUTCDate(t.getUTCDate()+n);return inStr(t);};
const inLunes=d=>inAddDays(d,-((inUTC(d).getUTCDay()+6)%7));
const inInicio=(k,d)=>k==='mes'?d.slice(0,7)+'-01':k==='sem'?inLunes(d):d;
const inFin=(k,d)=>k==='mes'?inAddDays(addMonths(d.slice(0,7),1)+'-01',-1):k==='sem'?inAddDays(inLunes(d),6):d;
const inMover=(k,d,n)=>k==='mes'?addMonths(d.slice(0,7),n)+'-01':k==='sem'?inAddDays(inLunes(d),7*n):inAddDays(d,n);
const inDiaTxt=(d,conAnio)=>Number(d.slice(8))+' de '+INST_MESES[Number(d.slice(5,7))-1]+(conAnio?' de '+d.slice(0,4):'');
function instTitulo(k,d,hoy){
  const a=inInicio(k,d),b=inFin(k,d),anio=a.slice(0,4)!==hoy.slice(0,4)||b.slice(0,4)!==hoy.slice(0,4);
  if(k==='mes')return monthLabel(a.slice(0,7));
  if(k==='dia'){const n=INST_DIAS[inUTC(a).getUTCDay()];return n.charAt(0).toUpperCase()+n.slice(1)+' '+inDiaTxt(a,anio);}
  return 'Semana del '+(a.slice(5,7)===b.slice(5,7)?Number(a.slice(8)):inDiaTxt(a,false))+' al '+inDiaTxt(b,anio);
}
function instRel(k,d,hoy){const a=inInicio(k,d),cur=inInicio(k,hoy);return a===cur?INST_HOY[k]:a===inMover(k,cur,-1)?INST_AYER[k]:'';}
function instEtiq(k,b){
  if(k==='mes')return monthShort(b.slice(0,7));
  if(k==='sem')return b.slice(8)+'/'+b.slice(5,7);
  return ['D','L','M','M','J','V','S'][inUTC(b).getUTCDay()]+'<br>'+Number(b.slice(8));
}

/* ----- los datos ----- */
function instEventos(){
  const out=[],conOrden=new Set();
  for(const o of S.ordenes.values()){
    if(o.tipo!=='instalacion'||o.estado!=='hecha')continue;
    const f=(o.cierre||'').slice(0,10)||o.fecha||o.creado||'';
    if(!/^\d{4}-\d{2}-\d{2}$/.test(f))continue;
    conOrden.add(o.clientId);
    out.push({id:o.id,f,h:(o.cierre||'').slice(11,16),cid:o.clientId,tec:o.tecnico||'',tecN:tecLabel(o),sc:ordSinCobrar(o),sinOrden:false});
  }
  /* cobros de instalación de clientes que no tienen ninguna orden de instalación cerrada (uno por cliente: el primero) */
  const pg=new Map();
  for(const p of S.pagos.values()){
    if(p.anulado||p.concepto!=='instalacion'||!p.fecha||conOrden.has(p.c))continue;
    const a=pg.get(p.c);
    if(!a||p.fecha<a.fecha||(p.fecha===a.fecha&&(p.hora||'')<(a.hora||'')))pg.set(p.c,p);
  }
  for(const [cid,p] of pg){const t=tecById(p.por);out.push({id:'p'+cid,f:p.fecha,h:p.hora||'',cid,tec:t?t.id:'',tecN:t?t.nombre:'',sc:false,sinOrden:true});}
  return out;
}
function instCalc(k,ref,hoy){
  const ev=instEventos(),cur=inInicio(k,hoy);
  ref=inInicio(k,ref||hoy);if(ref>cur)ref=cur;
  const d1=ref,d2=inFin(k,ref),cnt={};
  for(const e of ev){const b=inInicio(k,e.f);cnt[b]=(cnt[b]||0)+1;}
  const sel=ev.filter(e=>e.f>=d1&&e.f<=d2).sort((a,b)=>b.f.localeCompare(a.f)||(b.h||'').localeCompare(a.h||''));
  let sinHacer=0;   /* órdenes de instalación programadas en el período que siguen abiertas */
  for(const o of S.ordenes.values()){if(o.tipo!=='instalacion'||!ORD_OPEN(o))continue;const f=o.fecha||o.creado||'';if(f>=d1&&f<=d2)sinHacer++;}
  return {k,ref,d1,d2,cur,cnt,sel,n:sel.length,prev:cnt[inMover(k,ref,-1)]||0,sinHacer,sinCobrar:sel.filter(e=>e.sc).length};
}
function instPorTec(sel){
  const m=new Map();
  for(const e of sel){const k=e.tec||'_',x=m.get(k)||{k,n:0,nombre:''};x.n++;if(!x.nombre)x.nombre=(e.tec&&(tecById(e.tec)||{}).nombre)||e.tecN||'';m.set(k,x);}
  return [...m.values()].map(x=>Object.assign(x,{nombre:x.nombre||'Sin técnico'})).sort((a,b)=>b.n-a.n||a.nombre.localeCompare(b.nombre,'es'));
}
/* para el Resumen: las de hoy y las del mes */
function instResumen(){const hoy=todayStr(),ev=instEventos();return {hoy:ev.filter(e=>e.f===hoy).length,mes:ev.filter(e=>e.f.slice(0,7)===hoy.slice(0,7)).length};}

/* ----- la pantalla ----- */
function instBarras(c,hoy){
  const N=INST_N[c.k];
  let fin=INST.fin[c.k]||c.cur;
  if(c.ref>fin)fin=c.ref;
  if(c.ref<inMover(c.k,fin,-(N-1))){fin=inMover(c.k,c.ref,N-1);if(fin>c.cur)fin=c.cur;}
  INST.fin[c.k]=fin;
  const bs=[];for(let i=N-1;i>=0;i--)bs.push(inMover(c.k,fin,-i));
  const max=Math.max(1,...bs.map(b=>c.cnt[b]||0));
  return `<div class="bars tight" role="group" aria-label="Instalaciones por ${c.k==='dia'?'día':c.k==='sem'?'semana':'mes'}">${bs.map(b=>{const v=c.cnt[b]||0;
    return `<button type="button" class="bar${b===c.ref?' now':''}" data-b="${b}" aria-pressed="${b===c.ref}" aria-label="${esc(instTitulo(c.k,b,hoy)+': '+v+(v===1?' instalación':' instalaciones'))}"><b>${v||''}</b><i style="height:${Math.max(2,Math.round(96*v/max))}px"></i><span>${instEtiq(c.k,b)}</span></button>`;}).join('')}</div>`;
}
function instItem(e){
  const c=S.clientes.get(e.cid),dir=c?(c.dir||'')+(c.loc?', '+c.loc:''):'';
  const quien=e.tec&&(tecById(e.tec)||{}).nombre||e.tecN;
  return `<button class="item" type="button"${c?` data-open-client="${esc(c.id)}"`:' disabled'}><div><div class="t">${esc(c?c.nombre:'Cliente no encontrado')}</div><div class="s muted">${esc(dir)}${dir&&quien?' · ':''}${quien?esc(quien):''}</div></div><div class="side">${e.sc?'<span class="chip warn">Sin cobrar</span>':''}${e.sinOrden?'<span class="chip quiet">Sin orden</span>':''}${e.h?`<span class="small muted tnum">${esc(e.h)}</span>`:''}</div></button>`;
}
VIEWS.instalaciones={
  mount(el){
    el.innerHTML='<div id="in" class="wrap" style="padding:0"></div>';
    const root=$('#in',el);
    root.addEventListener('click',e=>{
      const hoy=todayStr();
      const sg=e.target.closest('[data-k]');if(sg){INST.k=sg.dataset.k;this.update();return;}
      const br=e.target.closest('[data-b]');if(br){INST.ref=br.dataset.b;this.update();return;}
      const nv=e.target.closest('[data-n]');
      if(nv){const k=INST.k,cur=inInicio(k,hoy),ref=inInicio(k,INST.ref||hoy);INST.ref=nv.dataset.n==='hoy'?cur:inMover(k,ref,Number(nv.dataset.n));this.update();return;}
      const oc=e.target.closest('[data-open-client]');if(oc)openClient(oc.dataset.openClient);
    });
    this.update();
  },
  update(){
    const root=$('#in');if(!root)return;
    const hoy=todayStr(),k=INST.k;
    if(!S.loaded.ordenes){root.innerHTML='<div class="empty"><b>Cargando…</b></div>';return;}
    if(INST.ref>hoy)INST.ref=hoy;   /* INST.ref queda como se eligió (por ejemplo, hoy), así al pasar de «Mes» a «Día» se vuelve al mismo día */
    const c=instCalc(k,INST.ref,hoy);
    const rel=instRel(k,c.ref,hoy),dif=c.n-c.prev,esAct=c.ref===c.cur;
    const tecs=instPorTec(c.sel);
    /* la lista, con un renglón por día cuando el período tiene varios */
    let lista='';
    if(!c.n)lista=`<div class="empty"><b>No hubo instalaciones ${k==='dia'?'ese día':k==='sem'?'esa semana':'ese mes'}</b><span>Se anotan el día en que se cierra la orden de instalación.</span></div>`;
    else{
      const porDia={};for(const e of c.sel)porDia[e.f]=(porDia[e.f]||0)+1;
      lista=c.sel.slice(0,200).map((e,i,a)=>(k!=='dia'&&(!i||a[i-1].f!==e.f)?`<div class="in-day">${esc(instTitulo('dia',e.f,hoy))} · ${porDia[e.f]}</div>`:'')+instItem(e)).join('')+(c.n>200?`<div class="hint">Se muestran las primeras 200 de ${c.n}.</div>`:'');
    }
    root.innerHTML=`<div class="head-row"><h2>Instalaciones</h2></div>
      <div class="toolbar"><div class="seg" role="group" aria-label="Ver por">${INST_ESC.map(([x,l])=>`<button type="button" data-k="${x}" aria-pressed="${k===x}">${l}</button>`).join('')}</div></div>
      <div class="card">
        <div class="in-nav"><button class="btn small" type="button" data-n="-1" aria-label="${esc(INST_ANT[k])}">‹</button>
          <div class="tt"><b>${esc(instTitulo(k,c.ref,hoy))}</b>${rel?`<span class="small muted">${esc(rel)}</span>`:''}</div>
          <button class="btn small" type="button" data-n="1" aria-label="Período siguiente"${esAct?' disabled':''}>›</button></div>
        ${esAct?'':'<div class="actions start"><button class="btn small" type="button" data-n="hoy">Volver a '+esc(INST_HOY[k].toLowerCase())+'</button></div>'}
        ${instBarras(c,hoy)}
        <div class="kpis three">
          <div class="kpi"><span class="n">${c.n}</span><span class="l">${c.n===1?'Instalada':'Instaladas'}</span></div>
          <div class="kpi"><span class="n">${c.prev}</span><span class="l">${esc(INST_ANT[k])}</span></div>
          <div class="kpi${c.sinHacer?' bad':''}"><span class="n">${c.sinHacer}</span><span class="l">Sin hacer</span></div></div>
        <div class="hint">${c.n||c.prev?(dif?`${Math.abs(dif)} ${dif>0?'más':'menos'} que ${INST_QUE[k]}.`:`Igual que ${INST_QUE[k]}.`):'Todavía no hay instalaciones para comparar.'} «Sin hacer» son las órdenes de instalación programadas ${k==='dia'?'ese día':k==='sem'?'esa semana':'ese mes'} que siguen abiertas.</div>
        ${c.sinCobrar?`<div class="notice" role="status"><b>${c.sinCobrar===1?'1 instalación todavía sin cobrar':c.sinCobrar+' instalaciones todavía sin cobrar'}.</b> Se cobran desde su orden cerrada o desde la ficha del cliente.</div>`:''}
      </div>
      ${c.n?`<div class="card"><h3>Por técnico</h3><div class="tbl-wrap"><table><thead><tr><th>Técnico</th><th class="right">Instaladas</th></tr></thead><tbody>${tecs.map(t=>`<tr><td>${esc(t.nombre)}</td><td class="right tnum">${t.n}</td></tr>`).join('')}</tbody></table></div></div>`:''}
      <div class="list" id="in-list">${lista}</div>
      <div class="hint">Cuenta las órdenes de instalación cerradas, el día en que se cerraron. También suma las instalaciones cobradas que no tienen orden (marcadas «Sin orden»).</div>`;
  }
};
