/* ===== resumen ===== */
/* clientes: altas y bajas por mes (últimos 6), para ver si la empresa crece o se achica. «Alta» es c.alta (fecha de alta vigente,
   se actualiza en cada reactivación desde «pendiente»); «baja» es c.bajaFecha (fecha en que se dio de baja, quede o no reactivado
   después: la baja fue un hecho real de ese mes igual). */
function clientesEvol(meses){
  const altas={},bajas={};
  for(const c of S.clientes.values()){
    if(/^\d{4}-\d{2}-\d{2}$/.test(c.alta||''))altas[c.alta.slice(0,7)]=(altas[c.alta.slice(0,7)]||0)+1;
    if(/^\d{4}-\d{2}-\d{2}$/.test(c.bajaFecha||''))bajas[c.bajaFecha.slice(0,7)]=(bajas[c.bajaFecha.slice(0,7)]||0)+1;
  }
  return meses.map(m=>({m,altas:altas[m]||0,bajas:bajas[m]||0}));
}
/* órdenes cerradas por técnico en un mes: para ver la carga de trabajo repartida, no solo instalaciones (eso ya lo tiene su propia
   pantalla con el detalle). Incluye a los técnicos con 0 en el mes, para que se note quién no cerró nada. */
function ordenesPorTec(cur){
  const cnt=new Map();
  for(const o of S.ordenes.values()){
    if(o.estado!=='hecha'||!o.tecnico)continue;
    if((o.cierre||'').slice(0,7)!==cur)continue;
    cnt.set(o.tecnico,(cnt.get(o.tecnico)||0)+1);
  }
  return S.ajustes.tecnicos.map(t=>({nombre:t.nombre,n:cnt.get(t.id)||0})).sort((a,b)=>b.n-a.n||a.nombre.localeCompare(b.nombre,'es'));
}
/* «Hoy»: lo primero que ve la oficina al entrar. Qué se cobró, quién tiene trabajo abierto, qué instalaciones esperan que alguien las active y a quién hay que cortar. */
function tableroHoy(today,cd){
  const pagosHoy=[...S.pagos.values()].filter(p=>!p.anulado&&p.fecha===today);
  const cobrado=pagosHoy.reduce((s,p)=>s+(Number(p.monto)||0),0);
  const porTec=new Map();let libres=0,urg=0;
  for(const o of S.ordenes.values()){
    if(!ORD_OPEN(o))continue;
    if(o.prioridad==='urgente')urg++;
    if(!o.tecnico){libres++;continue;}
    const e=porTec.get(o.tecnico)||{n:0,u:0,nombre:(tecById(o.tecnico)||{}).nombre||o.tecNombre||'Técnico'};
    e.n++;if(o.prioridad==='urgente')e.u++;porTec.set(o.tecnico,e);
  }
  const tecs=[...porTec.values()].sort((a,b)=>b.n-a.n||a.nombre.localeCompare(b.nombre,'es'));
  const ahora=Date.now();
  const pend=[...S.clientes.values()].filter(c=>c.estado==='pendiente').map(c=>({c,dias:c.creado?Math.max(0,Math.floor((ahora-c.creado)/864e5)):0})).sort((a,b)=>b.dias-a.dias||norm(a.c.nombre).localeCompare(norm(b.c.nombre)));
  const diasTxt=d=>d<=0?'de hoy':d===1?'hace 1 día':'hace '+d+' días';
  const cortar=cd.cortar;
  return `<div class="card" id="rs-hoy"><div class="head-row"><h3>Hoy</h3><span class="small muted">${esc(today.split('-').reverse().join('/'))}</span></div>
    <div class="kpis three"><div class="kpi"><span class="n">${esc(fmtMoney(cobrado))}</span><span class="l">Cobrado hoy · ${pagosHoy.length} ${pagosHoy.length===1?'cobro':'cobros'}</span></div>
      <div class="kpi tap" data-go="ordenes" role="button" tabindex="0"><span class="n">${tecs.reduce((s,t)=>s+t.n,0)+libres}</span><span class="l">Órdenes abiertas${urg?' · '+urg+' urgentes':''}</span></div>
      <div class="kpi${cortar.length?' bad':''}${can('caja')?' tap':''}"${can('caja')?' data-go="cobranzas" data-sub="cortes" role="button" tabindex="0"':''}><span class="n">${cortar.length}</span><span class="l">Para cortar</span></div></div>
    <div class="hoy-sec"><b>Órdenes abiertas por técnico</b>${tecs.length||libres?`<div class="list">${tecs.map(t=>`<div class="per"><span class="grow">${esc(t.nombre)}</span><span class="chip">${t.n}${t.u?' · '+t.u+' urgente'+(t.u===1?'':'s'):''}</span></div>`).join('')}${libres?`<div class="per"><span class="grow muted">Sin técnico asignado</span><span class="chip bad">${libres}</span></div>`:''}</div>`:'<div class="hint">No hay órdenes abiertas.</div>'}</div>
    <div class="hoy-sec"><b>Instalaciones por activar</b>${pend.length?`<div class="list">${pend.slice(0,5).map(({c,dias})=>`<button class="item" type="button" data-open-client="${esc(c.id)}"><div><div class="t">${esc(c.nombre||'Sin nombre')}</div><div class="s">${esc(c.dir||'')}</div></div><div class="small muted">${diasTxt(dias)}</div></button>`).join('')}</div>${pend.length>5?`<div class="hint">y ${pend.length-5} más en <button class="btn small" type="button" data-go="clientes">Clientes</button></div>`:''}`:'<div class="hint">No hay clientes esperando activación.</div>'}</div>
    ${cortar.length?`<div class="hoy-sec"><b>Para cortar</b><div class="list">${cortar.slice(0,5).map(({c,s})=>`<button class="item" type="button" data-open-client="${esc(c.id)}"><div><div class="t">${esc(c.nombre)}</div><div class="s">${esc(c.dir||'')}</div></div><div class="small muted">vencido desde ${esc(s.desde||'')}</div></button>`).join('')}</div>${cortar.length>5?`<div class="hint">y ${cortar.length-5} más${can('caja')?' en <button class="btn small" type="button" data-go="cobranzas" data-sub="cortes">Cobranzas</button>':''}</div>`:''}</div>`:''}
  </div>`;
}
VIEWS.resumen={
  mount(el){el.innerHTML='<div id="rs" class="wrap" style="padding:0"></div>';this.update();},
  update(){
    const root=$('#rs');if(!root)return;
    const today=todayStr(),cur=today.slice(0,7);
    let act=0,susp=0,ingreso=0,deuda=0,morosos=0,dant=0,dantN=0;const planCount=new Map(),svCount=new Map(),debtors=[];
    for(const c of S.clientes.values()){
      if(c.estado==='activo'){act++;if(!c.sinCargo)ingreso+=priceOf(c);if(c.planId)planCount.set(c.planId,(planCount.get(c.planId)||0)+1);extrasOf(c).forEach(s=>svCount.set(s.id,(svCount.get(s.id)||0)+1));}
      else if(c.estado==='suspendido')susp++;
      const b=billing(c);if(b.vencidos>0){morosos++;deuda+=b.deuda;debtors.push({c,b});}
      const dr=deudaAntRest(c);if(dr>0){dant+=dr;dantN++;}
    }
    let hoy=0,mes=0;const porMes={};
    for(const p of S.pagos.values()){if(p.anulado)continue;const m=Number(p.monto)||0;if(p.fecha===today)hoy+=m;const ym=p.fecha.slice(0,7);porMes[ym]=(porMes[ym]||0)+m;}
    mes=porMes[cur]||0;
    const meses=[];for(let i=5;i>=0;i--)meses.push(addMonths(cur,-i));
    const max=Math.max(1,...meses.map(m=>porMes[m]||0));
    const open=[...S.ordenes.values()].filter(ORD_OPEN);
    const urg=open.filter(o=>o.prioridad==='urgente').length;
    const ins=can('ordenesTodas')&&S.loaded.ordenes?instResumen():null;
    const evol=veTotales()?clientesEvol(meses):null;
    const maxEv=evol?Math.max(1,...evol.map(e=>Math.max(e.altas,e.bajas))):1;
    const netoEv=evol?evol.reduce((s,e)=>s+e.altas-e.bajas,0):0;
    const tecs=can('ordenesTodas')&&S.loaded.ordenes&&S.ajustes.tecnicos.length?ordenesPorTec(cur):null;
    const maxTec=tecs?Math.max(1,...tecs.map(t=>t.n)):1;
    debtors.sort((a,b)=>b.b.deuda-a.b.deuda);
    const cd=cortesData();
    const steps=[['Crear los planes de velocidad',S.planes.size>0,'planes'],['Crear los perfiles del equipo',S.ajustes.perfiles.length>0,'ajustes'],['Cargar o importar los clientes',S.clientes.size>0,'clientes']];
    const setup=steps.some(s=>!s[1])?`<div class="card"><h2>Para empezar</h2><div class="list">${steps.map(([l,d,t],i)=>`<div class="per"><span class="grow"><b>${i+1}. ${l}</b></span>${d?'<span class="chip ok">Hecho</span>':(t==='planes'||t==='ajustes')&&!isAdmin()?'<span class="chip">Lo hace el administrador</span>':`<button class="btn small primary" type="button" data-go="${t}">Ir</button>`}</div>`).join('')}</div></div>`:'';
    root.innerHTML=`${setup}${veTotales()&&can('ordenesTodas')&&S.loaded.ordenes?tableroHoy(today,cd):''}<div class="kpis">
      <div class="kpi"><span class="n">${act}</span><span class="l">Clientes activos${susp?' · '+susp+' suspendidos':''}</span></div>
      <div class="kpi"><span class="n">${fmtMoney(hoy)}</span><span class="l">Cobrado hoy</span></div>
      <div class="kpi"><span class="n">${fmtMoney(mes)}</span><span class="l">Cobrado en ${esc(monthLabel(cur))}</span></div>
      <div class="kpi bad"><span class="n">${fmtMoney(deuda)}</span><span class="l">Deuda vencida · ${morosos} ${morosos===1?'cliente':'clientes'}</span></div>
      ${dantN&&can('caja')?`<div class="kpi tap" data-go="cobranzas" data-sub="dant" role="button" tabindex="0"><span class="n">${fmtMoney(dant)}</span><span class="l">Deuda anterior · ${dantN} ${dantN===1?'cliente':'clientes'}</span></div>`:''}
      <div class="kpi"><span class="n">${fmtMoney(ingreso)}</span><span class="l">Facturación mensual de activos</span></div>
      <div class="kpi"><span class="n">${open.length}</span><span class="l">Órdenes abiertas${urg?' · '+urg+' urgentes':''}</span></div>
      ${ins?`<div class="kpi tap" data-go="instalaciones" role="button" tabindex="0"><span class="n">${ins.mes}</span><span class="l">Instalaciones en ${esc(monthLabel(cur))} · hoy ${ins.hoy}</span></div>`:''}</div>
    <div class="card"><div class="head-row"><h3>Cortes y promesas</h3>${can('caja')?'<button class="btn small" type="button" data-go="cobranzas" data-sub="cortes">Ver lista</button>':''}</div>
      <div class="kpis three"><div class="kpi${cd.cortar.length?' bad':''}"><span class="n">${cd.cortar.length}</span><span class="l">Para cortar</span></div><div class="kpi"><span class="n">${cd.reconectar.length}</span><span class="l">Para reconectar</span></div><div class="kpi"><span class="n">${cd.promesas.length}</span><span class="l">Promesas vigentes</span></div></div>
      <div class="list" style="margin-top:8px">${calendarHTML()}</div></div>
    <div class="card"><h3>Cobrado por mes</h3><div class="bars">${meses.map(m=>{const v=porMes[m]||0;return `<div class="bar${m===cur?' now':''}"><b>${v?esc(fmtMoney(v).replace(/\s/g,'')):''}</b><i style="height:${Math.max(2,Math.round(96*v/max))}px"></i><span>${esc(monthShort(m))}</span></div>`;}).join('')}</div></div>
    ${evol?`<div class="card"><div class="head-row"><h3>Clientes: altas y bajas</h3><div class="small muted"><span class="dot ok"></span>Altas <span class="dot bad" style="margin-left:8px"></span>Bajas</div></div>
      <div class="bars2">${evol.map(e=>`<div class="grp${e.m===cur?' now':''}" title="${esc(monthLabel(e.m))}: ${e.altas} ${e.altas===1?'alta':'altas'}, ${e.bajas} ${e.bajas===1?'baja':'bajas'}"><div class="pair"><i class="alta" style="height:${Math.max(2,Math.round(96*e.altas/maxEv))}px"></i><i class="baja" style="height:${Math.max(2,Math.round(96*e.bajas/maxEv))}px"></i></div><span>${esc(monthShort(e.m))}</span></div>`).join('')}</div>
      <div class="hint">${netoEv>0?`+${netoEv} clientes netos`:netoEv<0?`${netoEv} clientes netos`:'Sin cambio neto'} en los últimos 6 meses.</div></div>`:''}
    ${tecs?`<div class="card"><div class="head-row"><h3>Órdenes cerradas por técnico</h3><span class="small muted">${esc(monthLabel(cur))}</span></div>
      <div class="hbars">${tecs.map(t=>`<div class="hbar-row"><span class="hbar-lbl">${esc(t.nombre)}</span><div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(t.n?3:0,Math.round(100*t.n/maxTec))}%"></div></div><span class="hbar-val">${t.n}</span></div>`).join('')}</div></div>`:''}
    <div class="card"><div class="head-row"><h3>Mayores deudas</h3><button class="btn small" type="button" data-go="cobranzas" data-sub="morosos">Ver todos</button></div>
      ${debtors.length?`<div class="list">${debtors.slice(0,5).map(({c,b})=>`<button class="item" type="button" data-open-client="${esc(c.id)}"><div><div class="t">${esc(c.nombre)}</div><div class="s">${can('telefono')?esc(c.tel||''):''}</div></div><div class="side"><b class="tnum">${fmtMoney(b.deuda)}</b><span class="chip bad">${b.vencidos} ${b.vencidos===1?'mes':'meses'}</span></div></button>`).join('')}</div>`:'<div class="hint">No hay clientes con deuda vencida.</div>'}</div>
    ${S.planes.size?`<div class="card"><h3>Clientes por plan</h3><div class="tbl-wrap"><table><thead><tr><th>Plan</th><th class="right">Activos</th><th class="right">Precio</th><th class="right">Por mes</th></tr></thead><tbody>${[...S.planes.values()].sort((a,b)=>a.bajada-b.bajada).map(p=>{const n=planCount.get(p.id)||0;return `<tr><td>${esc(p.nombre)} <span class="muted small mono">${esc(p.bajada)}/${esc(p.subida)}</span></td><td class="right tnum">${n}</td><td class="right tnum">${fmtMoney(planNow(p))}</td><td class="right tnum">${fmtMoney(n*planNow(p))}</td></tr>`;}).join('')}</tbody></table></div></div>`:''}
    ${serviciosList().length?`<div class="card"><h3>Servicios adicionales</h3><div class="tbl-wrap"><table><thead><tr><th>Servicio</th><th class="right">Activos</th><th class="right">Precio</th><th class="right">Por mes</th></tr></thead><tbody>${serviciosList().map(s=>{const n=svCount.get(s.id)||0;return `<tr><td>${esc(s.nombre)}${s.activo===false?' <span class="muted small">(ya no se ofrece)</span>':''}</td><td class="right tnum">${n}</td><td class="right tnum">${fmtMoney(planNow(s))}</td><td class="right tnum">${fmtMoney(n*planNow(s))}</td></tr>`;}).join('')}</tbody></table></div></div>`:''}`;
  }
};

