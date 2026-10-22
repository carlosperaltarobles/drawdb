# drawDB colaborativo en tiempo real — Diseño

Fecha: 2026-10-22
Repos: frontend `drawdb` (fork, este repo) y backend `drawdb-server` (fork, `/home/carlos/Proyectos/drawdb-server`).

## 1. Intención

Un equipo de unas 30 personas necesita diseñar **el mismo esquema de base de datos al mismo tiempo**, al estilo de Figma. Las herramientas que probaron antes fallaban así:

- Había que recargar para ver los cambios de otros. Por eso se sobrescribía el trabajo ajeno o se creaban entidades duplicadas.
- Cuando otra persona hacía scroll o zoom en el lienzo, **la vista de los demás se movía con la suya**. Eso fue lo que más molestó.

El éxito es que el equipo trabaje sobre un diagrama real de unas 200 entidades: todos ven los cambios al instante y los cursores de los demás con su nombre, cada uno navega su propia vista con fluidez, y todo queda guardado en el servidor sin botón de guardar. El servicio es privado para el equipo, con login, y se despliega en el VPS de Hostinger del dueño mediante Dokploy.

## 2. Objetivos

1. **Tiempo real:** cada cambio al esquema (tablas, campos, relaciones, áreas, notas, enums, tipos, vistas, base de datos y SQL header) se propaga a todos los conectados al proyecto sin recargar.
2. **Presencia:** se ven los cursores de los demás con nombre y color, y la línea de "enlazando relación" que ya emite el editor.
3. **Vista independiente:** pan y zoom son de cada persona. Nunca se transmiten ni se guardan como estado compartido del proyecto.
4. **Guardado en servidor:** el estado del proyecto vive en Postgres. Al entrar se carga desde el servidor y se guarda solo.
5. **Cuentas:**
   - Registro propio, limitado a dominios de correo permitidos y con verificación obligatoria por correo.
   - Login, roles de administrador y miembros por proyecto, al estilo de Azimutt.
6. **Despliegue:**
   - Aplicaciones compose para Dokploy.
   - Un Postgres compartido y reutilizable por otros proyectos.
   - Todo se puede probar en local.
7. **Rendimiento:** con unas 200 entidades y muchas personas conectadas a la vez (sobre todo al inicio del proyecto), la navegación y la edición siguen fluidas.

## 3. Fuera de alcance (no-objetivos)

- Organizaciones o equipos múltiples como en Azimutt. Hay una sola "organización" implícita.
- Login con Google/GitHub/SSO.
- Una pantalla de historial de versiones para restaurar. Sí se guardan snapshots en la base de datos (ver §7.4), pero sin UI.
- Edición sin conexión con sincronización posterior.
- Convertir el formato de dbdesigner. Lo hará el usuario con otra herramienta, que generará el JSON de drawDB para importarlo.
- Bucket / almacenamiento de objetos. No hace falta: el diagrama es JSON y vive en Postgres.

## 4. Anti-objetivos (fracaso aunque "funcione")

- Que el pan/zoom de un usuario mueva la vista de otro.
- Que dos personas editando a la vez pierdan cambios en silencio, o que aparezcan entidades duplicadas porque alguien tenía un estado viejo.
- Que el registro revele qué dominio se acepta o si un correo ya tiene cuenta.
- Que se pueda entrar con un correo del dominio que no se ha verificado.
- Que el lienzo con 200 entidades se vuelva lento por el tráfico de cursores o de cambios.
- Que un usuario sin acceso a un proyecto pueda leerlo o recibir sus cambios por el socket.

## 5. Lo que ya existe (punto de partida)

**Frontend (`drawdb`):**
- `src/context/CollabContext.jsx` es un stub que expone `emitDelta`, `emitAwareness` e `isApplyingRemoteRef`. Todos los contextos de edición ya lo llaman: Diagram, Areas, Notes, Types, Enums y Views. Cada llamada emite un delta del tipo `{ target, action: create|update|delete, entityId, data }`. `Canvas.jsx` emite awareness para la línea de enlace.
- `isApplyingRemoteRef` existe justo para no reemitir cambios que llegan del servidor.
- `Workspace.jsx` carga desde IndexedDB (Dexie) y ya acepta `cloudLoad` y `forcedDiagramId`, que son puntos de extensión para cargar desde la nube.
- **Atención:** el diagrama guarda `pan` y `zoom` dentro de su estado (`setTransform({ pan: diagram.pan, zoom: diagram.zoom })`). En modo proyecto eso no debe venir del servidor ni ir hacia él (ver §7.3).
- El Dockerfile ya construye la app con nginx e inyecta configuración en tiempo de ejecución mediante `/config.js`.

