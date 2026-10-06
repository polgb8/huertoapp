// ============================================================
// screens/PlannerScreen.js — Módulo B: Planificador.
//   - "Puedes plantar ahora": lista determinista y completa (sin IA,
//     sin red) de todo lo que toca sembrar/plantar este mes, según
//     calendarioSiembra.js — igual que en el prototipo aprobado.
//   - "¿Quieres algo más concreto?": sugerencia con IA (Gemini) bajo
//     demanda (ya no se dispara sola al entrar), que sí tiene en
//     cuenta ubicación/clima/historial de rotación de 4 años.
// ============================================================

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import * as Haptics from 'expo-haptics';

import { colors, radii, spacing, tipografia } from '../theme';
import { Card, BotonPrimario, BotonSecundario } from '../components/UI';
import DetallePlanta from '../components/DetallePlanta';
import { llamarGemini } from '../gemini';
import { listarHistorialCultivos, insertarCultivo } from '../supabase';
import { obtenerClimaActual } from '../clima';
import { mensajeDeError } from '../utils';
import { useAppStore } from '../store';
import { leerCoordsCacheadas, seDenegoAntes, refrescarUbicacion } from '../ubicacion';
import { obtenerPlantableEsteMes, MESES, ESTACIONES } from '../calendarioSiembra';
import { CATALOGO_PLANTAS } from '../catalogoPlantas';

const SCHEMA_SUGERENCIAS = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      nombre: { type: 'STRING' },
      variedad: { type: 'STRING' },
      distancia_cm: { type: 'NUMBER' },
      dias_cosecha: { type: 'NUMBER' },
      asociacion: { type: 'STRING' },
      instrucciones: { type: 'STRING' },
    },
    required: ['nombre', 'variedad', 'distancia_cm', 'dias_cosecha', 'asociacion', 'instrucciones'],
  },
};

// Etiqueta y color de cada método de siembra (mismo lenguaje visual que
// el prototipo aprobado, más "Cualquiera" para el caso en que una
// especie admite los dos métodos este mismo mes — ver calendarioSiembra.js).
const ETIQUETA_METODO = {
  directa: { texto: 'Directa', bg: colors.badgeSembradoBg, color: colors.badgeSembradoText },
  semillero: { texto: 'Semillero', bg: colors.badgeOptimoBg, color: colors.badgeOptimoText },
  cualquiera: { texto: 'Cualquiera', bg: colors.accentSoftBg, color: colors.accentSoftText },
};

function construirPrompt({ fecha, ubicacionTexto, climaTexto, sembradoTexto, historialTexto }) {
  return (
    'Eres un experto en permacultura y rotación de cultivos a 4 años. ' +
    `Hoy es ${fecha}. Ubicación del huerto: ${ubicacionTexto}. Clima actual: ${climaTexto}. ` +
    `Sembrado ahora mismo: ${sembradoTexto}. Historial de los últimos 4 años (para no repetir familia ` +
    `botánica en la misma zona y evitar agotar el suelo): ${historialTexto}. ` +
    'Razona internamente sobre asociación simbiótica y necesidades de suelo de cada familia, pero explica ' +
    'las conclusiones en lenguaje sencillo, sin tecnicismos. ' +
    'Sugiere 3 o 4 cultivos de temporada adecuados para rotar o asociar bien, evitando repetir la misma ' +
    'familia botánica reciente en el historial. ' +
    'Devuelve ÚNICAMENTE un array JSON estricto, sin texto ni markdown adicional, con este formato ' +
    'exacto por cada elemento: {"nombre": "", "variedad": "", "distancia_cm": 0, "dias_cosecha": 0, ' +
    '"asociacion": "", "instrucciones": ""}.'
  );
}

