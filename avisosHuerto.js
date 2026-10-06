// ============================================================
// avisosHuerto.js — Programa los recordatorios (notificaciones locales)
// de riego y poda a la HORA que elige el usuario en Ajustes.
// Lo usan "Hoy" (pestaña inicial, siempre montada) y "Mi huerto", así
// los avisos se recalculan aunque no se abra Mi huerto. Las funciones
// de notificaciones.js solo reprograman si algo cambió (firma), así que
// llamarlo varias veces no duplica avisos. Nunca lanza.
// ============================================================

import { calcularAvisosRiego } from './riego';
import { buscarInfoPoda, inicioProximaTemporada } from './poda';
import { reprogramarAvisosPoda, reprogramarAvisosRiego } from './notificaciones';

export function normalizarHora(prefs) {
  const h = Number(prefs?.hora);
  const m = Number(prefs?.minuto);
  return {
    hora: Number.isInteger(h) && h >= 0 && h <= 23 ? h : 9,
    minuto: Number.isInteger(m) && m >= 0 && m <= 59 ? m : 0,
  };
}

export function textoHora(prefs) {
  const { hora, minuto } = normalizarHora(prefs);
  return `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`;
}

// Avisos de poda: el primer día de la próxima época de cada planta, a la
// hora elegida, agrupados por fecha.
export function calcularAvisosPoda(activos, zona, prefs, ahora = new Date()) {
  const { hora, minuto } = normalizarHora(prefs);
  const porFecha = new Map();
  (Array.isArray(activos) ? activos : []).forEach((c) => {
    const info = buscarInfoPoda(c.nombre, zona);
    const inicio = info && inicioProximaTemporada(info.meses, ahora);
    if (!inicio) return;
    const fecha = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate(), hora, minuto, 0);
    const clave = fecha.toISOString();
    if (!porFecha.has(clave)) porFecha.set(clave, { fecha, nombres: [] });
    const nombre = c.variedad ? `${c.nombre} (${c.variedad})` : c.nombre;
    if (!porFecha.get(clave).nombres.includes(nombre)) porFecha.get(clave).nombres.push(nombre);
  });
  return [...porFecha.values()];
}

export function programarAvisosHuerto({ activos, recomendaciones, zona, prefs, ahora = new Date() }) {
  try {
    const { hora, minuto } = normalizarHora(prefs);
    if (prefs?.poda === false) reprogramarAvisosPoda([]);
    else reprogramarAvisosPoda(calcularAvisosPoda(activos, zona, prefs, ahora));

    if (prefs?.riego === false) reprogramarAvisosRiego([]);
    else if (recomendaciones) reprogramarAvisosRiego(calcularAvisosRiego(recomendaciones, activos, ahora, hora, minuto));
  } catch (e) {
    console.log('No se pudieron programar los avisos (no bloqueante):', e?.message);
  }
}
