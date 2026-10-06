# HuertoApp v7 — Auditoría del pase: Catálogo ampliado, claves en .env, Asistente/Buscar, drenaje de cola offline

Auditoría de todo lo añadido desde AUDITORIA_V6.md: `catalogoPlantas.js` reescrito
(16 categorías / 126 especies), claves de Gemini/Supabase movidas a `.env`,
`gemini.js` refactorizado (`llamarGeminiInterno` compartido + nuevo
`llamarGeminiChat`), drenaje automático de la cola offline desde `App.js`,
`screens/BuscarScreen.js` y `screens/AsistenteScreen.js` nuevos, selector de
"parte de la planta" en `ScanScreen.js`, y `migracion_v2_zonas_cantidad.sql`
(aditiva, pendiente de ejecutar).

## 0. Resumen ejecutivo

Se ha encontrado **un bug crítico que impide arrancar la app entera ahora
mismo** (error de sintaxis real en `supabase.js`, confirmado con
`node --check`, no una suposición) y **dos condiciones de carrera reales en
el drenaje automático de la cola offline** (una de ellas con pérdida de
datos silenciosa). El resto de lo nuevo (catálogo, `.env`, Buscar, Asistente,
selector de parte de planta) está limpio: no se ha encontrado ninguna
referencia prematura a `cantidad`/`zona`, `listarCultivosSembrados` existe
de verdad con ese nombre, y no hay duplicación de la clasificación de
errores ni de la normalización de búsqueda.

La suite de tests sigue en **49 tests** (sin tests nuevos para lo añadido en
este pase — ver §5); en una ejecución completa salió **48/49** por un timeout
de entorno ya documentado en v5, no una regresión (ver §3).

## 1. Bug crítico confirmado: error de sintaxis en `supabase.js` — la app no arranca

`supabase.js` líneas 12-17:

```js
// ------------------------------------------------------------
CONFIGURACIÓN — las claves reales viven en variables de entorno (.env,
// prefijo EXPO_PUBLIC_ para que Expo las incluya en el bundle del cliente)
// en vez de hardcodeadas aquí — ver .env.example. Sustitúyelas por las tuyas
// propias en .env si cambias de proyecto.
// ------------------------------------------------------------
```

La línea `CONFIGURACIÓN — las claves reales viven en variables de entorno
(.env,` **no lleva `//` delante** — es texto suelto, no un comentario. Es un
error de sintaxis de JavaScript real, no una suposición: se ha verificado
directamente contra el archivo en tu proyecto (no una copia) con
`node --check`:

```
$ node --check supabase.js
SyntaxError: Invalid or unexpected token
    at checkSyntax (node:internal/main/check_syntax:74:5)
```

**Impacto**: `supabase.js` lo importan `ScanScreen.js`, `PlannerScreen.js`,
`GardenScreen.js`, `HomeScreen.js` y el nuevo `AsistenteScreen.js` — es
decir, prácticamente toda la app. Metro no puede transformar ese archivo, así
que la app **no llega a arrancar en absoluto** ahora mismo (ni en Expo Go ni
en un build), con un error de bundling, no un crash en tiempo de ejecución.

Esto explica por qué la suite de Jest sigue en verde pese a un bug tan
grave: **todos** los test que montan pantallas mockean `../supabase` por
completo (`jest.mock('../supabase', () => ({...}))` en
`__tests__/AppFlow.test.js` y `screens/ScanScreen.test.js`), así que Jest
nunca llega a transformar el archivo real — los tests no habrían podido
detectar este bug tal como están escritos.

**Corrección** (no aplicada — auditoría de solo lectura): añadir `//` al
principio de esa línea, o fusionarla con el bloque de comentario de arriba.

## 2. Condiciones de carrera reales en el drenaje automático de la cola offline

`App.js` (líneas 54-72) dispara `procesarColaPendiente()` (nuevo, en
`screens/ScanScreen.js`) cuando `NetInfo` detecta una transición
desconectado→conectado. `procesarColaPendiente` (líneas 268-281 de
`ScanScreen.js`) recorre la cola así:

