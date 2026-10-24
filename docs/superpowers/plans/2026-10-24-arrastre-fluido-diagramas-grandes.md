# Arrastre y redimensionado fluidos en diagramas grandes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Ejecución acordada con el dueño:** cada tarea la implementa **una instancia de Cline CLI**. Las tareas de una misma oleada corren **en paralelo**, cada una en su propio git worktree. Claude revisa cada diff, ejecuta las pruebas e integra en `feat/arrastre-fluido` antes de lanzar la siguiente oleada. Ver «Ejecución en paralelo» al final.

**Goal:** Que mover (solo o hasta 20 tablas) y redimensionar el ancho de tablas sea fluido en el proyecto «Load Test 200 Entities», sin cambiar colaboración, undo/redo ni backend.

**Architecture:** La detección de ciclos pasa a una función pura lineal (`findCircularTableIds`). Una comparación pura «igual salvo `x`, `y`, `width`» (`src/utils/layoutFields.js`) permite que el panel «Problems» y la lista lateral reutilicen su resultado/render mientras solo cambian posiciones o anchos. Un script de Playwright mide antes/después contra el build de producción.

**Tech Stack:** React 18, Vite, Semi UI, @dnd-kit, i18next, vitest (entorno `node`, sin DOM), playwright-core (solo script de medición).

**Spec:** `docs/superpowers/specs/2026-10-24-arrastre-fluido-diagramas-grandes-design.md` (léelo antes de cada tarea).

## Global Constraints

- Solo frontend (`/home/carlos/Proyectos/drawdb`). No tocar `drawdb-server`, el formato del diagrama, `src/collab/**`, `DiagramContext.jsx`, ni el undo/redo de arrastre (`handlePointerUp` en `Canvas.jsx`) o de ancho (`commitResize` en `Table.jsx`).
- `updateTable` sigue llamándose en cada `pointermove`; la colaboración sigue enviando en lotes de 50 ms (los compañeros ven el movimiento en vivo).
- Campos de «layout» que se ignoran: exactamente `x`, `y`, `width`. Ningún otro (`hidden`, `collapsed`, `color`, `comment`, `fields`, `name`… sí cuentan).
- `getIssues` conserva todas sus comprobaciones; solo cambia la de dependencias circulares: mensaje `circular_dependency` una vez por tabla donde se cierra un ciclo, orden determinista (orden de `diagram.tables`, luego de `diagram.relationships`), relaciones de una tabla consigo misma ignoradas.
- Código limpio, sin comentarios que narren el cambio; nombres en inglés en el código, como el resto del repo.
- Commits sin `Co-Authored-By` ni créditos de IA. Sin merge a `main` ni push.
- `npm test && npm run lint` deben pasar al final de cada tarea.

## Review Focus

1. Relaciones que apuntan a una tabla inexistente (id colgante) → la detección de ciclos no falla y no inventa mensajes.
2. Diagrama con una cadena muy larga (5.000 tablas en fila) → sin desbordar la pila (recorrido iterativo).
3. Cambiar `hidden`, `collapsed`, nombre o un campo de una tabla mientras otra se arrastra → el panel «Problems» y la lista lateral sí se actualizan.
4. Reordenar tablas en la lista lateral (dnd-kit) o añadir/borrar una tabla → la lista refleja el nuevo orden/número (el `memo` no deja filas obsoletas).
5. Deshacer tras arrastrar 20 tablas → todas vuelven; el script de medición comprueba que el proyecto queda igual.

---

### Task 1: Detección de ciclos lineal

**Files:**

- Modify: `src/utils/issues.js` (sustituir `checkCircularRelationships` y su bucle, ~líneas 308–335)
- Create: `src/utils/circularTables.js`
- Test: `src/utils/circularTables.test.js`

**Interfaces:**

- Produces: `findCircularTableIds(tables: {id}[], relationships: {startTableId, endTableId}[]) => id[]` — ids de tabla donde se cierra un ciclo, sin repetidos, en orden determinista.
- `getIssues` usa: `findCircularTableIds(diagram.tables, diagram.relationships).forEach(id => issues.push(i18n.t("circular_dependency", { refName: tablesById.get(id)?.name })))`.