**Backend (`drawdb-server`):** Express + TypeScript. Solo tiene `/email` (nodemailer con `MAIL_SERVICE=gmail`) y `/gists` (proxy a GitHub). No tiene base de datos, usuarios ni sockets.

**Local:** no hay un Postgres general. Hay uno detenido de `erp-multirubro-backend`, que no se toca. Hay un Mailpit corriendo (`policlinico_mailpit`, SMTP en `localhost:1026`, UI en `:8026`) que se puede reutilizar para probar correos.

## 6. Decisiones del dueño

- Sin bucket, salvo que fuera indispensable (no lo es).
- Postgres compartido: usar uno general y crearlo si no existe. Servirá también para otros proyectos. En Dokploy ya existe uno, y el despliegue debe usarlo.
- Todo como compose para Dokploy, y todo probable en local. Docker en local solo si es indispensable.
- Correo de envío: el buzón propio de Hostinger.
- **Login obligatorio.** El dueño es administrador y crea los esquemas. Los administradores pueden nombrar a otros administradores.
- **Registro propio** con pantalla de registro:
  - Una variable de entorno limita los dominios de correo permitidos.
  - Si el dominio no está permitido, se responde solo "No es posible registrarse con este correo", sin revelar qué dominio se espera.
  - Si el dominio está permitido, se envía un correo de verificación, y hasta que no se abre el enlace **no se puede entrar**.
- **Acceso a proyectos al estilo de Azimutt:**
  - Un usuario solo ve los proyectos de los que es miembro.
  - Los administradores invitan a los proyectos. El diseño debe quedar listo para crecer en roles e invitaciones.
- El diagrama existente (unas 200 entidades) se importará como JSON de drawDB con la opción de importar del editor.

## 7. Diseño

### 7.1 Arquitectura

```
Navegador ──HTTPS──► Traefik (Dokploy) ──► drawdb-web   (nginx, SPA)          ruta /
                                       └─► drawdb-api   (Express + Socket.IO) rutas /api y /socket.io
                                                └──► Postgres compartido (base `drawdb`, usuario `drawdb`)
                                                └──► SMTP Hostinger
```

**Mi decisión:** un solo dominio para todo, con Traefik enviando `/api` y `/socket.io` al backend. Al ser el mismo origen, la sesión va en una cookie `httpOnly; Secure; SameSite=Lax`, sin CORS ni tokens en `localStorage`. En local, Vite hace proxy de `/api` y `/socket.io` hacia `localhost:5000` para replicar lo mismo.

**Mi decisión:** el tiempo real usa **Socket.IO** dentro del mismo proceso Express. Encaja con los deltas que el editor ya emite y soporta salas, reconexión y Traefik sin configuración extra. Se descartó Yjs/CRDT porque obligaría a reescribir el modelo de estado del editor, cuando ya existen ganchos basados en operaciones.

### 7.2 Modelo de sincronización

- **El servidor es la autoridad.** Por cada proyecto abierto, mantiene en memoria el documento (el JSON del diagrama) y un número de versión.
- **Entrada:** al unirse a la sala `project:<id>`, el cliente recibe `{ doc, version }` completo y aplica el estado con `isApplyingRemoteRef = true`.
- **Edición:**
  1. El cliente aplica su cambio localmente de inmediato (optimista) y envía el delta (`emitDelta`).
  2. El servidor valida permiso (editor o admin) y forma del delta, lo aplica al documento, incrementa `version` y lo retransmite a la sala con el id del autor.
  3. El autor recibe la confirmación. Los demás aplican el delta.
- **Conflictos:** gana el último en llegar, a nivel de entidad o campo. Dos personas que editan cosas distintas, aunque sea dentro de la misma tabla, nunca deben perder cambios (anti-objetivo de §4).
  - Un `update` o `delete` sobre una entidad que ya no existe se descarta en el servidor y se le notifica al autor para que su vista se corrija.
