# Arrastre y redimensionado fluidos en diagramas grandes — Diseño

Fecha: 2026-10-24 · Repo: `drawdb` (solo frontend; el backend no cambia)

## Por qué

Con pocas tablas, mover una tabla o cambiarle el ancho es fluido. Con muchas se vuelve lento. El dueño lo nota en el proyecto local **«Load Test 200 Entities»** (`01a164ff-0000-7000-8000-000000000200`, 200 tablas y 250 relaciones).

### Lo que se midió (2026-10-24)

Mediciones hechas con Chromium headless controlado por Playwright sobre ese proyecto, con zoom 5 % (vista simplificada):

| Prueba                                                    | Resultado                                      |
| --------------------------------------------------------- | ---------------------------------------------- |
| Arrastrar una tabla 120 pasos (servidor de desarrollo)    | 679 s, unos **5,6 s por movimiento**, ~0,8 fps |
| Redimensionar el ancho 120 pasos (servidor de desarrollo) | 687 s, prácticamente igual                     |
| Perfil de CPU de 6 movimientos (build de producción)      | 30,7 s, unos **5 s por movimiento**            |

Perfil de CPU de 4 movimientos (desarrollo, 24,6 s): unos **15 s** en `findIssues` (`src/components/EditorSidePanel/Issues.jsx`) → `getIssues` → `checkCircularRelationships` (`src/utils/issues.js`). Casi todo lo demás es i18next formateando mensajes de problemas y React volviendo a dibujarlos. Le siguen la lista lateral de tablas (`TableListItem`, unos 300 ms por movimiento en desarrollo), y bastante después `Relationship`, `TableEditSheet` y `Canvas`.

La causa:

1. **`checkCircularRelationships` recorre todos los caminos del grafo.** No recuerda qué tablas ya terminó de revisar, copia el arreglo `visited` en cada paso y en cada tabla recorre todas las relaciones. En este diagrama tarda **~1,2 s** por llamada (medido en Node) y genera **46.313 mensajes** de dependencia circular, que en realidad corresponden a **76 tablas distintas**.
2. **El panel «Problems» se recalcula en cada cambio de `tables`.** Mover o redimensionar cambia `x`, `y` o `width` en cada `pointermove`, así que la validación entera, la traducción de los mensajes y el dibujo de la lista se repiten en cada paso, aunque ninguno de esos datos influye en los problemas.
3. **La lista lateral redibuja sus 200 elementos en cada paso**, porque cada uno escucha la lista completa de tablas.

El lienzo ya dibuja solo lo visible (`cullElements`) y su costo es pequeño comparado con lo anterior.

## Objetivos

1. Mover una tabla (sola o con selección múltiple) y redimensionar su ancho se siente fluido en el proyecto de 200 tablas, con zoom lejano y con zoom cercano.
2. El panel «Problems» sigue mostrando los mismos tipos de problema, pero cada dependencia circular aparece **una sola vez**.
3. Los compañeros siguen viendo la tabla moverse **en vivo** mientras se arrastra.

### Criterio de éxito (medible)

Con el **build de producción**, en el proyecto «Load Test 200 Entities», arrastrando 120 pasos y redimensionando 120 pasos, a zoom 5 % y a un zoom donde las tablas se ven con detalle (≥ 35 %):

- mediana del tiempo entre cuadros ≤ 20 ms y percentil 95 ≤ 50 ms;
- ninguna tarea larga (long task) de más de 100 ms durante el gesto.

La medición se hace con el mismo método que la línea base (Playwright, `requestAnimationFrame` y `PerformanceObserver('longtask')`). Ver «Cómo medir».

**Decisiones de Claude sobre el criterio:**

- **Entorno de referencia:** Chromium headless en el WSL del dueño, el mismo de la línea base. Antes de medir se hace un gesto de calentamiento y luego se toma la mediana de 3 corridas. Además, el dueño lo prueba a mano en su navegador; esa prueba es la confirmación final.
- **Si tras los puntos 1–4 no se alcanza el criterio:** se para y se reporta al dueño con números. No se pasa a técnicas que eviten el estado de React durante el arrastre, ni se cambia la colaboración o el undo, sin su visto bueno.
- **Movimiento en vivo para los compañeros:** se comprueba a mano con dos navegadores, como en las features anteriores. No hace falta una prueba automática con dos clientes.

## No objetivos

- No cambia el backend, el formato del diagrama, el protocolo de colaboración ni el undo/redo.
- No se optimizan el pan ni el zoom: el dueño confirmó que solo es lento mover y redimensionar tablas.
- No se reescribe el dibujo del lienzo (canvas, WebGL o similares).
- No se cambian notas, áreas ni vistas, salvo que se muevan junto con tablas en una selección múltiple y ya funcionen con la misma ruta.

## Anti-objetivos (sería un fracaso aunque funcione)

