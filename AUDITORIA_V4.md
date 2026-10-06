# HuertoApp v4 — Auto-auditoría (funcionalidades agronómicas avanzadas)

Auditoría de: Balance Hídrico Digital, Ojo Clínico de Maduración (selector
de modo en ScanScreen), Filtro "Apto para gallinas", Protocolo de
Saneamiento Post-Cosecha y Calendario/Alertas de Poda. Incluye una nueva
pantalla, `HomeScreen.js` ("Inicio"), como panel central de estas
novedades que no pertenecen a una foto ni a un cultivo concreto.

## 0. Adaptaciones de nombres respecto al enunciado

El enunciado pedía tocar `weatherService.js`, `geminiService.js` y
`HomeScreen.js`. En este proyecto esos servicios ya existían con otro
nombre desde la v2/v3:

- `weatherService.js` → es `clima.js` (ya contenía `obtenerClimaActual`).
  Se le ha añadido `calcularBalanceHidrico` ahí mismo en vez de crear un
  archivo duplicado.
- `geminiService.js` → es `gemini.js` (`llamarGemini`, genérico). No
  necesitaba cambios: los prompts siempre se han construido en la propia
  pantalla que los usa (`construirPrompt` en ScanScreen/PlannerScreen),
  patrón que se mantiene también para los 3 nuevos modos.
- `HomeScreen.js` no existía (la app solo tenía Escanear/Planificar/
  Huerto) — se ha creado como pantalla nueva y como **primera pestaña**
  de la navegación, que es donde el enunciado sitúa el balance hídrico,
  las alertas de poda y las tareas de saneamiento.

También había una contradicción interna en el enunciado: el punto 1.3
pide los campos `apto_para_gallinas` + `motivo_gallinas`, pero el punto 2
("formato JSON que deben respetar estrictamente todas las respuestas")
lista `apto_para_gallinas` + `aviso_gallinas`. Se ha tomado el punto 2
como formato canónico (es el que se describe como obligatorio para
"todas las respuestas") y se ha usado `aviso_gallinas` en schema, SQL,
prompt y renderizado — un único nombre, no dos campos redundantes.

## 1. Balance Hídrico Digital — control de nulos y failsafes

- `calcularBalanceHidrico(lat, lon)` en `clima.js` pide a Open-Meteo
  `precipitation_sum` y `et0_fao_evapotranspiration` diarios con
  `past_days=2&forecast_days=1`, y suma los **dos días ya cerrados**
  (anteayer + ayer) como "lluvia de las últimas 48h" — se descarta el día
  parcial de hoy para no mezclar lluvia real con una previsión que aún
  puede no cumplirse.
