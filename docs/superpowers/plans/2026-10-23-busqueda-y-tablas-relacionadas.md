# Búsqueda de tablas, tablas relacionadas y modo enfocado — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Ejecución acordada con el dueño:** cada tarea la implementa **una instancia de Cline CLI**. Las tareas de una misma oleada corren **en paralelo**, cada una en su propio git worktree. Claude revisa cada diff, ejecuta las pruebas e integra en la rama de la feature antes de lanzar la siguiente oleada. Ver «Ejecución en paralelo» al final.

**Goal:** Búsqueda fiable de tablas y columnas, botón «Ubicar en el diagrama», ventana de solo lectura «Relacionadas» y modo enfocado personal con atenuado, sin tocar el backend ni el formato del diagrama.

**Architecture:** La lógica pura (grafo de relaciones, opciones de búsqueda, transform de «Ubicar») vive en `src/utils/` y tiene pruebas. Un `FocusContext` local (nunca persistido ni emitido) guarda el enfoque, la tabla abierta en la ventana «Relacionadas» y el destello de «Ubicar». El lienzo recibe un booleano `dimmed` por elemento. La ventana es un `Modal` con un mini-lienzo SVG propio que no reutiliza `Canvas.jsx`.

**Tech Stack:** React 18, Vite, Semi UI (`@douyinfe/semi-ui`, `@douyinfe/semi-icons`), i18next, vitest 5 (entorno `node`, sin DOM: probar lógica pura y `renderToStaticMarkup`).

**Spec:** `docs/superpowers/specs/2026-10-23-busqueda-y-tablas-relacionadas-design.md` (léelo antes de cada tarea).

## Global Constraints

- Repo: `/home/carlos/Proyectos/drawdb`. Rama de integración: `feat/busqueda-tablas-relacionadas`. Cada tarea va en su sub-rama `feat/btr-tN`, creada desde la rama de integración.
- **Prohibido hacer merge a `main` y prohibido `git push`** salvo orden expresa del dueño.
- **Solo se tocan los archivos listados en la tarea.** Cualquier otro cambio se rechaza.
- El modo enfocado y «Ubicar» **no** usan `table.hidden`, **no** llaman a `updateTable`/`setTables`, **no** añaden entradas a `setUndoStack` y **no** emiten operaciones de colaboración. Solo estado local de React y `setTransform` (que ya es personal).
- Profundidades válidas: `1`, `2`, `3`, `Infinity` («Todo»).
- Opacidad de lo atenuado: `0.2`. Destello de «Ubicar»: `1500` ms. «Ubicar»: si `zoom < 0.5`, el zoom pasa a `1`; si no, se mantiene.
- Búsqueda: modo por defecto `"tables"`; sin distinguir mayúsculas ni acentos; subcadena en cualquier posición; en `"both"`, primero las tablas y después las columnas.
- Textos de UI solo vía `t("clave")`, con las claves de la Task 2. No se escriben textos literales en los componentes.
- Iconos solo de `@douyinfe/semi-icons`.
- Pruebas: `npm test` y `npm run lint` en verde al final de cada tarea.
- Mensajes de commit en español, estilo `feat: ...` / `fix: ...` / `test: ...`. **Sin créditos de IA ni líneas `Co-Authored-By`** (regla del dueño).

## Review Focus

1. **Dos tablas con una columna del mismo nombre** (`pedidos.id` y `pagos.id`): elegir una abre esa tabla y no la otra. → prueba en Task 1 (`buildSearchOptions` da `value` distintos).
2. **Grafo con ciclos y autorreferencias** (A→B→A, A→A): el recorrido termina y no duplica. → prueba en Task 1.
3. **Un compañero borra la tabla enfocada o la de la ventana «Relacionadas»**: se sale del modo o se cierra la ventana con aviso, sin errores. → prueba en Task 3 (`resolveFocusAfterChange`).
4. **Exportar imagen/PDF con el modo enfocado activo**: el archivo sale sin atenuar. → verificación en Task 6 (`dimmed` es `false` cuando `exporting`).
5. **Enlazar desde una tabla del grupo hacia una atenuada**: se puede soltar y la tabla destino entra al grupo. → verificación manual en Task 6.

