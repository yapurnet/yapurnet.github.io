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
/* opts.existentes: 'completar' → los que ya existen (mismo nombre) reciben solo los datos que les faltan · otro valor → se cuentan y se dejan como están */
function analyzeImport(rows,opts){
  const head=rows[0].map(h=>HREV[norm(h).replace(/[^a-z0-9]+/g,' ').trim()]||null);
  const idx={};head.forEach((f,i)=>{if(f&&!(f in idx))idx[f]=i;});
  const used=new Set(S.clientes.size?[...S.clientes.values()].map(c=>c.codigo).filter(Boolean):[]);
  const byKey=new Map();
  if(opts.existentes){for(const c of S.clientes.values()){const k=nameKey(c.nombre);if(k)byKey.set(k,byKey.has(k)?null:c);}}
  const taken=new Set();
  const out={recs:[],upd:[],existen:0,sinNombre:0,dup:0,planesFalta:new Set(),velFalta:new Map(),serviciosFalta:new Set(),cols:Object.keys(idx),sinGeo:0};
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
      if(opts.existentes==='completar'){
        const patch={},fill=(k,v)=>{if(v!==''&&v!=null&&(ex[k]==null||ex[k]===''))patch[k]=v;};
        fill('dni',g('dni'));fill('tel',g('tel'));fill('tel2',g('tel2'));fill('dir',g('dir'));fill('loc',g('loc'));fill('ref',g('ref'));
        fill('usuario',g('usuario'));fill('ip',g('ip'));fill('nodo',g('nodo'));fill('equipo',g('equipo'));fill('notas',g('notas'));
        if(plan)fill('planId',plan.id);
        if(precio!==null&&!hasNum(ex.precio))patch.precio=precio;
        const sinPagos=S.loaded.pagos&&!(S.paidIdx.get(ex.id)||new Map()).size;   /* con pagos cargados no se toca desde cuándo se cobra */
        if(sinPagos){if(idx.desde!==undefined&&parseMes(g('desde')))patch.desde=desde;if(idx.ciclo!==undefined&&g('ciclo'))patch.ciclo=parseCiclo(g('ciclo'),cicloOf(ex));}
        if(Object.keys(patch).length)out.upd.push({id:ex.id,shard:ex._doc||clientShard(ex.id),patch});
      }
      continue;
    }
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
function openImport(){
  const cur=todayStr().slice(0,7);
  const html=`<p class="muted small">Elegí un archivo .csv (en Excel: Guardar como, CSV). La primera fila lleva los nombres de las columnas. Se reconocen: ${IMP_COLS.join(', ')}.</p>
    <div class="actions start"><button class="btn small" type="button" id="imp-tpl">Descargar modelo de columnas</button></div>
    <div class="grid2">${F('Estado de los clientes importados','imp-estado',`<select id="imp-estado">${Object.entries(ESTADOS).map(([k,v])=>opt(k,v,k==='activo')).join('')}</select>`,'Si el archivo trae una columna de estado, se usa esa.')}
    ${F('Cobrar desde (mes)','imp-desde',`<input id="imp-desde" type="month" value="${cur}">`,'Antes de este mes no se genera deuda. Dejalo en el mes actual si no querés arrastrar deudas viejas.')}</div>
    ${F('Ciclo de cobro (si el archivo no lo trae)','imp-ciclo',`<select id="imp-ciclo">${[1,2].map(n=>opt(n,'Ciclo '+n+': '+cicloTxt(n),n===1)).join('')}</select>`,'En el archivo, la columna «ciclo» puede decir 1 o 2.')}
    <label class="per"><input type="checkbox" id="imp-comp" checked><span class="grow"><b>Completar los clientes que ya están cargados</b><br><span class="small muted">Si el nombre coincide, solo se llenan los datos que les faltan. No se pisa nada de lo que ya tienen.</span></span></label>
    ${F('Archivo CSV','imp-file','<input id="imp-file" type="file">')}
    <div id="imp-out"></div>`;
  openModal({title:'Importar clientes',html,wide:true,onMount(el){
    let rows=null;
    const opts=()=>({estado:$('#imp-estado',el).value,desde:$('#imp-desde',el).value||cur,ciclo:Number($('#imp-ciclo',el).value)===2?2:1,existentes:$('#imp-comp',el).checked?'completar':'saltear'});
    const show=()=>{
      const out=$('#imp-out',el);if(!rows)return;
      const a=analyzeImport(rows,opts());
      if(!a.cols.includes('nombre')){out.innerHTML='<div class="notice bad">No encontré una columna de nombre. Revisá la primera fila del archivo.</div>';return;}
      const velF=[...a.velFalta].map(([k,n])=>k+' Mbps ('+n+')');
      out.innerHTML=`<div class="card flat"><h3>${a.recs.length} ${a.recs.length===1?'cliente listo':'clientes listos'} para importar</h3>
        <dl class="kv"><dt>Columnas reconocidas</dt><dd>${a.cols.map(esc).join(', ')}</dd>${a.sinNombre?`<dt>Sin nombre</dt><dd>${a.sinNombre} filas se saltean</dd>`:''}${a.dup?`<dt>N° ya existente</dt><dd>${a.dup} filas se saltean</dd>`:''}${a.existen?`<dt>Ya cargados (mismo nombre)</dt><dd>${a.existen} no se vuelven a crear${a.upd.length?`; a ${a.upd.length} se les completan datos que les faltaban`:''}</dd>`:''}
        ${velF.length?`<dt>Velocidades sin plan</dt><dd>${velF.map(esc).join(', ')}. Esos clientes quedan sin plan (se cobra igual por su precio). Creá el plan y volvé a importar con «Completar» tildado.</dd>`:''}
        ${a.planesFalta.size?`<dt>Planes que no existen</dt><dd>${[...a.planesFalta].map(esc).join(', ')}. Esos clientes quedan sin plan. Creá los planes antes para que se asignen.</dd>`:''}${a.serviciosFalta.size?`<dt>Servicios que no existen</dt><dd>${[...a.serviciosFalta].map(esc).join(', ')}. Se ignoran: creálos en Planes y volvé a importar o asignalos a mano.</dd>`:''}<dt>Sin ubicación</dt><dd>${a.sinGeo}</dd></dl>
        <div class="actions"><button class="btn primary" type="button" id="imp-go"${a.recs.length||a.upd.length?'':' disabled'}>${a.recs.length?'Importar '+a.recs.length:'Completar '+a.upd.length}${a.recs.length&&a.upd.length?' y completar '+a.upd.length:''}</button></div><div class="hint" id="imp-prog"></div></div>`;
      const go=$('#imp-go',el);
      if(go)go.addEventListener('click',async()=>{
        go.disabled=true;const total=a.recs.length;
        try{
          await saveImported(a.recs,(done,t)=>{$('#imp-prog',el).textContent=`Importando… ${done} de ${t}`;});
          await updateImported(a.upd,(done,t)=>{$('#imp-prog',el).textContent=`Completando… ${done} de ${t}`;});
          toast((total?total+' clientes importados':'')+(total&&a.upd.length?' · ':'')+(a.upd.length?a.upd.length+' completados':''));closeModal();
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
    ['imp-estado','imp-desde','imp-ciclo','imp-comp'].forEach(i=>$('#'+i,el).addEventListener('change',show));
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
