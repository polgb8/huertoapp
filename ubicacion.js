// ============================================================
// ubicacion.js — Coordenadas GPS del huerto, cacheadas en disco.
//
// El huerto de Pol no se mueve: pedir permiso de ubicación y una
// posición GPS nueva EN CADA apertura de la app es lento (varios
// segundos de espera al satélite) y molesto (el diálogo del SO puede
// reaparecer). En vez de eso: se pide una vez, se cachea en
// AsyncStorage (ya instalado, sin dependencias nuevas) y se reutiliza
// indefinidamente. Quien quiera un valor fresco (se ha mudado el
// huerto, etc.) usa el enlace "📍 Actualizar ubicación" que llama a
// refrescarUbicacion(), la única vía que vuelve a tocar el GPS.
//
// Igual que el resto de la app: NUNCA lanza. Un fallo aquí (permiso
// denegado, AsyncStorage no disponible, GPS sin cobertura) se resuelve
// en null/false, nunca en una excepción sin capturar.
// ============================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

const CLAVE_COORDS = 'huertoapp:coords-cacheadas';
const CLAVE_PERMISO_DENEGADO = 'huertoapp:ubicacion-permiso-denegado';

// ------------------------------------------------------------
// leerCoordsCacheadas: se llama al arrancar la app (App.js) para
// hidratar el store con la última posición conocida, sin pedir permiso
// ni tocar el GPS. Devuelve null si nunca se guardó nada o si falla la
// lectura (fail-soft).
// ------------------------------------------------------------
export async function leerCoordsCacheadas() {
  try {
    const json = await AsyncStorage.getItem(CLAVE_COORDS);
    if (!json) return null;
    const valor = JSON.parse(json);
    if (valor && Number.isFinite(valor.lat) && Number.isFinite(valor.lon)) return valor;
    return null;
  } catch (e) {
    console.log('No se pudo leer la ubicación cacheada (no bloqueante):', e?.message);
    return null;
  }
}

// ------------------------------------------------------------
// seDenegoAntes: si el usuario ya dijo que no al permiso, no se le
// vuelve a preguntar automáticamente en cada pantalla/apertura — solo
// si pulsa explícitamente "Actualizar ubicación" (ver refrescarUbicacion,
// que ignora esta bandera porque es una acción explícita del usuario).
// ------------------------------------------------------------
export async function seDenegoAntes() {
  try {
    return (await AsyncStorage.getItem(CLAVE_PERMISO_DENEGADO)) === '1';
  } catch (e) {
    return false;
  }
}

async function guardarCoords(coords) {
  try {
    await AsyncStorage.setItem(CLAVE_COORDS, JSON.stringify(coords));
    await AsyncStorage.removeItem(CLAVE_PERMISO_DENEGADO);
  } catch (e) {
    console.log('No se pudo cachear la ubicación (no bloqueante):', e?.message);
  }
}

async function marcarPermisoDenegado() {
  try {
    await AsyncStorage.setItem(CLAVE_PERMISO_DENEGADO, '1');
  } catch (e) {
    // Sin cachear la negativa, el único efecto es que se preguntará otra
    // vez la próxima vez — no es grave, se sigue sin bloquear nada.
  }
}

// ------------------------------------------------------------
// refrescarUbicacion: la ÚNICA función que pide permiso + una posición
// GPS real. La usan:
//   - PlannerScreen/GardenScreen la primera vez que hace falta la
//     ubicación y no hay nada cacheado todavía ni una negativa previa.
//   - El enlace manual "📍 Actualizar ubicación" (ignora cualquier
//     negativa previa, porque aquí el usuario SÍ la está pidiendo).
//
// Devuelve { coords, denegado }: coords es null si no se pudo obtener
// por cualquier motivo (denegado o error real); denegado distingue el
// caso "el usuario dijo que no" del resto, para poder cachear esa
// respuesta y no insistir en cada apertura.
// ------------------------------------------------------------
// Posición con Accuracy.Balanced (red/wifi, rápida) y límite de tiempo;
// si no llega, la última conocida. Bug de Pol (v14): con el permiso ya
// concedido, getCurrentPositionAsync podía tardar/fallar (interior, GPS
// frío) y NO se guardaba nada, así que la app volvía a pedir la
// ubicación en cada apertura.
async function obtenerPosicion() {
  const conTiempo = (promesa, ms) =>
    Promise.race([promesa, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
  let posicion = null;
  try {
    posicion = await conTiempo(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy?.Balanced ?? 3 }),
      15000
    );
  } catch (e) {
    posicion = null;
  }
  if (!posicion) {
    try {
      posicion = await Location.getLastKnownPositionAsync?.({});
    } catch (e) {
      posicion = null;
    }
  }
  const lat = posicion?.coords?.latitude;
  const lon = posicion?.coords?.longitude;
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

// ------------------------------------------------------------
// obtenerUbicacionAutomatica: al arrancar la app. Si ya hay coordenadas
// guardadas, las devuelve sin tocar el GPS. Si no, y el permiso YA está
// concedido (p.ej. "Mientras se usa la app"), obtiene la posición en
// silencio y la guarda — sin volver a mostrar ningún diálogo.
// ------------------------------------------------------------
export async function obtenerUbicacionAutomatica() {
  const cacheadas = await leerCoordsCacheadas();
  if (cacheadas) return cacheadas;
  try {
    const permiso = await Location.getForegroundPermissionsAsync();
    if (permiso?.status !== 'granted') return null;
    const coords = await obtenerPosicion();
    if (coords) await guardarCoords(coords);
    return coords;
  } catch (e) {
    console.log('No se pudo obtener la ubicación automática (no bloqueante):', e?.message);
    return null;
  }
}

export async function refrescarUbicacion() {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      await marcarPermisoDenegado();
      return { coords: null, denegado: true };
    }
    const coords = await obtenerPosicion();
    if (!coords) return { coords: null, denegado: false };
    await guardarCoords(coords);
    return { coords, denegado: false };
  } catch (e) {
    console.log('No se pudo obtener la ubicación (no bloqueante):', e?.message);
    return { coords: null, denegado: false };
  }
}
