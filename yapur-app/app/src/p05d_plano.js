/* ===== plano de la red: el árbol de conexiones dibujado solo, a partir de lo que ya está cargado =====
   Se arma un árbol por cada punto que no tiene «Sale de» (la OLT siempre es uno; una botella o un splitter
   viejo sin OLT cargada también lo es). Las conexiones son las mismas que ya muestra la ficha («De acá salen»),
   así que el plano nunca puede decir algo distinto de lo que dice la ficha de cada punto. */
const PLANO_W=176, PLANO_H=60, PLANO_GX=26, PLANO_GY=70, PLANO_PAD=30;
const PLANO_TIPO_CLS={olt:'olt',nap:'nap',splitter:'splitter',empalme:'empalme'};
/* segunda línea de cada caja: cuánto tiene cargado y cuánto está en uso */
function planoResumen(p){
  if(p.tipo==='nap')return p.puertos?napUsed(p.id)+'/'+p.puertos+' puertos':(napUsed(p.id)+(napUsed(p.id)===1?' cliente':' clientes'));
  if(p.tipo==='splitter'){const c=redCantidad(p);return c?('1x'+c+' · '+salidasUsadas(p)+'/'+c):'Sin relación';}
  if(p.tipo==='olt'){const c=redCantidad(p);return c?(salidasUsadas(p)+'/'+c+' puertos'):'Sin puertos';}
  if(p.tipo==='empalme')return p.hilos?(pelosUsados(p)+'/'+p.hilos+' pelos'):'Sin pelos';
  return '';
}
/* el árbol: cada punto sin «padre» (o cuyo padre ya no existe) es la raíz de su propio árbol. Usa redArbol (en Red),
   armado con redConecta() —la misma función que «De acá salen» en la ficha—, así un punto nunca aparece en dos árboles
   y el plano nunca puede dibujar algo distinto de lo que ya usa «Clonar con todo lo que cuelga» para copiar una rama */
function planoBosque(){
  const visitado=new Set(),arboles=[];
  const raices=[...S.red.values()].filter(p=>!p.padre||!S.red.has(p.padre)).sort(redTipoCmp);
  raices.forEach(p=>{if(!visitado.has(p.id)){visitado.add(p.id);arboles.push(redArbol(p,visitado));}});
  /* por las dudas, algún punto raro que quedó sin alcanzar (padre apuntando en círculo) también se dibuja */
  [...S.red.values()].sort(redTipoCmp).forEach(p=>{if(!visitado.has(p.id)){visitado.add(p.id);arboles.push(redArbol(p,visitado));}});
  return arboles;
}
/* primero el ancho de cada nodo (el de las hojas es fijo, el de un padre es la suma de sus hijos), después
   la posición: los hijos uno al lado del otro y el padre centrado arriba de ellos (como un organigrama) */
function planoAncho(nodo){
  if(!nodo.hijos.length){nodo.w=PLANO_W;return nodo.w;}
  let w=0;nodo.hijos.forEach((h,i)=>{if(i)w+=PLANO_GX;w+=planoAncho(h.nodo);});
  nodo.w=Math.max(PLANO_W,w);
  return nodo.w;
}
function planoPos(nodo,x0,depth){
  nodo.y=depth*(PLANO_H+PLANO_GY);
  nodo.depth=depth;
  if(!nodo.hijos.length){nodo.x=x0+nodo.w/2;return depth;}
  let cx=x0,maxD=depth;
  nodo.hijos.forEach(h=>{maxD=Math.max(maxD,planoPos(h.nodo,cx,depth+1));cx+=h.nodo.w+PLANO_GX;});
  nodo.x=x0+nodo.w/2;
  return maxD;
}
function planoLayout(bosque){
  let x=0,maxD=0;
  bosque.forEach(raiz=>{planoAncho(raiz);maxD=Math.max(maxD,planoPos(raiz,x,0));x+=raiz.w+PLANO_GX*3;});
  const w=Math.max(PLANO_W,x-PLANO_GX*3),h=(maxD+1)*(PLANO_H+PLANO_GY)-PLANO_GY;
  return {w,h};
}
/* una caja del plano: nombre, tipo y cuánto está en uso; tocarla abre su ficha (igual que en el resto de la app) */
function planoCajaSVG(nodo){
  const p=nodo.p,x=nodo.x-PLANO_W/2,y=nodo.y,cls=PLANO_TIPO_CLS[p.tipo]||'';
  const nombre=p.nombre.length>22?p.nombre.slice(0,21)+'…':p.nombre;
  return `<g class="pnode ${cls}" tabindex="0" role="button" data-red="${esc(p.id)}" aria-label="${esc(p.nombre+' · '+(RED_TIPO[p.tipo]||p.tipo)+' · '+planoResumen(p))}">
    <title>${esc(p.nombre)}</title>
    <rect x="${x}" y="${y}" width="${PLANO_W}" height="${PLANO_H}" rx="10"></rect>
    <text x="${nodo.x}" y="${y+23}" text-anchor="middle" class="pnode-t">${esc(nombre)}</text>
    <text x="${nodo.x}" y="${y+40}" text-anchor="middle" class="pnode-s">${esc(RED_TIPO[p.tipo]||p.tipo)}</text>
    <text x="${nodo.x}" y="${y+54}" text-anchor="middle" class="pnode-s">${esc(planoResumen(p))}</text>
  </g>`;
}
/* la línea entre una caja y la siguiente: en ángulo recto (como un organigrama), con el color de la fibra
   si ya se anotó por cuál pelo o salida sale; si todavía no se anotó, una línea gris punteada (avisa que
   falta cargar ese dato) */
