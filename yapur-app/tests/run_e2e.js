'use strict';
/* Arranca el servidor de verdad (workerd), corre un script de Playwright contra él y lo apaga. Uso: node run_e2e.js e2e.py
   Los scripts «whatsapp» arrancan además un WhatsApp de mentira (wa_mock.js) y el servidor queda conectado a él (YAPUR_WA es su dirección). */
const { spawn } = require('child_process');
const { start } = require('./harness');
const { mock } = require('./wa_mock');
(async () => {
  const code = 'TEST-CODE-1234-ABCD', file = process.argv[2] || 'e2e.py';
  let mk = null, vars;
  if (/whatsapp/.test(file)) { mk = mock('TOKEN-E2E'); await mk.start(); vars = { WA_TOKEN: 'TOKEN-E2E', WA_PHONE_ID: '555000111222', WA_API: mk.url, WA_RETRY_MS: '40' }; }
  const srv = await start({ code, vars });
  const py = spawn(process.env.PYTHON || 'python3', ['-I', file], { cwd: __dirname, env: Object.assign({}, process.env, { YAPUR_BASE: srv.base, YAPUR_CODE: code, YAPUR_WA: mk ? mk.url : '' }), stdio: 'inherit' });
  py.on('exit', async c => { await srv.stop(); if (mk) await mk.stop(); process.exit(c || 0); });
})().catch(e => { console.error(e); process.exit(1); });
