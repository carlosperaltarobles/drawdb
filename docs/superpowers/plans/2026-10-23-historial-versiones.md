# Historial de versiones — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Ejecución acordada con el dueño:** cada tarea la implementa **Cline CLI** (`cline -c <repo> "<tarea>"`) y Claude revisa el diff y ejecuta las pruebas antes de pasar a la siguiente.

**Goal:** Historial de versiones por proyecto (listar, previsualizar, restaurar y guardar versiones con nombre) sin escrituras extra por operación.

**Architecture:** Se amplía `ProjectSnapshot`. Las copias automáticas siguen escribiéndose dentro de la transacción de guardado de `RoomManager`. Las copias previas a borrados masivos y a restauraciones se escriben aparte, y una poda SQL periódica aplica la retención. Una API REST `/api/projects/:id/history` lista, sirve, crea y restaura; la restauración reemplaza el documento en memoria, sube un `epoch` que invalida operaciones en vuelo y emite `restored` por Socket.IO. En el frontend, `ProjectSession` gana un modo de previsualización local y un panel `SideSheet` ocupa el hueco de "Versiones" en modo proyecto.

**Tech Stack:** Backend: Node 22, TypeScript, Express 4, Prisma 7 (Postgres 16), Socket.IO 4, zod 4, vitest 5 + supertest. Frontend: React 18, Vite, Semi UI, i18next, socket.io-client, vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-23-historial-versiones-design.md` (léelo antes de cada tarea).

## Global Constraints

- Repos: backend `/home/carlos/Proyectos/drawdb-server`, frontend `/home/carlos/Proyectos/drawdb`. Rama `feat/historial-versiones` en **ambos**, creada desde `main`.
- **Regla del dueño: prohibido hacer merge a `main` y prohibido `git push`** salvo que el dueño lo indique expresamente. Solo commits en la rama de la feature.
- Prisma para todo acceso a datos; SQL crudo (`$executeRaw`) solo para la poda. Capas: ruta → servicio → datos, como `src/projects/`.
- Ninguna escritura nueva en la DB por cada lote de `ops`, salvo la copia `pre_bulk_delete` (limitada a 1 cada 60 s por proyecto).
- La lista de historial **nunca** selecciona `diagram`.
- Copia automática: como máximo cada `600_000` ms (valor actual de `snapshotIntervalMs`).
- Retención `auto`: < 48 h todas; 48 h–30 días la más reciente por día; 30 días–6 meses (183 días) la más reciente por semana ISO; > 183 días se borran. `pre_restore` y `pre_bulk_delete`: todas durante 30 días y luego se borran. `named`: nunca.
- Borrado masivo: un lote con ≥ 2 `del` de primer nivel y además (≥ 5 `del` **o** `del` de tablas ≥ 30 % de las tablas del documento).
- Máximo 100 copias `named` por proyecto; nombre 1–80 caracteres tras `trim`.
- Permisos: listar/ver → cualquier rol (`admin`, `editor`, `viewer`); crear, renombrar, borrar `named` y restaurar → `admin` o `editor`. Sin acceso o copia de otro proyecto → 404 `not_found`; viewer → 403 `forbidden`.
- Textos de UI en español (`src/i18n/locales/es.js`) y en inglés (`en.js`).
- Pruebas: backend `npm test` (necesita Postgres de pruebas en `DATABASE_URL_TEST`, por defecto `postgres://drawdb:drawdb_local@localhost:5432/drawdb_test`); frontend `npm test` y `npm run lint`.
- Mensajes de commit en español, estilo `feat: ...` / `fix: ...`. **Sin créditos de Claude ni líneas `Co-Authored-By`** (regla del dueño).

## Review Focus

1. **Restaurar mientras otra persona arrastra una tabla.** Su lote en vuelo debe rechazarse (`stale_epoch`) y su editor debe acabar mostrando el documento restaurado, no una mezcla. → prueba en Task 3.
2. **Restaurar sin nadie conectado** (la sala no está en memoria). Debe funcionar, persistir y no dejar la sala cargada para siempre. → prueba en Task 6.
3. **Previsualizar mientras llegan cambios remotos.** "Volver a la actual" muestra esos cambios y durante la previsualización no se emite ninguna operación ni awareness. → prueba en Task 9.
4. **Pedir o restaurar una copia de otro proyecto** pasando su id por la URL. Debe responder 404 sin filtrar datos. → prueba en Task 7.
5. **Llega `restored` mientras se previsualiza.** Se sale de la previsualización y se queda en el documento restaurado. → prueba en Task 9.

---

## Mapa de archivos

**Backend (`drawdb-server`)**

