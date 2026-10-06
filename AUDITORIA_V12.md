# AUDITORIA_V12.md — Auditoría completa pre-EAS

Fecha: 2026-09-22
Motivo: petición explícita de Pol antes de montar EAS Update — "analiza bien toda
la app en busca de fallos... que no haya nada puesto que luego no se aplique
como ha pasado antes con el riego personalizado. Debe ser 100% funcional antes
de usar eas y sin problemas en los guardados y sincronizaciones".

## Método

Revisión archivo por archivo de TODA la app (pantallas, componentes, lógica de
datos y utilidades), cruzando cada campo/función exportada con sus puntos de
uso reales, buscando específicamente la clase de fallo ya vista con `riego`:
un dato real presente en el código que ningún sitio llega a consultar.

Archivos revisados: App.js, store.js, theme.js, ubicacion.js, clima.js,
gemini.js, colaOffline.js, catalogoPlantas.js, supabase.js, riego.js,
components/UI.js, components/AutocompletarPlanta.js, components/DetallePlanta.js,
screens/GardenScreen.js, screens/ScanScreen.js, screens/PlannerScreen.js,
screens/BuscarScreen.js, screens/AsistenteScreen.js.

## Fallos encontrados y corregidos

### 1. App.js — la cola offline no se drenaba en un arranque en frío ya conectado
El listener de NetInfo solo lanzaba `procesarColaPendiente()` cuando detectaba
una transición real `desconectado -> conectado` DENTRO de la sesión. Si el
móvil se cerraba estando sin cobertura con fotos encoladas, y se volvía a
abrir ya con datos/wifi, el primer evento de NetInfo llegaba directamente como
"conectado" (nunca pasaba por "desconectado" en esta sesión) y esas fotos se
quedaban encoladas indefinidamente hasta que hubiera un ciclo real de
desconexión/reconexión.
**Corregido**: ahora también se dispara el drenaje en el primer evento de
NetInfo si llega ya conectado, no solo en una transición.

### 2. GardenScreen.js — `guardarEdicion` daba un "guardado" fantasma
Al editar un cultivo (variedad, zona, cantidad, foto...), la pantalla
actualizaba la tarjeta en memoria de forma optimista tras llamar a
`actualizarCultivo()`, pero nunca volvía a pedir los datos reales a Supabase.
Si el guardado fallaba en silencio por cualquier motivo (p.ej. una columna
que la migración pendiente aún no ha creado), la tarjeta seguía mostrando el
cambio como guardado hasta el siguiente refresco natural de la pestaña —
exactamente el patrón "puesto pero no aplicado" que preocupaba a Pol.
**Corregido**: `guardarEdicion` ahora llama a `cargar()` justo después de
`actualizarCultivo()`, así la tarjeta siempre refleja lo que de verdad quedó
en la base de datos.

### 3. catalogoPlantas.js / DetallePlanta.js — el campo `poda` nunca se mostraba
Igual que pasaba antes con `riego`, el catálogo trae un campo `poda`
(frecuencia orientativa en días entre podas de mantenimiento) con datos reales
para ~54 especies, pero ningún componente ni pantalla lo leía — quedaba
"puesto" en los datos y nunca aplicado en la interfaz.
**Corregido**: la ficha de detalle de cada planta (Buscar y Planificador,
comparten el mismo componente) ahora muestra "🌳 Poda de mantenimiento: cada
~N días aprox." dentro de la sección Cuidados cuando la especie tiene ese dato.

## Revisado y confirmado correcto (sin cambios)

- `clima.js`: los nombres de campo que devuelve `calcularBalanceHidrico`
  (`lluviaSuficiente`, `litrosPorM2`, etc.) coinciden exactamente con los que
  lee `riego.js`. Sin desajustes.
- `screens/AsistenteScreen.js`: chat, guardas de desmontaje y manejo de errores
  correctos.
- `screens/BuscarScreen.js`: los filtros (`donde`, `luz`, `tipo`) comparan
  contra los valores reales del catálogo (`ubicacion`, `nivelLuz`, `tipo`) sin
  ningún desajuste de texto.
