# Colaboración en tiempo real para drawDB — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir el fork de drawDB en una herramienta privada del equipo, con login, proyectos con miembros y edición en tiempo real guardada en Postgres. Se despliega en Dokploy.

**Architecture:**
- El backend Express (`drawdb-server`) incorpora Postgres (`pg` + migraciones SQL), autenticación por cookie de sesión, una API REST de proyectos y miembros, y Socket.IO.
- Socket.IO mantiene en memoria el documento de cada proyecto abierto. Aplica operaciones granulares en orden y las guarda con debounce.
- El frontend no depende de los ganchos `emitDelta` existentes. Un `CollabBridge` compara el estado del editor con la última copia enviada (`diffDoc`) y genera operaciones granulares. Así cubre todo lo que hoy cambia el estado: UI, deshacer/rehacer e importación. Las operaciones remotas se aplican sobre el estado confirmado, rebasando las pendientes.

**Tech Stack:**
- Backend: Node 20, Express 4, TypeScript (commonjs), `pg`, `socket.io`, `@node-rs/argon2`, `zod`, `express-rate-limit`, `cookie-parser`, `nodemailer`. Tests con `vitest` y `supertest`.
- Frontend: React 18, Vite, Semi UI, `socket.io-client`, `vitest`.
- Infraestructura: Postgres 16 (compose), Dokploy (Traefik).

**Spec:** `docs/superpowers/specs/2026-10-22-colaboracion-tiempo-real-design.md` (repo `drawdb`)

**Repos y rutas:**
- FE = `/home/carlos/Proyectos/drawdb`, rama `feat/colaboracion-tiempo-real`
- BE = `/home/carlos/Proyectos/drawdb-server`, crear la rama `feat/colaboracion-tiempo-real`
- PG = `/home/carlos/Proyectos/shared-postgres` (directorio nuevo con su propio `git init`)

## Global Constraints

- Variables del backend: `DATABASE_URL`, `APP_URL`, `ALLOWED_EMAIL_DOMAINS`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_SECURE`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM`, `PORT`, `NODE_ENV`, `GITHUB_TOKEN` (opcional). No hace falta `SESSION_SECRET`: las sesiones son tokens aleatorios que se guardan como hash. Se eliminan `MAIL_SERVICE` y `CLIENT_URLS`.
- Todo el backend cuelga de `/api`, más `/socket.io`. El frontend llama con rutas relativas al mismo origen. En local, Vite hace proxy.
- Mensajes de error exactos (códigos JSON → textos de la UI):
  - `registration_not_allowed` → "No es posible registrarse con este correo"
  - `invalid_credentials` → "Correo o contraseña incorrectos"
  - `invalid_token` → "El enlace no es válido o ha caducado"
  - `too_many_requests` → "Demasiados intentos, espera unos minutos"
- Comparación de dominio: se toma la parte después de la **última** `@`, en minúsculas y sin espacios, y debe ser **igual** a un elemento de `ALLOWED_EMAIL_DOMAINS` (separado por comas). Si la lista está vacía, nadie se registra. El `ADMIN_EMAIL` queda exento.
- Caducidades:
  - verificación: 24 h
  - reset de contraseña: 1 h
  - invitación a proyecto: 14 días
  - sesión: 30 días
- Contraseña de al menos 10 caracteres, hash con argon2id.
- Cookie de sesión: `drawdb_session`, `httpOnly`, `SameSite=Lax`, `path=/`, y `Secure` cuando `APP_URL` empieza por `https://`.
- Límites de intentos:
  - registro, reenvío y "olvidé": 5 por cada 15 min por IP
  - login: 10 por cada 15 min por IP y 10 por cada 15 min por correo
- Tiempo real:
  - las operaciones salen del cliente cada 50 ms como máximo
  - awareness: 20 por segundo como máximo
  - guardado con debounce de 2000 ms
  - snapshot como máximo cada 10 min, conservando 200 por proyecto
  - `maxHttpBufferSize` de 10 MB
  - lotes de hasta 5000 operaciones
- Pan y zoom nunca viajan al servidor. Se guardan en `localStorage` con la clave `drawdb:view:<projectId>`.
- Textos nuevos en `src/i18n/locales/es.js` y `en.js`.
- Commits que terminen con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Dos personas agregan una columna a la misma tabla a la vez:** las dos columnas sobreviven en ambos clientes y en el servidor. → Task 7 (`ops`), Task 12 (`CollabClient` rebase).
2. **Un cliente pierde la conexión con cambios sin confirmar:** al reconectar, queda igual al servidor. Nunca reenvía un estado viejo que pise a otros. → Task 12 (`resetFromSnapshot` descarta pendientes) y Task 15 (solo lectura sin conexión).
3. **Un administrador quita a un miembro mientras está dentro del proyecto:** deja de recibir y de poder enviar cambios de inmediato. → Task 8 (`onMembershipChanged`).
4. **Un diagrama antiguo con ids numéricos** (notas y áreas `0,1,2`) se importa y luego se borra una nota: no se renumeran ids ni se borra la nota equivocada en otros clientes. → Task 11.
5. **Correos con trampa:** `x@corre-dominio.com.evil.io`, `X@CORRE-DOMINIO.COM `, `a@sub.corre-dominio.com` y `a@b@corre-dominio.com` se clasifican bien. → Task 4 (`isAllowedDomain`).

---

## Fase A — Infraestructura y backend

### Task 1: Postgres compartido (local y Dokploy)

**Files (PG):**
- Create: `compose.yaml`, `.env.example`, `create-db.sh`, `README.md`, `.gitignore` (`.env`)

**Interfaces:**
- Produces:
  - contenedor `shared-postgres` en `127.0.0.1:5432` y red Docker `shared-postgres`
  - `./create-db.sh <db> <user> <password>`: crea el rol y la base de forma idempotente
  - bases `drawdb` y `drawdb_test` con dueño `drawdb`

- [ ] **Step 1:** `compose.yaml`
  - servicio `postgres` con `image: postgres:16-alpine` y `container_name: shared-postgres`
  - `restart: unless-stopped`
  - `POSTGRES_USER=postgres` y `POSTGRES_PASSWORD=${POSTGRES_PASSWORD}`
  - volumen `shared-postgres-data:/var/lib/postgresql/data`
  - `ports: ["127.0.0.1:5432:5432"]`
  - healthcheck `pg_isready -U postgres`
  - red con `name: shared-postgres`