- [ ] **Step 1: Pruebas que fallan** en `src/utils/circularTables.test.js` (vitest, sin i18n):
  - `sin ciclos devuelve []`: A→B, B→C ⇒ `[]`.
  - `ciclo simple`: A→B, B→A ⇒ `["A"]`.
  - `ciclo largo`: A→B→C→D→A ⇒ `["A"]`.
  - `ciclos que comparten tablas no repiten`: A→B, B→A, B→C, C→B, C→A ⇒ resultado sin duplicados y `toEqual(["A","B"])` (DFS desde A: B→A cierra en A; C→B cierra en B; C→A ya reportado).
  - `auto-relación ignorada`: A→A ⇒ `[]`.
  - `id colgante`: A→X (X no existe), X→A ⇒ no lanza; resultado `[]` (X no es tabla y no se recorre).
  - `determinista`: misma entrada dos veces ⇒ mismo arreglo.
  - `cadena larga`: 5.000 tablas `t0→t1→…→t4999→t0` ⇒ `["t0"]`, sin `RangeError`.
  - `grafo grande rápido`: generador con semilla fija (LCG simple en el test) de 200 tablas y 250 relaciones aleatorias ⇒ `performance.now()` < 50 ms.
- [ ] **Step 2:** `npx vitest run src/utils/circularTables.test.js` ⇒ FAIL (módulo no existe).
- [ ] **Step 3: Implementar** `findCircularTableIds` en `src/utils/circularTables.js`: índice `Map(startTableId → endTableId[])` en orden de `relationships` (omitiendo auto-relaciones), `Set` de ids de tablas válidas, estados blanco/gris/negro, DFS **iterativo** con pila explícita `[id, nextEdgeIndex]`, recorriendo raíces en orden de `tables`. Arista a nodo gris ⇒ añadir destino al resultado si no estaba. Destinos que no son tabla se ignoran.
- [ ] **Step 4:** En `src/utils/issues.js` sustituir la función recursiva y su bucle por la llamada de «Interfaces» (construir `tablesById` una vez). Eliminar `visitedTables`.
- [ ] **Step 5:** `npx vitest run src/utils/circularTables.test.js && npm test && npm run lint` ⇒ PASS.
- [ ] **Step 6: Commit**

```bash
git add src/utils/circularTables.js src/utils/circularTables.test.js src/utils/issues.js
git commit -m "perf: detección de dependencias circulares en tiempo lineal"
```

---

### Task 2: Comparación sin layout y panel «Problems»

**Files:**

- Create: `src/utils/layoutFields.js`
- Create: `src/hooks/useLayoutStable.js`
- Modify: `src/components/EditorSidePanel/Issues.jsx:1-40`
- Test: `src/utils/layoutFields.test.js`

**Interfaces:**

- Produces (para Task 3):

  - `LAYOUT_FIELDS = ["x", "y", "width"]`
  - `sameIgnoringLayout(a: object, b: object) => boolean` — `true` si `a === b`, o si tienen el mismo conjunto de claves y todas las claves fuera de `LAYOUT_FIELDS` son `===`.
  - `tablesSameIgnoringLayout(a: object[], b: object[]) => boolean` — misma longitud y `sameIgnoringLayout` posición a posición.
  - `useLayoutStable(tables) => tables` (en `src/hooks/useLayoutStable.js`, export default) — devuelve la referencia anterior mientras `tablesSameIgnoringLayout(prev, tables)`; si no, guarda y devuelve `tables`.

- [ ] **Step 1: Pruebas que fallan** en `src/utils/layoutFields.test.js`:
  - mismo objeto ⇒ `true`; `{...t, x: 5}`, `{...t, y: 5}`, `{...t, width: 300}` ⇒ `true`.
  - `{...t, name: "n"}`, `{...t, hidden: true}`, `{...t, collapsed: true}`, `{...t, comment: "c"}`, `{...t, color: "#fff"}`, `{...t, fields: [...t.fields]}` ⇒ `false`.
  - clave añadida (`{...t, extra: 1}`) o quitada ⇒ `false`.
  - arrays: distinta longitud ⇒ `false`; mismo contenido reordenado ⇒ `false`; solo cambia `x` de un elemento ⇒ `true`.
