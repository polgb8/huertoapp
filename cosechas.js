// ============================================================
// cosechas.js — Registro de cosechas (kg) de plantas perennes, sin
// sacarlas del huerto. Supabase si existe la tabla (migracion_v10.sql);
// si no, en el móvil (AsyncStorage). Nunca lanza al leer.
// ============================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { tablaCosechasDisponible, insertarCosechaRemota, listarCosechasRemotas, eliminarCosechaRemota } from './supabase';

const CLAVE = 'huertoapp:cosechas-locales-v1';

async function leerLocales() {
  try {
    const crudo = await AsyncStorage.getItem(CLAVE);
    const lista = crudo ? JSON.parse(crudo) : [];
    return Array.isArray(lista) ? lista : [];
  } catch (e) {
    return [];
  }
}

async function guardarLocales(lista) {
  try {
    await AsyncStorage.setItem(CLAVE, JSON.stringify(lista));
  } catch (e) {
    // sin disco: no se puede hacer nada más
  }
}

// kg acepta "1,5" o 1.5. Lanza si no es un número válido (>0).
export function normalizarKg(valor) {
  const kg = parseFloat(String(valor).replace(',', '.'));
  if (!Number.isFinite(kg) || kg <= 0 || kg > 5000) throw new Error('KG_INVALIDO');
  return Math.round(kg * 100) / 100;
}

export async function registrarCosecha({ cultivoId, kg, nota }) {
  const kgOk = normalizarKg(kg);
  const fecha = new Date().toISOString();
  if (await tablaCosechasDisponible()) {
    try {
      await insertarCosechaRemota({ cultivoId, kg: kgOk, nota, fecha });
      return { remota: true };
    } catch (e) {
      console.log('Cosecha guardada solo en el móvil (no bloqueante):', e?.message);
    }
  }
  const lista = await leerLocales();
  lista.unshift({ id: `local-${Date.now()}`, cultivo_id: cultivoId, kg: kgOk, nota: nota || null, fecha, local: true });
  await guardarLocales(lista);
  return { remota: false };
}

export async function listarCosechas() {
  let remotas = [];
  try {
    if (await tablaCosechasDisponible()) remotas = await listarCosechasRemotas();
  } catch (e) {
    remotas = [];
  }
  const locales = await leerLocales();
  return [...remotas, ...locales].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}

export async function eliminarCosecha(cosecha) {
  if (cosecha?.local) {
    const lista = await leerLocales();
    await guardarLocales(lista.filter((c) => c.id !== cosecha.id));
    return;
  }
  await eliminarCosechaRemota(cosecha.id);
}

// Resumen del AÑO en curso por cultivo: { [cultivoId]: { kg, veces } }.
export function resumenCosechasAnio(cosechas, ahora = new Date()) {
  const anio = ahora.getFullYear();
  const res = {};
  (Array.isArray(cosechas) ? cosechas : []).forEach((c) => {
    const f = new Date(c.fecha);
    if (Number.isNaN(f.getTime()) || f.getFullYear() !== anio) return;
    const r = res[c.cultivo_id] || { kg: 0, veces: 0 };
    r.kg = Math.round((r.kg + Number(c.kg || 0)) * 100) / 100;
    r.veces += 1;
    res[c.cultivo_id] = r;
  });
  return res;
}