- [ ] **Step 2:** `create-db.sh`: usa `docker exec -i shared-postgres psql -U postgres` y crea el rol si no existe (`DO $$ … $$`) y la base si no existe (`SELECT 'CREATE DATABASE …' WHERE NOT EXISTS … \gexec`).
- [ ] **Step 3:** El README explica:
  - el uso local
  - cómo lo usa otro proyecto: una base y un usuario propios, conectados por `localhost:5432` o por la red `shared-postgres`
  - que en Dokploy **no** se despliega: se usa el Postgres que ya existe y se ejecuta allí el mismo SQL de `create-db.sh` desde su terminal
- [ ] **Step 4: Verificar**
  - Run: `cp .env.example .env && docker compose up -d && ./create-db.sh drawdb drawdb drawdb_local && ./create-db.sh drawdb_test drawdb drawdb_local && docker exec shared-postgres psql -U drawdb -d drawdb_test -c 'select 1'`
  - Expected: devuelve `1`; ejecutar el script dos veces no da error.
- [ ] **Step 5:** `git init && git add . && git commit -m "feat: postgres compartido"`

### Task 2: Base del backend (config, DB, migraciones, app factory, tests)

**Files (BE):**
- Modify:
  - `package.json`: deps `pg socket.io @node-rs/argon2 zod express-rate-limit cookie-parser lodash`
  - devDeps `vitest supertest @types/pg @types/supertest @types/cookie-parser @types/lodash socket.io-client`
  - scripts `"test": "vitest run --no-file-parallelism"` y `"migrate": "ts-node src/db/migrate-cli.ts"`
- Modify: `src/config/index.ts` (todas las variables de Global Constraints), `src/app.ts`, `src/index.ts`, `.env.sample`
- Create:
  - `src/db/pool.ts`, `src/db/migrate.ts`, `src/db/migrate-cli.ts`
  - `migrations/001_init.sql`
  - `src/server.ts`
  - `vitest.config.ts`, `tests/helpers/db.ts`, `tests/helpers/app.ts`, `tests/health.test.ts`

**Interfaces:**
- Produces:
  - `config`: `{ dev, appUrl, cookieSecure, allowedDomains: string[], admin: {email,password}, mail: {host,port,secure,username,password,from}, databaseUrl, github?: string, rateLimit: {enabled: boolean} }`
  - `getPool(): Pool`
  - `migrate(pool: Pool): Promise<void>`: aplica `migrations/*.sql` en orden y los registra en `schema_migrations(name, applied_at)`
  - `createApp(deps: AppDeps): Express`, con `AppDeps = { pool: Pool; mailer: Mailer; rooms?: RoomManager }`
  - todas las rutas montadas bajo `/api`; `GET /api/health` responde `{ok:true}`
  - `createServer(deps): { http: http.Server; io: Server }` (en `src/server.ts`)
  - `tests/helpers/db.ts`: `testPool()` (usa `DATABASE_URL_TEST` o, por defecto, `postgres://drawdb:drawdb_local@localhost:5432/drawdb_test`) y `resetDb()` (migra y hace `TRUNCATE` de todas las tablas excepto `schema_migrations`)
  - `tests/helpers/app.ts`: `makeApp()` → `{ app, pool, mailer: MemoryMailer }`
- Esquema en `001_init.sql`: tablas exactas de la spec §7.5 (incluye `is_superadmin`).
  - Ids `uuid` con `gen_random_uuid()` y `timestamptz`
  - `projects.diagram jsonb not null`
  - `projects.version bigint not null default 0`
  - FKs con `on delete cascade`
  - índice único sobre `lower(email)`
  - `project_members` con PK `(project_id,user_id)`
  - `check (role in ('editor','viewer'))` y `check (type in ('verify','reset'))`

- [ ] **Step 1: Test que falla** (`tests/health.test.ts`): `GET /api/health` → 200 `{ok:true}`. Tras `resetDb()`, existe la tabla `users` (`select to_regclass('users')` no es null).
- [ ] **Step 2:** Run `npm test` → FAIL (no existe `createApp`)
- [ ] **Step 3: Implementar**
  - Eliminar `cors`: el servicio es del mismo origen.
  - `app.set('trust proxy', 1)`
  - `express.json({limit:'1mb'})` y `cookieParser()`
  - `index.ts`: `migrate` → `ensureSuperadmin` (Task 4; por ahora un stub) → `listen`
  - En `SIGTERM`/`SIGINT`: `rooms.flushAll()` y luego `process.exit(0)`
- [ ] **Step 4:** Run `npm test` → PASS. Run `npm run build` → sin errores.
- [ ] **Step 5:** Commit `feat: base de datos, migraciones y app factory`

### Task 3: Correo SMTP y plantillas

**Files (BE):**
- Create: `src/mail/mailer.ts`, `src/mail/templates.ts`, `tests/mail.test.ts`
- Delete: `src/utils/send-email.ts` (`email-controller` pasa a usar `Mailer`)

**Interfaces:**
- Produces:
  - `interface Mailer { send(m: {to: string; subject: string; html: string; text: string}): Promise<void> }`
  - `createSmtpMailer(cfg: typeof config.mail): Mailer`: nodemailer con `host/port/secure/auth`
  - `class MemoryMailer implements Mailer { sent: Msg[] }`
  - `templates`: `verifyEmail(link,name)`, `resetPassword(link)`, `alreadyRegistered(loginLink,forgotLink)`, `projectInvite(link,projectName,inviter)`, `addedToProject(link,projectName)`. Cada uno devuelve `{subject,html,text}` en español.
  - Los enlaces son `${APP_URL}/verify?token=…`, `/reset?token=…`, `/register?email=…`, `/projects/<id>`.

- [ ] **Step 1: Test que falla:** `templates.verifyEmail('http://x/verify?token=abc','Ana')` contiene el link en `html` y en `text`, y el `subject` es `"Verifica tu correo — drawDB"`. `MemoryMailer.send` lo agrega a `sent`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implementar, y adaptar `email-controller` para que use `deps.mailer` y envíe a `config.mail.username`.
- [ ] **Step 4:** Run → PASS. **Step 5:** Commit `feat: correo SMTP y plantillas`

### Task 4: Autenticación (registro, verificación, login, sesiones, reset, superadmin)

**Files (BE):**
- Create:
  - `src/auth/domain.ts`, `src/auth/tokens.ts`, `src/auth/passwords.ts`
  - `src/auth/sessions.ts`, `src/auth/middleware.ts`, `src/auth/routes.ts`
  - `src/auth/bootstrap.ts`, `src/auth/rate-limit.ts`
