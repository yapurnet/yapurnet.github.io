'use strict';
/* Arma la app web (un solo index.html + service worker + íconos) a partir de src/ y la deja en worker/public,
   que es lo que publica Cloudflare. Uso: node build.js [carpeta de salida ...] */
const fs = require('fs'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
const src = path.join(__dirname, 'src');
const JS = ['p04_core.js', 'p04b_net.js', 'p05_clients.js', 'p05b_red.js', 'p06_plans_settings.js', 'p06c_profiles.js', 'p06b_import.js', 'p06d_routers.js', 'p07_orders.js', 'p08_pay.js', 'p09_boot.js', 'p09c_update.js', 'p09b_boot.js'];
const rd = f => fs.readFileSync(path.join(src, f), 'utf8');
const js = JS.map(rd).join('\n');
const tmp = path.join(require('os').tmpdir(), 'yapur-all-' + process.pid + '.js');
fs.writeFileSync(tmp, js);
const chk = cp.spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
fs.unlinkSync(tmp);
if (chk.status !== 0) { console.error(chk.stderr); process.exit(1); }
const base = rd('p01_head.html') + '\n' + rd('p02_css.css') + '\n' + rd('p03_body.html') + js + '\n' + rd('p10_end.html');
const ver = crypto.createHash('sha256').update(base).digest('hex').slice(0, 10);
const html = base.split('__BUILD__').join(ver);   // la app sabe qué versión es; /version.json dice cuál es la publicada
const outs = process.argv.slice(2);
if (!outs.length) outs.push(path.join(__dirname, '..', 'worker', 'public'));
for (const dir of outs) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  for (const f of ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', '_headers']) {
    const s = path.join(__dirname, 'assets', f);
    if (fs.existsSync(s)) fs.copyFileSync(s, path.join(dir, f));
  }
  fs.writeFileSync(path.join(dir, 'version.json'), JSON.stringify({ v: ver }) + '\n');
  fs.writeFileSync(path.join(dir, 'sw.js'), fs.readFileSync(path.join(__dirname, 'assets', 'sw.js'), 'utf8').replace('__VERSION__', ver));
  console.log('listo:', path.join(dir, 'index.html'), (html.length / 1024).toFixed(0) + ' KB · versión ' + ver);
}