- [ ] **Step 2:** `npx vitest run src/utils/layoutFields.test.js` ⇒ FAIL.
- [ ] **Step 3:** Implementar `src/utils/layoutFields.js` y `src/hooks/useLayoutStable.js` (un `useRef`; sin efectos).
- [ ] **Step 4:** En `Issues.jsx`: `const stableTables = useLayoutStable(tables);` y `const issues = useMemo(() => getIssues({ tables: stableTables, relationships, types, database, enums, views }), [stableTables, relationships, types, database, enums, views]);`. Quitar `useState`/`useEffect`/`arrayIsEqual` de este archivo.
- [ ] **Step 5:** `npm test && npm run lint` ⇒ PASS.
- [ ] **Step 6: Commit**

```bash
git add src/utils/layoutFields.js src/utils/layoutFields.test.js src/hooks/useLayoutStable.js src/components/EditorSidePanel/Issues.jsx
git commit -m "perf: el panel de problemas ignora cambios de posición y ancho"
```

---

### Task 3: La lista lateral no se redibuja por posición ni ancho

**Depende de Task 2** (oleada 2).

**Files:**

- Modify: `src/components/EditorSidePanel/TablesTab/TablesTab.jsx`
- Modify: `src/components/SortableList/SortableList.jsx`

**Interfaces:**

- Consumes: `sameIgnoringLayout` de `src/utils/layoutFields.js`.
- Produces: `SortableList` acepta prop opcional `isItemEqual(prevItem, nextItem) => boolean` (por defecto `(a, b) => a === b`). Los demás usos de `SortableList` no cambian.

- [ ] **Step 1: `SortableList.jsx`:**
  - `SortableContext` recibe un arreglo de ids memoizado que solo cambia cuando cambian los ids o su orden (p. ej. `useMemo` sobre `items.map(i => i.id).join("\u0000")`), en lugar de `items`.
  - Cada fila se dibuja con un componente interno `memo` que recibe `item`, `index`, `renderItem` y `isItemEqual`, y que solo se vuelve a dibujar si cambia `index`, `renderItem` o `!isItemEqual(prev.item, next.item)`. Dentro sigue envolviendo con `SortableItem`.
  - `handleDragEnd` sigue usando `items` actuales (ref o closure actual) para reordenar.
- [ ] **Step 2: `TablesTab.jsx`:**
  - `TableListItem` deja de llamar a `useDiagram`, `useUndoRedo`, `useFocus` y `useLocateTable`. Recibe por props callbacks **estables**: `onToggleHidden(table)`, `onLocate(id)`, `onOpenRelated(id)`, `onFocus(id)`.
  - `TablesTab` crea esos callbacks con `useCallback([])` que leen las funciones actuales desde un `useRef` actualizado en cada render (patrón «latest ref»), y conserva la lógica actual de `toggleTableVisibility` (entrada de undo `[hidden]` incluida).
  - `renderItem` pasado a `SortableList` es estable (`useCallback`) y se pasa `isItemEqual={sameIgnoringLayout}`.
  - `TableInfo` (panel abierto) sigue recibiendo la tabla actual; como está dentro de la fila, debe actualizarse cuando cambian datos no-layout de **su** tabla. Si el editor abierto muestra algo que dependa de `x/y/width`, no aplica: no lo muestra.
- [ ] **Step 3: Verificación manual en `npm run dev`** (proyecto con pocas tablas basta): reordenar tablas en la lista funciona; ojito oculta/muestra y se puede deshacer; «Ubicar», «Relacionadas» y «Enfocar» funcionan; renombrar una tabla en el lienzo se refleja en la lista; añadir y borrar tabla se refleja.
- [ ] **Step 4:** `npm test && npm run lint` ⇒ PASS.
- [ ] **Step 5: Commit**