- Modify `prisma/schema.prisma` + nueva migración `prisma/migrations/<ts>_historial_versiones/`
- Modify `src/http/app-error.ts`: códigos `forbidden` (403) y `snapshot_limit` (409)
- Modify `src/collab/rooms.ts`: autores, `epoch`, `apply` con contexto, copia de borrado masivo, `peekDoc`, `restore`; quitar `snapshotKeep`
- Modify `src/collab/socket.ts`: pasar autor y `epoch`, `epoch` en la respuesta de `join`
- Create `src/history/constants.ts`: valores fijos del spec
- Create `src/history/types.ts`: `Author`, `HistoryRooms`, `SnapshotMeta`
- Create `src/history/bulk-delete.ts`: detección de borrado masivo (función pura)
- Create `src/history/prune.ts`: poda SQL
- Create `src/history/scheduler.ts`: temporizador de poda con advisory lock
- Create `src/history/schemas.ts`, `src/history/service.ts`, `src/history/routes.ts`
- Modify `src/app.ts`, `src/server.ts`, `src/index.ts`: cableado
- Tests: `tests/collab/rooms.test.ts`, `tests/collab/socket.test.ts`, `tests/history/*.test.ts`, `tests/helpers/app.ts`

**Frontend (`drawdb`)**

- Create `src/api/history.js`
- Create `src/collab/historyGroups.js` (+ `.test.js`): agrupar por Hoy/Ayer/Esta semana/fecha
- Modify `src/collab/CollabClient.js`, `src/collab/ProjectSession.js` (+ tests)
- Modify `src/collab/ProjectCollabProvider.jsx`, `src/pages/ProjectEditor.jsx`, `src/collab/RemoteCursors.jsx`
- Create `src/collab/PreviewBanner.jsx`, `src/collab/HistoryPanel.jsx`
- Modify `src/components/EditorHeader/ControlPanel.jsx`, `src/components/EditorHeader/SideSheet/Sidesheet.jsx`
- Modify `src/i18n/locales/es.js`, `src/i18n/locales/en.js`, `.gitignore`

---

### Task 1: Esquema de copias y códigos de error (backend)

**Files:**

- Modify: `prisma/schema.prisma` (modelo `ProjectSnapshot`, `User`)
- Create: `prisma/migrations/<timestamp>_historial_versiones/migration.sql` (generada)
- Modify: `src/http/app-error.ts`
- Create: `src/history/constants.ts`, `src/history/types.ts`

**Interfaces:**

- Produces:

  - enum Prisma `SnapshotKind { auto named pre_restore pre_bulk_delete }`
  - `ProjectSnapshot` añade: `kind SnapshotKind @default(auto)`, `name String?`, `createdBy String? @map("created_by") @db.Uuid` (relación `creator User? @relation("SnapshotCreatedBy", onDelete: SetNull)`), `authors Json @default("[]") @db.JsonB`, `sizeBytes Int? @map("size_bytes")`. Índice nuevo `@@index([projectId, kind])`.
  - `User` añade `createdSnapshots ProjectSnapshot[] @relation("SnapshotCreatedBy")`.
  - `AppErrorCode` incluye `'forbidden'` (403) y `'snapshot_limit'` (409).
  - `src/history/types.ts`: `export type Author = { id: string; name: string }`; `export type SnapshotMeta = { id: string; kind: SnapshotKind; name: string | null; createdAt: Date; createdBy: Author | null; authors: Author[]; sizeBytes: number | null }`.
  - `src/history/constants.ts`: `NAMED_LIMIT = 100`, `NAME_MAX = 80`, `BULK_MIN_DELETES = 2`, `BULK_DELETES = 5`, `BULK_TABLE_RATIO = 0.3`, `BULK_COOLDOWN_MS = 60_000`, `PRUNE_INTERVAL_MS = 6 * 3600_000`, `KEEP_ALL_MS = 48 * 3600_000`, `DAILY_UNTIL_DAYS = 30`, `WEEKLY_UNTIL_DAYS = 183`, `SAFETY_KEEP_DAYS = 30`, `HISTORY_PAGE = 50`.

- [ ] **Step 1:** Crear la rama `feat/historial-versiones` en `drawdb-server` y en `drawdb` desde `main`.
- [ ] **Step 2:** Editar el esquema y generar la migración con `npx prisma migrate dev --name historial_versiones` (contra la DB local). Revisar que el SQL añade columnas con default y no borra datos.
- [ ] **Step 3:** Añadir los códigos a `STATUS` en `app-error.ts` y crear `constants.ts` y `types.ts`.
- [ ] **Step 4:** Ejecutar `npx tsc --noEmit && npm test`. Esperado: todo pasa, sin cambios de comportamiento.
- [ ] **Step 5:** Commit `feat: esquema de historial de versiones`.

---

### Task 2: Autores, `epoch` y fin de la poda por guardado en `RoomManager`

**Files:**

