#!/usr/bin/env python3
"""Aviso de versión nueva de la app (aviso_version.html).

  - bloque(sitio): devuelve el <script> listo (con el sitio y la versión de esta compilación).
  - CLI:  python3 aviso_lib.py inyectar <entrada.html> <salida.html>   (lo agrega antes de </body>; lo usa build_apk.sh para el menú)

La versión sale de las variables VERSION_CODE (entero) y VERSION_NAME (texto) de la compilación.
Si faltan (pruebas locales) se usan 0 y «dev».
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def bloque(sitio=None):
    sitio = (sitio or os.environ.get("FAVL_SITE", "https://yapurnet.github.io")).strip().rstrip("/")
    if not sitio.startswith("https://") or any(ch in sitio for ch in "'\" \n<>"):
        sys.exit("ERROR: FAVL_SITE inválido: %r" % sitio)
    codigo = os.environ.get("VERSION_CODE", "0").strip() or "0"
    nombre = os.environ.get("VERSION_NAME", "dev").strip() or "dev"
    if not re.fullmatch(r"[0-9]{1,7}", codigo):
        sys.exit("ERROR: VERSION_CODE debe ser un número entero: %r" % codigo)
    if not re.fullmatch(r"[0-9A-Za-z._-]{1,20}", nombre):
        sys.exit("ERROR: VERSION_NAME tiene caracteres no permitidos: %r" % nombre)
    with open(os.path.join(HERE, "aviso_version.html"), encoding="utf-8") as f:
        txt = f.read()
    txt = txt.replace("__FAVL_SITE__", sitio).replace("__FAVL_VERSION_CODE__", str(int(codigo))).replace("__FAVL_VERSION_NAME__", nombre)
    if "__FAVL_" in txt:
        sys.exit("ERROR: quedaron marcas __FAVL_ sin reemplazar en el aviso de versión.")
    return txt


def inyectar(entrada, salida):
    with open(entrada, encoding="utf-8", newline="") as f:
        c = f.read()
    ms = list(re.finditer(r"</body>", c, flags=re.I))
    if len(ms) != 1:
        sys.exit("ERROR: %s debería tener exactamente un </body> (tiene %d)." % (entrada, len(ms)))
    i = ms[0].start()
    c = c[:i] + bloque() + "\n" + c[i:]
    with open(salida, "w", encoding="utf-8", newline="") as f:
        f.write(c)


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "inyectar":
        inyectar(sys.argv[2], sys.argv[3])
    else:
        sys.exit(__doc__)
