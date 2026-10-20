'use strict';
/* Arranca el servidor de verdad (workerd), corre un script de Playwright contra él y lo apaga. Uso: node run_e2e.js e2e.py */
const { spawn } = require('child_process');
const { start } = require('./harness');
(async () => {
  const code = 'TEST-CODE-1234-ABCD';
  const srv = await start({ code });
  const py = spawn(process.env.PYTHON || 'python3', ['-I', process.argv[2] || 'e2e.py'], { cwd: __dirname, env: Object.assign({}, process.env, { YAPUR_BASE: srv.base, YAPUR_CODE: code }), stdio: 'inherit' });
  py.on('exit', async c => { await srv.stop(); process.exit(c || 0); });
})().catch(e => { console.error(e); process.exit(1); });
