# Gestión YAPUR.NET — sin servidor propio

Todo corre gratis en Cloudflare (la cuenta donde ya está el Worker `favl`) y el APK lo arma GitHub, igual que la app de FAVL.

| Pieza | Dónde vive | Quién la arma |
|---|---|---|
| Sistema (clientes, planes, cobranzas, usuarios, base de datos) | `https://yapur.mauroyapur.workers.dev` | Cloudflare, desde la carpeta `yapur-app/worker` de este repositorio |
| APK para los celulares | `https://yapurnet.github.io/YAPUR-Gestion.apk` | GitHub Actions, firmado con la misma clave de FAVL |

El APK es solo una ventana que abre el sistema; **cuando se cambia el sistema no hace falta volver a instalar el APK**.

## Puesta en marcha (una sola vez)

1. **Aprobar el pedido de cambios** (Pull request) que trae esta carpeta: «Merge pull request». Hasta que esté en `main`, Cloudflare y GitHub no la ven.
2. **Cloudflare → Workers & Pages → Create → Import a repository** → GitHub → repositorio `yapurnet.github.io`.
   - Project name: `yapur` (tiene que ser exactamente ese, es el nombre que figura en `wrangler.jsonc`).
   - Root directory: `/yapur-app/worker`
   - Build command: dejar vacío. Deploy command: lo que proponga (`npx wrangler deploy`).
   - Opcional: en *Build watch paths* poner `yapur-app/worker/*` para que no se vuelva a publicar cuando se toca otra app del repositorio.
   - Cuando termina, la dirección es `https://yapur.<tu-subdominio>.workers.dev`. Si no es `mauroyapur`, editá `yapur-app/android/server-url.txt` con la dirección real antes de bajar el APK.
3. **Abrir esa dirección en el navegador**. Aparece la pantalla de instalación: poné el **código de instalación** que te pasé aparte (no está en ningún archivo del repositorio), tu usuario y una clave de 8 o más caracteres. Ese usuario es el administrador.
4. **Bajar el APK**: la pestaña *Actions* de GitHub corre sola «Compilar APK Gestión YAPUR» cuando entra el cambio (si no, *Run workflow*). A los 2-3 minutos queda en `https://yapurnet.github.io/YAPUR-Gestion.apk`. En el celular: abrir ese enlace, permitir «instalar de esta fuente» y listo. Como está firmado con la clave de FAVL, sin problemas si algún día se actualiza encima.
5. Desde **Ajustes → Usuarios** creás a la oficinista y a los técnicos con sus permisos.

## Pasar los datos que ya cargaste en la versión anterior (el Artifact)

1. En la versión vieja: **Ajustes → «Descargar copia para el servidor nuevo»** (se guarda un archivo `.json`).
2. En la nueva (ya con tu usuario administrador): **Ajustes → «Restaurar desde un archivo…»** y elegís ese archivo.
3. Los clientes existentes quedan con Ciclo 1 y sin servicios extra; ajustalos desde la ficha o con la importación.
4. El plan `Plan_15` quedó guardado a `$17` en la versión anterior: editarlo y poner `17.000`.

## Ubicación de las casas con el GPS del celular

En la ficha del cliente, en «Cargar ubicación» y al terminar una orden de instalación hay un botón **«Usar mi ubicación actual (GPS)»**. Estando en el domicilio, el técnico lo toca, el celular toma lecturas unos segundos, se queda con la más precisa y completa las coordenadas (se ve la precisión, por ejemplo ±6 m); después toca Guardar. Si la lectura es floja (más de ±25 m) avisa que conviene repetir al aire libre.

- El GPS se lee **solo cuando se toca el botón**: no hay seguimiento ni ubicación en segundo plano.
- Hace falta la versión del APK que trae el permiso de ubicación (2.2 o posterior). La primera vez Android pide el permiso: elegir **«Mientras se usa la app»** y dejar activada la ubicación precisa. Si el APK es anterior, el botón avisa que falta actualizar.
- En Chrome (sin APK) también funciona, con el permiso de ubicación del sitio.
- Al terminar una instalación, el técnico ya no ve la opción de «activar al cliente»: eso cambia la facturación y solo lo puede hacer quien edita clientes (antes la opción aparecía igual y fallaba, y con ella se perdía la ubicación).