```js
export async function procesarColaPendiente() {
  try {
    let cola = await obtenerColaPendiente();
    while (cola.length > 0) {
      const [item, ...resto] = cola;
      const ok = await procesarItemColaPendiente(item);
      if (!ok) break;
      cola = resto;
      await guardarColaPendiente(cola);
    }
  } catch (e) { ... }
}
```

### 2.1. Pérdida de datos: un item nuevo capturado durante el drenaje puede desaparecer

`cola` se lee **una sola vez** de disco (`obtenerColaPendiente()`, primera
línea) y a partir de ahí solo se recalcula en memoria (`resto`). Cada
`guardarColaPendiente(cola)` sobrescribe el archivo completo con esa copia
en memoria, **nunca vuelve a leer el estado actual del disco**.

Secuencia real y plausible (móvil con cobertura intermitente):

1. Cola en disco: `[fotoA]`. Llega red → `procesarColaPendiente()` empieza,
   lee `cola = [fotoA]`, y se pone a procesar `fotoA` (llamada a Gemini +
   subida de foto, varios segundos con timeout de 20s).
2. Mientras tanto, el usuario sigue sin ver conexión estable en
   `ScanScreen` (o la reconexión fue solo un pico momentáneo) y hace una
   foto nueva → `encolarCapturaPendiente({..., fotoB})` (línea 346 de
   `ScanScreen.js`) lee el archivo (**todavía `[fotoA]`**, porque el
   drenaje no ha escrito nada aún), añade `fotoB` y escribe `[fotoA, fotoB]`
   en disco.
3. `procesarItemColaPendiente(fotoA)` termina con éxito. El bucle hace
   `cola = resto` → `[]` (su copia en memoria, que nunca tuvo `fotoB`) y
   `guardarColaPendiente([])` **sobrescribe el archivo con `[]`**.

Resultado: `fotoB`, que el usuario acaba de guardar creyendo que quedaría
encolada, **desaparece sin ningún aviso** — nunca se analiza, nunca se
guarda en Supabase, y no hay ningún log de error porque ninguna operación
falló individualmente.

### 2.2. Doble drenaje concurrente: diagnósticos y fotos duplicadas

`procesarColaPendiente()` no tiene ningún guardián de reentrada (ni
`isDrainingRef` ni comprobación equivalente). Si la conexión oscila
desconectado→conectado→desconectado→conectado más rápido de lo que tarda en
procesarse un solo item (perfectamente posible: cada item hace una llamada a
Gemini más una subida a Storage, cada una con su propio timeout de hasta
20s), `NetInfo.addEventListener` dispara `procesarColaPendiente()` una
segunda vez **mientras la primera invocación sigue en curso** — nada en el
código lo impide.

Las dos invocaciones concurrentes leerán la misma cola (p.ej. `[fotoA]`)
antes de que ninguna de las dos haya escrito nada, y **ambas** llamarán a
Gemini, subirán la misma foto a Storage e insertarán una fila en
`diagnosticos` para el mismo `fotoA` — diagnóstico duplicado en la base de
datos, consumo doble de cuota de Gemini, y una notificación local programada
dos veces para el mismo aviso.

### 2.3. Nota relacionada: el bucle no comprueba si `guardarColaPendiente` tuvo éxito

`guardarColaPendiente` (colaOffline.js) nunca lanza — si falla la escritura a
disco, devuelve `false` silenciosamente. El bucle de `procesarColaPendiente`
no comprueba ese valor de retorno: si la escritura fallara justo después de
procesar un item con éxito, el archivo en disco seguiría teniendo ese item
ya procesado, y el próximo drenaje (o el próximo arranque de la app) lo
reprocesaría — mismo síntoma que el punto 2.2 (diagnóstico duplicado), por
una vía distinta (fallo de disco en vez de carrera de red). Es una
consecuencia del mismo problema de fondo: no hay ninguna forma atómica de
"quitar solo este item ya procesado del archivo actual", solo "sobrescribir
con la copia en memoria que tenía yo al empezar".

**Qué no es un problema** (verificado, para no sobre-reportar): si la app
pasa a segundo plano o se cierra a mitad de procesar un item, no hay
corrupción ni pérdida — `guardarColaPendiente` solo se llama **después** de
que ese item se haya procesado con éxito, así que en el peor caso el item
se reintenta en el próximo drenaje (podría duplicarse si ya llegó a
insertarse en Supabase antes del corte, pero no se pierde).