- Modify: `src/collab/rooms.ts`
- Test: `tests/collab/rooms.test.ts`

**Interfaces:**

- Consumes: `Author` (Task 1).
- Produces:

  - `export type ApplyContext = { author?: Author; epoch?: number }`
  - `apply(projectId: string, ops: readonly Op[], ctx?: ApplyContext): { applied: Op[]; version: number; ok: boolean; staleEpoch?: true }`. Si `ctx.epoch !== undefined && ctx.epoch !== room.epoch` → `{ applied: [], version: room.version, ok: false, staleEpoch: true }` sin tocar nada. Si se aplica algo y hay `ctx.author`, se añade a `room.authors`.
  - `join(projectId): Promise<{ doc: Document; version: number; epoch: number }>`
  - `RoomState` añade `epoch: number` (empieza en 0) y `authors: Map<string, string>` (id → nombre).
  - `RoomManagerOptions` **pierde** `snapshotKeep`; mantiene `saveDebounceMs` y `snapshotIntervalMs`.
  - La copia automática se crea con `kind: 'auto'`, `authors: [...]` y `sizeBytes = Buffer.byteLength(JSON.stringify(doc))`. Al capturarla se hace swap `room.authors = new Map()`; si la transacción falla se vuelven a fusionar los autores capturados.

- [ ] **Step 1: Pruebas que fallan** en `tests/collab/rooms.test.ts`:
  - `'la copia automática registra los autores desde la copia anterior'`: `snapshotIntervalMs: 0`; `apply(..., { author: {id:'u1',name:'Ana'} })`, `apply(..., { author: {id:'u2',name:'Luis'} })`, `flush` → la copia más reciente tiene `kind === 'auto'`, `authors` igual a `[{id:'u1',name:'Ana'},{id:'u2',name:'Luis'}]` (en cualquier orden) y `sizeBytes > 0`. Otro `apply` con `u2` y `flush` → la siguiente copia tiene solo `[{id:'u2',name:'Luis'}]`.
  - `'ya no poda copias al guardar'`: sustituye la prueba `'con snapshotIntervalMs=0 y snapshotKeep=3...'`. Con 5 guardados quedan 5 copias.
  - `'rechaza un lote con epoch distinto sin aplicarlo'`: `join` devuelve `epoch: 0`; `apply(..., { epoch: 1 })` → `{ applied: [], ok: false, staleEpoch: true, version: 0 }`; `apply(..., { epoch: 0 })` aplica; `apply(...)` sin `ctx` aplica.
  - Actualizar las aserciones `toEqual({ doc, version: 0 })` existentes para incluir `epoch: 0`.
- [ ] **Step 2:** `npx vitest run tests/collab/rooms.test.ts`. Esperado: FALLAN las nuevas.
- [ ] **Step 3:** Implementar en `rooms.ts`. Eliminar el `findMany`/`deleteMany` de `runSaveLoop` y la opción `snapshotKeep`.
- [ ] **Step 4:** Ejecutar de nuevo. Esperado: PASS. Ajustar `tests/collab/socket.test.ts` donde use `snapshotKeep` (misma sustitución: ya no se poda).
- [ ] **Step 5:** `npm test` completo y commit `feat: autores y epoch en las salas de colaboración`.

---

### Task 3: Socket: autor y `epoch` en los lotes

**Files:**

- Modify: `src/collab/socket.ts` (handlers `join` y `ops`)
- Test: `tests/collab/socket.test.ts`

**Interfaces:**

- Consumes: `apply(projectId, ops, ctx)` y `join` con `epoch` (Task 2).
- Produces (protocolo):

  - Respuesta de `join`: añade `epoch: number`.
  - Lote `ops` del cliente: `{ seq, ops, epoch? }`. Si `epoch` es un entero seguro se pasa en `ctx.epoch`; si falta, se omite (cliente antiguo, se acepta). Si viene pero no es entero → `ack { seq, ok: false, error: 'invalid_ops' }`.
  - Si `apply` devuelve `staleEpoch` → `ack { seq, ok: false, error: 'stale_epoch' }` y no se retransmite nada.
  - `ctx.author = { id: user.id, name: user.name }`.

- [ ] **Step 1: Pruebas que fallan:**
  - `'join devuelve el epoch de la sala'` → `reply.epoch === 0`.
  - `'un lote con epoch obsoleto recibe stale_epoch y no se retransmite'`: dos clientes; se fuerza `rooms` a otro epoch llamando a `rooms.restore` (si Task 6 aún no existe, usar un lote con `epoch: 99`) → el emisor recibe `ack { ok: false, error: 'stale_epoch' }` y el otro cliente no recibe `ops` en 200 ms.
  - `'un lote sin epoch se sigue aceptando'` → `ack ok: true`.
  - **(Review Focus 1)** `'tras restaurar, un lote en vuelo con el epoch anterior se rechaza y el documento queda como el restaurado'`: añadir esta prueba en Task 6 Step 1 (necesita `restore`), anotándola aquí como pendiente.
