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

- Este botón lee el GPS **solo cuando se toca**. (La ubicación de los técnicos en horario laboral es otra cosa, con su aviso y su horario: ver «Dónde están los técnicos».)
- Hace falta la versión del APK que trae el permiso de ubicación (2.2 o posterior). La primera vez Android pide el permiso: elegir **«Mientras se usa la app»** y dejar activada la ubicación precisa. Si el APK es anterior, el botón avisa que falta actualizar.
- En Chrome (sin APK) también funciona, con el permiso de ubicación del sitio.
- Al terminar una instalación, el técnico ya no ve la opción de «activar al cliente»: eso cambia la facturación y solo lo puede hacer quien edita clientes (antes la opción aparecía igual y fallaba, y con ella se perdía la ubicación).

## Red: cajas NAP y botellas de empalme

La pestaña **Red** (la ven los técnicos y la oficina; el administrador siempre) guarda cada **caja NAP** y cada **botella de empalme** con su ubicación:

- **Cargar una:** estando al lado, *Nueva caja NAP* o *Nueva botella de empalme* → nombre (por ejemplo NAP-12) → **«Usar mi ubicación actual (GPS)»** → Guardar. Es el mismo botón que usan las casas de los clientes. Una caja lleva cantidad de puertos (8, 16…) y, si se quiere, de qué botella de empalme sale; las dos llevan una referencia para encontrarlas (por ejemplo «poste frente a la plaza»).
- **Encontrarlas:** cada una tiene **Cómo llegar** (Google Maps / Waze). **«Ordenar por cercanía (GPS)»** pone arriba las más próximas a donde estás parado, con los metros. **«Descargar lista»** baja un CSV con las coordenadas (se puede importar en Google My Maps para verlas todas juntas).
- **Conectar a cada cliente con su caja:** en la ficha del cliente → Editar → *Caja NAP* y *Puerto*; o, **al terminar una orden de instalación**, el técnico elige la caja y anota el puerto. Las cajas se ofrecen de la más cercana a la más lejana. La app avisa si el puerto no existe o ya figura usado por otro cliente.
- **Mapa de puertos:** al abrir una caja se ve cada puerto con el cliente que lo usa (nombre y calle) y los **libres resaltados en verde**, separados en **Adelante** (primera mitad: en una caja de 8, los puertos 1 a 4) y **Atrás** (segunda mitad: 5 a 8), con el resumen «Quedan 5 puertos libres» o «Caja llena». Tocando un puerto ocupado se ve de quién es y desde ahí se lo puede mover. Los clientes que no tienen puerto cargado, tienen uno que la caja no tiene o comparten puerto con otro aparecen en **Para revisar** (los repetidos se marcan en amarillo), porque en esos casos el mapa puede mostrar libre un lugar que en realidad está usado. Para ver la caja, un técnico ve nombre y calle de **todos** los clientes conectados a ella (no el teléfono, el DNI ni los precios); la ficha completa del cliente sigue limitada a lo que su perfil permite.
- **Mover un cliente de caja o de puerto:** en la caja (tocando el puerto del cliente → *Mover a otra caja o puerto*) o en la ficha del cliente (*Caja NAP* → **Mover**). Se elige la caja de destino (las más cercanas a la casa del cliente primero) y un puerto libre; al confirmar, **el puerto de origen queda libre y el de destino ocupado en el mismo momento**, porque el puerto se guarda en el propio cliente. Lo puede hacer quien tiene el permiso de red (técnicos y oficina de fábrica). No toca la facturación. Si otra persona ocupó ese puerto mientras tanto, la app lo detecta al confirmar, no mueve a nadie y pide elegir otro. Que dos clientes no compartan puerto lo controla la app al mover o cargar, no el servidor (los clientes se guardan en varios grupos y el servidor no los cruza).
- **Qué se ve:** cada caja muestra cuántos puertos están usados, cuáles quedan libres y la lista de clientes conectados con su puerto. En *Clientes* se puede buscar por el nombre de la caja y filtrar *Sin caja NAP* para completar los que faltan. El CSV de clientes trae las columnas *caja nap* y *puerto nap*.
- **Permisos:** el permiso nuevo **«Cargar y editar la red»** se activa por perfil en Ajustes → Usuarios (viene encendido para técnicos y oficina). Quien no lo tiene igual ve las cajas en la ficha del cliente, pero no puede cambiarlas. **Eliminar** un punto solo lo puede quien edita clientes, y el servidor no deja borrar una caja con clientes conectados (hay que pasarlos antes a otra) ni una botella de la que sale otra caja.
- Los datos entran en las copias de seguridad como cualquier otro, y la lista queda guardada en el celular para consultarla sin señal. Se necesita el APK 2.2 o posterior para el GPS (el mismo que ya se usa para las casas); **no hace falta un APK nuevo**.

## Cobros del técnico y cierre de caja por cobrador

Si un técnico cobra la instalación, una reinstalación (mudanza) o un reclamo, lo carga en la app y entra a la caja del día con su nombre:

- **Darle el permiso:** Ajustes → Usuarios → editar al técnico → *Cobrar instalaciones y reclamos en la calle*. Viene apagado: lo prendés solo a quien cobra. Con ese permiso **no cobra mensualidades** (eso sigue siendo de la oficina) y **no ve la caja ni lo que cobran otros**.
- **Cómo lo carga el técnico:** (1) pestaña **Mis cobros** → busca al cliente → *Cobrar* (instalación, reinstalación, reclamo u otro, con el medio de pago; la instalación y la reinstalación llevan el precio fijo); (2) desde la ficha del cliente → *Cobrar instalación o reclamo*; (3) **al terminar una orden**, tildando *Cobré este trabajo* (el concepto se completa según el tipo de orden). Siempre se registra con la fecha de hoy y a su nombre: no puede poner otra fecha ni borrarlo. Si se equivoca, la oficina anula el recibo y se carga de nuevo.
- **Precios fijos de instalación y reinstalación:** los carga **solo el administrador** en *Ajustes → Precios de instalación* (hoy **instalación $ 65.000** y **reinstalación $ 35.000**, que es la mitad redondeada). El técnico ve el monto ya puesto y **no lo puede cambiar**; el servidor además rechaza cualquier otro importe y le dice cuál es el vigente. Si cambiás un precio, le llega al técnico solo, sin que reinstale nada. La oficina ve el precio de lista ya completado, pero puede ajustarlo (descuento, pago en cuotas). «Reclamo o visita técnica» y «Otro» siguen con monto libre.
- **La reconexión solo se cobra si el cliente tiene deuda, y la cobra la oficina:** el técnico **nunca** la cobra (el servidor se lo rechaza; además no ve la deuda del cliente). En la oficina, «Reconexión» aparece en *Cobrar* —y al terminar una orden de *Reconexión* se ofrece «Cobré este trabajo»— **solo si el cliente tiene deuda anterior pendiente o meses vencidos**; si está al día no se ofrece. El monto es libre (no hay precio fijo). Ojo con el orden: se carga la reconexión **antes** que el pago de la deuda, porque cuando la deuda queda en cero ya no se puede cobrar. Los recibos viejos que dicen «Reconexión» se siguen viendo igual.
- **Mis cobros:** muestra lo que cobró hoy y los últimos 7 días, y cuánto efectivo tiene que entregar hoy.
- **Instalación solo para quien se instala; reinstalación para una mudanza:** a quien cobra en la calle, «Instalación» solo se le ofrece (y el servidor solo la acepta) para un cliente **«Por instalar»**. A un cliente que ya está instalado se le ofrece **«Reinstalación (mudanza)»** (y también Reclamo u Otro); si intenta cobrarle «Instalación», el servidor lo rechaza y le dice que cobre la reinstalación. Al revés, «Reinstalación» no se cobra a un cliente que todavía está «Por instalar». Al cerrar una orden de instalación sobre un cliente ya instalado, el concepto viene como Reinstalación. La oficina (que cobra de todo) no tiene esta restricción.
- **El técnico no ve pagos:** no hay caja, ni cobranzas, ni morosos, ni lo que se le cobró a un cliente: el servidor ni siquiera le manda los pagos. Lo único que ve es **Mis cobros**: los recibos que cargó él mismo (hoy y los últimos 7 días) y cuánto efectivo debe entregar. Cuando el administrador mira la app «como técnico» (*Vista: …*), esa pestaña también muestra solo los cobros de ese técnico.
- **El técnico no ve si el cliente está activo o suspendido por falta de pago:** el servidor no le manda el estado «Activo» ni «Suspendido» (ni la fecha de corte, la reconexión ni las promesas de pago), así que no aparece en la lista, en la ficha, en el mapa de la caja NAP ni en el buscador, y tampoco están los filtros *Activos* y *Suspendidos*. Sí ve **«Por instalar»** y **«Baja»**, porque con eso trabaja. Lo que guarda el técnico (por ejemplo la ubicación) no pisa el estado real del cliente. La oficina y el administrador lo ven todo como antes.
- **El técnico no ve los servicios adicionales del cliente (Multimedia, Multimedia Net):** son de facturación, así que el servidor no se los manda (lo mismo que el precio). No aparecen en la lista, en la ficha, en el cobro ni como filtro. Los ve quien factura: administrador, oficina o quien tenga cobrar, caja, editar clientes o precios. Lo que guarda el técnico no los borra, y no puede cambiarlos.
- **Transferencias: el técnico adjunta la foto del comprobante.** Si el técnico cobra por **transferencia** (en *Cobrar*, en *Mis cobros* o al terminar una orden), aparece **«Comprobante de la transferencia»** y tiene que adjuntar la foto del comprobante con uno de dos botones: **«Sacar foto con la cámara»** (abre la cámara del celular directo, sin pasar por el selector de archivos) o **«Elegir una foto»** (la captura que le mandó el cliente, o una foto que ya tenga). Los dos botones están igual en *Cobrar*, en *Mis cobros* y al terminar una orden de instalación o reclamo. Sin la foto no se cierra la orden ni se registra el cobro. La foto se achica en el celular (menos de 400 KB) y se sube apenas la elige, y se ve en miniatura. El servidor también lo exige (no alcanza con esquivar la pantalla): rechaza una transferencia sin foto, un medio de pago inventado y una foto que ya se usó en otro cobro. Cada foto sirve para un solo cobro y queda atada a él: no se puede cambiar después. Las fotos que se suben y no se usan se borran a los 2 días. Con **efectivo** no se pide nada. La oficina (que cobra de todo) no tiene la obligación. **Hace falta el APK nuevo para que «Sacar foto con la cámara» abra la cámara directo** (con el APK anterior, o en el navegador de un celular, el botón abre igual el selector de fotos de Android, que también ofrece la cámara). El APK no pide permiso de cámara: la foto se guarda en un archivo temporal de la app (no en la galería) y se borra al sacar la siguiente.
- **Ver el comprobante:** en la caja del día, el cobro lleva el aviso **«Con comprobante»**, y en el **recibo** aparece **«Ver comprobante de la transferencia»** para el administrador, la oficina (los que ven los cobros) y el técnico que lo cobró. No es un enlace público: la foto se pide con la sesión. Las fotos no entran en las copias de seguridad diarias (solo los datos), así que quedan en el servidor aparte.
- **Mercado Pago y «Otro» no piden foto** (hoy solo la transferencia). Si querés que también la pidan, se cambia en una línea.
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