- Test: `tests/auth/domain.test.ts`, `tests/auth/register.test.ts`, `tests/auth/login.test.ts`, `tests/auth/reset.test.ts`, `tests/auth/bootstrap.test.ts`

**Interfaces:**
- Produces:
  - `isAllowedDomain(email: string, allowed: string[]): boolean`
  - `newToken(): { token: string; hash: string }`: 32 bytes en base64url, hash sha256 en hex
  - `hashToken(t)`
  - `hashPassword`, `verifyPassword`
  - `createSession(pool,userId): Promise<string>`, `getSessionUser(pool,token): Promise<PublicUser|null>`, `destroySession(pool,token)`
  - `PublicUser = { id, email, name, isAdmin, isSuperadmin }`
  - middlewares: `requireAuth` (pone `req.user`; si no hay sesión, 401 `{error:'unauthorized'}`) y `requireAdmin` (403 `{error:'forbidden'}`)
  - `ensureSuperadmin(pool, config.admin): Promise<void>`
  - `acceptPendingInvitations(pool, userId, email)`: la usa `verify`; la crea Task 5, aquí puede quedar como stub que exporta Task 5
  - Rutas `/api/auth`:

    | Método y ruta | Cuerpo | Respuesta |
    |---|---|---|
    | `POST /register` | `{email,name,password}` | 202 `{status:'verification_sent'}` \| 400 `{error:'registration_not_allowed'}` \| 400 `{error:'invalid_input'}` |
    | `POST /verify` | `{token}` | 200 `{user}` y fija la cookie \| 400 `invalid_token` |
    | `POST /resend` | `{email}` | 202 siempre |
    | `POST /login` | `{email,password}` | 200 `{user}` y cookie \| 401 `invalid_credentials` |
    | `POST /logout` | — | 204 |
    | `GET /me` | — | 200 `{user}` \| 401 |
    | `POST /forgot` | `{email}` | 202 siempre |
    | `POST /reset` | `{token,password}` | 204 \| 400 `invalid_token` |
    | `POST /password` | `{currentPassword,newPassword}` | 204 \| 401 `invalid_credentials` (requiere sesión) |

- [ ] **Step 1: Tests que fallan.** Cada viñeta es un test:
  - `domain.test.ts`: `isAllowedDomain` con `['corre-dominio.com']` devuelve `true` para `a@corre-dominio.com` y para ` A@CORRE-DOMINIO.COM `, y `false` para `a@evil-corre-dominio.com`, `a@corre-dominio.com.evil.io`, `a@sub.corre-dominio.com` y `nada`. Con `[]` → `false`. Con `['a.com','b.com']` → `x@b.com` es `true`.
  - `register.test.ts`:
    - Un dominio no permitido da 400 `registration_not_allowed`, no envía correo y el cuerpo **no** contiene el dominio permitido.
    - Un dominio permitido da 202, crea un usuario con `email_verified_at` nulo y envía 1 correo con un enlace `/verify?token=`.
    - Repetirlo con un correo ya verificado da el **mismo** 202 y el mismo cuerpo, no crea usuario y envía `alreadyRegistered`.
    - Un correo existente sin verificar da 202, invalida los tokens anteriores y reemplaza el hash de la contraseña.
    - Un token caducado (forzar `expires_at` al pasado) da 400 `invalid_token`.
    - `verify` correcto da 200, fija la cookie `drawdb_session` y pone `email_verified_at`. Reutilizar el token da 400.
  - `login.test.ts`:
    - Un usuario sin verificar da 401 `invalid_credentials`.
    - Una contraseña mala da 401 con el mismo cuerpo.
    - Login correcto → cookie → `GET /me` da 200 con el usuario.
    - `logout` → `GET /me` da 401.
    - Con `rateLimit.enabled=true`, el intento 11 de login con el mismo correo da 429 `too_many_requests`.
  - `reset.test.ts`:
    - `forgot` con un correo inexistente da 202 y 0 correos.
    - Con un correo existente da 202 y 1 correo.
    - `reset` con un token válido da 204: la contraseña nueva funciona y se borran las sesiones previas del usuario.
    - Un token de más de 1 h da 400.
  - `bootstrap.test.ts`:
    - Sin el usuario, `ensureSuperadmin` lo crea verificado, `is_admin` y `is_superadmin`.
    - Si ya existe con otra contraseña, la contraseña **no** cambia.
    - Sin variables y sin administradores, se llama a `console.warn`.
- [ ] **Step 2:** Run `npm test` → FAIL
- [ ] **Step 3: Implementar**
  - Validación de entrada con zod: email válido y como mucho 254 caracteres, `name` de 1 a 80, `password` de al menos 10.
  - Los tokens se marcan como `used_at` al usarse.
  - `rate-limit.ts` exporta `authLimiters(config)` con `express-rate-limit`. Si `rateLimit.enabled` es falso, devuelve un no-op; en `makeApp` es falso por defecto.
- [ ] **Step 4:** Run → PASS. **Step 5:** Commit `feat: autenticación con dominio permitido y verificación`

### Task 5: Proyectos, miembros, invitaciones y administración de usuarios

**Files (BE):**
- Create: `src/projects/repo.ts`, `src/projects/routes.ts`, `src/admin/routes.ts`, `src/projects/empty-doc.ts`
- Test: `tests/projects.test.ts`, `tests/members.test.ts`, `tests/admin.test.ts`