function planoLineaSVG(padre,hijo,pelos){
  const x1=padre.x,y1=padre.y+PLANO_H,x2=hijo.x,y2=hijo.y,ym=(y1+y2)/2;
  const col=pelos.length?FIBRA_COL[(pelos[0].n-1)%12]:null;
  const d=`M ${x1} ${y1} L ${x1} ${ym} L ${x2} ${ym} L ${x2} ${y2}`;
  const linea=`<path d="${d}" class="pedge${col?'':' sinconectar'}" ${col?`style="stroke:${col[1]}"`:''}></path>`;
  if(!pelos.length)return linea;
  const lab=padre.p.tipo==='empalme'?'':(padre.p.tipo==='olt'?'P':'S');   /* pelo (sin letra, ya lleva el número solo) o salida/puerto (S) */
  const txt=pelos.map(x=>x.n).join(',');
  return linea+`<g class="pedge-lab"><circle cx="${x2}" cy="${ym}" r="9"></circle><text x="${x2}" y="${ym+4}" text-anchor="middle">${esc(lab+txt)}</text></g>`;
}
function planoSVG(){
  const bosque=planoBosque();
  if(!bosque.length)return {svg:'',w:0,h:0,vacio:true};
  const {w,h}=planoLayout(bosque);
  const cajas=[],lineas=[];
  function walk(nodo){
    cajas.push(planoCajaSVG(nodo));
    nodo.hijos.forEach(hi=>{lineas.push(planoLineaSVG(nodo,hi.nodo,hi.pelos));walk(hi.nodo);});
  }
  bosque.forEach(walk);
  const W=w+PLANO_PAD*2,H=h+PLANO_PAD*2;
  const svg=`<svg viewBox="${-PLANO_PAD} ${-PLANO_PAD} ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" font-family="Public Sans,system-ui,sans-serif">
    <g>${lineas.join('')}</g><g>${cajas.join('')}</g></svg>`;
  return {svg,w:W,h:H,vacio:false};
}
/* ----- versión simplificada: solo las cajas NAP, una al lado de la otra en una grilla, sin mostrar
   splitters ni OLT (para quien no necesita ver cómo está armada la red por dentro) ----- */