- [ ] **Step 2:** `npx vitest run tests/collab/socket.test.ts`. Esperado: FALLAN.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Ejecutar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat: epoch y autor en los lotes de operaciones`.

---

### Task 4: Copia previa a borrado masivo

**Files:**

- Create: `src/history/bulk-delete.ts`
- Modify: `src/collab/rooms.ts` (`apply`)
- Test: `tests/history/bulk-delete.test.ts`, `tests/collab/rooms.test.ts`

**Interfaces:**

- Consumes: constantes `BULK_*` (Task 1), `Op`, `Document`, `COLLS`.
- Produces:

  - `isBulkDelete(doc: Document, ops: readonly Op[]): boolean`. Cuenta las ops con `t === 'del'` sobre cualquier `coll` de `COLLS` (no `sdel`). Devuelve `deletes >= BULK_MIN_DELETES && (deletes >= BULK_DELETES || tableDeletes / max(1, doc.tables.length) >= BULK_TABLE_RATIO)`.
  - `RoomState.lastBulkSnapshotAt: number | null`.
  - En `apply`, **antes** de aplicar: si `isBulkDelete(room.doc, ops)` y pasaron ≥ `BULK_COOLDOWN_MS` desde la última, se marca `lastBulkSnapshotAt = now` y se lanza sin `await` un `projectSnapshot.create({ kind: 'pre_bulk_delete', diagram: room.doc, version: room.version, authors: [ctx.author] si hay, sizeBytes })`. El error se registra con `console.error`, nunca se lanza.
  - `RoomManager` expone `async idle(): Promise<void>` (espera las escrituras en segundo plano pendientes) para las pruebas.

- [ ] **Step 1: Pruebas que fallan** (`bulk-delete.test.ts`, pura):
  - 1 `del` → false; 2 `del` de 10 tablas → false; 2 `del` de tablas en un doc con 6 tablas → true (33 %); 5 `del` de notas → true; 4 `sdel` → false.
- [ ] **Step 2: Pruebas que fallan** (`rooms.test.ts`): `'guarda una copia pre_bulk_delete con el documento anterior al borrado'` → doc con 6 tablas, lote de 6 `del`, `await rooms.idle()` → existe 1 copia `pre_bulk_delete` cuyo `diagram.tables` tiene 6; un segundo lote masivo inmediato no crea otra.
- [ ] **Step 3:** Ejecutar. Esperado: FALLAN.
- [ ] **Step 4:** Implementar.
- [ ] **Step 5:** Ejecutar `npm test`. Esperado: PASS. Commit `feat: copia de seguridad antes de borrados masivos`.

---

### Task 5: Poda de retención y temporizador

**Files:**

- Create: `src/history/prune.ts`, `src/history/scheduler.ts`
- Modify: `src/index.ts`
- Test: `tests/history/prune.test.ts`

**Interfaces:**

- Produces:

  - `pruneSnapshots(db: PrismaClient, now: Date): Promise<number>` (filas borradas). Cuatro `DELETE` con `$executeRaw` en una transacción:
    1. `auto` con `created_at` entre `now-30d` y `now-48h`: se conserva la `row_number() = 1` por `(project_id, date_trunc('day', created_at))` ordenando por `created_at desc, id desc`.
    2. `auto` entre `now-183d` y `now-30d`: igual con `date_trunc('week', created_at)` (semana ISO en Postgres).
    3. `auto` con `created_at < now-183d`: se borran.
    4. `pre_restore` y `pre_bulk_delete` con `created_at < now-30d`: se borran.
       `named` no aparece en ningún `WHERE`.
  - `startHistoryPruning(db: PrismaClient, opts?: { intervalMs?: number; now?: () => Date }): () => void`: ejecuta una vez al arrancar y luego cada `intervalMs` (por defecto `PRUNE_INTERVAL_MS`). Cada pasada va dentro de `db.$transaction` que primero llama `select pg_try_advisory_xact_lock(<constante bigint>)` y sale si devuelve false. Errores con `console.error`. Devuelve la función que para el temporizador (`clearInterval`), y el timer usa `.unref()`.
  - `index.ts` llama a `startHistoryPruning(prisma)` después de `ensureSuperadmin` y lo para en `shutdown`.

- [ ] **Step 1: Pruebas que fallan** (`prune.test.ts`, con `now` fijo `2026-06-15T12:00:00Z` e inserción directa de copias con `createdAt` explícito):
  - `'conserva todas las auto de las últimas 48 h'`: 3 copias hace 1 h, 10 h y 47 h → quedan 3.
  - `'entre 48 h y 30 días conserva la última de cada día'`: 3 copias el mismo día hace 5 días (08:00, 12:00, 18:00) → queda la de 18:00.
  - `'entre 30 días y 6 meses conserva la última de cada semana'`: 3 copias en la misma semana ISO hace ~60 días → queda la más reciente.
  - `'borra auto de más de 183 días'`.
  - `'nunca borra named'`: una `named` de hace 400 días sigue.
  - `'las copias de seguridad se conservan 30 días aunque haya una auto posterior el mismo día'`: `pre_bulk_delete` a las 08:00 y `auto` a las 18:00 de hace 10 días → quedan ambas; `pre_restore` de hace 31 días → se borra.
  - `'no mezcla proyectos'`: dos proyectos con una copia cada uno el mismo día → quedan las dos.
- [ ] **Step 2:** `npx vitest run tests/history/prune.test.ts`. Esperado: FALLAN.
- [ ] **Step 3:** Implementar `prune.ts`, `scheduler.ts` y el cableado.
- [ ] **Step 4:** Ejecutar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat: poda escalonada del historial`.

