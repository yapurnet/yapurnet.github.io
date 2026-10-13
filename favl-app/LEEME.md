# App FAVL Bandera Vuela — compilación automática en GitHub

**Qué hace:** cada vez que subís un examen nuevo a `favl-app/raw/` (o cambia algo en `favl-app/www/`),
GitHub arma el APK, lo firma **siempre con la misma clave de FAVL** y lo publica en
`https://yapurnet.github.io/FAVL-BanderaVuela.apk`.

Como la clave no cambia, el APK nuevo se instala **encima** del anterior: no hay que desinstalar y no se
pierden los datos del celular (instructores cargados en la app, preguntas marcadas del cuestionario).

---

## Puesta en marcha (una sola vez)

Se hace en el repositorio que publica `yapurnet.github.io` (normalmente se llama `yapurnet.github.io`).

1. **Cargar la clave como secretos.** Repositorio → *Settings* → *Secrets and variables* → *Actions* →
   *New repository secret*. Crear 4 secretos con **estos nombres exactos**; los valores están en el archivo
   `FAVL-secretos-GitHub.txt` (no se sube a GitHub, es solo para copiar y pegar):
   `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`.
2. **Subir la carpeta `favl-app`**: *Add file* → *Upload files* → arrastrar la carpeta `favl-app` entera → *Commit*.
3. **Crear el flujo de trabajo**: *Add file* → *Create new file* → en el nombre escribir
   `.github/workflows/build-favl-apk.yml` → pegar todo el contenido de `favl-app/workflow/build-favl-apk.yml` → *Commit*.
   (Si trabajás con `git` en la PC, basta con descomprimir el paquete dentro del repositorio y hacer push.)
4. *Settings* → *Actions* → *General* → *Workflow permissions* → **Read and write permissions** → *Save*
   (si ya estaba así, no hace falta tocar nada).
5. Pestaña **Actions** → *Compilar APK FAVL* → *Run workflow*. Tarda 2–3 minutos. Si sale tilde verde, el APK
   quedó publicado (el sitio puede demorar 1–2 minutos más en mostrarlo).

## Uso diario

**Agregar o cambiar un instructor** (o cualquier cambio en el examen):

1. En la PC abrí el examen, cargá/editá el instructor y tocá **Guardar en el archivo** (queda el `.html` actualizado).
2. En GitHub: carpeta `favl-app/raw` → *Add file* → *Upload files* → subir ese `.html` → *Commit*.
   Si hay varios `.html` en `raw`, se usa el **último que subiste**. El nombre del archivo no importa.
3. Esperá el tilde verde en *Actions*. En el celular, bajá el APK del enlace e instalalo encima
   (en *Ajustes → Aplicaciones → FAVL Bandera Vuela* tiene que cambiar la versión: `12.1`, `12.2`, `12.3`…).

> Los instructores que cargás **desde dentro de la app** quedan solo en ese celular. Los que están dentro del
> archivo del examen llegan a **todos** los celulares con cada actualización.

**Cambiar el cuestionario o el menú:** reemplazar `favl-app/www/cuestionario.html` o `favl-app/www/index.html`
por la versión final (la del cuestionario lleva incluido el narrador de voz de la app).

## Aviso de «hay una versión nueva» en la app

Cada compilación publica `favl-version.json` (en la raíz del sitio) con la última versión del APK. Las apps instaladas
(desde la 12.15 en adelante) lo consultan al abrirse y muestran abajo un aviso con **Cómo actualizar** (copia el enlace del APK
para pegarlo en Chrome). Nunca bloquea la app, y sin internet no muestra nada.

- **Versión mínima:** para pedir que todos actualicen, editá `favl-version.json` y subí el número de `"minimo"` (es el código de
  versión: la `12.20` tiene código `120`, o sea `100 + número`). Las apps más viejas que ese número muestran el aviso en naranja y
  más insistente (se puede postergar 2 horas). Si ponés una mínima mayor que la última versión publicada, se ignora.
- En Modo instructor > Instructores se ve la versión de cada celular, y en la pantalla de acceso al examen aparece «App 12.xx».
- La compilación siguiente conserva el `"minimo"` y la `"nota"` que dejaste en el archivo.

## Clave de GitHub fuera de la app (Worker de Cloudflare)

Por defecto la app lleva dentro del APK una clave de GitHub (secreto `FAVL_ISSUES_TOKEN`) para publicar los cambios de
instructores y las claves de examen. Como un APK es público, esa clave se puede sacar. La alternativa recomendada es
el **Worker de Cloudflare** (`favl-app/worker/`): la clave de GitHub vive solo en Cloudflare y la app únicamente conoce
su dirección. Se activa poniendo la dirección en `favl-app/worker/worker-url.txt` (o en la variable `FAVL_WORKER_URL`
de Actions); entonces el APK se compila sin ninguna clave de GitHub. Pasos completos en `favl-app/worker/LEEME.md`.

## Si algo falla

Pestaña *Actions* → entrar al intento con la cruz roja → leer el mensaje del paso que falló:

- **«no pude adaptar el examen…»**: el examen cambió de una forma que el adaptador no conoce. El APK anterior sigue
  publicado y funcionando. Hay que actualizar `favl-app/tools/patch_examen.py`.
- **«la clave de firma NO es la de FAVL»** o **«Faltan los secretos»**: los 4 secretos están mal cargados. Se frena a
  propósito: publicar con otra clave obligaría a desinstalar la app en todos los celulares.

## Cuidar la clave (importante)

- La clave es el archivo `favlapp-release.keystore`. **Guardá una copia fuera de GitHub** (pendrive, gestor de
  contraseñas, tu correo). Sin esa clave no se pueden publicar actualizaciones que se instalen encima.
- **Nunca** subas el `.keystore` ni los secretos al repositorio: el sitio es público. (`.gitignore` ya lo evita.)
- Huella de la clave (para comprobar que es la correcta):
  `35:54:36:72:E4:37:A9:40:0B:0B:27:06:6F:4C:CA:0C:38:48:E4:56:5C:60:88:B8:4B:53:A8:B1:69:C6:7C:2C`