- **Los ganchos actuales no bastan y hay que hacerlos granulares** (revisado en el código):
  - Añadir, borrar o reordenar campos y editar índices pasan hoy por `updateTable(tid, { fields: [...] })`, que envía el array completo. `EnumsContext` y `TypesContext` emiten la lista entera desde un `useEffect`. Si dos personas añaden un campo a la misma tabla a la vez, una pierde el suyo.
  - **Decisión:** añadir operaciones de sub-entidad en el cliente y en el servidor:
    - campo: añadir, editar, borrar, mover
    - índice: añadir, editar, borrar
    - enum y tipo: crear, editar, borrar, cada uno por id
  - El servidor fusiona a ese nivel. Los arrays completos solo se aceptan en el `replace` de importación.
  - **Deshacer y rehacer** deben emitir la operación inversa granular (por ejemplo, "borrar el campo X" en vez de restaurar el array guardado), para no pisar cambios ajenos.
- **Desfase:** si un cliente detecta un salto de versión o se reconecta, pide el documento completo (resync) en vez de intentar repararlo.
- **Ids:** las entidades nuevas usan los ids que ya genera el editor (nanoid/uuid), así que no hay colisiones entre clientes.
- **Duplicados por nombre:** al ser tiempo real, una tabla creada por otro aparece en todos los lienzos en el acto, y eso ataca la causa original. Además, el panel de "Issues" de drawDB ya marca nombres de tabla duplicados.
- **Mover tablas:** la posición `x,y` de una tabla, nota o área **es parte del esquema y sí se comparte**. Mientras se arrastra, los deltas de posición se limitan a unos 20 por segundo; al soltar se envía la posición final.
- **Deshacer/rehacer:** cada persona deshace solo sus propias acciones. Deshacer genera deltas normales hacia el servidor.
- **Importar:** importar JSON dentro de un proyecto reemplaza el documento completo. Se envía como un único delta `{ target: "document", action: "replace" }`, que el servidor aplica y retransmite. Solo pueden hacerlo editores o administradores, y se pide confirmación en la UI porque reemplaza el trabajo de todos.

### 7.3 Presencia y vistas independientes

- `emitAwareness` envía `{ cursor: {x, y}, linking, selectedElement? }` en **coordenadas del diagrama**, nunca de pantalla. Cada cliente las convierte con su propio pan y zoom para dibujar los cursores ajenos.
- Se limita a unos 20 mensajes por segundo por cliente. El servidor solo los reenvía (volátiles, sin guardarlos).
- Cada usuario tiene un color estable, derivado de su id, y se muestra su nombre.
- Se muestra la lista de quién está conectado al proyecto, con avatares o iniciales en la cabecera.
- **Pan y zoom** son solo locales. En modo proyecto, la carga no aplica `diagram.pan/zoom` del servidor y el guardado no los envía. **Mi decisión:** recordar el último pan/zoom de cada usuario por proyecto en `localStorage`.

### 7.4 Persistencia

- El documento en memoria se escribe en `projects.diagram` (JSONB) con *debounce* (unos 2 s tras el último cambio) y siempre cuando la sala queda vacía o el proceso se apaga.
- **Mi decisión:** guardar un snapshot en `project_snapshots` como máximo cada 10 minutos de actividad, y conservar los últimos 200 por proyecto. Es una red de seguridad recuperable a mano, sin UI.
- Una sola instancia del backend. Escalar a varias (adaptador Redis de Socket.IO) queda fuera de alcance, pero el código no debe impedirlo de forma gratuita.

### 7.5 Cuentas y seguridad

**Tablas** (Postgres, base `drawdb`):

| Tabla | Columnas |
|---|---|
| `users` | `id`, `email` (único, en minúsculas), `name`, `password_hash`, `is_admin`, `is_superadmin`, `email_verified_at`, `created_at` |
| `sessions` | `id` (token aleatorio, guardado como hash), `user_id`, `expires_at`, `created_at` |
| `email_tokens` | `id`, `user_id`, `type` (`verify`\|`reset`), `token_hash`, `expires_at`, `used_at` |
| `projects` | `id`, `name`, `diagram` (JSONB), `version`, `created_by`, `created_at`, `updated_at` |
| `project_members` | `project_id`, `user_id`, `role` (`editor`\|`viewer`), PK compuesta |
| `project_invitations` | `id`, `project_id`, `email`, `role`, `token_hash`, `invited_by`, `expires_at`, `accepted_at` |
| `project_snapshots` | `id`, `project_id`, `diagram`, `version`, `created_at` |

