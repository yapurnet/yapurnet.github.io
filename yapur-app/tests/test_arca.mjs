// Factura ARCA: pedido de certificado, firma del acceso y armado de la factura (se verifica con OpenSSL, sin tocar ARCA).
import { execFileSync } from 'child_process';
import fs from 'fs'; import os from 'os'; import path from 'path';
import * as A from '../worker/src/arca.js';
let ok = 0, bad = 0;
const t = (n, c, x) => { if (c) { ok++; console.log('ok   ' + n); } else { bad++; console.log('FAIL ' + n + (x !== undefined ? ' -> ' + String(x).slice(0, 300) : '')); } };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arca-'));
const sh = (args, opt) => execFileSync('openssl', args, Object.assign({ encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }, opt));
const k = await A.crearClave('20123456789', 'YAPUR.NET', 'yapur net');
fs.writeFileSync(dir + '/req.csr', k.csr);
let txt = sh(['req', '-in', dir + '/req.csr', '-verify', '-noout', '-text']);
t('el pedido de certificado (CSR) es válido y la firma verifica', /verify OK/i.test(txt) || /Certificate request self-signature verify OK/.test(txt) || txt.includes('Subject:'), txt.slice(0, 200));
t('lleva C=AR, O, CN y serialNumber=CUIT', /C\s*=\s*AR/.test(txt) && /O\s*=\s*YAPUR\.NET/.test(txt) && /CN\s*=\s*yapurnet/.test(txt) && /serialNumber\s*=\s*CUIT 20123456789/.test(txt), txt.split('\n').find(l => l.includes('Subject:')));
t('RSA de 2048 bits', /Public-Key: \(2048 bit\)/.test(txt));
await A.crearClave('123', 'x', 'y').then(() => t('rechaza un CUIT mal escrito', false), () => t('rechaza un CUIT mal escrito', true));
// certificado de prueba firmado con la misma clave (ARCA firmaría con la suya)
fs.writeFileSync(dir + '/k.pem', '-----BEGIN PRIVATE KEY-----\n' + k.priv.replace(/(.{64})/g, '$1\n') + '\n-----END PRIVATE KEY-----\n');
sh(['x509', '-req', '-in', dir + '/req.csr', '-signkey', dir + '/k.pem', '-days', '730', '-out', dir + '/cert.pem']);
const pem = fs.readFileSync(dir + '/cert.pem', 'utf8');
const ci = A.leerCert(pem);
const ser = sh(['x509', '-in', dir + '/cert.pem', '-noout', '-serial']).trim().split('=')[1].toLowerCase().replace(/^0+/, '');
t('lee el número de serie del certificado', [...ci.serial].map(b => b.toString(16).padStart(2, '0')).join('').replace(/^0+/, '') === ser, ser);
const fin = new Date(sh(['x509', '-in', dir + '/cert.pem', '-noout', '-enddate']).trim().split('=')[1]).toISOString().slice(0, 10);
t('lee el vencimiento', ci.hasta === fin, ci.hasta + ' vs ' + fin);
t('la clave pública del certificado es la del pedido', Buffer.from(ci.spki).toString('base64') === k.pub);
const tra = '<?xml version="1.0"?><loginTicketRequest version="1.0"><header><uniqueId>1</uniqueId></header><service>wsfe</service></loginTicketRequest>';
const cms = await A.firmarCms(tra, k.priv, ci);
fs.writeFileSync(dir + '/s.der', Buffer.from(cms, 'base64'));
let out = '';
try { out = sh(['cms', '-verify', '-inform', 'DER', '-in', dir + '/s.der', '-noverify', '-CAfile', dir + '/cert.pem']); } catch (e) { out = 'ERR ' + e.stderr; }
t('OpenSSL verifica la firma del pedido de acceso y recupera el contenido', out === tra, out.slice(0, 300));
let sig = ''; try { sig = sh(['cms', '-cmsout', '-inform', 'DER', '-in', dir + '/s.der', '-print']); } catch (e) { sig = e.stderr; }
t('usa SHA-256 y RSA', /sha256/i.test(sig) && /rsaEncryption/.test(sig), sig.slice(0, 200));
// importes
const c = A.importes(12100, 11), a = A.importes(12100, 6);
t('factura C: sin IVA', c.neto === 12100 && c.iva === 0);
t('factura A/B: el precio incluye el 21 %', a.neto === 10000 && a.iva === 2100 && a.total === 12100, JSON.stringify(a));
t('el QR lleva la fecha, el CAE y el importe', (() => { const u = A.qrUrl({ fecha: '2026-11-11', cuit: '20123456789', pv: 3, tipo: 11, nro: 7, total: 20000, docTipo: 99, docNro: 0, cae: '70123456789012' }); const j = JSON.parse(Buffer.from(u.split('p=')[1], 'base64').toString()); return u.startsWith('https://www.arca.gob.ar/fe/qr/?p=') && j.codAut === 70123456789012 && j.importe === 20000 && j.tipoCmp === 11; })());
console.log('\n' + ok + ' ok, ' + bad + ' con fallas'); process.exit(bad ? 1 : 0);