## Avisos de actualización

- **App nueva (la mayoría de los cambios):** cuando se publica una versión nueva en Cloudflare, quien tenga la app abierta (o la abra) ve arriba **«Hay una versión nueva de la app»** con el botón **Actualizar**. Revisa al abrir, al volver a la app y cada 10 minutos. No hace falta reinstalar el APK.
- **APK nuevo (solo cuando cambia la parte de Android, por ejemplo un permiso nuevo):** el celular ve **«Hay un APK nuevo (2.X) con mejoras»** con el botón **Descargar**, que abre la descarga en el navegador. Se instala encima, sin perder nada. Lo informa el archivo `yapur-version.json` que publica solo el flujo que compila el APK.
- «Después» esconde el aviso hasta que se vuelva a abrir la app.

## Copias de seguridad

- El sistema guarda **solas 2 copias por día** (la primera escritura del día y otra 8 horas después) y conserva las últimas 28 (14 días). **Ajustes → «Copias automáticas…»** las lista y permite volver a una (antes de restaurar guarda una copia del estado actual, por si te arrepentís).
- Además, **Ajustes → «Descargar copia completa»** baja un archivo a tu celular/PC. Convendría bajarlo una vez por semana y guardarlo fuera de Cloudflare.

## Qué hay que saber del plan gratis de Cloudflare

- Alcanza de sobra para ~2.000 clientes y un equipo chico: el límite es de 100.000 pedidos por día y un uso normal ronda unos pocos miles.
- Si alguien inundara la dirección con pedidos basura, se podría agotar ese cupo y el sistema se detiene hasta las 21:00 hs de Argentina (00:00 UTC). No es un riesgo de datos (no se pierde nada), pero sí de servicio. Mientras tanto, la app abre con lo último que bajó y se puede consultar sin conexión.
- Si el negocio crece o querés más tranquilidad, el plan pago de Workers cuesta unos USD 5 por mes y elimina ese tope.
- Los ingresos tienen bloqueo por intentos fallidos (5 por usuario y dirección, 25 por dirección), guardado en el servidor.
- El código de instalación solo sirve mientras no exista ningún administrador; después queda inutilizado.

## Si el APK da problemas

La misma app funciona como página: abrir la dirección en Chrome del celular → menú ⋮ → «Añadir a la pantalla de inicio». Mismos datos y mismas claves.

## Cómo se probó

Se probaron de punta a punta, contra el servidor real de Cloudflare simulado en la computadora (`wrangler dev`, mismo motor `workerd`): permisos de cada perfil, que cada usuario vea solo lo suyo, cobranzas que no se pueden borrar ni editar, ciclos de facturación 1–10 y 13–20 con feriados, promesas de pago, servicios extra, tiempo real entre usuarios, bloqueo por intentos, copias de seguridad y restauración, reinicios del servidor, la app en modo celular con navegador Chromium (sin conexión incluida) y los avisos de actualización y el botón del GPS con ubicaciones simuladas (precisa, que afina sola, floja, sin permiso, y al cerrar una instalación).

**No se pudo probar** en este entorno: el programa de Android en un celular real (incluido el permiso y la lectura real del GPS) (se verificó que el APK se arma, firma y alinea bien, pero no hay emulador), la publicación real en Cloudflare ni la corrida real en GitHub Actions. Si algo falla en alguno de esos tres pasos, es lo primero que hay que mirar.

Para volver a correr las pruebas: `cd yapur-app/tests && npm install && npm test` (GitHub también las corre en cada pedido de cambios, con `probar-yapur.yml`).

## Para quien mantenga el código

- `app/src/` es el código de la aplicación; `node yapur-app/app/build.js` lo arma en `worker/public/` (que es lo que publica Cloudflare). Si se cambia `src` y no se arma, la prueba `test_build.js` falla a propósito.
- `worker/src/worker.js` es el servidor (un Worker + una base SQLite dentro de un Durable Object).
- `android/` es el APK (sin Gradle, mismo método que FAVL): `build_apk.sh`.
- Los secretos de firma (`KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`) son los mismos que ya usa FAVL; no hay que cargar nada nuevo.
