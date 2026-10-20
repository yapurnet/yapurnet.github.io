#!/usr/bin/env bash
# Arma y firma el APK de Gestión YAPUR.NET (sin Gradle: javac + dx + aapt + zipalign + apksigner, igual que la app de FAVL).
#   Uso: android/build_apk.sh <archivo_de_salida.apk>
# Variables de entorno requeridas:
#   KEYSTORE, KEYSTORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD   la clave de firma (la misma que usa la app de FAVL)
#   VERSION_CODE   número entero siempre creciente      VERSION_NAME   texto de versión (se ve en Ajustes > Aplicaciones)
# Opcionales:
#   SERVER_URL            dirección https del sistema (si no, la primera línea que no sea comentario de server-url.txt)
#   EXPECTED_CERT_SHA256  huella esperada de la clave (por defecto, la de FAVL); ALLOW_ANY_CERT=1 solo para pruebas con una clave de prueba
#   ANDROID_JAR, DX       rutas de android.jar (API 23) y de dx
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="$(realpath -m "${1:?Falta el nombre del APK de salida}")"
: "${KEYSTORE:?}" "${KEYSTORE_PASSWORD:?}" "${KEY_ALIAS:?}" "${KEY_PASSWORD:?}" "${VERSION_CODE:?}" "${VERSION_NAME:?}"
EXPECTED_CERT_SHA256="${EXPECTED_CERT_SHA256:-35543672e437a9400b0b27066f4cca0c3848e4565c6088b84b53a8b169c67c2c}"
ANDROID_JAR="${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}"
DX="${DX:-$(command -v dx || echo /usr/lib/android-sdk/build-tools/debian/dx)}"
export KEYSTORE_PASSWORD KEY_PASSWORD
PKG="ar.net.yapur.gestion"

case "$VERSION_CODE" in ''|*[!0-9]*) echo "ERROR: VERSION_CODE debe ser un número entero" >&2; exit 1;; esac
SERVER_URL="${SERVER_URL:-}"
if [ -z "$SERVER_URL" ] && [ -f "$ROOT/server-url.txt" ]; then
  SERVER_URL="$(grep -v '^[[:space:]]*#' "$ROOT/server-url.txt" | tr -d '[:space:]' | head -c 300 || true)"
fi
SERVER_URL="${SERVER_URL%/}"
case "$SERVER_URL" in
  https://*.*) ;;
  *) echo "ERROR: falta la dirección del sistema (https://...). Ponela en android/server-url.txt" >&2; exit 1;;
esac
case "$SERVER_URL" in *[\"\\\ ]*) echo "ERROR: la dirección tiene caracteres no válidos" >&2; exit 1;; esac

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> 1/6 Código Java (servidor: $SERVER_URL)"
mkdir -p "$WORK/gen/ar/net/yapur/gestion" "$WORK/classes"
sed -e "s|@SERVER_URL@|$SERVER_URL|" -e "s|@VERSION@|$VERSION_NAME|" "$ROOT/src/ar/net/yapur/gestion/Config.java.in" > "$WORK/gen/ar/net/yapur/gestion/Config.java"
javac --release 8 -Xlint:-options -encoding UTF-8 -cp "$ANDROID_JAR" -d "$WORK/classes" "$ROOT"/src/ar/net/yapur/gestion/*.java "$WORK/gen/ar/net/yapur/gestion/Config.java"
echo "==> 2/6 Conversión a Android (dex)"
"$DX" --dex --output="$WORK/classes.dex" "$WORK/classes"

echo "==> 3/6 Manifiesto (versión $VERSION_NAME / código $VERSION_CODE)"
sed -e "s/__VERSION_CODE__/$VERSION_CODE/" -e "s/__VERSION_NAME__/$VERSION_NAME/" "$ROOT/AndroidManifest.xml" > "$WORK/AndroidManifest.xml"

echo "==> 4/6 Empaquetado"
aapt package -f -M "$WORK/AndroidManifest.xml" -S "$ROOT/res" -A "$ROOT/assets" -I "$ANDROID_JAR" -0 arsc -F "$WORK/base.apk"
(cd "$WORK" && zip -X -q base.apk classes.dex)
zipalign -f -p 4 "$WORK/base.apk" "$WORK/aligned.apk"

echo "==> 5/6 Firma"
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
apksigner sign --ks "$KEYSTORE" --ks-key-alias "$KEY_ALIAS" \
    --ks-pass env:KEYSTORE_PASSWORD --key-pass env:KEY_PASSWORD --v4-signing-enabled false --out "$OUT" "$WORK/aligned.apk"

echo "==> 6/6 Verificación"
apksigner verify "$OUT"
CERT="$(apksigner verify --print-certs "$OUT" | awk '/certificate SHA-256 digest/ {print $NF; exit}')"
if [ "${ALLOW_ANY_CERT:-}" != "1" ] && [ "$CERT" != "$EXPECTED_CERT_SHA256" ]; then
  rm -f "$OUT"
  echo "ERROR: la clave de firma NO es la de FAVL (huella $CERT). No se publica el APK:" >&2
  echo "       con otra clave, Android obligaría a desinstalar la app y se perderían los datos del celular." >&2
  exit 1
fi
zipalign -c -p 4 "$OUT"
BADGE="$(aapt dump badging "$OUT")"
echo "$BADGE" | grep -q "^package: name='$PKG' versionCode='$VERSION_CODE' versionName='$VERSION_NAME'" \
  || { echo "ERROR: el APK no tiene el paquete/versión esperados" >&2; rm -f "$OUT"; exit 1; }
echo "$BADGE" | grep -q "^launchable-activity: name='$PKG.MainActivity'" || { echo "ERROR: falta la actividad principal" >&2; rm -f "$OUT"; exit 1; }
LISTA="$(unzip -Z1 "$OUT")"
for f in AndroidManifest.xml classes.dex resources.arsc assets/offline.html res/drawable/ic_launcher.png; do
  printf '%s\n' "$LISTA" | grep -qxF "$f" || { echo "ERROR: falta $f dentro del APK" >&2; rm -f "$OUT"; exit 1; }
done
unzip -p "$OUT" classes.dex | grep -aq "Lar/net/yapur/gestion/MainActivity;" || { echo "ERROR: classes.dex no trae MainActivity" >&2; rm -f "$OUT"; exit 1; }
unzip -p "$OUT" classes.dex | grep -aq "$SERVER_URL" || { echo "ERROR: la dirección del servidor no quedó dentro del APK" >&2; rm -f "$OUT"; exit 1; }
if ! unzip -Zv "$OUT" resources.arsc | grep -q "compression method:.*stored"; then
  echo "ERROR: resources.arsc debe ir sin comprimir (Android 11+ lo exige)" >&2; rm -f "$OUT"; exit 1
fi
echo "$BADGE" | grep -E "^package|sdkVersion|targetSdkVersion|uses-permission|launchable"
echo "Listo: $OUT ($(du -h "$OUT" | cut -f1)) — huella de la clave: $CERT"
