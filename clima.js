// ============================================================
// clima.js — Datos climáticos vía Open-Meteo (gratuita, sin
// registro ni API key). Dos funciones:
//   - obtenerClimaActual: resumen simple (temp/viento/lluvia) para
//     enriquecer el prompt de Gemini en cada diagnóstico.
//   - calcularBalanceHidrico: balance hídrico real de los últimos 2
//     días (lluvia vs. evapotranspiración) para la alerta de riego
//     del Inicio — un cálculo determinista, no una estimación de la IA.
// ============================================================

import { crearAbortConTimeout } from './utils';

const CACHE_MS = 30 * 60 * 1000; // 30 min: el clima no cambia tan rápido
let cacheUltimaLlamada = { clave: null, timestamp: 0, valor: null };

function resumenTexto({ tempActual, vientoKmh, probabilidadLluvia }) {
  const partes = [`${Math.round(tempActual)}°C`];
  if (vientoKmh >= 25) partes.push(`viento fuerte (${Math.round(vientoKmh)} km/h)`);
  if (probabilidadLluvia >= 50) partes.push(`probabilidad de lluvia ${probabilidadLluvia}%`);
  return partes.join(', ');
}

// ------------------------------------------------------------
// obtenerClimaActual: coordenadas -> resumen simple. Devuelve null
// (nunca lanza) si Open-Meteo no responde: el clima es un "extra" que
// enriquece el prompt de Gemini, no debe bloquear el diagnóstico si falla.
// ------------------------------------------------------------
export async function obtenerClimaActual(lat, lon) {
  const clave = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (cacheUltimaLlamada.clave === clave && Date.now() - cacheUltimaLlamada.timestamp < CACHE_MS) {
    return cacheUltimaLlamada.valor;
  }

  const { signal, cancelar } = crearAbortConTimeout(10000);
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      '&current=temperature_2m,wind_speed_10m,precipitation_probability';

    const respuesta = await fetch(url, { signal });
    if (!respuesta.ok) return null;

    const datos = await respuesta.json();
    const actual = datos?.current;
    if (!actual) return null;

    const valor = {
      tempActual: actual.temperature_2m,
      vientoKmh: actual.wind_speed_10m,
      probabilidadLluvia: actual.precipitation_probability ?? 0,
    };
    valor.resumenTexto = resumenTexto(valor);

    cacheUltimaLlamada = { clave, timestamp: Date.now(), valor };
    return valor;
  } catch (e) {
    console.log('No se pudo obtener el clima (no bloqueante):', e?.message);
    return null;
  } finally {
    cancelar();
  }
}

// ------------------------------------------------------------
// Balance Hídrico Digital
// ------------------------------------------------------------
const CACHE_BALANCE_MS = 60 * 60 * 1000; // 1h: el balance diario no cambia tan rápido como para pedirlo en cada pantalla
let cacheBalance = { clave: null, timestamp: 0, valor: null };

const UMBRAL_LLUVIA_SUFICIENTE_MM = 8;

// Failsafe: si Open-Meteo no responde o no trae los campos esperados, no
// afirmamos ni "ha llovido suficiente" ni un número de litros inventado —
// litrosPorM2/lluviaAcumuladaMm quedan en null (distinto de 0) para que la
// pantalla pueda mostrar "sin datos" en vez de una cifra falsa.
function valorPorDefectoBalance() {
  return {
    lluviaSuficiente: false,
    lluviaAcumuladaMm: null,
    etoHoyMm: null,
    litrosPorM2: null,
    mensaje: 'Sin datos de lluvia disponibles ahora mismo. Usa tu criterio para el riego de hoy.',
  };
}