**Interfaces:**
- Consumes: `requireAuth`, `requireAdmin`, `isAllowedDomain`, `templates`, `Mailer`
- Produces:
  - `EMPTY_DOC = { database:'generic', sqlHeader:'', tables:[], relationships:[], notes:[], areas:[], views:[], enums:[], types:[] }`
  - `getRole(pool, projectId, user: PublicUser): Promise<'admin'|'editor'|'viewer'|null>`: un administrador obtiene `'admin'`
  - `acceptPendingInvitations(pool,userId,email): Promise<void>`
  - `rooms?.onMembershipChanged(projectId, userId)` y `rooms?.onProjectRenamed(projectId, name)` y `rooms?.onProjectDeleted(projectId)`: los consume Task 8, aquí se llaman si `deps.rooms` existe
  - Rutas `/api/projects` (todas con `requireAuth`):
    - `GET /` → `[{id,name,role,updatedAt}]`: los administradores ven todos con `role:'admin'`; los demás, solo los suyos
    - `POST /` (admin) `{name}` → 201 `{id,name}`
    - `GET /:id` → `{id,name,role}` \| 404 si no tiene acceso (no 403, para no revelar que existe)
    - `PATCH /:id` (admin) `{name}` → 200
    - `DELETE /:id` (admin) → 204
    - `GET /:id/members` (admin) → `{members:[{userId,email,name,role}], invitations:[{id,email,role,expiresAt}]}`
    - `POST /:id/members` (admin) `{email,role}` → 200 `{status:'added'}` si el usuario existe y está verificado (envía `addedToProject`). Si no, aplica `isAllowedDomain`: si falla, 400 `registration_not_allowed`; si pasa, 200 `{status:'invited'}`, crea o renueva la invitación y envía `projectInvite`.
    - `PATCH /:id/members/:userId` (admin) `{role}`
    - `DELETE /:id/members/:userId` (admin)
    - `DELETE /:id/invitations/:invId` (admin)
  - Rutas `/api/admin/users` (admin):
    - `GET /` → `[{id,email,name,isAdmin,isSuperadmin,verified,createdAt}]`
    - `PATCH /:id` `{isAdmin:boolean}` → 400 `{error:'cannot_change_superadmin'}` si el objetivo es superadmin, y 400 `{error:'last_admin'}` si se quitaría el último administrador

- [ ] **Step 1: Tests que fallan.** Cada viñeta es un test:
  - Un usuario normal ve `[]`.
  - Un administrador crea un proyecto y lo ve con `role:'admin'`.
  - Un usuario normal recibe 403 en `POST`.
  - Un no miembro recibe 404 en `GET /:id`.
  - Invitar a un correo de dominio no permitido da 400.
  - Invitar a un correo nuevo da `invited` y 1 correo. Luego ese correo se registra y verifica → `GET /api/projects` muestra el proyecto con el rol invitado.
  - Una invitación caducada **no** se convierte en membresía.
  - Un administrador intenta quitar el rol al superadmin → 400 `cannot_change_superadmin`.
  - `DELETE` del proyecto borra en cascada miembros y snapshots.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implementar. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: proyectos, miembros e invitaciones`

### Task 6: Proteger `/api/email` y `/api/gists`

**Files (BE):** Modify `src/app.ts`, `src/controllers/gist-controller.ts`, `src/constants/gist-constants.ts`. Test: `tests/legacy.test.ts`

- [ ] **Step 1: Test que falla:** `POST /api/email/send` sin sesión da 401. Sin `GITHUB_TOKEN`, `GET /api/gists/x` con sesión da 503 `{error:'gists_disabled'}`.
- [ ] **Step 2:** FAIL. **Step 3:** Montar ambos routers detrás de `requireAuth` y responder 503 si falta el token. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: endpoints heredados detrás de sesión`

### Task 7: Operaciones del documento (`ops`) — núcleo puro

El mismo algoritmo vive en el BE (TS) y en el FE (JS, Task 12), y los dos deben pasar el mismo archivo de fixtures. **Canónico:** `BE/src/collab/__fixtures__/ops.fixtures.json`; se copia tal cual a `FE/src/collab/__fixtures__/`. La cabecera de ambos archivos `ops` dice "mantener sincronizado con …".

**Files (BE):** Create `src/collab/ops.ts`, `src/collab/validate.ts`, `src/collab/__fixtures__/ops.fixtures.json`. Test: `tests/collab/ops.test.ts`

**Interfaces:**
- Produces:
  - `COLLS = ['tables','relationships','notes','areas','views','enums','types']`
  - `SUBS = { tables: ['fields','indices','uniqueConstraints'] }`
  - `type Op`:
    - `{t:'set', key:'database'|'sqlHeader', value}`
    - `{t:'add', coll, item, index}`
    - `{t:'del', coll, id}`
    - `{t:'patch', coll, id, patch, unset?: string[]}`
    - `{t:'order', coll, ids}`
    - `{t:'sadd', coll:'tables', id, sub, item, index}`
    - `{t:'sdel', coll:'tables', id, sub, sid}`
    - `{t:'spatch', coll:'tables', id, sub, sid, patch, unset?}`
    - `{t:'sorder', coll:'tables', id, sub, ids}`
  - `applyOp(doc, op): { doc; ok: boolean }`: puro, con estructura compartida (solo copia lo que cambia)
  - `applyOps(doc, ops): { doc; applied: Op[]; ok: boolean }`
  - `diffDoc(prev, next): Op[]`
  - `validateOps(x: unknown): Op[] | null`: zod, como mucho 5000 operaciones, `coll` y `sub` dentro de las listas, ids `string|number`
- **Reglas** (determinan los fixtures):
  - `add` con un id que ya existe → sin cambios y `ok:true` (idempotente). Se inserta en `min(index, len)`.
  - `del` de un id que no existe → sin cambios y `ok:true`.
  - `patch`/`spatch` sobre un id que no existe → `ok:false`.
  - `patch` hace merge superficial y luego borra las claves de `unset`. Nunca toca `id` ni las claves de `SUBS`.
  - `order`/`sorder`: reordena según `ids` los elementos conocidos. Los que no aparecen en `ids` se mantienen después, en su orden relativo. Los ids que no existen se ignoran.
  - `diffDoc` compara por referencia primero y con `lodash.isEqual` después. Por colección, en este orden: `del`, luego `add` (con su índice en `next`), luego `patch` (con las claves cuyo valor difiere; las claves que desaparecen van en `unset`; en `tables` las claves `SUBS` se diferencian como `s*`) y al final `order` solo si cambió el orden relativo de los ids comunes. `database`/`sqlHeader` → `set`.
  - Invariante: `applyOps(prev, diffDoc(prev,next)).doc` es igual (`isEqual`) a `next`.