**Registro:**
- `ALLOWED_EMAIL_DOMAINS` es una lista separada por comas. Se compara el dominio exacto después de la `@`, en minúsculas: `evil-corre-dominio.com` no pasa por terminar parecido.
- Si el dominio no está permitido, se responde "No es posible registrarse con este correo".
- Si el dominio está permitido, la respuesta es siempre la misma ("Te enviamos un correo para verificar tu cuenta"), **exista o no el correo**. Si el correo ya existe y está verificado, no se crea nada (opcionalmente se envía un correo de aviso). Si existe sin verificar, se reenvía la verificación.
- El enlace de verificación es de un solo uso, caduca a las 24 h y en la base de datos se guarda solo el hash del token. Se puede pedir un reenvío.
- **Login:** se rechaza si `email_verified_at` es nulo, con el mismo mensaje genérico de "correo o contraseña incorrectos".
- **Contraseñas:** argon2id o bcrypt, con un mínimo de 10 caracteres.
- **Olvidé mi contraseña** (mi decisión): mismo patrón de token por correo, con caducidad de 1 h y respuesta genérica.
- **Límites de intentos** (mi decisión) en registro, login, reenvío y reset, por IP y por correo.
- **Superadministrador inicial (decisión del dueño):** el `.env` define `ADMIN_EMAIL` y `ADMIN_PASSWORD`. Al arrancar, si ese usuario no existe, el backend lo crea ya verificado, con `is_admin = true` y `is_superadmin = true`. Con él se entra al sistema desde el primer momento; no pasa por el registro ni por el filtro de dominio.
  - Mis decisiones:
    - Si el usuario ya existe, el arranque **no** cambia su contraseña. Se cambia desde la app o con "olvidé mi contraseña".
    - Si faltan las variables y no hay ningún administrador, el backend lo registra en el log como advertencia.
    - Nadie puede quitarle el rol al superadministrador ni borrarlo desde la app.
    - Se exige la misma longitud mínima de contraseña.
  - `users` agrega la columna `is_superadmin`.
- **Administradores:**
  - Ven todos los proyectos y crean, renombran y borran proyectos.
  - Gestionan los miembros de cada proyecto.
  - Desde una pantalla de usuarios pueden nombrar o quitar administradores. No se puede quitar el último administrador.
- **Miembros:** los `editor` editan. Los `viewer` ven en vivo con cursores, pero el servidor rechaza sus deltas y la UI queda en solo lectura (el editor ya tiene `layout.readOnly`).
- **Invitar a un proyecto:** el administrador escribe un correo y un rol.
  - Si el usuario existe, se le agrega directamente y se le avisa por correo.
  - Si no existe, se crea una `project_invitation` y se envía un correo con enlace al registro. Al verificar la cuenta con ese correo, las invitaciones pendientes se convierten en membresías.
  - El filtro de dominio sigue aplicando.
