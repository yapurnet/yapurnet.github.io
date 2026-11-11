/* Factura electrónica de ARCA (ex AFIP): certificado, acceso (WSAA) y emisión (WSFE).
   Todo con WebCrypto y un armador mínimo de DER: sin bibliotecas, así entra en el plan gratis sin tocar el armado del servidor.
   Nada de acá guarda ni pide la clave fiscal: se usa un certificado digital propio de YAPUR.NET (la clave privada se crea acá y no sale del servidor). */

const enc = new TextEncoder();
const hex = u8 => [...u8].map(b => b.toString(16).padStart(2, '0')).join('');
const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const cat = (...a) => { const n = a.reduce((s, x) => s + x.length, 0), o = new Uint8Array(n); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };

/* ---------- DER ---------- */
const dLen = n => n < 128 ? Uint8Array.of(n) : n < 256 ? Uint8Array.of(0x81, n) : n < 65536 ? Uint8Array.of(0x82, n >> 8, n & 255) : Uint8Array.of(0x83, n >> 16, (n >> 8) & 255, n & 255);
const tlv = (tag, ...c) => { const body = cat(...c); return cat(Uint8Array.of(tag), dLen(body.length), body); };
const SEQ = (...c) => tlv(0x30, ...c), SET = (...c) => tlv(0x31, ...c);
const OCT = u8 => tlv(0x04, u8), NUL = () => Uint8Array.of(5, 0);
const INT0 = () => Uint8Array.of(2, 1, 0);
const intU = u8 => { let i = 0; while (i < u8.length - 1 && u8[i] === 0) i++; let v = u8.subarray(i); if (v[0] & 128) v = cat(Uint8Array.of(0), v); return tlv(2, v); };
const BITS = u8 => tlv(3, Uint8Array.of(0), u8);
const UTF = s => tlv(0x0c, enc.encode(s)), PRT = s => tlv(0x13, enc.encode(s));
const OID = s => {
  const p = s.split('.').map(Number), o = [p[0] * 40 + p[1]];
  for (const n of p.slice(2)) { const t = []; let v = n; t.unshift(v & 127); v = Math.floor(v / 128); while (v > 0) { t.unshift((v & 127) | 128); v = Math.floor(v / 128); } o.push(...t); }
  return tlv(6, Uint8Array.from(o));
};
const O_SHA256 = '2.16.840.1.101.3.4.2.1', O_RSA = '1.2.840.113549.1.1.1', O_SHA256RSA = '1.2.840.113549.1.1.11';
const O_DATA = '1.2.840.113549.1.7.1', O_SIGNED = '1.2.840.113549.1.7.2';

/* lector mínimo: devuelve {tag, ini (inicio del contenido), fin, desde (inicio del elemento)} */
function rd(u8, p) {
  const desde = p, tag = u8[p++]; let n = u8[p++];
  if (n & 128) { const k = n & 127; n = 0; for (let i = 0; i < k; i++) n = n * 256 + u8[p++]; }
  return { tag, ini: p, fin: p + n, desde };
}
function hijos(u8, e) { const r = []; let p = e.ini; while (p < e.fin) { const c = rd(u8, p); r.push(c); p = c.fin; } return r; }

function pemADer(pem) {
  const m = /-----BEGIN [A-Z ]+-----([\s\S]+?)-----END [A-Z ]+-----/.exec(String(pem || ''));
  const t = (m ? m[1] : String(pem || '')).replace(/\s+/g, '');
  if (!t || !/^[A-Za-z0-9+/=]+$/.test(t)) throw new Error('El certificado no tiene el formato esperado (tiene que ser el texto que empieza con -----BEGIN CERTIFICATE-----).');
  return unb64(t);
}
const derAPem = (u8, tit) => '-----BEGIN ' + tit + '-----\n' + b64(u8).replace(/(.{64})/g, '$1\n').trim() + '\n-----END ' + tit + '-----\n';