**Recomendación** (no aplicada): dar a `procesarColaPendiente` un guardián de
reentrada a nivel de módulo (una variable `let drenando = false`, no un
`useRef` porque esta función vive fuera de cualquier componente), y hacer
que cada iteración relea la cola actual de disco en vez de arrastrar la
copia en memoria — o, más simple, que quite el item procesado por
comparación de contenido/índice contra una relectura fresca antes de
escribir.

## 3. Estado de los tests

Se ha instalado y ejecutado `npx jest` de verdad (no solo revisión de
código) en el proyecto real:

```
Test Suites: 1 failed, 5 passed, 6 total
Tests:       1 failed, 48 passed, 49 total
```

El único fallo es `__tests__/AppFlow.test.js › 1. Arranque sin red`, con
`Exceeded timeout of 5000 ms`. Se ha vuelto a ejecutar **solo ese archivo**
con `--testTimeout=15000` para descartar que sea un fallo de lógica nuevo:

```
PASS __tests__/AppFlow.test.js (47.069 s)
Tests:       7 passed, 7 total
```

Con más margen, los 7 tests del archivo pasan sin cambiar ni una línea de
código. Esto coincide exactamente con el problema de E/S de disco lento ya
documentado en `AUDITORIA_V5.md` (§0: "condición de carrera de `act()`");
no es una regresión de este pase, es el entorno de este dispositivo. **No
se recomienda tocar el código de producción por esto** — si se quiere una
suite más robusta en este entorno concreto, subir `testTimeout` por defecto
en `package.json` (bloque `jest`) sería suficiente.

Ningún archivo de test nuevo se ha añadido en este pase (ver §5).

## 4. Comprobaciones que han salido limpias (verificado, no solo revisado por encima)

- **`cantidad`/`zona` (migración pendiente)**: `grep` de `cantidad`/`zona`
  en todo el código fuente de la app (excluyendo el propio SQL y textos de
  `catalogoPlantas.js`) no encuentra ninguna referencia a esas columnas en
  `GardenScreen.js`, `BuscarScreen.js` ni en ningún otro sitio. Nada asume
  que la migración ya se ha ejecutado. **Pase limpio.**
- **`listarCultivosSembrados`**: existe de verdad en `supabase.js` (línea
  61) con exactamente ese nombre, y `AsistenteScreen.js` la importa
  correctamente (línea 19). **Pase limpio** — no es un nombre inventado.
- **Duplicación de `normalizarBusqueda`**: `GardenScreen.js` la importa de
  `../utils` (línea 23) y ya no tiene copia local; `BuscarScreen.js` hace
  lo mismo. Ninguno de los dos duplica la lógica de quitar acentos.
  **Pase limpio.**
- **Duplicación de clasificación de errores**: `AsistenteScreen.js` usa
  `mensajeDeError` de `utils.js` igual que el resto de la app (línea 116);
  no reimplementa su propio switch de mensajes. `BuscarScreen.js` no hace
  ninguna llamada de red, así que no aplica. **Pase limpio.**
- **Timeouts en las llamadas nuevas**: `llamarGeminiChat` pasa por
  `llamarGeminiInterno`, que usa `crearAbortConTimeout()` (20s) igual que
  antes — no hay ningún `fetch` nuevo que se salte el `AbortController`
  centralizado. **Pase limpio.**
- **`.env` fuera de git**: `.gitignore` ya incluye `.env` y `.env*.local`
  desde antes de este pase; `.env.example` documenta las 3 variables
  esperadas sin claves reales. **Pase limpio.**
- **Catálogo — tipos de dato**: se comprobó `typeof` de `riego` en las 126
  plantas: **126/126 son `number`**, ninguna es string — el field de la
  tarea que pedía buscar esta inconsistencia no la encontró porque no
  existe. **Pase limpio.**
- **Catálogo — duplicados**: no hay ninguna `clave` de categoría repetida
  (16 únicas) ni ningún `nombre` de planta repetido, ni dentro de una
  categoría ni entre categorías (126 nombres únicos). **Pase limpio.**