## Recibo por WhatsApp automático (cobros del técnico)

Todo lo que cobra un técnico en la calle **genera un recibo** (con su número, a su nombre y en la caja del día) que la oficina ve en **Cobranzas → Caja del día** (cada fila dice «cobró Pedro» y abre el recibo), y **le llega solo al cliente por WhatsApp** apenas el técnico registra el cobro.

- **Qué recibe el cliente:** un mensaje de la empresa con el nombre, el monto, el concepto, el número de recibo y la fecha («Hola Ana, recibimos tu pago de $ 65.000 por Instalación. Recibo N° R261101-AB3 del 01/11/2026. Gracias por elegir YAPUR.NET.»).
- **Qué ve cada uno:** el técnico, en el recibo, lee «El recibo le llega solo al cliente por WhatsApp» (y ya no tiene el botón para mandarlo a mano, para que el cliente no lo reciba dos veces). La oficina ve en cada cobro un cartel **«WhatsApp enviado»**, **«Enviando…»** o **«WhatsApp: no se envió»**; en el recibo, a qué número y cuándo salió, o el motivo si falló, con **Reintentar envío** (y **Volver a enviar solo** si ya había salido).
- **Si no sale:** el cobro queda igual registrado. Las causas más comunes: el cliente **no tiene teléfono** (o está mal escrito: tiene que llevar código de área, sin 0 ni 15 — se prueba también el segundo teléfono), o WhatsApp rechazó el mensaje. En la caja aparece un aviso rojo con **Reintentar los que fallaron** (los que no tienen teléfono se arreglan cargando el número en la ficha y tocando *Reintentar envío* en el recibo). Ante una falla pasajera de WhatsApp el servidor reintenta solo hasta 3 veces.
- **Topes de seguridad:** hasta 3 avisos automáticos por día al mismo número y 400 en total por día (frena un uso indebido). La oficina puede reenviar a mano igual.
- **Solo los cobros del técnico** se mandan solos. Los de la oficina y el administrador siguen como siempre: botón *Enviar por WhatsApp* del recibo.
- **Apagarlo:** *Ajustes → Recibo por WhatsApp* → destildar «Mandar el recibo por WhatsApp cuando cobra un técnico». Ahí mismo está **Mandar prueba** (llega a tu celular con datos de ejemplo).
- **Lo que NO se sabe:** «enviado» significa que WhatsApp aceptó el mensaje; no se registra si el cliente lo recibió o lo leyó.

### Conectarlo (una sola vez, lo hacés vos)

Usa la **API de WhatsApp Business de Meta**. Hace falta una cuenta de empresa en Meta, un número para enviar (conviene uno que no uses en tu WhatsApp común) y una plantilla aprobada. Meta cobra un valor chico por cada mensaje, y el cliente tiene que haber aceptado recibir avisos del negocio. La pantalla *Ajustes → Recibo por WhatsApp* muestra los mismos pasos:

1. En developers.facebook.com creá una app «Empresa», agregale el producto **WhatsApp** y registrá el número. Anotá el **identificador del número de teléfono**.
2. En business.facebook.com → *Configuración → Usuarios del sistema*: creá un usuario del sistema, asignale la app y generá un **token permanente** con el permiso `whatsapp_business_messaging`. (Los menús de Meta cambian de nombre seguido; si no los encontrás, buscalos con esas palabras.)
3. En *WhatsApp Manager → Plantillas de mensajes* creá la plantilla **`recibo_cobro`**, categoría **Utilidad**, idioma **Español (Argentina)**, con este texto (el botón *Copiar el texto* de Ajustes lo copia): `Hola {{1}}, recibimos tu pago de {{2}} por {{3}}. Recibo N° {{4}} del {{5}}. Gracias por elegir YAPUR.NET.` Ejemplos que pide Meta: Ana Paz · $ 65.000 · Instalación · R261101-AB3 · 01/11/2026. Esperá a que la aprueben.
4. En **Cloudflare → Workers y Pages → yapur → Configuración → Variables y secretos** agregá dos **Secretos** (tipo *Secret*, así un nuevo despliegue no los borra): **`WA_TOKEN`** (el token) y **`WA_PHONE_ID`** (el identificador del número). Guardá/desplegá.
5. Volvé a *Ajustes → Recibo por WhatsApp*: tiene que decir **Conectado**. Mandate una prueba.

El token y el identificador **no se escriben en la app ni en ningún archivo del repositorio** y el servidor nunca los devuelve: ni el administrador los ve en pantalla. Opcionales (mismo lugar, como secretos o variables): `WA_TEMPLATE` (nombre de la plantilla si usás otro, por defecto `recibo_cobro`), `WA_LANG` (por defecto `es_AR`), `WA_VER` (versión de la API de Meta, por defecto `v23.0`).

## Importar la lista de clientes (Excel) y el recibo con tu formato

