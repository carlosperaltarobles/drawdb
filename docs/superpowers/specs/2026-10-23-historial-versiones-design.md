# Historial de versiones por proyecto — Diseño

Fecha: 2026-10-23 · Repos: `drawdb` (frontend) y `drawdb-server` (backend)

## 1. Intención

Los proyectos ya se editan en tiempo real entre varias personas. Todavía no ha pasado ningún incidente, pero puede pasar que alguien borre todo o haga cambios de los que luego no se acuerde. El dueño quiere un **historial de versiones por proyecto**, parecido al de draw.io: ver versiones anteriores, previsualizarlas y volver a una de ellas.

Condición del dueño: debe ser **óptimo**. No puede afectar al rendimiento del editor ni cargar mucho la base de datos.

## 2. Objetivos

- Ver, dentro del editor, la lista de versiones anteriores del proyecto: fecha, hora y quién editó en ese intervalo.
- Previsualizar cualquier versión en solo lectura, sin afectar a los demás.
- Restaurar una versión: el diagrama cambia para todos en tiempo real.
- Guardar versiones a mano con nombre ("Antes de la migración v2"), que nunca se borran solas.
- Que un borrado masivo siempre sea recuperable, aunque la última copia automática sea de hace casi 10 minutos.

## 3. Fuera de alcance

- Ver las diferencias entre versiones (qué tabla o campo cambió). Se puede añadir más adelante; ya existe `Migration.jsx` en el flujo de gists como referencia.
- Historial a nivel de operación (cada movimiento o cada tecla).
- Exportar o descargar una versión concreta (se puede restaurar y exportar).
- Recuperar proyectos borrados. Al borrar un proyecto sus copias se borran en cascada, igual que hoy.

## 4. Anti-objetivos (fracaso aunque "funcione")

- Que el editor vaya más lento o que la DB reciba escrituras por cada operación.
- Que la tabla de copias crezca sin límite.
- Que restaurar por error no se pueda deshacer.
- Que previsualizar una versión cambie el lienzo de otra persona o cuente como edición.
- Que la lista de versiones descargue el JSON completo de cada copia.

## 5. Lo que ya existe (punto de partida)

- `drawdb-server/prisma/schema.prisma`: modelo `ProjectSnapshot` (`id`, `projectId`, `diagram` JSONB, `version`, `createdAt`) con índice `(projectId, createdAt desc)`.
- `drawdb-server/src/collab/rooms.ts` → `runSaveLoop`: el documento vive en memoria y se guarda con debounce de unos 2 s. **Dentro de esa misma transacción** se crea una copia como máximo cada 10 min (`snapshotIntervalMs`), y se borran las que superan 200 (`snapshotKeep`) con un `findMany` + `deleteMany` en cada copia.
- `lastSnapshotAt` vive solo en memoria y empieza en `null`. Por eso se crea una copia en el primer guardado tras cargar la sala; se mantiene ese comportamiento.
- No hay UI, ni API para listar o restaurar, ni registro de autores.
- Frontend: `ControlPanel.jsx` tiene un botón "Versiones" (`SIDESHEET.VERSIONS`, basado en gists) que **se oculta en modo proyecto**. El nuevo historial ocupa ese lugar en modo proyecto, como un `SideSheet` más.
- Los permisos por proyecto son `editor` y `viewer` (`ProjectRole`), y además están los admins y el superadmin.

## 6. Decisiones del dueño

- Historial como el de draw.io: lista, previsualización y restauración. Aprobó el boceto (panel a la derecha y modo de previsualización con barra superior).
- Retención escalonada (propuesta mía, aceptada): todo lo de las últimas 48 h, uno por día hasta 30 días, uno por semana hasta 6 meses, y lo más antiguo se borra.
- Versiones con nombre guardadas a mano, que no se borran solas (propuesta mía, aceptada).
- Quién restaura: el dueño pidió asesoría y aceptó la propuesta: **editores y admins restauran; los viewers solo ven el historial y previsualizan.** Antes de restaurar se guarda siempre una copia del estado actual.
- Copia automática antes de un cambio grande, como un borrado masivo (propuesta mía, aceptada).