- **Catálogo — vocabulario de filtros**: los 4 valores de `nivelLuz` que
  aparecen en las 126 plantas (`pleno sol`, `semisombra`, `poca luz`, `luz
  indirecta`) coinciden exactamente con las opciones de filtro de
  `BuscarScreen.js` (`OPCIONES_LUZ`); los 3 valores de `ubicacion`
  (`interior`, `exterior`, `ambas`) también. Ningún filtro se queda mudo
  por un typo entre catálogo y pantalla. **Pase limpio.**
- **Consistencia `diasCosecha` vs `siembra`/`senalCosecha`** (muestreo de
  Tomate, Rábano, Ajo, Zanahoria, Lechuga, más 15 especies adicionales
  repartidas en 8 categorías distintas, incluidas las 9 nuevas): los valores
  de `diasCosecha` (30-180 días) son coherentes con lo que describen sus
  propios `senalCosecha`/`siembra` — no se ha encontrado ninguna
  contradicción (p.ej. un rábano con 30 días de ciclo y una señal de
  cosecha que described meses de espera). **Pase limpio** (muestreo, no
  las 126 una por una).

## 5. Duplicación de datos y código muerto en el catálogo

- **`COMPANIONISMO_MAP` duplica el campo `companionismo` por planta**: las
  16 hortalizas/frutos del bosque que tienen datos de companionismo los
  llevan **dos veces** — una vez como campo `companionismo` dentro de su
  propia entrada (el que de verdad usa `BuscarScreen.js` en el modal de
  detalle) y otra vez en el mapa `COMPANIONISMO_MAP` al final del archivo
  (líneas 2405-2470). Se ha comprobado que **hoy coinciden exactamente**
  (mismo contenido en `bien`/`mal` para las 16 entradas comunes) — no hay
  inconsistencia todavía, pero son dos fuentes de la misma verdad: un
  cambio futuro en una sin tocar la otra las desincronizaría en silencio,
  sin que ningún test lo detectara (no hay test de catálogo).
