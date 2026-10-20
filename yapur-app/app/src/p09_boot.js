/* ===== resumen ===== */
VIEWS.resumen={
  mount(el){el.innerHTML='<div id="rs" class="wrap" style="padding:0"></div>';this.update();},
  update(){
    const root=$('#rs');if(!root)return;
    const today=todayStr(),cur=today.slice(0,7);
    let act=0,susp=0,ingreso=0,deuda=0,morosos=0;const planCount=new Map(),svCount=new Map(),debtors=[];
    for(const c of S.clientes.values()){
      if(c.estado==='activo'){act++;ingreso+=priceOf(c);if(c.planId)planCount.set(c.planId,(planCount.get(c.planId)||0)+1);extrasOf(c).forEach(s=>svCount.set(s.id,(svCount.get(s.id)||0)+1));}
      else if(c.estado==='suspendido')susp++;
      const b=billing(c);if(b.vencidos>0){morosos++;deuda+=b.deuda;debtors.push({c,b});}
    }
    let hoy=0,mes=0;const porMes={};
    for(const p of S.pagos.values()){if(p.anulado)continue;const m=Number(p.monto)||0;if(p.fecha===today)hoy+=m;const ym=p.fecha.slice(0,7);porMes[ym]=(porMes[ym]||0)+m;}
    mes=porMes[cur]||0;
    const meses=[];for(let i=5;i>=0;i--)meses.push(addMonths(cur,-i));
    const max=Math.max(1,...meses.map(m=>porMes[m]||0));
    const open=[...S.ordenes.values()].filter(ORD_OPEN);
    const urg=open.filter(o=>o.prioridad==='urgente').length;
    debtors.sort((a,b)=>b.b.deuda-a.b.deuda);
    const cd=cortesData();
    const steps=[['Crear los planes de velocidad',S.planes.size>0,'planes'],['Crear los perfiles del equipo',S.ajustes.perfiles.length>0,'ajustes'],['Cargar o importar los clientes',S.clientes.size>0,'clientes']];
    const setup=steps.some(s=>!s[1])?`<div class="card"><h2>Para empezar</h2><div class="list">${steps.map(([l,d,t],i)=>`<div class="per"><span class="grow"><b>${i+1}. ${l}</b></span>${d?'<span class="chip ok">Hecho</span>':(t==='planes'||t==='ajustes')&&!isAdmin()?'<span class="chip">Lo hace el administrador</span>':`<button class="btn small primary" type="button" data-go="${t}">Ir</button>`}</div>`).join('')}</div></div>`:'';
    root.innerHTML=`${setup}<div class="kpis">
      <div class="kpi"><span class="n">${act}</span><span class="l">Clientes activos${susp?' · '+susp+' suspendidos':''}</span></div>
      <div class="kpi"><span class="n">${fmtMoney(hoy)}</span><span class="l">Cobrado hoy</span></div>
      <div class="kpi"><span class="n">${fmtMoney(mes)}</span><span class="l">Cobrado en ${esc(monthLabel(cur))}</span></div>
      <div class="kpi bad"><span class="n">${fmtMoney(deuda)}</span><span class="l">Deuda vencida · ${morosos} ${morosos===1?'cliente':'clientes'}</span></div>
      <div class="kpi"><span class="n">${fmtMoney(ingreso)}</span><span class="l">Facturación mensual de activos</span></div>
      <div class="kpi"><span class="n">${open.length}</span><span class="l">Órdenes abiertas${urg?' · '+urg+' urgentes':''}</span></div></div>
    <div class="card"><div class="head-row"><h3>Cortes y promesas</h3>${can('caja')?'<button class="btn small" type="button" data-go="cobranzas" data-sub="cortes">Ver lista</button>':''}</div>
      <div class="kpis"><div class="kpi${cd.cortar.length?' bad':''}"><span class="n">${cd.cortar.length}</span><span class="l">Para cortar</span></div><div class="kpi"><span class="n">${cd.reconectar.length}</span><span class="l">Para reconectar</span></div><div class="kpi"><span class="n">${cd.promesas.length}</span><span class="l">Promesas vigentes</span></div></div>
      <div class="list" style="margin-top:8px">${calendarHTML()}</div></div>
    <div class="card"><h3>Cobrado por mes</h3><div class="bars">${meses.map(m=>{const v=porMes[m]||0;return `<div class="bar${m===cur?' now':''}"><b>${v?esc(fmtMoney(v).replace(/\s/g,'')):''}</b><i style="height:${Math.max(2,Math.round(96*v/max))}px"></i><span>${esc(monthShort(m))}</span></div>`;}).join('')}</div></div>
    <div class="card"><div class="head-row"><h3>Mayores deudas</h3><button class="btn small" type="button" data-go="cobranzas" data-sub="morosos">Ver todos</button></div>
      ${debtors.length?`<div class="list">${debtors.slice(0,5).map(({c,b})=>`<button class="item" type="button" data-open-client="${esc(c.id)}"><div><div class="t">${esc(c.nombre)}</div><div class="s">${can('telefono')?esc(c.tel||''):''}</div></div><div class="side"><b class="tnum">${fmtMoney(b.deuda)}</b><span class="chip bad">${b.vencidos} ${b.vencidos===1?'mes':'meses'}</span></div></button>`).join('')}</div>`:'<div class="hint">No hay clientes con deuda vencida.</div>'}</div>
    ${S.planes.size?`<div class="card"><h3>Clientes por plan</h3><div class="tbl-wrap"><table><thead><tr><th>Plan</th><th class="right">Activos</th><th class="right">Precio</th><th class="right">Por mes</th></tr></thead><tbody>${[...S.planes.values()].sort((a,b)=>a.bajada-b.bajada).map(p=>{const n=planCount.get(p.id)||0;return `<tr><td>${esc(p.nombre)} <span class="muted small mono">${esc(p.bajada)}/${esc(p.subida)}</span></td><td class="right tnum">${n}</td><td class="right tnum">${fmtMoney(p.precio)}</td><td class="right tnum">${fmtMoney(n*(Number(p.precio)||0))}</td></tr>`;}).join('')}</tbody></table></div></div>`:''}
    ${serviciosList().length?`<div class="card"><h3>Servicios adicionales</h3><div class="tbl-wrap"><table><thead><tr><th>Servicio</th><th class="right">Activos</th><th class="right">Precio</th><th class="right">Por mes</th></tr></thead><tbody>${serviciosList().map(s=>{const n=svCount.get(s.id)||0;return `<tr><td>${esc(s.nombre)}${s.activo===false?' <span class="muted small">(ya no se ofrece)</span>':''}</td><td class="right tnum">${n}</td><td class="right tnum">${fmtMoney(s.precio)}</td><td class="right tnum">${fmtMoney(n*(Number(s.precio)||0))}</td></tr>`;}).join('')}</tbody></table></div></div>`:''}`;
  }
};