---

## Mapa de archivos

- Create `src/utils/relatedTables.js` + `src/utils/relatedTables.test.js` (Task 1)
- Create `src/utils/tableSearch.js` + `src/utils/tableSearch.test.js` (Task 1)
- Create `src/utils/locate.js` + `src/utils/locate.test.js` (Task 1)
- Modify `src/i18n/locales/es.js`, `src/i18n/locales/en.js` (Task 2)
- Create `src/context/FocusContext.jsx`, `src/context/focusState.js` + `src/context/focusState.test.js`, `src/hooks/useFocus.js`; Modify `src/hooks/index.js`, `src/pages/Editor.jsx`, `src/pages/ProjectEditor.jsx`, `src/context/DiagramContext.jsx` (Task 3)
- Modify `src/components/EditorSidePanel/TablesTab/SearchBar.jsx` (Task 4)
- Create `src/components/RelatedTables/RelatedTablesModal.jsx`, `src/components/RelatedTables/RelatedDiagram.jsx` (Task 5)
- Modify `src/components/EditorCanvas/Canvas.jsx`, `Table.jsx`, `SimplifiedTable.jsx`, `Relationship.jsx`, `View.jsx`, `Note.jsx`, `Area.jsx`, `src/components/Workspace.jsx`; Create `src/components/RelatedTables/FocusBar.jsx` (Task 6)
- Modify `src/components/EditorSidePanel/TablesTab/TablesTab.jsx`, `src/components/EditorHeader/ControlPanel.jsx`; Create `src/hooks/useLocateTable.jsx` (Task 7)

## Oleadas

| Oleada | Tareas en paralelo     | Depende de         |
| ------ | ---------------------- | ------------------ |
| 1      | Task 1, Task 2         | —                  |
| 2      | Task 3, Task 4, Task 5 | Oleada 1 integrada |
| 3      | Task 6, Task 7         | Oleada 2 integrada |

---

### Task 1: Lógica pura (grafo, búsqueda, Ubicar)

**Files:**

- Create: `src/utils/relatedTables.js`, `src/utils/tableSearch.js`, `src/utils/locate.js`
- Test: `src/utils/relatedTables.test.js`, `src/utils/tableSearch.test.js`, `src/utils/locate.test.js`

**Interfaces:**

- Produces:

  - `FOCUS_DEPTHS = [1, 2, 3, Infinity]`, `DIMMED_OPACITY = 0.2` (exportados desde `relatedTables.js`)
  - `relatedTableIds(relationships, rootId, depth) → Set<string>`: BFS no dirigido sobre `startTableId`/`endTableId`. Incluye `rootId`. `depth` ∈ `FOCUS_DEPTHS`.
  - `relatedSubgraph(tables, relationships, rootId, depth) → { tables, relationships }`: filtra a las tablas de `relatedTableIds`, ignorando ids que no estén en `tables`, y a las relaciones con ambos extremos dentro.
  - `buildSearchOptions(tables, mode) → Option[]` con `mode` ∈ `"tables" | "columns" | "both"`. Para una tabla: `{ value: "t:<tableId>", kind: "table", label: <name>, tableId }`. Para una columna: `{ value: "c:<tableId>:<fieldId>", kind: "column", label: "<tabla>.<columna>", tableId, fieldIndex }`. En `"both"`, todas las tablas antes que todas las columnas.
  - `normalizeSearch(text) → string`: minúsculas y sin diacríticos (`NFD` y quitar `\p{Diacritic}`).
  - `filterSearchOptions(options, query) → Option[]`: si `query` está vacío tras `trim`, devuelve `options`; si no, las opciones cuya `normalizeSearch(label)` incluye `normalizeSearch(query)`.
  - `LOCATE_MIN_ZOOM = 0.5`, `LOCATE_ZOOM = 1`, `FLASH_MS = 1500` (exportados desde `locate.js`)
  - `locateTransform(table, currentZoom, showComments, relationships) → { pan: {x, y}, zoom }`: `pan` es el centro de la tabla (usa `getTableWidth`/`getTableHeight` de `src/utils/utils.js`); `zoom` es `LOCATE_ZOOM` si `currentZoom < LOCATE_MIN_ZOOM` y `currentZoom` en otro caso.

