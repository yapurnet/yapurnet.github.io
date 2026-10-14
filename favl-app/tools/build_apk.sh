#!/usr/bin/env bash
# Arma y firma la app FAVL Bandera Vuela: el APK (para instalar desde el enlace) y, si se pide, el AAB (para Google Play).
#   Uso: tools/build_apk.sh <archivo_de_salida.apk> [<archivo_de_salida.aab>]
# Variables de entorno requeridas:
#   KEYSTORE            ruta del archivo de clave (.keystore)
#   KEYSTORE_PASSWORD   contraseña del keystore
#   KEY_ALIAS           alias de la clave (favlapp)
#   KEY_PASSWORD        contraseña de la clave
#   VERSION_CODE        número de versión entero (siempre creciente)
#   VERSION_NAME        texto de versión (se ve en Ajustes > Aplicaciones)
# Herramientas: el SDK de Android (ANDROID_HOME o ANDROID_SDK_ROOT) con «platforms;android-36» y «build-tools» 35 o más nuevo,
#   un JDK 17 o más nuevo, y para el AAB, BUNDLETOOL_JAR (ruta de bundletool-all-*.jar).
# Opcional: EXPECTED_CERT_SHA256 (huella de la clave de FAVL), ANDROID_PLATFORM (android-36), BUILD_TOOLS (versión, p. ej. 36.0.0),
#           INSTR_VERSION (marca de tiempo), FAVL_SITE (https://<usuario>.github.io), INSTR_JSON_OUT (dónde dejar favl-instructores.json),
#           FAVL_REPO (usuario/repositorio al que la app manda los cambios de instructores),
#           FAVL_WORKER_URL (dirección https del Worker de Cloudflare: con ella la app NO lleva ninguna clave de GitHub;
#                            si no está, se lee favl-app/worker/worker-url.txt),
#           FAVL_ISSUES_TOKEN (modo anterior, sin Worker: clave de GitHub que lleva la app para publicar sin que nadie la escriba)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(realpath -m "${1:?Falta el nombre del APK de salida}")"
OUT_AAB="${2:+$(realpath -m "$2")}"
: "${KEYSTORE:?}" "${KEYSTORE_PASSWORD:?}" "${KEY_ALIAS:?}" "${KEY_PASSWORD:?}" "${VERSION_CODE:?}" "${VERSION_NAME:?}"
EXPECTED_CERT_SHA256="${EXPECTED_CERT_SHA256:-35543672e437a9400b0b27066f4cca0c3848e4565c6088b84b53a8b169c67c2c}"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[ -n "$SDK" ] && [ -d "$SDK" ] || { echo "ERROR: falta el SDK de Android (ANDROID_HOME)" >&2; exit 1; }
ANDROID_PLATFORM="${ANDROID_PLATFORM:-android-36}"
ANDROID_JAR="$SDK/platforms/$ANDROID_PLATFORM/android.jar"
[ -f "$ANDROID_JAR" ] || { echo "ERROR: falta $ANDROID_JAR (sdkmanager \"platforms;$ANDROID_PLATFORM\")" >&2; exit 1; }
BUILD_TOOLS="${BUILD_TOOLS:-$(ls "$SDK/build-tools" 2>/dev/null | sort -V | tail -1)}"
BT="$SDK/build-tools/$BUILD_TOOLS"
for h in aapt2 d8 zipalign apksigner; do [ -x "$BT/$h" ] || { echo "ERROR: falta $BT/$h" >&2; exit 1; }; done
if [ -n "$OUT_AAB" ]; then [ -f "${BUNDLETOOL_JAR:-}" ] || { echo "ERROR: para el AAB hace falta BUNDLETOOL_JAR" >&2; exit 1; }; fi
export KEYSTORE_PASSWORD KEY_PASSWORD VERSION_CODE VERSION_NAME
# Marca de tiempo de la lista de instructores: la lleva el APK y también el favl-instructores.json publicado.
export INSTR_VERSION="${INSTR_VERSION:-$(date +%s)}"
export FAVL_SITE="${FAVL_SITE:-https://yapurnet.github.io}"
export FAVL_REPO="${FAVL_REPO:-${GITHUB_REPOSITORY:-yapurnet/yapurnet.github.io}}"
export FAVL_ISSUES_TOKEN="${FAVL_ISSUES_TOKEN:-}"
# Dirección del Worker: la variable de entorno manda; si no, el archivo worker/worker-url.txt (la primera línea que no sea comentario)
FAVL_WORKER_URL="${FAVL_WORKER_URL:-}"
if [ -z "$FAVL_WORKER_URL" ] && [ -f "$ROOT/worker/worker-url.txt" ]; then
  FAVL_WORKER_URL="$(grep -v '^[[:space:]]*#' "$ROOT/worker/worker-url.txt" | tr -d '[:space:]' | head -c 300 || true)"
