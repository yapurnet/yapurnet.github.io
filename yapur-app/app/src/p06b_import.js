/* ===== importar y exportar CSV ===== */
function parseCsv(text){
  text=text.replace(/^﻿/,'');
  const first=text.split(/\r?\n/,1)[0]||'';
  const delim=first.split(';').length>first.split(',').length?';':(first.includes('\t')?'\t':',');
  const rows=[];let row=[],cell='',q=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(q){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++;}else q=false;}else cell+=ch;}
    else if(ch==='"')q=true;
    else if(ch===delim){row.push(cell);cell='';}
    else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);cell='';if(row.some(c=>c.trim()!==''))rows.push(row);row=[];}
    else cell+=ch;
  }
  row.push(cell);if(row.some(c=>c.trim()!==''))rows.push(row);
  return rows;
}
const HSYN={
  codigo:['codigo','cod','nro cliente','n cliente','numero de cliente','n de cliente','nro','id'],
  nombre:['nombre','cliente','nombre y apellido','apellido y nombre','razon social','titular'],
  dni:['dni','documento','cuit','cuil'],
  tel:['telefono','tel','celular','whatsapp','movil','telefono 1'],
  tel2:['telefono 2','tel 2','otro telefono','celular 2','telefono2'],
  dir:['direccion','domicilio','calle','direccion y numero'],
  loc:['localidad','barrio','ciudad','zona'],
  ref:['referencia','referencias','como llegar'],
  plan:['plan','servicio','abono'],
  vel:['velocidad','vel','mbps','mb','megas','velocidad mbps'],
  desde:['cobrar desde','desde','facturar desde','facturacion desde'],
  tec:['tecnologia','tipo','medio'],
  usuario:['usuario','pppoe','user','usuario pppoe'],
  servicios:['servicios','servicios adicionales','adicionales','adicional','extras'],
  ip:['ip','direccion ip','ip cliente','target','ip del cliente'],
  nodo:['nodo','torre','ap'],
  equipo:['equipo','onu','mac','serie','serial'],
  lat:['latitud','lat'],lng:['longitud','lng','lon','long'],geo:['coordenadas','ubicacion','gps','mapa'],
  alta:['alta','fecha de alta','fecha alta','instalacion','fecha de instalacion'],
  estado:['estado','situacion'],
  precio:['precio','importe','monto','valor','precio especial'],
  ciclo:['ciclo','ciclo de cobro','ciclo de facturacion','ciclo facturacion','facturacion'],
  notas:['notas','observaciones','obs','comentarios']
};
const HREV={};for(const f in HSYN)HSYN[f].forEach(s=>{HREV[s]=f;});
const IMP_COLS=['codigo','nombre','dni','telefono','telefono 2','direccion','localidad','referencia','plan','velocidad','servicios','tecnologia','usuario','ip','nodo','equipo','latitud','longitud','estado','fecha de alta','cobrar desde','precio especial','ciclo','notas'];
function parseCiclo(v,def){
  const t=norm(v).trim();if(!t)return def;
  if(/13\s*(al|a|-)\s*20|\b20\b|\b23\b|\b2\b|dos|segund/.test(t))return 2;
  if(/\b1\b|uno|primer|1\s*(al|a|-)\s*10|\b10\b/.test(t))return 1;
  return def;
}
const parseDateAny=s=>{s=String(s||'').trim();let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);if(m)return m[1]+'-'+pad(m[2])+'-'+pad(m[3]);m=s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);return m?m[3]+'-'+pad(m[2])+'-'+pad(m[1]):'';};