---

### Task 6: `peekDoc` y `restore` en `RoomManager`

**Files:**

- Modify: `src/collab/rooms.ts`
- Modify: `src/history/types.ts`
- Test: `tests/collab/rooms.test.ts`, `tests/collab/socket.test.ts`

**Interfaces:**

- Produces (en `types.ts`):
  ```ts
  export interface HistoryRooms {
    /** Documento vigente: el de memoria si la sala está cargada, si no el de la DB. */
    peekDoc(projectId: string): Promise<{ doc: unknown; version: number }>;
    restore(
      projectId: string,
      diagram: unknown,
      by: Author,
      snapshotCreatedAt: Date,
    ): Promise<{ version: number; epoch: number }>;
  }
  ```
  `RoomManager implements CollabHooks, HistoryRooms`. `peekDoc` no carga la sala ni toca `touchSeq`; si el proyecto no existe → `AppError('not_found')`.
- `restore`, en este orden:

  1. `ensureRoom`.
  2. **Síncrono:** `previous = room.doc`, `previousVersion = room.version`, `room.doc = normalizeDoc(diagram)`, `room.version += 1`, `room.epoch += 1`.
  3. `await prisma.projectSnapshot.create({ kind: 'pre_restore', diagram: previous, version: previousVersion, createdBy: by.id, authors: [...room.authors.values() como Author], sizeBytes })`.
  4. `await this.flushRoom(room)`.
  5. Emitir a `roomName(projectId)`: `'restored'` con `{ version, epoch, by, snapshotCreatedAt: ISO string }`.
  6. Si `getRoomSocketCount(projectId) === 0` → `void this.release(projectId)`.

- [ ] **Step 1: Pruebas que fallan:**
  - rooms: `'restore reemplaza el documento, sube epoch y versión, guarda pre_restore y persiste'` → tras `restore`, `join` devuelve el doc restaurado con `epoch: 1`; existe una copia `pre_restore` con el doc anterior y `createdBy` del usuario; `projects.diagram` en la DB es el restaurado.
  - rooms **(Review Focus 2)**: `'restore sin sala cargada funciona y libera la sala'` → sin `join` previo, `restore`; la DB queda restaurada y `rooms.isActive(id)` es false tras `await rooms.idle()` o un pequeño `sleep`.
  - rooms: `'peekDoc devuelve el doc en memoria sin cargar salas'`.
  - socket **(Review Focus 1)**: `'tras restaurar, un lote con el epoch anterior se rechaza y todos reciben restored'` → dos clientes unidos (`epoch 0`); `rooms.restore(...)`; ambos reciben `restored` con `epoch: 1`; un lote con `epoch: 0` recibe `stale_epoch`; un nuevo `join` devuelve el doc restaurado.
- [ ] **Step 2:** Ejecutar. Esperado: FALLAN.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Ejecutar `npm test`. Esperado: PASS.
- [ ] **Step 5:** Commit `feat: restaurar una versión desde la sala`.

---

### Task 7: API REST de historial

**Files:**

- Create: `src/history/schemas.ts`, `src/history/service.ts`, `src/history/routes.ts`
- Modify: `src/app.ts` (`AppDeps.history?: HistoryRooms`; montar `api.use('/projects/:id/history', historyRouter(deps))` **antes** de `/projects` solo si `deps.history` existe), `src/server.ts` (pasar `history: rooms`), `tests/helpers/app.ts` (`MakeAppOptions` acepta `history`)
- Test: `tests/history/routes.test.ts`

**Interfaces:**

