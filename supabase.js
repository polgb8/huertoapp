// ============================================================
// supabase.js — Cliente centralizado de Supabase + helpers de
// datos compartidos por GardenScreen, ScanScreen, PlannerScreen y
// AsistenteScreen.
// ============================================================

import 'react-native-url-polyfill/auto'; // necesario para supabase-js en RN
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { decode as decodeBase64 } from 'base64-arraybuffer';
import { crearAbortConTimeout } from './utils';

// ------------------------------------------------------------
// CONFIGURACIÓN — las claves reales viven en variables de entorno (.env,
// prefijo EXPO_PUBLIC_ para que Expo las incluya en el bundle del cliente)
// en vez de hardcodeadas aquí — ver .env.example. Sustitúyelas por las tuyas
// propias en .env si cambias de proyecto.
// ------------------------------------------------------------
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
export const NOMBRE_PLANTA_DEFECTO = 'General';

// Si este build no incluyo las variables de entorno EXPO_PUBLIC_SUPABASE_*
// (por ejemplo, un build de EAS que no tenia las "Environment Variables"
// del proyecto registradas todavia), createClient() mas abajo lanzaria un
// error sincrono en el momento de IMPORTAR este archivo ("supabaseUrl is
// required"), lo que tira TODA la app abajo con el dialogo generico de
// Android de "la app se ha cerrado", sin decir por que. App.js comprueba
// este flag antes de renderizar nada y muestra una pantalla explicando
// exactamente que falta, en vez de crashear a ciegas.
export const SUPABASE_CONFIGURADO = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

// ------------------------------------------------------------
// Columna "origen" (semilla | trasplante): añadida por
// migracion_v4_origen.sql, aditiva y OPCIONAL — igual que zona/cantidad
// en su momento (migracion_v2), hasta que Pol la ejecute en el SQL
// Editor de Supabase la columna no existe todavía, y un INSERT que la
// incluyera fallaría entero (PostgREST no ignora claves desconocidas).
// Se comprueba UNA VEZ con un SELECT inofensivo y se cachea en memoria,
// igual que el resto de comprobaciones de este archivo: fail-safe, más
// vale guardar el cultivo sin el dato de origen que no guardarlo.
// ------------------------------------------------------------
// v11: los "gates" de columnas solo cachean "no existe" cuando el error es
// realmente de columna inexistente. Un error de red o de sesión (p. ej. una
// consulta lanzada antes de iniciar sesión, que RLS rechaza) NO debe
// desactivar la función para toda la sesión de la app.
function esColumnaInexistente(error) {
  const code = String(error?.code || '');
  const msg = String(error?.message || '').toLowerCase();
  return code === '42703' || code === 'PGRST204' || code === '42P01' ||
    (msg.includes('column') && (msg.includes('does not exist') || msg.includes('could not find')));
}

let cacheColumnaOrigen = null;

async function columnaOrigenDisponible() {
  if (cacheColumnaOrigen !== null) return cacheColumnaOrigen;
  try {
    const { error } = await supabase.from('cultivos_huerto').select('origen').limit(1);
    if (error && !esColumnaInexistente(error)) return false; // error transitorio (red, sesión): no se cachea
    cacheColumnaOrigen = !error;
  } catch (e) {
    return false; // sin red: no se cachea, se reintentará
  }
  return cacheColumnaOrigen;
}

// Columna "imagen_url" (foto opcional del cultivo): añadida por
// migracion_v5_imagen_cultivo.sql, mismo patrón de comprobación
// aditiva/opcional que "origen" arriba.
let cacheColumnaImagenCultivo = null;

async function columnaImagenCultivoDisponible() {
  if (cacheColumnaImagenCultivo !== null) return cacheColumnaImagenCultivo;
  try {
    const { error } = await supabase.from('cultivos_huerto').select('imagen_url').limit(1);
    if (error && !esColumnaInexistente(error)) return false; // error transitorio (red, sesión): no se cachea
    cacheColumnaImagenCultivo = !error;
  } catch (e) {
    return false; // sin red: no se cachea, se reintentará
  }
  return cacheColumnaImagenCultivo;
}

// Columna "ultima_poda" (fecha de la última poda de mantenimiento de ESE
// cultivo en concreto, no de la especie en general): añadida por
// migracion_v6_poda.sql, mismo patrón aditivo/opcional que "origen" e
// "imagen_url" arriba. Es lo que permite que la alerta de poda (ver
// poda.js) sea individual por árbol/seto realmente plantado, en vez de
// una lista genérica de especies desconectada del huerto real de Pol.
let cacheColumnaUltimaPoda = null;

async function columnaUltimaPodaDisponible() {
  if (cacheColumnaUltimaPoda !== null) return cacheColumnaUltimaPoda;
  try {
    const { error } = await supabase.from('cultivos_huerto').select('ultima_poda').limit(1);
    if (error && !esColumnaInexistente(error)) return false; // error transitorio (red, sesión): no se cachea
    cacheColumnaUltimaPoda = !error;
  } catch (e) {
    return false; // sin red: no se cachea, se reintentará
  }
  return cacheColumnaUltimaPoda;
}