```bash
git add src/components/EditorSidePanel/TablesTab/TablesTab.jsx src/components/SortableList/SortableList.jsx
git commit -m "perf: la lista de tablas no se redibuja al mover o redimensionar"
```

---

### Task 4: Script de medición

**Files:**

- Create: `scripts/perf/drag-resize.mjs`
- Modify: `package.json`, `package-lock.json` (devDependency `playwright-core@1.48.2`, la versión que coincide con el Chromium `chromium-1140` ya descargado)

**Interfaces:**

- Uso: `node scripts/perf/drag-resize.mjs` con variables opcionales `BASE` (def. `http://localhost:4173`), `PROJECT_ID` (def. `01a164ff-0000-7000-8000-000000000200`), `SERVER_ENV` (def. `/home/carlos/Proyectos/drawdb-server/.env`), `CHROME` (def. `~/.cache/ms-playwright/chromium-1140/chrome-linux/chrome`), `RUNS` (def. `3`).

- [ ] **Step 1:** Escribir el script. Para cada zoom (5 % inicial y uno ≥ 35 % alcanzado con Ctrl+rueda sobre una zona con tablas), hace un gesto de calentamiento y luego `RUNS` corridas de:

  1. arrastre de una tabla, 120 pasos;
  2. Ctrl+clic en 20 tablas visibles y arrastre de la selección, 120 pasos (si hay menos de 20 visibles, usa las que haya e imprime cuántas);
  3. redimensionado del borde derecho de una tabla, 120 pasos (solo a zoom ≥ 35 %, donde se ven las asas; a 5 % se informa «n/a»).

  Mide con `requestAnimationFrame` (tiempo entre cuadros) y `PerformanceObserver({type:"longtask"})`. Imprime por gesto y zoom la mediana de las corridas de: mediana de frame, p95 de frame y tarea larga máxima, y `PASS`/`FAIL` contra el criterio del spec (≤ 20 ms, ≤ 50 ms, ninguna > 100 ms).

- [ ] **Step 2: Dejar el proyecto igual.** Antes de cada gesto guarda los `getBoundingClientRect()` de las tablas tocadas; después de cada gesto pulsa Ctrl+Z, espera 300 ms y comprueba que vuelven a la misma posición y tamaño (tolerancia 0,5 px). Si no, termina con código ≠ 0 y lo dice.
- [ ] **Step 3:** Comentario al inicio del script con: login vía `POST /api/auth/login` con `ADMIN_EMAIL`/`ADMIN_PASSWORD` de `SERVER_ENV`; medir contra `npx vite build && npx vite preview --port 4173`; y el arreglo sin `sudo` para WSL (`apt-get download libnss3 libnspr4 libasound2t64`, `dpkg-deb -x` a una carpeta, `LD_LIBRARY_PATH=<carpeta>/usr/lib/x86_64-linux-gnu`).
- [ ] **Step 4:** `npm run lint` ⇒ PASS (si ESLint no cubre `scripts/`, basta con `node --check scripts/perf/drag-resize.mjs`).
- [ ] **Step 5: Commit**

```bash
git add scripts/perf/drag-resize.mjs package.json package-lock.json
git commit -m "chore: script de medición de arrastre y redimensionado"
```

---

### Task 5: Medir e informar (Claude)

Tras integrar la oleada 2, Claude ejecuta el script contra el build de producción de la rama y lo compara con la línea base del spec (≈ 5 s por movimiento).

- [ ] **Step 1:** `npx vite build && npx vite preview --port 4173` y `node scripts/perf/drag-resize.mjs`.
- [ ] **Step 2:** Anotar resultados en `.superpowers/sdd/2026-10-24-arrastre-fluido/`.
- [ ] **Step 3:** Si todo da `PASS`, se pasa a la prueba manual del dueño. Si algo da `FAIL`, se lanza Task 6 y se vuelve a medir. Si Task 6 tampoco basta, se para y se reporta al dueño con números (spec: no evitar el estado de React ni tocar colaboración/undo sin su visto bueno).