- [ ] **Step 1: Write the failing tests**

`relatedTables.test.js` (relaciones de ejemplo: `r(a, b) = { id: a+b, startTableId: a, endTableId: b }`):

- `"depth 1 includes both directions"`: con `[r("A","B"), r("C","A"), r("B","D")]`, `relatedTableIds(rels, "A", 1)` es `{A, B, C}`.
- `"depth 2 reaches two hops"`: lo mismo con depth 2 da `{A, B, C, D}`.
- `"Infinity returns the whole connected component"`: con la cadena `A-B-C-D-E`, desde `A` da las 5, y `X` aislada no aparece.
- `"cycles and self references terminate"`: con `[r("A","B"), r("B","A"), r("A","A")]` y depth `Infinity`, da `{A, B}`.
- `"table without relationships returns only itself"`: da `{A}`.
- `"relatedSubgraph drops orphan relationships and missing tables"`: con `tables` `[A, B]` y `rels` `[r("A","B"), r("A","Z")]` → `tables` son `[A, B]` y `relationships` es solo `A-B`.

`tableSearch.test.js`:

- `"column options have unique values even with repeated names"`: `pedidos{id}` y `pagos{id}` en modo `"columns"` → dos opciones con labels `"pedidos.id"` y `"pagos.id"` y `value` distintos.
- `"both lists tables before columns"`: el `kind` de todas las primeras opciones es `"table"` y después solo hay `"column"`.
- `"tables mode has no columns"`.
- `"filter ignores case and accents"`: `filterSearchOptions` con la label `"Categoría"` y el query `"categoria"` → 1 resultado; con `"CATEG"` → 1.
- `"filter matches substrings"`: `"ped"` encuentra `"detalle_pedido"`.
- `"empty query returns all"`.

`locate.test.js`:

- `"centers on the table"`: tabla `{ x: 100, y: 200, fields: [...] }` → `pan` igual a `x + getTableWidth(t)/2` y `y + getTableHeight(t, true, [])/2`.
- `"keeps zoom at or above 0.5"`: `currentZoom` 0.8 → 0.8; 0.5 → 0.5.
- `"raises low zoom to 1"`: 0.2 → 1.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/relatedTables.test.js src/utils/tableSearch.test.js src/utils/locate.test.js`
Expected: FAIL (módulos inexistentes)

- [ ] **Step 3: Implement the three modules with the signatures above**

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/relatedTables.test.js src/utils/tableSearch.test.js src/utils/locate.test.js && npm run lint`
Expected: PASS, lint sin errores

- [ ] **Step 5: Commit**

```bash
git add src/utils/relatedTables.js src/utils/relatedTables.test.js src/utils/tableSearch.js src/utils/tableSearch.test.js src/utils/locate.js src/utils/locate.test.js
git commit -m "feat: lógica de tablas relacionadas, búsqueda y ubicación"
```

---

### Task 2: Textos (es / en)

**Files:**

- Modify: `src/i18n/locales/es.js`, `src/i18n/locales/en.js` (añadir al final de `translation`)

**Interfaces:**

- Produces: estas claves, usadas por las Tasks 4–7. Las claves existentes `search`, `not_found`, `cancel` y `close` se reutilizan.

