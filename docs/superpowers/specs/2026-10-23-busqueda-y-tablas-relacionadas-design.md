# Búsqueda de tablas, tablas relacionadas y modo enfocado — Diseño

Fecha: 2026-10-23 · Repo: `drawdb` (solo frontend; el backend no cambia)

## Por qué

Los diagramas del equipo son grandes. Cuando un compañero trabaja en un grupo concreto de tablas (por ejemplo, pedidos y lo que cuelga de ella), hoy tiene que orientarse en el diagrama completo. El dueño usa a diario en DataGrip la vista que muestra solo las tablas relacionadas con una tabla, y quiere algo equivalente en drawDB.

Además, la búsqueda del panel izquierdo no funciona bien:

- `src/components/EditorSidePanel/TablesTab/SearchBar.jsx` usa un `TreeSelect` de Semi UI con tablas **y** columnas mezcladas, y usa el **nombre** como `value`. Varias tablas comparten columnas como `id` o `created_at`, así que los resultados se confunden y al elegir uno se puede abrir la tabla equivocada.
- Al elegir un resultado solo se desplaza la lista del panel; el lienzo no se mueve. No hay forma de ir a una tabla en el diagrama desde la lista.

## Objetivos

1. **Búsqueda fiable** en la pestaña Tablas, con un selector de modo: Tablas, Columnas o Ambas.
2. **Ubicar en el diagrama**: desde cada tabla de la lista, centrar el lienzo en ella y resaltarla.
3. **Ventana «Relacionadas»**, solo para mirar: muestra una tabla y las que se relacionan con ella en las dos direcciones, con alcance ajustable por saltos.
4. **Modo enfocado** en el lienzo, para editar: el grupo se ve normal y el resto de tablas se atenúa.

## No objetivos

- No cambia el backend ni el formato del diagrama. No se añade ningún campo nuevo a tablas ni a relaciones.
- No hay disposición automática: las tablas no se recolocan.
- No se pueden editar tablas dentro de la ventana «Relacionadas».
- La búsqueda de las otras pestañas (relaciones, áreas, notas, tipos, enums, vistas) queda como está.

## Anti-objetivos (sería un fracaso aunque funcione)

- **Que el enfoque de una persona afecte a otra.** El ojito actual (`table.hidden`) se guarda en el diagrama y lo ven todos. El modo enfocado **no** debe usar `hidden` ni escribir nada en el diagrama, en el undo/redo ni en la colaboración. Es estado local de la sesión, como el pan/zoom personal.
- **Que "Ubicar en el diagrama" mueva la vista de los compañeros.** Solo cambia el `transform` local, que ya es personal.
- **Que los diagramas grandes se vuelvan lentos.** `Canvas.jsx` ya dibuja solo lo visible (`rendered`). El atenuado y la ventana no deben anular esa optimización ni recalcular el grafo en cada paso de pan.

## Decisiones del dueño

### Búsqueda (pestaña Tablas)

- Es un autocompletado. La lista de abajo **sigue mostrando todas las tablas**: no se filtra.
- Junto al buscador hay un selector de modo: **Tablas**, **Columnas** o **Ambas**.
- En modo Tablas se busca por nombre de tabla. En modo Columnas se busca por nombre de columna y cada resultado se muestra como `tabla.columna`.
- Elegir una tabla abre esa tabla en la lista de abajo y desplaza la lista hasta ella; esto ya ocurre hoy y se mantiene.
- Cada fila de la lista tiene un botón **«Ubicar en el diagrama»** (⌖), que mueve el lienzo hasta la tabla.

### Ventana «Relacionadas»

