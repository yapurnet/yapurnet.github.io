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

Si un técnico cobra la instalación, una reconexión o un reclamo, lo carga en la app y entra a la caja del día con su nombre:

- **Darle el permiso:** Ajustes → Usuarios → editar al técnico → *Cobrar instalaciones y reclamos en la calle*. Viene apagado: lo prendés solo a quien cobra. Con ese permiso **no cobra mensualidades** (eso sigue siendo de la oficina) y **no ve la caja ni lo que cobran otros**.
- **Cómo lo carga el técnico:** (1) pestaña **Mis cobros** → busca al cliente → *Cobrar* (instalación, reconexión, reclamo u otro, con el monto y el medio de pago); (2) desde la ficha del cliente → *Cobrar instalación o reclamo*; (3) **al terminar una orden**, tildando *Cobré este trabajo* (el concepto se completa según el tipo de orden). Siempre se registra con la fecha de hoy y a su nombre: no puede poner otra fecha ni borrarlo. Si se equivoca, la oficina anula el recibo y se carga de nuevo.
- **Mis cobros:** muestra lo que cobró hoy y los últimos 7 días, y cuánto efectivo tiene que entregar hoy.
- **Instalación solo para quien se instala; reinstalación para una mudanza:** a quien cobra en la calle, «Instalación» solo se le ofrece (y el servidor solo la acepta) para un cliente **«Por instalar»**. A un cliente que ya está instalado se le ofrece **«Reinstalación (mudanza)»** (y también Reconexión, Reclamo u Otro); si intenta cobrarle «Instalación», el servidor lo rechaza y le dice que cobre la reinstalación. Al revés, «Reinstalación» no se cobra a un cliente que todavía está «Por instalar». Al cerrar una orden de instalación sobre un cliente ya instalado, el concepto viene como Reinstalación. La oficina (que cobra de todo) no tiene esta restricción.
- **El técnico no ve pagos:** no hay caja, ni cobranzas, ni morosos, ni lo que se le cobró a un cliente: el servidor ni siquiera le manda los pagos. Lo único que ve es **Mis cobros**: los recibos que cargó él mismo (hoy y los últimos 7 días) y cuánto efectivo debe entregar. Cuando el administrador mira la app «como técnico» (*Vista: …*), esa pestaña también muestra solo los cobros de ese técnico.
- **El técnico no ve si el cliente está activo o suspendido por falta de pago:** el servidor no le manda el estado «Activo» ni «Suspendido» (ni la fecha de corte, la reconexión ni las promesas de pago), así que no aparece en la lista, en la ficha, en el mapa de la caja NAP ni en el buscador, y tampoco están los filtros *Activos* y *Suspendidos*. Sí ve **«Por instalar»** y **«Baja»**, porque con eso trabaja. Lo que guarda el técnico (por ejemplo la ubicación) no pisa el estado real del cliente. La oficina y el administrador lo ven todo como antes.
- **El técnico no ve los servicios adicionales del cliente (Multimedia, Multimedia Net):** son de facturación, así que el servidor no se los manda (lo mismo que el precio). No aparecen en la lista, en la ficha, en el cobro ni como filtro. Los ve quien factura: administrador, oficina o quien tenga cobrar, caja, editar clientes o precios. Lo que guarda el técnico no los borra, y no puede cambiarlos.
- **Transferencias: el técnico adjunta la foto del comprobante.** Si el técnico cobra por **transferencia** (en *Cobrar*, en *Mis cobros* o al terminar una orden), aparece **«Comprobante de la transferencia»** y tiene que **elegir la foto del comprobante** (la que sacó con la cámara del celular o la captura que le mandó el cliente): sin la foto no se cierra la orden ni se registra el cobro. La foto se achica en el celular (menos de 400 KB) y se sube apenas la elige, y se ve en miniatura. El servidor también lo exige (no alcanza con esquivar la pantalla): rechaza una transferencia sin foto, un medio de pago inventado y una foto que ya se usó en otro cobro. Cada foto sirve para un solo cobro y queda atada a él: no se puede cambiar después. Las fotos que se suben y no se usan se borran a los 2 días. Con **efectivo** no se pide nada. La oficina (que cobra de todo) no tiene la obligación.
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

## Importar la lista de clientes (Excel) y el recibo con tu formato