/* "Multimedia + Multimedia Net" → ids de los servicios; lo que no existe va a `falta` */
function parseServicios(txt,falta){
  const t=String(txt||'').trim();if(!t)return [];
  const key=x=>norm(x).replace(/[_\-]+/g,' ').replace(/\s+/g,' ').trim();
  const ids=[];
  t.split(/\s*(?:[+;,\/|]|\sy\s)\s*/i).map(x=>x.trim()).filter(Boolean).forEach(tok=>{
    const s=serviciosList().find(x=>key(x.nombre)===key(tok));
    if(s){if(!ids.includes(s.id))ids.push(s.id);}else falta.add(tok);
  });
  return ids;
}
/* "2026-11", "11/2026" o una fecha completa → "2026-11" ('' si no se entiende) */
function parseMes(v){
  const t=String(v||'').trim();let m=t.match(/^(\d{4})-(\d{1,2})/);if(m&&+m[2]>=1&&+m[2]<=12)return m[1]+'-'+pad(m[2]);
  m=t.match(/^(?:\d{1,2}[\/.-])?(\d{1,2})[\/.-](\d{4})$/);if(m&&+m[1]>=1&&+m[1]<=12)return m[2]+'-'+pad(m[1]);
  return '';
}
/* "Pérez, Juan (casa)" y "juan perez casa" dan la misma clave: se comparan por palabras, sin importar el orden */
const nameKey=n=>norm(n).replace(/[^a-z0-9]+/g,' ').trim().split(' ').filter(Boolean).sort().join(' ');
/* plan cuya velocidad de bajada coincide con la del archivo (2.5, 5, 10…) */
function planBySpeed(v){
  const n=num(String(v||'').replace(/mb(ps|its)?/i,''));if(n===null||n<=0)return null;
  const l=[...S.planes.values()].filter(p=>Number(p.bajada)===n).sort((a,b)=>norm(a.nombre).localeCompare(norm(b.nombre)));
  return l[0]||null;
}
/* Cliente ya cargado en modo «actualizar»: plan, servicios y precio nuevos. Lo anterior queda como vigencia hasta el mes previo a `eff`,
   así los meses viejos (y la deuda anterior) siguen con el precio que tenían. n = {planId?, extras?, precio?} (lo que no viene no se toca). */
