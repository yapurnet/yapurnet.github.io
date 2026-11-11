/* Factura electrónica de ARCA. Los recibos siguen igual: la factura es un paso aparte que se pide desde el recibo, solo cuando hace falta.
   Ajustes (administrador): pedido de certificado, punto de venta y prueba de conexión. Recibo: «Emitir factura ARCA», ver / imprimir / enviar y nota de crédito. */
const FE_LETRA={1:'A',6:'B',3:'A',8:'B'},FE_COD={1:'001',6:'006',3:'003',8:'008'},FE_NOMBRE={1:'FACTURA',6:'FACTURA',3:'NOTA DE CRÉDITO',8:'NOTA DE CRÉDITO'};
const FE_COND={1:'Responsable Inscripto',4:'IVA Sujeto Exento',5:'Consumidor Final',6:'Responsable Monotributo',7:'Sujeto No Categorizado'};
const feNro=f=>String(f.pv).padStart(5,'0')+'-'+String(f.nro).padStart(8,'0');
const feVto=v=>/^\d{8}$/.test(v||'')?v.slice(6)+'/'+v.slice(4,6)+'/'+v.slice(0,4):v||'';
const feFecha=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')?dmy(v):v||'';
const fePesos=n=>fmtMoney(Number(n)||0);

/* ----- Ajustes ----- */
function arcaAjustesCard(){
  return `<div class="card" id="arca-card"><h2>Factura electrónica ARCA</h2>
    <p class="muted small">Los recibos siguen como siempre. Si un cliente necesita factura, se pide desde su recibo con «Emitir factura ARCA». Sale a nombre de la razón social de Ajustes → Recibo, como Responsable Inscripto.</p>
    <div id="arca-st" class="hint">Mirando el estado…</div></div>`;
}
async function arcaAjustesMount(el){
  const root=$('#arca-st',el);if(!root)return;
  let a;try{a=await NET.api('GET','/api/arca');}catch(err){root.textContent=err.network?'No se pudo conectar con el servidor.':err.message;return;}
  const em=a.emisor||{};
  const falta=!em.cuit||em.cuit.length!==11;
  root.className='';
  root.innerHTML=`
    <div class="kv-lite"><div><b>Emisor:</b> ${esc(em.razon||'sin razón social')} · CUIT ${esc(em.cuit||'sin cargar')}</div>
    ${falta?'<div class="notice warn" style="margin-top:8px">Falta el CUIT. Cargalo en Ajustes → Recibo (son 11 números) y volvé acá.</div>':''}
    ${a.mock?'<div class="notice info" style="margin-top:8px">Este servidor está conectado a un ARCA de prueba simulado.</div>':''}</div>
    <h3 style="margin-top:14px">1. Certificado</h3>
    <div class="hint">${a.tieneCert?`Certificado cargado, vence el ${esc(dmy(a.certHasta||''))}. Faltando un mes conviene pedir otro.`:a.tieneClave?'Pedido de certificado listo: llevalo a ARCA (pasos abajo) y pegá acá el certificado que te devuelven.':'Todavía no hay certificado.'}</div>
    <div class="actions start"><button class="btn${a.tieneClave?'':' primary'}" type="button" id="arca-gen" ${falta?'disabled':''}>${a.tieneClave?'Generar un pedido nuevo':'Generar el pedido de certificado'}</button></div>
    <div id="arca-csr" ${a.tieneClave&&!a.tieneCert&&a.csr?'':'hidden'}>
      <div class="field"><label for="arca-csr-t">Pedido de certificado (CSR)</label><textarea id="arca-csr-t" rows="5" readonly class="mono small">${esc(a.csr||'')}</textarea></div>
      <div class="actions start"><button class="btn small" type="button" id="arca-csr-c">Copiar</button><button class="btn small" type="button" id="arca-csr-d">Descargar archivo .csr</button></div>
      <ol class="small" style="margin:10px 0 0 18px;line-height:1.5">
        <li>Entrá a ARCA con tu CUIT y tu clave fiscal, como siempre (esto lo hacés vos).</li>
        <li>Abrí el servicio <b>«Administración de Certificados Digitales»</b> (en el ambiente de pruebas se llama «WSASS – Autoservicio de Acceso a WSHomologación»). Agregá un alias, pegá el pedido de arriba y descargá el certificado (.crt).</li>
        <li>En <b>«Administrador de Relaciones de Clave Fiscal»</b> autorizá ese alias para el servicio <b>«Facturación Electrónica» (wsfe)</b>.</li>
        <li>En <b>«Administración de puntos de venta y domicilios»</b> creá un punto de venta del tipo <b>«RECE para aplicativo y web services»</b> y anotá su número.</li>
        <li>Abrí el certificado con el Bloc de notas, copiá todo el texto y pegalo acá abajo.</li></ol></div>
    <div id="arca-cert-box" ${a.tieneClave?'':'hidden'}>
      <div class="field"><label for="arca-cert">Certificado que devolvió ARCA</label><textarea id="arca-cert" rows="5" class="mono small" placeholder="-----BEGIN CERTIFICATE-----"></textarea></div>
      <div class="actions start"><button class="btn primary" type="button" id="arca-cert-g">Guardar certificado</button></div></div>
    <h3 style="margin-top:14px">2. Punto de venta y ambiente</h3>
    <div class="grid2">${F('Punto de venta (número)','arca-pv',`<input id="arca-pv" type="number" inputmode="numeric" min="1" max="99999" value="${esc(a.pv||'')}">`)}
      ${F('Ambiente','arca-amb',`<select id="arca-amb"><option value="homo"${a.amb!=='prod'?' selected':''}>Pruebas (facturas sin validez)</option><option value="prod"${a.amb==='prod'?' selected':''}>Producción (facturas reales)</option></select>`)}</div>
    <div class="actions start"><button class="btn" type="button" id="arca-pv-g">Guardar</button><button class="btn" type="button" id="arca-probar" ${a.tieneCert?'':'disabled'}>Probar conexión con ARCA</button></div>
    <div id="arca-res" class="hint" aria-live="polite"></div>
    <div class="small muted" style="margin-top:10px">${a.listo?(a.amb==='prod'?'<b>Listo para facturar de verdad.</b>':'<b>Listo para probar.</b> Cuando todo salga bien, probá con el ambiente «Producción» (y su propio certificado y punto de venta, que se piden aparte en ARCA).'):'Todavía falta completar los pasos de arriba.'} El certificado y la clave quedan guardados solo en el servidor y no se copian al servidor de respaldo.</div>`;
  const res=$('#arca-res',el),aviso=(t,mal)=>{res.className=mal?'notice bad':'notice ok';res.textContent=t;};
  const rec=()=>arcaAjustesMount(el);
  const gen=$('#arca-gen',el);
  if(gen)gen.addEventListener('click',async()=>{
    if(a.tieneClave&&!await askConfirm('Si generás un pedido nuevo, el certificado actual deja de servir y tenés que pedir otro en ARCA. ¿Seguimos?','Generar uno nuevo'))return;
    gen.disabled=true;
    try{await NET.api('POST','/api/arca/clave',{reemplazar:!!a.tieneClave});toast('Pedido de certificado creado');rec();}
    catch(err){gen.disabled=false;toast(err.network?'No se pudo conectar con el servidor':err.message,'bad');}
  });
  const cc=$('#arca-csr-c',el);if(cc)cc.addEventListener('click',()=>copyText(a.csr,'Pedido de certificado'));
  const cd=$('#arca-csr-d',el);if(cd)cd.addEventListener('click',()=>{const u=URL.createObjectURL(new Blob([a.csr],{type:'application/x-pem-file'})),l=document.createElement('a');l.href=u;l.download='yapur-pedido.csr';document.body.appendChild(l);l.click();l.remove();setTimeout(()=>URL.revokeObjectURL(u),20000);});
  const cg=$('#arca-cert-g',el);
  if(cg)cg.addEventListener('click',async()=>{
    cg.disabled=true;
    try{await NET.api('POST','/api/arca/certificado',{pem:$('#arca-cert',el).value});toast('Certificado guardado');rec();}
    catch(err){cg.disabled=false;aviso(err.network?'No se pudo conectar con el servidor.':err.message,true);}
  });
  $('#arca-pv-g',el).addEventListener('click',async()=>{
    try{await NET.api('PUT','/api/arca',{pv:Number($('#arca-pv',el).value),amb:$('#arca-amb',el).value});toast('Guardado');rec();}
    catch(err){aviso(err.network?'No se pudo conectar con el servidor.':err.message,true);}
  });
  const pb=$('#arca-probar',el);
  if(pb)pb.addEventListener('click',async()=>{
    pb.disabled=true;res.className='hint';res.textContent='Conectando con ARCA…';
    try{
      const r=await NET.api('POST','/api/arca/probar',{});
      const pts=(r.puntos||[]).map(p=>p.nro+(p.bloqueado?' (bloqueado)':'')).join(', ');
      const ok=!r.pvError&&!r.puntosError;
      aviso('Conexión con ARCA ('+(r.ambiente==='prod'?'producción':'pruebas')+') correcta. '+(pts?'Puntos de venta que ARCA ve: '+pts+'. ':(r.puntosError?'No pude leer los puntos de venta: '+r.puntosError+'. ':'ARCA no informó puntos de venta. '))+(r.pvError?'Problema con el punto de venta cargado: '+r.pvError:(r.ultimaB!=null?'Última factura B: '+r.ultimaB+' · última A: '+r.ultimaA+'.':'')),!ok);
    }catch(err){aviso(err.network?'No se pudo conectar con el servidor.':err.message,true);}
    pb.disabled=false;
  });
}

