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
/* Los celulares Android tachan los archivos cuyo tipo no coincide con `accept` (un CSV bajado del chat suele venir sin tipo): los selectores de archivo no filtran.
   Única excepción: el de «Sacar foto con la cámara» (capture), que lleva accept="image/*" porque Chrome solo abre la cámara directo con ese tipo; una foto siempre trae su tipo. */
const html = fs.readFileSync(path.join(tmp, 'index.html'), 'utf8'), files = html.match(/<input[^>]*type="file"[^>]*>/g) || [];
if (!files.length || files.some(t => /\baccept=/.test(t) && !(/\bcapture="environment"/.test(t) && /\baccept="image\/\*"/.test(t)))) { bad++; console.log('FAIL los selectores de archivo no pueden llevar accept (el celular tacha el archivo): ' + files.join(' ')); } else console.log('ok   ' + files.length + ' selectores de archivo sin filtro de tipo');
/* Recibo por WhatsApp desde el APK: con un número que WhatsApp todavía no conoce, el chat directo abre vacío y descarta la imagen.
   La primera vez con cada número se abre primero el chat y, al volver a la app (onResume), recién ahí se manda la imagen. */
const java = fs.readFileSync(path.join(__dirname, '..', 'android', 'src', 'ar', 'net', 'yapur', 'gestion', 'MainActivity.java'), 'utf8');
const resume = (java.match(/protected void onResume\(\) \{[\s\S]*?\n    \}\n/) || [''])[0];
const pasos = [[/private boolean chatListo\(String num\)/, 'saber si ese número ya se abrió antes'], [/private boolean abrirChat\(String num\)/, 'abrir el chat vacío primero'],
  [/!chatListo\(num\) && abrirChat\(num\)/, 'abrir el chat primero solo la primera vez'], [/marcarChatListo\(n\)/, 'recordar el número una vez enviado'], [/pendArch/, 'guardar el recibo pendiente']];
const faltan = pasos.filter(([re]) => !re.test(java)).map(x => x[1]);
if (!/pendArch != null/.test(resume) || !/enviarImagen\(f, n, c\)/.test(resume)) faltan.push('mandar el recibo al volver a la app (onResume)');
if (faltan.length) { bad++; console.log('FAIL MainActivity: falta ' + faltan.join(', ')); } else console.log('ok   APK: primer envío por WhatsApp abre el chat y manda el recibo al volver');
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${bad ? 0 : 9} ok, ${bad} con fallas`);
process.exit(bad ? 1 : 0);