function actualizarPatch(ex,n,eff){
  const before={planId:ex.planId||null,extras:Array.isArray(ex.extras)?ex.extras:[],precio:hasNum(ex.precio)?Number(ex.precio):null};
  const after={planId:n.planId!==undefined?n.planId:before.planId,extras:n.extras!==undefined?n.extras:before.extras,precio:n.precio!==undefined?n.precio:before.precio};
  if(after.planId===before.planId&&sameExtras(after.extras,before.extras)&&after.precio===before.precio)return null;
  const prev=addMonths(eff,-1),hp=Array.isArray(ex.hp)?ex.hp:[],patch={planId:after.planId,extras:after.extras,precio:after.precio};
  if(!(hp.length&&hp[hp.length-1].h>=prev))patch.hp=hp.concat([{h:prev,planId:before.planId,precio:before.precio,extras:before.extras}]);
  return patch;
}
/* opts.existentes: 'actualizar' → plan, servicios y precio del archivo (rigen desde opts.vigencia) · 'completar' → los que ya existen (mismo nombre) reciben solo los datos que les faltan · otro valor → se cuentan y se dejan como están */
function analyzeImport(rows,opts){
  const head=rows[0].map(h=>HREV[norm(h).replace(/[^a-z0-9]+/g,' ').trim()]||null);
  const idx={};head.forEach((f,i)=>{if(f&&!(f in idx))idx[f]=i;});
  const used=new Set(S.clientes.size?[...S.clientes.values()].map(c=>c.codigo).filter(Boolean):[]);
  const byKey=new Map();
  if(opts.existentes){for(const c of S.clientes.values()){const k=nameKey(c.nombre);if(k)byKey.set(k,byKey.has(k)?null:c);}}
  const taken=new Set();
  const out={recs:[],upd:[],act:{n:0,igual:0,porPlan:new Map(),conServ:0},sinMatch:0,existen:0,sinNombre:0,dup:0,planesFalta:new Set(),velFalta:new Map(),serviciosFalta:new Set(),cols:Object.keys(idx),sinGeo:0};
  for(let i=1;i<rows.length;i++){
    const r=rows[i],g=f=>idx[f]!==undefined?String(r[idx[f]]==null?'':r[idx[f]]).trim():'';
    const nombre=g('nombre');if(!nombre){out.sinNombre++;continue;}
    const cod=g('codigo');
    if(cod&&used.has(cod)){out.dup++;continue;}
    const pk=norm(g('plan'));let plan=null;
    if(pk){plan=[...S.planes.values()].find(p=>norm(p.nombre)===pk);if(!plan)out.planesFalta.add(g('plan'));}
    else if(g('vel')){plan=planBySpeed(g('vel'));if(!plan){const k=String(num(g('vel')));if(k!=='null')out.velFalta.set(k,(out.velFalta.get(k)||0)+1);}}
    const desde=parseMes(g('desde'))||opts.desde;
    let precio=num(g('precio'));
    if(precio!==null&&plan&&precio===histPrice(plan,desde))precio=null;   /* igual al del plan: no es un precio especial */
    const ex=opts.existentes?byKey.get(nameKey(nombre)):undefined;
    if(ex){   /* ya está cargado: se completa o se deja */
      if(taken.has(ex.id)){out.existen++;continue;}
      taken.add(ex.id);out.existen++;
      if(opts.existentes==='actualizar'){
        const eff=opts.vigencia||addMonths(curMonth(),1),sin=/^(sin plan|ninguno|ninguna)$/.test(pk),n={};
        const svc=idx.servicios!==undefined?g('servicios'):'';
        if(pk||svc){   /* una fila sin plan ni servicios no toca nada */
          if(idx.plan!==undefined&&pk){if(sin)n.planId=null;else if(plan)n.planId=plan.id;}
          if(idx.servicios!==undefined)n.extras=parseServicios(svc,out.serviciosFalta);
          if(idx.precio!==undefined){
            let p=num(g('precio'));const ep=n.planId!==undefined?(n.planId?S.planes.get(n.planId):null):S.planes.get(ex.planId);
            if(p!==null&&ep&&p===histPrice(ep,eff))p=null;
            n.precio=p;
          }
          const patch=actualizarPatch(ex,n,eff);
          if(patch){out.act.n++;out.upd.push({id:ex.id,shard:ex._doc||clientShard(ex.id),patch});
            const pl=S.planes.get(patch.planId);const k=pl?pl.nombre:'Sin plan';out.act.porPlan.set(k,(out.act.porPlan.get(k)||0)+1);if(patch.extras.length)out.act.conServ++;}
          else out.act.igual++;
        }
      }else if(opts.existentes==='completar'){
        const patch={},fill=(k,v)=>{if(v!==''&&v!=null&&(ex[k]==null||ex[k]===''))patch[k]=v;};
        fill('dni',g('dni'));fill('tel',g('tel'));fill('tel2',g('tel2'));fill('dir',g('dir'));fill('loc',g('loc'));fill('ref',g('ref'));
        fill('usuario',g('usuario'));fill('ip',g('ip'));fill('nodo',g('nodo'));fill('equipo',g('equipo'));fill('notas',g('notas'));
        if(plan){fill('planId',plan.id);
          if(patch.planId&&hasNum(ex.precio)){const hp=Array.isArray(ex.hp)?ex.hp:[],ref=hp.length?addMonths(hp[hp.length-1].h,1):curMonth();
            if(Number(ex.precio)===histPrice(plan,ref))patch.precio=null;}}   /* su precio especial coincide con el del plan: ahora lo da el plan */
        if(precio!==null&&!hasNum(ex.precio))patch.precio=precio;
        const sinPagos=S.loaded.pagos&&!(S.paidIdx.get(ex.id)||new Map()).size;   /* con pagos cargados no se toca desde cuándo se cobra */
        if(sinPagos){if(idx.desde!==undefined&&parseMes(g('desde')))patch.desde=desde;if(idx.ciclo!==undefined&&g('ciclo'))patch.ciclo=parseCiclo(g('ciclo'),cicloOf(ex));}
        if(Object.keys(patch).length)out.upd.push({id:ex.id,shard:ex._doc||clientShard(ex.id),patch});
      }
      continue;
    }
    if(opts.existentes==='actualizar'){out.sinMatch++;continue;}   /* en este modo no se crean clientes: solo se actualizan los que ya están */
    if(cod)used.add(cod);
    const extras=parseServicios(g('servicios'),out.serviciosFalta);
    const tk=norm(g('tec'));
    const tec=/fibra|gpon|ftth/.test(tk)?'fibra':(/wifi|wireless|antena|radio/.test(tk)?'wireless':null);
    const ek=norm(g('estado'));
    const estado=/baja/.test(ek)?'baja':(/susp|corte/.test(ek)?'suspendido':(/pend|instal/.test(ek)?'pendiente':opts.estado));
    let geo=null;
    if(g('lat')&&g('lng'))geo=parseCoords(g('lat').replace(',','.')+', '+g('lng').replace(',','.'));
    else if(g('geo'))geo=parseCoords(g('geo'));
    if(!geo)out.sinGeo++;
    out.recs.push({codigo:cod||'',nombre,dni:g('dni'),tel:g('tel'),tel2:g('tel2'),dir:g('dir'),loc:g('loc'),ref:g('ref'),planId:plan?plan.id:null,extras,tec,usuario:g('usuario'),ip:g('ip'),nodo:g('nodo'),equipo:g('equipo'),
      lat:geo?geo.lat:null,lng:geo?geo.lng:null,estado,alta:parseDateAny(g('alta'))||todayStr(),desde,ciclo:parseCiclo(g('ciclo'),opts.ciclo||1),precio:precio,notas:g('notas'),creado:Date.now(),mod:Date.now()});
  }
  return out;
}
/* guarda los clientes ya analizados, repartidos en sus bloques; avisa el avance */
async function saveImported(recs,prog){
  const groups={};
  recs.forEach((c,i)=>{const id=newId()+i.toString(36);const sh=clientShard(id);(groups[sh]=groups[sh]||{})[id]=c;});
  let done=0;const total=recs.length;
  for(const sh of Object.keys(groups)){await putMany('clientes',sh,groups[sh]);done+=Object.keys(groups[sh]).length;if(prog)prog(done,total);}
}
/* completa los clientes que ya existían: solo los campos del parche, sin tocar el resto */
async function updateImported(upd,prog){
  const groups={};
  upd.forEach(u=>{(groups[u.shard]=groups[u.shard]||{})[u.id]=Object.assign({},u.patch,{mod:Date.now()});});
  let done=0;const total=upd.length;
  for(const sh of Object.keys(groups)){await putMany('clientes',sh,groups[sh]);done+=Object.keys(groups[sh]).length;if(prog)prog(done,total);}
}
/* ===== subir precios en bloque ===== */
/* Calcula qué clientes pasan al precio nuevo desde el mes `desde`. Los meses anteriores conservan su precio (queda guardado como vigencia). */
function bulkPrecios(o){
  const eff=o.desde,prev=addMonths(eff,-1),ex=norm(o.excluir||'').trim();
  const out={cambian:[],bajo:0,nota:0,hist:0,porPrecio:new Map()};
  for(const c of S.clientes.values()){
    if(c.estado!=='activo'&&c.estado!=='suspendido')continue;
    const base=priceBaseAt(c,eff);
    if(!(base>0)||base>o.max||base>=o.nuevo)continue;
    if(base<o.min){out.bajo++;continue;}
    if(ex&&norm(c.notas||'').includes(ex)){out.nota++;continue;}
    const hp=Array.isArray(c.hp)?c.hp:[];
    if(hp.length&&hp[hp.length-1].h>=prev){out.hist++;continue;}   /* ya tiene un cambio de precio en esas fechas: se revisa a mano */
    const plan=S.planes.get(c.planId),precio=plan&&histPrice(plan,eff)===o.nuevo?null:o.nuevo;
    out.cambian.push({id:c.id,shard:c._doc||clientShard(c.id),de:base,patch:{precio,hp:hp.concat([{h:prev,planId:c.planId||null,precio:hasNum(c.precio)?Number(c.precio):null,extras:Array.isArray(c.extras)?c.extras:[]}])}});
    out.porPrecio.set(base,(out.porPrecio.get(base)||0)+1);
  }
  return out;
}
async function applyBulkPrecios(list,prog){
  const groups={};
  list.forEach(u=>{(groups[u.shard]=groups[u.shard]||{})[u.id]=Object.assign({},u.patch,{mod:Date.now()});});
  let done=0;const total=list.length;
  for(const sh of Object.keys(groups)){await putMany('clientes',sh,groups[sh]);done+=Object.keys(groups[sh]).length;if(prog)prog(done,total);}
}
function openPreciosBloque(){
  const cur=curMonth();
  openModal({title:'Subir precios de abonos',wide:true,html:`<p class="muted small">Los clientes cuyo abono esté entre los dos montos pasan al precio nuevo desde el mes que elijas. Los meses anteriores conservan el precio que tenían. Los servicios adicionales no se tocan.</p>
    <div class="grid2">${F('Pagan hasta ($)','pb-max','<input id="pb-max" type="text" inputmode="decimal" value="17.000" autocomplete="off">')}${F('y desde ($)','pb-min','<input id="pb-min" type="text" inputmode="decimal" value="10.000" autocomplete="off">','Por debajo de este monto no se toca (suelen ser solo TV o adicionales).')}</div>
    <div class="grid2">${F('Pasan a ($)','pb-new','<input id="pb-new" type="text" inputmode="decimal" value="18.000" autocomplete="off">')}${F('Desde el mes','pb-mes',`<input id="pb-mes" type="month" min="${cur}" max="${addMonths(cur,3)}" value="${addMonths(cur,1)}">`)}</div>
    ${F('No incluir si las notas dicen','pb-exc','<input id="pb-exc" value="solo tv" autocomplete="off">','Dejalo vacío para no excluir a nadie.')}
    <div id="pb-out"></div>`,
    onMount(el){
      let res=null;
      const val=()=>({max:num($('#pb-max',el).value),min:num($('#pb-min',el).value),nuevo:num($('#pb-new',el).value),desde:$('#pb-mes',el).value,excluir:$('#pb-exc',el).value});
      const show=()=>{
        const o=val(),out=$('#pb-out',el);res=null;
        if(o.max===null||o.min===null||o.nuevo===null||!/^\d{4}-\d{2}$/.test(o.desde)||o.desde<cur){out.innerHTML='<div class="notice bad">Completá los montos y el mes (este mes o uno posterior).</div>';return;}
        if(o.nuevo<=o.max){out.innerHTML='<div class="notice bad">El precio nuevo tiene que ser mayor que el máximo.</div>';return;}
        res=bulkPrecios(o);
        const por=[...res.porPrecio].sort((a,b)=>a[0]-b[0]).map(([p,n])=>fmtMoney(p)+': '+n).join(' · ');
        out.innerHTML=`<div class="card flat"><h3>${res.cambian.length} ${res.cambian.length===1?'cliente pasa':'clientes pasan'} a ${esc(fmtMoney(o.nuevo))} desde ${esc(monthLabel(o.desde))}</h3>
          <dl class="kv">${por?`<dt>Hoy pagan</dt><dd>${esc(por)}</dd>`:''}${res.bajo?`<dt>Por debajo de ${esc(fmtMoney(o.min))}</dt><dd>${res.bajo} no se tocan</dd>`:''}${res.nota?`<dt>Con «${esc(o.excluir.trim())}» en las notas</dt><dd>${res.nota} no se tocan</dd>`:''}${res.hist?`<dt>Con otro cambio de precio en esas fechas</dt><dd>${res.hist} se saltean: revisalos a mano</dd>`:''}</dl>
          <div class="actions"><button class="btn primary" type="button" id="pb-go"${res.cambian.length?'':' disabled'}>Subir ${res.cambian.length}</button></div><div class="hint" id="pb-prog"></div></div>`;
        const go=$('#pb-go',el);
        if(go)go.addEventListener('click',async()=>{
          if(!await askConfirm(`Se sube a ${fmtMoney(o.nuevo)} el abono de ${res.cambian.length} clientes desde ${monthLabel(o.desde)}. Los meses anteriores quedan como estaban. ¿Seguro?`,'Subir precios'))return;
          go.disabled=true;
          try{await applyBulkPrecios(res.cambian,(d,t)=>{const h=$('#pb-prog',el);if(h)h.textContent=`Actualizando… ${d} de ${t}`;});toast(res.cambian.length+' clientes actualizados');closeModal();}
          catch(err){dbError(err);go.disabled=false;const h=$('#pb-prog',el);if(h)h.textContent='No se pudo terminar. Los que ya cambiaron no se repiten: volvé a abrir esto y revisá cuántos faltan.';}
        });
      };
      ['pb-max','pb-min','pb-new','pb-mes','pb-exc'].forEach(i=>$('#'+i,el).addEventListener('input',show));
      show();
    }});
}
/* ===== empezar a cobrar de cero ===== */
const capFirst=s=>String(s).charAt(0).toUpperCase()+String(s).slice(1);
function mesesTxt(l){
  const nm=m=>capFirst(monthLabel(m)),nom=m=>monthLabel(m).split(' de ')[0],y=l[0].slice(0,4),same=l.every(m=>m.slice(0,4)===y);
  if(l.length===1)return nm(l[0]);
  if(l.length<=3)return same?capFirst(l.slice(0,-1).map(m=>nom(m).toLowerCase()).join(', ')+' y '+nom(l[l.length-1]).toLowerCase())+' de '+y:l.map(nm).join(', ');
  return (same?nom(l[0]):nm(l[0]))+' a '+monthLabel(l[l.length-1])+' ('+l.length+' meses)';
}
/* Qué clientes pasan a cobrarse desde el mes `eff`. Lo que debían antes queda como «deuda anterior» (aparte de las mensualidades). */
function bulkCero(eff){
  const out={cambian:[],conDeuda:0,sinDeuda:0,monto:0,yaDesde:0,omitidos:0};
  for(const c of S.clientes.values()){
    if(c.estado!=='activo'&&c.estado!=='suspendido'){out.omitidos++;continue;}
    const from=c.desde||(c.alta?c.alta.slice(0,7):curMonth());
    if(from>=eff){out.yaDesde++;continue;}
    const d=deudaPrevia(c,eff),patch={desde:eff};
    if(d.monto>0){
      const prev=c.deudaAnt&&Number(c.deudaAnt.m)>0?c.deudaAnt:null;
      patch.deudaAnt={m:(prev?Number(prev.m):0)+d.monto,det:[prev&&prev.det,mesesTxt(d.meses)].filter(Boolean).join(' + '),f:(prev&&prev.f)||todayStr()};
      out.conDeuda++;out.monto+=d.monto;
    }else out.sinDeuda++;
    out.cambian.push({id:c.id,shard:c._doc||clientShard(c.id),patch});
  }
  return out;
}
function openCeroBloque(){
  if(!can('editarClientes'))return toast('Tu perfil no puede cambiar la facturación de los clientes','bad');
  const cur=curMonth();
  openModal({title:'Empezar a cobrar de cero',wide:true,html:`<p class="muted small">Deja a todos los clientes en cero: no se les cobra ni se les genera deuda antes del mes que elijas. Lo que cada uno debía hasta ese momento queda anotado como <b>Deuda anterior</b>: se ve en su ficha, en Cobranzas y en el Resumen, se cobra aparte y <b>no genera cortes</b>.</p>
    ${S.loaded.clientes&&S.loaded.pagos?'':'<div class="notice bad">Todavía están cargando los clientes y los cobros. Esperá unos segundos y volvé a abrir esto.</div>'}
    ${F('Empezar a cobrar desde','cz-mes',`<input id="cz-mes" type="month" min="${cur}" max="${addMonths(cur,3)}" value="${addMonths(cur,1)}">`,'Los clientes con «cobrar desde» en ese mes o después no se tocan.')}
    <div id="cz-out"></div>`,
    onMount(el){
      const show=()=>{
        const eff=$('#cz-mes',el).value,out=$('#cz-out',el);
        if(!/^\d{4}-\d{2}$/.test(eff)||eff<cur){out.innerHTML='<div class="notice bad">Elegí el mes desde el que se empieza a cobrar (este mes o uno posterior).</div>';return;}
        if(!S.loaded.clientes||!S.loaded.pagos){out.innerHTML='';return;}
        const res=bulkCero(eff);
        out.innerHTML=`<div class="card flat"><h3>${res.cambian.length} ${res.cambian.length===1?'cliente empieza':'clientes empiezan'} a cobrarse desde ${esc(monthLabel(eff))}</h3>
          <dl class="kv"><dt>Con deuda anterior</dt><dd>${res.conDeuda} ${res.conDeuda===1?'cliente':'clientes'} · ${esc(fmtMoney(res.monto))}</dd><dt>Al día</dt><dd>${res.sinDeuda} ${res.sinDeuda===1?'cliente':'clientes'} sin deuda</dd>${res.yaDesde?`<dt>Ya empiezan ese mes o después</dt><dd>${res.yaDesde} no se tocan</dd>`:''}${res.omitidos?`<dt>Por instalar, de baja o sin servicio</dt><dd>${res.omitidos} no se tocan</dd>`:''}</dl>
          <div class="actions"><button class="btn primary" type="button" id="cz-go"${res.cambian.length?'':' disabled'}>Poner a ${res.cambian.length} en cero</button></div><div class="hint" id="cz-prog"></div></div>`;
        const go=$('#cz-go',el);
        if(go)go.addEventListener('click',async()=>{
          if(!await askConfirm(`Se pone en cero a ${res.cambian.length} clientes: empiezan a cobrarse desde ${monthLabel(eff)} y ${res.conDeuda} quedan con deuda anterior (${fmtMoney(res.monto)}). ¿Seguro?`,'Poner en cero'))return;
          go.disabled=true;
          try{await applyBulkPrecios(res.cambian,(d,t)=>{const h=$('#cz-prog',el);if(h)h.textContent=`Actualizando… ${d} de ${t}`;});toast(res.cambian.length+' clientes en cero');closeModal();}
          catch(err){dbError(err);go.disabled=false;const h=$('#cz-prog',el);if(h)h.textContent='No se pudo terminar. Los que ya cambiaron no se repiten: volvé a abrir esto y revisá cuántos faltan.';}
        });
      };
      $('#cz-mes',el).addEventListener('input',show);show();
    }});
}
function openImport(){
  const cur=todayStr().slice(0,7);
  const html=`<p class="muted small">Elegí un archivo .csv (en Excel: Guardar como, CSV). La primera fila lleva los nombres de las columnas. Se reconocen: ${IMP_COLS.join(', ')}.</p>
    <div class="actions start"><button class="btn small" type="button" id="imp-tpl">Descargar modelo de columnas</button></div>
    <div class="grid2">${F('Estado de los clientes importados','imp-estado',`<select id="imp-estado">${Object.entries(ESTADOS).map(([k,v])=>opt(k,v,k==='activo')).join('')}</select>`,'Si el archivo trae una columna de estado, se usa esa.')}
    ${F('Cobrar desde (mes)','imp-desde',`<input id="imp-desde" type="month" value="${cur}">`,'Antes de este mes no se genera deuda. Dejalo en el mes actual si no querés arrastrar deudas viejas.')}</div>
    ${F('Ciclo de cobro (si el archivo no lo trae)','imp-ciclo',`<select id="imp-ciclo">${[1,2].map(n=>opt(n,'Ciclo '+n+': '+cicloTxt(n),n===1)).join('')}</select>`,'En el archivo, la columna «ciclo» puede decir 1 o 2.')}
    <label class="per"><input type="checkbox" id="imp-comp" checked><span class="grow"><b>Completar los clientes que ya están cargados</b><br><span class="small muted">Si el nombre coincide, solo se llenan los datos que les faltan. No se pisa nada de lo que ya tienen.</span></span></label>
    <label class="per"><input type="checkbox" id="imp-act"><span class="grow"><b>Actualizar el plan, los servicios y el precio de los que ya están cargados</b><br><span class="small muted">Se usan el plan, los servicios y el precio especial del archivo. El resto de sus datos no se toca, y lo anterior queda como estaba hasta el mes previo al que elijas.</span></span></label>
    <div id="imp-vig-box" hidden>${F('Los cambios rigen desde','imp-vig',`<input id="imp-vig" type="month" min="${cur}" max="${addMonths(cur,3)}" value="${addMonths(cur,1)}">`,'Antes de ese mes cada cliente conserva su plan y precio actuales.')}</div>
    ${F('Archivo CSV','imp-file','<input id="imp-file" type="file">')}
    <div id="imp-out"></div>`;
  openModal({title:'Importar clientes',html,wide:true,onMount(el){
    let rows=null;
    const opts=()=>({estado:$('#imp-estado',el).value,desde:$('#imp-desde',el).value||cur,ciclo:Number($('#imp-ciclo',el).value)===2?2:1,existentes:$('#imp-act',el).checked?'actualizar':($('#imp-comp',el).checked?'completar':'saltear'),vigencia:$('#imp-vig',el).value||addMonths(cur,1)});
    const show=()=>{
      const out=$('#imp-out',el);if(!rows)return;
      const a=analyzeImport(rows,opts());
      if(!a.cols.includes('nombre')){out.innerHTML='<div class="notice bad">No encontré una columna de nombre. Revisá la primera fila del archivo.</div>';return;}
      const velF=[...a.velFalta].map(([k,n])=>k+' Mbps ('+n+')');
      out.innerHTML=`<div class="card flat"><h3>${opts().existentes==='actualizar'?a.act.n+' '+(a.act.n===1?'cliente se actualiza':'clientes se actualizan')+' desde '+esc(monthLabel(opts().vigencia)):a.recs.length+' '+(a.recs.length===1?'cliente listo':'clientes listos')+' para importar'}</h3>
        <dl class="kv"><dt>Columnas reconocidas</dt><dd>${a.cols.map(esc).join(', ')}</dd>${a.sinNombre?`<dt>Sin nombre</dt><dd>${a.sinNombre} filas se saltean</dd>`:''}${a.dup?`<dt>N° ya existente</dt><dd>${a.dup} filas se saltean</dd>`:''}${a.sinMatch?`<dt>Sin cliente con ese nombre</dt><dd>${a.sinMatch} filas se saltean: en este modo no se crean clientes nuevos</dd>`:''}${a.existen?`<dt>Ya cargados (mismo nombre)</dt><dd>${a.existen} no se vuelven a crear${opts().existentes==='actualizar'?`: ${a.act.n} cambian de plan, servicios o precio${a.act.porPlan.size?' ('+[...a.act.porPlan].map(([k,v])=>esc(k)+': '+v).join(' · ')+(a.act.conServ?' · '+a.act.conServ+' con servicios':'')+')':''}${a.act.igual?`; ${a.act.igual} ya estaban así`:''}`:a.upd.length?`; a ${a.upd.length} se les completan datos que les faltaban`:''}</dd>`:''}
        ${velF.length?`<dt>Velocidades sin plan</dt><dd>${velF.map(esc).join(', ')}. Esos clientes quedan sin plan (se cobra igual por su precio). Creá el plan y volvé a importar con «Completar» tildado.</dd>`:''}
        ${a.planesFalta.size?`<dt>Planes que no existen</dt><dd>${[...a.planesFalta].map(esc).join(', ')}. Esos clientes quedan sin plan. Creá los planes antes para que se asignen.</dd>`:''}${a.serviciosFalta.size?`<dt>Servicios que no existen</dt><dd>${[...a.serviciosFalta].map(esc).join(', ')}. Se ignoran: creálos en Planes y volvé a importar o asignalos a mano.</dd>`:''}<dt>Sin ubicación</dt><dd>${a.sinGeo}</dd></dl>
        <div class="actions"><button class="btn primary" type="button" id="imp-go"${a.recs.length||a.upd.length?'':' disabled'}>${(()=>{const v=opts().existentes==='actualizar'?'Actualizar':'Completar';return a.recs.length?'Importar '+a.recs.length:v+' '+a.upd.length;})()}${a.recs.length&&a.upd.length?(opts().existentes==='actualizar'?' y actualizar ':' y completar ')+a.upd.length:''}</button></div><div class="hint" id="imp-prog"></div></div>`;
      const go=$('#imp-go',el);
      if(go)go.addEventListener('click',async()=>{
        go.disabled=true;const total=a.recs.length;
        try{
          await saveImported(a.recs,(done,t)=>{$('#imp-prog',el).textContent=`Importando… ${done} de ${t}`;});
          await updateImported(a.upd,(done,t)=>{$('#imp-prog',el).textContent=`Completando… ${done} de ${t}`;});
          toast((total?total+' clientes importados':'')+(total&&a.upd.length?' · ':'')+(a.upd.length?a.upd.length+(opts().existentes==='actualizar'?' actualizados':' completados'):''));closeModal();
        }catch(err){dbError(err);go.disabled=false;$('#imp-prog',el).textContent='No se pudo terminar la importación. Revisá cuántos clientes se cargaron antes de volver a intentar.';}
      });
    };
    $('#imp-file',el).addEventListener('change',e=>{
      const f=e.target.files[0];if(!f)return;
      const rd=new FileReader();
      rd.onload=()=>{rows=parseCsv(String(rd.result));if(rows.length<2){$('#imp-out',el).innerHTML='<div class="notice bad">El archivo no tiene filas de datos.</div>';rows=null;return;}show();};
      rd.onerror=()=>toast('No se pudo leer el archivo','bad');
      rd.readAsText(f,'utf-8');
    });
    ['imp-estado','imp-desde','imp-ciclo','imp-comp','imp-act','imp-vig'].forEach(i=>$('#'+i,el).addEventListener('change',()=>{$('#imp-vig-box',el).hidden=!$('#imp-act',el).checked;show();}));
    $('#imp-tpl',el).addEventListener('click',()=>saveFile('modelo-clientes.csv',toCsv([IMP_COLS])));
  }});
}
function exportClientes(){
  const rows=[['codigo','nombre','dni','telefono','telefono 2','direccion','localidad','referencia','plan','velocidad','servicios','tecnologia','usuario','ip','nodo','equipo','caja nap','puerto nap','latitud','longitud','estado','fecha de alta','cobrar desde','ciclo','precio especial','notas']];
  [...S.clientes.values()].sort((a,b)=>norm(a.nombre).localeCompare(norm(b.nombre))).forEach(c=>{
    const p=S.planes.get(c.planId);
    rows.push([c.codigo,c.nombre,c.dni,c.tel,c.tel2,c.dir,c.loc,c.ref,p?p.nombre:'',p?planSpeed(p):'',extrasOf(c).map(s=>s.nombre).join(' + '),TECNOS[c.tec]||'',c.usuario,c.ip,c.nodo,c.equipo,c.nap?redName(c.nap):'',c.nap&&c.napPuerto?c.napPuerto:'',hasGeo(c)?c.lat:'',hasGeo(c)?c.lng:'',ESTADOS[c.estado]||c.estado,c.alta,c.desde,cicloOf(c),c.precio==null?'':c.precio,c.notas]);
  });
  saveFile('clientes-'+todayStr()+'.csv',toCsv(rows));
}
function exportPagos(){
  const rows=[['fecha','hora','recibo','n de cliente','cliente','concepto','periodo','monto','medio de pago','nota','anulado']];
  [...S.pagos.values()].sort((a,b)=>(a.fecha+(a.hora||'')).localeCompare(b.fecha+(b.hora||''))).forEach(p=>{
    const c=S.clientes.get(p.c);
    rows.push([p.fecha,p.hora||'',p.recibo,c?c.codigo:'',c?c.nombre:'(cliente eliminado)',CONCEPTOS[p.concepto]||p.concepto,p.per||'',p.monto,METODOS[p.metodo]||p.metodo,p.nota||'',p.anulado?'sí':'']);
  });
  saveFile('pagos-'+todayStr()+'.csv',toCsv(rows));
}