/* ---------- certificado: pedido (CSR) ---------- */
export async function crearClave(cuit, empresa, alias) {
  cuit = String(cuit || '').replace(/\D/g, '');
  if (!/^\d{11}$/.test(cuit)) throw new Error('El CUIT tiene que tener 11 números.');
  const par = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const priv = new Uint8Array(await crypto.subtle.exportKey('pkcs8', par.privateKey));
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', par.publicKey));
  const limpio = s => String(s || '').replace(/[^A-Za-z0-9 .\-]/g, '').trim().slice(0, 60);
  const nombre = (x, v) => SET(SEQ(OID(x), v));
  const subject = SEQ(nombre('2.5.4.6', PRT('AR')), nombre('2.5.4.10', UTF(limpio(empresa) || 'YAPUR.NET')), nombre('2.5.4.3', UTF(limpio(alias).replace(/ /g, '') || 'yapur')), nombre('2.5.4.5', PRT('CUIT ' + cuit)));
  const info = SEQ(INT0(), subject, spki, tlv(0xa0));
  const firma = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', par.privateKey, info));
  const csr = SEQ(info, SEQ(OID(O_SHA256RSA), NUL()), BITS(firma));
  return { priv: b64(priv), pub: b64(spki), csr: derAPem(csr, 'CERTIFICATE REQUEST') };
}

/* datos del certificado que devuelve ARCA: número de serie, emisor, vencimiento y clave pública (para comprobar que es el de nuestro pedido) */
export function leerCert(pem) {
  const der = pemADer(pem);
  let cert;
  try {
    cert = rd(der, 0);
    const tbs = hijos(der, cert)[0];
    let h = hijos(der, tbs), i = 0;
    if (h[0].tag === 0xa0) i = 1;
    const serial = h[i], issuer = h[i + 2], valid = hijos(der, h[i + 3]), spki = h[i + 5];
    if (serial.tag !== 2 || issuer.tag !== 0x30 || spki.tag !== 0x30) throw new Error('x');
    const fecha = e => { const t = new TextDecoder().decode(der.subarray(e.ini, e.fin)); return e.tag === 0x17 ? (Number(t.slice(0, 2)) < 50 ? '20' : '19') + t.slice(0, 2) + '-' + t.slice(2, 4) + '-' + t.slice(4, 6) : t.slice(0, 4) + '-' + t.slice(4, 6) + '-' + t.slice(6, 8); };
    return { der, serial: der.slice(serial.ini, serial.fin), issuer: der.slice(issuer.desde, issuer.fin), desde: fecha(valid[0]), hasta: fecha(valid[1]), spki: der.slice(spki.desde, spki.fin) };
  } catch (e) { throw new Error('No pude leer el certificado: revisá que esté copiado completo.'); }
}

/* ---------- acceso (WSAA): pedido firmado ---------- */
export async function firmarCms(contenido, privB64, certInfo) {
  const key = await crypto.subtle.importKey('pkcs8', unb64(privB64), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const datos = enc.encode(contenido);
  const dig = new Uint8Array(await crypto.subtle.digest('SHA-256', datos));
  const ahora = new Date(), z = n => String(n).padStart(2, '0');
  const utc = ahora.getUTCFullYear().toString().slice(2) + z(ahora.getUTCMonth() + 1) + z(ahora.getUTCDate()) + z(ahora.getUTCHours()) + z(ahora.getUTCMinutes()) + z(ahora.getUTCSeconds()) + 'Z';
  const attr = (oid, v) => SEQ(OID(oid), SET(v));
  const attrs = [attr('1.2.840.113549.1.9.3', OID(O_DATA)), attr('1.2.840.113549.1.9.4', OCT(dig)), attr('1.2.840.113549.1.9.5', tlv(0x17, enc.encode(utc)))];
  const firma = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, SET(...attrs)));
  const algDig = SEQ(OID(O_SHA256), NUL());
  const signer = SEQ(Uint8Array.of(2, 1, 1), SEQ(certInfo.issuer, intU(certInfo.serial)), algDig, tlv(0xa0, ...attrs), SEQ(OID(O_RSA), NUL()), OCT(firma));
  const signed = SEQ(Uint8Array.of(2, 1, 1), SET(algDig), SEQ(OID(O_DATA), tlv(0xa0, OCT(datos))), tlv(0xa0, certInfo.der), SET(signer));
  return b64(SEQ(OID(O_SIGNED), tlv(0xa0, signed)));
}