- **Importar clientes:** *Ajustes → Importar clientes (CSV)*. Además de las columnas de siempre, ahora lee **velocidad** (elige el plan cuya bajada coincide: 2,5 · 3,5 · 5 · 10…), **cobrar desde** (por cliente: `2026-11` o `11/2026`), **ciclo** (1 o 2) y **precio especial**. Si el precio del archivo es igual al del plan, no se guarda como precio especial (así los cambios de precio del plan siguen llegando a esos clientes); si es distinto, sí. Una velocidad que no tiene plan se avisa antes de importar: esos clientes quedan sin plan pero se cobran igual por su precio.
- **Cobrar desde:** quien ya pagó el mes en curso entra con el mes siguiente; quien no pagó entra con el mes en curso y figura debiendo. No se arrastran meses anteriores.
- **Los que ya estaban:** si el nombre coincide (sin importar mayúsculas, tildes ni el orden de las palabras) no se vuelven a crear. Con **Completar** tildado se les llenan solo los datos que les faltaban (DNI, teléfono, plan, nodo, notas…); no se pisa nada de lo que ya tenían, y el ciclo y «cobrar desde» solo se tocan si el cliente todavía no tiene pagos. Importar dos veces la misma lista no duplica a nadie.
- **Subir precios en bloque:** *Ajustes → Clientes y cobranzas → Subir precios en bloque*. Elegís «pagan hasta $17.000, desde $10.000, pasan a $18.000, desde noviembre» y te muestra cuántos cambian antes de aplicar. Los meses anteriores conservan el precio viejo (queda como vigencia en cada cliente), no toca a los de abonos chicos (solo TV, adicionales), ni a los que digan «solo tv» en las notas, y se puede correr de nuevo sin cambiar a nadie dos veces. Si el plan del cliente ya vale el precio nuevo, el precio especial se saca y lo da el plan.
- **Clientes sin plan:** si al importar avisa «Velocidades sin plan», creá esos planes en *Planes* (la velocidad de bajada tiene que coincidir) y volvé a importar el mismo CSV con **Completar** tildado: les asigna el plan, y si su precio especial es igual al del plan, lo saca.
- **Precios de instalación:** *Ajustes → Precios de instalación* (solo el administrador). Ver «Cobros del técnico».
- **Datos del recibo:** *Ajustes → Datos del recibo* (nombre comercial, razón social, CUIT, Ingresos Brutos, domicilio, teléfonos, web, punto de venta y alias de pago). Se cargan una vez y salen en todos los recibos, como en el recibo de papel: ORIGINAL · NO VÁLIDO COMO FACTURA, punto de venta y número, cliente, condición de venta, período facturado y vencimiento, tabla con el servicio, importe total y alias. Se puede copiar, mandar por WhatsApp (mismo contenido en texto) o **imprimir** (desde la computadora). El número del recibo sigue siendo el código de la app (fecha + letras).

## Dónde están los técnicos (horario laboral)

La pestaña **Técnicos** muestra, para cada técnico, cuándo fue la última vez que mandó su posición, su precisión, el recorrido del día y dos botones: **Ver en el mapa** (abre Maps en su última posición) y **Recorrido del día** (ruta aproximada en Maps). Hay un selector de día para mirar los anteriores. La ve el administrador y quien tenga el permiso **«Ver dónde están los técnicos»** (Ajustes → Perfiles).

**Cómo saber si un técnico dejó de mandar** (se ve sin instalar nada nuevo):
- Cada técnico tiene un cartel de estado: **En línea** (mandó hace 10 minutos o menos), **Sin señal · hace N min** (pasaron más de 10 minutos; en rojo si pasó más de una hora), **Todavía no mandó su posición** (hoy, dentro del horario, no llegó nada), **Fuera de horario** o **Todavía no aceptó el aviso**.
- Arriba aparece un cartel amarillo con **quiénes están sin señal ahora** y desde cuándo, y esos técnicos suben al principio de la lista. La pestaña se actualiza sola cada minuto mientras se mira el día de hoy.
- **Tramos sin señal:** en cada técnico, «Sin señal 1 h 20 min en 3 tramos» se despliega con la lista de horarios (por ejemplo «10:05 a 10:48 · 43 min»). Cuenta como tramo todo silencio de **más de 10 minutos** dentro del horario, incluido el del arranque («antes de su primera posición») y el que todavía sigue abierto. Vale para cualquier día guardado (14 días). Si un día no tiene ningún punto, no se inventa un tramo: puede ser un día libre.
- **Avisarle por WhatsApp:** cuando está sin señal o todavía no mandó nada, el botón abre el chat del técnico con el mensaje ya escrito («…la oficina no recibe tu ubicación desde las 10:05. Abrí la app…»). Hace falta que tenga el teléfono cargado y el permiso para ver teléfonos. No se manda solo: lo enviás vos.
- Un silencio no siempre es culpa del técnico: celular apagado, sin datos o Android durmiendo la app (ver «Batería» más abajo).

Cómo funciona, para que sea claro y justo con quien trabaja en la calle:
- **Solo en horario laboral: de 8 a 20 h** (hora de Argentina). El horario lo controla el servidor con su reloj: lo que llega fuera de ese rango se descarta aunque el celular lo mande. El administrador lo cambia con **Cambiar el horario**.
- **Horario de corrido o cortado (con siesta).** Un día puede tener un tramo (de corrido, ej. 8 a 20) o dos (cortado, ej. **8 a 13 y 17 a 22**). En **Técnicos → Cambiar el horario**: se carga el de corrido, se tilda «También hay días con horario cortado», se cargan la mañana y la tarde y se tildan **qué días de la semana** se trabaja cortado (los demás quedan de corrido). Para **un día puntual** (por ejemplo un día de mucho calor) se elige la fecha y «cortado» o «de corrido» y gana sobre el día de la semana; el botón **«Hoy: cortado / de corrido»** de la pestaña Técnicos cambia solo el de hoy con un toque. Hay que cargar los dos tramos antes de poder marcar días cortados, y la mañana tiene que terminar antes de que empiece la tarde. Las horas son enteras.
  - **La siesta no cuenta como «sin señal»:** los tramos sin señal se miran tramo por tramo, y entre la mañana y la tarde el técnico figura «Fuera de horario». El servidor no guarda nada entre tramos. Si a la tarde se pasan 10 minutos de la hora de retomar sin recibir nada, recién ahí aparece «Sin señal».
  - **Jornada en un día cortado:** el *ingreso* es el primero de la mañana (se compara con el «desde» de la mañana), y se anota además la **retoma**: la primera vez a la tarde que el celular aparece en la base (*Retomó 17:03*, en amarillo si pasa la tolerancia, y *No retomó a la tarde* en rojo con un cartel arriba si no aparece). Entre los dos tramos figura **En siesta**, y el *fin* del día es el último regreso a la base de la tarde; en esos días no se muestra «jornada de X horas» porque incluiría la siesta.
  - Si el técnico vuelve a la base al mediodía y no a la tarde, o retoma sin haber ido a la base, la retoma queda vacía: el control mira dónde estuvo el celular, igual que el resto.
