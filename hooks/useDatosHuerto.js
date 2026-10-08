// ============================================================
// hooks/useDatosHuerto.js — Datos del huerto para la pestaña "Hoy":
// cultivos (con marcas locales), tareas, balance hídrico y, derivados,
// recomendaciones de riego y avisos de poda. Recarga al enfocar.
// ============================================================

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useFocusEffect } from '@react-navigation/native';

import { listarCultivosHuerto, listarTareasPendientes } from '../supabase';
import { aplicarMarcasLocales } from '../registroLocal';
import { calcularBalanceHidrico } from '../clima';
import { calcularRecomendacionesRiego, calcularRiegoOrientativo } from '../riego';
import { calcularAlertasPoda } from '../poda';
import { CATALOGO_PLANTAS } from '../catalogoPlantas';
import { mensajeDeError } from '../utils';
import { useAppStore } from '../store';
import { programarAvisosHuerto } from '../avisosHuerto';

export const CATALOGO_PLANO = CATALOGO_PLANTAS.flatMap((c) => c.plantas);

export default function useDatosHuerto() {
  const coords = useAppStore((s) => s.coords);
  const zona = useAppStore((s) => s.zonaClimatica) || 'mediterranea';
  const suelo = useAppStore((s) => s.sueloHuerto) || null;
  const prefsAvisos = useAppStore((s) => s.prefsAvisos);

  const [cultivos, setCultivos] = useState([]);
  const [tareas, setTareas] = useState([]);
  const [balance, setBalance] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const montado = useRef(true);
  useEffect(() => () => {
    montado.current = false;
  }, []);

  const recargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const [lista, pendientes, bal] = await Promise.all([
        listarCultivosHuerto().then(aplicarMarcasLocales),
        listarTareasPendientes().catch(() => []),
        coords ? calcularBalanceHidrico(coords.lat, coords.lon).catch(() => null) : Promise.resolve(null),
      ]);
      if (!montado.current) return;
      setCultivos(lista);
      setTareas(pendientes || []);
      setBalance(bal);
    } catch (e) {
      if (montado.current) setError(mensajeDeError(e));
    } finally {
      if (montado.current) setCargando(false);
    }
  }, [coords]);

  useFocusEffect(
    useCallback(() => {
      recargar();
    }, [recargar])
  );

  const activos = useMemo(() => cultivos.filter((c) => c.estado === 'sembrado'), [cultivos]);
  const opciones = useMemo(() => ({ suelo }), [suelo]);

  const recomendaciones = useMemo(() => {
    const sinDatos = !balance || (balance.litrosPorM2 == null && !balance.lluviaSuficiente);
    const r = sinDatos
      ? calcularRiegoOrientativo(activos, CATALOGO_PLANO, new Date(), zona, opciones)
      : calcularRecomendacionesRiego(activos, CATALOGO_PLANO, balance, new Date(), opciones);
    return r;
  }, [activos, balance, zona, opciones]);

  const alertasPoda = useMemo(() => calcularAlertasPoda(activos, CATALOGO_PLANO, new Date(), zona), [activos, zona]);

  // Recordatorios de riego/poda a la hora elegida (se recalculan al
  // cargar y al cambiar la hora en Ajustes). Solo tras una carga real.
  const cargadoRef = useRef(false);
  useEffect(() => {
    if (cargando) return;
    if (!cargadoRef.current) {
      cargadoRef.current = cultivos.length > 0 || balance !== null;
      if (!cargadoRef.current) return;
    }
    programarAvisosHuerto({ activos, recomendaciones: recomendaciones?.recomendaciones, zona, prefs: prefsAvisos });
  }, [activos, recomendaciones, zona, prefsAvisos, cargando, cultivos.length, balance]);

  // Cambio optimista local de un campo de un cultivo.
  const parchearCultivo = useCallback((id, cambios) => {
    setCultivos((prev) => prev.map((c) => (c.id === id ? { ...c, ...cambios } : c)));
  }, []);

  return {
    cultivos,
    activos,
    tareas,
    setTareas,
    balance,
    coords,
    cargando,
    error,
    recargar,
    recomendaciones,
    alertasPoda,
    parchearCultivo,
    setCultivos,
  };
}
