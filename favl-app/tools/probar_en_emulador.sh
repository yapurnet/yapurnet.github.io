#!/usr/bin/env bash
# Prueba la app en un emulador de Android ya encendido (lo usa el flujo «Probar app FAVL»).
#   Uso: tools/probar_en_emulador.sh <app.apk> <carpeta_de_capturas>
# Instala la app, recorre menú → examen → «atrás», abre el teclado en la pantalla de acceso y saca capturas de cada paso.
# Falla si la app se cierra sola (error en el registro de Android) o si «atrás» no vuelve al menú.
set -uo pipefail
APK="${1:?Falta el APK}"
OUT="${2:?Falta la carpeta de capturas}"
PKG=ar.com.banderavuela.favlapp
mkdir -p "$OUT"
FALLAS=0
falla() { echo "::error::$*"; FALLAS=$((FALLAS + 1)); }
foto() { sleep 2; adb exec-out screencap -p > "$OUT/$1.png"; echo "    captura: $1"; }
arriba() { adb shell dumpsys activity activities | grep -m1 -E "topResumedActivity|mResumedActivity" || true; }

# Toca el elemento cuya descripción, texto o id contiene $1 (las páginas del WebView aparecen en el árbol de accesibilidad)
tocar() {
  local xy=""
  for intento in 1 2 3 4 5; do
    adb shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1
    adb pull /sdcard/ui.xml "$OUT/ui.xml" > /dev/null 2>&1
    xy="$(python3 - "$OUT/ui.xml" "$1" <<'PY'
import re, sys
xml = open(sys.argv[1], encoding='utf-8', errors='replace').read()
buscado = sys.argv[2].lower()
for nodo in re.findall(r'<node [^>]*>', xml):
    attrs = dict(re.findall(r'([\w-]+)="([^"]*)"', nodo))
    texto = ' '.join([attrs.get('text', ''), attrs.get('content-desc', ''), attrs.get('resource-id', '')]).lower()
    m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', attrs.get('bounds', ''))
    if buscado in texto and m:
        x1, y1, x2, y2 = map(int, m.groups())
        if x2 > x1 and y2 > y1:
            print((x1 + x2) // 2, (y1 + y2) // 2)
            break
PY
)"
    [ -n "$xy" ] && break
    sleep 3
  done
  if [ -z "$xy" ]; then falla "No encontré «$1» en la pantalla"; return 1; fi
  echo "    toco «$1» en $xy"
  adb shell input tap $xy
}

echo "==> Android $(adb shell getprop ro.build.version.release | tr -d '\r') (API $(adb shell getprop ro.build.version.sdk | tr -d '\r'))"
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0
adb install -r "$APK" || { falla "No se pudo instalar el APK"; exit 1; }
adb logcat -c

echo "==> 1. Abrir la app (menú)"
adb shell am start -W -n "$PKG/.MainActivity" > /dev/null
sleep 6
foto 1-menu

echo "==> 2. Entrar al examen"
tocar "Examen FAVL" && sleep 5
foto 2-examen

echo "==> 3. «Atrás» tiene que volver al menú sin salir de la app"
adb shell input keyevent KEYCODE_BACK
sleep 4
foto 3-atras
arriba | grep -q "$PKG" || falla "Con «atrás» la app se cerró en lugar de volver al menú"
adb shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1; adb pull /sdcard/ui.xml "$OUT/ui.xml" > /dev/null 2>&1
grep -q "Cuestionario de estudio" "$OUT/ui.xml" || falla "Después de «atrás» no se ve el menú"

echo "==> 4. Teclado en la pantalla de acceso al examen"
tocar "Examen FAVL" && sleep 5
if tocar "codigoAcceso"; then
  sleep 3
  adb shell input text "PRUEBA"
  foto 4-teclado
  adb shell dumpsys input_method | grep -q "mInputShown=true" || echo "    (aviso: el sistema no informa el teclado como visible)"
fi

echo "==> 5. «Atrás» desde el menú: la app pasa a segundo plano (comportamiento normal)"
adb shell input keyevent KEYCODE_BACK; sleep 2      # cierra el teclado
adb shell input keyevent KEYCODE_BACK; sleep 3      # vuelve al menú
foto 5-menu-otra-vez
adb shell input keyevent KEYCODE_BACK; sleep 3      # sale
foto 6-fuera-de-la-app

echo "==> 6. Errores en el registro de Android"
adb logcat -d > "$OUT/logcat.txt"
if grep -E "FATAL EXCEPTION|AndroidRuntime: Process: $PKG" "$OUT/logcat.txt"; then falla "La app tuvo un error grave (ver logcat.txt)"; fi
grep -iE "chromium.*Uncaught|Console.*Uncaught" "$OUT/logcat.txt" | head -20 > "$OUT/errores-js.txt" || true
[ -s "$OUT/errores-js.txt" ] && { echo "    errores de JavaScript (informativo):"; cat "$OUT/errores-js.txt"; }

rm -f "$OUT/ui.xml"
if [ "$FALLAS" -gt 0 ]; then echo "Hubo $FALLAS problema(s)."; exit 1; fi
echo "Todo bien."