- Se abre desde el menú «⋯» de la tabla en el lienzo (`Table.jsx`, junto a Editar/Duplicar/Eliminar) **y** desde un botón ◎ en cada fila de la lista lateral.
- Muestra la tabla elegida y las tablas relacionadas **en las dos direcciones**: las tablas a las que apunta y las que apuntan a ella.
- El alcance es ajustable dentro de la ventana: **1 salto, 2, 3 o Todo**. «Todo» es el componente conectado completo.
- Es solo para mirar.
- Tiene un botón para pasar al modo enfocado con la misma tabla y el mismo alcance.

### Modo enfocado

- Se edita con normalidad y los cambios se guardan y se colaboran como siempre.
- El resto de tablas se **atenúa** (opción B de los bocetos); no se oculta.
- Es personal: los compañeros siguen viendo el diagrama completo.
- Se activa desde el menú «⋯» de la tabla en el lienzo, desde la lista lateral y desde la ventana «Relacionadas».

Bocetos acordados: https://claude.ai/artifact/5Xv654QiXEPJ9Ae1L9ePxb

### Ejecución

- Las tareas del plan las implementa **Cline CLI**, y se pueden lanzar **varias instancias de Cline en paralelo** siempre que no generen conflictos (decisión del dueño). Claude coordina, revisa cada diff y ejecuta las pruebas.
- Cómo se evita el conflicto _(mi decisión)_:
  - El plan agrupa las tareas en **oleadas**. Dentro de una oleada, las tareas no comparten ningún archivo, ni siquiera `es.js`/`en.js`. Los textos i18n van en una tarea propia, en la primera oleada, con todas las claves ya definidas en el plan.
  - Los contratos compartidos (firma de `relatedTableIds`, forma del contexto de enfoque y del hook) se fijan en el plan y se implementan en la primera oleada, antes de que otras tareas los usen.
  - Cada instancia trabaja en su propio **git worktree** con su propia sub-rama, creada desde `feat/busqueda-tablas-relacionadas`. Claude revisa cada sub-rama y la integra en la rama de la feature (nunca en `main`) antes de lanzar la siguiente oleada.
  - Cada tarea del plan lista explícitamente los archivos que puede tocar. Si Cline toca otro archivo, Claude rechaza el cambio.
- Rama `feat/busqueda-tablas-relacionadas` desde `main`. Sin merge a `main` y sin `git push` salvo orden expresa del dueño. Commits sin créditos de IA.

## Comportamiento detallado

### Grafo de relaciones (función pura compartida)

- Se construye con las relaciones del diagrama (`relationship.startTableId` / `endTableId`) como grafo **no dirigido**.
- `relatedTableIds(tables, relationships, rootId, depth)` → `Set` de ids, incluida la raíz. `depth` es 1, 2, 3 o `Infinity` («Todo»). Recorrido BFS. Se ignoran relaciones con extremos que ya no existen. Las autorreferencias no rompen el recorrido.
- La usan la ventana y el modo enfocado, así que ambos muestran siempre el mismo conjunto.
- Va en `src/utils/` con pruebas en vitest.

### Búsqueda

- Por defecto, modo **Tablas** _(mi decisión)_. El modo elegido se recuerda solo durante la sesión _(mi decisión)_.
- La coincidencia no distingue mayúsculas ni acentos, y busca la subcadena en cualquier posición _(mi decisión)_: `ped` encuentra `detalle_pedido`.
- Cada opción tiene un `value` único basado en ids, nunca en nombres: tabla → id de tabla; columna → id de tabla + id de campo.
- En modo Ambas, las tablas aparecen primero y después las columnas _(mi decisión)_, con un distintivo que indica si es tabla o columna.
- Elegir una **columna** abre su tabla en la lista, desplaza la lista y pone el foco en el input de esa columna. Hoy ya existe ese foco (`scroll_table_${tableId}_input_${id}`); hay que verificar que el id usado sea el correcto.
- El componente actual puede sustituirse por un `AutoComplete` o `Select` filtrable de Semi UI si resulta más sencillo y fiable que `TreeSelect`; lo decide quien construye.
- Sin resultados → el texto `not_found` existente.

