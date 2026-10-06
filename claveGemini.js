// ============================================================
// claveGemini.js — Clave de la API de Gemini de CADA usuario.
//
// v11 (multiusuario): la clave ya no viaja dentro del APK público. Cada
// persona consigue la suya gratis (https://aistudio.google.com/apikey) y la
// pega en Ajustes; se guarda solo en SU móvil (AsyncStorage). Como
// respaldo, si el build trae EXPO_PUBLIC_GEMINI_API_KEY (builds propios del
// desarrollador) se usa esa. Nunca lanza.
// ============================================================

import AsyncStorage from '@react-native-async-storage/async-storage';

const CLAVE = 'huertoapp:gemini-api-key';

export async function leerClaveGeminiGuardada() {
  try {
    return ((await AsyncStorage.getItem(CLAVE)) || '').trim();
  } catch (e) {
    return '';
  }
}

export function claveGeminiPareceValida(texto) {
  const t = (texto || '').trim();
  return t.length >= 20 && !/\s/.test(t);
}

// Comprueba la clave contra Google antes de guardarla (petición ligera que
// no consume cupo de generación). Devuelve 'ok' | 'invalida' | 'sin_red'.
// Nunca lanza.
export async function verificarClaveGemini(texto) {
  const t = (texto || '').trim();
  if (!claveGeminiPareceValida(t)) return 'invalida';
  const control = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const temporizador = setTimeout(() => control?.abort(), 10000);
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
      headers: { 'x-goog-api-key': t },
      signal: control?.signal,
    });
    if (r.ok || r.status === 429) return 'ok'; // 429 = clave válida con el cupo agotado
    if (r.status === 400 || r.status === 401 || r.status === 403) return 'invalida';
    return 'sin_red';
  } catch (e) {
    return 'sin_red';
  } finally {
    clearTimeout(temporizador);
  }
}

export async function guardarClaveGemini(texto) {
  const t = (texto || '').trim();
  if (!claveGeminiPareceValida(t)) return false;
  try {
    await AsyncStorage.setItem(CLAVE, t);
    return true;
  } catch (e) {
    return false;
  }
}

export async function borrarClaveGemini() {
  try {
    await AsyncStorage.removeItem(CLAVE);
  } catch (e) {
    // sin consecuencias
  }
}

// Clave a usar en cada llamada: la del usuario, o la del build como respaldo.
export async function obtenerClaveGemini() {
  const guardada = await leerClaveGeminiGuardada();
  if (guardada) return guardada;
  return (process.env.EXPO_PUBLIC_GEMINI_API_KEY || '').trim();
}