// Columna "ultimo_riego" (fecha del último riego CONFIRMADO por el
// usuario para ese cultivo en concreto): añadida por migracion_v7.sql,
// espejo exacto de "ultima_poda" de arriba. Es lo que permite que
// marcarCultivoRegado() suprima la recomendación de riego de hoy en los
// DOS móviles, no solo en el que pulsó el botón (ver riego.js).
let cacheColumnaUltimoRiego = null;

async function columnaUltimoRiegoDisponible() {
  if (cacheColumnaUltimoRiego !== null) return cacheColumnaUltimoRiego;
  try {
    const { error } = await supabase.from('cultivos_huerto').select('ultimo_riego').limit(1);
    if (error && !esColumnaInexistente(error)) return false; // error transitorio (red, sesión): no se cachea
    cacheColumnaUltimoRiego = !error;
  } catch (e) {
    return false; // sin red: no se cachea, se reintentará
  }
  return cacheColumnaUltimoRiego;
}

// Columna "tamano" ('pequeno'|'mediano'|'grande'): migracion_v8.sql.
// Ajusta el riego de árboles/arbustos (ver riego.js). Mismo patrón.
let cacheColumnaTamano = null;

async function columnaTamanoDisponible() {
  if (cacheColumnaTamano !== null) return cacheColumnaTamano;
  try {
    const { error } = await supabase.from('cultivos_huerto').select('tamano').limit(1);
    if (error && !esColumnaInexistente(error)) return false; // error transitorio (red, sesión): no se cachea
    cacheColumnaTamano = !error;
  } catch (e) {
    return false; // sin red: no se cachea, se reintentará
  }
  return cacheColumnaTamano;
}

// Gate genérico (v15) para columnas nuevas de cultivos_huerto:
// diametro_copa / edad_estimada (migracion_v9.sql). Mismo patrón.
const cacheColumnas = new Map();
async function columnaCultivoDisponible(nombre) {
  if (cacheColumnas.has(nombre)) return cacheColumnas.get(nombre);
  let ok = false;
  try {
    const { error } = await supabase.from('cultivos_huerto').select(nombre).limit(1);
    if (error && !esColumnaInexistente(error)) return false; // transitorio: no se cachea
    ok = !error;
  } catch (e) {
    return false; // sin red: no se cachea
  }
  cacheColumnas.set(nombre, ok);
  return ok;
}

// Columna "updated_at" en cultivos_huerto (se actualiza sola en cada
// UPDATE vía trigger, ver migracion_v7.sql): base del control de
// concurrencia optimista de actualizarCultivo más abajo.
let cacheColumnaUpdatedAt = null;

async function columnaUpdatedAtDisponible() {
  if (cacheColumnaUpdatedAt !== null) return cacheColumnaUpdatedAt;
  try {
    const { error } = await supabase.from('cultivos_huerto').select('updated_at').limit(1);
    if (error && !esColumnaInexistente(error)) return false; // error transitorio (red, sesión): no se cachea
    cacheColumnaUpdatedAt = !error;
  } catch (e) {
    return false; // sin red: no se cachea, se reintentará
  }
  return cacheColumnaUpdatedAt;
}

// Columna "cultivo_id" en diagnosticos (vincula un diagnóstico al cultivo
// REAL de cultivos_huerto, no solo a la planta genérica "General"):
// añadida por migracion_v7.sql, mismo patrón aditivo/opcional que el
// resto. Es lo que permite un historial de diagnósticos POR cultivo
// (ver listarDiagnosticosPorCultivo más abajo y GardenScreen).
let cacheColumnaCultivoIdDiagnostico = null;

async function columnaCultivoIdDiagnosticoDisponible() {
  if (cacheColumnaCultivoIdDiagnostico !== null) return cacheColumnaCultivoIdDiagnostico;
  try {
    const { error } = await supabase.from('diagnosticos').select('cultivo_id').limit(1);
    if (error && !esColumnaInexistente(error)) return false; // error transitorio (red, sesión): no se cachea
    cacheColumnaCultivoIdDiagnostico = !error;
  } catch (e) {
    return false; // sin red: no se cachea, se reintentará
  }
  return cacheColumnaCultivoIdDiagnostico;
}