- **Que los compañeros dejen de ver el movimiento en vivo.** Decisión del dueño: si la tabla solo aparece en su nuevo lugar al soltarla, los demás la pierden de vista y tienen que buscarla. Hoy los cambios locales salen en lotes cada 50 ms (`ProjectSession.observe` → `client.local`). Ese comportamiento debe seguir igual: la posición se envía **durante** el arrastre, no solo al soltar.
- **Que el panel «Problems» oculte problemas reales o quede desactualizado.** Después de editar la estructura (nombres, campos, relaciones, tipos, enums, vistas), los problemas deben reflejar el diagrama actual.
- **Que se rompa deshacer/rehacer del movimiento o del ancho.** Debe seguir siendo una sola entrada por gesto, como ahora.

## Decisiones del dueño

- El alcance es **mover y redimensionar tablas**.
- **Selección múltiple:** lo habitual es mover entre 5 y 20 tablas juntas, y el criterio de éxito también se aplica a 20 tablas seleccionadas. Mover más de 20 es una reubicación poco frecuente: debe funcionar, pero no se exige que sea fluido. No se agrupan las actualizaciones por tabla ni se toca la colaboración para ese caso.
- Los compañeros deben ver el movimiento en vivo (ver anti-objetivos).
- La prueba se hace en el proyecto local «Load Test 200 Entities» con Playwright.
- La ejecución del plan sigue el mismo esquema que la feature anterior: cada tarea la implementa **una instancia de Cline CLI**, las tareas de una oleada corren **en paralelo**, cada una en su git worktree, y Claude revisa e integra en la rama de la feature. Ver la sección «Ejecución en paralelo (Cline)» de `docs/superpowers/plans/2026-10-23-busqueda-y-tablas-relacionadas.md`.
- Sin merge a `main` ni push hasta que el dueño lo indique.

## Diseño

### 1. Detección de dependencias circulares en tiempo lineal

En `src/utils/issues.js` se reemplaza `checkCircularRelationships` por una detección de ciclos que visita cada tabla y cada relación una sola vez (DFS con tres estados: sin visitar, en curso y terminada; o un algoritmo equivalente, a criterio de quien implemente). Debe:

- ignorar, como hoy, las relaciones de una tabla consigo misma (`startTableId === endTableId`);
- seguir la misma dirección que hoy: de `startTableId` a `endTableId`;
- emitir el mensaje `circular_dependency` **una vez por tabla** donde se detecta que el ciclo se cierra (el destino de la arista que vuelve a una tabla en curso), sin repetir tablas;
- ser determinista: con el mismo diagrama, mismos mensajes en el mismo orden. Se recorren las tablas en el orden de `diagram.tables` y las relaciones en el orden de `diagram.relationships`;
- precalcular un índice `startTableId → relaciones` y un mapa `id → tabla`, en lugar de `forEach` y `find` en cada paso.

Las demás comprobaciones de `getIssues` no cambian.

**Decisión de Claude:** una vez por tabla. Pasar de 46.313 mensajes a «un mensaje por cada tabla donde se cierra un ciclo» mantiene el aviso útil, y en este diagrama no supera las 76 tablas distintas que salen hoy. No se busca listar cada ciclo completo.

### 2. El panel «Problems» no se recalcula por posición ni ancho

`getIssues` no lee `x`, `y` ni `width` de las tablas. El panel debe dejar de recalcular cuando solo cambian esos campos.

Enfoque (decisión de Claude): la validación depende de una «firma estructural» del diagrama que no incluye `x`, `y` ni `width`. Mientras la firma no cambie, se reutiliza el resultado anterior. Quien implemente elige cómo:

- una función pura `structuralKey(tables)`, o una lista estructural memoizada, que compare cada tabla sin esos tres campos; se puede reutilizar la referencia anterior cuando la tabla no cambió fuera de ellos;
- o un selector que reconstruya `tables` sin campos de posición y conserve las referencias cuando el contenido estructural no cambió.

Además:

- el cálculo deja de vivir en un `useEffect` que depende de `issues` y llama a `setIssues`, porque eso provoca un render extra; pasa a un `useMemo` (o equivalente);
- se mantiene la comparación `arrayIsEqual` solo si sigue siendo necesaria.

Una pausa (debounce) no basta como solución única: durante un arrastre largo el cálculo se dispararía igual en cuanto el usuario se detenga un momento. Si quien implementa quiere añadirla como capa extra, puede.

### 3. La lista lateral no se redibuja por posición ni ancho

En `src/components/EditorSidePanel/TablesTab/TablesTab.jsx`, cada elemento de la lista (`TableListItem` y lo que dibuja) no debe volver a dibujarse cuando solo cambian `x`, `y` o `width` de **cualquier** tabla, ni cuando cambia otra tabla.