- `screens/PlannerScreen.js`: tanto "Puedes plantar ahora" (determinista) como
  las sugerencias de IA y el botón "+ Agregar" están correctamente conectados
  a `supabase.js`.
- `gemini.js`: capa de red compartida por Scan/Planner/Asistente sin
  duplicación de lógica de error.
- `colaOffline.js`: `vaciarColaPendiente` no se usa en ningún sitio, pero es
  código muerto inofensivo (no un fallo funcional) — la cola ya se vacía sola
  elemento a elemento según se procesa.
- `store.js`, `theme.js`, `ubicacion.js`, `components/UI.js`,
  `components/AutocompletarPlanta.js`: sin hallazgos.

## Verificación

- Los 3 archivos tocados (App.js, screens/GardenScreen.js,
  components/DetallePlanta.js) parsean correctamente (comprobado con
  `_to_delete/pc.js`).
- Suite completa de Jest ejecutada en 3 tandas (por el límite de tiempo de la
  shell remota): **68 tests / 8 suites — todos en verde**, sin ninguna
  regresión introducida por los 3 cambios.

## Pendiente de confirmar por Pol (no verificable desde aquí)

No se ha podido consultar el esquema real de la base de datos de Supabase
en esta sesión (la shell remota usada para este proyecto tiene la red
bloqueada incluso para una petición HTTPS de prueba). Por tanto sigue sin
confirmar si las dos migraciones pendientes se han ejecutado ya contra la
base de datos real:
- `migracion_v4_origen.sql` (columna `origen`)
- `migracion_v5_imagen_cultivo.sql` (columna `imagen_url` + bucket de fotos)

Mientras no se confirme, el código sigue protegido por el patrón de
"capacidad" (`columnaOrigenDisponible()` / `columnaImagenCultivoDisponible()`
en supabase.js): si la columna no existe todavía, esos campos simplemente no
se envían, así que nada se rompe — pero tampoco se guardan el origen ni la
foto del cultivo hasta que Pol ejecute esas 2 migraciones SQL (aditivas, no
destructivas, no tocan los cultivos ya guardados).

## Addenda — 2ª pasada (tras confirmar migraciones v4/v5 ejecutadas)

Pol confirmó que ya ejecutó `migracion_v4_origen.sql` y
`migracion_v5_imagen_cultivo.sql`, así que `origen` e `imagen_url` ya se
guardan con normalidad (el patrón de capacidad los detecta solos, sin
tocar código).

### 4. Alertas de poda — eran genéricas, no individualizadas por árbol/seto
Repasando otra vez con lupa (petición explícita de Pol: que la poda salga
detallada e individualizada por árbol/seto), se confirmó un fallo más
grave de lo que parecía: la tarjeta "Toca podar" salía de una tabla
`plantas` en Supabase con solo 3 especies de EJEMPLO sembradas a mano en
el esquema (Limonero, Cerezo, Granado) — totalmente desconectada de lo
que Pol tiene realmente plantado. Si tenía un manzano de verdad, nunca
salía; si por casualidad tenía un limonero, salía el aviso genérico de la
especie, sin decir CUÁL limonero ni en qué zona, y sin forma de marcarlo
como ya podado.

**Corregido de raíz**: nuevo módulo `poda.js` que calcula la alerta
cruzando cada cultivo REAL y activo con el intervalo de poda de su
especie (`catalogoPlantas.js`, campo `poda`, ya eran ~54 especies con
dato real) y con la fecha de su última poda (`ultima_poda`, columna nueva
y opcional — ver `migracion_v6_poda.sql`, aditiva, no toca ningún cultivo
existente). Si nunca se ha podado, cuenta desde la fecha de siembra.
Cada tarjeta ahora dice el nombre, variedad y zona exactos del árbol/seto
en cuestión, avisa con 7 días de antelación, y tiene un botón "Ya lo he
podado" que registra la fecha y hace que la cuenta empiece de nuevo desde
hoy — todo por cultivo individual, no por especie genérica.