- **Cada técnico acepta un aviso** la primera vez que entra («Ubicación en horario laboral»): dice el horario, quién la ve y que se borra. Si dice «Ahora no», no se manda nada. Mientras comparte, ve el cartel **Ubicación activa** arriba.
- **Un punto por minuto** como máximo (el servidor no guarda más de uno cada 20 segundos) y **se borra a los 14 días**. No entra en las copias de seguridad.
- Solo los usuarios de tipo **Técnico** comparten ubicación. La oficina y el administrador no.
- **En Chrome** la posición se manda **mientras la página está abierta**. **En el APK (2.4 o posterior)** un servicio propio la manda también **con la pantalla apagada**; se ve una notificación fija «Gestión YAPUR: ubicación activa» mientras se comparte. **En un día cortado, con el APK 2.6 o posterior el servicio queda en pausa durante la siesta** (no le pide nada al GPS) y retoma solo a la hora de la tarde. Con un APK anterior a la 2.4 sigue valiendo lo de Chrome.
- **Siempre activo, sin abrir la app (APK 2.7 o posterior).** El servicio ya no se corta al terminar el día ni cuando se cierra la app: queda **«en espera»** (notificación discreta, sin tomar nada del GPS) y **empieza solo a la hora del horario de cada día**, aunque el técnico no haya abierto la app esa mañana. Así el ingreso y el fin de la jornada se anotan solos. El servicio le pide el horario del día al servidor (de corrido, cortado, días puntuales) con la sesión del técnico, y si no hay conexión usa el último que conoce. **Vuelve solo** al prender el celular, al actualizar la app y, con una alarma de control cada 15 minutos, si Android lo cerró. Se detiene cuando el técnico **cierra sesión** o si el servidor dice que la sesión ya no vale. Para poder volver solo, **la sesión del técnico queda guardada en la memoria privada de la app** (no se puede leer desde otras apps ni entra en copias de seguridad de Android); se borra al cerrar sesión.
  - **Hace falta una vez por celular:** abrir la app, entrar con el usuario del técnico y aceptar el aviso (que ahora dice que se comparte también con la app cerrada; quien ya había aceptado el aviso de antes ve **uno aparte** al abrir la app nueva: si dice «Ahora no», sigue como antes), y darle a la app el permiso de ubicación **«Permitir todo el tiempo»**. Desde Android 11 no es un cuadro: el botón **Activar** abre la pantalla de permisos de la app y ahí elige «Ubicación → Permitir todo el tiempo». Mientras no lo dé, arriba queda un cartel amarillo **«Activar ubicación “todo el tiempo”»** y se le vuelve a ofrecer una vez por día.
  - **Sin ese permiso** el servicio igual sigue todo el día si arrancó con la app abierta, pero **si el celular se reinicia o Android lo cierra, no puede volver solo a leer el GPS** hasta que el técnico abra la app (en horario de trabajo le aparece una notificación «tocá para activar tu ubicación» que, al tocarla, abre la app).
- Al instalar el APK nuevo, Android pide al técnico el permiso de ubicación (**«Mientras se usa la app»**, ubicación precisa), en Android 13 o posterior el de notificaciones y, con el APK 2.7, el de **«todo el tiempo»** (ver arriba). Fuera del horario no se toma ni se guarda nada, aunque el servicio esté en espera.
- **Batería:** el GPS cada minuto durante el día gasta más batería. Con el **APK 2.5 o posterior**, la primera vez que arranca el servicio el celular le pregunta al técnico si deja la app **«sin restricción de batería»** (cuadro del propio Android: tiene que tocar **Permitir**). Es lo que más evita que Android duerma o cierre la app con la pantalla apagada. Si dice que no, se le vuelve a preguntar a los 3 días. En algunos celulares (Xiaomi, Samsung, Motorola…) además conviene revisar a mano en Ajustes → Aplicaciones → Gestión YAPUR → Batería que diga **«Sin restricciones»** y, en Xiaomi/Huawei, permitir el «inicio automático». En Android 14 o posterior el técnico puede quitar la notificación deslizándola; el servicio sigue, y el cartel «Ubicación activa» de la app lo confirma.
- **Qué no se puede garantizar** (hay que saberlo, y **no se pudo probar en un celular real desde acá**):
  - Si el técnico **fuerza el cierre** de la app (Ajustes → Aplicaciones → Gestión YAPUR → *Forzar detención*), Android desactiva todo hasta que la abra de nuevo: ni el servicio ni el aviso de arranque funcionan.
  - **Xiaomi, Huawei, Oppo, Vivo, Realme y algunos Samsung** cierran las apps en segundo plano por su cuenta. Además de «sin restricción de batería», en esos celulares hay que activar a mano el **«inicio automático»** (o «autoarranque») y, en Samsung, sacar la app de «aplicaciones en suspensión». Es una vez por celular; si no, el servicio puede morir de noche y no volver.
  - Desde **Android 12** el sistema limita arrancar un servicio de ubicación desde segundo plano. Con **«todo el tiempo»** concedido, el arranque al prender el celular y la alarma de control están previstos y deberían funcionar; si Android igual lo rechaza, queda la notificación «tocá para activar». La oficina lo ve en la pestaña **Técnicos** («Sin señal» o «Todavía no mandó su posición») y puede avisarle por WhatsApp.
  - El **primer minuto del día** puede atrasarse unos minutos si el celular está quieto, apagado de pantalla y en ahorro profundo (Android demora las alarmas). Para que el *ingreso* no figure tarde por eso, conviene que el «Desde» del horario sea **un rato antes** de la hora de llegada.
