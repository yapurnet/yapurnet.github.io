'use strict';
/* WhatsApp de mentira: hace de servidor de Meta en las pruebas. Anota cada pedido y contesta como se le indique.
   Modos:  ok · e400 (número no permitido) · e500 (siempre falla) · flaky2 (falla dos veces y después anda) · token (error que repite la clave, para ver que no se guarda)
   Por HTTP también se maneja:  /__modo?m=ok  ·  /__log  ·  /__limpiar */
const http = require('http');
function mock(token) {
  const reqs = []; let modo = 'ok', fallos = 0, n = 0, srv = null;
  const api = {
    reqs,
    set(m) { modo = m; fallos = 0; },
    clear() { reqs.length = 0; },
    async start() {
      srv = http.createServer((q, res) => {
        let b = ''; q.on('data', d => b += d);
        q.on('end', () => {
          const u = new URL(q.url, 'http://x');
          const out = (s, j) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
          if (u.pathname === '/__modo') { api.set(u.searchParams.get('m') || 'ok'); return out(200, { modo }); }
          if (u.pathname === '/__log') return out(200, reqs);
          if (u.pathname === '/__limpiar') { api.clear(); return out(200, {}); }
          let j = null; try { j = JSON.parse(b); } catch (e) { /* sin cuerpo */ }
          reqs.push({ method: q.method, url: u.pathname, auth: q.headers.authorization || '', body: j });
          if (modo === 'e400') return out(400, { error: { message: 'Recipient phone number not in allowed list', type: 'OAuthException', code: 131030, error_data: { messaging_product: 'whatsapp', details: 'Add the number first.' } } });
          if (modo === 'e500') return out(500, { error: { message: 'Internal error', code: 2 } });
          if (modo === 'flaky2' && fallos < 2) { fallos++; return out(500, { error: { message: 'Temporarily unavailable', code: 2 } }); }
          if (modo === 'token') return out(401, { error: { message: 'Invalid OAuth access token: ' + token + ' (revisar)', code: 190 } });
          out(200, { messaging_product: 'whatsapp', contacts: [{ input: j && j.to, wa_id: j && j.to }], messages: [{ id: 'wamid.TEST' + (++n) }] });
        });
      });
      await new Promise(r => srv.listen(0, '127.0.0.1', r));
      api.port = srv.address().port; api.url = 'http://127.0.0.1:' + api.port;
      return api;
    },
    stop() { return new Promise(r => { try { srv.close(r); } catch (e) { r(); } }); }
  };
  return api;
}
module.exports = { mock };