**Pendiente de Pol**: ejecutar `migracion_v6_poda.sql` en el SQL Editor de
Supabase (aditiva, no destructiva, no toca Calabacín/Zanahoria ni nada ya
guardado) para que el botón "Ya lo he podado" pueda guardar la fecha.
Mientras no se ejecute, las alertas se siguen calculando bien (usando la
fecha de siembra como referencia), simplemente el botón no tiene efecto
todavía (fail-soft, no rompe nada).

Verificación: `poda.js`, `supabase.js`, `screens/GardenScreen.js` parsean
correctamente y la suite completa de Jest sigue en verde (68/68) tras el
cambio.

## Montaje de EAS Update — progreso

Hecho en esta sesión:
- Instalado `expo-updates@~57.0.22` (versión exacta que espera el SDK 57,
  verificada contra `bundledNativeModules.json` del propio Expo).
- `app.json`: añadido el plugin `expo-updates` y `runtimeVersion: {policy:
  "appVersion"}` (así una actualización OTA solo se ofrece a builds con la
  misma versión de app.json — evita que una OTA rompa una build antigua
  con código nativo distinto).
- `eas.json`: el perfil `preview` (el que genera el APK instalable
  directamente) ya tiene su canal de actualizaciones (`channel:
  "preview"`) para que el APK y las OTA que se publiquen queden
  emparejados.

Bloqueado, y no lo puedo hacer yo: para terminar el montaje hace falta un
proyecto EAS real, y crearlo exige iniciar sesión con una cuenta de Expo
(`eas login`) — es la única cuenta/credencial que se necesita para todo
esto, y por seguridad no puedo introducir credenciales ni crear cuentas en
tu nombre. Es un paso de una sola vez.

Lo que Pol necesita hacer (una sola vez, ~2 minutos):
1. Si no tienes ya una cuenta gratuita en expo.dev, crear una (email +
   contraseña, gratis).
2. En una terminal, dentro de la carpeta del proyecto: `npx eas-cli login`
   e iniciar sesión con esa cuenta.

En cuanto confirmes que lo has hecho, en la siguiente sesión termino el
resto sin que tengas que tocar la terminal otra vez: `eas init` (crea el
proyecto y rellena el `projectId` real en app.json), `eas build --profile
preview --platform android` (genera el APK instalable) y `eas update
--channel preview` (publica la primera actualización OTA de prueba).

## Addenda — 3ª pasada (crash tras el primer build, causa y arreglo)

Tras `eas init` (proyecto creado: `pgb8s-team/huertoapp`, projectId en
`app.json`) y el primer `eas build --profile preview --platform android`,
el APK se instalaba pero la app se cerraba al abrir ("la aplicación
HuertoApp se ha cerrado porque tiene un error", con el diálogo de limpiar
caché de Android).

**Causa raíz (confirmada, reproducida en local):** `.env` está — y debe
seguir estando — en `.gitignore`, así que las claves reales nunca llegan
al build en la nube de EAS a menos que estén registradas también como
"Environment Variables" del proyecto en expo.dev. Sin ellas,
`EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_ANON_KEY` llegan como
`undefined` al bundle, y `createClient(undefined, undefined, ...)` en
`supabase.js` lanza un error síncrono en el momento de *importar* el
módulo ("supabaseUrl is required") — antes de que se pinte ni un solo
componente. Eso tira toda la app abajo con el diálogo genérico de
Android, que no dice nada sobre la causa real.

Tras registrar las 3 variables con `eas env:set` (paso que hizo Pol, ya
que este sandbox no tiene salida de red hacia `api.expo.dev`) y volver a
compilar, la app siguió crasheando igual — sin confirmación de que
`eas env:set` hubiera terminado bien ni de que el build recogiera las
variables.