- Consumes: `HistoryRooms` (Task 6), `getRole`, `requireAuth`, constantes.
- Produces (todas bajo `requireAuth`; router con `mergeParams: true`; `id` validado con `projectParams`, `snapshotId` con `z.uuid()`):

  - `GET /` `?cursor=<uuid>&limit=<1..100, default 50>` → `200 { items: SnapshotMeta[], nextCursor: string | null }`. Orden `createdAt desc, id desc`; paginación con `cursor` de Prisma + `skip: 1`. `select` explícito sin `diagram`; `createdBy` desde la relación `creator { id, name }`.
  - `GET /:snapshotId` → `200 { ...SnapshotMeta, diagram }`. Si la copia no es de ese proyecto → 404.
  - `POST /` `{ name }` → `201 SnapshotMeta`, con `kind: 'named'`, el doc de `peekDoc`, `createdBy` y `authors: []`. Con 100 `named` ya existentes → 409 `snapshot_limit`.
  - `PATCH /:snapshotId` `{ name }` → `200 SnapshotMeta`; solo `named`, si no → 404.
  - `DELETE /:snapshotId` → `204`; solo `named`, si no → 404.
  - `POST /:snapshotId/restore` → `200 { version, epoch }`, llamando a `history.restore(projectId, snapshot.diagram, {id, name}, snapshot.createdAt)`.
  - `HistoryService` recibe `{ prisma, history }` en el constructor y tiene un método por ruta. Comprobación de acceso: `getRole` null → `not_found`; escritura con `viewer` → `forbidden`.

- [ ] **Step 1: Pruebas que fallan** (`routes.test.ts`, con `makeApp({ history: new RoomManager(prisma, { saveDebounceMs: 60_000 }) })`, un admin, un editor y un viewer miembros, y un no miembro):
  - `'lista sin diagram, paginada y en orden descendente'`: 3 copias, `limit=2` → 2 items sin la clave `diagram`, `nextCursor` no nulo; la segunda página trae 1 y `nextCursor: null`.
  - `'un no miembro recibe 404 en todas las rutas'`.
  - `'un viewer lista y ve, pero recibe 403 al crear, renombrar, borrar y restaurar'`.
  - **(Review Focus 4)** `'una copia de otro proyecto responde 404 en ver, renombrar, borrar y restaurar'`.
  - `'crear una versión con nombre usa el documento vigente'`: nombre `'  Antes de v2  '` → se guarda `'Antes de v2'` y `kind: 'named'`; un nombre de 81 caracteres → 400.
  - `'con 100 versiones con nombre, crear otra responde 409 snapshot_limit'`.
  - `'renombrar o borrar una copia automática responde 404'`.
  - `'restaurar devuelve version y epoch y deja el proyecto restaurado'`.
- [ ] **Step 2:** `npx vitest run tests/history/routes.test.ts`. Esperado: FALLAN.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm test && npx tsc --noEmit && npm run lint`. Esperado: PASS.
- [ ] **Step 5:** Commit `feat: API de historial de versiones`.

---

### Task 8: Cliente API y agrupación por fecha (frontend)

**Files:**

- Create: `src/api/history.js`, `src/collab/historyGroups.js`
- Test: `src/collab/historyGroups.test.js`

**Interfaces:**

- Produces:

  - `src/api/history.js` (mismo estilo que `api/projects.js`): `list(projectId, cursor?)`, `get(projectId, snapshotId)`, `createNamed(projectId, name)`, `rename(projectId, snapshotId, name)`, `remove(projectId, snapshotId)`, `restore(projectId, snapshotId)`.
  - `groupHistory(items: {createdAt: string}[], now: Date): { key: 'today'|'yesterday'|'this_week'|'older', label?: string, items }[]`. Hora local; `this_week` son los últimos 7 días sin contar hoy ni ayer; `older` agrupa por día, con `label` = fecha `yyyy-MM-dd` (luxon, como `Versions.jsx`). Se conserva el orden de entrada.

- [ ] **Step 1: Pruebas que fallan:** con `now = 2026-10-23T15:00` local: un item a las 09:00 de hoy → grupo `today`; uno del 22 → `yesterday`; uno del 19 → `this_week`; dos del 10 → un solo grupo `older` con `label: '2026-10-10'` y 2 items; una lista vacía → `[]`.
- [ ] **Step 2:** `npx vitest run src/collab/historyGroups.test.js`. Esperado: FALLAN.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Ejecutar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat: cliente de historial y agrupación por fecha`.

---

### Task 9: `ProjectSession`: epoch, `restored` y previsualización

**Files:**

- Modify: `src/collab/ProjectSession.js`, `src/collab/CollabClient.js` (si hace falta)
- Test: `src/collab/ProjectSession.test.js`

**Interfaces:**