## 7. Diseño

### 7.1 Datos (Prisma, una migración)

Se amplía `ProjectSnapshot` en lugar de crear otra tabla:

| Campo       | Tipo                                                                   | Para qué                                                                                               |
| ----------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `kind`      | enum `SnapshotKind`: `auto`, `named`, `pre_restore`, `pre_bulk_delete` | Origen de la copia y reglas de retención                                                               |
| `name`      | `String?`                                                              | Solo en `named`                                                                                        |
| `createdBy` | `String? @db.Uuid` → `User`, `onDelete: SetNull`                       | Quién creó la copia a mano o quién restauró (`named`, `pre_restore`)                                   |
| `authors`   | `Json` (JSONB, array de `{ id, name }`)                                | Quién editó desde la copia anterior. Se guarda el nombre para que siga viéndose si el usuario se borra |
| `sizeBytes` | `Int?`                                                                 | Tamaño aproximado del JSON, para vigilar el crecimiento sin leer el diagrama                           |

Las filas existentes pasan a `kind = auto` con `authors = []`.

### 7.2 Copias automáticas sin coste extra

- Se mantiene el mecanismo actual: la copia se escribe **en la misma transacción del guardado** con debounce, como máximo cada 10 min y solo si hubo cambios. No se hace ninguna escritura nueva por operación.
- **Autores:** cada sala guarda en memoria un `Map<userId, name>` de quién aplicó operaciones desde la última copia. Se rellena en `apply()` (la operación ya pasa por ahí con el usuario del socket; habrá que pasarle el usuario). Al crear la copia se guarda en `authors` y se vacía.
- **Se quita la poda de cada copia** (`findMany` + `deleteMany` con `snapshotKeep`). La retención pasa a un proceso aparte (§7.4).

### 7.3 Copia previa a un borrado masivo

- Cuando un lote de operaciones (`ops`) borra entidades de primer nivel (`del` en `tables`, `relationships`, `notes`, `areas`, `views`, `enums`, `types`) por encima de un umbral, el servidor guarda **antes de aplicarlo** una copia `pre_bulk_delete` del documento en memoria.
- Umbral (decisión mía, configurable): **5 o más entidades borradas en un mismo lote, o el 30 % o más de las tablas del proyecto**. En cualquier caso hace falta borrar al menos 2 elementos.
- Se escribe en segundo plano, sin bloquear el envío de la operación a la sala. Se limita a una cada 60 s por proyecto para que un "borrar todo" en ráfagas no genere decenas de copias.
- Si en el futuro existe una operación de "reemplazar documento" (importar JSON), cuenta también como cambio grande.

### 7.4 Retención (proceso en segundo plano)

- Un temporizador en el servidor (por ejemplo, cada 6 h y una vez al arrancar, con un bloqueo de Postgres `pg_try_advisory_lock` para que no corra dos veces si un día hay varias instancias) poda las copias **`auto`**:
  - **Menos de 48 h:** se conservan todas.
  - **De 48 h a 30 días:** se conserva la más reciente de cada día (en la zona horaria del servidor, decisión mía).
  - **De 30 días a 6 meses:** se conserva la más reciente de cada semana ISO.
  - **Más de 6 meses:** se borran.