- **Importar clientes:** *Ajustes → Importar clientes (CSV)*. Además de las columnas de siempre, ahora lee **velocidad** (elige el plan cuya bajada coincide: 2,5 · 3,5 · 5 · 10…), **cobrar desde** (por cliente: `2026-11` o `11/2026`), **ciclo** (1 o 2) y **precio especial**. Si el precio del archivo es igual al del plan, no se guarda como precio especial (así los cambios de precio del plan siguen llegando a esos clientes); si es distinto, sí. Una velocidad que no tiene plan se avisa antes de importar: esos clientes quedan sin plan pero se cobran igual por su precio.
- **Cobrar desde:** quien ya pagó el mes en curso entra con el mes siguiente; quien no pagó entra con el mes en curso y figura debiendo. No se arrastran meses anteriores.
- **Los que ya estaban:** si el nombre coincide (sin importar mayúsculas, tildes ni el orden de las palabras) no se vuelven a crear. Con **Completar** tildado se les llenan solo los datos que les faltaban (DNI, teléfono, plan, nodo, notas…); no se pisa nada de lo que ya tenían, y el ciclo y «cobrar desde» solo se tocan si el cliente todavía no tiene pagos. Importar dos veces la misma lista no duplica a nadie.
- **Subir precios en bloque:** *Ajustes → Clientes y cobranzas → Subir precios en bloque*. Elegís «pagan hasta $17.000, desde $10.000, pasan a $18.000, desde noviembre» y te muestra cuántos cambian antes de aplicar. Los meses anteriores conservan el precio viejo (queda como vigencia en cada cliente), no toca a los de abonos chicos (solo TV, adicionales), ni a los que digan «solo tv» en las notas, y se puede correr de nuevo sin cambiar a nadie dos veces. Si el plan del cliente ya vale el precio nuevo, el precio especial se saca y lo da el plan.
- **Clientes sin plan:** si al importar avisa «Velocidades sin plan», creá esos planes en *Planes* (la velocidad de bajada tiene que coincidir) y volvé a importar el mismo CSV con **Completar** tildado: les asigna el plan, y si su precio especial es igual al del plan, lo saca.
- **Datos del recibo:** *Ajustes → Datos del recibo* (nombre comercial, razón social, CUIT, Ingresos Brutos, domicilio, teléfonos, web, punto de venta y alias de pago). Se cargan una vez y salen en todos los recibos, como en el recibo de papel: ORIGINAL · NO VÁLIDO COMO FACTURA, punto de venta y número, cliente, condición de venta, período facturado y vencimiento, tabla con el servicio, importe total y alias. Se puede copiar, mandar por WhatsApp (mismo contenido en texto) o **imprimir** (desde la computadora). El número del recibo sigue siendo el código de la app (fecha + letras).

## Dónde están los técnicos (horario laboral)

La pestaña **Técnicos** muestra, para cada técnico, cuándo fue la última vez que mandó su posición, su precisión, el recorrido del día y dos botones: **Ver en el mapa** (abre Maps en su última posición) y **Recorrido del día** (ruta aproximada en Maps). Hay un selector de día para mirar los anteriores. La ve el administrador y quien tenga el permiso **«Ver dónde están los técnicos»** (Ajustes → Perfiles).

Cómo funciona, para que sea claro y justo con quien trabaja en la calle:
- **Solo en horario laboral: de 8 a 20 h** (hora de Argentina). El horario lo controla el servidor con su reloj: lo que llega fuera de ese rango se descarta aunque el celular lo mande. El administrador lo cambia con **Cambiar el horario**.
- **Cada técnico acepta un aviso** la primera vez que entra («Ubicación en horario laboral»): dice el horario, quién la ve y que se borra. Si dice «Ahora no», no se manda nada. Mientras comparte, ve el cartel **Ubicación activa** arriba.
- **Un punto por minuto** como máximo (el servidor no guarda más de uno cada 20 segundos) y **se borra a los 14 días**. No entra en las copias de seguridad.
- Solo los usuarios de tipo **Técnico** comparten ubicación. La oficina y el administrador no.
- **En Chrome** la posición se manda **mientras la página está abierta**. **En el APK (versión 2.4 o posterior)** un servicio propio la manda también **con la pantalla apagada**, hasta las 20 h; se ve una notificación fija «Gestión YAPUR: ubicación activa» mientras dura, y se detiene solo al terminar el horario, al cerrar sesión o si el servidor lo indica. Con un APK anterior sigue valiendo lo de Chrome.
- Al instalar el APK nuevo, Android pide al técnico el permiso de ubicación (**«Mientras se usa la app»**, ubicación precisa) y, en Android 13 o posterior, el de notificaciones. No se pide ubicación «en segundo plano» ni se usa fuera del horario.
- **Batería:** el GPS cada minuto durante el día gasta más batería. En algunos celulares (Xiaomi, Samsung, Motorola…) conviene poner la app en **«Sin restricciones»** en Ajustes → Aplicaciones → Gestión YAPUR → Batería; si no, el sistema puede dormirla y la posición llega con huecos. En Android 14 o posterior el técnico puede quitar la notificación deslizándola; el servicio sigue, y el cartel «Ubicación activa» de la app lo confirma.
- Si el técnico no dio el permiso de ubicación del celular, ve «Ubicación sin permiso» y en la pestaña figura «Todavía no mandó su posición».

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
- Si trae un pago («65mil», «65 mil pesos», «$65.000»…), al guardar se abre **Cobrar** ya completado: concepto (instalación, reconexión o reclamo según el texto), medio (efectivo, transferencia o Mercado Pago) y monto. Hay que confirmarlo con «Registrar cobro».
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
