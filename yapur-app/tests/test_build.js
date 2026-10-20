'use strict';
/* La app web publicada (worker/public) tiene que ser exactamente lo que sale de app/src: si alguien cambia el código y se olvida de armar, falla acá. */
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yapur-build-'));
const r = cp.spawnSync(process.execPath, [path.join(__dirname, '..', 'app', 'build.js'), tmp], { encoding: 'utf8' });
if (r.status !== 0) { console.log('FAIL no se pudo armar la app\n' + r.stderr); process.exit(1); }
let bad = 0;
for (const f of ['index.html', 'sw.js', 'version.json', 'manifest.webmanifest', '_headers', 'icon-192.png', 'icon-512.png']) {
  const a = fs.readFileSync(path.join(tmp, f)), b = fs.existsSync(path.join(__dirname, '..', 'worker', 'public', f)) ? fs.readFileSync(path.join(__dirname, '..', 'worker', 'public', f)) : null;
  if (!b || !a.equals(b)) { bad++; console.log('FAIL worker/public/' + f + ' no coincide con lo que arma app/build.js (corré: node yapur-app/app/build.js)'); } else console.log('ok   ' + f + ' al día');
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${bad ? 0 : 7} ok, ${bad} con fallas`);
process.exit(bad ? 1 : 0);