- Si la lluvia acumulada ≥ 8 mm: se bloquea la recomendación de riego y
  se muestra el mensaje pedido literalmente ("La lluvia ha regado por
  ti...").
- Si no: litros/m² = (ETo de hoy − lluvia acumulada) × factor de calor
  (1.3 si ≥35°C, 1.15 si ≥30°C, 1 en el resto). La conversión mm → litros
  por m² es una identidad física directa (1 mm de lámina de agua sobre
  1 m² = 1 litro), no una aproximación.
- **Failsafe explícito**: si Open-Meteo falla, no responde bien, o los
  campos esperados no vienen como array, la función devuelve un objeto
  con `litrosPorM2: null` y `lluviaAcumuladaMm: null` (distinto de `0`) y
  un mensaje neutro pidiendo usar el propio criterio — nunca se inventa
  un número de litros ni se afirma "ha llovido suficiente" sin datos
  reales. `HomeScreen` distingue explícitamente `cargando`, `balance con
  datos` y `sin datos` en el render.
- No se pide permiso de ubicación desde `HomeScreen`: reutiliza
  `coords` de la store (puesto ahí por Planificador), igual que ya
  hacía `ScanScreen` con el clima — así no se multiplican los sitios
  desde los que la app puede pedir GPS. Si no hay coords todavía, se
  muestra una tarjeta con acceso directo a "Planificar" en vez de
  quedarse en blanco sin explicación.

## 2. Ojo Clínico de Maduración — selector de modo

- Un único `SCHEMA_DIAGNOSTICO` y un único parseo/render para los 3
  modos (`plagas` / `poda` / `cosecha`): solo cambia el texto del prompt
  (`construirPrompt(climaTexto, modo)`). Deliberado: mantener un schema
  condicional por modo habría multiplicado los casos de nulabilidad en
  el render sin necesidad.
- Para "Momento de Cosecha", el campo ya existente `dias_para_revisar`
  se reutiliza como "días hasta el punto óptimo de cosecha" (0 = listo
  hoy) en vez de añadir un campo nuevo — reaprovecha el mismo mecanismo
  de recordatorio local que ya programa una notificación en N días.
- El selector de modo se puede fijar por navegación
  (`route.params.modoInicial`), para el "acceso directo a la cámara" que
  pide la alerta de poda del Inicio: `HomeScreen` navega con
  `navigation.navigate('Escanear', { modoInicial: 'poda' })`.
- **Riesgo real no cubierto por tests**: que Gemini siga la instrucción
  de no usar vocabulario técnico depende del modelo, no del código —
  documentado igual que en v3, no es un bug de la app.

## 3. Filtro "Apto para gallinas" — failsafe de seguridad

- `apto_para_gallinas` y `aviso_gallinas` son obligatorios en el
  `responseSchema`, pero el código NUNCA confía ciegamente en que
  Gemini los devuelva bien tipados: `apto_para_gallinas` se normaliza
  con `=== true` estricto (cualquier otra cosa —`undefined`, `"true"`
  como string, `null`— se convierte en `false`), y si Gemini omite
  `aviso_gallinas` se usa un mensaje de respaldo que explícitamente dice
  "no se lo des a las gallinas por precaución". Es decir: **ante la
  duda, el failsafe es siempre "no apto"**, nunca "apto" — la opción
  seguras por defecto para un dato que puede afectar a la salud de un
  animal. Cubierto por el test "failsafe de gallinas: si Gemini omite
  el campo, se asume no apto por precaución".
- Columnas añadidas a `diagnosticos` (`apto_para_gallinas boolean`,
  `aviso_gallinas text`) sin `not null`, porque estos dos campos no
  existían antes de esta versión y las filas de diagnósticos ya
  guardadas deben poder convivir sin ellos.

## 4. Protocolo de Saneamiento Post-Cosecha

- Al llamar a `marcarCosechado` en `GardenScreen`, primero se actualiza
  el estado del cultivo (la parte importante) y **solo después**, sin
  bloquear ni esperar a que tenga éxito, se dispara
  `crearTareaSaneamiento(...)`. Si la creación de la tarea fallara, el
  cultivo ya ha quedado marcado como cosechado igualmente — la tarea de
  saneamiento es un extra recordatorio, no debe poder deshacer una
  acción que el usuario ya confirmó.
- Los pasos de saneamiento son texto estático (conocimiento agronómico
  tradicional, no una llamada a Gemini): no hay nada que parsear ni que
  pueda fallar por una respuesta rara de la IA aquí.
- Se listan y se completan desde `HomeScreen` (`listarTareasPendientes`
  / `marcarTareaCompletada`), con háptica al completarlas.

## 5. Calendario y Alertas de Poda

- `mes_poda_inicio`/`mes_poda_fin` en `plantas`, con `check` de rango
  1-12 (añadido de forma idempotente con `pg_constraint`, igual que en
  v2). `mesEnVentana()` en `HomeScreen.js` gestiona explícitamente el
  caso de ventana que cruza el año (p.ej. Granado: diciembre-febrero se
  guarda como inicio=1, fin=2 en este seed, pero la función soporta
  también inicio > fin para árboles cuya poda cruce diciembre).
- **Limitación honesta**: la tabla `plantas` de esta app nunca ha tenido
  una pantalla de gestión — hoy solo existe la fila "General" que usan
  todos los diagnósticos/cultivos como referencia. No hay UI para dar de
  alta tus árboles concretos. Para que la alerta de poda tenga datos
  reales desde ya, el SQL siembra 3 filas con las ventanas tradicionales
  de los árboles que cita el propio enunciado (Limonero 3-4, Cerezo 6-7,
  Granado 1-2). Si tienes otros árboles (olivo, manzano, etc.), puedes
  añadir filas directamente en el SQL Editor de Supabase con el mismo
  patrón — lo dejo anotado en vez de construir una pantalla de alta de
  árboles que no se ha pedido explícitamente ("pide solo lo
  imprescindible").

## 6. Asincronía y ciclo de vida

- `HomeScreen` sigue el mismo patrón ya establecido: `isMountedRef` para
  no hacer `setState` tras desmontar, `useFocusEffect` para refrescar al
  volver a la pestaña (igual que `GardenScreen`), `RefreshControl` para
  refresco manual, y cada `finally` apaga su propio `cargando`
  (`cargandoPanel` y `cargandoBalance` están separados a propósito: un
  fallo o lentitud en Open-Meteo no debe dejar bloqueado el spinner de
  las tareas/alertas, ni viceversa).
- `crearTareaSaneamiento` y `calcularBalanceHidrico` están diseñados
  para no lanzar hacia arriba en el punto donde se llaman sin
  `try/catch` (el primero se llama con `.catch()` inline en
  `GardenScreen`; el segundo ya nunca lanza por diseño).

## 7. Coherencia de tipos (SQL ↔ React Native)

Verificado campo a campo: `modo text` ↔ string; `apto_para_gallinas
boolean` ↔ boolean estricto; `aviso_gallinas text` ↔ string;
`mes_poda_inicio/fin integer` ↔ se comparan como number en
`mesEnVentana`; `tareas_huerto.pasos jsonb` ↔ se inserta como array JS
plano (supabase-js lo serializa solo) y se lee de vuelta comprobando
`Array.isArray(...)` antes de mapear; `cultivo_id uuid` nullable ↔ se
pasa el id del cultivo o `null` explícito.

## 8. Qué queda fuera del alcance de este pase

- Sin suite Jest para `HomeScreen.js` ni para `calcularBalanceHidrico`
  (mismo criterio que Planner/Garden/clima en v2-v3: se ha revisado
  manualmente en esta auditoría, y son fáciles de testear por separado
  si quieres un siguiente pase dedicado a tests).
- No hay pantalla para dar de alta árboles propios en `plantas` más allá
  del seed SQL (ver punto 5).
- No se ha necesitado instalar ningún paquete nuevo en esta versión:
  todo lo usado (`@react-navigation/native` para `useRoute`/
  `useNavigation`/`useFocusEffect`, `expo-haptics`) ya estaba en el
  código de la v3 — solo siguen pendientes las instalaciones que ya se
  señalaron entonces (ver SETUP.md).