- Si el técnico no dio el permiso de ubicación del celular, ve «Ubicación sin permiso» y en la pestaña figura «Todavía no mandó su posición».

## Control de ingreso y fin del día (jornada)

Anota **solo**, sin que el técnico toque nada, a qué hora empezó y a qué hora terminó el día, mirando si el celular está en la base (donde guardan los vehículos). No hace falta APK nuevo. **Viene apagado:** mientras no se cargue la base no se anota nada, no hay alarmas ni barra en el celular del técnico.

**Cómo se arma** (administrador): pestaña **Técnicos → Base y jornada**. Parado **en el galpón donde se guardan los vehículos** (no en el local de adelante: el pin de Google Maps del negocio queda a unos metros del galpón), al aire libre y quieto, tocá **«Usar mi ubicación actual (GPS)»** y guardá. Toma unas 10 lecturas (hasta 20 s) y las promedia dando más peso a las más precisas; esperá a que diga **±10 m o menos** (con más de ±15 m avisa que es poco precisa y conviene repetir en un lugar más abierto). Se ajustan el **radio** (40 m por defecto; de 20 a 2000), la **tolerancia** para llegar (10 min) y los **días de trabajo** (lunes a sábado; los demás días no cuentan como falta). La hora esperada de ingreso es el **«Desde»** del horario de ubicación (por defecto las 8).
- **Ingreso:** la primera posición del día dentro del radio de la base. La hora es la de esa posición (el servidor no acepta horas de más de 15 minutos atrás).
- **Fin:** cada vez que el celular sale de la base y vuelve a entrar se anota un **regreso**; el **último regreso del día** es el fin. Si vuelve a salir, deja de figurar como terminada hasta que regrese. Para que un punto de GPS pegado al borde no cuente como entrar y salir, se «sale» recién a 1,5 veces el radio.
- **Ingreso a mano:** si un técnico arranca sin pasar por la base, toca **«Iniciar jornada»** en la barra de arriba. Queda marcado como **manual**, con la distancia a la base, para que se vea.

**Qué ve el técnico:** una barra arriba, siempre visible: «Tu jornada laboral comenzó a las 08:47 · en la base» y, al volver, «…y terminó a las 18:05 al volver a la base (9 h 18 min)». La primera vez muestra un aviso con **«Más info»** y **«Entendido»** (queda constancia de que lo vio; el registro funciona igual aunque no lo toque).

**Qué ve la oficina** (Técnicos, con el selector de día): *Ingresó 08:47 · 47 min tarde* (pasada la tolerancia, en amarillo), *Terminó 18:05 · jornada de 9 h 18 min*, *Sin ingreso* en rojo, un **cartel arriba con quiénes no ingresaron hoy** (esos técnicos suben al principio de la lista) y, en días anteriores, *No volvió a la base*. El atraso se mide contra el «Desde» del horario.

**Límites, para no esperar de más:**
- **Con el APK 2.7 y el permiso «Permitir todo el tiempo» no hace falta abrir la app:** el servicio queda andando y manda la posición solo en el horario (ver «Dónde están los técnicos»). **En el navegador o con un APK anterior sí**: la app tiene que estar abierta (al menos una vez en el día) para que el celular mande su posición; sin eso no hay dato y figura «Sin ingreso».
- Registra **dónde está el celular**, no si la persona trabajó: un celular olvidado en la base seguiría figurando en la base.
- **Qué tan justo es:** la hora de ingreso tiene una exactitud de **±1 minuto** (el celular manda una posición por minuto), y el lugar, la del GPS del teléfono: **entre 5 y 15 m al aire libre**, bastante peor bajo techo. Por eso el radio de 40 m: más chico que eso, un celular parado adentro del galpón puede figurar «afuera» cuando el GPS se corre. Si pasa, subilo a 60.
- Una posición cuya precisión es peor que el radio (o que 50 m, lo que sea mayor) **se ignora**: ni cuenta como entrar ni como salir. Así una lectura mala bajo techo no genera un ingreso o un regreso falsos.
- **Después de volver a la base la ubicación se sigue compartiendo hasta el final del horario** (de corrido, hasta las 20 h; cortado, hasta el final de la tarde); no se corta sola al terminar. Si no querés ver el camino a casa del técnico, bajá el «Hasta» del horario.
- Se guardan **90 días**, y solo la hora, el origen (base o manual) y la distancia a la base: **no se guardan coordenadas** en este registro. No entra en las copias de seguridad, igual que la ubicación.

## Horas trabajadas (para pagar por hora)

Sale de la jornada de arriba, sin cargar nada: no hace falta APK nuevo. En **Técnicos → Horas trabajadas** ves, por técnico, **una casilla por día** de la semana (lunes a domingo, en horas:minutos) y el **total de la semana**. Con las flechas pasás a otras semanas (hasta 90 días atrás). Tocando una casilla ves el detalle del día: los tramos y cómo se contó. Abajo, **«Copiar el resumen»** (para pegarlo en WhatsApp) y **«Descargar CSV»** (una fila por día, con las horas en h:mm y en decimal, por ejemplo 8,50, y el total de cada técnico).