fi
export FAVL_WORKER_URL

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> 1/7 Examen: adaptación para la app"
RAW="$(python3 "$ROOT/tools/pick_raw.py" "$ROOT/raw")"
echo "    usando: $RAW"
mkdir -p "$WORK/assets/www/js"
# Lista de instructores = la del examen + los cambios hechos desde las apps (favl-app/data/instructores-cambios.json).
# También valida que la lista esté bien y deja el examen con la lista ya fusionada (el APK nace al día).
INSTR_JSON_OUT="${INSTR_JSON_OUT:-$WORK/favl-instructores.json}"
node "$ROOT/tools/extract_instructores.js" "$RAW" "$INSTR_JSON_OUT" "$INSTR_VERSION" \
     "$ROOT/data/instructores-cambios.json" "$WORK/examen_fusionado.html"
if [ -n "$FAVL_WORKER_URL" ]; then
  echo "    Modo Worker: la app habla con $FAVL_WORKER_URL y NO lleva ninguna clave de GitHub."
elif [ -n "$FAVL_ISSUES_TOKEN" ]; then
  echo "    AVISO: modo anterior (sin Worker): la clave de GitHub viaja DENTRO del APK, y de ahí se puede sacar. Ver favl-app/worker/LEEME.md."
else
  echo "    AVISO: esta versión de la app no trae la clave de GitHub: cada instructor que cargue instructores tendrá que pegarla una vez."
fi
python3 "$ROOT/tools/patch_examen.py" "$WORK/examen_fusionado.html" "$WORK/assets/www/examen.html"

echo "==> 2/7 Páginas de la app"
cp "$ROOT/www/cuestionario.html" "$WORK/assets/www/"
# El menú lleva el aviso de «hay una versión nueva» (usa VERSION_CODE y VERSION_NAME)
python3 "$ROOT/tools/aviso_lib.py" inyectar "$ROOT/www/index.html" "$WORK/assets/www/index.html"
cp "$ROOT/www/js/jspdf.umd.min.js" "$WORK/assets/www/js/"

echo "==> 3/7 Código Java (favl-app/app/src) → classes.dex"
mkdir -p "$WORK/classes" "$WORK/dex"
javac -encoding UTF-8 --release 8 -Xlint:-options -nowarn -cp "$ANDROID_JAR" -d "$WORK/classes" $(find "$ROOT/app/src" -name '*.java')
"$BT/d8" --release --min-api 23 --lib "$ANDROID_JAR" --output "$WORK/dex" $(find "$WORK/classes" -name '*.class')

echo "==> 4/7 Manifiesto (versión $VERSION_NAME / código $VERSION_CODE) y recursos"
case "$VERSION_CODE" in ''|*[!0-9]*) echo "ERROR: VERSION_CODE debe ser un número entero" >&2; exit 1;; esac
sed -e "s/__VERSION_CODE__/$VERSION_CODE/" -e "s/__VERSION_NAME__/$VERSION_NAME/" \
    "$ROOT/app/AndroidManifest.xml" > "$WORK/AndroidManifest.xml"
"$BT/aapt2" compile --dir "$ROOT/app/res" -o "$WORK/res.zip"