/* ----- Factura para imprimir / PDF ----- */
const FE_CSS='.fe{background:#fff;color:#111;border:1px solid #222;font:13px/1.45 system-ui,sans-serif;max-width:680px;margin:0 auto}.fe *{box-sizing:border-box}.fe .h{display:grid;grid-template-columns:1fr 64px 1fr;border-bottom:1px solid #222}.fe .h>div{padding:10px 12px}.fe .l{text-align:center;border-left:1px solid #222;border-right:1px solid #222;padding:6px 4px!important}.fe .l b{font-size:30px;line-height:1;display:block}.fe .l span{font-size:10px}.fe .b{padding:8px 12px;border-bottom:1px solid #222}.fe table{width:100%;border-collapse:collapse}.fe th,.fe td{padding:4px 8px;text-align:left;border-bottom:1px solid #ddd}.fe .r{text-align:right}.fe .tot{padding:8px 12px;text-align:right;border-bottom:1px solid #222}.fe .pie{display:flex;gap:12px;align-items:center;padding:10px 12px}.fe .pie svg{flex:none}.fe .t2{font-size:15px;font-weight:700}.fe .prueba{background:#fde8e8;color:#8a1111;text-align:center;font-weight:700;padding:6px}';
function facturaHTML(fe,ps){
  const R=S.ajustes.recibo||{},esNc=!!fe.esNc,A=FE_LETRA[fe.tipo]==='A';
  const lineas=esNc?[`Anulación de la factura ${feNro(fe.orig)}`]:ps.filter(p=>!p.anulado).map(p=>(CONCEPTOS[p.concepto]||p.concepto||'Servicio')+(p.concepto==='mensualidad'&&p.per?' '+p.per:''));
  const items=esNc?[[lineas[0],fe.total]]:ps.filter(p=>!p.anulado).map((p,i)=>[lineas[i],Number(p.monto)||0]);
  const qr=QR.svg('https://www.arca.gob.ar/fe/qr/?p='+btoa(JSON.stringify({ver:1,fecha:fe.fecha,cuit:Number(fe.cuit),ptoVta:fe.pv,tipoCmp:fe.tipo,nroCmp:fe.nro,importe:fe.total,moneda:'PES',ctz:1,tipoDocRec:fe.docTipo,nroDocRec:Number(fe.docNro),tipoCodAut:'E',codAut:Number(fe.cae)})),120);
  const doc=fe.docTipo===80?'CUIT':fe.docTipo===96?'DNI':'Doc.';
  return `<style>${FE_CSS}</style><div class="fe">${fe.amb!=='prod'?'<div class="prueba">COMPROBANTE DE PRUEBA · SIN VALIDEZ FISCAL</div>':''}
    <div class="h"><div><div class="t2">${esc(R.razon||'')}</div>${R.leyenda?`<div>${esc(R.leyenda)}</div>`:''}<div>${esc(R.dom||'')}</div><div><b>IVA Responsable Inscripto</b></div></div>
      <div class="l"><b>${FE_LETRA[fe.tipo]}</b><span>COD. ${FE_COD[fe.tipo]}</span></div>
      <div><div class="t2">${FE_NOMBRE[fe.tipo]}</div><div>N° <b>${esc(feNro(fe))}</b></div><div>Fecha: <b>${esc(feFecha(fe.fecha))}</b></div><div>CUIT: ${esc(fe.cuit)}</div>${R.iibb?`<div>Ing. Brutos: ${esc(R.iibb)}</div>`:''}${R.inicio?`<div>Inicio de actividades: ${esc(R.inicio)}</div>`:''}</div></div>
    <div class="b"><div>Cliente: <b>${esc(fe.nombre)}</b></div><div>${doc}: ${fe.docTipo===99?'—':esc(fe.docNro)} · ${esc(FE_COND[fe.condIva]||'')}</div><div>Condición de venta: Contado</div></div>
    <table><thead><tr><th>Descripción</th><th class="r">Importe</th></tr></thead><tbody>${items.map(([d,m])=>`<tr><td>${esc(d)}</td><td class="r">${esc(fePesos(A?m/1.21:m))}</td></tr>`).join('')}</tbody></table>
    <div class="tot">${A?`<div>Importe neto gravado: ${esc(fePesos(fe.neto))}</div><div>IVA 21 %: ${esc(fePesos(fe.iva))}</div>`:''}<div class="t2">Total: ${esc(fePesos(fe.total))}</div>${A?'':`<div class="small">Régimen de Transparencia Fiscal (Ley 27.743) · IVA contenido: ${esc(fePesos(fe.iva))}</div>`}</div>
    <div class="pie">${qr}<div><div>CAE N°: <b>${esc(fe.cae)}</b></div><div>Vencimiento del CAE: <b>${esc(feVto(fe.vto))}</b></div><div class="small">Comprobante autorizado por ARCA</div></div></div></div>`;
}
function imprimirHTML(html,titulo){
  const b=window.YapurApp;
  if(b){
    if(typeof b.printHtml!=='function')return toast('Para imprimir desde el celular instalá la última versión de la app.','bad');
    let r='';try{r=String(b.printHtml(html,titulo)||'');}catch(_){r='No se pudo abrir la impresión.';}
    if(r!=='ok')toast(r||'No se pudo abrir la impresión.','bad');
    return;
  }
  try{
    const f=document.createElement('iframe');f.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0';document.body.appendChild(f);
    const w=f.contentWindow,doc=w.document;doc.open();doc.write('<!doctype html><meta charset="utf-8"><title>'+esc(titulo)+'</title><style>@page{size:A4 portrait;margin:10mm}html,body{margin:0;background:#fff}</style>'+html);doc.close();
    setTimeout(()=>{try{w.focus();w.print();}catch(_){toast('Este navegador no puede imprimir.','bad');}setTimeout(()=>f.remove(),2000);},150);
  }catch(_){toast('Este navegador no puede imprimir.','bad');}
}
function openFactura(recibo,verNc){
  const ps=paymentsOfReceipt(recibo),p0=ps.find(x=>x.fe&&x.fe.cae);if(!p0)return toast('Este recibo no tiene factura','bad');
  const f0=p0.fe,fe=verNc&&f0.nc?Object.assign({},f0.nc,{esNc:true,orig:f0}):f0;
  const R=S.ajustes.recibo||{},c=S.clientes.get(ps[0].c),tel=c&&c.tel;
  const txt=`${R.leyenda||R.razon||'YAPUR'} · ${FE_NOMBRE[fe.tipo]} ${FE_LETRA[fe.tipo]} ${feNro(fe)} por ${fePesos(fe.total)}. CAE ${fe.cae}. Podés verificarla en https://www.arca.gob.ar/fe/qr/?p=${btoa(JSON.stringify({ver:1,fecha:fe.fecha,cuit:Number(fe.cuit),ptoVta:fe.pv,tipoCmp:fe.tipo,nroCmp:fe.nro,importe:fe.total,moneda:'PES',ctz:1,tipoDocRec:fe.docTipo,nroDocRec:Number(fe.docNro),tipoCodAut:'E',codAut:Number(fe.cae)}))}`;
  openModal({title:(verNc?'Nota de crédito ':'Factura ')+feNro(fe),wide:true,html:`${facturaHTML(fe,ps)}
    <div class="actions start" style="margin-top:12px"><button class="btn primary" type="button" id="fe-print">Imprimir o guardar como PDF</button>${tel?`<a class="btn" target="_blank" rel="noopener" href="${waUrl(tel,txt)}">Mandar por WhatsApp</a>`:''}<button class="btn" type="button" id="fe-copy">Copiar datos</button><button class="btn ghost" type="button" data-close>Cerrar</button></div>`,
    onMount(el){
      $('#fe-print',el).addEventListener('click',()=>imprimirHTML(facturaHTML(fe,ps),'Factura '+feNro(fe)));
      $('#fe-copy',el).addEventListener('click',()=>copyText(txt,'Datos de la factura'));
    }});
}