- **Copias de seguridad (`pre_restore` y `pre_bulk_delete`), decisión mía:** no compiten con las `auto` por el "una por día o semana". Si compitieran, la copia previa al borrado perdería frente a una `auto` posterior del mismo día, que ya tiene el estado borrado. Se conservan **todas durante 30 días** y después se borran.
- Las `named` nunca se podan. Solo se borran a mano (§7.5) o al borrar el proyecto.
- La poda debe hacerse con SQL por lotes (`DELETE ... WHERE id IN (subconsulta con ventanas por proyecto/día/semana)`), no cargando filas en Node. Se procesan por proyecto o por lotes limitados para no bloquear tablas grandes.
- Resultado esperado: como mucho unas 290 copias automáticas en las primeras 48 h (en la práctica bastantes menos, porque solo hay copia si se editó), más unas 28 diarias y unas 22 semanales por proyecto activo.

### 7.5 API (REST, en `src/projects/`, capas ruta → servicio → datos como el resto)

Todas requieren sesión y pertenecer al proyecto (miembro o admin), reutilizando `getRole`.

| Método y ruta                                        | Quién             | Qué hace                                                                                                                                                  |
| ---------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /projects/:id/history?cursor=&limit=`           | cualquier miembro | Lista **sin `diagram`**: `id, kind, name, createdAt, createdBy{id,name}, authors, sizeBytes`. Paginada por cursor (`createdAt`, `id`), unas 50 por página |
| `GET /projects/:id/history/:snapshotId`              | cualquier miembro | Devuelve `{ diagram, ...metadatos }` de una copia, para previsualizar                                                                                     |
| `POST /projects/:id/history` `{ name }`              | editor o admin    | Crea una versión `named` con el documento **actual en memoria** (o el de la DB si la sala no está cargada). Nombre de 1 a 80 caracteres                   |
| `PATCH /projects/:id/history/:snapshotId` `{ name }` | editor o admin    | Renombra una `named`                                                                                                                                      |
| `DELETE /projects/:id/history/:snapshotId`           | editor o admin    | Borra una `named` (las automáticas no se borran a mano)                                                                                                   |
| `POST /projects/:id/history/:snapshotId/restore`     | editor o admin    | Restaura (§7.6)                                                                                                                                           |

La lista "Versión actual" del panel no es una fila: la pinta el frontend.

### 7.6 Restaurar

Todo pasa en el servidor, en `RoomManager`, para que sea atómico respecto a las operaciones en vuelo:

1. Se carga la sala si no está en memoria (`ensureRoom`).
2. Se guarda una copia `pre_restore` del documento actual en memoria, con `createdBy` = quien restaura y los autores acumulados.
3. Se reemplaza `room.doc` por el diagrama de la copia (pasado por `normalizeDoc`), se incrementa `version` y se fuerza el guardado (`flushRoom`).
4. Se emite a la sala un evento nuevo `restored` con `{ doc, version, by: { id, name }, snapshotCreatedAt }`.
5. Clientes al recibir `restored`: reemplazan el estado completo como en la entrada a la sala (`isApplyingRemoteRef`), **vacían su pila de deshacer/rehacer** (las operaciones inversas antiguas ya no tienen sentido), descartan operaciones pendientes sin confirmar y muestran un aviso: "Carlos restauró la versión de las 12:40". Si alguien estaba previsualizando, sale de la previsualización.
6. Para deshacer una restauración, se restaura la copia `pre_restore` que aparece arriba en la lista.

**Operaciones en vuelo (decisión mía):** hoy el servidor aplica cualquier lote `ops` sobre `room.doc` sin comprobar contra qué versión se construyó (`socket.ts`, `{ seq, ops }`). Un lote enviado justo antes de recibir `restored` reviviría entidades o pisaría valores restaurados. Para que **la restauración gane**:

- Cada sala lleva un contador `epoch` en memoria que empieza en 0 y aumenta en cada restauración. No hace falta persistirlo: al recargar la sala todos los clientes vuelven a hacer `join`.
- `join` y `restored` devuelven el `epoch` actual. El cliente lo incluye en cada lote: `{ seq, epoch, ops }`.
- Si el lote trae un `epoch` distinto al de la sala, el servidor responde `ack { ok: false, error: 'stale_epoch' }` sin aplicarlo, y el cliente hace resync (el mismo camino que `join`, que ya vacía deshacer/rehacer en `CollabBridge`).
- Si el lote **no trae** `epoch` (una pestaña abierta con el frontend anterior al despliegue), se acepta como hoy. Así esas pestañas no pierden ediciones en bucle; solo conservan la pequeña ventana de carrera hasta que recarguen.

### 7.7 Frontend

- **Botón:** en `ControlPanel.jsx`, en modo proyecto, el hueco del botón "Versiones" abre el nuevo `SideSheet` "Historial". También aparece en el menú.
- **Panel (según el boceto aprobado):**
  - Botón "+ Guardar versión" (solo editores y admins), que pide el nombre en un modal.
  - Lista agrupada por Hoy / Ayer / Esta semana / fechas anteriores. Cada fila muestra la hora, los autores, la etiqueta del tipo (★ con nombre, "copia previa a borrado masivo", "antes de restaurar") y el nombre si lo tiene.
  - Arriba, una fila fija "Versión actual" con las personas conectadas.
  - Scroll infinito con el cursor de la API.
  - Las versiones con nombre tienen menú para renombrar o borrar (editores y admins).
- **Previsualización:**
  - Al elegir una fila se descarga su `diagram` y el lienzo pasa a **solo lectura local**, mostrando esa versión.
  - Hay una barra superior: "Viendo la versión de hoy 12:40 · solo lectura · los demás no ven esto" con los botones "Volver a la actual" y "Restaurar esta versión" (solo editores y admins).
  - Mientras dura la previsualización, las operaciones remotas que lleguen **se siguen aplicando a un documento en segundo plano** (o se marca para hacer resync al salir) para que "Volver a la actual" muestre el estado real. Se elige lo más simple que sea correcto.
  - No se emiten operaciones ni awareness de edición desde la previsualización. Los cursores remotos se ocultan.
- **Restaurar:** confirmación ("Esto reemplaza el diagrama para todos. Se guardará una copia del estado actual") y llamada a la API. El resultado llega por el evento `restored` igual que al resto.
- Textos en español en i18n, siguiendo el resto de la app.

### 7.8 Rendimiento y límites

- No se añade ninguna escritura por operación. Las automáticas siguen en la misma transacción del guardado, y las de borrado masivo se escriben en segundo plano y con límite.
- La lista nunca lee `diagram` (`select` explícito con Prisma). El índice existente `(projectId, createdAt desc)` cubre la consulta.
- Postgres ya comprime (TOAST) los JSONB grandes. No se añade compresión propia.
- La poda corre fuera del camino de guardado.
- Límite de copias `named` por proyecto (decisión mía): 100, para evitar abusos. Al llegar al límite se pide borrar alguna.

### 7.9 Pruebas mínimas

- Servidor: que la copia automática registre autores; el umbral y el límite de frecuencia de `pre_bulk_delete`; las reglas de retención con fechas simuladas (las `named` nunca se borran); los permisos de cada ruta (un viewer no puede restaurar ni crear); que restaurar cree la `pre_restore`, reemplace el documento, emita `restored` y persista.
- Cliente: al recibir `restored` se reemplaza el estado y se vacía deshacer/rehacer; la previsualización no emite operaciones y al volver muestra el documento actualizado.

## 8. Lo que queda a criterio del constructor

- Cómo pasar el usuario a `RoomManager.apply()` sin acoplarlo más de la cuenta.
- La forma exacta del SQL de poda y la frecuencia del temporizador (con el límite de no tocar el camino caliente).
- Cómo aislar el estado de la previsualización en los contextos de React (por ejemplo, un modo "readOnly + documento alternativo" en `useLayout`, o un lienzo aparte).
- Valores por defecto configurables por variables de entorno (intervalo de copia, umbrales, límite de `named`), siguiendo `src/config`.
- Añadir `.superpowers/` al `.gitignore` del frontend (hoy no está).
