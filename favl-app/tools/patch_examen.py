#!/usr/bin/env python3
"""Adapta el examen FAVL (HTML original) para que funcione dentro de la app Android.

Uso:  python3 patch_examen.py <examen_original.html> <examen_para_la_app.html>

Hace exactamente esto sobre el archivo original (no toca la lista de instructores):
  1) agrega la etiqueta viewport (pantalla de celular),
  2) usa jsPDF local (js/jspdf.umd.min.js) en vez de bajarlo de internet,
  3) el guardado del PDF pasa por el puente nativo de la app (descarga + compartir),
  4) agrega las adaptaciones de la app (solo actúan dentro de la app), incluida la actualización automática
     de instructores (usa INSTR_VERSION, FAVL_SITE, FAVL_REPO y, o bien FAVL_WORKER_URL (Worker de Cloudflare, sin clave en la app),
     o bien FAVL_ISSUES_TOKEN (modo anterior)), el aviso de versión nueva
     (usa VERSION_CODE y VERSION_NAME) y el diseño para celular.

Si el examen cambia tanto que alguna pieza ya no se encuentra, el script FRENA con un
mensaje claro (así nunca se publica una app a medias).
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def leer(ruta):
    with open(ruta, encoding="utf-8") as f:       # texto: \r\n pasa a \n
        return f.read()


def aplicar(contenido, viejo, nuevo, etiqueta):
    n = contenido.count(viejo)
    if n != 1:
        sys.exit("ERROR: no pude adaptar el examen (paso «%s»: encontré %d coincidencias, esperaba 1). "
                 "El examen cambió de forma que este script no conoce: hay que actualizar tools/patch_examen.py." % (etiqueta, n))
    return contenido.replace(viejo, nuevo)


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    origen, destino = sys.argv[1], sys.argv[2]
    c = leer(origen)

    c = aplicar(c, '<meta charset="utf-8"/>\n',
                '<meta charset="utf-8"/>\n<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0"/>\n',
                "viewport")
    c = aplicar(c, '<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>',
                '<script src="js/jspdf.umd.min.js"></script>', "jsPDF local")
    c = aplicar(c, "doc.save(nombreArchivo);\nreturn { nombre: nombreArchivo, base64: pdfBase64 };\n",
                leer(os.path.join(HERE, "examen_guardar_pdf.js")), "guardado del PDF")

    shim = leer(os.path.join(HERE, "examen_app_shim.html"))
    version = os.environ.get("INSTR_VERSION", "0").strip()
    if not version.isdigit():
        sys.exit("ERROR: INSTR_VERSION debe ser un número entero (marca de tiempo), no «%s»." % version)
    sitio = os.environ.get("FAVL_SITE", "https://yapurnet.github.io").strip().rstrip("/")
    if not sitio.startswith("https://") or any(ch in sitio for ch in "'\" \n<>"):
        sys.exit("ERROR: FAVL_SITE inválido: %r" % sitio)
    repo = os.environ.get("FAVL_REPO", "yapurnet/yapurnet.github.io").strip()
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
        sys.exit("ERROR: FAVL_REPO inválido (debe ser usuario/repositorio): %r" % repo)
    # Clave de GitHub que viene dentro del APK (opcional; solo permite abrir pedidos en este repositorio).
    # Con clave: ningún instructor tiene que escribir nada. Vacía: la clave se pega a mano en cada celular.
    token = os.environ.get("FAVL_ISSUES_TOKEN", "").strip()
    if token and not re.fullmatch(r"[A-Za-z0-9_]{20,255}", token):
        sys.exit("ERROR: FAVL_ISSUES_TOKEN tiene un formato inesperado (solo letras, números y _). Revisá el secreto en GitHub.")
    # Worker de Cloudflare (recomendado): la app habla con él y NO lleva ninguna clave de GitHub. Si se indica, se ignora FAVL_ISSUES_TOKEN.
    worker = os.environ.get("FAVL_WORKER_URL", "").strip().rstrip("/")
    if worker:
        if not re.fullmatch(r"https://[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._~-]+)*", worker):
            sys.exit("ERROR: FAVL_WORKER_URL inválida (tiene que ser una dirección https:// sin espacios ni parámetros): %r" % worker)
        if token:
            print("AVISO: FAVL_WORKER_URL está definida: la app NO llevará la clave de GitHub (se ignora FAVL_ISSUES_TOKEN).")
            token = ""
    shim = (shim.replace("__FAVL_INSTR_VERSION__", version).replace("__FAVL_SITE__", sitio)
                .replace("__FAVL_REPO__", repo).replace("__FAVL_ISSUES_TOKEN__", token)
                .replace("__FAVL_WORKER_URL__", worker))
    if "__FAVL_" in shim:
        sys.exit("ERROR: quedaron marcas __FAVL_ sin reemplazar en el shim.")
    # Aviso de versión nueva de la app (usa VERSION_CODE y VERSION_NAME de la compilación)
    sys.path.insert(0, HERE)
    import aviso_lib
    shim += aviso_lib.bloque(sitio)
    css = leer(os.path.join(HERE, "examen_app.css.html"))
    c = aplicar(c, "</script></body>\n</html>\n", "</script>\n" + shim + css + "\n</body>\n</html>\n", "cierre del archivo")

    # comprobaciones finales
    for marca in ("/*INSTR_BASE_INICIO*/", "/*INSTR_BASE_FIN*/", "entregarPdfApp", 'src="js/jspdf.umd.min.js"'):
        if marca not in c:
            sys.exit("ERROR: falta «%s» en el examen adaptado." % marca)
    if "cdnjs.cloudflare.com" in c:
        sys.exit("ERROR: el examen todavía intenta bajar jsPDF de internet.")

    with open(destino, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("Examen adaptado: %s (%d caracteres)" % (destino, len(c)))


main()
