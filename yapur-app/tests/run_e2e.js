'use strict';
/* Arranca el servidor de verdad (workerd), corre un script de Playwright contra él y lo apaga. Uso: node run_e2e.js e2e.py
   Los scripts «whatsapp» arrancan además un WhatsApp de mentira (wa_mock.js) y el servidor queda conectado a él (YAPUR_WA es su dirección). */
const { spawn } = require('child_process');
const { start } = require('./harness');
const { mock } = require('./wa_mock');
const { mockArca } = require('./arca_mock');
(async () => {
  const code = 'TEST-CODE-1234-ABCD', file = process.argv[2] || 'e2e.py';
  let mk = null, vars;
  if (/whatsapp/.test(file)) { mk = mock('TOKEN-E2E'); await mk.start(); vars = { WA_TOKEN: 'TOKEN-E2E', WA_PHONE_ID: '555000111222', WA_API: mk.url, WA_RETRY_MS: '40' }; }
  let ar = null;
  if (/arca/.test(file)) { ar = mockArca(require('os').tmpdir()); const u = await ar.start(); vars = Object.assign({}, vars, { ARCA_MOCK: u }); }
  if (/ping/.test(file)) vars = Object.assign({}, vars, { PING_VENCE_MS: '3000' });   // para no esperar 45 s a que venza una prueba que nadie atendió
  if (/dispositivos/.test(file)) vars = Object.assign({}, vars, { DISP_APROBAR: '1' });   // esta prueba necesita que se pida aprobación de los equipos nuevos
  /* el respaldo necesita dos servidores que se hablan: A (trabaja) y B (espera); la prueba recibe la dirección de B en YAPUR_BASE_B */
  let srvB = null;
  if (/respaldo/.test(file)) {
    const pA = 21000 + Math.floor(Math.random() * 6000) * 2, pB = pA + 20000, KEY = 'clave-de-respaldo-de-prueba-0123456789abcdef';
    srvB = await start({ code, port: pB, vars: { REPLICA_URL: 'http://127.0.0.1:' + pA, REPLICA_KEY: KEY, REP_DEB_MS: '800', REP_BACK_MS: '700' } });
    vars = Object.assign({}, vars, { REPLICA_URL: 'http://127.0.0.1:' + pB, REPLICA_KEY: KEY, REPLICA_ROL: 'activo', REP_DEB_MS: '800', REP_BACK_MS: '700' });
    var portA = pA;
  }
  const srv = await start({ code, vars, port: typeof portA === 'number' ? portA : undefined });
  const py = spawn(process.env.PYTHON || 'python3', ['-I', file], { cwd: __dirname, env: Object.assign({}, process.env, { YAPUR_BASE: srv.base, YAPUR_CODE: code, YAPUR_WA: mk ? mk.url : '', YAPUR_BASE_B: srvB ? srvB.base : '' }), stdio: 'inherit' });
  py.on('exit', async c => { await srv.stop(); if (srvB) await srvB.stop(); if (mk) await mk.stop(); if (ar) await ar.stop(); process.exit(c || 0); });
})().catch(e => { console.error(e); process.exit(1); });
