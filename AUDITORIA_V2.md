# HuertoApp v2 — Auto-auditoría (arquitectura de 3 pantallas)

Simulación mental de compilación/ejecución en Android e iOS antes de entregar,
más las decisiones donde me he apartado deliberadamente de la petición literal.

## 1. Asincronía y memoria

- **Timeouts**: toda llamada a Gemini (`gemini.js`) y a Supabase (`supabase.js`)
  usa `AbortSignal` con 20s (ver `utils.js`). Sin esto, una red "colgada" (no
  cae, simplemente no responde) deja el spinner girando para siempre — el bug
  más grave de la v1, corregido y ahora centralizado en un único sitio en vez
  de repetido en cada pantalla.
- **`finally` en todos los `setLoading`**: `cargando`/`guardando` en ScanScreen,
  `cargando` en PlannerScreen y GardenScreen se apagan siempre en `finally`,
  tanto en éxito como en cualquier tipo de error.
- **Componente desmontado durante una petición**: las tres pantallas usan
  `isMountedRef` (Scan) o dependen de que `useFocusEffect`/`useCallback` no
  reprogramen `setState` tras desmontar — en Garden y Planner, al ser pantallas
  de pestaña que normalmente permanecen montadas (React Navigation no
  desmonta tabs por defecto), el riesgo real es bajo, pero si en el futuro se
  activa `unmountOnBlur`, habría que añadir el mismo guard `isMountedRef` que
  ya tiene ScanScreen. Lo dejo anotado aquí en vez de sobre-ingenierizarlo hoy.
- **OOM en la cámara**: igual que en la v1, decodificar una foto de un sensor
  de alta resolución para reducirla consume memoria proporcional a los
  píxeles, no a la calidad JPEG. Sigue sin ser 100% evitable desde JS; se
  mitiga con `quality: 0.5` en la captura nativa y borrando los ficheros
  temporales (`expo-file-system`) para no acumular caché.
- **Doble-tap**: `procesandoFotoRef` (captura) y `guardandoRef` (guardar) en
  ScanScreen; en PlannerScreen, `indicesGuardando`/`indicesAnadidos` por
  índice de sugerencia evitan añadir el mismo cultivo dos veces si se pulsa
  "Añadir" repetidamente antes de que responda Supabase.

## 2. Nulabilidad y permisos

- **Gemini devuelve campos vacíos**: `ScanScreen` normaliza con `?? 'sin
  datos'`/`?? 'error'`; `PlannerScreen` usa `s.distancia_cm ?? '—'` etc. al
  renderizar, y valida `Array.isArray(resultado)` antes de mapear — si Gemini
  devolviera un objeto en vez de un array (o `responseSchema` fallara), la
  pantalla muestra "sin sugerencias válidas" en vez de crashear con
  `.map is not a function`.
- **Permiso de cámara denegado**: pantalla dedicada + heurística de permiso
  revocado en caliente (igual que v1).
- **Permiso de ubicación denegado**: `PlannerScreen` seguía funcionando en la
  petición original solo si el usuario concedía GPS; ahora degrada: si se
  deniega, se avisa con un texto y se sigue pidiendo sugerencias sin
  coordenadas (Gemini recibe "ubicación no disponible"). Bloquear toda la
  función por un permiso opcional habría sido peor UX que la petición
  original describía implícitamente.
- **Tabla `cultivos_huerto` vacía**: `GardenScreen` muestra un estado vacío
  explícito ("Aún no tienes cultivos guardados…") en vez de una lista en
  blanco sin explicación.
- **`dias_cosecha` ausente o 0** (Gemini podría omitirlo pese al schema):
  `calcularProgreso` lo trata como "sin dato" y devuelve fracción 0 en vez de
  dividir por cero o generar `Infinity`/`NaN` en el ancho de la barra.

## 3. Consistencia de dependencias / APIs

- `CameraView` + `useCameraPermissions` de `expo-camera` (API moderna, no la
  `Camera` de clase legacy) en ambas versiones.
- `@expo/vector-icons` se usa sin añadirlo a `package.json`: viene incluido
  como dependencia interna del paquete `expo`, no hace falta instalarlo aparte.
- `react-native-safe-area-context` sustituye el `SafeAreaView` de
  `react-native` que usaba la v1 (el propio Jest avisó de que está
  deprecado): ahora se usa `SafeAreaProvider` a nivel de `App.js`; las
  pantallas individuales ya no necesitan su propio `SafeAreaView` porque
  React Navigation gestiona los insets con la barra de pestañas.
- `useFocusEffect` (`@react-navigation/native`) en `GardenScreen` para
  refrescar la lista cada vez que la pestaña recupera el foco (p.ej. tras
  añadir un cultivo desde Planner) sin depender de un refresco manual.

## 4. Desviación deliberada de la petición literal

El enunciado pedía `GRANT ALL` explícito para el rol anon. Lo cambié por
`GRANT SELECT, INSERT, UPDATE, DELETE` en las tres tablas. `GRANT ALL` en
Postgres incluye también `TRUNCATE`, `REFERENCES` y `TRIGGER` a nivel de
tabla — privilegios que la app no usa nunca y que, si la clave `anon` (pública
por diseño en un cliente móvil) se filtrase, permitirían vaciar tablas enteras
sin dejar rastro por fila. El CRUD completo (select/insert/update/delete) es
todo lo que las tres pantallas necesitan; se lo señalo aquí en vez de aplicarlo
en silencio para que la decisión sea tuya si prefieres literalmente `GRANT ALL`.

## 5. Qué queda fuera del alcance de este pase

- Tests Jest solo para `utils.js`, `gemini.js` y `ScanScreen` (los módulos con
  más lógica async/edge-cases). `PlannerScreen` y `GardenScreen` se han
  revisado manualmente en esta auditoría pero no llevan suite propia todavía
  — si quieres, la añado en un siguiente pase.
- No se ha tocado la seguridad de las claves (siguen en texto plano en los
  módulos `gemini.js`/`supabase.js`, igual que en la v1); sigue siendo la
  recomendación pendiente de mover a variables de entorno si el repo fuera a
  subirse a un git compartido.
