# HuertoApp — Auditoría técnica y suite de tests

## Causa raíz del fallo que reportaste

El mensaje "No se pudo analizar la imagen (fallo de red o de la API de Gemini)"
no era de red: Google migró las claves de API nuevas (prefijo `AQ.`, como la
tuya) a autenticación por **cabecera** `x-goog-api-key`. Tu código (y el mío
original) usaba el método antiguo `?key=API_KEY` en la URL, que con una clave
`AQ.` devuelve `401 ACCESS_TOKEN_TYPE_UNSUPPORTED`. Ya está corregido en
`App.js`.

## 1. Simulación de casos límite (antes → después)

**1. Permiso de cámara denegado a mitad de sesión.** Antes: `useCameraPermissions()`
solo se lee al montar; si el usuario revoca el permiso desde Ajustes con la
app en segundo plano, la app no se entera hasta que `takePictureAsync` lanza
una excepción de permiso, que caía en el catch genérico ("no se pudo
capturar la foto"), confundiendo al usuario. Después: el catch de `tomarFoto`
detecta el error de permiso y muestra la pantalla de "conceder permiso" con
un mensaje específico.

**2. Pérdida de red al pulsar "Escanear" o al guardar.** Antes: si el `fetch`
o la llamada a Supabase se quedan "colgados" (radio en estado intermedio,
sin llegar a lanzar un error) el `await` nunca se resuelve y el spinner gira
para siempre — el bug más grave encontrado. Después: toda petición a Gemini y
a Supabase lleva un `AbortSignal` con timeout de 20s; pasado ese tiempo se
aborta y se muestra un mensaje de "red lenta o caída".

**3. Compresión Base64 y memoria (gama media).** El `resize` de
`ImageManipulator` necesita decodificar la foto completa como bitmap en
memoria (ancho × alto × 4 bytes) antes de reducirla; eso depende de la
resolución nativa del sensor, no de la calidad JPEG, así que **ningún cambio
en JS puede garantizar al 100% que no ocurra un OOM** en un sensor de gama
alta sobre un dispositivo de gama media — un OOM nativo mata el proceso antes
de que el `try/catch` de JS pueda actuar. Lo que sí se ha corregido: (a) la
captura nativa pasó de `quality: 1` a `0.5`, reduciendo el fichero intermedio
y el tiempo de codificación; (b) el fichero original ya no se borraba nunca
tras usarlo — con el tiempo llenaba la caché del dispositivo (fuga de disco),
ahora se borra con `expo-file-system` en cuanto se genera la versión
reducida, y también el fichero reducido al reiniciar. Recomendación si en
pruebas reales aparecen cierres inesperados en un móvil de gama media: limitar
`pictureSize` en `CameraView` a una resolución menor que la nativa.

**4. Respuesta no estándar de Gemini.** Antes: cualquier código de error HTTP
(429, 500, 401...) mostraba el mismo mensaje genérico. Después: 429 → "límite
gratuito alcanzado, espera un minuto"; 401/403 → "API key no válida"; 5xx →
"servicio no disponible, reintenta"; JSON truncado o con sintaxis inválida →
ya estaba cubierto (cae a un resultado `{estado:"error", ...}` sin crashear) y
se ha mantenido; candidato vacío por bloqueo de seguridad o corte por
`MAX_TOKENS` → nuevo mensaje "Gemini no ha devuelto un resultado válido".

**5. Base de datos y RLS.** Se simuló una inserción concurrente en `plantas`
(dos guardados casi simultáneos, p.ej. doble-tap en "Guardar"): el patrón
anterior (SELECT y, si no existe, INSERT) no es atómico — entre el SELECT y
el INSERT, otra petición puede colarse y crear una segunda fila "General"
porque `plantas.nombre` no tenía restricción `UNIQUE`. Corregido con una
restricción `UNIQUE(nombre)` (SQL) + `upsert(..., {onConflict:'nombre'})` en
el cliente, atómico a nivel de Postgres. Sobre violaciones de clave foránea o
nulos en `diagnosticos`: los campos son `nullable` en el esquema y el cliente
ya normaliza `undefined → 'sin datos'`, así que no hay riesgo de columna
`NOT NULL` violada; si `planta_id` llegase nulo por un fallo de red a medias,
ahora se lanza un error explícito antes de intentar el insert, y si Postgres
devolviera `23503` (FK violation) se muestra un mensaje específico en vez de
un error crudo de Postgres.

## 2. Tabla de hallazgos

| Severidad | Hallazgo | Dónde | Corrección |
|---|---|---|---|
| Crítica | Auth de Gemini con `?key=` incompatible con claves nuevas `AQ.` → 401 en cada análisis | `GEMINI_ENDPOINT` / `fetch` | Cabecera `x-goog-api-key` |
| Crítica | Sin timeout: una petición colgada deja el spinner girando para siempre | `analizarConGemini`, `guardarEnSupabase`, `obtenerPlantaPorDefecto` | `AbortController` con 20s en Gemini y Supabase (`.abortSignal()`) |
| Media | Condición de carrera: doble-tap en "Guardar" o en el botón de captura puede disparar la función dos veces antes de que el estado se actualice | `guardarEnSupabase`, `tomarFoto` | Guardas síncronas con `useRef` (`guardandoRef`, `procesandoFotoRef`) |
| Media | Fila "General" duplicada en `plantas` si dos guardados casi simultáneos hacen SELECT-then-INSERT a la vez | `obtenerPlantaPorDefecto` + esquema SQL | `UNIQUE(nombre)` + `upsert(onConflict)` |
| Media | Mensajes de error genéricos: 429, 500 y 401 mostraban el mismo texto, dificultando el diagnóstico | `analizarConGemini` | Clasificación por código de estado con mensaje específico |
| Media | Fuga de almacenamiento: ni la foto original ni la reducida se borraban nunca del caché | `tomarFoto`, `reiniciar` | `expo-file-system` `deleteAsync` en ambos puntos |
| Baja-Media | Posible warning/fuga si el componente se desmonta mientras se espera Gemini/Supabase (`setState` sobre componente desmontado) | Todas las funciones async | `isMountedRef` comprobado antes de cada `setState` tras un `await` |
| Baja-Media | Botón de captura activo aunque la cámara nativa aún no esté lista, o sin manejo si el montaje de la cámara falla | `CameraView` | `onCameraReady`/`onMountError` + botón deshabilitado hasta estar lista |
| Baja | Claves de Supabase/Gemini en texto plano dentro de `App.js` (riesgo si el repo se sube a un git público) | `App.js` | Recomendado (no aplicado): mover a variables de entorno con `react-native-dotenv` o `expo-constants` + `.gitignore` |
| Baja | Riesgo de OOM nativo al decodificar fotos de sensores de muy alta resolución — no mitigable al 100% desde JS | `tomarFoto` / `ImageManipulator` | Mitigado parcialmente (calidad 0.5, limpieza de temporales); documentado como límite real, no "arreglado" |

## 3. Qué falta por tu parte

1. `npx expo install expo-file-system` (la única dependencia nueva que añade el fix).
2. Para poder correr los tests: `npm install --save-dev jest jest-expo @testing-library/react-native react-test-renderer` (ya declaradas en `package.json`, faltan instalarse).
3. `npx jest` para ejecutar `App.test.js`.
4. Vuelve a probar la app — el fallo de Gemini debería estar resuelto con el fix de la cabecera.