- [ ] **Step 1: Fixtures y tests que fallan.** Los fixtures son `[{name, base, ops, expected, ok}]`. Deben incluir como mínimo:
  - (a) dos `sadd` de campos distintos en la misma tabla → los dos presentes
  - (b) `spatch` del nombre de un campo y `spatch` del tipo de otro → los dos se aplican
  - (c) `patch` sobre una tabla borrada → `ok:false`
  - (d) `order` con un id desconocido y un elemento nuevo no listado
  - (e) `add` duplicado → idempotente
  - (f) `unset`

  Tests:
  - correr todos los fixtures
  - propiedad: para 200 pares aleatorios `prev → next` (generador con semilla fija que añade, borra, edita y reordena tablas, campos, notas y enums), comprobar `isEqual(applyOps(prev, diffDoc(prev,next)).doc, next)`
  - `validateOps` rechaza `{t:'patch', coll:'users'}` y lotes de 5001
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: operaciones granulares del documento`

### Task 8: Tiempo real con Socket.IO (`RoomManager`)

**Files (BE):** Create `src/collab/rooms.ts`, `src/collab/socket.ts`; modify `src/server.ts`, `src/index.ts`. Test: `tests/collab/rooms.test.ts`, `tests/collab/socket.test.ts`

**Interfaces:**
- Consumes: `applyOps`, `validateOps`, `getRole`, `getSessionUser`, `EMPTY_DOC`
- Produces:
  - `class RoomManager(pool, opts: { saveDebounceMs=2000, snapshotIntervalMs=600000, snapshotKeep=200 })`, con los métodos:
    - `join(projectId): Promise<{doc, version}>`
    - `apply(projectId, ops): {applied, version, ok}`
    - `flush(projectId)`, `flushAll()`
    - `release(projectId)`: guarda y descarga de memoria cuando la sala queda vacía
    - `onMembershipChanged`, `onProjectRenamed`, `onProjectDeleted`
    - `attachIo(io)`
  - `registerCollab(io, deps)`. Protocolo:
    - **Handshake:** se lee la cookie `drawdb_session` → `socket.data.user`. Si no hay sesión, error `unauthorized`. `cors.origin = new URL(APP_URL).origin`, `credentials:true`.
    - `join` `{projectId}`, con ack:
      - si tiene acceso: `{ok:true, doc, version, role, name, peers:[{userId,name,color}]}`
      - si no: `{ok:false, error:'not_found'}`
      - un socket está en un solo proyecto a la vez
    - `ops` `{seq, ops}`:
      - si el rol es `viewer`: ack `{seq, ok:false, error:'forbidden'}`
      - si no: al autor le llega `ack {seq, version, ok}` y al resto de la sala `ops {version, ops: applied, by}`
      - `version` aumenta en 1 si se aplicó algo
    - `awareness` `{cursor:{x,y}|null, linking|null}`: se reenvía en modo volátil como `awareness {userId, cursor, linking}`
    - Eventos del servidor:
      - `presence {peers}` al entrar y al salir
      - `renamed {name}`
      - `deleted`
      - `access_revoked`: se envía y luego se desconecta el socket
      - `role_changed {role}`
  - `colorFor(userId): string`: hash → paleta fija de 12 colores. El FE la replica en Task 12.

- [ ] **Step 1: Tests que fallan.** Usar `socket.io-client` contra `createServer` en un puerto aleatorio, con cookies obtenidas por login. Cada viñeta es un test:
  - Sin cookie, la conexión se rechaza.
  - Un no miembro recibe `join` con `not_found`.
  - El cliente A envía `sadd` del campo X y B envía `sadd` del campo Y en la misma tabla, casi a la vez. Los dos reciben las operaciones del otro, la `version` final es base+2 y `projects.diagram` (tras `flush`) contiene X e Y.
  - Un `viewer` recibe `forbidden` y el documento no cambia.
  - Tras `DELETE /api/projects/:id/members/:B`, B recibe `access_revoked` y queda desconectado.
  - Con `saveDebounceMs=50`, la base de datos refleja los cambios sin necesidad de `flush` explícito.
  - Con `snapshotIntervalMs=0` y `snapshotKeep=3`, tras 5 guardados quedan 3 snapshots.
  - `awareness` no llega de vuelta al emisor.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. `maxHttpBufferSize: 10e6`. La sala es `project:<id>`.
- [ ] **Step 4:** PASS. **Step 5:** Commit `feat: colaboración en tiempo real con Socket.IO`

### Task 9: Despliegue del backend

**Files (BE):** Create `Dockerfile`, `compose.dokploy.yaml`, `.dockerignore`; modify `README.md`, `.env.sample`

- [ ] **Step 1: `Dockerfile`** multi-stage con `node:20-alpine`:
  - etapa `build`: `npm ci` y `npm run build`
  - etapa final: `npm ci --omit=dev`, copiar `dist/` y `migrations/`
  - `EXPOSE 5000` y `CMD ["node","dist/index.js"]`
- [ ] **Step 2: `compose.dokploy.yaml`**
  - servicio `drawdb-api` con `build: .`, `restart: unless-stopped` y `expose: ["5000"]`
  - variables desde el entorno de Dokploy
  - red `dokploy-network` (external)
  - sin `ports`
- [ ] **Step 3:** El README documenta:
  - las variables
  - el dominio en Dokploy: el mismo host que el frontend, con las rutas `/api` y `/socket.io` hacia el puerto 5000, **sin** strip path
  - `DATABASE_URL` apuntando al Postgres de Dokploy por su nombre interno
  - el arranque local: `cp .env.sample .env` y `npm run dev`
- [ ] **Step 4: Verificar:** `docker build -t drawdb-api .` termina bien. `docker run --rm --network shared-postgres -e DATABASE_URL=postgres://drawdb:drawdb_local@shared-postgres:5432/drawdb -e APP_URL=http://localhost:5173 -p 5055:5000 drawdb-api` y `curl localhost:5055/api/health` → `{"ok":true}`.
- [ ] **Step 5:** Commit `chore: Dockerfile y compose para Dokploy`

## Fase B — Frontend

### Task 10: Base del frontend (tests, proxy, cliente HTTP)

**Files (FE):**
- Modify: `package.json` (devDeps `vitest`; deps `socket.io-client`; script `"test": "vitest run"`), `vite.config.js`, `src/config/index.js`
- Create: `src/api/http.js`, `src/api/auth.js`, `src/api/projects.js`, `src/api/admin.js`, `src/api/http.test.js`

**Interfaces:**
- Produces:
  - `http`: axios con `baseURL: '/api'` y `withCredentials: true`
  - `errorCode(err): string|undefined`: devuelve `err.response?.data?.error`
  - `auth.{register,verify,resend,login,logout,me,forgot,reset,changePassword}`
  - `projects.{list,create,get,rename,remove,members,addMember,updateMember,removeMember,removeInvitation}`
  - `admin.{users,setAdmin}`
  - Todos devuelven `res.data`.
  - `backendUrl` y `gistBackendUrl` pasan a usar por defecto `"/api"`.
- [ ] **Step 1: Test que falla:** `errorCode({response:{data:{error:'invalid_token'}}}) === 'invalid_token'` y `errorCode(new Error()) === undefined`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. Proxy de Vite: `'/api' → http://localhost:5000` y `'/socket.io' → {target: 'http://localhost:5000', ws: true}`.
- [ ] **Step 4:** PASS. Run `npm run lint` → sin errores.
- [ ] **Step 5:** Commit `feat: cliente API y proxy de desarrollo`

