# HuertoApp v5 — QA de arquitectura completa (__tests__/AppFlow.test.js)

## 0. Verificación real, no solo "debería pasar"

En vez de asegurar que las 5 pruebas "pasan en verde" solo por
inspección del código, se ha instalado el proyecto completo en un
entorno limpio y se ha ejecutado `npx jest` de verdad. En la primera
pasada aparecieron 3 fallos reales (no del enunciado, sino introducidos
al escribir los tests): dos por una condición de carrera de `act()`
entre una pulsación de la UI y la siguiente en `screens/ScanScreen.
test.js`, y uno porque un test de `colaOffline.test.js` asumía un fallo
de lectura donde el código, correctamente, se recupera solo y sigue
adelante. Los tres se han corregido y la suite completa queda en
**6 suites, 49 tests, todos en verde**.

## 1. Funcionalidad nueva que exigía el escenario 1

El enunciado pedía verificar que, sin red, "la app debe permitir
registrar la captura y encolarla en almacenamiento local" — esa cola no
existía todavía en la app (hasta ahora, sin red simplemente se mostraba
un error y se perdía la foto). Se ha añadido `colaOffline.js`
(persistencia real en disco vía `expo-file-system`, mismo patrón "nunca
lanza" que `clima.js`/`notificaciones.js`) y se ha conectado en
`ScanScreen.js`: si no hay conexión al analizar, la foto se encola y se
avisa con un mensaje distinto del de error ("hemos guardado la foto...")
en vez de descartarla. Esto es un cambio de comportamiento real, no solo
de test — documentado aquí para que quede claro que no es un efecto
secundario oculto.

## 2. Qué cubre cada test del escenario, y a qué nivel

1. **Arranque sin red** (`ScanScreen`): confirma que no se llama a
   Gemini, que `encolarCapturaPendiente` se invoca con la foto y el
   modo, y que no queda ninguna promesa sin capturar (ver punto 4).
2. **Gemini en error (429/500/timeout)**: `test.each` sobre los 3 casos
   reutiliza la clasificación de errores ya centralizada en
   `gemini.js`/`utils.js` — se simula el error que `gemini.js` ya
   lanzaría (no hace falta esperar 10s reales ni fetch de verdad), y se
   comprueba que el spinner desaparece y aparece un aviso limpio.
3. **JSON sucio/incompleto**: el parseo de texto plano o JSON truncado
   en bruto ya se testea a su propio nivel en `gemini.test.js`
   (`limpiarJSONSeguro`). Aquí se simula lo que SÍ puede llegar a
   `ScanScreen` pese al `responseSchema` — un campo con el tipo
   equivocado (`que_hacer_hoy` como string, `apto_para_gallinas` como
   string, etc.) — y se confirma que cada `??`/`Array.isArray`/
   `Number.isFinite` real de `ScanScreen.js` cae al respaldo sin romper
   nada, incluido el failsafe de seguridad de gallinas.
4. **Supabase pausado**: se prueba sobre `GardenScreen` (no otra vez
   `ScanScreen`) para verificar resiliencia en un segundo punto real de
   la arquitectura, no solo repetir el mismo camino de código.
5. **Permiso de cámara denegado**: confirma el estado bloqueado, el
   botón de reintento, y que `takePictureAsync` nunca se llega a
   invocar (la `CameraView` ni se monta en esa rama).

## 3. Guardián de unhandled promise rejections

`jest.setup.js` engancha `process.on('unhandledRejection', ...)` en
`beforeEach` y lo retira en `afterEach` de cada test (no un único
listener global de por vida, para no acumular listeners entre archivos
de test). Si cualquier test de la suite dejara una promesa rechazada
sin capturar, ese test fallaría con un mensaje explícito — no hace
falta comprobarlo a mano en cada escenario, corre automáticamente en
los 49 tests.

## 4. Mocks nativos: más de los 4 pedidos, por necesidad

Además de `expo-camera`, `expo-location`, `expo-notifications` y
`expo-image-manipulator` (los 4 pedidos explícitamente), `jest.setup.js`
también mockea `expo-file-system`, `expo-haptics`, `expo-image` y
`react-native-url-polyfill/auto`: sin ellos, `npx jest` fallaría igual
al intentar cargar módulos con partes nativas reales. Los tests que
necesitan control fino por caso (permiso de cámara denegado, resultado
de la captura) redefinen `expo-camera`/`expo-image-manipulator`
localmente en su propio archivo — el mock local gana sobre el global,
sin conflicto.

## 5. Qué queda fuera de este pase

- La cola offline no se sincroniza todavía sola al recuperar la
  conexión (no se ha pedido; `colaOffline.js` expone
  `obtenerColaPendiente`/`vaciarColaPendiente` ya preparados para un
  futuro "flush" automático).
- `colaOffline.test.js` (unitario) no era parte de la entrega pedida,
  pero se ha añadido igualmente: es la forma más honesta de probar que
  la persistencia en disco funciona de verdad, en vez de solo confiar
  en que `AppFlow.test.js` mockea `../colaOffline` como caja negra.

## 6. Fallo real encontrado por la prueba de empaquetado en frío

`npx expo export --platform android` falló con `Unable to resolve
module @expo/vector-icons` — un error real de Metro, no de Jest. La
suposición de `AUDITORIA_V2.md` ("`@expo/vector-icons` viene incluido
como dependencia interna de `expo`, no hace falta instalarlo aparte")
era incorrecta para esta versión instalada: el paquete no estaba en
`node_modules` en absoluto. Este es exactamente el tipo de fallo que
los tests con mocks no pueden detectar (Jest mockea `@expo/vector-icons`
implícitamente al no montar `App.js` completo con navegación real),
pero sí lo detecta el bundler.

Se ha verificado la corrección en un entorno limpio antes de aplicarla:
instalando `@expo/vector-icons@^15.1.1` (rango que marca
`node_modules/expo/bundledNativeModules.json` para esta versión de
Expo SDK), `npx expo export --platform android` pasa de "Bundling
failed" a "Android Bundled" (1086 módulos) sin errores. Añadido a
`package.json`; falta que lo instales en tu proyecto real (ver
SETUP.md).