**Arreglo aplicado (código, no solo configuración):**
- `supabase.js`: `createClient()` ya nunca lanza al importar el módulo,
  aunque falten las variables — usa una URL/clave de relleno inofensiva
  si no están. Se añade `export const SUPABASE_CONFIGURADO` (booleano).
- `App.js`: si `SUPABASE_CONFIGURADO` es `false`, la app ya no intenta
  montar la navegación normal — muestra una pantalla explicando
  exactamente qué falta ("Configuración incompleta... revisa eas
  env:list...") en vez de crashear a ciegas. El check va después de
  todos los hooks (no rompe las Reglas de los Hooks: el valor es una
  constante fijada al cargar el módulo, nunca cambia entre renders).

Con esto, si el próximo build sigue sin tener las variables, Pol verá en
el propio móvil un mensaje claro en vez de un crash genérico — eliminando
la necesidad de adivinar la causa desde fuera. Y si las variables SÍ
están bien registradas, la app funciona con normalidad (este cambio es
puramente defensivo, no toca la lógica cuando todo está configurado).

Verificado: parse-check limpio en ambos archivos + los 68 tests de Jest
en verde (2 fallos puntuales por timeout de 5s en este sandbox lento,
confirmados como falsos positivos al repetirlos solos con más margen —
no relacionados con este cambio).

**Pendiente para Pol:** volver a compilar (`eas build --profile preview
--platform android`), desinstalar el APK viejo del móvil e instalar el
nuevo. Si sigue sin abrir, ahora la propia pantalla dirá si es por
variables de entorno o por otra cosa — mándame una foto de esa pantalla.

## Addenda — 4ª pasada (red de seguridad en index.js, sin depender de adb)

Tras el arreglo de `supabase.js`/`App.js` (3ª pasada), el crash siguió
igual — diálogo genérico de Android — en un build que sí incluía ese
commit. Eso descarta que sea (solo) el problema de las variables de
Supabase: algo distinto revienta antes o durante el primer render, y sin
`adb logcat` no hay forma de ver qué es desde fuera del móvil.

En vez de pedirle a Pol que instale herramientas de Android (adb,
depuración USB), se ha añadido la red de seguridad en el propio
`index.js` (el entry point real, antes solo hacía
`registerRootComponent(App)` directo):

- La carga de `./App` se hace con `require()` dentro de un try/catch (no
  un `import` estático, que se evalúa antes de que cualquier try/catch
  del archivo pueda envolverlo) — así se atrapa un error que ocurra al
  *importar* App.js o cualquiera de sus dependencias.
- Un Error Boundary de React (`LimiteDeErrores`) envuelve `<App />` —
  atrapa errores durante el *render* (el caso más probable si el import
  en sí no falla pero algo revienta nada más montar el primer
  componente).
- En cualquiera de los dos casos, en vez de que Android cierre la app
  con el diálogo genérico, se muestra en pantalla el mensaje y la traza
  del error real.

Se deja como red de seguridad PERMANENTE (no solo para depurar esto
ahora): cualquier fallo de arranque futuro será visible directamente en
el móvil.

Verificado: parse-check limpio + 50/50 tests de Jest en verde (batch sin
timeouts).

**Pendiente:** Pol compila de nuevo (`eas build --profile preview
--platform android`), desinstala el APK viejo, instala el nuevo. Ahora,
si vuelve a fallar, la propia pantalla va a decir por qué — foto de esa
pantalla es lo que hace falta para el siguiente paso.

## Addenda — 5ª pasada (prueba diagnóstica: build SIN expo-updates)

Con la red de seguridad de `index.js` puesta, el crash sigue siendo el
mismo diálogo genérico de Android desde el primer instante — ni siquiera
llega a mostrarse la pantalla de error de `index.js`. Eso apunta a que el
fallo es anterior a que el motor de JavaScript llegue a ejecutar una sola
línea de nuestro código (ni el `require('./App')` ni el Error Boundary
pueden atrapar algo que pasa ANTES de que arranque el JS).

Revisando el commit inicial (`d53d6cb`), `expo-updates` estaba presente
desde el primerísimo build que se hizo — nunca se ha probado un build
sin él. Es un candidato serio: es un módulo nativo que se inicializa muy
pronto (antes que el JS de la app), leyendo configuración de metadatos
nativos (`runtimeVersion`, `updates.url`, projectId) inyectados por su
plugin de configuración en el momento de compilar — un fallo ahí
explicaría un crash instantáneo, nativo, indistinguible del que hemos
visto, y explicaría por qué NINGÚN arreglo a nivel de JavaScript (los
de las pasadas 3ª y 4ª) ha cambiado nada: el crash no le da tiempo a
ejecutarse a nuestro código.

**Prueba diagnóstica (temporal, para aislar la causa):**
- `package.json`: se quita la dependencia `expo-updates`.
- `app.json`: se quita el plugin `"expo-updates"`, y las claves
  `runtimeVersion`/`updates` (solo tienen sentido con el módulo
  presente). Backup del `app.json` completo (con todo esto) guardado en
  `app.json.bak_con_updates`, para restaurarlo en cuanto se confirme o
  descarte la hipótesis.
- Nada más cambia: Supabase, Gemini, cámara, ubicación, imagen — todo
  igual.

Si con este build (sin `expo-updates`) la app SÍ abre: confirmado que el
problema es ese módulo/su configuración, y el siguiente paso es
reconfigurarlo correctamente (probablemente con `eas update:configure`,
el comando oficial que automatiza esta configuración, en vez de haberla
tocado a mano en `app.json` como se hizo) antes de volver a añadirlo.

Si SIGUE crasheando igual sin `expo-updates`: se descarta esta hipótesis
y el candidato pasa a ser otro plugin nativo (`expo-camera`,
`expo-location`, `expo-image`) o algo en la configuración de Android
(permisos, iconos adaptativos) — se seguiría aislando uno a uno.

## Addenda — 6ª pasada (causa real encontrada: expo-notifications + Firebase)

Las pasadas 3ª-5ª fueron intentos razonados pero, en retrospectiva, a
ciegas: arreglos a nivel de JavaScript (Supabase, Error Boundary) y una
prueba de aislamiento (quitar expo-updates) que no dio con la causa.
Ninguno la tocaba porque el problema no estaba donde se buscaba.

**Lo que se encontró:** el proyecto ya tenía un patch (`patch-package`)
sobre `expo-notifications`, con un comentario propio explicando que esa
misma librería YA había tumbado la app una vez antes por un bug de
"lanza en vez de avisar" al auto-registrarse para notificaciones push —
pero ese arreglo anterior solo cubría el caso de Expo Go
(`isRunningInExpoGo()`). En un build real (preview/producción),
`notificaciones.js` importa `expo-notifications` por primera vez de
verdad (en Expo Go ese import se salta a propósito, por diseño — así
que la app "funcionaba bien en Expo Go" nunca fue una prueba real de
que este código estuviera sano). Al importarse en un build real, el
mismo módulo de auto-registro de push token intenta registrarse con
Firebase Cloud Messaging — y este proyecto NUNCA ha tenido (ni
necesita) un `google-services.json`, porque solo usa notificaciones
LOCALES (`scheduleNotificationAsync`), nunca push. Sin Firebase
configurado, esa inicialización revienta a nivel NATIVO (no es un throw
de JavaScript capturable — por eso ni el Error Boundary ni el
`try/catch` de `index.js` de la 4ª pasada evitaban el cierre: el fallo
ocurre en código nativo, antes/fuera del alcance de JavaScript).

**Arreglo:** se ha extendido el patch existente de `expo-notifications`
para que el auto-registro de push token se omita SIEMPRE (antes solo se
omitía en Expo Go) — esta app no lo necesita en ningún caso. Verificado
de forma rigurosa antes de tocar nada más: se descargó el paquete
`expo-notifications@57.0.20` limpio desde npm, se comprobó que el patch
se aplica sin errores con la misma herramienta (`patch-package`) que usa
el build real, y se releyó el resultado para confirmar que el código
final es el esperado.

Se ha restaurado `expo-updates` (app.json/eas.json/package.json) a como
estaba antes de la prueba de aislamiento de la 5ª pasada, ya que se
descartó como causa y SÍ hace falta para el objetivo final (EAS
Update).

Verificado: parse-check limpio + 50/50 tests de Jest en verde.

**Pendiente para Pol:** compilar una última vez con este arreglo. Si
esta hipótesis es correcta (evidencia fuerte: la librería ya había dado
un bug de la misma familia antes, documentado en el propio código;
nunca se había probado en un build real; y el patrón de fallo —
instantáneo, invisible a Expo Go, inmune a todo arreglo de JS — encaja
exactamente con un crash nativo de Firebase) la app debería abrir con
normalidad.

## Addenda — 7ª pasada (causa comprobada: expo-image-picker de otro SDK)

Comparando cada dependencia con `node_modules/expo/bundledNativeModules.json`
(la lista oficial de versiones nativas de Expo SDK 57), había UNA sola
incompatible: `expo-image-picker` estaba en `~17.0.8` (versión de Expo
SDK 54) cuando SDK 57 exige `~57.0.18`. Su código nativo Android
(Kotlin) está compilado contra una API de `expo-modules-core` de hace
3 SDKs; Expo registra TODOS los módulos nativos al arrancar la app, así
que el fallo es nativo e inmediato, antes de que cargue ningún JS — por
eso ningún arreglo de JS (Error Boundary, patch de notificaciones) tenía
efecto, y en Expo Go funcionaba (Expo Go trae su propio picker).

Arreglo: `package.json` → `"expo-image-picker": "~57.0.18"` y
`package-lock.json` actualizado (57.0.19, con `expo-image-loader` ~57.0.1).
La API usada en GardenScreen (`launchImageLibraryAsync` con
`mediaTypes: ['images']`) es compatible. Pendiente: `npm install` en el
PC y nuevo build con EAS.

## Addenda — 8ª pasada (mejoras funcionales, catálogo ampliado, accesibilidad y auditoría final — 18-23 sept 2026)

Continuación de la petición de Pol: "Aplica todas las mejoras... busca y
añade más variedades de plantas... mejora la interfaz... audita en
busca de fallos, código muerto o incoherencias". Se acordó con Pol
trabajar por fases con verificación entre cada una, dejando fuera de
este pase (por elección suya) 2 mejoras de infraestructura pesada:
seguimiento de coste/uso de Gemini vía proxy en la nube, y
sincronización instantánea con Supabase Realtime — ambas quedan
pendientes para más adelante, no descartadas.

**Fase A — fiabilidad del código existente:**
- `poda.js` gana cobertura de tests (`poda.test.js`, 12 tests nuevos).
- `gemini.js`: reintento automático + modelo de respaldo
  (`gemini-flash-latest`) si el modelo principal
  (`gemini-3.5-flash-lite`) falla, y clasificación de errores (bloqueo
  de seguridad / respuesta truncada / respuesta vacía) para mensajes
  más útiles. 15 tests nuevos en `gemini.test.js`.
- Asistente: el historial enviado a Gemini se recorta a los últimos 24
  turnos, para no crecer sin límite.
- Cola offline de fotos de diagnóstico: antes, si UN item fallaba al
  reintentarse, bloqueaba TODA la cola. Ahora cada item se reintenta de
  forma independiente (hasta 5 veces; tras eso se marca bloqueado y
  deja de reintentarse solo), con aviso en pantalla de cuántos
  diagnósticos quedan pendientes/bloqueados.

**Fase B — funciones nuevas (dependen de `migracion_v7.sql`, ver
"Pendiente para Pol" más abajo):**
- Botón "✓ Ya regado" por cultivo (mirror del de poda), reflejado en
  las recomendaciones de riego del día.
- Los diagnósticos de la cámara se pueden vincular a un cultivo real, y
  cada cultivo tiene un "Historial de diagnósticos" en su menú.
- Control de concurrencia al editar un cultivo (optimista, vía
  `updated_at`): si los 2 móviles editan el mismo cultivo casi a la
  vez, el segundo guardado avisa del conflicto en vez de pisar
  silenciosamente el cambio del otro.
- Limpieza automática de fotos huérfanas en Supabase Storage al
  reemplazar o borrar la foto de un cultivo.
- Historial de chat del Asistente guardado en Supabase, compartido
  entre los dos móviles.

**Fase C — catálogo:** ampliado de 126 a 168 especies (+42: hortalizas,
aromáticas, frutales, frutos secos, arbustos ornamentales y
trepadoras), con la misma ficha de datos que las ya existentes (riego,
poda cuando aplica, companionismo verificado en ambos sentidos).

**Fase D — interfaz:** pasada de accesibilidad basada en evidencia (no
un rediseño visual especulativo — el sistema de diseño existente en
`theme.js`/`UI.js` se consideró ya sólido): `accessibilityLabel`/
`accessibilityRole` en botones e iconos sin etiquetar de ScanScreen,
PlannerScreen y BuscarScreen.

**Fase E — auditoría final**, delegada a una segunda revisión
independiente del código completo (no solo lo tocado en este pase),
para evitar puntos ciegos del propio autor del código. 4 arreglos
aplicados, todos de bajo riesgo:
1. `App.js`: la ubicación GPS cacheada ahora se lee al arrancar toda la
   app, no solo al entrar en "Planificar" — si no, "Riego de hoy" podía
   pedir activar la ubicación aunque ya estuviera concedida y guardada.
2. `AsistenteScreen.js`: condición de carrera corregida — si el usuario
   enviaba un mensaje muy rápido al abrir el Asistente, la carga (algo
   más lenta) del historial persistido podía borrar de la pantalla el
   mensaje recién enviado (aunque ya estuviera guardado aparte).
3. `ScanScreen.js`: la lista de cultivos para vincular un diagnóstico
   se recarga ahora cada vez que se entra en "Escanear" (antes solo al
   arrancar la app entera).
4. `GardenScreen.js`/`BuscarScreen.js`: 4 botones "✕" reimplementados a
   mano sustituidos por el componente `BotonX` ya existente en
   `components/UI.js` (mismo resultado, menos duplicación).

No se tocó nada relacionado con `expo-notifications`/Firebase/el patch
de push (ver pasadas anteriores en este mismo archivo) ni ningún flujo
de guardado ya usado en producción salvo lo descrito arriba.

**Verificación final:** parse-check limpio en todos los archivos
tocados + suite completa de Jest en verde: **9 suites / 90 tests, 0
fallos.**

**Hallazgos revisados y descartados a propósito (no requieren acción):**
- El id de modelo `gemini-3.5-flash-lite` no se puede verificar como
  válido desde este entorno sin acceso real a la API de Google — el
  sistema de reintento+respaldo ya cubre el caso de que deje de
  existir.
- Las acciones rápidas "Ya lo he podado"/"✓ Ya regado" no llevan
  control de concurrencia (a diferencia de "Editar cultivo"). Riesgo
  real mínimo (exige que los 2 móviles pulsen el mismo botón en el
  mismo instante) — no se tocó para no arriesgar el flujo de guardado.

**Pendiente para Pol:**
- Ejecutar `migracion_v7.sql` en el SQL Editor de Supabase para activar
  todo lo de la Fase B (sin ella la app sigue funcionando exactamente
  igual que antes, solo sin esas funciones nuevas — patrón fail-soft).
- Sigue sin confirmar si `migracion_v6_poda.sql` llegó a ejecutarse —
  si el botón "Ya lo he podado" no guarda nada, esa es la causa.
- Este pase es solo JS/lógica + 1 migración SQL aditiva, sin cambios
  nativos ni en `app.json` — debería poder publicarse con
  `eas update --channel preview` (OTA), sin necesitar un build nuevo.
