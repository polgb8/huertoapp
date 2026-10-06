# 🌱 HuertoApp

App Android para llevar tu huerto o jardín: **qué regar, podar y cosechar cada día**, recordatorios a la hora que elijas, planificador de siembra y **análisis de plantas con IA a partir de una foto** (especie, tamaño, salud, falta o exceso de agua). Incluye un asistente de chat que conoce tu huerto.

Cada persona tiene **su propia cuenta y su propio huerto** (los datos están aislados). Todo funciona con planes **gratuitos**.

---

## 📲 Instalar y usar

1. Abre **[Releases](https://github.com/polgb8/huertoapp/releases/latest)** desde el móvil y descarga `HuertoApp-x.y.z.apk`.
2. Ábrelo e instala (si lo pide, permite «Instalar apps de origen desconocido» para tu navegador).
3. Abre la app → **Crear cuenta** con tu email y una contraseña.
4. Pestaña **Ajustes**:
   - **Clave de Gemini** (gratis): entra en <https://aistudio.google.com/apikey> con tu cuenta de Google → *Create API key* → cópiala y pégala. La app la comprueba y la guarda solo en tu móvil.
   - **Ubicación**: pulsa *Usar mi ubicación* (clima, riego y cultivos de temporada).
   - **Recordatorios**: elige la hora a la que quieres los avisos de riego y poda.
5. En **Hoy** → *Añadir planta*: haz una foto y la IA la reconoce.

> Si tenías instalada una versión anterior compilada con EAS, desinstálala antes (la firma del APK cambia). Tus datos siguen en tu cuenta.

### Funciones
- **Hoy**: riego por zonas («Regar todo»), poda con pasos, cosecha, tareas y deshacer.
- **Mi huerto**: tus plantas con riego calculado (FAO-56 con el tiempo real de tu zona), cosechas e historial.
- **Analizar**: foto → diagnóstico de plagas, poda o cosecha. Sin cobertura, la foto se guarda y se analiza sola al volver la conexión.
- **Plantar**: qué sembrar este mes y sugerencias de la IA.
- **Buscar**: ficha de cada planta.
- **Asistente 🤖**: chat con contexto de tu huerto (también con foto).

---

## 💸 Coste: 0 €

| Servicio | Plan gratuito | Qué hace la app |
|---|---|---|
| Google AI Studio (Gemini) | ~500 análisis/día por clave con `gemini-3.5-flash-lite` (+500 con el modelo de respaldo) | Cuenta tus peticiones y **avisa al 80 %**; si se agota el principal usa el de respaldo |
| Supabase Free | 500 MB de base de datos, 1 GB de fotos | Muestra el uso en Ajustes y **avisa al 80 %**. El plan gratis nunca cobra: si se llena, solo limita |
| GitHub Actions | Gratis en repositorios públicos | Compila el APK y lo publica en Releases |

Los límites de Gemini los fija Google por proyecto y pueden cambiar: consúltalos en AI Studio → *Rate limit*. El cupo diario se renueva a medianoche (hora del Pacífico).

---

## 🛠️ Desarrollo

**Requisitos:** Node 22, un proyecto Supabase (gratis).

### Supabase
En **SQL Editor** ejecuta, en orden: `supabase_schema.sql`, `migracion_v2…v10`, `migracion_v11_multiusuario.sql` (login + aislamiento por usuario, RLS) y `migracion_v12_uso.sql` (uso del plan gratuito).
En **Authentication → Email** desactiva *Confirm email* (el correo gratuito de Supabase solo llega a miembros del equipo).

### Variables
`.env.production` lleva la URL y la clave **publishable** de Supabase (son públicas por diseño; los datos los protege RLS). Para desarrollo local copia `.env.example` a `.env` (puedes añadir tu propia `EXPO_PUBLIC_GEMINI_API_KEY`; nunca la subas).

```bash
npm install
npx expo start      # Expo Go
npm test            # tests (Jest)
```

### Compilar el APK
Cada `push` a `main` ejecuta **Actions → Compilar APK**: tests → `expo prebuild` → `gradlew assembleRelease` → publica `HuertoApp-<versión>.apk` en Releases (la versión sale de `app.json`). También se puede lanzar a mano desde la pestaña *Actions*.

## 🔐 Seguridad
- Sin claves secretas en el repositorio. Nunca subas la `service_role` ni tu `.env`.
- Cada usuario solo puede leer y modificar sus filas y su carpeta de fotos (RLS).
- La clave de Gemini de cada usuario se guarda solo en su móvil y se borra al cerrar sesión.

## Estructura
- `App.js` navegación y sesión · `screens/` pantallas · `components/` UI y asistente
- `supabase.js` datos y fotos · `gemini.js` IA · `limitesGratis.js` cupos gratuitos
- `riego.js`, `poda.js`, `clima.js`, `avisosHuerto.js` lógica agronómica y recordatorios
- `migracion_*.sql` esquema de la base de datos
