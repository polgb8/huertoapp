// ============================================================
// registroLocal.js — Respaldo local (AsyncStorage) de "Ya lo he podado"
// y "Ya regado", por cultivo.
//
// Motivo (bug real reportado por Pol): marcarCultivoPodado /
// marcarCultivoRegado (supabase.js) no hacen NADA si la migración v6/v7
// no se ha ejecutado todavía en Supabase (la columna no existe), así que
// al pulsar "Ya lo he podado" el aviso seguía saliendo. Con este respaldo
// la marca SIEMPRE queda guardada al menos en este móvil, y se fusiona
// con el dato de Supabase (gana la fecha más reciente de las dos).
//
// NUNCA lanza: cualquier fallo de AsyncStorage se resuelve en {} / false.
// ============================================================

import AsyncStorage from '@react-native-async-storage/async-storage';

const CLAVE = 'huertoapp:registro-local-cultivos-v1';

async function leerTodo() {
  try {
    const crudo = await AsyncStorage.getItem(CLAVE);
    const datos = crudo ? JSON.parse(crudo) : null;
    return datos && typeof datos === 'object' ? datos : {};
  } catch (e) {
    console.log('No se pudo leer el registro local (no bloqueante):', e?.message);
    return {};
  }
}

// campo: 'ultima_poda' | 'ultimo_riego' | 'origen' | 'tamano' | 'diametro_copa' | 'edad_estimada'
// (el valor puede ser cualquier dato serializable, no solo fechas)
export async function guardarMarcaLocal(cultivoId, campo, fechaISO = new Date().toISOString()) {
  if (cultivoId == null || !campo) return false;
  try {
    const datos = await leerTodo();
    const clave = String(cultivoId);
    datos[clave] = { ...(datos[clave] || {}), [campo]: fechaISO };
    await AsyncStorage.setItem(CLAVE, JSON.stringify(datos));
    return true;
  } catch (e) {
    console.log('No se pudo guardar el registro local (no bloqueante):', e?.message);
    return false;
  }
}

function masReciente(a, b) {
  const ta = a ? new Date(a).getTime() : NaN;
  const tb = b ? new Date(b).getTime() : NaN;
  if (Number.isNaN(ta)) return Number.isNaN(tb) ? a || b || null : b;
  if (Number.isNaN(tb)) return a;
  return tb > ta ? b : a;
}

// Fusiona las marcas locales con las filas de Supabase (pura, testeable).
export function fusionarMarcas(cultivos, marcas) {
  if (!Array.isArray(cultivos)) return [];
  if (!marcas || typeof marcas !== 'object') return cultivos;
  return cultivos.map((c) => {
    const local = marcas[String(c?.id)];
    if (!local) return c;
    return {
      ...c,
      ultima_poda: masReciente(c.ultima_poda, local.ultima_poda),
      ultimo_riego: masReciente(c.ultimo_riego, local.ultimo_riego),
      origen: c.origen || local.origen,
      tamano: c.tamano || local.tamano,
      diametro_copa: c.diametro_copa ?? local.diametro_copa,
      edad_estimada: c.edad_estimada ?? local.edad_estimada,
      tipo_suelo: c.tipo_suelo || local.tipo_suelo,
    };
  });
}

export async function aplicarMarcasLocales(cultivos) {
  return fusionarMarcas(cultivos, await leerTodo());
}
