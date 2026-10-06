// ============================================================
// ajustes.js — Ajustes del huerto guardados en este móvil (AsyncStorage).
// Por ahora: zona climática, que desplaza las épocas de poda sensibles a
// heladas y ajusta el riego orientativo. Nunca lanza.
// ============================================================

import AsyncStorage from '@react-native-async-storage/async-storage';

const CLAVE_ZONA = 'huertoapp:zona-climatica';

export const ZONAS_CLIMATICAS = [
  { clave: 'calida', etiqueta: '☀️ Cálida', descripcion: 'Costa sur, Canarias, Baleares: casi sin heladas.' },
  { clave: 'mediterranea', etiqueta: '🌊 Mediterránea', descripcion: 'Costa e interior templado: heladas raras.' },
  { clave: 'interior', etiqueta: '🏜️ Interior', descripcion: 'Meseta, valles de interior: heladas en invierno.' },
  { clave: 'montana', etiqueta: '⛰️ Montaña / fría', descripcion: 'Más de ~800 m o norte frío: heladas tardías.' },
];

export const ZONA_POR_DEFECTO = 'mediterranea';

export async function leerZonaClimatica() {
  try {
    const valor = await AsyncStorage.getItem(CLAVE_ZONA);
    return ZONAS_CLIMATICAS.some((z) => z.clave === valor) ? valor : null;
  } catch (e) {
    return null;
  }
}

export async function guardarZonaClimatica(zona) {
  try {
    await AsyncStorage.setItem(CLAVE_ZONA, zona);
    return true;
  } catch (e) {
    console.log('No se pudo guardar la zona climática (no bloqueante):', e?.message);
    return false;
  }
}

// Sugerencia automática a partir de la latitud y la altitud (Open-Meteo
// devuelve la elevación). Solo orienta: el usuario puede cambiarla.
export function sugerirZona({ lat, elevacion }) {
  if (Number.isFinite(lat) && lat < 30) return 'calida'; // Canarias
  if (Number.isFinite(elevacion)) {
    if (elevacion >= 800) return 'montana';
    if (elevacion >= 400) return 'interior';
  }
  return 'mediterranea';
}

// ------------------------------------------------------------
// Preferencias de notificaciones (v15): recordatorios de riego y de
// poda, y la hora del aviso de riego.
// ------------------------------------------------------------
const CLAVE_AVISOS = 'huertoapp:preferencias-avisos-v1';
export const PREFS_AVISOS_DEFECTO = { riego: true, poda: true, hora: 9, minuto: 0 };

export async function leerPreferenciasAvisos() {
  try {
    const crudo = await AsyncStorage.getItem(CLAVE_AVISOS);
    const datos = crudo ? JSON.parse(crudo) : null;
    return { ...PREFS_AVISOS_DEFECTO, ...(datos && typeof datos === 'object' ? datos : {}) };
  } catch (e) {
    return { ...PREFS_AVISOS_DEFECTO };
  }
}

export async function guardarPreferenciasAvisos(prefs) {
  try {
    await AsyncStorage.setItem(CLAVE_AVISOS, JSON.stringify(prefs));
    return true;
  } catch (e) {
    return false;
  }
}

// ------------------------------------------------------------
// v16 — Tipo de suelo del huerto (por defecto para todas las plantas;
// cada planta puede tener el suyo, estimado por la IA con la foto).
// ------------------------------------------------------------
const CLAVE_SUELO = 'huertoapp:tipo-suelo-huerto';
export const TIPOS_SUELO = [
  { clave: 'arenoso', etiqueta: '🏖️ Arenoso', descripcion: 'Suelto, se seca rápido, no forma bola al apretarlo húmedo.' },
  { clave: 'franco', etiqueta: '🌱 Franco', descripcion: 'Intermedio: forma una bola que se desmorona al tocarla.' },
  { clave: 'arcilloso', etiqueta: '🧱 Arcilloso', descripcion: 'Pegajoso, forma un churro fino; se agrieta al secarse.' },
];
export const PRUEBA_SUELO =
  'Prueba del puño: coge un puñado de tierra húmeda y apriétala. Si se deshace = arenoso; si forma bola que se ' +
  'desmorona = franco; si puedes hacer un churro fino sin que se rompa = arcilloso.';

export async function leerSueloHuerto() {
  try {
    const v = await AsyncStorage.getItem(CLAVE_SUELO);
    return TIPOS_SUELO.some((t) => t.clave === v) ? v : null;
  } catch (e) {
    return null;
  }
}

export async function guardarSueloHuerto(suelo) {
  try {
    if (suelo) await AsyncStorage.setItem(CLAVE_SUELO, suelo);
    else await AsyncStorage.removeItem(CLAVE_SUELO);
    return true;
  } catch (e) {
    return false;
  }
}