### Task 11: Ids estables en notas, áreas, índices y restricciones

Hoy esos ids son la posición en la lista y se renumeran al borrar. Con varios editores, eso hace chocar ids y borra o edita el elemento equivocado.

**Files (FE):** Modify:
- `src/context/NotesContext.jsx` (líneas ~30, 35, 47, 78-85)
- `src/context/AreasContext.jsx` (~25, 31, 42, 73-80)
- `src/components/EditorSidePanel/TablesTab/TableInfo.jsx` (107, 137)
- `src/components/EditorHeader/ControlPanel.jsx` (233-260, 310-334, 472-478, 533-584, 921-930)
- `src/components/EditorCanvas/Canvas.jsx` (561-564, 637-645)
- `src/components/EditorHeader/Modal/Modal.jsx` (import con append: ids de relaciones)
- Test: `src/utils/ids.test.js`

**Interfaces:**
- Produces: `findById(list, id)` y `newId()` (= `nanoid()`) en `src/utils/ids.js`

- [ ] **Step 1: Test que falla:** `findById([{id:'a'},{id:0}], 0)` devuelve el segundo elemento; `newId()` devuelve un string de 21 caracteres.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar
  - Crear con `newId()`.
  - Quitar todo `.map((x,i)=>({...x,id:i}))` de borrado y de deshacer/rehacer.
  - Cambiar `notes[id]`/`areas[id]` por `findById`.
  - Al importar en modo append, dar `newId()` a las relaciones en vez de `i`.
- [ ] **Step 4: Verificar**
  - `grep -rnE "id: [a-zA-Z.]+\.length|id: i \}|(notes|areas)\[[a-zA-Z.]*id\]" src` → vacío.
  - `npm test` y `npm run lint` pasan.
  - Prueba manual en `npm run dev`: crear 3 notas y 3 áreas, borrar la del medio, deshacer y rehacer. La nota o área correcta reaparece y desaparece.
  - Abrir un diagrama guardado antes del cambio (ids numéricos): se mueve y se borra bien.
- [ ] **Step 5:** Commit `refactor: ids estables para notas, áreas, índices y restricciones`

### Task 12: `ops.js` y `CollabClient` (FE, puros)

**Files (FE):**
- Create: `src/collab/ops.js` (traducción de `BE/src/collab/ops.ts`, sin `validateOps`), `src/collab/__fixtures__/ops.fixtures.json` (copia), `src/collab/CollabClient.js`, `src/collab/colors.js`
- Test: `src/collab/ops.test.js`, `src/collab/CollabClient.test.js`

**Interfaces:**
- Consumes: el contrato `Op` de Task 7
- Produces:
  - `applyOp`, `applyOps`, `diffDoc` (mismas reglas que Task 7)
  - `colorFor(userId)` (misma paleta y hash que el BE)
  - `class CollabClient({ send: (batch:{seq,ops}) => void })`:
    - `resetFromSnapshot({doc,version}): Doc`: descarta pendientes; `confirmed = shadow = doc`
    - `local(nextDoc): void`: `ops = diffDoc(shadow,nextDoc)`; si está vacío no hace nada; si no, `seq++`, agrega a pendientes, `shadow = nextDoc` y llama a `send`
    - `ack({seq,version,ok}): 'ok'|'resync'`: si `!ok` → `'resync'`; si no, aplica el lote a `confirmed` y toma `version`
    - `remote({version,ops}): Doc|'resync'`: si `version !== this.version + 1` → `'resync'`; si no, `confirmed = applyOps(confirmed, ops)` y `shadow = applyOps(confirmed, ...pending.ops)` (rebase), y devuelve `shadow`
    - getters `shadow`, `version`, `hasPending`

- [ ] **Step 1: Tests que fallan**
  - `ops.test.js` corre el mismo fixture y la misma propiedad que Task 7.
  - `CollabClient.test.js`, cada viñeta un test:
    - `local` con una tabla nueva llama a `send` con 1 `add`.
    - `local` con el mismo documento no llama a `send`.
    - Remoto `sadd` del campo Y mientras hay un pendiente `sadd` del campo X → el `shadow` tiene X e Y. Tras `ack`, `confirmed` también tiene los dos.
    - Remoto con `version` salteada → `'resync'`.
    - `resetFromSnapshot` deja `hasPending === false`.
    - `ack` con `ok:false` → `'resync'`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: cliente de colaboración y operaciones`

### Task 13: Autenticación en la UI y rutas protegidas

**Files (FE):**
- Create:
  - `src/context/AuthContext.jsx`, `src/hooks/useAuth.js`
  - `src/components/Auth/RequireAuth.jsx` (exporta también `RequireAdmin`), `src/components/Auth/AuthLayout.jsx`
  - `src/pages/Login.jsx`, `src/pages/Register.jsx`, `src/pages/Verify.jsx`, `src/pages/Forgot.jsx`, `src/pages/Reset.jsx`, `src/pages/Account.jsx` (cambiar contraseña)
- Modify: `src/App.jsx`, `src/hooks/index.js`, `src/i18n/locales/es.js`, `src/i18n/locales/en.js`

**Interfaces:**
- Consumes: `api/auth`, `errorCode`
- Produces:
  - `useAuth(): { user: PublicUser|null, loading, login(email,pw), logout(), setUser }`. Al montar llama a `me()`.
  - `<RequireAuth>`: si no hay usuario, redirige a `/login?next=<ruta>`
  - `<RequireAdmin>`: si no es administrador, redirige a `/projects`
- Rutas:
  - públicas: `/login`, `/register` (acepta `?email=` para precargar), `/verify`, `/forgot`, `/reset`
  - con `RequireAuth`: `/projects`, `/projects/:id`, `/account`, `/editor`, `/editor/diagrams/:id`, `/editor/templates/:id`, `/templates`, `/bug-report`
  - con `RequireAdmin`: `/admin/users`
  - `/` redirige a `/projects`. `LandingPage` sale de las rutas, pero el archivo no se borra.
- Mensajes:
  - Tras registrarse: "Te enviamos un correo para verificar tu cuenta. Revisa tu bandeja de entrada." y un botón "Reenviar".
  - Los códigos de error se muestran con los textos exactos de Global Constraints.

- [ ] **Step 1:** Implementar (sin tests unitarios de UI; la verificación es manual).
- [ ] **Step 2: Verificar** con BE y FE corriendo, y `MAIL_HOST=localhost MAIL_PORT=1026` (Mailpit en `http://localhost:8026`):
  1. `/` sin sesión → `/login`.
  2. Registro con un dominio no permitido → aparece exactamente el texto `registration_not_allowed`.
  3. Registro con un dominio permitido → llega un correo a Mailpit; el login antes de verificar da "Correo o contraseña incorrectos".
  4. Abrir el enlace → entra directo a `/projects`.
  5. Login con `ADMIN_EMAIL`/`ADMIN_PASSWORD` funciona.
  6. "Olvidé mi contraseña" → llega el correo → el reset funciona.
  7. `npm run lint` pasa.