La lista no muestra la posición ni el ancho. Si algún subcomponente sí los necesita, por ejemplo el editor de una tabla abierta, debe seguir actualizándose para esa tabla.

Cómo lograrlo queda a criterio de quien implemente: `memo` con una comparación que ignore esos campos, pasar a cada elemento solo su tabla en lugar de leer `tables` del contexto, o algo equivalente. Restricción: no cambiar el contrato de `DiagramContext` para el resto de la app. Los demás consumidores de `useDiagram()` deben seguir funcionando sin cambios.

### 4. Volver a medir y, solo si hace falta, el lienzo

Después de 1–3, se repite la medición. Si se cumple el criterio de éxito, el trabajo termina.

Si no se cumple, el siguiente paso es el lienzo, en `src/components/EditorCanvas/Canvas.jsx` y `Table.jsx`:

- que `FieldSummary` y `TableEditSheet` no lean `tables` completas del contexto en cada paso;
- que `tableBoxes` solo recalcule la caja de la tabla que cambió;
- que las tablas que no se mueven no se vuelvan a dibujar.

Esto queda condicionado a la medición, y el plan debe tratarlo como una tarea opcional.

### Lo que no cambia

- `updateTable` sigue actualizando el estado en cada `pointermove`. La tabla sigue al cursor y la colaboración envía en lotes de 50 ms, como hoy.
- El undo/redo del arrastre (`handlePointerUp` en `Canvas.jsx`) y del ancho (`commitResize` en `Table.jsx`) no se tocan.
- `ResizeHandles.jsx` no cambia su comportamiento.

## Pruebas

- **Unitarias (vitest, entorno `node`)** en `src/utils/issues.test.js` (nuevo):
  - un diagrama sin ciclos no da mensajes `circular_dependency`;
  - un ciclo simple A→B→A da un mensaje;
  - un ciclo largo y varios ciclos que comparten tablas no repiten tablas;
  - una relación de una tabla consigo misma no cuenta;
  - un grafo grande, generado con semilla fija (200 tablas, 250 relaciones con varios ciclos), termina en menos de 50 ms y es determinista.
- **Firma estructural:** si se implementa como función pura en `src/utils/`, lleva prueba: cambiar `x`, `y` o `width` no cambia la firma, y cambiar nombre, campos, `collapsed`, `hidden` o comentario sí la cambia.
- `npm test && npm run lint` pasan.

## Cómo medir

La línea base se tomó con un script en el scratchpad de la sesión, fuera del repo. **Decisión de Claude:** para que la medición se pueda repetir, se añade `scripts/perf/drag-resize.mjs` al repo, con `playwright-core` como dependencia de desarrollo. El script:

- lee `ADMIN_EMAIL` y `ADMIN_PASSWORD` del `.env` de `drawdb-server` (ruta configurable por variable de entorno) e inicia sesión con `POST /api/auth/login`;
- abre `/projects/<id>`; el id es configurable y por defecto apunta a «Load Test 200 Entities»;
- ajusta el zoom con Ctrl + rueda, arrastra 120 pasos una tabla sola, arrastra 120 pasos una selección de 20 tablas (selección por rectángulo o con Ctrl+clic) y redimensiona 120 pasos;
- imprime la mediana y el p95 del tiempo entre cuadros y el número de tareas largas;
- **deja el proyecto como estaba** (decisión de Claude): al terminar deshace sus gestos con Ctrl+Z y comprueba que `x`, `y` y `width` de las tablas tocadas volvieron a sus valores iniciales. Si no volvieron, avisa con un error. Los guardados locales funcionan, así que sin este paso el proyecto quedaría modificado.

Notas del entorno (WSL del dueño):

- el Chromium de Playwright (`~/.cache/ms-playwright/chromium-1140`) necesita `libnss3`, `libnspr4` y `libasound2`, que no están instaladas. Sin `sudo` se pueden descargar con `apt-get download libnss3 libnspr4 libasound2t64`, extraerlas con `dpkg-deb -x` en una carpeta temporal y usarlas con `LD_LIBRARY_PATH`. El script debe documentarlo en un comentario;
- la medición válida es contra el **build de producción** (`vite build` + `vite preview`, que usa el mismo proxy `/api`), no contra `vite dev`;
- la migración local pendiente (`20261023211307_historial_versiones`) se aplicó el 2026-10-24, así que los guardados locales ya funcionan. Por eso el script **tiene** que deshacer sus gestos al final.

## Lo que queda a criterio de quien implemente

- El algoritmo concreto de detección de ciclos, mientras cumpla lo descrito en el punto 1.
- Cómo se calcula la firma estructural y dónde vive.
- La técnica para que la lista lateral no se redibuje.
- La división en tareas, respetando que las tareas de una misma oleada toquen archivos distintos para poder correr en paralelo con Cline.