| Clave                        | es                                                             | en                                                              |
| ---------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------- |
| `search_mode_tables`         | Tablas                                                         | Tables                                                          |
| `search_mode_columns`        | Columnas                                                       | Columns                                                         |
| `search_mode_both`           | Ambas                                                          | Both                                                            |
| `search_kind_table`          | Tabla                                                          | Table                                                           |
| `search_kind_column`         | Columna                                                        | Column                                                          |
| `locate_in_diagram`          | Ubicar en el diagrama                                          | Locate in diagram                                               |
| `locate_hidden_table`        | La tabla está oculta                                           | This table is hidden                                            |
| `locate_outside_focus_title` | Tabla fuera del grupo enfocado                                 | Table outside the focused group                                 |
| `locate_outside_focus_text`  | «{{name}}» no pertenece al grupo enfocado. ¿Qué quieres hacer? | "{{name}}" is not in the focused group. What do you want to do? |
| `locate_add_to_focus`        | Agregarla al grupo                                             | Add it to the group                                             |
| `locate_exit_focus`          | Salir del modo enfocado                                        | Exit focus mode                                                 |
| `view_related`               | Ver relacionadas                                               | View related tables                                             |
| `focus_on_canvas`            | Enfocar en el lienzo                                           | Focus on canvas                                                 |
| `related_title`              | Relacionadas con: {{name}}                                     | Related to: {{name}}                                            |
| `related_scope`              | Alcance                                                        | Scope                                                           |
| `related_depth_hops`         | {{count}} salto                                                | {{count}} hop                                                   |
| `related_depth_all`          | Todo                                                           | All                                                             |
| `related_table_count`        | {{count}} tablas                                               | {{count}} tables                                                |
| `related_no_relationships`   | Esta tabla no tiene relaciones                                 | This table has no relationships                                 |
| `related_focus_to_edit`      | Enfocar en el lienzo para editar                               | Focus on canvas to edit                                         |
| `related_hidden_badge`       | Oculta en el diagrama                                          | Hidden in diagram                                               |
| `related_root_deleted`       | La tabla de la vista de relacionadas se eliminó                | The table in the related view was deleted                       |
| `focus_bar_label`            | Enfocado: {{name}}                                             | Focused: {{name}}                                               |
| `focus_exit`                 | Salir                                                          | Exit                                                            |
| `focus_root_deleted`         | La tabla enfocada se eliminó; se salió del modo enfocado       | The focused table was deleted; focus mode was closed            |

- [ ] **Step 1: Add the keys to both files**
- [ ] **Step 2: Verify:** `npm run lint && npm test`. Expected: PASS. Además, `node -e` que importe ambos archivos y compruebe que las 25 claves existen en los dos.
- [ ] **Step 3: Commit** — `git add src/i18n/locales/es.js src/i18n/locales/en.js && git commit -m "feat: textos de búsqueda, relacionadas y modo enfocado"`

---

### Task 3: Contexto de enfoque

**Files:**

- Create: `src/context/focusState.js`, `src/context/FocusContext.jsx`, `src/hooks/useFocus.js`
- Test: `src/context/focusState.test.js`
- Modify: `src/hooks/index.js` (exportar `useFocus`), `src/pages/Editor.jsx` y `src/pages/ProjectEditor.jsx` (envolver el hijo de `SaveStateContextProvider` con `<FocusContextProvider>`), `src/context/DiagramContext.jsx` (`addTable` devuelve el id de la tabla creada: `data?.table?.id ?? newTable.id`)

**Interfaces:**

- Consumes: `relatedTableIds`, `FOCUS_DEPTHS` (Task 1); `fitTransform` (`src/utils/fitView.js`); `useDiagram`, `useTransform`, `useSettings`; claves `focus_root_deleted` y `related_root_deleted` (Task 2).
- Produces:

  - `focusState.js` (puro):
    - `computeFocusedIds(relationships, focus) → Set<string> | null`, con `focus = { rootId, depth, extraIds: Set<string> } | null`. Devuelve `null` si `focus` es `null`; si no, `relatedTableIds(...)` ∪ `extraIds`.
    - `resolveFocusAfterChange(tables, focus, relatedRootId) → { focus, relatedRootId, focusRootDeleted: boolean, relatedRootDeleted: boolean }`: si el `rootId` ya no está en `tables`, `focus` pasa a `null` y `focusRootDeleted` a `true`; lo mismo para `relatedRootId`. Además, quita de `extraIds` los ids que ya no existen.
  - `useFocus()` devuelve:
    - `focus: { rootId, depth } | null`
    - `focusedIds: Set<string> | null` (memo de `computeFocusedIds`, dependiente solo de `relationships` y del estado de foco, nunca del transform)
    - `isTableDimmed(tableId) → boolean`: `false` sin foco
    - `startFocus(rootId, depth = 1)`: reinicia `extraIds`, cierra la ventana «Relacionadas» y ajusta la vista al grupo con `fitTransform({ tables: <tablas del grupo>, relationships }, document.getElementById("canvas").getBoundingClientRect(), settings.showComments)` vía `setTransform`
    - `setFocusDepth(depth)`
    - `exitFocus()`
    - `includeTable(tableId)`: añade a `extraIds` solo si hay foco; si no, no hace nada
    - `relatedRootId: string | null`, `openRelated(tableId)`, `closeRelated()`
    - `flashTableId: string | null`, `flashTable(tableId)`: lo pone y lo limpia tras `FLASH_MS` (Task 1). Con `prefers-reduced-motion`, igual se pone: quien dibuja decide no animar.
  - Un `useEffect` sobre `tables` aplica `resolveFocusAfterChange` y lanza `Toast.warning(t("focus_root_deleted"))` / `Toast.warning(t("related_root_deleted"))` cuando corresponde.
  - Las acciones van en un `useMemo`/`useCallback` estable, como en `SelectContext.jsx`.