/* ---------- SOAP ---------- */
const URLS = {
  prod: { wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms', wsfe: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx' },
  homo: { wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms', wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx' }
};
export const urlsDe = (amb, mock) => mock ? { wsaa: mock + '/wsaa', wsfe: mock + '/wsfe' } : (amb === 'prod' ? URLS.prod : URLS.homo);
const xesc = s => String(s == null ? '' : s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const xdes = s => String(s == null ? '' : s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const tag = (xml, t) => { const m = new RegExp('<(?:\\w+:)?' + t + '(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?' + t + '>').exec(xml); return m ? xdes(m[1]).trim() : ''; };
const tags = (xml, t) => { const r = [], re = new RegExp('<(?:\\w+:)?' + t + '(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?' + t + '>', 'g'); let m; while ((m = re.exec(xml))) r.push(m[1]); return r; };

async function soap(url, action, cuerpo) {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 25000);
  let r, txt;
  try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: action }, body: cuerpo, signal: ctl.signal }); txt = await r.text(); }
  catch (e) { throw Object.assign(new Error('No pude comunicarme con ARCA (' + (e && e.name === 'AbortError' ? 'tardó demasiado' : 'sin conexión') + '). Probá de nuevo en unos minutos.'), { red: true }); }
  finally { clearTimeout(to); }
  const fault = tag(txt, 'faultstring');
  if (fault) throw new Error('ARCA rechazó el pedido: ' + fault.slice(0, 300));
  if (!r.ok && !txt.includes('<')) throw Object.assign(new Error('ARCA respondió con un error (' + r.status + ').'), { red: true });
  return txt;
}

export async function loginWsaa(urls, privB64, certInfo, servicio) {
  const a = new Date(Date.now() - 60e3), b = new Date(Date.now() + 10 * 3600e3);
  const iso = d => new Date(d.getTime() - 3 * 3600e3).toISOString().slice(0, 19) + '-03:00';
  const tra = '<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header><uniqueId>' + Math.floor(Date.now() / 1000) + '</uniqueId><generationTime>' + iso(a) + '</generationTime><expirationTime>' + iso(b) + '</expirationTime></header><service>' + xesc(servicio) + '</service></loginTicketRequest>';
  const cms = await firmarCms(tra, privB64, certInfo);
  const xml = await soap(urls.wsaa, '', '<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov"><soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>' + cms + '</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>');
  const ticket = tag(xml, 'loginCmsReturn') || xml;
  const token = tag(ticket, 'token'), sign = tag(ticket, 'sign'), vence = tag(ticket, 'expirationTime');
  if (!token || !sign) throw new Error('ARCA no devolvió el permiso de acceso.');
  return { token, sign, vence: Date.parse(vence) || Date.now() + 11 * 3600e3 };
}

/* ---------- facturación (WSFE) ---------- */
const NS = 'http://ar.gov.afip.dif.FEV1/';
const auth = (t, cuit) => '<ar:Auth><ar:Token>' + xesc(t.token) + '</ar:Token><ar:Sign>' + xesc(t.sign) + '</ar:Sign><ar:Cuit>' + xesc(cuit) + '</ar:Cuit></ar:Auth>';
async function fe(urls, op, cuerpo) {
  return soap(urls.wsfe, NS + op, '<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="' + NS + '"><soapenv:Header/><soapenv:Body><ar:' + op + '>' + cuerpo + '</ar:' + op + '></soapenv:Body></soapenv:Envelope>');
}
const errores = xml => {
  const e = tags(xml, 'Err').map(x => tag(x, 'Code') + ': ' + tag(x, 'Msg'));
  return e.length ? e.join(' · ') : '';
};

export async function ultimoNro(urls, t, cuit, pv, tipo) {
  const xml = await fe(urls, 'FECompUltimoAutorizado', auth(t, cuit) + '<ar:PtoVta>' + pv + '</ar:PtoVta><ar:CbteTipo>' + tipo + '</ar:CbteTipo>');
  const er = errores(xml); if (er) throw new Error('ARCA: ' + er);
  return Number(tag(xml, 'CbteNro')) || 0;
}
export async function puntosVenta(urls, t, cuit) {
  const xml = await fe(urls, 'FEParamGetPtosVenta', auth(t, cuit));
  const er = errores(xml); if (er) throw new Error('ARCA: ' + er);
  return tags(xml, 'PtoVenta').map(x => ({ nro: Number(tag(x, 'Nro')), tipo: tag(x, 'EmisionTipo'), bloqueado: tag(x, 'Bloqueado') === 'S', baja: tag(x, 'FchBaja') !== '' && tag(x, 'FchBaja') !== 'NULL' }));
}

/* tipos de comprobante: A=1, B=6, C=11 · notas de crédito: A=3, B=8, C=13 */
export const TIPOS_FE = { 1: 'Factura A', 6: 'Factura B', 11: 'Factura C', 3: 'Nota de crédito A', 8: 'Nota de crédito B', 13: 'Nota de crédito C' };
const ymd = f => String(f).replace(/-/g, '');
const r2 = n => (Math.round(n * 100) / 100).toFixed(2);

