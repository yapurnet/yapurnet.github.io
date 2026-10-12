#!/usr/bin/env python3
"""Imprime la ruta del examen original más reciente dentro de la carpeta raw/ (por fecha de subida a git)."""
import glob
import os
import subprocess
import sys

carpeta = sys.argv[1]
archivos = sorted(glob.glob(os.path.join(carpeta, "*.html")) + glob.glob(os.path.join(carpeta, "*.htm")))
if not archivos:
    sys.exit("ERROR: no hay ningún .html en %s" % carpeta)


def fecha(ruta):
    try:
        t = subprocess.run(["git", "log", "-1", "--format=%ct", "--", ruta], capture_output=True, text=True,
                           cwd=os.path.dirname(os.path.abspath(ruta))).stdout.strip()
        if t:
            return float(t)
    except Exception:
        pass
    return os.path.getmtime(ruta)


print(max(archivos, key=fecha))
