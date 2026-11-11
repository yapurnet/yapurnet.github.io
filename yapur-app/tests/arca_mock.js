'use strict';
/* ARCA de mentira para las pruebas: acceso (WSAA) y facturación (WSFE) con las mismas reglas básicas que el verdadero. */
const http = require('http'), fs = require('fs'), { execFileSync } = require('child_process');
const sh = (args, o) => execFileSync('openssl', args, Object.assign({ encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }, o));
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/* certPath: si se pasa, verifica la firma del pedido de acceso con ese certificado. Devuelve { start, stop, url, log, setModo } */
function mockArca(dir, certPath) {
  const log = { wsaa: 0, fe: [], cms: null }, ult = {}; const est = { modo: 'ok' };
  const mock = http.createServer((rq, rs) => {
    let b = ''; rq.on('data', d => b += d); rq.on('end', () => {
      rs.setHeader('Content-Type', 'text/xml');
      if (rq.url === '/wsaa') {
        log.wsaa++;
        const cms = /<wsaa:in0>([^<]+)</.exec(b)[1];
        fs.writeFileSync(dir + '/acc.der', Buffer.from(cms, 'base64'));
        let c = '<service>wsfe</service>'; if (certPath) { try { c = sh(['cms', '-verify', '-inform', 'DER', '-in', dir + '/acc.der', '-noverify', '-CAfile', certPath]); } catch (e) { c = 'ERR'; } }
        log.cms = c;
        if (c === 'ERR' || !/<service>wsfe<\/service>/.test(c)) { rs.statusCode = 500; return rs.end('<soap:Fault><faultstring>firma inválida</faultstring></soap:Fault>'); }
        const ta = '<loginTicketResponse><header><expirationTime>' + new Date(Date.now() + 12 * 3600e3).toISOString() + '</expirationTime></header><credentials><token>TOK123</token><sign>SIG456</sign></credentials></loginTicketResponse>';
        return rs.end('<soap:Envelope><soap:Body><loginCmsResponse><loginCmsReturn>' + esc(ta) + '</loginCmsReturn></loginCmsResponse></soap:Body></soap:Envelope>');
      }
      const op = /<ar:(\w+)>/.exec(b.replace(/<ar:Auth>[\s\S]*?<\/ar:Auth>/, '')) ; const name = /<soapenv:Body><ar:(\w+)>/.exec(b)[1];
      log.fe.push({ name, b });
      if (!b.includes('<ar:Token>TOK123</ar:Token>') || !b.includes('<ar:Cuit>20325478307</ar:Cuit>')) return rs.end('<r><Errors><Err><Code>600</Code><Msg>token</Msg></Err></Errors></r>');
      if (name === 'FEParamGetPtosVenta') return rs.end('<r><ResultGet><PtoVenta><Nro>3</Nro><EmisionTipo>RECE para aplicativo y web services</EmisionTipo><Bloqueado>N</Bloqueado><FchBaja>NULL</FchBaja></PtoVenta></ResultGet></r>');
      const tipo = /<ar:CbteTipo>(\d+)/.exec(b)[1];
      if (name === 'FECompUltimoAutorizado') return rs.end('<r><CbteNro>' + (ult[tipo] || 0) + '</CbteNro></r>');
      if (est.modo === 'rechazo') return rs.end('<r><FeDetResp><FECAEDetResponse><Resultado>R</Resultado><Observaciones><Obs><Code>10015</Code><Msg>Documento inválido</Msg></Obs></Observaciones></FECAEDetResponse></FeDetResp></r>');
      const nro = Number(/<ar:CbteDesde>(\d+)/.exec(b)[1]);
      if (nro !== (ult[tipo] || 0) + 1) return rs.end('<r><Errors><Err><Code>10016</Code><Msg>numeración</Msg></Err></Errors></r>');
      const tot = Number(/<ar:ImpTotal>([\d.]+)/.exec(b)[1]), neto = Number(/<ar:ImpNeto>([\d.]+)/.exec(b)[1]), iva = Number(/<ar:ImpIVA>([\d.]+)/.exec(b)[1]);
      if (Math.abs(tot - neto - iva) > 0.005) return rs.end('<r><Errors><Err><Code>10048</Code><Msg>importes</Msg></Err></Errors></r>');
      ult[tipo] = nro;
      return rs.end('<r><FeDetResp><FECAEDetResponse><Resultado>A</Resultado><CAE>7' + String(nro).padStart(13, '0') + '</CAE><CAEFchVto>20261121</CAEFchVto></FECAEDetResponse></FeDetResp></r>');
    });
  });
  return {
    log, est,
    start: async () => { await new Promise(r => mock.listen(0, '127.0.0.1', r)); return 'http://127.0.0.1:' + mock.address().port; },
    stop: () => new Promise(r => mock.close(r))
  };
}
module.exports = { mockArca };
