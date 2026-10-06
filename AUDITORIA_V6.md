# Auditoría v6 — Crash al abrir en Expo Go (Android): `expo-notifications`

## 1. Síntoma

Al escanear el QR y abrir la app en Expo Go en un Android físico, la
app no llega a renderizar: pantalla roja de error en tiempo de carga
del bundle, no un error de React.

```
Error: expo-notifications: Android Push notifications (remote
notifications) functionality provided by expo-notifications was
removed from Expo Go with the release of SDK 53. Use a development
build instead of Expo Go...
  at warnOfExpoGoPushUsage
  at addPushTokenListener
  ...
  at metroRequire
```

El stack apunta a que el fallo ocurre **al importar el paquete**, antes
de que se ejecute ningún código de la app (`App.js` nunca llega a
correr).

## 2. Causa raíz (confirmada, no es una suposición)

`expo-notifications@57.0.20` (versión instalada, dentro del rango
`~57.0.20` de tu `package.json`) tiene un bug real y documentado
públicamente: [expo/expo#49044](https://github.com/expo/expo/issues/49044).

El archivo `node_modules/expo-notifications/build/DevicePushTokenAutoRegistration.fx.js`
se ejecuta automáticamente al importar el paquete (no hace falta llamar
a ninguna función), y tenía esta guarda pensada para "saltarse esto en
Expo Go":

```js
if (ServerRegistrationModule.getRegistrationInfoAsync) {
    addPushTokenListener(...)  // <- dispara warnOfExpoGoPushUsage()
}
```

El problema: en Expo Go para **Android**, `getRegistrationInfoAsync`
**sí existe** (el módulo nativo simulado de Expo Go lo expone), así que
la guarda no protege nada y siempre entra en la rama que registra el
listener de push token. Ese listener acaba llamando a
`warnOfExpoGoPushUsage()`, que en Android no solo avisa por consola:
**lanza una excepción** (`throw new Error(...)`), tumbando el bundle
entero.

Esto **no** es que se haya "quitado" la función de notificaciones de
Expo Go — las notificaciones **locales** (`scheduleNotificationAsync`,
las únicas que usa HuertoApp) siguen soportadas ahí. Es un bug de
detección: el paquete cree que va a usar push remoto y se protege mal.

El fix oficial existe (PR
[#49062](https://github.com/expo/expo/pull/49062)) pero **solo se
publicó en `expo-notifications@58.0.0`**, que exige Expo SDK 58. Migrar
todo el proyecto de SDK 57 a 58 para esto sería un cambio grande y
fuera de lo pedido, y abandonar Expo Go por un development build
rompería el flujo de pruebas que hemos usado en todo el proyecto. Así
que se ha aplicado el mismo fix del PR oficial, pero como **parche
local** sobre la versión ya instalada.

## 3. El parche

Nuevo archivo `patches/expo-notifications+57.0.20.patch` (generado con
`patch-package`, aplicado ya también directamente sobre tu
`node_modules` para que funcione ahora mismo sin esperar a un
`npm install`):

```diff
 import 'abort-controller/polyfill';
-import { UnavailabilityError } from 'expo-modules-core';
+import { Platform, UnavailabilityError } from 'expo-modules-core';
+import { isRunningInExpoGo } from 'expo';
 import ServerRegistrationModule from './ServerRegistrationModule';
 ...
-if (ServerRegistrationModule.getRegistrationInfoAsync) {
+const estaEnExpoGoAndroid = isRunningInExpoGo() && Platform.OS === 'android';
+if (estaEnExpoGoAndroid) {
+    console.warn('[expo-notifications] Auto-registro de push token omitido en Expo Go (Android): esta app solo usa notificaciones locales.');
+}
+else if (ServerRegistrationModule.getRegistrationInfoAsync) {
     addPushTokenListener(...)  // sin cambios
```

Se añade una comprobación explícita "¿estamos en Expo Go en Android?"
**antes** de la guarda original, que se deja intacta para cualquier
otro caso (development build, iOS, producción). Como HuertoApp solo usa
notificaciones locales programadas (nunca token push remoto), omitir
ese registro en Expo Go/Android es inocuo — es exactamente lo que hace
la versión oficial arreglada.

`package.json` ahora incluye:
- `devDependencies.patch-package` (para que el parche se reaplique
  solo tras cualquier `npm install` futuro).
- `scripts.postinstall: "patch-package"`.

## 4. Cómo se verificó (no solo por inspección visual)

Antes de tocar tu proyecto real, se instaló `expo-notifications@57.0.20`
en un entorno limpio aislado y se ejecutó un test real (Jest) que
reproduce **las condiciones exactas del crash**: `isRunningInExpoGo()`
devolviendo `true`, `Platform.OS === 'android'`, y
`ServerRegistrationModule.getRegistrationInfoAsync` presente (la
condición que en tu móvil hacía fallar la guarda).

- **Sin el parche** (código original): el test confirma que sí se
  llega a `addPushTokenListener(...)` bajo esas condiciones — la ruta
  exacta que en Android desemboca en el `throw`. Esto prueba que el
  bug es real y reproducible, no solo teórico.
- **Con el parche**: el mismo test, mismas condiciones, confirma que
  ya no se llega a `addPushTokenListener`, no se lanza ninguna
  excepción al importar el módulo, y se emite el aviso informativo en
  su lugar.

Solo después de esta doble verificación (falla sin parche / pasa con
parche, bajo las condiciones reales del bug) se aplicó el cambio a tu
proyecto.

## 5. Qué falta de tu lado

Nada para que funcione ya: el `node_modules` de tu proyecto ya tiene
el fix aplicado directamente. El archivo `patches/...patch` y el
`postinstall` en `package.json` son para que, si en el futuro borras
`node_modules` y haces `npm install` de nuevo (o instalas en otra
máquina), el parche se reaplique solo — no tienes que hacer nada
manual salvo tener eso ya guardado (ya lo está).

Vuelve a abrir Expo Go en el móvil (recarga con `r, r` o cierra y
vuelve a escanear el QR) y debería arrancar con normalidad.

## 6. Segundo crash tras el primer fix: `ExpoTopicSubscriptionModule`

Al recargar en el móvil con el fix de la sección 1-5 ya aplicado, apareció
un segundo crash **distinto**, mismo patrón (import-time, antes de
renderizar):

```
Error: Cannot find native module 'ExpoTopicSubscriptionModule'
  at requireNativeModule
```

### Causa raíz

`node_modules/expo-notifications/build/TopicSubscriptionModule.android.js`:

```js
import { requireNativeModule } from 'expo-modules-core';
export default requireNativeModule('ExpoTopicSubscriptionModule');
```

Esta línea se ejecuta **al importar el archivo**, no al llamar a ninguna
función. `ExpoTopicSubscriptionModule` es el módulo nativo de
"suscripción a topics de Firebase" (push), y — igual que con el token
push del apartado anterior — Expo Go para Android/SDK 57 no lo trae
compilado. `requireNativeModule` lanza inmediatamente si no lo
encuentra, tumbando el bundle otra vez, aunque HuertoApp nunca llama a
`subscribeToTopicAsync`/`unsubscribeFromTopicAsync` (esas funciones ya
tenían su propia comprobación de seguridad — el problema era solo el
`import`, antes de llegar a usarlas).

### Fix

`expo-modules-core` ya expone `requireOptionalNativeModule`, la versión
que devuelve `null` en vez de lanzar cuando el módulo nativo no existe
— exactamente para este caso. Dos cambios mínimos:

```diff
- import { requireNativeModule } from 'expo-modules-core';
- export default requireNativeModule('ExpoTopicSubscriptionModule');
+ import { requireOptionalNativeModule } from 'expo-modules-core';
+ export default requireOptionalNativeModule('ExpoTopicSubscriptionModule');
```

Y en `topicSubscription.js`, que ya comprobaba
`TopicSubscriptionModule.subscribeToTopicAsync` antes de usarlo, se
añade `?.` para que esa comprobación no falle con un `TypeError` cuando
el módulo entero es `null` (antes solo podía ser un objeto sin ese
método, nunca `null`):

```diff
- if (!TopicSubscriptionModule.subscribeToTopicAsync) {
+ if (!TopicSubscriptionModule?.subscribeToTopicAsync) {
```

Ambos cambios están ya en `patches/expo-notifications+57.0.20.patch`
(junto con el fix de la sección 1-5) y aplicados directamente en tu
`node_modules`.

### Verificación

Misma metodología: en un entorno aislado, con
`requireNativeModule`/`requireOptionalNativeModule` simulando
exactamente el caso real (módulo nativo ausente), se confirmó que:
- **Sin parche**, importar `TopicSubscriptionModule.android.js` lanza
  el mismo error que en tu móvil (reproduce el bug real).
- **Con parche**, no lanza, y el resto de módulos que dependen de él
  (`topicSubscription.js`, con el `?.` añadido) tampoco.

También se revisaron el resto de módulos nativos que `expo-notifications`
carga al importarse (badges, canales, permisos, presentador,
programador, gestor de eventos — todo lo que usan las notificaciones
LOCALES) para confirmar que ninguno tiene este mismo patrón peligroso:
todos están soportados en Expo Go (si no lo estuvieran, habrían fallado
ya en el primer arranque, antes incluso de llegar al bug de push).