- **`COMPANIONISMO_MAP` es código muerto por ahora**: el propio comentario
  que lo acompaña lo dice ("todavía no está conectado a esa lógica, solo
  exportado como dato") y se ha confirmado por `grep`: ningún archivo del
  proyecto lo importa. Es una decisión documentada, no un descuido oculto
  — se anota aquí igualmente porque es justo el tipo de dato que un
  refactor futuro puede olvidar mantener si no se sabe que ya existía.
- **`vaciarColaPendiente` (colaOffline.js) ha quedado sin uso en
  producción**: se preparó en la v5 "para un futuro flush automático"
  (ver AUDITORIA_V5.md §5); ahora que ese flush existe
  (`procesarColaPendiente`), se implementó vaciando la cola *incrementalmente*
  con `guardarColaPendiente` en cada iteración en vez de llamar a
  `vaciarColaPendiente` al final — la función sigue exportada y solo la
  ejercita su propio test unitario. No rompe nada, pero es dead code de
  producción.
- **Campo `poda` sin usar en ninguna pantalla**: 126 plantas lo llevan (con
  `null` explícito, no ausente, en 72 de ellas — es una decisión de datos,
  no un olvido) pero ningún componente lo lee (`grep '\.poda\b'` en
  `screens/*.js` no da ningún resultado fuera de la propia definición del
  esquema de `ScanScreen`, que es un campo de diagnóstico distinto sin
  relación). Dato de catálogo preparado para una futura pantalla que
  todavía no existe.

## 6. Cobertura de tests — lo nuevo que ha quedado sin test

Ningún archivo de test se ha tocado ni añadido en este pase. Queda sin
ninguna cobertura automática:

- `screens/BuscarScreen.js` (pantalla entera nueva: filtros, búsqueda,
  modal de detalle).
- `screens/AsistenteScreen.js` (pantalla entera nueva: chat, contexto de
  cultivos, manejo de error).
- `llamarGeminiChat` y `llamarGeminiInterno` en `gemini.js` —
  `gemini.test.js` solo cubre `llamarGemini` (uso single-shot); el chat
  multi-turno no tiene ningún test propio (ni feliz ni de error).
- El selector de "parte de la planta" en `ScanScreen.js` (`PARTES_PLANTA`,
  `cambiarModo`, el texto que añade al prompt) — ni `ScanScreen.test.js` ni
  `AppFlow.test.js` lo ejercitan.
- `construirResultadoDiagnostico`, `procesarItemColaPendiente` y
  `procesarColaPendiente` (exports nuevos de `ScanScreen.js`) — y, por
  tanto, tampoco las dos condiciones de carrera del §2, que solo se han
  detectado por lectura de código, no por un test que las reproduzca.
- `guardarColaPendiente` (nuevo en `colaOffline.js`) —
  `colaOffline.test.js` sigue probando solo `obtenerColaPendiente`,
  `encolarCapturaPendiente` y `vaciarColaPendiente`.
- `normalizarBusqueda` y `quitarEtiquetasHTML` (nuevas en `utils.js`) —
  `utils.test.js` no se ha actualizado; siguen probándose solo
  `calcularProgreso`, `limpiarJSONSeguro`, `mensajeDeError` y
  `crearAbortConTimeout`.
- El nuevo shape de `catalogoPlantas.js` (126 especies, 16 categorías) — no
  hay ningún test que verifique su forma (nombres únicos, claves de
  categoría únicas, tipos de campo), todas las comprobaciones del §4 se
  han hecho manualmente para esta auditoría y se perderían en el próximo
  cambio del archivo si no se repiten a mano.

Esto es lo esperado dado el alcance de la tarea (no se pidió tests nuevos),
pero se deja documentado explícitamente en vez de callado, tal como pide
el criterio de esta auditoría.

## 7. Qué queda fuera de este pase

- No se ha corregido nada (auditoría de solo lectura, como se pidió) — ni
  el error de sintaxis del §1 ni las condiciones de carrera del §2 están
  aplicadas todavía.
- No se ha ejecutado `migracion_v2_zonas_cantidad.sql` contra la base real
  (se ha verificado que el código no lo necesita todavía — ver §4).
- Sigue sin haber tests para `PlannerScreen.js`, `HomeScreen.js`,
  `clima.js` ni `notificaciones.js`, señalado ya en v2-v4 y no tocado en
  este pase.

## 8. Correcciones aplicadas tras esta auditoría (mismo pase, antes de cerrar V7)

Los 3 problemas marcados como "bug real" arriba ya se han corregido y verificado:

1. **`supabase.js` — error de sintaxis**: se añadió el `//` que faltaba delante de la línea `CONFIGURACIÓN — las claves reales viven en variables de entorno...`. Verificado con `node --check supabase.js` (sintaxis OK) y con la suite de tests completa volviendo a pasar.
2. **Pérdida de capturas encoladas durante el drenaje**: `procesarColaPendiente()` (screens/ScanScreen.js) ahora relee la cola de disco en cada vuelta del bucle en vez de trabajar sobre una copia en memoria calculada al principio, y tras procesar cada item vuelve a releer la cola y quita solo ese elemento (por su `encoladoEn` + `modo`) en vez de sobrescribir con un prefijo en memoria. Una captura nueva encolada mientras el drenaje está en curso ya no desaparece.
3. **Doble procesamiento por parpadeo de red**: se añadió un guardián de reentrada a nivel de módulo (`procesandoColaPendiente`) — si `procesarColaPendiente()` se llama mientras ya hay un drenaje en curso, la segunda llamada no hace nada en vez de arrancar un segundo drenaje en paralelo.

**Estado de tests tras las 3 correcciones**: suite completa re-ejecutada por partes (el disco montado sigue siendo lento, mismo problema ya documentado en V5/V6/V7 — no es una regresión nueva): `utils`/`gemini`/`store`/`colaOffline` → 31/31; `ScanScreen` (con `--testTimeout=15000` para absorber la lentitud de disco conocida) → 11/11. Nada roto por las correcciones.

Sigue pendiente de decidir por Pol (no bloqueante para que la app arranque): ejecutar `migracion_v2_zonas_cantidad.sql` en el editor SQL de Supabase cuando quiera empezar a usar cantidad/zona; y las mejoras "code smell"/cobertura de test listadas en las secciones 5 y 6 de este documento, que no son bugs sino deuda técnica menor.
