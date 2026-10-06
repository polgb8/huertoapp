# HuertoApp — Puesta en marcha (v6: fix crash Expo Go/Android)

## 1. Dependencias pendientes

Si todavía no has instalado esto de la v4 (comprobado que aún falta a
fecha de esa versión), hazlo antes de arrancar:

```bash
npx expo install zustand expo-image expo-notifications expo-haptics @react-native-community/netinfo
npm install base64-arraybuffer
```

**Nueva en v5** — detectada por `npx expo export` (ver AUDITORIA_V5.md,
sección 6): `@expo/vector-icons` no estaba instalado y `App.js` lo
necesita para los iconos de las pestañas. Sin esto la app no arranca:

```bash
npm install @expo/vector-icons@^15.1.1
```

**Nueva en v6** — si la app te petaba al abrirla en Expo Go en Android
(dos crashes distintos, uno detrás de otro: primero un error de SDK
53/push notifications, luego uno de `ExpoTopicSubscriptionModule`), ya
están arreglados ambos: ver `AUDITORIA_V6.md` (secciones 1-5 y 6). Los
fixes ya están aplicados directamente en tu `node_modules`, y quedan
guardados en un único `patches/expo-notifications+57.0.20.patch` +
`postinstall` en `package.json`, así que sobreviven a un `npm install`
futuro sin que tengas que hacer nada.

## 2. Base de datos

Vuelve a ejecutar `supabase_schema.sql` completo en el SQL Editor de
Supabase. Es idempotente y añade, sin tocar nada de lo que ya tenías:

- Columnas nuevas en `diagnosticos`: `modo`, `apto_para_gallinas`,
  `aviso_gallinas`.
- Columnas nuevas en `plantas`: `mes_poda_inicio`, `mes_poda_fin` — y
  siembra 3 filas (Limonero, Cerezo, Granado) con sus ventanas
  tradicionales de poda para que la alerta del Inicio tenga datos desde
  ya (puedes añadir más árboles directamente ahí si tienes otros).
- Tabla nueva `tareas_huerto` (protocolo de saneamiento post-cosecha).

## 3. Estructura del proyecto

```
Huerto/
  App.js                 -> Navegación (4 pestañas) + suscripción a NetInfo
  store.js                -> Estado global Zustand (coords, clima, conectado, último diagnóstico)
  clima.js                -> Open-Meteo: clima actual + balance hídrico (calcularBalanceHidrico)
  notificaciones.js        -> Recordatorios locales (expo-notifications)
  theme.js                 -> Paleta, radios, sombras, tipografía
  utils.js                 -> Funciones puras (timeouts, progreso, mensajes de error)
  catalogoPlantas.js        -> Plantas habituales por categoría (selector rápido en Mi huerto)
  gemini.js                -> Única llamada a la API de Gemini
  supabase.js              -> Cliente + helpers de datos + Storage de fotos + tareas
  components/UI.js         -> Card, Badge, BotonPrimario/Secundario, BarraProgreso
  screens/
    HomeScreen.js            -> Módulo D: balance hídrico, alertas de poda, tareas pendientes
    ScanScreen.js             -> Módulo A: cámara + 3 modos (plagas/poda/cosecha) + gallinas
    PlannerScreen.js          -> Módulo B: sugerencias de rotación (GPS + clima + historial 4 años)
    GardenScreen.js           -> Módulo C: dashboard de cultivos + saneamiento post-cosecha
  colaOffline.js            -> Cola local de capturas pendientes sin red (expo-file-system)
  jest.setup.js             -> Mocks globales de módulos nativos + guardián de unhandled rejections
  __tests__/AppFlow.test.js -> Suite de QA de arquitectura completa (5 escenarios críticos)
  supabase_schema.sql
  *.test.js                -> utils, gemini, store, colaOffline, screens/ScanScreen
```

## 4. Arrancar

```bash
npx expo start
```

## 5. Verificar

```bash
npm test
```

Esto ejecuta toda la suite (utils, gemini, store, colaOffline,
screens/ScanScreen y __tests__/AppFlow) — 6 suites, 49 tests, todos en
verde a fecha de esta versión (verificado instalando el proyecto en un
entorno limpio, no solo por inspección del código).

## 6. Notas de la auditoría (ver AUDITORIA_V4.md)

- El balance hídrico de "Inicio" es un cálculo real sobre datos de
  Open-Meteo (lluvia 48h vs. evapotranspiración de hoy), no una
  estimación de la IA — si no hay datos, lo dice explícitamente en vez
  de inventar una cifra.
- El aviso de "apto para gallinas" asume "no apto" por defecto ante
  cualquier duda o dato ausente: es la opción segura para un animal.
- Mi huerto separa "Activos" de "Historial" (oculto por defecto). Cada
  cultivo activo tiene "Marcar como cosechado" y "Quitar" (se perdió →
  sigue contando para la rotación de 4 años; se eliminó por error → se
  borra del todo). El historial se puede limpiar fila a fila.
- Las 3 filas de árboles con ventana de poda son un punto de partida
  (no hay pantalla para gestionar árboles todavía): añade más filas en
  Supabase si tienes otras especies.