- Produces:

  - `this.epoch` se toma de la respuesta de `join`. Cada lote enviado lleva `epoch`: `send: (batch) => socket.emit("ops", { ...batch, epoch: this.epoch })`.
  - Un ack `{ ok: false, error: 'stale_epoch' }` ya provoca resync por `CollabClient.ack` (devuelve `"resync"`); no hace falta más.
  - El constructor acepta `onNotice` (opcional). Listener `restored: ({ by, snapshotCreatedAt })` → `this.endPreview()`, `this.onNotice?.({ type: "restored", by, snapshotCreatedAt })`, `this.join()`.
  - `startPreview(doc, meta)`: `this.preview = { doc, meta }`, `this.apply?.(doc, <documento mostrado actualmente>, false)`, `update({ preview: meta })`.
  - `endPreview()`: si no hay preview no hace nada; si no, aplica `this.editorDoc` sobre el doc de preview, limpia `this.preview` y `update({ preview: null })`.
  - Mientras `this.preview`: `observe` no hace nada; `rebase` y `join` actualizan `this.editorDoc` pero **no** llaman a `apply`; `sendAwareness` no emite; `canWrite()` devuelve false.
  - `state.preview: meta | null` (inicial `null`).

- [ ] **Step 1: Pruebas que fallan** (usando el `setup()` existente):
  - `'envía el epoch recibido en join con cada lote'`: `snapshot()` con `epoch: 3` en la respuesta → tras un cambio local, el `ops` emitido tiene `epoch: 3`.
  - **(Review Focus 3)** `'en previsualización los ops remotos se acumulan y se muestran al salir'`: `startPreview(otroDoc)`; llega un `ops` remoto con un campo nuevo; no hay llamada a `apply` con ese campo; `observe(otroDoc)` no emite `ops`; `sendAwareness` no emite; `endPreview()` aplica un doc que contiene el campo remoto.
  - **(Review Focus 5)** `'restored durante la previsualización sale de ella y hace join'`: `startPreview(...)`; `receive("restored", { by: {id:"u", name:"Ana"}, snapshotCreatedAt: "..." })` → `state.preview === null`, se emite un nuevo `join`, `onNotice` recibe `type: "restored"`; al responder el join se aplica con `reset === true`.
  - `'canWrite es false durante la previsualización'`.
- [ ] **Step 2:** `npx vitest run src/collab/ProjectSession.test.js`. Esperado: FALLAN.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Ejecutar `npm test`. Esperado: PASS.
- [ ] **Step 5:** Commit `feat: previsualización local y aviso de restauración en la sesión`.

---

### Task 10: Previsualización en el editor (provider, banner, cursores)

**Files:**

- Modify: `src/collab/ProjectCollabProvider.jsx`, `src/pages/ProjectEditor.jsx`, `src/collab/RemoteCursors.jsx`
- Create: `src/collab/PreviewBanner.jsx`
- Modify: `src/i18n/locales/es.js`, `en.js`

**Interfaces:**

- Consumes: `startPreview`, `endPreview`, `state.preview`, `onNotice` (Task 9); `history.get`, `history.restore` (Task 8).
- Produces:

  - `useProjectCollab()` añade `preview` (meta o null), `previewSnapshot(snapshotId: string): Promise<void>` (descarga con `history.get` y llama a `startPreview(doc, meta)`) y `endPreview()`.
  - `onNotice` muestra `Toast.info(t("history_restored_by", { name, time }))`, con `time` en formato `HH:mm` o `dd/MM HH:mm` si no es de hoy.
  - `ProjectEditor`: `readOnly` también es `true` si `preview`; `PreviewBanner` se pinta en la misma posición que el aviso de estado.
  - `PreviewBanner`: texto `t("history_preview_banner", { time })` y botones `t("history_back_to_current")` → `endPreview()`, y `t("history_restore")` (solo si el rol es `admin` o `editor`) → `Modal.confirm` con `t("history_restore_confirm")` → `history.restore(projectId, meta.id)`; si falla, `Toast.error(t("history_restore_failed"))`.
  - `RemoteCursors` no pinta nada si hay `preview`.
  - Claves i18n (es / en):
    - `history`: "Historial" / "History"
    - `history_preview_banner`: "Viendo la versión de {{time}} · solo lectura · los demás no ven esto" / "Viewing the version from {{time}} · read-only · others don't see this"
    - `history_back_to_current`: "Volver a la actual" / "Back to current"
    - `history_restore`: "Restaurar esta versión" / "Restore this version"
    - `history_restore_confirm`: "Esto reemplaza el diagrama para todos. Se guardará una copia del estado actual." / "This replaces the diagram for everyone. A copy of the current state will be saved."
    - `history_restored_by`: "{{name}} restauró la versión de {{time}}" / "{{name}} restored the version from {{time}}"
    - `history_restore_failed`: "No se pudo restaurar la versión" / "Could not restore the version"

