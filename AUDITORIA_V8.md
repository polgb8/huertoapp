# HuertoApp v8 — Auditoría final: medidor de luz, login/compartir huerto

Auditoría de solo lectura sobre los cambios del pase más reciente (posteriores a AUDITORIA_V7.md): el medidor de luz real en Buscar (Android con sensor real + guía de referencia en iOS/web), y el inicio de sesión real con Supabase Auth para "Compartir huerto". No se ha tocado ningún archivo de código durante esta auditoría; los 3 bugs reales que sí se encontraron y corrigieron en el pase de V7 (error de sintaxis en supabase.js, y las dos condiciones de carrera del drenaje de la cola offline) siguen corregidos y no han reaparecido.

## 0. Nota de metodología

`node --check` no es fiable en este proyecto para detectar errores de sintaxis reales: se comprobó que Node devuelve "sin errores" incluso con JSX roto detrás de un `export default function` válido. Para esta auditoría se usó en su lugar el propio `@babel/core` del proyecto (con el plugin de JSX) para parsear cada archivo tocado, método que si detecta el mismo tipo de fallo que se coló en V7 (verificado reproduciéndolo a propósito). Se recomienda usar este método, no `node --check`, en futuras auditorías de archivos con JSX/imports de ES modules.

## 1. Archivos revisados línea a línea

screens/BuscarScreen.js, screens/AuthScreen.js (nuevo), App.js, store.js, supabase.js, screens/HomeScreen.js, package.json/package-lock.json, migracion_v2_zonas_cantidad.sql, migracion_v3_atribucion.sql, supabase_schema.sql.

## 2. Estado de los tests

49 tests en total. Ejecutados por lotes (el disco montado sigue siendo lento, mismo problema ya documentado desde V5 — no es una regresión):
- store/gemini/utils/colaOffline: 31/31 ✅
- screens/ScanScreen.test.js (con `--testTimeout=15000`): 11/11 ✅
- `__tests__/AppFlow.test.js` (con `--testTimeout=30000` para el test más lento, "Arranque sin red"): 7/7 ✅

**Total: 49/49 pasan** dándoles el tiempo que necesitan en este disco lento. Con el timeout por defecto de Jest (5000ms) es esperable que ese mismo test puntual falle por lentitud de disco, exactamente igual que en V5/V6/V7 — no es un fallo nuevo ni relacionado con este pase.

Nadie ha añadido tests nuevos para AuthScreen.js, el medidor de luz de BuscarScreen.js, ni el guardado de sesión en App.js — mismo hueco de cobertura ya señalado en V7 para lo añadido en el pase anterior, ahora ampliado a estos archivos nuevos. No es un bug, es deuda de test pendiente.

## 3. ¿Arrancaría la app? Sí

No se ha encontrado ningún error de sintaxis ni de build. Se comprobó específicamente, y sin encontrar problemas:
- Ningún hook de React llamado de forma condicional o después de un `return` anticipado (revisado a mano en App.js y AuthScreen.js, los dos archivos más sensibles a esto).
- Todos los imports nuevos corresponden a exports reales de su archivo de origen (comprobado contra el código real, no asumido).
- Sin exports duplicados.
- La forma del resultado de `onAuthStateChange` coincide con la que expone de verdad `@supabase/auth-js` en node_modules.

## 4. Bugs reales encontrados

**Ninguno.** Pase limpio. Comprobado específicamente y sin encontrar fallos:
- Los 3 únicos `.insert(...)` de todo el código (`insertarCultivo`, `insertarDiagnostico`, `crearTareaSaneamiento`, los tres en supabase.js) pasan siempre por `conAtribucion`, que solo añade `creado_por_email` si una comprobación previa confirmó que la columna ya existe. Ningún guardado puede romperse por esta columna nueva antes de que se ejecute la migración v3.
- El guardián de carga de sesión en App.js evita que se llegue a ver el navegador de pestañas antes de tiempo, y no se cuelga si `AsyncStorage` fallara.
- La suscripción de `LightSensor` se limpia (`.remove()`) en todos los caminos posibles: al cerrar el modal, al desmontar, si el sensor no está disponible, y al terminar la medición — no se ha encontrado ninguna fuga.
- Las dos migraciones nuevas (v2 y v3) no chocan entre sí ni con el esquema original: solo añaden columnas distintas, ambas con `IF NOT EXISTS`.
- Las pantallas que no se tocaron en este pase (GardenScreen, PlannerScreen) no leen nada de `usuario`/`sesión` y por tanto no tienen ninguna superficie nueva de regresión.

Detalles menores (no bugs, cosas a mejorar si se quiere en el futuro): un segundo `useEffect` de limpieza redundante (pero inofensivo) en el modal del medidor de luz; AuthScreen no valida el formato del email en el propio dispositivo antes de enviarlo (Supabase lo valida igualmente, solo cuesta un viaje de red de más); la tarjeta "Compartir huerto" no tiene un flujo de invitación con código, solo explica que la otra persona debe crear su propia cuenta (es la decisión de diseño tomada a propósito, y el RLS confirma que funciona igual para cualquier cuenta).

## 5. Confirmación del RLS (verbatim)

Se ha leído supabase_schema.sql completo. Las 16 políticas de las 4 tablas (`plantas`, `diagnosticos`, `cultivos_huerto`, `tareas_huerto`) son literalmente `to anon, authenticated using (true)` / `with check (true)`, sin ningún filtro por usuario. Ejemplo real tal cual aparece en el archivo:

```sql
create policy "anon_select_cultivos" on public.cultivos_huerto for select to anon, authenticated using (true);
create policy "anon_insert_cultivos" on public.cultivos_huerto for insert to anon, authenticated with check (true);
create policy "anon_update_cultivos" on public.cultivos_huerto for update to anon, authenticated using (true) with check (true);
create policy "anon_delete_cultivos" on public.cultivos_huerto for delete to anon, authenticated using (true);
```

Mismo patrón en las otras 3 tablas y en `storage.objects`. Confirmado: cualquier persona que inicie sesión con su propia cuenta tiene exactamente el mismo acceso que ya tenía la app hoy con la clave anónima — el login es solo una etiqueta de identidad ("por Pol"/"por [la otra persona]"), no una barrera de seguridad nueva, tal y como se diseñó a propósito.

## 6. Lo que solo se puede confirmar con un dispositivo real

1. El comportamiento del sensor de luz en el móvil Android concreto de Pol (si `isAvailableAsync()` devuelve `true` en ese hardware, y si las lecturas son razonables).
2. Si la sesión guardada con AsyncStorage sobrevive de verdad a cerrar la app del todo y reiniciar el teléfono (no solo a recargar Metro).
3. Si el proyecto de Supabase de Pol tiene activada la confirmación por email — determina si la otra persona puede entrar justo después de crear su cuenta o si necesita confirmar el correo primero.
4. Ejecutar las dos migraciones pendientes contra la base de datos real (verificado que son aditivas y no chocan, pero solo Supabase puede confirmar una ejecución limpia contra los datos reales).
5. Cómo se siente en la práctica un error de red durante el login (el código lo maneja con un mensaje y hay que reintentar a mano, no hay cola offline para el login, a propósito).
6. Si la ventana de 2,5 segundos de muestreo del medidor de luz se siente bien en la mano (esto es una decisión de UX/hardware, no algo verificable de forma estática).

No hay indicios de ningún riesgo adicional más allá de esta lista — en particular, nada sugiere que la app vaya a fallar al arrancar.
