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
4. El plan `Plan_15` quedó guardado a `$17` en la versión anterior: editarlo, poner `17.000` y tildar **«Es un error de carga»** (así vale para todos los meses).

## Cambios de precio, servicios nuevos y cambios de plan (vigencia por mes)

Un precio cambia **desde un mes**; los meses anteriores conservan lo que valían, así a quien ya pagó no le aparece deuda.

- **Aumento de un plan o de un servicio extra** (Planes → Editar): al cambiar el precio aparece *«El precio nuevo rige desde»* con el mes siguiente. Se puede elegir este mes o uno futuro. El plan muestra el aviso «Desde noviembre: $25.000» hasta que llega ese mes.
- **Error de carga** (por ejemplo `$17` en vez de `$17.000`): tildar *«Es un error de carga»* corrige todos los meses. Solo se ofrece mientras el plan no tenga aumentos anteriores; si ya los tiene, el cambio se carga con «rige desde».
- **Agregarle un servicio a un cliente, cambiarle el plan o ponerle precio especial** (ficha → Editar): aparece *«Los cambios rigen desde»* con este mes. Se puede elegir un mes anterior (por ejemplo si lo tenía desde antes), pero nunca antes de que empezara su situación actual. Lo anterior queda guardado como estaba.
- Vale lo mismo para quitar un servicio o volver al plan anterior. Si un cliente se corrige dentro del mismo mes que el cambio anterior, se toma como corrección y no se agrega historial.
- Los técnicos no reciben ni los precios ni este historial, y no pueden modificarlo.

## Ubicación de las casas con el GPS del celular

En la ficha del cliente, en «Cargar ubicación» y al terminar una orden de instalación hay un botón **«Usar mi ubicación actual (GPS)»**. Estando en el domicilio, el técnico lo toca, el celular toma lecturas unos segundos, se queda con la más precisa y completa las coordenadas (se ve la precisión, por ejemplo ±6 m); después toca Guardar. Si la lectura es floja (más de ±25 m) avisa que conviene repetir al aire libre.

- El GPS se lee **solo cuando se toca el botón**: no hay seguimiento ni ubicación en segundo plano.
- Hace falta la versión del APK que trae el permiso de ubicación (2.2 o posterior). La primera vez Android pide el permiso: elegir **«Mientras se usa la app»** y dejar activada la ubicación precisa. Si el APK es anterior, el botón avisa que falta actualizar.
- En Chrome (sin APK) también funciona, con el permiso de ubicación del sitio.
- Al terminar una instalación, el técnico ya no ve la opción de «activar al cliente»: eso cambia la facturación y solo lo puede hacer quien edita clientes (antes la opción aparecía igual y fallaba, y con ella se perdía la ubicación).

## Red: cajas NAP y botellas de empalme

La pestaña **Red** (la ven los técnicos y la oficina; el administrador siempre) guarda cada **caja NAP** y cada **botella de empalme** con su ubicación:

- **Cargar una:** estando al lado, *Nueva caja NAP* o *Nueva botella de empalme* → nombre (por ejemplo NAP-12) → **«Usar mi ubicación actual (GPS)»** → Guardar. Es el mismo botón que usan las casas de los clientes. Una caja lleva cantidad de puertos (8, 16…) y, si se quiere, de qué botella de empalme sale; las dos llevan una referencia para encontrarlas (por ejemplo «poste frente a la plaza»).
- **Encontrarlas:** cada una tiene **Cómo llegar** (Google Maps / Waze). **«Ordenar por cercanía (GPS)»** pone arriba las más próximas a donde estás parado, con los metros. **«Descargar lista»** baja un CSV con las coordenadas (se puede importar en Google My Maps para verlas todas juntas).
- **Conectar a cada cliente con su caja:** en la ficha del cliente → Editar → *Caja NAP* y *Puerto*; o, **al terminar una orden de instalación**, el técnico elige la caja y anota el puerto. Las cajas se ofrecen de la más cercana a la más lejana. La app avisa si el puerto no existe o ya figura usado por otro cliente.
- **Qué se ve:** cada caja muestra cuántos puertos están usados, cuáles quedan libres y la lista de clientes conectados con su puerto (cada persona ve solo los clientes que su perfil puede ver). En *Clientes* se puede buscar por el nombre de la caja y filtrar *Sin caja NAP* para completar los que faltan. El CSV de clientes trae las columnas *caja nap* y *puerto nap*.
- **Permisos:** el permiso nuevo **«Cargar y editar la red»** se activa por perfil en Ajustes → Usuarios (viene encendido para técnicos y oficina). Quien no lo tiene igual ve las cajas en la ficha del cliente, pero no puede cambiarlas. **Eliminar** un punto solo lo puede quien edita clientes, y el servidor no deja borrar una caja con clientes conectados (hay que pasarlos antes a otra) ni una botella de la que sale otra caja.
- Los datos entran en las copias de seguridad como cualquier otro, y la lista queda guardada en el celular para consultarla sin señal. Se necesita el APK 2.2 o posterior para el GPS (el mismo que ya se usa para las casas); **no hace falta un APK nuevo**.

## Cobros del técnico y cierre de caja por cobrador

Si un técnico cobra la instalación, una reconexión o un reclamo, lo carga en la app y entra a la caja del día con su nombre:

- **Darle el permiso:** Ajustes → Usuarios → editar al técnico → *Cobrar instalaciones y reclamos en la calle*. Viene apagado: lo prendés solo a quien cobra. Con ese permiso **no cobra mensualidades** (eso sigue siendo de la oficina) y **no ve la caja ni lo que cobran otros**.
- **Cómo lo carga el técnico:** (1) pestaña **Mis cobros** → busca al cliente → *Cobrar* (instalación, reconexión, reclamo u otro, con el monto y el medio de pago); (2) desde la ficha del cliente → *Cobrar instalación o reclamo*; (3) **al terminar una orden**, tildando *Cobré este trabajo* (el concepto se completa según el tipo de orden). Siempre se registra con la fecha de hoy y a su nombre: no puede poner otra fecha ni borrarlo. Si se equivoca, la oficina anula el recibo y se carga de nuevo.
- **Mis cobros:** muestra lo que cobró hoy y los últimos 7 días, y cuánto efectivo tiene que entregar hoy.
- **Cierre de caja:** en Cobranzas → *Caja del día* hay una tabla **Por cobrador** (recibos, efectivo, otros medios y total de cada persona, incluida la oficina) y cada cobro dice quién lo hizo. El efectivo de cada persona es lo que tiene que entregar. Los cobros anulados no suman.
- Los cobros anteriores a esta versión no tienen nombre de cobrador y figuran como «Sin dato». **No hace falta un APK nuevo.**

## Routers MikroTik: traer los clientes (solo lectura)

El sistema **no se conecta a tus routers ni guarda usuario o clave de ninguno**. Es al revés: cada router corre un script de **solo lectura** que le manda al sistema la lista de lo que tiene cargado. Por eso el sistema no puede cortar ni cambiar nada en un router, aunque alguien robe una cuenta de la app. No hay que abrir puertos ni exponer el router a internet (solo necesita salir por HTTPS).

- **Alta:** Ajustes → *Routers MikroTik* → *Agregar router*. Poné el nombre (ADMIN02, FM04…) y marcá qué clientes tiene: **IP fija** (lee las colas simples), **DHCP** (leases estáticos) y/o **PPPoE** (secretos y perfiles; *nunca* lee ni envía contraseñas). Te muestra el script con el acceso de ese router.
- **En el router:** WinBox → Nuevo terminal. (1) pegá la prueba de conexión, (2) pegá el script, (3) ejecutalo una vez con `/system script run yapur-clientes` (con miles de clientes tarda unos minutos), (4) si funcionó, pegá la programación para que lo mande solo todos los días a las 03:30. El script es de permisos `read,test`: no puede escribir en el router.
- **Clientes detectados:** en el router → *Clientes detectados*. Junta colas, PPPoE y DHCP en una fila por cliente (por IP), reconoce a los que ya cargaste (por IP, usuario PPPoE o nombre) y asigna el plan por velocidad. *Importar* crea los nuevos con IP, usuario PPPoE, MAC y el nombre del router; lo deshabilitado entra como suspendido. Teléfono, dirección y DNI se completan después. No pisa clientes que ya están.
- **Qué no toma como cliente:** colas con rangos o varias IP, colas repetidas con la misma IP y usuarios PPP que no son PPPoE (VPN).
- **Seguridad:** el acceso de cada router solo sirve para *dejar* la lista (no para leer nada del sistema). Si lo perdés o lo querés cambiar, *Script* genera uno nuevo y el anterior deja de valer (hay que volver a pegar el script en ese router). Un router borrado deja de poder enviar.
- **Para saber:** la lista de cada router no entra en las copias de seguridad (se vuelve a armar sola con el próximo envío).
- **Sin probar en un router real:** el script se armó con la sintaxis de RouterOS 6.4x/7.x pero **no se pudo correr en un MikroTik desde acá**. Probalo primero en uno chico (por ejemplo un nodo con IP fija). Si el router responde «not enough permissions», agregá el permiso `write` al script y a la programación (el script igual no escribe). El paso «Si algo falla» del mismo cuadro explica los demás casos.
- Más adelante, cortar y reconectar desde el sistema se podría agregar como un script aparte que el router *consulta* (siempre del lado del router, sin dar acceso al sistema); hoy no existe.

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

Se probaron de punta a punta, contra el servidor real de Cloudflare simulado en la computadora (`wrangler dev`, mismo motor `workerd`): permisos de cada perfil, que cada usuario vea solo lo suyo, cobranzas que no se pueden borrar ni editar, ciclos de facturación 1–10 y 13–20 con feriados, promesas de pago, servicios extra, tiempo real entre usuarios, bloqueo por intentos, copias de seguridad y restauración, reinicios del servidor, la app en modo celular con navegador Chromium (sin conexión incluida) y los avisos de actualización y el botón del GPS con ubicaciones simuladas (precisa, que afina sola, floja, sin permiso, y al cerrar una instalación) y la red (alta de cajas y empalmes con el GPS, orden por cercanía, conexión del cliente a su caja y puerto, permisos y borrados bloqueados).

**No se pudo probar** en este entorno: el programa de Android en un celular real (incluido el permiso y la lectura real del GPS) (se verificó que el APK se arma, firma y alinea bien, pero no hay emulador), la publicación real en Cloudflare ni la corrida real en GitHub Actions. Si algo falla en alguno de esos tres pasos, es lo primero que hay que mirar.

Para volver a correr las pruebas: `cd yapur-app/tests && npm install && npm test` (GitHub también las corre en cada pedido de cambios, con `probar-yapur.yml`).

## Para quien mantenga el código

- `app/src/` es el código de la aplicación; `node yapur-app/app/build.js` lo arma en `worker/public/` (que es lo que publica Cloudflare). Si se cambia `src` y no se arma, la prueba `test_build.js` falla a propósito.
- `worker/src/worker.js` es el servidor (un Worker + una base SQLite dentro de un Durable Object).
- `android/` es el APK (sin Gradle, mismo método que FAVL): `build_apk.sh`.
- Los secretos de firma (`KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`) son los mismos que ya usa FAVL; no hay que cargar nada nuevo.
