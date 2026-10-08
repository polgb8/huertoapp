// ============================================================
// store.js — Estado global con Zustand.
//
// Qué vive aquí (y por qué): solo lo que varias pantallas necesitan
// compartir sin re-pedirlo cada vez — coordenadas GPS, el clima del
// momento y si hay red. Los datos de Supabase (cultivos, diagnósticos)
// se siguen pidiendo por pantalla con supabase.js: cachearlos aquí
// arriesgaría mostrar datos obsoletos tras un guardado en otra pestaña.
//
// La sesión de login la gestiona Supabase Auth (ver App.js), no este store.
// ============================================================

import { create } from 'zustand';

export const useAppStore = create((set) => ({
  // GPS: se piden una sola vez (Planner o Scan, quien lo necesite primero)
  // y se comparten, en vez de volver a pedir permiso/posición en cada uno.
  coords: null, // { lat, lon } | null
  setCoords: (coords) => set({ coords }),

  // Clima actual (Open-Meteo), cacheado ~30 min por clima.js.
  clima: null, // { tempActual, vientoKmh, probabilidadLluvia, resumenTexto } | null
  setClima: (clima) => set({ clima }),

  // Conectividad (NetInfo), actualizado desde App.js al arrancar.
  conectado: true,
  setConectado: (conectado) => set({ conectado }),

  // Zona climática del huerto (ver ajustes.js): desplaza épocas de poda
  // y ajusta el riego orientativo. Se hidrata al arrancar (App.js).
  zonaClimatica: 'mediterranea',
  setZonaClimatica: (zonaClimatica) => set({ zonaClimatica }),

  // Tipo de suelo general del huerto (ajustes.js), null = sin indicar.
  sueloHuerto: null,
  setSueloHuerto: (sueloHuerto) => set({ sueloHuerto }),

  // Recordatorios (ajustes.js): riego/poda activados y hora del aviso.
  // En el store para que Ajustes, Hoy y Mi huerto los compartan al momento.
  prefsAvisos: { riego: true, poda: true, hora: 9, minuto: 0 },
  setPrefsAvisos: (prefsAvisos) => set({ prefsAvisos }),

  // Último diagnóstico guardado (para poder mostrarlo/recordar sin
  // volver a consultar Supabase inmediatamente después de guardar).
  ultimoDiagnostico: null,
  setUltimoDiagnostico: (ultimoDiagnostico) => set({ ultimoDiagnostico }),
}));