export default function PlannerScreen() {
  const [cargando, setCargando] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [sugerencias, setSugerencias] = useState([]);
  const [avisoUbicacion, setAvisoUbicacion] = useState(null);
  const [indicesAnadidos, setIndicesAnadidos] = useState({});
  const [indicesGuardando, setIndicesGuardando] = useState({});
  const [actualizandoUbicacion, setActualizandoUbicacion] = useState(false);
  // Ficha de detalle de una especie del catálogo, abierta al tocar una
  // fila de "Puedes plantar ahora" (mismo componente que usa Buscar,
  // ver components/DetallePlanta.js), con un botón "+" para añadirla
  // directamente al huerto sin tener que ir a Buscar a por ella.
  const [plantaSeleccionada, setPlantaSeleccionada] = useState(null);
  const [agregandoCatalogo, setAgregandoCatalogo] = useState(false);
  const [catalogoAgregados, setCatalogoAgregados] = useState({});

  const conectado = useAppStore((s) => s.conectado);
  const coords = useAppStore((s) => s.coords);
  const setCoords = useAppStore((s) => s.setCoords);
  const clima = useAppStore((s) => s.clima);
  const setClima = useAppStore((s) => s.setClima);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Catálogo en una lista plana, para poder encontrar la ficha completa
  // (cuidados, siembra, plagas...) de un nombre de "Puedes plantar
  // ahora" (que solo trae {nombre, metodo} — ver calendarioSiembra.js).
  const plantasCatalogoPlano = useMemo(
    () => CATALOGO_PLANTAS.flatMap((categoria) => categoria.plantas),
    []
  );
  const catalogoPorNombre = useMemo(() => {
    const mapa = new Map();
    plantasCatalogoPlano.forEach((p) => {
      if (p.nombre) mapa.set(p.nombre, p);
    });
    return mapa;
  }, [plantasCatalogoPlano]);

  const abrirDetallePlantable = useCallback(
    (nombre) => {
      const planta = catalogoPorNombre.get(nombre);
      if (planta) setPlantaSeleccionada(planta);
    },
    [catalogoPorNombre]
  );

  const cerrarDetallePlantable = useCallback(() => setPlantaSeleccionada(null), []);

  const agregarCatalogoAlHuerto = useCallback(async () => {
    if (!plantaSeleccionada || agregandoCatalogo) return;
    setAgregandoCatalogo(true);
    try {
      await insertarCultivo({
        nombre: plantaSeleccionada.nombre,
        dias_cosecha: plantaSeleccionada.diasCosecha || 60,
      });
      if (isMountedRef.current) {
        setCatalogoAgregados((prev) => ({ ...prev, [plantaSeleccionada.nombre]: true }));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
    } catch (e) {
      console.log('Error al añadir cultivo del catálogo:', e?.message);
      if (isMountedRef.current) setErrorMsg(mensajeDeError(e));
    } finally {
      if (isMountedRef.current) setAgregandoCatalogo(false);
    }
  }, [plantaSeleccionada, agregandoCatalogo]);

  // El huerto no se mueve: si ya se guardó una posición antes, se lee de
  // AsyncStorage (ver ubicacion.js) en vez de volver a pedir permiso/GPS
  // al abrir esta pantalla. Solo se pide permiso de verdad si el usuario
  // pulsa "Sugerir cultivos con IA" (más abajo) y todavía no hay nada
  // guardado.
  useEffect(() => {
    if (coords) return;
    leerCoordsCacheadas().then((cacheadas) => {
      if (cacheadas && isMountedRef.current) setCoords(cacheadas);
    });
  }, [coords, setCoords]);

  // "Puedes plantar ahora": determinista, sin red — se calcula una sola
  // vez (el mes no cambia mientras la pantalla está abierta).
  const infoMes = useMemo(() => {
    const hoy = new Date();
    const mesNumero = hoy.getMonth() + 1; // getMonth() es 0-indexado
    return {
      nombreMes: MESES[mesNumero - 1],
      estacion: ESTACIONES[mesNumero - 1],
      plantable: obtenerPlantableEsteMes(mesNumero),
    };
  }, []);

  const solicitarSugerencias = useCallback(async () => {
    if (!conectado) {
      setErrorMsg('Sin conexión a internet ahora mismo. Conéctate y vuelve a intentarlo.');
      return;
    }

    setCargando(true);
    setErrorMsg(null);
    setAvisoUbicacion(null);

    try {
      let coordsActuales = coords;
      let ubicacionTexto = coords ? `lat ${coords.lat.toFixed(2)}, lon ${coords.lon.toFixed(2)}` : 'ubicación no disponible';

      if (!coordsActuales) {
        // Si el usuario ya dijo que no antes, no se le vuelve a preguntar
        // solo — solo el enlace manual "Actualizar ubicación" vuelve a
        // intentarlo explícitamente.
        const denegadoAntes = await seDenegoAntes();
        if (denegadoAntes) {
          if (isMountedRef.current) {
            setAvisoUbicacion('Sin permiso de ubicación: las sugerencias no tienen en cuenta tu zona exacta.');
          }
        } else {
          const { coords: nuevasCoords, denegado } = await refrescarUbicacion();
          if (nuevasCoords) {
            coordsActuales = nuevasCoords;
            ubicacionTexto = `lat ${coordsActuales.lat.toFixed(2)}, lon ${coordsActuales.lon.toFixed(2)}`;
            if (isMountedRef.current) setCoords(coordsActuales);
          } else if (isMountedRef.current) {
            setAvisoUbicacion(
              denegado
                ? 'Sin permiso de ubicación: las sugerencias no tienen en cuenta tu zona exacta.'
                : 'No se pudo obtener tu ubicación. Sugerencias genéricas por temporada.'
            );
          }
        }
      }

      let climaActual = clima;
      if (!climaActual && coordsActuales) {
        climaActual = await obtenerClimaActual(coordsActuales.lat, coordsActuales.lon).catch(() => null);
        if (climaActual && isMountedRef.current) setClima(climaActual);
      }
      const climaTexto = climaActual?.resumenTexto ?? 'sin datos climáticos disponibles';

      const historial = await listarHistorialCultivos().catch(() => []);
      const sembradoAhora = historial.filter((c) => c.estado === 'sembrado');
      const sembradoTexto = sembradoAhora.length > 0 ? sembradoAhora.map((c) => c.nombre).join(', ') : 'nada por ahora';
      const historialTexto =
        historial.length > 0
          ? historial.map((c) => `${c.nombre} (${c.estado})`).join(', ')
          : 'sin historial registrado todavía';

      const fecha = new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });

      const resultado = await llamarGemini({
        promptTexto: construirPrompt({ fecha, ubicacionTexto, climaTexto, sembradoTexto, historialTexto }),
        responseSchema: SCHEMA_SUGERENCIAS,
        valorRespaldo: [],
        maxOutputTokens: 1024,
      });

      const lista = Array.isArray(resultado) ? resultado : [];
      if (isMountedRef.current) {
        setSugerencias(lista);
        setIndicesAnadidos({});
        if (lista.length === 0) {
          setErrorMsg('Gemini no ha devuelto sugerencias válidas. Inténtalo de nuevo.');
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }
      }
    } catch (e) {
      console.log('Error en solicitarSugerencias:', e?.message);
      if (isMountedRef.current) {
        setErrorMsg(mensajeDeError(e));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      }
    } finally {
      if (isMountedRef.current) setCargando(false);
    }
  }, [conectado, coords, clima, setCoords, setClima]);

  // Enlace manual "📍 Actualizar ubicación": a diferencia del flujo de
  // arriba, ignora cualquier negativa de permiso previa (aquí el usuario
  // SÍ está pidiendo explícitamente que se vuelva a intentar) y, si
  // consigue una posición nueva, relanza las sugerencias con ella.
  const actualizarUbicacion = useCallback(async () => {
    setActualizandoUbicacion(true);
    setAvisoUbicacion(null);
    try {
      const { coords: nuevasCoords, denegado } = await refrescarUbicacion();
      if (nuevasCoords) {
        setCoords(nuevasCoords);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        solicitarSugerencias();
      } else if (isMountedRef.current) {
        setAvisoUbicacion(
          denegado
            ? 'Sin permiso de ubicación: actívalo desde los ajustes del móvil para esta app.'
            : 'No se pudo obtener tu ubicación ahora mismo. Inténtalo de nuevo en un momento.'
        );
      }
    } finally {
      if (isMountedRef.current) setActualizandoUbicacion(false);
    }
  }, [setCoords, solicitarSugerencias]);

  const anadirAlHuerto = useCallback(async (sugerencia, indice) => {
    if (indicesGuardando[indice] || indicesAnadidos[indice]) return;
    if (!conectado) {
      setErrorMsg('Sin conexión a internet ahora mismo. Conéctate y vuelve a intentarlo.');
      return;
    }
    setIndicesGuardando((prev) => ({ ...prev, [indice]: true }));
    try {
      await insertarCultivo(sugerencia);
      if (isMountedRef.current) {
        setIndicesAnadidos((prev) => ({ ...prev, [indice]: true }));
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
    } catch (e) {
      console.log('Error al añadir cultivo:', e?.message);
      if (isMountedRef.current) setErrorMsg(mensajeDeError(e));
    } finally {
      if (isMountedRef.current) {
        setIndicesGuardando((prev) => ({ ...prev, [indice]: false }));
      }
    }
  }, [indicesGuardando, indicesAnadidos, conectado]);

  return (
    <ScrollView
      style={estilos.contenedor}
      contentContainerStyle={estilos.contenido}
      refreshControl={<RefreshControl refreshing={cargando} onRefresh={solicitarSugerencias} />}
    >
      <Text style={tipografia.titulo}>¿Qué planto ahora?</Text>

      <Card style={[estilos.tarjeta, estilos.tarjetaMesActual]}>
        <Text style={estilos.tituloMesActual}>
          📅 {infoMes.nombreMes} · {infoMes.estacion}
        </Text>
        <Text style={estilos.subtituloMesActual}>Esto es lo que toca sembrar o plantar este mes en tu zona.</Text>
      </Card>

      <Card style={estilos.tarjeta}>
        <Text style={tipografia.subtitulo}>Puedes plantar ahora</Text>
        {infoMes.plantable.length === 0 ? (
          <Text style={estilos.textoVacioPlantable}>Sin datos para este mes todavía.</Text>
        ) : (
          <View style={estilos.listaPlantable}>
            {infoMes.plantable.map(({ nombre, metodo }) => {
              const etiqueta = ETIQUETA_METODO[metodo];
              return (
                <TouchableOpacity
                  key={nombre}
                  testID={`fila-plantable-${nombre}`}
                  style={estilos.filaPlantable}
                  onPress={() => abrirDetallePlantable(nombre)}
                  activeOpacity={0.6}
                  accessibilityRole="button"
                  accessibilityLabel={`Ver ficha de ${nombre}`}
                >
                  <Text style={estilos.nombrePlantable}>{nombre}</Text>
                  <View style={estilos.filaTituloDer}>
                    <View style={[estilos.badgeMetodo, { backgroundColor: etiqueta.bg }]}>
                      <Text style={[estilos.badgeMetodoTexto, { color: etiqueta.color }]}>{etiqueta.texto}</Text>
                    </View>
                    <Text style={estilos.flechaFilaPlantable}>›</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
        <Text style={estilos.leyendaPlantable}>
          <Text style={{ fontWeight: '700' }}>Directa</Text> = semilla directa a tierra ·{' '}
          <Text style={{ fontWeight: '700' }}>Semillero</Text> = mejor empezarla protegida y trasplantar después ·{' '}
          <Text style={{ fontWeight: '700' }}>Cualquiera</Text> = valen los dos métodos este mes. Orientativo para
          clima templado — se puede afinar.
        </Text>
      </Card>

      <Card style={estilos.tarjeta}>
        <Text style={tipografia.subtitulo}>¿Quieres algo más concreto?</Text>
        <Text style={estilos.subtitulo}>
          La IA puede sugerir 3-4 cultivos según tu ubicación, el clima real de hoy y lo que ya has plantado (para no
          repetir familia).
        </Text>

        {!conectado && <Text style={estilos.aviso}>Sin conexión: necesitas internet para pedir sugerencias.</Text>}

        <BotonPrimario
          titulo={cargando ? 'Buscando sugerencias…' : 'Sugerir cultivos con IA'}
          onPress={solicitarSugerencias}
          disabled={!conectado}
          cargando={cargando}
          style={estilos.botonSugerir}
        />

        {!!avisoUbicacion && (
          <View style={estilos.filaAvisoUbicacion}>
            <Text style={estilos.aviso}>{avisoUbicacion}</Text>
            <TouchableOpacity
              onPress={actualizarUbicacion}
              disabled={actualizandoUbicacion}
              accessibilityRole="button"
              accessibilityLabel="Actualizar ubicación"
            >
              <Text style={estilos.enlaceUbicacion}>
                {actualizandoUbicacion ? 'Actualizando…' : '📍 Actualizar ubicación'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
        {!!errorMsg && !cargando && <Text style={estilos.error}>{errorMsg}</Text>}
      </Card>

      {sugerencias.map((s, indice) => (
        <Card key={`${s.nombre}-${indice}`} style={estilos.tarjeta}>
          <Text style={tipografia.subtitulo}>
            {s.nombre} {s.variedad ? `· ${s.variedad}` : ''}
          </Text>
          <Text style={estilos.detalle}>
            Distancia: {s.distancia_cm ?? '—'} cm · Cosecha en ~{s.dias_cosecha ?? '—'} días
          </Text>
          {!!s.asociacion && <Text style={estilos.detalle}>Asociación: {s.asociacion}</Text>}
          {!!s.instrucciones && <Text style={estilos.instrucciones}>{s.instrucciones}</Text>}

          <BotonPrimario
            titulo={indicesAnadidos[indice] ? 'Añadido ✓' : 'Añadir a mi huerto'}
            onPress={() => anadirAlHuerto(s, indice)}
            cargando={!!indicesGuardando[indice]}
            disabled={!!indicesAnadidos[indice]}
            style={estilos.botonAnadir}
          />
        </Card>
      ))}

      {plantaSeleccionada && (
        <DetallePlanta
          planta={plantaSeleccionada}
          onCerrar={cerrarDetallePlantable}
          onAgregar={agregarCatalogoAlHuerto}
          agregando={agregandoCatalogo}
          agregado={!!catalogoAgregados[plantaSeleccionada.nombre]}
        />
      )}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  contenedor: { flex: 1, backgroundColor: colors.background },
  // Hueco inferior para que el botón del Asistente no tape el final.
  contenido: { padding: spacing.lg, paddingBottom: 120 },
  tarjeta: { marginTop: spacing.md },
  tarjetaMesActual: { backgroundColor: colors.headerDeep, marginTop: spacing.md },
  tituloMesActual: { fontSize: 16, fontWeight: '700', color: colors.textOnDark },
  subtituloMesActual: { fontSize: 13, color: colors.textOnDark, opacity: 0.85, marginTop: spacing.xs },
  subtitulo: { fontSize: 14, color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.sm },
  listaPlantable: { marginTop: spacing.sm },
  filaPlantable: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  nombrePlantable: { fontSize: 14, color: colors.textPrimary, fontWeight: '600' },
  filaTituloDer: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  flechaFilaPlantable: { fontSize: 18, color: colors.textSecondary, fontWeight: '700' },
  badgeMetodo: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radii.pill },
  badgeMetodoTexto: { fontSize: 12, fontWeight: '700' },
  textoVacioPlantable: { fontSize: 14, color: colors.textSecondary, marginTop: spacing.sm },
  leyendaPlantable: { fontSize: 12, color: colors.textSecondary, marginTop: spacing.md, lineHeight: 18 },
  botonSugerir: { marginTop: spacing.sm },
  filaAvisoUbicacion: { marginTop: spacing.md },
  aviso: { fontSize: 13, color: colors.warning, marginBottom: spacing.xs },
  enlaceUbicacion: { fontSize: 13, fontWeight: '700', color: colors.mintDark },
  error: { fontSize: 14, color: colors.danger, marginTop: spacing.sm },
  detalle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  instrucciones: { fontSize: 14, color: colors.textPrimary, marginTop: spacing.sm },
  botonAnadir: { marginTop: spacing.md },
});
