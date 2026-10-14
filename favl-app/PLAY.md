# Publicar FAVL Bandera Vuela en Google Play

La app ya está preparada para Play: apunta a Android 16 (API 36, lo que Google exige desde el 31/08/2026) y cada compilación
genera, además del APK del enlace, un **AAB** (el formato de Play) firmado con la misma clave de FAVL.
El AAB queda en *Actions → Compilar APK FAVL → (la corrida) → Artifacts → `FAVL-BanderaVuela-12.xx-aab`* (se baja como .zip; adentro está el `.aab`).

Cuenta: **personal, a nombre de Mauro Yapur**. Por ser personal y nueva, Google pide una **prueba cerrada con al menos
12 personas durante 14 días seguidos** antes de dejar publicarla para todos.

---

## 1. Crear la cuenta (una sola vez)

1. Entrá a <https://play.google.com/console> con la cuenta de Gmail que quieras usar para la app.
2. Tipo de cuenta: **Personal** (*Yourself / Para vos*).
3. Completá los datos, pagá los **US$ 25** (pago único) y verificá tu identidad (foto del DNI). También pide verificar un
   teléfono y que confirmes que tenés un celular Android con la app de Play Console.
4. La verificación puede tardar de horas a unos días. Llega un correo cuando está lista.

## 2. Crear la app en la consola

*Home → Create app*:
- Nombre: **FAVL Bandera Vuela** · Idioma predeterminado: **Español (Latinoamérica) – es-419**
- App o juego: **App** · Gratis o pagada: **Gratis**
- Aceptá las declaraciones → *Create app*.

## 3. Completar «Configurar la app» (Dashboard)

Respuestas sugeridas (revisalas antes de mandar):

| Sección | Qué poner |
|---|---|
| **Política de privacidad** | `https://yapurnet.github.io/favl-privacidad.html` |
| **Acceso a la app** | «Algunas funciones están restringidas». Instrucciones: «El cuestionario de estudio es libre. Para entrar al examen hace falta un código de acceso: usar `<código para revisores>`». *(Pedime que cree un código fijo solo para Google.)* |
| **Anuncios** | No contiene anuncios |
| **Clasificación de contenido** | Categoría: Referencia, noticias o educación. Todas las respuestas «No» → queda para todo público |
| **Público objetivo** | 18 años o más *(si rinden menores, marcá también 16-17; nunca menores de 13)* |
| **App de noticias / gobierno / salud / finanzas** | No |
| **Seguridad de los datos** | Ver la tabla de abajo |

**Seguridad de los datos** (*Data safety*):
- ¿Recopila o comparte datos? **Sí**. ¿Todo viaja cifrado? **Sí**. ¿Se puede pedir que se borren? **Sí**, por correo, como dice la política.
- Datos recopilados (todos con propósito **«Funcionalidad de la app»**, **no compartidos**, y el usuario los ingresa a mano):

| Tipo (en la consola) | Cuál | ¿Obligatorio? |
|---|---|---|
| Información personal → Nombre | Nombre del alumno y del instructor | Obligatorio |
| Información personal → Dirección de correo | Correos de los instructores | Opcional |
| Información personal → Número de teléfono | Teléfono del alumno | Opcional |
| Información personal → Otra información | DNI y número de licencia | Obligatorio |
| Fotos y videos → Fotos | Logo del instructor | Opcional |
| Actividad en la app → Otro contenido generado por el usuario | Respuestas y resultado del examen | Obligatorio |

## 4. Firma de la app (lo más importante)

Para que los celulares que ya tienen la app instalada desde el enlace **se actualicen desde Play sin desinstalar**,
Play tiene que firmar con la **misma clave de FAVL** (`favlapp-release.keystore`). Al crear la primera versión, en
*Firma de apps de Google Play* elegí **«Usar otra clave» → «Exportar y subir una clave de un almacén de claves Java»**:

1. Bajá la herramienta **PEPK** y la **clave pública de encriptación** que muestra esa pantalla.
2. En una PC con Java, en la carpeta donde están `pepk.jar`, el `.pem` y `favlapp-release.keystore`:
   ```
   java -jar pepk.jar --keystore=favlapp-release.keystore --alias=favlapp --output=favl-clave-para-play.zip --include-cert --rsa-aes-encryption --encryption-key-path=encryption_public_key.pem
   ```
   (pide las contraseñas del keystore y de la clave).
3. Subí `favl-clave-para-play.zip`. La **clave de carga** puede ser la misma (no hace falta subir otro certificado).

> Si no tenés una PC con Java a mano, avisame: puedo hacer este paso con un flujo de GitHub que usa los secretos que ya están cargados.
> Nunca subas el `.keystore` a ningún lado que no sea esa pantalla de Google.

## 5. Primera versión: prueba cerrada (14 días)

1. *Testing → Closed testing → Create track* (o usar «Alpha»). Testers: una **lista de correos** (Gmail de cada uno) o un Grupo de Google.
   Conviene **15 a 20 personas**: si bajan de 12 durante los 14 días, el conteo vuelve a empezar.
2. *Create new release* → subí el `.aab` (de *Actions → Artifacts*). Notas: «Primera versión en Google Play».
3. *Review release → Start rollout*. Google la revisa (horas a unos días).
4. Mandá a los testers el **enlace de participación** que muestra la pista («Join on the web»). Cada uno toca *Become a tester*
   y después instala desde Play. **Tienen que seguir anotados los 14 días**.
5. Pasados los 14 días: *Dashboard → Apply for production* y contestá las preguntas sobre la prueba.

## 6. Subida automática (opcional, después de la primera versión)

Para que cada compilación suba sola el AAB a Play:
1. En <https://console.cloud.google.com>: creá un proyecto, activá la **Google Play Android Developer API**, creá una
   **cuenta de servicio** y una **clave JSON** para ella.
2. En Play Console → *Usuarios y permisos* → *Invitar usuario* → el correo de la cuenta de servicio → permisos de **versiones** sobre la app.
3. En GitHub → *Settings → Secrets and variables → Actions*: secreto **`PLAY_SERVICE_ACCOUNT_JSON`** con el contenido del JSON.
4. Opcional (pestaña *Variables*): `FAVL_PLAY_TRACK` = `internal` (por defecto), `alpha` (prueba cerrada) o `production`;
   `FAVL_PLAY_STATUS` = `draft` (por defecto: queda como borrador y lo publicás vos) o `completed` (sale directo).

La primera subida a Play siempre se hace a mano (paso 5); la automática funciona desde la segunda.

## Mientras tanto

El enlace `https://yapurnet.github.io/FAVL-BanderaVuela.apk` sigue funcionando igual. Quien la instaló desde el enlace y después
la instala desde Play (con la misma clave) pasa a recibir las actualizaciones de Play sin perder nada.