/* la factura llega a la pantalla con el aviso del servidor: se espera un instante a que figure en el pago antes de abrirla */
function arcaEsperar(recibo,cond,fin){
  let n=0;const t=setInterval(()=>{
    const p=paymentsOfReceipt(recibo).find(x=>x.fe&&x.fe.cae);
    if((p&&cond(p.fe))||++n>20){clearInterval(t);fin();}
  },150);
}
/* ----- En el recibo ----- */
function arcaReciboHTML(ps){
  const p0=ps.find(x=>x.fe&&x.fe.cae),oficina=can('cobrar')||can('caja');
  if(p0){
    const f=p0.fe;
    return `<div class="card flat" id="rc-fe" style="margin-top:12px"><div><b>${FE_NOMBRE[f.tipo]} ${FE_LETRA[f.tipo]} ${esc(feNro(f))}</b> · ${esc(fePesos(f.total))}${f.amb!=='prod'?' <span class="chip warn">prueba</span>':''}${f.nc?' <span class="chip">anulada con nota de crédito</span>':''}</div>
      <div class="small muted">CAE ${esc(f.cae)} · vence ${esc(feVto(f.vto))}</div>
      <div class="actions start" style="margin-top:8px"><button class="btn small" type="button" id="fe-ver">Ver factura</button>${f.nc?'<button class="btn small" type="button" id="fe-ver-nc">Ver nota de crédito</button>':(oficina&&can('anular')?'<button class="btn small danger" type="button" id="fe-nc">Anular con nota de crédito</button>':'')}</div></div>`;
  }
  if(!S.ajustes.arcaListo||!oficina||ps.every(x=>x.anulado))return '';
  return `<div class="actions start" id="rc-fe" style="margin-top:8px"><button class="btn" type="button" id="fe-emitir">Emitir factura ARCA</button></div>`;
}
function arcaReciboMount(el,recibo){
  const ps=paymentsOfReceipt(recibo),q=s=>$(s,el);
  const ver=q('#fe-ver');if(ver)ver.addEventListener('click',()=>openFactura(recibo));
  const vnc=q('#fe-ver-nc');if(vnc)vnc.addEventListener('click',()=>openFactura(recibo,true));
  const nc=q('#fe-nc');
  if(nc)nc.addEventListener('click',async()=>{
    if(!await askConfirm('Se emite una nota de crédito en ARCA por el total de la factura, y la factura queda anulada. No se puede deshacer. ¿Seguimos?','Emitir nota de crédito'))return;
    nc.disabled=true;
    try{await NET.api('POST','/api/arca/emitir',{doc:ps[0]._doc,recibo,nc:true});toast('Nota de crédito emitida');closeModal();arcaEsperar(recibo,f=>f.nc,()=>openReceipt(recibo));}
    catch(err){nc.disabled=false;toast(err.network?'No se pudo conectar con el servidor':err.message,'bad');}
  });
  const em=q('#fe-emitir');
  if(em)em.addEventListener('click',()=>arcaPedir(recibo,ps));
}
function arcaPedir(recibo,ps){
  const c=S.clientes.get(ps[0].c),head=c&&cuentaHead?cuentaHead(c):c,cli=head||c||{},total=ps.filter(p=>!p.anulado).reduce((s,p)=>s+(Number(p.monto)||0),0);
  const dni=String(cli.dni||'').replace(/\D/g,'');
  openModal({title:'Emitir factura ARCA',html:`<p class="small muted">Se factura el recibo <b>${esc(recibo)}</b> por <b>${esc(fePesos(total))}</b> (el IVA ya está incluido en el precio). Una vez emitida no se modifica: si hay un error, se anula con una nota de crédito.</p>
    ${F('Nombre o razón social','fe-nom','<input id="fe-nom" maxlength="100" value="'+esc(cli.nombre||'')+'">')}
    ${F('DNI o CUIT del cliente','fe-doc','<input id="fe-doc" inputmode="numeric" maxlength="13" value="'+esc(dni)+'">','Si queda vacío sale a «Consumidor final». Con CUIT se puede hacer Factura A.')}
    <div id="fe-cuit" hidden>${F('Condición del cliente frente al IVA','fe-iva','<select id="fe-iva"><option value="1">Responsable Inscripto</option><option value="6">Monotributista</option><option value="4">IVA Sujeto Exento</option><option value="7">No categorizado</option></select>')}
      ${F('Tipo de factura','fe-tipo','<select id="fe-tipo"><option value="1">Factura A (IVA discriminado)</option><option value="6">Factura B</option></select>')}</div>
    <div class="notice ${S.ajustes.arcaProd?'info':'warn'}" style="margin-top:8px">${S.ajustes.arcaProd?'Es una factura real: ARCA la registra.':'Ambiente de pruebas: la factura no tiene validez.'}</div>
    <div class="actions"><button class="btn primary" type="button" id="fe-go">Emitir factura</button><button class="btn ghost" type="button" data-close>Cancelar</button></div>`,
    onMount(el){
      const doc=$('#fe-doc',el),box=$('#fe-cuit',el),sync=()=>{box.hidden=doc.value.replace(/\D/g,'').length!==11;};
      doc.addEventListener('input',sync);sync();
      $('#fe-go',el).addEventListener('click',async ev=>{
        const b=ev.currentTarget,dn=doc.value.replace(/\D/g,'');
        if(dn&&dn.length!==11&&(dn.length<7||dn.length>8))return toast('El DNI tiene 7 u 8 números y el CUIT 11.','bad');
        b.disabled=true;
        try{
          const r=await NET.api('POST','/api/arca/emitir',{doc:ps[0]._doc,recibo,nombre:$('#fe-nom',el).value,docNro:dn,condIva:Number($('#fe-iva',el).value),tipo:Number($('#fe-tipo',el).value)});
          toast('Factura emitida: '+FE_NOMBRE[r.fe.tipo]+' '+FE_LETRA[r.fe.tipo]+' '+feNro(r.fe));
          closeModal();
          arcaEsperar(recibo,()=>true,()=>openFactura(recibo));
        }catch(err){b.disabled=false;toast(err.network?'No se pudo conectar con el servidor':err.message,'bad');}
      });
    }});
}
