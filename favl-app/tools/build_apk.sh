#!/usr/bin/env bash
# Arma y firma el APK de FAVL Bandera Vuela.
#   Uso: tools/build_apk.sh <archivo_de_salida.apk>
# Variables de entorno requeridas:
#   KEYSTORE            ruta del archivo de clave (.keystore)
#   KEYSTORE_PASSWORD   contraseña del keystore
#   KEY_ALIAS           alias de la clave (favlapp)
#   KEY_PASSWORD        contraseña de la clave
#   VERSION_CODE        número de versión entero (siempre creciente)
#   VERSION_NAME        texto de versión (se ve en Ajustes > Aplicaciones)
# Opcional: EXPECTED_CERT_SHA256 (huella de la clave de FAVL), ANDROID_JAR,
#           INSTR_VERSION (marca de tiempo), FAVL_SITE (https://<usuario>.github.io), INSTR_JSON_OUT (dónde dejar favl-instructores.json),
#           FAVL_REPO (usuario/repositorio al que la app manda los cambios de instructores)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(realpath -m "${1:?Falta el nombre del APK de salida}")"
: "${KEYSTORE:?}" "${KEYSTORE_PASSWORD:?}" "${KEY_ALIAS:?}" "${KEY_PASSWORD:?}" "${VERSION_CODE:?}" "${VERSION_NAME:?}"
EXPECTED_CERT_SHA256="${EXPECTED_CERT_SHA256:-35543672e437a9400b0b27066f4cca0c3848e4565c6088b84b53a8b169c67c2c}"
ANDROID_JAR="${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}"
export KEYSTORE_PASSWORD KEY_PASSWORD
# Marca de tiempo de la lista de instructores: la lleva el APK y también el favl-instructores.json publicado.
export INSTR_VERSION="${INSTR_VERSION:-$(date +%s)}"
export FAVL_SITE="${FAVL_SITE:-https://yapurnet.github.io}"
export FAVL_REPO="${FAVL_REPO:-${GITHUB_REPOSITORY:-yapurnet/yapurnet.github.io}}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> 1/6 Examen: adaptación para la app"
RAW="$(python3 "$ROOT/tools/pick_raw.py" "$ROOT/raw")"
echo "    usando: $RAW"
mkdir -p "$WORK/assets/www/js"
# Lista de instructores = la del examen + los cambios hechos desde las apps (favl-app/data/instructores-cambios.json).
# También valida que la lista esté bien y deja el examen con la lista ya fusionada (el APK nace al día).
INSTR_JSON_OUT="${INSTR_JSON_OUT:-$WORK/favl-instructores.json}"
node "$ROOT/tools/extract_instructores.js" "$RAW" "$INSTR_JSON_OUT" "$INSTR_VERSION" \
     "$ROOT/data/instructores-cambios.json" "$WORK/examen_fusionado.html"
python3 "$ROOT/tools/patch_examen.py" "$WORK/examen_fusionado.html" "$WORK/assets/www/examen.html"

echo "==> 2/6 Páginas de la app"
cp "$ROOT/www/index.html" "$ROOT/www/cuestionario.html" "$WORK/assets/www/"
cp "$ROOT/www/js/jspdf.umd.min.js" "$WORK/assets/www/js/"

echo "==> 3/6 Manifiesto (versión $VERSION_NAME / código $VERSION_CODE)"
case "$VERSION_CODE" in ''|*[!0-9]*) echo "ERROR: VERSION_CODE debe ser un número entero" >&2; exit 1;; esac
sed -e "s/__VERSION_CODE__/$VERSION_CODE/" -e "s/__VERSION_NAME__/$VERSION_NAME/" \
    "$ROOT/app/AndroidManifest.xml" > "$WORK/AndroidManifest.xml"

echo "==> 4/6 Empaquetado"
aapt package -f -M "$WORK/AndroidManifest.xml" -S "$ROOT/app/res" -A "$WORK/assets" \
     -I "$ANDROID_JAR" -0 arsc -F "$WORK/base.apk"
cp "$ROOT/app/classes.dex" "$WORK/classes.dex"
(cd "$WORK" && zip -X -q base.apk classes.dex)
zipalign -f -p 4 "$WORK/base.apk" "$WORK/aligned.apk"

echo "==> 5/6 Firma con la clave de FAVL"
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
apksigner sign --ks "$KEYSTORE" --ks-key-alias "$KEY_ALIAS" \
    --ks-pass env:KEYSTORE_PASSWORD --key-pass env:KEY_PASSWORD --v4-signing-enabled false --out "$OUT" "$WORK/aligned.apk"

echo "==> 6/6 Verificación"
apksigner verify "$OUT"
CERT="$(apksigner verify --print-certs "$OUT" | awk '/certificate SHA-256 digest/ {print $NF; exit}')"
if [ "$CERT" != "$EXPECTED_CERT_SHA256" ]; then
  rm -f "$OUT"
  echo "ERROR: la clave de firma NO es la de FAVL (huella $CERT). No se publica el APK:" >&2
  echo "       con otra clave, Android obligaría a desinstalar la app y se perderían los datos del celular." >&2
  exit 1
fi
zipalign -c -p 4 "$OUT"
BADGE="$(aapt dump badging "$OUT")"
echo "$BADGE" | grep -q "^package: name='ar.com.banderavuela.favlapp' versionCode='$VERSION_CODE'" \
  || { echo "ERROR: el APK no tiene el paquete/versión esperados" >&2; rm -f "$OUT"; exit 1; }
LISTA="$(unzip -Z1 "$OUT")"
for f in AndroidManifest.xml classes.dex resources.arsc assets/www/index.html assets/www/cuestionario.html assets/www/examen.html assets/www/js/jspdf.umd.min.js; do
  printf '%s\n' "$LISTA" | grep -qxF "$f" || { echo "ERROR: falta $f dentro del APK" >&2; rm -f "$OUT"; exit 1; }
done
if ! unzip -Zv "$OUT" resources.arsc | grep -q "compression method:.*stored"; then
  echo "ERROR: resources.arsc debe ir sin comprimir (Android 11+ lo exige)" >&2; rm -f "$OUT"; exit 1
fi
echo "$BADGE" | grep -E "^package|sdkVersion|targetSdkVersion"
echo "Listo: $OUT ($(du -h "$OUT" | cut -f1)) — huella de la clave: $CERT"