**Cómo se cuenta un día:** desde que el celular llega a la base (el ingreso) hasta la última vez que vuelve a ella. Si sale a trabajar y vuelve a la base, ese rato **cuenta** (es tiempo de trabajo). En un día **cortado** se cuenta cada tramo por separado y **la siesta no se cuenta**: la mañana va del ingreso a la última vez que estuvo en la base antes del corte (o hasta el final del tramo, si cortó sin pasar por la base), y la tarde, de la retoma a su último regreso.

**Los días que hay que mirar:**
- **Sin cerrar** (amarillo): el técnico ingresó pero no se lo vio volver a la base (se quedó sin batería, cerró la app, no pasó por la base). Se cuenta hasta la última posición recibida, que puede ser menos de lo que trabajó. Hay un cartel arriba con la cantidad de días así.
- **En curso** (verde): el día de hoy, que sigue sumando.
- **Corregido** (con asterisco): lo cargó la oficina a mano.

**Corregir un día** (solo el administrador): tocás la casilla → **«Corregir las horas»** y cargás a qué hora empezó y terminó (un par de horas por tramo), con el motivo, que queda anotado junto con quién lo cambió. Sirve también para cargar un día en el que no hubo registro. Lo que cargues **reemplaza** el cálculo automático de ese día; con **«Volver al cálculo automático»** se saca la corrección y vuelve lo que midió el celular (no se pierde nada).

**Qué ve el técnico:** en la barra de arriba, **«Hoy 5 h 10 min · semana 21 h»** y el botón **«Mis horas»** con cada día de la semana. Si un día figura «Sin cerrar» o no le cierra, le avisa a la oficina. No puede corregir nada. Los demás perfiles de oficina no ven las horas salvo que tengan el permiso de ver técnicos.

**Límites, para no pagar de más ni de menos:**
- Es el tiempo que **el celular estuvo reportando** entre el ingreso y el último regreso a la base, no una prueba de que la persona trabajó: un celular olvidado, o un técnico que se queda en el galpón, sigue sumando. Por eso conviene revisar el resumen antes de pagar.
- Si el horario de ubicación termina antes de que el técnico vuelva a la base (por ejemplo, el horario es hasta las 20 y vuelve a las 20:30), ese regreso **no se registra** y el día queda «Sin cerrar». Conviene que el «Hasta» del horario sea más tarde que el fin real de la jornada.
- Las horas se guardan **90 días**, igual que la jornada, y no entran en las copias de seguridad: **descargá el CSV de cada semana o quincena al liquidar**.
- La exactitud de cada hora es la de la jornada (±1 minuto en la hora y los metros del GPS del teléfono).

## Cliente nuevo desde el reporte del técnico

En **Clientes → Nuevo cliente**, arriba, está **Completar con el reporte del técnico**: pegás el texto que manda el técnico por WhatsApp y toca **Completar los datos**.

```
NOMBRE: Ana Ester Paz
DNI: 28354900
IP: 10.20.43.9
PAGO: (Efectivo) 65mil pesos que es el costo de instalación
```

- Lee `NOMBRE`, `DNI`, `IP` y `PAGO`; también `TELÉFONO`, `DIRECCIÓN`, `LOCALIDAD` y `PLAN` si vienen. Ignora los emojis y los renglones en blanco.
- Deja al cliente **activo** y con «cobrar desde» el **mes siguiente** (se puede cambiar). Avisa qué falta completar (el teléfono y la calle son obligatorios) y si ya hay otro cliente con ese DNI o esa IP.
- Si trae un pago («65mil», «65 mil pesos», «$65.000»…), al guardar se abre **Cobrar** ya completado: concepto (instalación, o reclamo si dice «reclamo» o «visita»; una reconexión se carga como «Otro»), medio (efectivo, transferencia o Mercado Pago) y monto. Hay que confirmarlo con «Registrar cobro».
- El cobro queda a nombre de quien lo registra. Si la plata la tiene el técnico y tiene que figurar en su caja, que lo cargue él desde su celular con «Cobrar instalación o reclamo».

## Planes de noviembre (un solo botón)

En **Planes**, si faltan, aparece el aviso **Cargar planes de noviembre**: crea de una vez **Plan 100** ($18.000) y **Plan 200** ($19.000) de 15 Mbps, y **Plan 20 Mbps** ($23.000), **Plan 25 Mbps** ($24.000) y **Plan 30 Mbps** ($35.000). Las velocidades y la ráfaga salen de las colas de los routers (ráfaga = velocidad + 10M, umbral 8M, 22 s, garantizada 256k de subida y 1M de bajada). Si ya existe un plan con ese nombre, no se duplica ni se toca. Después se editan como cualquier plan (el precio con «rige desde»).

De dónde salen: en los 4 routers (Admin, FM, Leo, Bomberos; 729 colas al 31/10/2026) casi todo es 15M/15M con ráfaga 25M (Plan 100 y Plan 200 comparten velocidad, solo cambia el precio) y hay un segundo nivel 25M/25M con ráfaga 35M; el resto son casos sueltos (20M, 30M, 40M, 50M…) que se cargan con «precio especial».

Cuando los de noviembre ya están cargados y los clientes ya se pasaron a ellos, el mismo lugar ofrece **Desactivar planes sin clientes**: deja de ofrecer los planes viejos que nadie usa. No se borran; se reactivan desde «Editar».

