#!/bin/bash
# Pide los tres secretos (se pegan sin que se vean en pantalla), los guarda con permiso solo para root y prende los servicios.
cd /opt/yapur || exit 1
pedir() { local f=$1 msg=$2 x; read -rs -p "$msg: " x; echo; [ -n "$x" ] && printf '%s\n' "$x" > "$f" && chmod 600 "$f" || echo "  (vacío: se deja como estaba)"; }
echo "Pegá cada valor (los copiás de los archivos de Desktop\\conf de la PC) y apretá Enter."
pedir app_token.txt "Token de la app (app_token.txt)"
pedir olt_comunidad.txt "Comunidad de la OLT (olt_comunidad.txt)"
pedir mikrotik_comunidad.txt "Comunidad de MikroTik (mikrotik_comunidad.txt)"
for f in app_token.txt olt_comunidad.txt mikrotik_comunidad.txt; do [ -s $f ] || { echo "Falta $f: no se prenden los servicios."; exit 1; }; done
systemctl enable --now yapur-olt.timer yapur-pedidos yapur-ping yapur-nodos.timer yapur-consumo.timer
echo "Listo: el contenedor mide solo. Avisale a Claude."