---

### Task 6 (opcional, solo si Task 5 da FAIL): Lienzo

**Files:**

- Modify: `src/components/EditorCanvas/Table.jsx`, `src/components/EditorCanvas/Canvas.jsx`

**Interfaces:**

- Consumes: `sameIgnoringLayout`, `useLayoutStable` (Task 2).

- [ ] **Step 1:** Perfilar (CPU profile del script o DevTools) para confirmar qué domina tras Tasks 1–3; anotar el top 5 en el ledger.
- [ ] **Step 2:** Atacar solo lo que el perfil señale, en este orden:
  - `FieldSummary` y `TableEditSheet` (`Table.jsx`) leen `tables` del contexto: pasarles por props solo lo que usan, o leer `useLayoutStable(tables)`.
  - `tableBoxes` (`Canvas.jsx`) recalcula `getTableHeight` de todas las tablas: reutilizar la caja anterior de cada tabla cuando `sameIgnoringLayout` y solo actualizar `x/y/w`.
- [ ] **Step 3:** `npm test && npm run lint` ⇒ PASS; volver a Task 5.
- [ ] **Step 4: Commit**

```bash
git add src/components/EditorCanvas/Table.jsx src/components/EditorCanvas/Canvas.jsx
git commit -m "perf: el lienzo no recalcula tablas que no cambian"
```

---

## Oleadas

| Oleada | Tareas en paralelo                    | Archivos (disjuntos)                                                                                                     |
| ------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1      | Task 1, Task 2, Task 4                | `issues.js`, `circularTables*` · `layoutFields*`, `useLayoutStable.js`, `Issues.jsx` · `scripts/perf/*`, `package*.json` |
| 2      | Task 3                                | `TablesTab.jsx`, `SortableList.jsx`                                                                                      |
| —      | Task 5 (Claude), Task 6 si hace falta | —                                                                                                                        |

## Ejecución en paralelo (Cline)

Para cada oleada, Claude hace lo siguiente desde `/home/carlos/Proyectos/drawdb`:

1. **Worktrees**, uno por tarea:
   ```bash
   git worktree add ../drawdb-wt/afN -b feat/af-tN feat/arrastre-fluido
   ln -s /home/carlos/Proyectos/drawdb/node_modules ../drawdb-wt/afN/node_modules
   ```
   (Task 4 instala `playwright-core`: en su worktree se usa un `node_modules` propio con `npm ci` en lugar del enlace, para no tocar el del repo principal.)
2. **Lanzar Cline en paralelo**, un proceso en segundo plano por tarea:
   ```bash
   cline -c /home/carlos/Proyectos/drawdb-wt/afN "Lee docs/superpowers/specs/2026-10-24-arrastre-fluido-diagramas-grandes-design.md y docs/superpowers/plans/2026-10-24-arrastre-fluido-diagramas-grandes.md. Implementa SOLO la Task N siguiendo sus pasos. Toca únicamente los archivos listados en la Task N. Respeta las Global Constraints. Haz el commit indicado en la rama actual, sin Co-Authored-By ni créditos de IA. No hagas merge ni push."
   ```
3. **Revisión**, por sub-rama: `git diff feat/arrastre-fluido...feat/af-tN --stat` (solo archivos permitidos), lectura del diff contra spec y tarea, `npm test && npm run lint` en el worktree. Si algo falla, se devuelve a Cline en el mismo worktree con correcciones concretas.
4. **Integrar**: `git merge --no-ff feat/af-tN` en `feat/arrastre-fluido`, una por una; luego `npm test && npm run lint`.
5. **Limpiar**: `git worktree remove ../drawdb-wt/afN` y `git branch -d feat/af-tN`.
6. Anotar el resultado en `.superpowers/sdd/2026-10-24-arrastre-fluido/` y pasar a la siguiente oleada.

Al final: Task 5, revisión de toda la rama y prueba manual del dueño (incluida la de dos navegadores para el movimiento en vivo). Sin merge a `main` ni push hasta que el dueño lo indique.