### Ubicar en el diagrama

- Centra el pan en el centro de la tabla y **mantiene el zoom** actual. Si el zoom es menor que 0.5, lo sube a 1 para que la tabla sea legible _(mi decisión)_.
- Selecciona la tabla en el lienzo (`setSelectedElement`) y la resalta con un destello breve, como 1,5 s _(mi decisión)_. Con `prefers-reduced-motion`, no hay animación: queda solo la selección.
- **Con el modo enfocado activo y una tabla fuera del grupo** (decisión del dueño): antes de mover la vista, un diálogo avisa que la tabla no pertenece al grupo enfocado y ofrece tres opciones:
  1. **Agregarla al grupo**: entra en el `Set` de «añadidos a mano» y después se ubica.
  2. **Salir del modo enfocado**: se sale y después se ubica.
  3. **Cancelar**: no se ubica y todo sigue como estaba.
     Si la tabla ya está en el grupo, se ubica directamente, sin diálogo.
- Si la tabla está oculta con el ojito (`hidden`), el botón aparece deshabilitado y su tooltip explica que la tabla está oculta _(mi decisión)_.
- Reutiliza el cálculo de cajas de `src/utils/fitView.js` (`getTableWidth`/`getTableHeight`).

### Ventana «Relacionadas»

- Es un modal grande de Semi UI con un mini-lienzo SVG propio _(mi decisión: no se reutiliza `Canvas.jsx`, porque arrastra edición, colaboración, cursores y atajos)_. Puede apoyarse en `SimplifiedTable.jsx` o en `SimpleCanvas.jsx` y en `calcPath` para dibujar.
- Las tablas conservan su posición y su tamaño del diagrama. Al abrirse y al cambiar el alcance, la vista se ajusta para que quepan todas, reutilizando `fitTransform` con solo esas tablas.
- Admite pan y zoom (rueda y arrastre del fondo); ese pan/zoom es propio de la ventana y no toca el `transform` del editor. No se puede seleccionar, mover ni editar nada.
- Se dibujan solo las relaciones entre tablas del conjunto. La raíz va resaltada.
- La cabecera muestra «Relacionadas con: `<tabla>`», el selector de alcance, el número de tablas mostradas, el botón «Enfocar en el lienzo» y el botón de cerrar.
- Alcance inicial: 1 salto _(mi decisión)_.
- Las tablas ocultas con el ojito sí aparecen en la ventana, con un aspecto que indique que están ocultas en el diagrama _(mi decisión: la ventana es para entender las relaciones)_.
- Si la tabla no tiene relaciones, se ve sola con el mensaje «Esta tabla no tiene relaciones» _(mi decisión)_.
- Si mientras está abierta un compañero cambia el diagrama, la ventana se actualiza. Si borran la tabla raíz, la ventana se cierra con un aviso _(mi decisión)_.
- Vistas, notas y áreas no aparecen en la ventana _(mi decisión)_.

### Modo enfocado

- Es estado local de React y nunca se persiste: `{ rootId, depth } | null`. Recargar la página lo desactiva _(mi decisión)_.
- El conjunto enfocado se recalcula a partir del diagrama vivo cada vez que este cambia. Así:
  - si alguien crea una relación hacia una tabla atenuada, esa tabla entra en el grupo;
  - si alguien borra la relación, la tabla sale del grupo.