echo "==> 5/7 Empaquetado y firma del APK"
"$BT/aapt2" link -o "$WORK/base.apk" -I "$ANDROID_JAR" --manifest "$WORK/AndroidManifest.xml" -A "$WORK/assets" "$WORK/res.zip"
(cd "$WORK/dex" && zip -X -q "$WORK/base.apk" classes.dex)
"$BT/zipalign" -f -p 4 "$WORK/base.apk" "$WORK/aligned.apk"
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-key-alias "$KEY_ALIAS" \
    --ks-pass env:KEYSTORE_PASSWORD --key-pass env:KEY_PASSWORD --v4-signing-enabled false --out "$OUT" "$WORK/aligned.apk"

echo "==> 6/7 Verificación del APK"
"$BT/apksigner" verify "$OUT"
CERT="$("$BT/apksigner" verify --print-certs "$OUT" | awk '/certificate SHA-256 digest/ {print $NF; exit}')"
if [ "$CERT" != "$EXPECTED_CERT_SHA256" ]; then
  rm -f "$OUT"
  echo "ERROR: la clave de firma NO es la de FAVL (huella $CERT). No se publica el APK:" >&2
  echo "       con otra clave, Android obligaría a desinstalar la app y se perderían los datos del celular." >&2
  exit 1
fi
"$BT/zipalign" -c -p 4 "$OUT"
BADGE="$("$BT/aapt2" dump badging "$OUT")"
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

if [ -n "$OUT_AAB" ]; then
  echo "==> 7/7 AAB para Google Play"
  # Mismo contenido que el APK, en el formato de Google Play (recursos en «proto» y carpetas por módulo)
  "$BT/aapt2" link --proto-format -o "$WORK/proto.apk" -I "$ANDROID_JAR" --manifest "$WORK/AndroidManifest.xml" -A "$WORK/assets" "$WORK/res.zip"
  mkdir -p "$WORK/modulo/base/manifest" "$WORK/modulo/base/dex"
  (cd "$WORK/modulo/base" && unzip -q "$WORK/proto.apk" && mv AndroidManifest.xml manifest/)
  cp "$WORK/dex/classes.dex" "$WORK/modulo/base/dex/"
  (cd "$WORK/modulo/base" && zip -X -q -r "$WORK/base-module.zip" .)
  rm -f "$OUT_AAB"
  java -jar "$BUNDLETOOL_JAR" build-bundle --modules="$WORK/base-module.zip" --output="$WORK/sin-firma.aab"
  # Se firma con la misma clave de FAVL (en Play Console: «clave de carga» = esta clave)
  jarsigner -sigalg SHA256withRSA -digestalg SHA-256 -keystore "$KEYSTORE" -storepass:env KEYSTORE_PASSWORD -keypass:env KEY_PASSWORD \
    -signedjar "$OUT_AAB" "$WORK/sin-firma.aab" "$KEY_ALIAS" > /dev/null
  jarsigner -verify "$OUT_AAB" > /dev/null || { echo "ERROR: la firma del AAB no verifica" >&2; rm -f "$OUT_AAB"; exit 1; }
  # Comprobación: del AAB sale una app instalable con el mismo paquete, versión y contenido
  java -jar "$BUNDLETOOL_JAR" build-apks --bundle="$OUT_AAB" --output="$WORK/prueba.apks" --mode=universal
  (cd "$WORK" && unzip -q -o prueba.apks universal.apk)
  "$BT/aapt2" dump badging "$WORK/universal.apk" | grep -q "^package: name='ar.com.banderavuela.favlapp' versionCode='$VERSION_CODE'" \
    || { echo "ERROR: el AAB no tiene el paquete/versión esperados" >&2; rm -f "$OUT_AAB"; exit 1; }
  for f in classes.dex assets/www/index.html assets/www/cuestionario.html assets/www/examen.html; do
    unzip -Z1 "$WORK/universal.apk" | grep -qxF "$f" || { echo "ERROR: falta $f dentro del AAB" >&2; rm -f "$OUT_AAB"; exit 1; }
  done
  echo "Listo: $OUT_AAB ($(du -h "$OUT_AAB" | cut -f1))"
fi
