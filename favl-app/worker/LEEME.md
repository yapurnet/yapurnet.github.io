# Worker de Cloudflare — saca la clave de GitHub de dentro de la app

## Por qué

Hasta ahora la app llevaba **dentro del APK** una clave de GitHub (la que permite abrir pedidos en el repositorio).
Un APK es un archivo público: cualquiera lo puede abrir y sacar esa clave, y con ella podría agregarse como
instructor, crear claves de examen o apagar «Exigir clave personal».

Con el Worker, la clave de GitHub vive **solo en Cloudflare** (como secreto). La app únicamente conoce la dirección
del Worker, y el Worker revisa cada pedido antes de mandarlo a GitHub:

| Quién | Qué puede hacer | Con qué |
|---|---|---|
| **Alumno** | Gastar su clave personal de examen (`XXXX-XXXX-XXXX`) | Nada: el Worker comprueba que la clave exista, no esté usada ni vencida |
| **Instructor** | Agregar/editar/quitar instructores, crear/anular claves, «Exigir clave personal» | La **clave de publicación** (se escribe una vez en su celular) |
| **Cualquier otro** | Nada | — |

La clave del alumno nunca llega a GitHub (solo su *hash*), y el registro público de hashes no sirve para gastar claves ajenas.

## Qué tenés que hacer vos (una sola vez, ~15 minutos)

> Mientras no hagas esto, la app sigue funcionando como hasta ahora (con la clave dentro del APK). Nada se rompe.

### 1. Cuenta gratuita de Cloudflare
Entrá a <https://dash.cloudflare.com/sign-up>, creá la cuenta (plan **Free**, alcanza de sobra: 100.000 pedidos por día)
y confirmá el correo. No pide tarjeta.

### 2. Crear el Worker
**Camino recomendado (sin pegar código; sirve también desde el celular):** que Cloudflare lo tome del repositorio.
1. En el panel: **Workers & Pages** → **Create application** → **Get started** junto a **Import a repository**.
2. Elegí **GitHub**, autorizá la app de Cloudflare solo sobre el repositorio `yapurnet.github.io` y seleccionalo.
3. Nombre del proyecto: **`favl`** (tiene que ser igual al `name` de `wrangler.jsonc`, si no la compilación falla).
   **Root directory:** `/favl-app/worker`. Dejá el resto como viene (comando de despliegue `npx wrangler deploy`) → **Save and Deploy**.
4. La primera vez te pide elegir un subdominio `workers.dev`: elegí el que quieras. Anotá la dirección: `https://favl.TU-SUBDOMINIO.workers.dev`.
Ventaja: cuando se cambie `favl-worker.js` en el repositorio, Cloudflare lo publica solo (los secretos se conservan).

**Camino alternativo (pegando el código a mano):** *Workers & Pages* → *Create* → *Create Worker* → nombre `favl` → *Deploy* →
*Edit code* → borrar todo y pegar el contenido de [`favl-worker.js`](favl-worker.js) → *Deploy*.

### 3. Crear una clave de GitHub NUEVA para el Worker
(No reutilices la que está dentro de los APK anteriores: esa ya hay que dar por conocida.)

GitHub → tu foto → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** →
**Generate new token**:
- Nombre: `FAVL Worker`
- Expiration: la que prefieras (si elegís una fecha, anotala: cuando venza hay que renovarla; con *No expiration* no vence)
- Repository access: **Only select repositories** → `yapurnet.github.io`
- Permissions → **Issues: Read and write**
- **Generate token** y copiá el texto `github_pat_…` (se muestra una sola vez).

### 4. Cargar los secretos en el Worker
Cloudflare → tu Worker `favl` → **Settings** → **Variables and Secrets** → **Add**. Siempre con tipo **Secret**:

| Nombre | Valor |
|---|---|
| `GITHUB_TOKEN` | el `github_pat_…` del paso 3 |
| `CLAVES_PUBLICAR` | la **clave de publicación** (ver abajo). Si querés una por instructor, separalas con coma o una por línea |

**Clave de publicación:** inventá una larga (de 16 a 100 caracteres, solo letras, números, `-` y `_`).
Una forma rápida: en el navegador apretá F12 → pestaña *Consola* → pegá `crypto.randomUUID().replaceAll('-','')` → Enter → copiá el resultado (sin comillas).
Guardala en tu gestor de contraseñas. Es la que les vas a pasar a los instructores.