- **Tablas nuevas:** una tabla creada por **esta** persona mientras el modo está activo entra en el grupo aunque todavía no tenga relaciones _(mi decisión)_. Se guarda un `Set` local de ids «añadidos a mano». Cuentan solo dos acciones explícitas de la interfaz: el botón «Añadir tabla» y «Duplicar» (menú y Ctrl+D) _(mi decisión)_. No cuentan pegar, el editor DBML, el undo/redo ni las tablas de compañeros. El enganche va en esas acciones de UI, no dentro de `addTable` en `DiagramContext`.
- Barra superior sobre el lienzo con «Enfocado: `<tabla>`», el selector de alcance (1/2/3/Todo), el número de tablas y el botón «Salir». La tecla `Esc` también sale cuando el foco no está en un campo de texto _(mi decisión)_.
- **Tablas atenuadas:** opacidad de alrededor del 20 %, `pointer-events: none`. No se pueden seleccionar, arrastrar ni abrir su menú _(mi decisión, para no tocarlas por accidente)_. Tampoco entran en la selección por arrastre de rectángulo.
- **Excepción al enlazar:** mientras se arrastra para crear una relación desde una tabla del grupo, las tablas atenuadas sí aceptan soltar el enlace _(mi decisión)_. Al crearse la relación, la tabla destino entra en el grupo por el recálculo. Esto toca la lógica de enlace y de punteros de `Canvas.jsx`, no solo el booleano `dimmed`.
- **Relaciones:** se atenúan las que tengan algún extremo fuera del grupo; las internas se ven normal.
- **Exportar imagen o PDF ignora el modo enfocado** _(mi decisión)_: con `exporting` activo no se atenúa nada, porque el enfoque es personal y lo exportado se comparte.
- Vistas, notas y áreas se atenúan igual _(mi decisión)_.
- Al entrar en el modo, la vista se ajusta al grupo con `fitTransform`, sobre el `transform` personal _(mi decisión)_.
- Si se borra la tabla raíz, se sale del modo con un aviso _(mi decisión)_.
- La lista del panel izquierdo no cambia: sigue mostrando todas las tablas _(mi decisión)_.
- Funciona también para usuarios con rol viewer y durante la previsualización de versiones, porque no escribe nada; en esos casos simplemente no hay edición _(mi decisión)_.
- Rendimiento: el conjunto se calcula con `useMemo` dependiente de `tables`, `relationships` y el estado del enfoque, nunca del `transform`. Los componentes reciben un booleano `dimmed`.

## Dónde se toca (orientativo)

- `src/utils/relatedTables.js` (nuevo) + prueba.
- `src/context/` → nuevo contexto ligero de enfoque (`FocusContext`) o ampliación de un contexto existente, más su hook en `src/hooks/`.
- `src/components/EditorSidePanel/TablesTab/SearchBar.jsx` y `TablesTab.jsx`.
- `src/components/EditorCanvas/Canvas.jsx`, `Table.jsx`, `Relationship.jsx`, `View.jsx`, `Note.jsx` y `Area.jsx` para el atenuado.
- Nuevo componente de la ventana, por ejemplo `src/components/EditorCanvas/RelatedTablesModal.jsx`, y la barra de enfoque.
- `src/i18n/locales/es.js` y `en.js` para todos los textos nuevos.

## Pruebas mínimas

- `relatedTables`: profundidad 1/2/3/Todo, ciclos, autorreferencias, relaciones huérfanas y tabla sin relaciones.
- Búsqueda: columnas con el mismo nombre en tablas distintas dan opciones distintas; elegir `pagos.id` abre `pagos` y no otra tabla; filtrado sin distinguir mayúsculas ni acentos.
- Cálculo de «Ubicar»: pan correcto para una tabla dada y zoom mínimo aplicado.
- Enfoque: el conjunto cambia al añadir o quitar una relación; una tabla creada localmente entra en el grupo.
- Que el modo enfocado no genere operaciones de colaboración ni entradas de undo. Se comprueba en revisión y, si es viable, con una prueba.
- `npm test` y `npm run lint` en verde.

## Queda a criterio de quien construye

- El componente exacto de Semi UI para el autocompletado.
- La forma visual del destello de «Ubicar» y de los distintivos tabla/columna.
- El tamaño del modal y si el mini-lienzo reutiliza `SimpleCanvas.jsx` o es nuevo.
- Iconos, siempre que sean de `@douyinfe/semi-icons`.