- [ ] **Step 1:** Implementar.
- [ ] **Step 2:** `npm run lint && npm test && npm run build`. Esperado: sin errores ni warnings.
- [ ] **Step 3: Verificación manual** (backend y frontend en local, dos navegadores): con la previsualización activa en A, el lienzo de A no se puede editar, el de B no cambia, y los cursores de B no aparecen en A; "Volver a la actual" en A muestra lo que B editó mientras tanto.
- [ ] **Step 4:** Commit `feat: modo de previsualización de versiones en el editor`.

---

### Task 11: Panel de historial

**Files:**

- Create: `src/collab/HistoryPanel.jsx`
- Modify: `src/pages/ProjectEditor.jsx` (extensión `"versions-panel": <HistoryPanel />`), `src/components/EditorHeader/ControlPanel.jsx:2404` (mostrar el botón de versiones también en modo proyecto, con tooltip `t("history")` en ese modo), `src/components/EditorHeader/SideSheet/Sidesheet.jsx` (título `t("history")` en modo proyecto), `src/i18n/locales/es.js`, `en.js`

**Interfaces:**

- Consumes: `groupHistory`, `api/history.js` (Task 8); `previewSnapshot`, `preview`, `role`, `peers` (Task 10).
- Produces: panel según el boceto aprobado (`.superpowers/brainstorm/74284-1792788888/content/historial.html`):

  - Botón "+ Guardar versión" (`admin`/`editor`) → `Modal` con `Input` (máx. 80) → `createNamed`; si la respuesta es `snapshot_limit` → `Toast.error(t("history_named_limit"))`. Después recarga la primera página.
  - Fila fija "Versión actual" con los nombres de `peers`.
  - Grupos de `groupHistory` con cabeceras `t("today")`, `t("yesterday")`, `t("history_this_week")` o `label`.
  - Cada fila muestra la hora `HH:mm`, los `authors` unidos por coma (o `createdBy` si no hay), la etiqueta según `kind` (`named` → "★ " + nombre; `pre_bulk_delete` → `t("history_kind_pre_bulk_delete")`; `pre_restore` → `t("history_kind_pre_restore")`) y se resalta si es la previsualizada. Al hacer clic → `previewSnapshot(id)`.
  - Las filas `named` tienen un menú (`Dropdown`) con renombrar y borrar (`admin`/`editor`); borrar pide confirmación.
  - "Cargar más" con `nextCursor` (botón al final; no hace falta scroll infinito automático).
  - La lista se recarga al abrir el panel y al recibir un aviso `restored`.
  - Claves i18n nuevas (es / en): `history_save_version` "Guardar versión" / "Save version"; `history_version_name` "Nombre de la versión" / "Version name"; `history_current` "Versión actual" / "Current version"; `history_this_week` "Esta semana" / "This week"; `history_kind_pre_bulk_delete` "Copia previa a borrado masivo" / "Before bulk delete"; `history_kind_pre_restore` "Antes de restaurar" / "Before restore"; `history_named_limit` "Se alcanzó el máximo de 100 versiones con nombre" / "Reached the limit of 100 named versions"; `history_load_more` "Cargar más" / "Load more"; `history_rename` "Renombrar" / "Rename"; `history_delete_confirm` "¿Borrar esta versión con nombre?" / "Delete this named version?"; `history_empty` "Aún no hay versiones guardadas" / "No saved versions yet". Reutilizar `today` y `yesterday` si ya existen en las locales; si no, añadirlas.

- [ ] **Step 1:** Implementar.
- [ ] **Step 2:** `npm run lint && npm test && npm run build`. Esperado: sin errores ni warnings.
- [ ] **Step 3: Verificación manual** (dos usuarios, editor y viewer):
  - el viewer ve la lista y previsualiza, pero no ve "Guardar versión" ni "Restaurar";
  - el editor guarda "Antes de v2", borra 6 tablas, ve la copia previa al borrado masivo en la lista, la restaura, y ambos ven el aviso y las tablas de vuelta;
  - "Antes de restaurar" aparece arriba y restaurarla deshace la restauración.
- [ ] **Step 4:** Commit `feat: panel de historial de versiones`.

---

### Task 12: Cierre

**Files:**

- Modify: `.gitignore` del frontend (añadir `.superpowers/brainstorm/`)
- Modify: `docs/superpowers/specs/2026-10-23-historial-versiones-design.md` solo si algo cambió durante la implementación (anotarlo en una sección "Cambios durante la implementación").

- [ ] **Step 1:** Añadir la entrada a `.gitignore` y comprobar con `git check-ignore .superpowers/brainstorm/x`.
- [ ] **Step 2:** Backend: `npm run lint && npx tsc --noEmit && npm test`. Frontend: `npm run lint && npm test && npm run build`. Todo en verde.
- [ ] **Step 3:** Commit `chore: ignorar bocetos de brainstorming`.
