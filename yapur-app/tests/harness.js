'use strict';
/* Arranca el servidor de verdad (workerd, el mismo motor de Cloudflare) con «wrangler dev» y devuelve su dirección.
   Uso:  const { start } = require('./harness');  const w = await start();  ... w.base ... await w.stop();
   Opciones: { code } código de instalación de prueba (variable CODIGO_INSTALACION); si no se pasa, vale el código real (SETUP_HASH de wrangler.jsonc). */
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const WORKER_DIR = path.join(__dirname, '..', 'worker');
function findWrangler() {
  const c = [process.env.WRANGLER, path.join(__dirname, 'node_modules', '.bin', 'wrangler'), path.join(WORKER_DIR, 'node_modules', '.bin', 'wrangler')].filter(Boolean);
  for (const f of c) if (fs.existsSync(f)) return f;
  throw new Error('No encuentro wrangler. Instalalo con: cd yapur-app/tests && npm install   (o definí WRANGLER=/ruta/a/wrangler)');
}
async function start(opt) {
  opt = opt || {};
  const dir = opt.dir || fs.mkdtempSync(path.join(os.tmpdir(), 'yapur-w-'));
  const port = opt.port || 20000 + Math.floor(Math.random() * 20000);
  const args = ['dev', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', dir, '--inspector-port', String(port + 1)];
  if (opt.code) args.push('--var', 'CODIGO_INSTALACION:' + opt.code);
  for (const [k, v] of Object.entries(opt.vars || {})) args.push('--var', k + ':' + v);
  const p = spawn(findWrangler(), args, { cwd: WORKER_DIR, env: Object.assign({}, process.env, { CI: '1', WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' }), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  const base = 'http://127.0.0.1:' + port;
  let up = false;
  for (let i = 0; i < 300 && !up; i++) {
    if (p.exitCode !== null) throw new Error('wrangler dev se cerró:\n' + out);
    try { const r = await fetch(base + '/healthz'); up = r.ok; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  if (!up) { p.kill('SIGKILL'); throw new Error('wrangler dev no arrancó:\n' + out); }
  return {
    base, dir, port, log: () => out,
    stop: async (keep) => {
      p.kill('SIGTERM');
      await new Promise(r => { p.once('exit', r); setTimeout(r, 3000); });
      try { p.kill('SIGKILL'); } catch (e) { /* ya cerró */ }
      if (!keep && !opt.dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}
module.exports = { start, WORKER_DIR };
