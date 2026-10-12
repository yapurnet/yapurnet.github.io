#!/usr/bin/env bash
# Procesa los pedidos de instructores que mandan las apps y publica la lista nueva.
# Lo ejecuta el workflow «Instructores automático» (ver .github/workflows/instructores-auto.yml).
# Entorno: GH_TOKEN, GITHUB_REPOSITORY, GITHUB_REPOSITORY_OWNER, FAVL_ADMIN_CODE
# Opcional: FAVL_NO_PUSH=1 (solo para pruebas: no sube nada)
set -euo pipefail

# Todo el script va dentro de una función para que bash lo lea completo antes de ejecutarlo:
# el «git reset» de más abajo puede reescribir archivos del repositorio, incluido este.
main() {

  : "${GH_TOKEN:?}" "${GITHUB_REPOSITORY:?}" "${GITHUB_REPOSITORY_OWNER:?}"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  case "$BRANCH" in ''|HEAD) BRANCH="main";; esac
  CAMBIOS="favl-app/data/instructores-cambios.json"
  PUBLICADO=0

  for intento in 1 2 3 4 5; do
    # Siempre se parte de lo último que hay en GitHub (otra corrida pudo publicar mientras tanto).
    git fetch -q origin "$BRANCH"
    git reset -q --hard "origin/$BRANCH"

    gh issue list -R "$GITHUB_REPOSITORY" --state open --author "$GITHUB_REPOSITORY_OWNER" \
       --limit 100 --json number,title,body,author > "$TMP/issues.json"
    RAW="$(python3 favl-app/tools/pick_raw.py favl-app/raw)"
    mkdir -p favl-app/data
    FAVL_OWNER="$GITHUB_REPOSITORY_OWNER" node favl-app/tools/aplicar_pedidos.js \
       "$TMP/issues.json" "$CAMBIOS" "$TMP/resultado.json" "$RAW"

    HUBO="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).huboCambios ? 'si' : 'no')" "$TMP/resultado.json")"
    if [ "$HUBO" != "si" ]; then
      echo "No hay cambios para publicar."
      PUBLICADO=1
      break
    fi

    node favl-app/tools/extract_instructores.js "$RAW" favl-instructores.json auto "$CAMBIOS"
    git add "$CAMBIOS" favl-instructores.json
    git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
        commit -q -m "Instructores: pedidos de la app aplicados (lista publicada)"
    if [ "${FAVL_NO_PUSH:-}" = "1" ]; then PUBLICADO=1; break; fi
    if git push -q origin "HEAD:$BRANCH"; then
      PUBLICADO=1
      break
    fi
    echo "Otro proceso publicó al mismo tiempo (intento $intento). Reintento."
    sleep $((intento * 3))
  done

  if [ "$PUBLICADO" != "1" ]; then
    echo "::error::No se pudo publicar después de 5 intentos. Los pedidos siguen abiertos y se procesan en la próxima corrida."
    exit 1
  fi

  # Responder y cerrar cada pedido (el texto de los comentarios sale de mensajes fijos, nunca del issue).
  node -e '
  const fs = require("fs");
  const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const dir = process.argv[2];
  r.issues.forEach(i => {
    if (i.estado === "ignorado" || !Number.isInteger(i.number)) return;
    const etiqueta = { aplicado: "FAVL-OK", repetido: "FAVL-REPETIDO", rechazado: "FAVL-RECHAZADO" }[i.estado];
    if (!etiqueta) return;
    fs.writeFileSync(dir + "/msg_" + i.number + ".md", etiqueta + "\n\n" + i.mensaje + "\n");
    console.log(i.number + " " + i.estado);
  });' "$TMP/resultado.json" "$TMP" > "$TMP/lista.txt"

  while read -r NUM ESTADO; do
    [ -n "${NUM:-}" ] || continue
    RAZON="completed"; [ "$ESTADO" = "rechazado" ] && RAZON="not planned"
    gh issue comment "$NUM" -R "$GITHUB_REPOSITORY" --body-file "$TMP/msg_$NUM.md" </dev/null || echo "No se pudo comentar el pedido $NUM."
    gh issue close "$NUM" -R "$GITHUB_REPOSITORY" --reason "$RAZON" </dev/null || echo "No se pudo cerrar el pedido $NUM."
  done < "$TMP/lista.txt"
  echo "Listo."
}
main "$@"
exit $?
