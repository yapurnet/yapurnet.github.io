#!/usr/bin/env bash
# Elige, del Android SDK que ya trae la máquina de GitHub, el android.jar (API 29 o más) y el aapt con que se arma el manifiesto.
# El servicio de ubicación declara «foregroundServiceType», un atributo que existe desde Android 10; el android.jar de Android 6
# (con el que se compila el código) no lo conoce. Imprime AAPT=... y AAPT_JAR=... (para agregar a $GITHUB_ENV).
set -euo pipefail

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/usr/local/lib/android/sdk}}"

plataformas() {
  local j n
  for j in "$SDK"/platforms/android-*/android.jar; do
    [ -f "$j" ] || continue
    n="${j%/android.jar}"; n="${n##*/android-}"
    case "$n" in ''|*[!0-9]*) continue;; esac
    if [ "$n" -ge 29 ]; then echo "$n"; fi
  done | sort -n
}

NUMS="$(plataformas || true)"
if [ -z "$NUMS" ] && [ -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]; then
  echo "No hay ningún Android 10+ en la máquina: se instala la plataforma 34." >&2
  set +o pipefail
  yes | "$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" "platforms;android-34" >&2 || true
  set -o pipefail
  NUMS="$(plataformas || true)"
fi
[ -n "$NUMS" ] || { echo "ERROR: no se encontró un android.jar de API 29 o más en $SDK/platforms" >&2; exit 1; }

# La 34 si está; si no, la más chica que sea 34 o más; si no, la más nueva que haya.
if printf '%s\n' "$NUMS" | grep -qx 34; then
  API=34
else
  API="$(printf '%s\n' "$NUMS" | awk '$1 >= 34 {print; exit}')"
  [ -n "$API" ] || API="$(printf '%s\n' "$NUMS" | tail -1)"
fi
JAR="$SDK/platforms/android-$API/android.jar"

AAPT="$(ls -d "$SDK"/build-tools/*/aapt 2>/dev/null | sort -V | tail -1 || true)"
[ -n "$AAPT" ] || AAPT="$(command -v aapt)"

echo "Android SDK: $SDK (plataforma $API, aapt: $AAPT)" >&2
echo "AAPT=$AAPT"
echo "AAPT_JAR=$JAR"