// Sin login (ver App.js): la app se usa desde varios móviles a la vez sin
// cuenta, así que no hay sesión que persistir — cada petición usa
// simplemente la clave anon (RLS ya da acceso completo a `anon`, ver
// supabase_schema.sql). persistSession/autoRefreshToken en false evita que
// supabase-js intente guardar nada en almacenamiento local para una
// sesión que nunca existe.
// Fallback inofensivo si faltan las env vars: createClient() exige un
// primer argumento con forma de URL o lanza de inmediato. Con
// SUPABASE_CONFIGURADO=false ninguna llamada real a `supabase` va a
// funcionar igualmente (fallaria por red, ya que el host es falso), pero
// al menos no revienta el arranque de la app entera — ver App.js.
export const supabase = createClient(
  SUPABASE_URL || 'https://config-incompleta.supabase.co',
  SUPABASE_ANON_KEY || 'config-incompleta',
  {
    // v11 (multiusuario): hay login real (Supabase Auth, email+contraseña).
    // La sesión se guarda en AsyncStorage para no pedir login en cada apertura
    // y se renueva sola. Los datos de cada usuario los aísla RLS por user_id.
    auth: {
      storage: AsyncStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  }
);

// ------------------------------------------------------------
// obtenerPlantaPorDefecto: upsert atómico (requiere UNIQUE(nombre) en
// SQL) para evitar filas "General" duplicadas si dos pantallas guardan
// casi a la vez (ver AUDITORIA.md v1 para el detalle del bug original).
// ------------------------------------------------------------
export async function obtenerPlantaPorDefecto() {
  const { signal, cancelar } = crearAbortConTimeout();
  try {
    const { data, error } = await supabase
      .from('plantas')
      .upsert(
        { nombre: NOMBRE_PLANTA_DEFECTO, ubicacion: 'Huerto' },
        { onConflict: 'nombre', ignoreDuplicates: false }
      )
      .select('id')
      .single()
      .abortSignal(signal);

    if (error) throw error;
    return data?.id ?? null;
  } finally {
    cancelar();
  }
}

// ------------------------------------------------------------
// listarCultivosSembrados: usado por PlannerScreen para darle a Gemini
// contexto de qué hay plantado y sugerir una rotación sensata.
// ------------------------------------------------------------
export async function listarCultivosSembrados() {
  const { signal, cancelar } = crearAbortConTimeout();
  try {
    const { data, error } = await supabase
      .from('cultivos_huerto')
      .select('nombre, variedad')
      .eq('estado', 'sembrado')
      .abortSignal(signal);

    if (error) throw error;
    return data ?? [];
  } finally {
    cancelar();
  }
}

// ------------------------------------------------------------
// listarHistorialCultivos: usado por PlannerScreen para dar a Gemini
// memoria de rotación (qué se ha cultivado, no solo lo que hay ahora),
// pidiendo hasta 4 años de historial como marca el enunciado.
// ------------------------------------------------------------
export async function listarHistorialCultivos() {
  const { signal, cancelar } = crearAbortConTimeout();
  try {
    const haceCuatroAnios = new Date();
    haceCuatroAnios.setFullYear(haceCuatroAnios.getFullYear() - 4);

    const { data, error } = await supabase
      .from('cultivos_huerto')
      .select('nombre, variedad, estado, fecha_siembra')
      .gte('fecha_siembra', haceCuatroAnios.toISOString())
      .order('fecha_siembra', { ascending: false })
      .abortSignal(signal);

    if (error) throw error;
    return data ?? [];
  } finally {
    cancelar();
  }
}

// ------------------------------------------------------------
// listarCultivosHuerto: usado por GardenScreen para el dashboard.
// ------------------------------------------------------------
export async function listarCultivosHuerto() {
  const { signal, cancelar } = crearAbortConTimeout();
  try {
    const { data, error } = await supabase
      .from('cultivos_huerto')
      .select('*')
      .order('fecha_siembra', { ascending: false })
      .abortSignal(signal);

    if (error) throw error;
    return data ?? [];
  } finally {
    cancelar();
  }
}

// ------------------------------------------------------------
// insertarCultivo: usado por el botón "Añadir a mi huerto" de Planner y
// por el formulario manual de Mi huerto. `zona` (p.ej. "Bancal 1") y
// `origen` ('semilla' | 'trasplante') son opcionales — columnas
// aditivas de migracion_v2_zonas_cantidad.sql y migracion_v4_origen.sql
// respectivamente; si no se pasan, quedan null/por defecto en la fila.
// ------------------------------------------------------------
export async function insertarCultivo(cultivo) {
  const { signal, cancelar } = crearAbortConTimeout();
  try {
    const plantaId = await obtenerPlantaPorDefecto();
    const fila = {
      planta_id: plantaId,
      nombre: cultivo.nombre,
      variedad: cultivo.variedad ?? null,
      distancia_cm: cultivo.distancia_cm ?? null,
      dias_cosecha: cultivo.dias_cosecha ?? 60,
      asociacion: cultivo.asociacion ?? null,
      instrucciones: cultivo.instrucciones ?? null,
      estado: 'sembrado',
      zona: cultivo.zona || null,
      cantidad: Math.max(1, parseInt(cultivo.cantidad, 10) || 1),
    };
    // Añadir un cultivo que ya estaba plantado (no una sugerencia de hoy):
    // permite fijar la fecha real de siembra en vez de asumir "hoy", para
    // que la barra de progreso hacia la cosecha sea correcta desde ya.
    if (cultivo.fechaSiembraISO) {
      fila.fecha_siembra = cultivo.fechaSiembraISO;
    }
    // origen ('semilla' | 'trasplante' | 'establecida' = ya estaba
    // plantada, fecha real desconocida): solo se manda si la migración v4
    // ya se ha ejecutado (ver columnaOrigenDisponible arriba).
    if (await columnaOrigenDisponible()) {
      fila.origen = cultivo.origen || 'semilla';
    }
    // imagen_url: solo si la migración v5 ya se ha ejecutado (ver
    // columnaImagenCultivoDisponible arriba). Nunca se manda `null`
    // salvo que la columna exista: no tiene sentido escribirlo si no hay
    // dónde guardarlo.
    if (cultivo.tamano && (await columnaTamanoDisponible())) {
      fila.tamano = cultivo.tamano;
    }
    if (cultivo.diametro_copa && (await columnaCultivoDisponible('diametro_copa'))) {
      fila.diametro_copa = cultivo.diametro_copa;
    }
    if (cultivo.edad_estimada && (await columnaCultivoDisponible('edad_estimada'))) {
      fila.edad_estimada = true;
    }
    if (cultivo.tipo_suelo && (await columnaCultivoDisponible('tipo_suelo'))) {
      fila.tipo_suelo = cultivo.tipo_suelo;
    }
    if (cultivo.imagen_url && (await columnaImagenCultivoDisponible())) {
      fila.imagen_url = cultivo.imagen_url;
    }
    const { data, error } = await supabase
      .from('cultivos_huerto')
      .insert(fila)
      .select('id')
      .abortSignal(signal);
    if (error) throw error;
    // Devuelve el id (o null) para poder guardar datos locales de respaldo
    // (p.ej. origen "ya estaba plantada" si la migración v4 no está).
    return {
      id: Array.isArray(data) ? data[0]?.id ?? null : data?.id ?? null,
      origenGuardado: 'origen' in fila,
      tamanoGuardado: 'tamano' in fila,
      diametroGuardado: 'diametro_copa' in fila,
      edadEstimadaGuardada: 'edad_estimada' in fila,
      sueloGuardado: 'tipo_suelo' in fila,
    };
  } finally {
    cancelar();
  }
}

// ------------------------------------------------------------
// actualizarCultivo: edición de un cultivo ya guardado (menú "..." de
// GardenScreen). Solo manda las columnas que de verdad se están
// cambiando (`cambios` es un objeto parcial), y respeta el mismo gateo
// de compatibilidad que insertarCultivo para origen/imagen_url — nunca
// intenta escribir una columna que todavía no existe en la base real.
// ------------------------------------------------------------
export async function actualizarCultivo(id, cambios) {
  const { signal, cancelar } = crearAbortConTimeout();
  try {
    const fila = {};
    if (cambios.variedad !== undefined) fila.variedad = cambios.variedad || null;
    if (cambios.zona !== undefined) fila.zona = cambios.zona || null;
    if (cambios.cantidad !== undefined) fila.cantidad = Math.max(1, parseInt(cambios.cantidad, 10) || 1);
    if (cambios.dias_cosecha !== undefined) {
      fila.dias_cosecha = Math.max(1, parseInt(cambios.dias_cosecha, 10) || 60);
    }
    if (cambios.origen !== undefined && (await columnaOrigenDisponible())) {
      fila.origen = cambios.origen;
    }
    if (cambios.imagen_url !== undefined && (await columnaImagenCultivoDisponible())) {
      fila.imagen_url = cambios.imagen_url;
    }
    if (cambios.ultima_poda !== undefined && (await columnaUltimaPodaDisponible())) {
      fila.ultima_poda = cambios.ultima_poda;
    }
    if (cambios.ultimo_riego !== undefined && (await columnaUltimoRiegoDisponible())) {
      fila.ultimo_riego = cambios.ultimo_riego;
    }
    if (cambios.tamano !== undefined && (await columnaTamanoDisponible())) {
      fila.tamano = cambios.tamano;
    }
    if (cambios.fecha_siembra !== undefined && cambios.fecha_siembra) {
      fila.fecha_siembra = cambios.fecha_siembra;
    }
    if (cambios.diametro_copa !== undefined && (await columnaCultivoDisponible('diametro_copa'))) {
      fila.diametro_copa = cambios.diametro_copa;
    }
    if (cambios.edad_estimada !== undefined && (await columnaCultivoDisponible('edad_estimada'))) {
      fila.edad_estimada = !!cambios.edad_estimada;
    }
    if (cambios.tipo_suelo !== undefined && (await columnaCultivoDisponible('tipo_suelo'))) {
      fila.tipo_suelo = cambios.tipo_suelo;
    }
    if (Object.keys(fila).length === 0) return; // nada que actualizar de verdad

    // Control de concurrencia optimista (auditoría de mejoras): si se pasa
    // `updatedAtEsperado` (el updated_at que tenía el cultivo cuando se
    // ABRIÓ la edición, ver GardenScreen) Y la migración v7 ya está
    // disponible, el UPDATE solo se aplica si nadie más lo ha tocado
    // desde entonces — si otro móvil editó este mismo cultivo mientras
    // tanto, `updated_at` ya no coincide, el UPDATE afecta 0 filas y se
    // avisa del conflicto en vez de sobrescribir a ciegas el cambio del
    // otro móvil. Fail-soft: sin `updatedAtEsperado` o sin la columna
    // todavía, se actualiza sin más comprobación (comportamiento de
    // siempre) — nunca bloquea un guardado por esto.
    let query = supabase.from('cultivos_huerto').update(fila).eq('id', id);
    const controlDeConcurrencia = cambios.updatedAtEsperado !== undefined && (await columnaUpdatedAtDisponible());
    if (controlDeConcurrencia) {
      query = query.eq('updated_at', cambios.updatedAtEsperado);
    }

    const conUpdatedAt = await columnaUpdatedAtDisponible();
    const { data, error } = await query.select(conUpdatedAt ? 'id, updated_at' : 'id').abortSignal(signal);
    if (error) throw error;

    if (controlDeConcurrencia && (!data || data.length === 0)) {
      throw new Error('CONFLICTO_CONCURRENCIA');
    }
    // Nuevo updated_at (o undefined): la pantalla lo guarda en su copia local.
    return data?.[0]?.updated_at;
  } finally {
    cancelar();
  }
}

// ------------------------------------------------------------
// marcarCultivoPodado: registra "hoy" como última poda de este cultivo
// en concreto (botón "Ya lo he podado" de la alerta individual, ver
// poda.js + GardenScreen). Si la migración v6 todavía no se ha
// ejecutado, no hace nada (fail-soft, igual que el resto de columnas
// opcionales): la alerta seguirá saliendo hasta que la columna exista.
// ------------------------------------------------------------
export async function marcarCultivoPodado(id) {
  // Devuelve true si quedó guardado en Supabase (compartido entre móviles)
  // y false si la migración v6 aún no está: GardenScreen guarda entonces
  // la marca en local (registroLocal.js) para que el aviso no persista.
  if (!(await columnaUltimaPodaDisponible())) return false;
  const { signal, cancelar } = crearAbortConTimeout();
  try {
    // Devuelve el nuevo updated_at (si existe la columna) para que la
    // pantalla actualice su copia local: si no, al editar justo después
    // saltaría un falso "modificado desde otro móvil".
    const conUpdatedAt = await columnaUpdatedAtDisponible();
    const { data, error } = await supabase
      .from('cultivos_huerto')
      .update({ ultima_poda: new Date().toISOString() })
      .eq('id', id)
      .select(conUpdatedAt ? 'id, updated_at' : 'id')
      .abortSignal(signal);
    if (error) throw error;
    return (conUpdatedAt && data?.[0]?.updated_at) || true;
  } finally {
    cancelar();
  }
}

// ------------------------------------------------------------
// marcarCultivoRegado: registra "ahora" como último riego CONFIRMADO de
// este cultivo (botón "Ya lo he regado hoy" de GardenScreen, ver
// riego.js). Mismo patrón fail-soft que marcarCultivoPodado: si la
// migración v7 todavía no se ha ejecutado, no hace nada — la
// recomendación de riego seguirá saliendo hasta que la columna exista.
// ------------------------------------------------------------
export async function marcarCultivoRegado(id) {
  if (!(await columnaUltimoRiegoDisponible())) return false;
  const { signal, cancelar } = crearAbortConTimeout();
  try {
    // Devuelve el nuevo updated_at (si existe la columna) para que la
    // pantalla actualice su copia local: si no, al editar justo después
    // saltaría un falso "modificado desde otro móvil".
    const conUpdatedAt = await columnaUpdatedAtDisponible();
    const { data, error } = await supabase
      .from('cultivos_huerto')
      .update({ ultimo_riego: new Date().toISOString() })
      .eq('id', id)
      .select(conUpdatedAt ? 'id, updated_at' : 'id')
      .abortSignal(signal);
    if (error) throw error;
    return (conUpdatedAt && data?.[0]?.updated_at) || true;
  } finally {
    cancelar();
  }
}

// ------------------------------------------------------------
// marcarCultivoComoCosechado: acción de gestión en GardenScreen.
// ------------------------------------------------------------
export async function marcarCultivoComoCosechado(id) {
  const { signal, cancelar } = crearAbortConTimeout();
  try {
    const { error } = await supabase
      .from('cultivos_huerto')
      .update({ estado: 'cosechado' })
      .eq('id', id)
      .abortSignal(signal);
    if (error) throw error;
  } finally {
    cancelar();
  }
}

// ------------------------------------------------------------
// marcarCultivoComoPerdido: la planta se ha muerto o se ha perdido
// (plaga, helada, etc.) — a diferencia de eliminarCultivoDefinitivamente,
// esto NO borra la fila: sigue contando para la memoria de rotación de
// 4 años de Planificador (listarHistorialCultivos no filtra por estado),
// porque esa tierra igualmente se usó para esa familia botánica.
// ------------------------------------------------------------
export async function marcarCultivoComoPerdido(id) {
  const { signal, cancelar } = crearAbortConTimeout();
  try {
    const { error } = await supabase
      .from('cultivos_huerto')
      .update({ estado: 'perdido' })
      .eq('id', id)
      .abortSignal(signal);
    if (error) throw error;
  } finally {
    cancelar();
  }
}

// ------------------------------------------------------------
// eliminarCultivoDefinitivamente: borra la fila de verdad — para cuando
// se añadió por error (nombre equivocado, duplicado...). A diferencia
// de "perdido", esto SÍ la saca de la memoria de rotación, porque nunca
// llegó a ocupar esa tierra de verdad.
// ------------------------------------------------------------
export async function eliminarCultivoDefinitivamente(id) {
  const { signal, cancelar } = crearAbortConTimeout();
  try {
    const { error } = await supabase
      .from('cultivos_huerto')
      .delete()
      .eq('id', id)
      .abortSignal(signal);
    if (error) throw error;
  } finally {
    cancelar();
  }
}

// ------------------------------------------------------------
// carpetaUsuario: las fotos se suben a "<user_id>/archivo.jpg" porque la
// política de Storage (migracion_v11) solo permite escribir en la carpeta
// propia. Sin sesión devuelve '' (la subida fallará y el caller ya lo
// trata como no bloqueante).
// ------------------------------------------------------------
async function carpetaUsuario() {
  try {
    const { data } = await supabase.auth.getSession();
    const id = data?.session?.user?.id;
    return id ? `${id}/` : '';
  } catch (e) {
    return '';
  }
}

// ------------------------------------------------------------
// subirFotoDiagnostico: sube la foto ya comprimida (base64 JPEG) al
// bucket de Storage y devuelve su URL pública. Nunca se llama sin
// try/catch en el caller: la foto es un extra, no debe bloquear el
// guardado del diagnóstico en texto si Storage fallara.
// ------------------------------------------------------------
export async function subirFotoDiagnostico(base64Jpeg) {
  const nombreArchivo = `${await carpetaUsuario()}diagnostico-${Date.now()}.jpg`;
  const { error: errorSubida } = await supabase.storage
    .from('diagnosticos-fotos')
    .upload(nombreArchivo, decodeBase64(base64Jpeg), { contentType: 'image/jpeg' });

  if (errorSubida) throw errorSubida;

  const { data } = supabase.storage.from('diagnosticos-fotos').getPublicUrl(nombreArchivo);
  return data?.publicUrl ?? null;
}

// ------------------------------------------------------------
// subirFotoCultivo: sube la foto opcional de un cultivo (bucket
// 'cultivos-fotos', creado por migracion_v5_imagen_cultivo.sql) y
// devuelve su URL pública. Mismo patrón que subirFotoDiagnostico: el
// caller decide qué hacer si esto fallara (nunca debe bloquear el
// guardado del cultivo en sí).
// ------------------------------------------------------------
export async function subirFotoCultivo(base64Jpeg) {
  const nombreArchivo = `${await carpetaUsuario()}cultivo-${Date.now()}.jpg`;
  const { error: errorSubida } = await supabase.storage
    .from('cultivos-fotos')
    .upload(nombreArchivo, decodeBase64(base64Jpeg), { contentType: 'image/jpeg' });

  if (errorSubida) throw errorSubida;

  const { data } = supabase.storage.from('cultivos-fotos').getPublicUrl(nombreArchivo);
  return data?.publicUrl ?? null;
}

// Extrae el nombre de archivo (la clave dentro del bucket) a partir de la
// URL pública guardada en cultivos_huerto.imagen_url. Las URLs públicas de
// Supabase Storage tienen la forma ".../object/public/<bucket>/<archivo>",
// así que basta con cortar justo después del nombre del bucket.
function nombreArchivoDesdeUrlPublica(urlPublica, bucket) {
  if (!urlPublica) return null;
  const marcador = `/${bucket}/`;
  const idx = urlPublica.indexOf(marcador);
  if (idx === -1) return null;
  const nombreArchivo = urlPublica.slice(idx + marcador.length);
  return nombreArchivo || null;
}

// ------------------------------------------------------------
// eliminarFotoCultivo: borra del bucket 'cultivos-fotos' la foto antigua
// de un cultivo (auditoría de mejoras: antes, al reemplazar o quitar la
// foto de un cultivo, o al eliminar el cultivo entero, la foto anterior
// se quedaba huérfana en Storage para siempre). Se llama SIEMPRE con la
// URL antigua, nunca la nueva — ver GardenScreen (edición y "Eliminar
// del todo"). Nunca lanza: perder la referencia de limpieza es mucho
// menos grave que romper el guardado/borrado real del cultivo.
// ------------------------------------------------------------
export async function eliminarFotoCultivo(urlAntigua) {
  const nombreArchivo = nombreArchivoDesdeUrlPublica(urlAntigua, 'cultivos-fotos');
  if (!nombreArchivo) return;
  try {
    const { error } = await supabase.storage.from('cultivos-fotos').remove([nombreArchivo]);
    if (error) throw error;
  } catch (e) {
    console.log('No se pudo eliminar la foto antigua del cultivo (no bloqueante):', e?.message);
  }
}

// ------------------------------------------------------------
// insertarDiagnostico: usado por ScanScreen tras analizar una foto.
// `resultado` trae el esquema en lenguaje llano (que_tiene,
// que_hacer_hoy, truco_experto, alerta_riego_hoy, dias_para_revisar,
// apto_para_gallinas, aviso_gallinas) + el modo usado ('plagas' |
// 'poda' | 'cosecha') + opcionalmente imagen_url.
// ------------------------------------------------------------
export async function insertarDiagnostico(resultado) {
  const { signal, cancelar } = crearAbortConTimeout();
  try {
    const plantaId = await obtenerPlantaPorDefecto();
    if (!plantaId) throw new Error('SIN_PLANTA_ID');

    const fila = {
      planta_id: plantaId,
      modo: resultado.modo ?? 'plagas',
      que_tiene: resultado.que_tiene,
      que_hacer_hoy: resultado.que_hacer_hoy,
      truco_experto: resultado.truco_experto,
      alerta_riego_hoy: resultado.alerta_riego_hoy,
      dias_para_revisar: resultado.dias_para_revisar,
      apto_para_gallinas: resultado.apto_para_gallinas ?? null,
      aviso_gallinas: resultado.aviso_gallinas ?? null,
      imagen_url: resultado.imagen_url ?? null,
    };
    if (resultado.cultivo_id && (await columnaCultivoIdDiagnosticoDisponible())) {
      fila.cultivo_id = resultado.cultivo_id;
    }

    const { error } = await supabase
      .from('diagnosticos')
      .insert(fila)
      .abortSignal(signal);
    if (error) throw error;
  } finally {
    cancelar();
  }
}

// ------------------------------------------------------------
// listarDiagnosticosPorCultivo: historial de diagnósticos de UN cultivo
// real (ver ScanScreen: selector opcional "¿de cuál de tus cultivos es
// esta foto?"), usado por GardenScreen para el historial por cultivo.
// Fail-soft: si la migración v7 todavía no se ha ejecutado, devuelve
// directamente [] en vez de lanzar (la columna cultivo_id no existe
// todavía, así que no puede haber ningún diagnóstico vinculado).
// ------------------------------------------------------------
export async function listarDiagnosticosPorCultivo(cultivoId) {
  if (!cultivoId || !(await columnaCultivoIdDiagnosticoDisponible())) return [];
  const { signal, cancelar } = crearAbortConTimeout();
  try {
    const { data, error } = await supabase
      .from('diagnosticos')
      .select('id, fecha, modo, que_tiene, truco_experto, dias_para_revisar, imagen_url')
      .eq('cultivo_id', cultivoId)
      .order('fecha', { ascending: false })
      .abortSignal(signal);

    if (error) throw error;
    return data ?? [];
  } finally {
    cancelar();
  }
}

// ------------------------------------------------------------
// listarPlantasConPoda: usado por HomeScreen para la alerta estacional
// de poda — solo trae plantas que tienen definida su ventana biológica.
// ------------------------------------------------------------
export async function listarPlantasConPoda() {
  const { signal, cancelar } = crearAbortConTimeout();
  try {
    const { data, error } = await supabase
      .from('plantas')
      .select('id, nombre, mes_poda_inicio, mes_poda_fin')
      .not('mes_poda_inicio', 'is', null)
      .not('mes_poda_fin', 'is', null)
      .abortSignal(signal);

    if (error) throw error;
    return data ?? [];
  } finally {
    cancelar();
  }
}

// ------------------------------------------------------------
// Protocolo de Saneamiento Post-Cosecha (tareas_huerto)
// ------------------------------------------------------------

// Pasos tradicionales de profilaxis de suelo tras retirar un cultivo,
// válidos con independencia de qué se haya cosechado: se generan solos
// al marcar un cultivo como cosechado, no dependen de una llamada a Gemini.
const PASOS_SANEAMIENTO = [
  'Retira del suelo cualquier raíz o resto de planta que estuviera enferma: no lo dejes descomponerse ahí.',
  'Cubre la tierra con un acolchado (paja, hojarasca o compost) para protegerla y que no se compacte.',
  'Remueve ligeramente la primera capa de tierra para exponer al sol las larvas o pupas que pasan el invierno enterradas.',
];

export async function crearTareaSaneamiento({ cultivoId, nombreCultivo }) {
  const { signal, cancelar } = crearAbortConTimeout();
  try {
    const fila = {
      tipo: 'saneamiento',
      titulo: `Sanea la tierra tras cosechar ${nombreCultivo}`,
      descripcion: 'Unos minutos ahora evitan plagas y enfermedades en el próximo cultivo de esta zona.',
      pasos: PASOS_SANEAMIENTO,
      cultivo_id: cultivoId ?? null,
    };

    const { error } = await supabase
      .from('tareas_huerto')
      .insert(fila)
      .abortSignal(signal);
    if (error) throw error;
  } finally {
    cancelar();
  }
}

export async function listarTareasPendientes() {
  const { signal, cancelar } = crearAbortConTimeout();
  try {
    const { data, error } = await supabase
      .from('tareas_huerto')
      .select('*')
      .eq('completada', false)
      .order('created_at', { ascending: false })
      .abortSignal(signal);

    if (error) throw error;
    return data ?? [];
  } finally {
    cancelar();
  }
}

export async function marcarTareaCompletada(id) {
  const { signal, cancelar } = crearAbortConTimeout();
  try {
    const { error } = await supabase
      .from('tareas_huerto')
      .update({ completada: true })
      .eq('id', id)
      .abortSignal(signal);
    if (error) throw error;
  } finally {
    cancelar();
  }
}

// ------------------------------------------------------------
// Historial de chat del Asistente (mensajes_asistente, ver
// migracion_v7.sql) — auditoría de mejoras: antes vivía solo en el
// estado del componente de AsistenteScreen y se perdía al cerrar la
// pantalla, sin compartirse entre los dos móviles. Mismo patrón
// fail-soft que el resto de tablas/columnas opcionales de este
// archivo: si la migración v7 todavía no se ha ejecutado, el chat
// simplemente sigue funcionando en memoria como hasta ahora, sin
// persistir nada — nunca bloquea la conversación por esto.
// ------------------------------------------------------------
let cacheTablaMensajesAsistente = null;

async function tablaMensajesAsistenteDisponible() {
  if (cacheTablaMensajesAsistente !== null) return cacheTablaMensajesAsistente;
  try {
    const { error } = await supabase.from('mensajes_asistente').select('id').limit(1);
    if (error && !esColumnaInexistente(error)) return false; // error transitorio (red, sesión): no se cachea
    cacheTablaMensajesAsistente = !error;
  } catch (e) {
    return false; // sin red: no se cachea, se reintentará
  }
  return cacheTablaMensajesAsistente;
}

// Cuántos mensajes recientes se traen al abrir el Asistente. Se pide un
// poco más que MAX_TURNOS_HISTORIAL_CHAT (gemini.js) porque aquí cuentan
// TODOS los mensajes (usuario + modelo), no turnos — de sobra para no
// perder contexto reciente sin traer una conversación entera de meses.
const LIMITE_HISTORIAL_ASISTENTE = 40;

export async function listarMensajesAsistente() {
  if (!(await tablaMensajesAsistenteDisponible())) return [];
  const { signal, cancelar } = crearAbortConTimeout();
  try {
    const { data, error } = await supabase
      .from('mensajes_asistente')
      .select('id, rol, texto, created_at')
      .order('created_at', { ascending: false })
      .limit(LIMITE_HISTORIAL_ASISTENTE)
      .abortSignal(signal);

    if (error) throw error;
    // Se pide más reciente primero (para el LIMIT) y se da la vuelta
    // aquí: la pantalla necesita orden cronológico para pintar el chat.
    return (data ?? []).slice().reverse();
  } finally {
    cancelar();
  }
}

export async function insertarMensajeAsistente({ rol, texto }) {
  if (!(await tablaMensajesAsistenteDisponible())) return;
  try {
    const { error } = await supabase.from('mensajes_asistente').insert({ rol, texto });
    if (error) throw error;
  } catch (e) {
    console.log('No se pudo guardar el mensaje del Asistente (no bloqueante):', e?.message);
  }
}

// ------------------------------------------------------------
// v16 — Cosechas de plantas perennes (frutales, aromáticas…): se
// registran sin sacar la planta del huerto. Tabla `cosechas`
// (migracion_v10.sql). Si no existe, cosechas.js guarda en el móvil.
// ------------------------------------------------------------
let cacheTablaCosechas = null;
export async function tablaCosechasDisponible() {
  if (cacheTablaCosechas !== null) return cacheTablaCosechas;
  try {
    const { error } = await supabase.from('cosechas').select('id').limit(1);
    if (error && !esColumnaInexistente(error)) return false; // error transitorio (red, sesión): no se cachea
    cacheTablaCosechas = !error;
  } catch (e) {
    return false; // sin red: no se cachea, se reintentará
  }
  return cacheTablaCosechas;
}

export async function insertarCosechaRemota({ cultivoId, kg, nota, fecha }) {
  const { signal, cancelar } = crearAbortConTimeout();
  try {
    const { error } = await supabase
      .from('cosechas')
      .insert({ cultivo_id: cultivoId, kg, nota: nota || null, fecha: fecha || new Date().toISOString() })
      .abortSignal(signal);
    if (error) throw error;
  } finally {
    cancelar();
  }
}

export async function listarCosechasRemotas() {
  const { signal, cancelar } = crearAbortConTimeout();
  try {
    const { data, error } = await supabase
      .from('cosechas')
      .select('id, cultivo_id, kg, nota, fecha')
      .order('fecha', { ascending: false })
      .limit(500)
      .abortSignal(signal);
    if (error) throw error;
    return data ?? [];
  } finally {
    cancelar();
  }
}

export async function eliminarCosechaRemota(id) {
  const { error } = await supabase.from('cosechas').delete().eq('id', id);
  if (error) throw error;
}

// "Nuevo chat" del Asistente: borra el historial compartido.
export async function borrarMensajesAsistente() {
  if (!(await tablaMensajesAsistenteDisponible())) return;
  try {
    await supabase.from('mensajes_asistente').delete().not('id', 'is', null);
  } catch (e) {
    console.log('No se pudo borrar el historial del Asistente (no bloqueante):', e?.message);
  }
}

// ------------------------------------------------------------
// v12: uso del plan gratuito (base de datos y fotos). Requiere
// migracion_v12_uso.sql; sin ella devuelve null (sin aviso). Nunca lanza.
// ------------------------------------------------------------
export async function obtenerUsoSupabase() {
  const { signal, cancelar } = crearAbortConTimeout();
  try {
    const { data, error } = await supabase.rpc('uso_huerto').abortSignal(signal);
    if (error || !data) return null;
    return typeof data === 'string' ? JSON.parse(data) : data;
  } catch (e) {
    return null;
  } finally {
    cancelar();
  }
}