// calcularBalanceHidrico: compara la lluvia acumulada de las últimas 48h
// reales (los dos últimos días ya cerrados, no el parcial de hoy) contra
// la demanda de evapotranspiración de hoy (ETo), para decidir si hace
// falta regar y cuántos litros por m² — en vez de dejar esa estimación
// al criterio libre de la IA.
export async function calcularBalanceHidrico(lat, lon) {
  const clave = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (cacheBalance.clave === clave && Date.now() - cacheBalance.timestamp < CACHE_BALANCE_MS) {
    return cacheBalance.valor;
  }

  const { signal, cancelar } = crearAbortConTimeout(10000);
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      '&daily=precipitation_sum,et0_fao_evapotranspiration,temperature_2m_max,precipitation_probability_max' +
      '&past_days=2&forecast_days=2&timezone=auto';

    const respuesta = await fetch(url, { signal });
    if (!respuesta.ok) return valorPorDefectoBalance();

    const datos = await respuesta.json();
    const diario = datos?.daily;
    if (!Array.isArray(diario?.precipitation_sum) || !Array.isArray(diario?.et0_fao_evapotranspiration)) {
      return valorPorDefectoBalance();
    }

    // Con past_days=2 & forecast_days=1, el array trae 3 entradas:
    // [anteayer, ayer, hoy]. "Últimas 48h" = los dos días ya cerrados
    // (anteayer + ayer); el de "hoy" es parcial/previsión y no se suma
    // para no mezclar lluvia real con una previsión que aún puede fallar.
    // v16: 2 días pasados + hoy + mañana (previsión de lluvia).
    const n = diario.precipitation_sum.length;
    if (n < 4) return valorPorDefectoBalance();
    const iHoy = n - 2;

    const lluviaAnteayer = diario.precipitation_sum[iHoy - 2] ?? 0;
    const lluviaAyer = diario.precipitation_sum[iHoy - 1] ?? 0;
    const lluviaAcumuladaMm = Number((lluviaAnteayer + lluviaAyer).toFixed(1));

    const etoHoyCrudo = diario.et0_fao_evapotranspiration[iHoy];
    const etoHoyMm = Number.isFinite(etoHoyCrudo) ? Number(etoHoyCrudo.toFixed(1)) : 0;
    const tempMaxHoy = diario.temperature_2m_max?.[iHoy];
    // Lluvia prevista de hoy + mañana (mm) y su probabilidad máxima.
    const lluviaHoyPrev = diario.precipitation_sum[iHoy] ?? 0;
    const lluviaManana = diario.precipitation_sum[iHoy + 1] ?? 0;
    const probManana = diario.precipitation_probability_max?.[iHoy + 1];
    const lluviaPrevistaMm = Number(((lluviaHoyPrev || 0) + (lluviaManana || 0)).toFixed(1));
    const probabilidadLluviaPrevista = Number.isFinite(probManana) ? probManana : null;

    const lluviaSuficiente = lluviaAcumuladaMm >= UMBRAL_LLUVIA_SUFICIENTE_MM;

    let litrosPorM2 = 0;
    if (!lluviaSuficiente) {
      const deficitMm = Math.max(0, etoHoyMm - lluviaAcumuladaMm);
      // 1 mm de lámina de agua sobre 1 m² equivale a 1 litro: la
      // conversión mm -> litros/m² es directa (1:1).
      let factorCalor = 1;
      if (Number.isFinite(tempMaxHoy)) {
        if (tempMaxHoy >= 35) factorCalor = 1.3;
        else if (tempMaxHoy >= 30) factorCalor = 1.15;
      }
      litrosPorM2 = Number((deficitMm * factorCalor).toFixed(1));
    }

    const valor = {
      lluviaSuficiente,
      lluviaAcumuladaMm,
      etoHoyMm,
      litrosPorM2,
      lluviaPrevistaMm,
      probabilidadLluviaPrevista,
      tempMaxHoy: Number.isFinite(tempMaxHoy) ? tempMaxHoy : null,
      mensaje: lluviaSuficiente
        ? 'La lluvia ha regado por ti. Suelo con humedad suficiente.'
        : `Riega hoy: unos ${litrosPorM2} litros por m².`,
    };

    cacheBalance = { clave, timestamp: Date.now(), valor };
    return valor;
  } catch (e) {
    console.log('No se pudo calcular el balance hídrico (no bloqueante):', e?.message);
    return valorPorDefectoBalance();
  } finally {
    cancelar();
  }
}

// Altitud (m) del huerto, para sugerir la zona climática (ajustes.js).
// null si falla. Nunca lanza.
export async function obtenerElevacion(lat, lon) {
  const { signal, cancelar } = crearAbortConTimeout(10000);
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`, { signal });
    if (!r.ok) return null;
    const datos = await r.json();
    const e = datos?.elevation?.[0];
    return Number.isFinite(e) ? e : null;
  } catch (e) {
    return null;
  } finally {
    cancelar();
  }
}