- **Socket:** el handshake usa la cookie de sesión. Unirse a una sala exige ser miembro o administrador, y se revalida en cada delta.
- **Correo:** nodemailer por SMTP. Variables: `MAIL_HOST` (por ejemplo `smtp.hostinger.com`), `MAIL_PORT` (465), `MAIL_SECURE`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM`. Los enlaces se construyen con `APP_URL`.

### 7.6 Frontend: pantallas y rutas

| Ruta | Pantalla |
|---|---|
| `/login` | Login |
| `/register` | Registro |
| `/verify?token=…` | Verificación de correo |
| `/forgot`, `/reset?token=…` | Recuperar contraseña |
| `/projects` | Lista de proyectos del usuario. Los administradores ven el botón "Nuevo proyecto". |
| `/projects/:id` | El editor de drawDB en modo proyecto |
| `/projects/:id/members` | Miembros, invitaciones y roles (puede ser un modal dentro del editor) |
| `/admin/users` | Solo administradores |

- **Todo detrás de login.** `/` redirige a `/projects` o a `/login`.
- **Rutas antiguas** (mi decisión): `/editor`, `/editor/diagrams/:id`, `/editor/templates/:id` y `/templates` (editor local con Dexie) siguen funcionando igual, pero solo con sesión iniciada. La landing pública desaparece de la navegación.
- **Título del diagrama = `projects.name`** (mi decisión). Solo los administradores pueden renombrar, así que en modo proyecto el modal "Rename" solo aparece para ellos. El cambio se retransmite a la sala.
- **Modo proyecto del editor:**
  - Carga desde el servidor (vía `cloudLoad`/`forcedDiagramId` o equivalente), no desde Dexie.
  - El indicador de guardado refleja la conexión con el servidor (conectado / reconectando / sin conexión).
  - Se ocultan las opciones que no aplican: "compartir por gist", "guardar como", "abrir diagrama local", versiones de gist.
  - Se mantiene la exportación (SQL, imagen, JSON, etc.).
- **Sin conexión:** el editor queda en solo lectura con un aviso hasta reconectar, y al reconectar hace un resync completo. Así no se acumulan cambios que puedan pisar a otros.
- Los textos nuevos en español e inglés, usando i18n como el resto.

### 7.7 Rendimiento (unas 200 entidades)

- El documento inicial se envía una vez. Después solo viajan deltas pequeños.
- Los cursores y los deltas de arrastre se limitan y se agrupan.
- Los cursores ajenos se dibujan en una capa propia que **no** provoca re-render de las tablas.
- **El criterio es la medición,** no una arquitectura concreta (mi decisión): 200 tablas, 10 o más clientes simulados moviendo cursores y editando, y el lienzo del observador sin caídas notables al hacer pan y zoom. Si la medición falla, se optimiza donde muestre el perfil (memoización, selectores). No se exige refactorizar el estado del editor de antemano.

### 7.8 Despliegue y local

**Postgres compartido:**
- Un compose propio, independiente de drawDB, con `postgres:16-alpine`, volumen persistente, healthcheck y red externa compartida.
- Un script o README explica cómo crear una base y un usuario por proyecto (`CREATE ROLE drawdb …; CREATE DATABASE drawdb OWNER drawdb;`).
- En Dokploy ya existe uno, y el despliegue usa ese con `DATABASE_URL`.
- En local hay que crearlo: es el único Docker indispensable, porque no hay Postgres instalado.

**Backend (`drawdb-server`):**
- Un `Dockerfile` de producción (build TypeScript y `node dist/index.js`).
- Un compose para Dokploy, sin `ports` publicados y con labels o dominio gestionados por Dokploy en `/api` y `/socket.io`.
- Las migraciones SQL se ejecutan al arrancar.
- `.env.sample` actualizado.

**Frontend (`drawdb`):**
- Se reutiliza el Dockerfile con nginx.
- Un compose para Dokploy con el dominio en `/`.
- Debe funcionar sin variables extra, porque las llamadas son relativas al mismo origen.

**Local, sin Docker salvo Postgres:**
- Backend con `npm run dev` y frontend con `npm run dev` (Vite con proxy).
- Para el correo se usa el Mailpit existente o el SMTP real de Hostinger, según el `.env`.

**Variables del backend:**
`DATABASE_URL`, `APP_URL`, `ALLOWED_EMAIL_DOMAINS`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SESSION_SECRET` (si aplica), `MAIL_*`, `PORT`, `NODE_ENV`.

**Endpoints existentes** (mi decisión):
- `/email` (reporte de bugs) y `/gists` pasan a exigir sesión, para que nadie use el buzón de Hostinger desde fuera.
- `/email` usa el mismo transporte SMTP `MAIL_*`. `MAIL_SERVICE=gmail` se elimina.
- `GITHUB_TOKEN` pasa a ser opcional: sin él, `/gists` responde que no está disponible.

## 8. Lo que queda a criterio del constructor

- **Librerías:** acceso a Postgres y migraciones (`pg` con SQL plano, Kysely, Drizzle, etc.), validación de payloads, rate limiting y hash de contraseñas, siempre que se cumpla §7.5.
- **Mecánica del modo proyecto en el editor:** reutilizar `cloudLoad`/`forcedDiagramId` o crear un proveedor nuevo, siempre que el modo local no se rompa para quien siga usándolo.
- **Formato exacto de los mensajes de Socket.IO,** y cómo aplicar deltas remotos en cada contexto, reutilizando `isApplyingRemoteRef`.
- **Diseño visual** de las pantallas nuevas, usando Semi UI y el estilo existente del proyecto.
- **Pruebas:** como mínimo, tests del backend para registro, filtro de dominio, verificación, permisos de socket y aplicación de deltas. También una prueba manual con dos o más navegadores y el diagrama de 200 entidades.
- **Dónde vive el compose del Postgres compartido** (mi sugerencia: un directorio o repo propio, por ejemplo `infra/shared-postgres/`, porque sirve a otros proyectos).