- [ ] **Step 3:** Commit `feat: login, registro y verificación en la UI`

### Task 14: Lista de proyectos, miembros y administración de usuarios

**Files (FE):**
- Create: `src/pages/Projects.jsx`, `src/components/Projects/MembersModal.jsx`, `src/pages/AdminUsers.jsx`
- Modify: los archivos de i18n

**Interfaces:**
- Consumes: `api/projects`, `api/admin`, `useAuth`
- Produces: `<MembersModal projectId visible onClose />`, que reutiliza Task 15

- [ ] **Step 1: Implementar**
  - **`Projects`:**
    - una tabla con nombre, rol y fecha de actualización; al hacer clic se abre `/projects/:id`
    - los administradores ven "Nuevo proyecto" y en cada fila "Renombrar", "Miembros" y "Eliminar" (con confirmación)
    - en la cabecera: el nombre del usuario, "Mi cuenta", "Usuarios" (solo administradores) y "Salir"
  - **`MembersModal`:**
    - lista de miembros con selector de rol (Editor/Lector) y botón "Quitar"
    - invitaciones pendientes con "Cancelar"
    - formulario de correo y rol; el resultado `added` o `invited` se muestra en un toast
  - **`AdminUsers`:**
    - tabla de usuarios con un switch de administrador
    - el switch del superadministrador está deshabilitado
    - se muestran los errores `cannot_change_superadmin` y `last_admin`
- [ ] **Step 2: Verificar a mano**
  1. El administrador crea un proyecto e invita a un correo nuevo del dominio → le llega la invitación.
  2. Se registra con ese correo y verifica → ve el proyecto.
  3. Un usuario sin invitación ve la lista vacía.
  4. `npm run lint` pasa.
- [ ] **Step 3:** Commit `feat: proyectos, miembros y usuarios en la UI`

### Task 15: Editor en modo proyecto (`ProjectCollabProvider` + `CollabBridge`)

**Files (FE):**
- Create: `src/collab/ProjectCollabProvider.jsx`, `src/collab/CollabBridge.jsx`, `src/collab/viewStorage.js`, `src/pages/ProjectEditor.jsx`
- Test: `src/collab/viewStorage.test.js`
- Modify:
  - `src/components/Workspace.jsx`: agregar `<Slot name="canvas-layer" />` **dentro** de `CanvasContextProvider`, justo después de `<Canvas …/>`
  - `src/components/EditorHeader/ControlPanel.jsx`: si `extensions.projectMode` es verdadero, ocultar los ítems de menú de nuevo, abrir, guardar como, compartir (gist), versiones o historial de gist, renombrar y eliminar diagrama. El título muestra `extensions.projectName`.
  - `src/components/EditorHeader/Modal/Modal.jsx`: en modo proyecto, la importación con "sobrescribir" pide confirmación con el texto "Esto reemplaza el diagrama para todo el equipo. ¿Continuar?"

**Interfaces:**
- Consumes: `CollabClient`, `colorFor`, el protocolo de Task 8, `MembersModal`, el `ExtensionsContext` existente (`cloudLoad`, `cloudSave`, `Slot`), `Workspace({forcedDiagramId})`, `layout.readOnly`
- Produces:
  - `viewStorage.load(projectId): {pan,zoom}|null` y `viewStorage.save(projectId, {pan,zoom})`, con `try/catch` y clave `drawdb:view:<projectId>`
  - `ProjectCollabContext`: `{ status: 'connecting'|'online'|'offline', role, projectName, peers, awareness: Map<userId,{cursor,linking,name,color}>, sendAwareness(partial), registerAppliers(appliers), docToEditor, waitForSnapshot(): Promise<Diagram> }`
  - Además provee `CollabContext` con `emitDelta: () => {}` y `emitAwareness: sendAwareness`.
- **Composición** de `ProjectEditor` (`/projects/:id`): igual que `Editor.jsx`, pero con `<ProjectCollabProvider projectId>` justo debajo de `SettingsContextProvider` y un `ExtensionsContext.Provider` con:
  ```
  { projectMode:true, projectName,
    cloudLoad: () => waitForSnapshot(),   // devuelve { name, database, tables, references, notes, areas, views, enums, types, sqlHeader, pan, zoom, canWrite }
    cloudSave: async () => {},            // desactiva Dexie
    'canvas-layer': <RemoteCursors/>,     // Task 16
    'header-actions-end': <PresenceBar/>  // Task 16 (incluye botón "Miembros" para admins)
  }
  ```
  `<WorkSpace forcedDiagramId={projectId} />` y, dentro del árbol de contextos, `<CollabBridge/>`.
- **`CollabBridge`** (sin UI):
  - registra los setters (`setTables`, `setRelationships`, `setNotes`, `setAreas`, `setViews`, `setEnums`, `setTypes`, `setDatabase`, `setSqlHeader`)
  - observa esos estados y, como mucho cada 50 ms, llama a `client.local(docActual)`
  - las operaciones remotas o el resync asignan solo las porciones cuyo valor cambió de referencia
  - `pan`/`zoom` → `viewStorage.save` con debounce de 500 ms
- **Estado de conexión:**
  - `offline` → `layout.readOnly = true` y un banner "Sin conexión — reconectando…"
  - al reconectar: `join` → `resetFromSnapshot` → aplicar
  - si el rol es `viewer` → `readOnly`
  - `resync` → reenviar `join`
  - `renamed` actualiza `projectName`
  - `deleted` o `access_revoked` → toast y navegación a `/projects`