/* arma los importes: monotributo (C): sin IVA · responsable inscripto (A/B): el precio ya incluye el 21 % y se discrimina */
export function importes(total, tipo) {
  total = Math.round(total * 100) / 100;
  if (tipo === 11 || tipo === 13) return { total, neto: total, iva: 0 };
  const neto = Math.round(total / 1.21 * 100) / 100;
  return { total, neto, iva: Math.round((total - neto) * 100) / 100 };
}

/* c: { tipo, pv, concepto(2=servicios), docTipo, docNro, condIva (receptor), fecha 'AAAA-MM-DD', desde, hasta, vto, total, asociado:{tipo,pv,nro,fecha} para notas de crédito } */
export async function emitir(urls, t, cuit, c) {
  const nro = (await ultimoNro(urls, t, cuit, c.pv, c.tipo)) + 1;
  const im = importes(c.total, c.tipo);
  const iva = c.tipo === 11 || c.tipo === 13 ? '' : '<ar:Iva><ar:AlicIva><ar:Id>5</ar:Id><ar:BaseImp>' + r2(im.neto) + '</ar:BaseImp><ar:Importe>' + r2(im.iva) + '</ar:Importe></ar:AlicIva></ar:Iva>';
  const aso = c.asociado ? '<ar:CbtesAsoc><ar:CbteAsoc><ar:Tipo>' + c.asociado.tipo + '</ar:Tipo><ar:PtoVta>' + c.asociado.pv + '</ar:PtoVta><ar:Nro>' + c.asociado.nro + '</ar:Nro></ar:CbteAsoc></ar:CbtesAsoc>' : '';
  const det = '<ar:FECAEDetRequest><ar:Concepto>' + (c.concepto || 2) + '</ar:Concepto><ar:DocTipo>' + c.docTipo + '</ar:DocTipo><ar:DocNro>' + c.docNro + '</ar:DocNro><ar:CbteDesde>' + nro + '</ar:CbteDesde><ar:CbteHasta>' + nro + '</ar:CbteHasta><ar:CbteFch>' + ymd(c.fecha) + '</ar:CbteFch>' +
    '<ar:ImpTotal>' + r2(im.total) + '</ar:ImpTotal><ar:ImpTotConc>0.00</ar:ImpTotConc><ar:ImpNeto>' + r2(im.neto) + '</ar:ImpNeto><ar:ImpOpEx>0.00</ar:ImpOpEx><ar:ImpTrib>0.00</ar:ImpTrib><ar:ImpIVA>' + r2(im.iva) + '</ar:ImpIVA>' +
    ((c.concepto || 2) !== 1 ? '<ar:FchServDesde>' + ymd(c.desde || c.fecha) + '</ar:FchServDesde><ar:FchServHasta>' + ymd(c.hasta || c.fecha) + '</ar:FchServHasta><ar:FchVtoPago>' + ymd(c.vto || c.fecha) + '</ar:FchVtoPago>' : '') +
    '<ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz><ar:CondicionIVAReceptorId>' + (c.condIva || 5) + '</ar:CondicionIVAReceptorId>' + aso + iva + '</ar:FECAEDetRequest>';
  const xml = await fe(urls, 'FECAESolicitar', auth(t, cuit) + '<ar:FeCAEReq><ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>' + c.pv + '</ar:PtoVta><ar:CbteTipo>' + c.tipo + '</ar:CbteTipo></ar:FeCabReq><ar:FeDetReq>' + det + '</ar:FeDetReq></ar:FeCAEReq>');
  const er = errores(xml);
  const resultado = tag(xml, 'Resultado');
  const obs = tags(xml, 'Obs').map(x => tag(x, 'Code') + ': ' + tag(x, 'Msg')).join(' · ');
  if (resultado !== 'A') throw Object.assign(new Error('ARCA no autorizó la factura: ' + (er || obs || 'sin detalle')), { rechazo: true });
  return { nro, cae: tag(xml, 'CAE'), vto: tag(xml, 'CAEFchVto'), neto: im.neto, iva: im.iva, total: im.total, obs };
}

/* texto del código QR obligatorio de la factura (ARCA) */
export function qrUrl(f) {
  const j = { ver: 1, fecha: f.fecha, cuit: Number(f.cuit), ptoVta: f.pv, tipoCmp: f.tipo, nroCmp: f.nro, importe: f.total, moneda: 'PES', ctz: 1, tipoDocRec: f.docTipo, nroDocRec: Number(f.docNro), tipoCodAut: 'E', codAut: Number(f.cae) };
  return 'https://www.arca.gob.ar/fe/qr/?p=' + btoa(JSON.stringify(j));
}
export const _t = { SEQ, rd, hijos };