- [ ] **Step 1: Write the failing tests** in `focusState.test.js`:
  - `"null focus gives null ids"`
  - `"focused ids include related and extra tables"`: `extraIds` `{Z}` aislada → aparece en el set.
  - `"new relationship within depth joins the group"`: añadir `r("B","D")` con depth 2 desde A hace que D entre.
  - `"deleting the root clears focus and flags it"`
  - `"deleting the related root clears it and flags it"`
  - `"extra ids that no longer exist are dropped"`
- [ ] **Step 2: Run** `npx vitest run src/context/focusState.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `focusState.js`, `FocusContext.jsx` y `useFocus.js` con las firmas de arriba; montar el provider en los dos pages y hacer que `addTable` devuelva el id.
- [ ] **Step 4: Verify** `npm test && npm run lint`. Expected: PASS. Con `npm run dev`, el editor abre igual que antes, en local y en un proyecto.
- [ ] **Step 5: Commit** — `git commit -m "feat: contexto local del modo enfocado"` (solo los archivos listados).

---

### Task 4: Buscador de la pestaña Tablas

**Files:**

- Modify: `src/components/EditorSidePanel/TablesTab/SearchBar.jsx` (solo este archivo)

**Interfaces:**

- Consumes: `buildSearchOptions`, `filterSearchOptions` (Task 1); claves `search_mode_*`, `search_kind_*`, `search`, `not_found` (Task 2).
- Produces: `SearchBar({ tables })`, con la misma firma, así `TablesTab.jsx` no cambia.

- [ ] **Step 1: Rewrite `SearchBar`**: sustituir el `TreeSelect` por un `AutoComplete` o un `Select` filtrable de Semi UI (a criterio de quien construye), usando como `data` el resultado de `filterSearchOptions(buildSearchOptions(tables, mode), query)`. Al lado, un `Select` pequeño de modo (`tables` / `columns` / `both`), con el estado local `useState("tables")`. Cada opción muestra un distintivo (`search_kind_table` / `search_kind_column`) y la label.
- [ ] **Step 2: Selection behavior** (por `value`, nunca por nombre):
  - Al elegir una tabla: `setSelectedElement` con `{ id: tableId, open: true, element: ObjectType.TABLE }` y `scrollIntoView` de `scroll_table_${tableId}`, como hoy.
  - Al elegir una columna: lo mismo y, en el siguiente frame (`requestAnimationFrame`), `focus()` sobre `scroll_table_${tableId}_input_${fieldIndex}`.
  - Después se limpia el texto del buscador.
- [ ] **Step 3: Verify** `npm test && npm run lint`. Expected: PASS. Manual con `npm run dev`, en un diagrama con dos tablas que tengan `id`:
  - en modo Columnas, `id` muestra `tablaA.id` y `tablaB.id`, y elegir `tablaB.id` abre `tablaB` con el foco en su campo;
  - `CATEG` encuentra `categoría`.
- [ ] **Step 4: Commit** — `git commit -m "fix: búsqueda de tablas y columnas por id con modos"`

---

### Task 5: Ventana «Relacionadas»

**Files:**

- Create: `src/components/RelatedTables/RelatedTablesModal.jsx`, `src/components/RelatedTables/RelatedDiagram.jsx`

**Interfaces:**

- Consumes: `relatedSubgraph`, `FOCUS_DEPTHS` (Task 1); `fitTransform` (`src/utils/fitView.js`); `useDiagram`, `useSettings`; claves `related_*`, `close` (Task 2).
- Produces:

  - `RelatedTablesModal({ rootId, onClose, onFocus })`: `rootId: string | null` (si es `null`, no se muestra) y `onFocus(rootId, depth)`. No usa `useFocus`; la Task 6 lo conecta.
  - `RelatedDiagram({ tables, relationships, rootId, showComments })`: SVG de solo lectura con pan (arrastrar el fondo) y zoom (rueda) propios. La vista inicial sale de `fitTransform` sobre esas tablas con el tamaño del contenedor, y se recalcula al cambiar el conjunto de tablas.

- [ ] **Step 1: `RelatedDiagram`**:
  - Dibuja cada tabla en su `x`/`y` con `getTableWidth`/`getTableHeight`: cabecera con el color de la tabla, nombre y campos.
  - Dibuja las relaciones como líneas o `calcPath` (`src/utils/calcPath.js`) entre tablas.
  - La raíz va resaltada con borde de acento.
  - Las tablas con `hidden` se dibujan con borde discontinuo y el texto `related_hidden_badge`.
  - Sin handlers de edición ni selección.
- [ ] **Step 2: `RelatedTablesModal`**:
  - Es un `Modal` de Semi UI grande (por ejemplo `width="80vw"`, cuerpo de unos `65vh`), con estado local `depth` (inicial `1`).
  - Cabecera:
    - `t("related_title", { name })`;
    - selector de alcance con `FOCUS_DEPTHS`: `t("related_depth_hops", { count })` para 1–3 y `t("related_depth_all")` para `Infinity`;
    - `t("related_table_count", { count })`;
    - botón `t("related_focus_to_edit")`, que llama a `onFocus(rootId, depth)`.
  - Si el subgrafo tiene una sola tabla, se muestra `t("related_no_relationships")` bajo el diagrama.
  - Los datos vienen de `useDiagram()`, así que la ventana se actualiza sola con los cambios remotos.
- [ ] **Step 3: Verify** `npm test && npm run lint`. Expected: PASS. Se puede renderizar con `renderToStaticMarkup` en una prueba rápida opcional; la verificación visual llega en la Task 6, que la monta.
- [ ] **Step 4: Commit** — `git commit -m "feat: ventana de tablas relacionadas"`

---

### Task 6: Lienzo — atenuado, barra de enfoque, menú de la tabla y montaje de la ventana

**Files:**

- Modify: `src/components/EditorCanvas/Canvas.jsx`, `Table.jsx`, `SimplifiedTable.jsx`, `Relationship.jsx`, `View.jsx`, `Note.jsx`, `Area.jsx`, `src/components/Workspace.jsx`
- Create: `src/components/RelatedTables/FocusBar.jsx`

**Interfaces:**

- Consumes: `useFocus` (Task 3), `RelatedTablesModal` (Task 5), `DIMMED_OPACITY` y `FOCUS_DEPTHS` (Task 1), claves `focus_*`, `view_related`, `focus_on_canvas` y `related_depth_*` (Task 2).
- Produces: el prop `dimmed: boolean` en `Table`, `SimplifiedTable`, `Relationship`, `View`, `Note` y `Area`; el prop `linking: boolean` en `Table`.

- [ ] **Step 1: `Canvas.jsx`**:
  - Calcula `const dim = !exporting && focusedIds !== null`.
  - Pasa estos props:
    - `Table`: `dimmed={dim && !focusedIds.has(table.id)}` y `linking={linking}`;
    - `Relationship`: `dimmed={dim && !(focusedIds.has(e.startTableId) && focusedIds.has(e.endTableId))}`;
    - `View`, `Note` y `Area`: `dimmed={dim}`.
  - En `collectSelectedElements`, si `dim` está activo, omite las tablas atenuadas y todas las vistas, notas y áreas.
  - En `handleLinking`, tras crear la relación, si hay foco, llama a `includeTable(hoveredTable.tableId)`.
- [ ] **Step 2: Elementos atenuados**:
  - Cada componente aplica `opacity: DIMMED_OPACITY` cuando `dimmed`.
  - `pointerEvents: "none"` salvo en `Table` cuando `linking` es `true`: ahí la tabla atenuada sigue recibiendo `pointerenter` en sus campos para poder soltar el enlace.
  - `SimplifiedTable` recibe lo mismo desde `Table`.
- [ ] **Step 3: `Table.jsx`**:
  - En el `Popover` «⋯», entre Duplicar y el divisor, añade:
    - `t("view_related")` (icono de semi-icons) → `openRelated(tableData.id)`;
    - `t("focus_on_canvas")` → `startFocus(tableData.id, 1)`.
      Ambas opciones se habilitan también en solo lectura.
  - En `duplicateTable`, después de `addTable`, llama a `includeTable(duplicated.id)`.
  - Si `flashTableId === tableData.id`, aplica un anillo o pulso de acento durante el destello. Con `prefers-reduced-motion: reduce`, sin animación: solo el anillo estático.
- [ ] **Step 4: `FocusBar.jsx`**: barra fija arriba del lienzo, en el estilo del banner existente de `Workspace.jsx`, con:
  - `t("focus_bar_label", { name })`;
  - selector `FOCUS_DEPTHS` → `setFocusDepth`;
  - `t("related_table_count", { count: focusedIds.size })`;
  - botón `t("focus_exit")` → `exitFocus()`.
    `Esc` sale si `document.activeElement` no es `input`, `textarea` ni `contenteditable`. Usa un listener en fase de captura, como el de `handTool` en `ControlPanel.jsx`. Solo se dibuja con foco activo.
- [ ] **Step 5: `Workspace.jsx`**:
  - Monta `<FocusBar />` en el contenedor del lienzo (junto a `Slot name="canvas-overlay"`).
  - Monta `<RelatedTablesModal rootId={relatedRootId} onClose={closeRelated} onFocus={(id, d) => startFocus(id, d)} />`. Como `startFocus` ya cierra la ventana, no hace falta llamar a `closeRelated` aquí.
- [ ] **Step 6: Verify** `npm test && npm run lint`. Expected: PASS. Manual con `npm run dev`:
  - «⋯» → «Ver relacionadas» abre la ventana; cambiar el alcance cambia las tablas.
  - «Enfocar en el lienzo» atenúa el resto; con alcance 2 entran más tablas.
  - Las tablas atenuadas no se pueden arrastrar ni seleccionar, y la selección por rectángulo las ignora.
  - Se puede arrastrar un enlace desde un campo del grupo hasta una tabla atenuada; al soltarlo, esa tabla deja de estar atenuada.
  - Exportar PNG con foco activo da una imagen sin atenuar.
  - `Esc` y «Salir» salen del modo.
  - En otro navegador, con otro usuario del mismo proyecto, no se ve ningún atenuado y no aparece ninguna entrada nueva en el historial de deshacer.
- [ ] **Step 7: Commit** — `git commit -m "feat: modo enfocado en el lienzo y acceso a relacionadas"`

---

### Task 7: Panel lateral — Ubicar, Relacionadas, Enfocar y tablas nuevas

**Files:**

- Create: `src/hooks/useLocateTable.jsx`
- Modify: `src/components/EditorSidePanel/TablesTab/TablesTab.jsx`, `src/components/EditorHeader/ControlPanel.jsx`

**Interfaces:**

- Consumes: `useFocus` (Task 3); `locateTransform` (Task 1); `useTransform`, `useSettings`, `useDiagram`, `useSelect`; claves `locate_*`, `view_related`, `focus_on_canvas` y `cancel` (Task 2).
- Produces: `useLocateTable() → (tableId: string) => void`. No se exporta desde `src/hooks/index.js`, que es de la Task 3; se importa directamente.

- [ ] **Step 1: `useLocateTable`**: la función devuelta hace esto:
  1. Busca la tabla. Si no existe, no hace nada.
  2. Si hay foco y `isTableDimmed(id)`, abre un `Modal` con título `locate_outside_focus_title`, el texto `locate_outside_focus_text` y tres botones:
     - `locate_add_to_focus` → `includeTable(id)` y ubicar;
     - `locate_exit_focus` → `exitFocus()` y ubicar;
     - `cancel` → nada.
       Usa `Modal.confirm` con `footer` propio, o un `Modal` controlado montado por el hook; a criterio de quien construye.
  3. Ubicar consiste en tres pasos:
     - `setTransform((prev) => ({ ...prev, ...locateTransform(table, prev.zoom, settings.showComments, relationships) }))`;
     - `setSelectedElement((prev) => ({ ...prev, element: ObjectType.TABLE, id }))`;
     - `flashTable(id)`.
- [ ] **Step 2: `TablesTab.jsx`**:
  - En `TableListItem`, antes del ojito, añade tres botones `size="small" theme="borderless"`, cada uno con `title` y `aria-label` traducidos y con `e.stopPropagation()`:
    - ⌖ `locate_in_diagram` → `locate(table.id)`. Si `table.hidden`, va deshabilitado con `title={t("locate_hidden_table")}`.
    - ◎ `view_related` → `openRelated(table.id)`.
    - `focus_on_canvas` → `startFocus(table.id, 1)`.
  - En el botón «Añadir tabla»: `const id = addTable(); includeTable(id);`.
- [ ] **Step 3: `ControlPanel.jsx`**:
  - En el botón de la barra que llama a `addTable()` (cerca de la línea 2332) y en `duplicate()` (caso `ObjectType.TABLE`, cerca de la línea 980), llama a `includeTable` con el id creado.
  - En `duplicate()`, guarda el `nanoid()` en una variable antes de llamar a `addTable`.
  - No toques los demás `addTable`: undo/redo, pegar e importar.
- [ ] **Step 4: Verify** `npm test && npm run lint`. Expected: PASS. Manual:
  - ⌖ centra la tabla y destella; con zoom 20 %, sube al 100 %.
  - Con foco en «pedidos», ⌖ sobre una tabla atenuada muestra el diálogo y las tres opciones funcionan.
  - En modo enfocado, «Añadir tabla» y Ctrl+D crean una tabla que no queda atenuada.
  - El ⌖ de una tabla oculta está deshabilitado.
- [ ] **Step 5: Commit** — `git commit -m "feat: ubicar, relacionadas y enfocar desde el panel de tablas"`

---

## Ejecución en paralelo (Cline)

Para cada oleada, Claude hace lo siguiente desde `/home/carlos/Proyectos/drawdb`:

1. **Worktrees**, uno por tarea de la oleada:
   ```bash
   git worktree add ../drawdb-wt/tN -b feat/btr-tN feat/busqueda-tablas-relacionadas
   ln -s /home/carlos/Proyectos/drawdb/node_modules ../drawdb-wt/tN/node_modules
   ```
2. **Lanzar Cline en paralelo**: un proceso en segundo plano por tarea.
   ```bash
   cline -c /home/carlos/Proyectos/drawdb-wt/tN "Lee docs/superpowers/specs/2026-10-23-busqueda-y-tablas-relacionadas-design.md y docs/superpowers/plans/2026-10-23-busqueda-y-tablas-relacionadas.md. Implementa SOLO la Task N siguiendo sus pasos. Toca únicamente los archivos listados en la Task N. Respeta las Global Constraints. Haz el commit indicado en la rama actual, sin Co-Authored-By ni créditos de IA. No hagas merge ni push."
   ```
3. **Revisión**: con todos los procesos terminados, para cada sub-rama:
   - `git diff feat/busqueda-tablas-relacionadas...feat/btr-tN --stat` para comprobar que solo cambian los archivos permitidos;
   - lectura del diff contra el spec y la tarea;
   - `npm test && npm run lint` en el worktree.
     Si algo falla, se devuelve a Cline en el mismo worktree con las correcciones concretas.
4. **Integrar**: `git merge --no-ff feat/btr-tN` en `feat/busqueda-tablas-relacionadas`, una por una, y después `npm test && npm run lint` sobre la integración.
5. **Limpiar**: `git worktree remove ../drawdb-wt/tN` y `git branch -d feat/btr-tN`.
6. Anotar el resultado en `.superpowers/sdd/2026-10-23-busqueda-y-tablas-relacionadas/` y pasar a la siguiente oleada.

Al final: revisión de toda la rama y prueba manual con dos navegadores. Sin merge a `main` ni push hasta que el dueño lo indique.
