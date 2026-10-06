# HuertoApp v3 — Auto-auditoría ("Sistema Operativo Agrícola")

Auditoría del pase que añade estado global (Zustand), imágenes con blur
placeholder (`expo-image`), clima real (Open-Meteo), recordatorios locales
(`expo-notifications`), háptica y detección de red (`NetInfo`), y el nuevo
esquema de diagnóstico en lenguaje llano razonado internamente con
agronomía (GDD/ETo, ley de Liebig, manejo integrado de plagas, rotación).

## 1. Asincronía y memoria

- **`isMountedRef`** ya existente en ScanScreen se reutiliza igual en
  PlannerScreen (nuevo en esta versión) para todos los `setState` tras
  `await` (clima, ubicación, historial, Gemini).
- **Timeouts**: `clima.js` usa `crearAbortConTimeout(10000)` — más corto
  que los 20s de Gemini/Supabase porque el clima es un enriquecimiento
  opcional, no debe retrasar el diagnóstico principal si Open-Meteo va lento.
- **`clima.js` y `notificaciones.js` nunca lanzan**: ambos capturan
  cualquier error internamente y devuelven `null` — están diseñados como
  "best effort". Si Open-Meteo cae o el dispositivo deniega notificaciones,
  el flujo de diagnóstico/guardado continúa exactamente igual.
- **Subida de foto no bloqueante**: en `guardarEnSupabase` (ScanScreen),
  `subirFotoDiagnostico(...)` va envuelta en su propio `.catch()` *antes*
  de llamar a `insertarDiagnostico`, así que un fallo de Storage nunca
  impide guardar el diagnóstico en texto (se guarda con `imagen_url: null`).
  Cubierto por el test "si falla la subida de la foto, el diagnóstico se
  guarda igual".
- **Zustand como singleton en tests**: `store.test.js` usa
  `jest.resetModules()` + `require('./store')` en cada test para partir de
  estado limpio, porque `create()` solo se ejecuta una vez por proceso.

## 2. Nulabilidad y permisos

- **Ubicación no se pide a mitad del escaneo**: `ScanScreen` solo usa el
  clima si `coords` ya existe en la store (puesta ahí por `PlannerScreen`
  la primera vez que se usa). Decisión deliberada: pedir permiso de GPS
  justo antes de fotografiar una planta sería una interrupción rara para
  el usuario; si aún no hay coordenadas, Gemini recibe simplemente "sin
  datos climáticos disponibles" y sigue funcionando con normalidad.
- **Gemini omite un campo del nuevo esquema**: `resultadoFinal` en
  ScanScreen normaliza cada campo con `??`/`Array.isArray(...)
  ? ... : RESPALDO...` y `Number.isFinite(...)`, igual que se hacía en v2.
  Si `dias_para_revisar` no es un número finito, cae al respaldo (3 días)
  en vez de programar una notificación con una fecha inválida.
- **`dias_para_revisar` = 0**: no se agenda recordatorio
  (`if (resultado.dias_para_revisar > 0)`), y `programarRecordatorio`
  además comprueba `fecha.getTime() <= Date.now()` como segunda red de
  seguridad si algún día se le pasara una fecha ya pasada.
- **Permiso de notificaciones denegado**: `asegurarPermiso()` devuelve
  `false` sin lanzar; `programarRecordatorio` simplemente no agenda nada
  y el guardado del diagnóstico ya ha terminado antes de ese punto.
- **`NetInfo` como fail-fast, no como único guardián**: `conectado` se
  comprueba al principio de cada acción de red (`analizarConGemini`,
  `guardarEnSupabase`, `solicitarSugerencias`, `anadirAlHuerto`) para evitar
  esperar 20s de timeout cuando ya se sabe que no hay red — pero los
  timeouts de `utils.js` se mantienen intactos como red de seguridad para
  el caso en que `NetInfo` informe "conectado" y la red esté en realidad
  caída o sea inutilizable (falso positivo conocido de NetInfo en algunas
  redes WiFi sin salida a internet real).

## 3. Consistencia de dependencias / APIs

- **`expo-notifications` y Expo Go (Android)**: desde el SDK 53, Expo Go
  ya no soporta notificaciones **push remotas** en Android, pero las
  notificaciones **locales programadas** (que es todo lo que usa esta
  app — `scheduleNotificationAsync` con un trigger de fecha, sin servidor)
  siguen funcionando con normalidad en Expo Go. No aplica ninguna
  limitación aquí, pero lo dejo anotado por si en el futuro se plantea
  añadir avisos push reales (eso sí requeriría un dev build).
- **`base64-arraybuffer`**: no es un paquete gestionado por Expo (no lleva
  código nativo), así que se instala con `npm install` normal, no con
  `npx expo install`.
- **`expo-image`**: sustituye al `Image` de `react-native` solo en el
  preview del modal de ScanScreen; el resto de la app no muestra fotos
  todavía, así que no hace falta tocar Planner/Garden.
- **BlurHash honesto**: `PLACEHOLDER_BLURHASH` es una cadena fija
  (verde-tierra genérico), no un hash calculado a partir de cada foto real
  — calcularlo de verdad requeriría decodificar píxeles en el cliente
  (p.ej. con `react-native-skia`), fuera del alcance de este pase. Da la
  misma sensación de carga suave, pero no es un "blur real de la foto".
  Documentado también en el propio código.
- **Zustand solo para estado efímero cross-pantalla** (coords, clima,
  conectado, último diagnóstico) — deliberadamente NO se usa para
  cachear cultivos/diagnósticos de Supabase, para no arriesgar mostrar
  datos obsoletos tras guardar algo en otra pestaña.

## 4. El "cerebro agronómico" oculto (Científico Agrónomo)

El prompt de `ScanScreen` (`construirPrompt`) le pide a Gemini razonar
internamente con vocabulario técnico real (grados-día, ETo, ley de
movilidad foliar de Liebig, ratio plaga/fauna auxiliar) pero con una
"REGLA DE ORO" explícita de no usar ese vocabulario en la respuesta y
explicarlo como lo haría un abuelo agricultor. Esto no se puede verificar
con un test automático (depende de que Gemini obedezca la instrucción),
así que la mitigación es doble: (1) el `responseSchema` fuerza la forma
del JSON de salida (no puede colar un campo técnico donde no toca), y
(2) el prompt es explícito y repite la prohibición al final. Si en la
práctica Gemini se "escapa" con algún tecnicismo puntual, es un ajuste de
prompt, no un bug de código — lo señalo para que lo tengas en cuenta
probando la app con casos reales.

## 5. Qué queda fuera del alcance de este pase

- Sin suite Jest propia para `PlannerScreen.js`, `GardenScreen.js`,
  `clima.js` ni `notificaciones.js` (igual que se señaló en la v2 para
  Planner/Garden). `clima.js` y `notificaciones.js` son fáciles de testear
  por separado si quieres en un siguiente pase — son módulos pequeños y
  puros en su interfaz pública.
- Claves de Gemini/Supabase siguen en texto plano en el código (mismo
  punto pendiente desde v1/v2).

## 6. Instalación pendiente (ver SETUP.md)

Estos paquetes se usan ya en el código pero **aún no están instalados**
en `node_modules` a fecha de esta auditoría: `zustand`, `expo-image`,
`expo-notifications`, `expo-haptics`, `@react-native-community/netinfo`,
`base64-arraybuffer`. Hasta que no los instales, `npx expo start` no
arrancará y `npx jest` fallará al no poder resolver esos módulos (aunque
estén mockeados en los tests, Jest necesita que el paquete exista para
registrar el mock).