const PLANO_GRID_COLS=5;
function planoCajasSVG(){
  const cajas=[...S.red.values()].filter(p=>p.tipo==='nap').sort((a,b)=>a.nombre.localeCompare(b.nombre,'es'));
  if(!cajas.length)return {svg:'',w:0,h:0,vacio:true};
  const cols=Math.min(PLANO_GRID_COLS,cajas.length),rows=Math.ceil(cajas.length/PLANO_GRID_COLS);
  const nodos=cajas.map((p,i)=>({p,x:(i%PLANO_GRID_COLS)*(PLANO_W+PLANO_GX)+PLANO_W/2,y:Math.floor(i/PLANO_GRID_COLS)*(PLANO_H+PLANO_GY)}));
  const w=cols*PLANO_W+(cols-1)*PLANO_GX,h=rows*PLANO_H+(rows-1)*PLANO_GY;
  const W=w+PLANO_PAD*2,H=h+PLANO_PAD*2;
  const svg=`<svg viewBox="${-PLANO_PAD} ${-PLANO_PAD} ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" font-family="Public Sans,system-ui,sans-serif">
    <g>${nodos.map(planoCajaSVG).join('')}</g></svg>`;
  return {svg,w:W,h:H,vacio:false};
}
/* ----- cuál de las dos versiones le toca ver a quien está mirando: la completa gana si tiene las dos ----- */
const planoModo=()=>can('redPlano')?'full':(can('redPlanoCajas')?'cajas':null);
const planoDatos=modo=>modo==='full'?planoSVG():planoCajasSVG();
/* ----- vista en pantalla: con acercar/alejar y botón para imprimir ----- */
let PLANO_ZOOM=1;
function openRedPlano(){
  const modo=planoModo();
  if(!modo)return;
  const {svg,vacio}=planoDatos(modo);
  const html=`<div class="actions start" style="margin-bottom:10px">
      <button class="btn small" type="button" id="pln-mas">Acercar</button><button class="btn small" type="button" id="pln-menos">Alejar</button><button class="btn small ghost" type="button" id="pln-100">Tamaño real</button>
      <button class="btn small" type="button" id="pln-ref">Actualizar</button><button class="btn small" type="button" id="pln-print">Imprimir</button></div>
    ${vacio?`<div class="empty"><b>Todavía no hay nada para dibujar</b><span>${modo==='full'?'Cargá la OLT y los puntos que salen de ella en la pestaña Red.':'Todavía no hay ninguna caja NAP cargada en la pestaña Red.'}</span></div>`:`<div class="plano-wrap" id="pln-wrap"><div id="pln-canvas" style="transform:scale(1);transform-origin:0 0">${svg}</div></div>
    <div class="hint">Tocá una caja para abrir su ficha.${modo==='full'?' Las líneas punteadas son conexiones declaradas («Sale de») a las que todavía no se les anotó el pelo o la salida.':' No se muestran los splitters ni la OLT.'}</div>`}`;
  openModal({title:modo==='full'?'Plano de la red':'Plano de la red (solo cajas)',html,wide:true,onMount(el){
    const canvas=$('#pln-canvas',el);
    const zoom=d=>{PLANO_ZOOM=Math.max(.25,Math.min(3,PLANO_ZOOM+d));if(canvas)canvas.style.transform='scale('+PLANO_ZOOM+')';};
    const m=$('#pln-mas',el);if(m)m.addEventListener('click',()=>zoom(.2));
    const me=$('#pln-menos',el);if(me)me.addEventListener('click',()=>zoom(-.2));
    const c1=$('#pln-100',el);if(c1)c1.addEventListener('click',()=>{PLANO_ZOOM=1;if(canvas)canvas.style.transform='scale(1)';});
    $('#pln-ref',el).addEventListener('click',()=>openRedPlano());
    $('#pln-print',el).addEventListener('click',printPlano);
    el.addEventListener('click',e=>{const g=e.target.closest('[data-red]');if(g)openRed(g.dataset.red);});
    el.addEventListener('keydown',e=>{if(e.key!=='Enter'&&e.key!==' ')return;const g=e.target.closest('[data-red]');if(g){e.preventDefault();openRed(g.dataset.red);}});
  }});
}
/* ----- imprimir: igual que el recibo (APK: se lo pasa a Android; navegador: una hoja aparte con window.print()) ----- */
const PLANO_PRINT_CSS='@page{size:A4 landscape;margin:10mm}html,body{margin:0;background:#fff}h1{font:700 14pt "Public Sans",system-ui,sans-serif;margin:0 0 6mm}svg{width:100%;height:auto;display:block}'
  +'.pnode rect{fill:#F4F8F9;stroke:#587080;stroke-width:1.5}.pnode.olt rect{fill:#D6EFEC;stroke:#0A7C77}.pnode.nap rect{fill:#DDF3E4;stroke:#1E8449}.pnode.empalme rect{fill:#DCE8F7;stroke:#245FA8}'
  +'.pnode-t{font:700 11px "Public Sans",system-ui,sans-serif;fill:#0E2230}.pnode-s{font:500 9.5px "Public Sans",system-ui,sans-serif;fill:#587080}'
  +'.pedge{fill:none;stroke:#8c96a3;stroke-width:2}.pedge.sinconectar{stroke-dasharray:5 4}.pedge-lab circle{fill:#fff;stroke:#8c96a3}.pedge-lab text{font:700 9px "Public Sans",system-ui,sans-serif;fill:#0E2230}';
function printPlano(){
  const modo=planoModo();
  if(!modo)return;
  const {svg,vacio}=planoDatos(modo);
  if(vacio)return toast('Todavía no hay nada para dibujar','bad');
  const tit='Plano de la red'+(modo==='cajas'?' (solo cajas)':'');
  const html='<!doctype html><meta charset="utf-8"><title>'+esc(tit)+' · '+esc(S.ajustes.empresa||'YAPUR.NET')+'</title><h1>'+esc(tit)+' · '+esc(S.ajustes.empresa||'YAPUR.NET')+'</h1>'+svg+'<style>'+PLANO_PRINT_CSS+'</style>';
  const b=window.YapurApp;
  if(b){
    if(typeof b.printHtml!=='function')return toast('Para imprimir desde el celular instalá la última versión de la app.','bad');
    let r='';try{r=String(b.printHtml(html,tit)||'');}catch(_){r='No se pudo abrir la impresión.';}
    if(r!=='ok')toast(r||'No se pudo abrir la impresión.','bad');
    return;
  }
  try{
    const f=document.createElement('iframe');f.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0';document.body.appendChild(f);
    const w=f.contentWindow,doc=w.document;doc.open();doc.write(html);doc.close();
    setTimeout(()=>{try{w.focus();w.print();}catch(_){toast('Este navegador no puede imprimir. Probá desde otra computadora.','bad');}setTimeout(()=>f.remove(),2000);},150);
  }catch(_){toast('Este navegador no puede imprimir. Probá desde otra computadora.','bad');}
}