Después de guardar los secretos, **Deploy** de nuevo (Cloudflare lo pide).

> No pegues la clave de GitHub ni la de publicación en el chat con Claude ni en ningún archivo del repositorio.

### 5. Comprobar
Abrí `https://favl.TU-SUBDOMINIO.workers.dev` en el navegador: tiene que decir **«✔ Funcionando»**.
Tocá **«Comprobar la conexión con GitHub»**: tiene que decir **«OK: GitHub aceptó la clave…»**
(si dice que la rechazó, la clave del paso 3 está mal copiada o sin el permiso de Issues).

### 6. Decirle a la app dónde está el Worker
Editá el archivo [`worker-url.txt`](worker-url.txt) (en GitHub: lápiz → pegar la dirección en una línea nueva → *Commit*) o
decile la dirección a Claude. GitHub compila solo una versión nueva de la app **sin ninguna clave de GitHub adentro**.

(Alternativa: *Settings* → *Secrets and variables* → *Actions* → pestaña **Variables** → `FAVL_WORKER_URL`.)

### 7. Limpiar lo viejo
- Borrá el secreto `FAVL_ISSUES_TOKEN` (*Settings* → *Secrets and variables* → *Actions*). Con Worker se ignora, pero así no vuelve por accidente.
- **Revocá** la clave de GitHub vieja (`FAVL app 2026`): GitHub → *Fine-grained tokens* → *Delete*. Hacelo cuando ya hayas
  instalado la versión nueva en los celulares de los instructores (los APK anteriores dependen de esa clave).
  Si se revoca antes, esos celulares no podrán publicar, pero a los alumnos no les pasa nada: la app deja entrar con el código del día.

### 8. En los celulares
Instalar el APK nuevo (encima del anterior). Cada instructor que vaya a **publicar** (agregar instructores o crear claves de examen)
escribe **una vez** la clave de publicación en *Modo instructor → Instructores → Publicación automática*.
Los alumnos no necesitan nada.

## Mantenimiento

- **Cambiar la clave de publicación** (por ejemplo si un instructor deja de colaborar): editá `CLAVES_PUBLICAR` en Cloudflare y avisale la nueva a los demás.
  Los celulares con la clave vieja avisan «la clave de publicación no es correcta» y no pierden los cambios pendientes.
- **Si vence o se revoca la clave de GitHub del Worker:** abrí `…workers.dev/?comprobar=1` para confirmarlo, creá una nueva (paso 3) y reemplazá el secreto `GITHUB_TOKEN`.
  **No hay que recompilar la app.** Mientras tanto, los alumnos con clave personal reciben un aviso y pueden entrar con el código del día.
- **Emergencia** (el Worker o GitHub no andan y se exige la clave personal): en el repositorio editá `favl-claves.json` y poné `"exigir": false`.
  En 1 o 2 minutos todos pueden entrar con el código del día.
- **Si en algún lugar el celular de un alumno no llega a `workers.dev`** (algunas redes de escuelas o empresas lo bloquean), la app dice «Sin conexión con el servidor»: que pruebe con datos móviles, o apagá «Exigir clave personal» para esa jornada.
- **Actualizar el Worker** (si Claude cambia `favl-worker.js`): con el camino recomendado se publica solo; con el alternativo hay que pegar el código nuevo y *Deploy*. Los secretos se conservan.
- Las pruebas automáticas están en `worker.test.mjs` (`node --test favl-app/worker/worker.test.mjs`).

## Qué protege y qué no

- ✔ La clave de GitHub ya no se puede sacar del APK.
- ✔ Un alumno no puede crear instructores, crear/anular claves ni cambiar «Exigir».
- ✔ Una clave de alumno no se puede gastar a ciegas con el registro público (hace falta conocerla).
- ✔ Si Cloudflare o GitHub fallan, la app no deja a nadie afuera del examen.
- ✘ Quien conozca la clave de publicación puede hacer lo mismo que un instructor: guardala como una contraseña.
- ✘ El código del día y la clave de «Modo instructor» siguen siendo fáciles de deducir (son otra mejora pendiente); lo que cambia es que ya no alcanzan para publicar nada.