**Eliminar un plan:** Planes → el plan → *Editar* → **Eliminar plan** (solo el administrador). Se puede únicamente si **ningún cliente lo usa**: ni los activos, ni los dados de baja, ni en el historial de precios de un cliente (un cliente que antes tuvo ese plan lo conserva ahí para que los meses viejos y la deuda anterior no cambien de precio). Si alguien lo usa, el formulario lo explica («figura en 12 clientes») y no muestra el botón; el servidor también lo rechaza. En ese caso lo que corresponde es **destildar «Plan disponible para clientes nuevos»**: deja de ofrecerse y todo lo cargado sigue intacto. Eliminar no se puede deshacer, pero queda en las copias de seguridad diarias.

## Cómo se arma lo que paga cada cliente: plan + servicios

El total mensual es **el plan de internet + cada servicio adicional** (por ejemplo Plan 100 + Multimedia + Multimedia Net). Los precios de los servicios se cambian en la pestaña *Planes*, sección *Servicios adicionales* (solo el administrador). El **precio especial** reemplaza **solo la parte de internet**: los servicios se suman aparte. Por eso:
- Cliente con Plan 100 y Multimedia: plan = Plan 100, servicio = Multimedia, precio especial vacío. Cobra lo que vale el plan + lo que vale Multimedia.
- Si ese cliente tiene un descuento en internet, el precio especial es **solo el internet con descuento**, no el total con el servicio. Si cargás el total, el servicio se cuenta dos veces.
- Cliente que paga solo un servicio (TV, adicionales): plan «Sin plan» y el servicio tildado.
- Para controlar la caja del mes: el **Resumen** muestra la *Facturación mensual de activos* y, abajo, cuántos clientes tiene cada plan y cada servicio con su total.

## Asignar planes y servicios a los clientes ya cargados

En **Ajustes → Importar clientes (CSV)** tildá **Actualizar el plan, los servicios y el precio de los que ya están cargados** y elegí desde qué mes rigen (por defecto el siguiente). El archivo necesita la columna `nombre` y, según lo que quieras cambiar, `plan`, `servicios` y `precio especial`.
- Se buscan por nombre (sin importar el orden de las palabras). **No se crean clientes nuevos**: las filas sin coincidencia se cuentan aparte y se saltean.
- `plan` con el nombre exacto del plan (creálo antes en Planes). `Sin plan` deja solo los servicios. `servicios` admite varios: `Multimedia + Multimedia Net`.
- `precio especial` es **solo la parte de internet** (los servicios se suman aparte). Vacío = que cobre el precio del plan. Si es igual al del plan, se saca solo.
- Una fila sin plan ni servicios no toca a nadie. Lo que tenía cada cliente queda guardado hasta el mes anterior, así los meses viejos y la deuda anterior conservan su precio.
- Antes de confirmar ves cuántos cambian, por plan.

## Empezar a cobrar de cero y «Deuda anterior»

**Ajustes → Clientes y cobranzas → Empezar a cobrar de cero.** Elegís el mes desde el que se cobra (por defecto el siguiente) y la pantalla te cuenta cuántos clientes se mueven y cuánto suman las deudas. Al confirmar, todos los clientes activos y suspendidos pasan a «cobrar desde» ese mes: ninguno figura como moroso ni «A cortar» por meses anteriores.

Lo que cada uno debía hasta ese momento **no se pierde**: queda anotado como **Deuda anterior** (los meses sin pagar, al precio que tenían). Es un saldo aparte:
- No genera cortes ni aparece en «Morosos». Se cobra cuando el cliente pueda.
- Se ve como chip «Deuda anterior · $…» en la lista y en la ficha, con el detalle de los meses.
- **Cobranzas → Deuda anterior** lista a todos (los que más deben primero), con el total por cobrar, botón **Cobrar** y **Recordar por WhatsApp**. El Resumen muestra el total y lleva a esa lista.
- **Cobrar deuda anterior** acepta pagos parciales y emite recibo («Deuda anterior: Octubre de 2026»). Si se anula el cobro, la deuda vuelve.
- En la ficha, **Editar → Facturación** permite cargar o corregir la deuda a mano (por ejemplo una que estaba anotada en las notas), y **Dar por saldada** la perdona.

**Sin deuda anterior:** tildá **«No dejar deuda anterior: perdonar lo que debían»** y nadie queda debiendo nada: los meses sin pagar no se anotan y la deuda anterior que ya estuviera cargada se da por saldada (a todos, incluso a quienes ya empezaban ese mes). La pantalla cuenta cuánto se perdona antes de confirmar. **No se puede deshacer**, por eso viene sin tildar. Los cobros ya hechos y los recibos no se tocan.

Correrlo dos veces no mueve a nadie dos veces. Los clientes que ya empiezan ese mes o después, los «por instalar» y los de baja no se tocan.

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

**No se pudo probar** en este entorno: el programa de Android en un celular real (incluido el permiso, la lectura real del GPS y el servicio de ubicación con la pantalla apagada, que depende de cada marca y versión de Android) (se verificó que el APK se arma, firma y alinea bien y que el manifiesto declara el servicio como corresponde, pero no hay emulador), la publicación real en Cloudflare ni la corrida real en GitHub Actions. Si algo falla en alguno de esos tres pasos, es lo primero que hay que mirar.

Para volver a correr las pruebas: `cd yapur-app/tests && npm install && npm test` (GitHub también las corre en cada pedido de cambios, con `probar-yapur.yml`).

## Para quien mantenga el código

- `app/src/` es el código de la aplicación; `node yapur-app/app/build.js` lo arma en `worker/public/` (que es lo que publica Cloudflare). Si se cambia `src` y no se arma, la prueba `test_build.js` falla a propósito.
- `worker/src/worker.js` es el servidor (un Worker + una base SQLite dentro de un Durable Object).
- `android/` es el APK (sin Gradle, mismo método que FAVL): `build_apk.sh`.
- Los secretos de firma (`KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`) son los mismos que ya usa FAVL; no hay que cargar nada nuevo.