- [ ] **Step 1: Test que falla:** si `localStorage` lanza una excepción, `viewStorage.load('p')` devuelve `null`. Tras `save` y `load` se recupera el mismo `{pan,zoom}`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS. `npm run lint` pasa.
- [ ] **Step 5: Verificar a mano** con dos navegadores (uno en ventana privada) y dos usuarios en el mismo proyecto:
  1. A crea una tabla → aparece en B sin recargar.
  2. Los dos agregan una columna a la misma tabla a la vez → las dos columnas en ambos navegadores, y siguen ahí tras recargar.
  3. A hace pan y zoom → la vista de B no se mueve. Al recargar, A recupera su vista.
  4. A arrastra una tabla → B la ve moverse.
  5. A deshace → B ve el cambio revertido, sin perder lo que B había hecho en otra tabla.
  6. Se detiene el backend → los dos quedan en solo lectura con banner. Al reiniciarlo, se reconectan con el estado del servidor.
  7. Un viewer no puede editar.
  8. Importar JSON con sobrescribir pide confirmación y se propaga a B.
- [ ] **Step 6:** Commit `feat: editor en modo proyecto con colaboración en tiempo real`

### Task 16: Cursores remotos y presencia

**Files (FE):** Create `src/collab/RemoteCursors.jsx`, `src/collab/PresenceBar.jsx`, `src/collab/throttle.js`. Test: `src/collab/throttle.test.js`

**Interfaces:**
- Consumes: `ProjectCollabContext`, `useCanvas()` (`pointer.spaces.diagram`, `toScreenSpace`), `useTransform()`
- Produces: `throttle(fn, ms)`, con *trailing call* garantizada

- [ ] **Step 1: Test que falla** (con timers falsos de vitest): 10 llamadas en 100 ms con `ms=50` → como mucho 3 ejecuciones, y la última llamada siempre se ejecuta con los últimos argumentos.
- [ ] **Step 2:** FAIL. **Step 3: Implementar**
  - **`RemoteCursors`** (en el slot `canvas-layer`):
    - emite `sendAwareness({cursor: pointer.spaces.diagram})` con `throttle` de 50 ms
    - emite `cursor:null` en `pointerleave`
    - dibuja una capa absoluta con `pointer-events:none`: por cada par, una flecha SVG y una etiqueta con nombre y color en `toScreenSpace(cursor)`
    - dibuja la línea `linking` remota
    - la capa es un componente separado y memoizado, para que mover cursores no re-renderice las tablas
  - **`PresenceBar`:**
    - avatares con iniciales y color (como mucho 8, más "+N")
    - punto de estado (online/reconectando)
    - botón "Miembros" (solo administradores) que abre `MembersModal`
- [ ] **Step 4:** PASS. Verificación manual: con dos navegadores, cada uno ve el cursor del otro con su nombre en el lugar correcto del diagrama aunque tengan zoom distinto.
- [ ] **Step 5:** Commit `feat: cursores remotos y presencia`

### Task 17: Prueba de carga con 200 entidades

**Files (BE):** Create `scripts/gen-diagram.ts` y `scripts/load-test.ts`; agregar los scripts npm `gen:diagram` y `load-test`.

**Interfaces:**
- `gen-diagram.ts [n=200] > big.json`: produce un JSON de drawDB importable (tablas con 8 a 15 campos, unas 250 relaciones), con ids `nanoid`.
- `load-test.ts --project <id> --clients 10 --seconds 60`:
  - inicia sesión con usuarios sembrados por el propio script (`loadtest+N@<primer dominio permitido>`, ya verificados y miembros editores)
  - cada cliente envía awareness a 20/s y un `spatch` o `patch` aleatorio cada 500 ms
  - informa p50 y p95 de la latencia de ack y el total de operaciones aplicadas

- [ ] **Step 1:** Implementar los dos scripts.
- [ ] **Step 2: Verificar**
  - Importar `big.json` en un proyecto desde la UI.
  - Ejecutar `npm run load-test -- --project <id> --clients 10 --seconds 60`. Expected: p95 de ack < 150 ms en local y 0 resyncs.
  - Con el script corriendo, abrir el proyecto en Chrome y grabar 10 s de pan y zoom en Performance. Expected: los cursores se ven moverse y no hay tareas largas (> 50 ms) repetidas atribuibles a aplicar operaciones. Si las hay, optimizar donde indique el perfil (spec §7.7) y repetir.
- [ ] **Step 3:** Commit `test: generador de diagrama y prueba de carga`

### Task 18: Despliegue del frontend y guía de Dokploy

**Files (FE):** Create `compose.dokploy.yaml`, `docs/deploy/dokploy.md`; modify `README.md` (sección "Modo equipo").

- [ ] **Step 1: `compose.dokploy.yaml`:** servicio `drawdb-web` con `build: .` (reutiliza el `Dockerfile`), `expose: ["80"]` y red `dokploy-network` (external).
- [ ] **Step 2: `docs/deploy/dokploy.md`**, en orden:
  1. En el Postgres existente de Dokploy, crear el rol y la base `drawdb` (SQL de `create-db.sh`).
  2. Crear la app compose `drawdb-api` desde el fork de `drawdb-server`, con sus variables (`APP_URL=https://<dominio>`, `MAIL_HOST=smtp.hostinger.com`, `MAIL_PORT=465`, `MAIL_SECURE=true`, el buzón, `ALLOWED_EMAIL_DOMAINS`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`).
  3. Configurar el dominio con las rutas `/api` y `/socket.io` hacia el puerto 5000.
  4. Crear la app compose `drawdb-web` desde este fork, con el dominio en `/` hacia el puerto 80, y HTTPS en los dos.
  5. Comprobaciones: `/api/health`, login con el superadmin, dos navegadores.
  6. Desarrollo local: Postgres compartido (Task 1), `npm run dev` en los dos repos y Mailpit.
- [ ] **Step 3: Verificar** en local que la imagen es la misma que irá a producción:
  - `docker build -t drawdb-web .`
  - correr `drawdb-api` (Task 9) y `drawdb-web` detrás de un nginx o Traefik local que reparta `/` y `/api`/`/socket.io`, o en su lugar documentar la prueba directa en el VPS
  - `/` carga la SPA y el login funciona con la cookie `Secure` desactivada en `http`
- [ ] **Step 4:** Commit `docs: despliegue en Dokploy`

---

## Ajustes a la spec que hace este plan

- **Importar** no usa un delta especial de "reemplazo": el `CollabBridge` compara estados y la importación viaja como operaciones granulares (borrados y altas). Se mantiene la confirmación para "sobrescribir".
- **Renombrar** un proyecto se hace desde `/projects` (solo administradores). El editor muestra el nombre en vivo (`renamed`), pero en modo proyecto oculta su modal "Rename".
- Se agrega `/account` para cambiar la contraseña, que la spec da por existente ("se cambia desde la app").
