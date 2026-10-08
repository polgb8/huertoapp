// ============================================================
// screens/BuscarScreen.js — Buscador del catálogo de plantas.
// Filtra CATALOGO_PLANTAS (16 categorías / ~126 especies) por texto,
// ubicación disponible, luz disponible y tipo de planta, y muestra el
// resultado agrupado por categoría. Tocar una planta abre su ficha
// completa en un modal.
//
// Medidor de luz: expo-sensors' LightSensor da lux reales, pero SOLO
// en Android (documentado así por el propio Expo). En Android se
// ofrece una medición real (media de ~2.5s de muestras, para evitar
// un valor instantáneo ruidoso); en iOS/web NUNCA se finge una
// lectura — en su lugar se da una guía orientativa de puntos de
// referencia reales para que el usuario se autoevalúe. Ambos caminos
// terminan en el mismo sitio: el filtro "☀️ Luz disponible" de arriba.
// ============================================================

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, SectionList, TouchableOpacity, Modal, ScrollView, Platform } from 'react-native';
import { LightSensor } from 'expo-sensors';
import { useNavigation, useRoute } from '@react-navigation/native';

import { colors, radii, spacing, tipografia } from '../theme';
import { Card, CampoTexto, BotonPrimario, BotonSecundario, BotonX } from '../components/UI';
import DetallePlanta from '../components/DetallePlanta';
import { CATALOGO_PLANTAS } from '../catalogoPlantas';
import { normalizarBusqueda } from '../utils';

// Derivado una sola vez del catálogo (no hardcodeado): cada `tipo` distinto
// que aparezca en cualquier planta de cualquier categoría, en el orden en
// que se encuentran.
const TIPOS_DISPONIBLES = (() => {
  const vistos = new Set();
  const lista = [];
  CATALOGO_PLANTAS.forEach((categoria) => {
    categoria.plantas.forEach((planta) => {
      if (planta.tipo && !vistos.has(planta.tipo)) {
        vistos.add(planta.tipo);
        lista.push(planta.tipo);
      }
    });
  });
  return lista;
})();

const OPCIONES_DONDE = [
  { clave: 'todas', etiqueta: 'Cualquiera' },
  { clave: 'interior', etiqueta: 'Interior' },
  { clave: 'exterior', etiqueta: 'Exterior' },
];

const OPCIONES_LUZ = [
  { clave: 'todas', etiqueta: 'Cualquiera' },
  { clave: 'poca luz', etiqueta: 'Poca luz' },
  { clave: 'luz indirecta', etiqueta: 'Luz indirecta' },
  { clave: 'semisombra', etiqueta: 'Semisombra' },
  { clave: 'pleno sol', etiqueta: 'Pleno sol' },
];

const OPCIONES_TIPO = [{ clave: 'todas', etiqueta: 'Todas' }, ...TIPOS_DISPONIBLES.map((t) => ({ clave: t, etiqueta: t }))];

const FILTROS_POR_DEFECTO = { donde: 'todas', luz: 'todas', tipo: 'todas' };

function coincideDonde(planta, filtro) {
  if (filtro === 'todas') return true;
  if (planta.ubicacion === 'ambas') return true;
  return planta.ubicacion === filtro;
}

function coincideLuz(planta, filtro) {
  if (filtro === 'todas') return true;
  return planta.nivelLuz === filtro;
}

function coincideTipo(planta, filtro) {
  if (filtro === 'todas') return true;
  return planta.tipo === filtro;
}

// ------------------------------------------------------------
// Medidor de luz: bucketing de lux -> los mismos 4 niveles que ya
// usa el filtro de arriba (OPCIONES_LUZ/nivelLuz en catalogoPlantas.js).
// Umbrales: <200 poca luz, 200–800 luz indirecta, 800–2000 semisombra,
// >2000 pleno sol. No existe ninguna otra definición de estos rangos
// en el resto del código (ni en catalogoPlantas.js ni en ningún otro
// screen) — esta es la única, para no duplicarla.
// ------------------------------------------------------------
function clasificarLux(lux) {
  if (lux < 200) return 'poca luz';
  if (lux < 800) return 'luz indirecta';
  if (lux < 2000) return 'semisombra';
  return 'pleno sol';
}

// Hasta 4 plantas de ejemplo por nivel de luz, derivadas una sola vez
// del catálogo real (nunca inventadas), en el mismo espíritu que
// TIPOS_DISPONIBLES de arriba.
const EJEMPLOS_POR_NIVEL = (() => {
  const acc = { 'poca luz': [], 'luz indirecta': [], semisombra: [], 'pleno sol': [] };
  CATALOGO_PLANTAS.forEach((categoria) => {
    categoria.plantas.forEach((planta) => {
      const lista = acc[planta.nivelLuz];
      if (lista && lista.length < 4 && !lista.includes(planta.nombre)) {
        lista.push(planta.nombre);
      }
    });
  });
  return acc;
})();

// Guía orientativa para iOS/web (sin sensor accesible): puntos de
// referencia reales y bien establecidos, cada uno mapeado al mismo
// nivel de luz que usa el filtro.
const REFERENCIAS_LUZ = [
  { clave: 'pleno sol', emoji: '☀️', texto: 'Justo pegado a una ventana con sol directo varias horas al día' },
  { clave: 'luz indirecta', emoji: '🌤️', texto: 'Cerca de una ventana luminosa, pero sin que le dé el sol directo' },
  { clave: 'semisombra', emoji: '🌥️', texto: 'A un par de metros de una ventana, en una habitación con buena luz' },
  { clave: 'poca luz', emoji: '🌑', texto: 'Un pasillo, un baño interior o un rincón sin ventana cerca' },
];

// Duración de la muestra de lux: se promedian ~2.5s de lecturas en vez
// de quedarse con una sola instantánea, que suele ser ruidosa (un
// reflejo, una sombra pasajera) y no representativa del rincón real.
const DURACION_MEDICION_MS = 2500;

// ------------------------------------------------------------
// Fila de chips de selección única (segmentada): una sola opción activa
// a la vez, estilo "pill" ya usado en el resto de la app (Badge,
// selector de modo de ScanScreen), aquí en la paleta clara de las
// pantallas normales en vez de sobre la cámara.
// ------------------------------------------------------------
function FilaChips({ opciones, valor, onSeleccionar }) {
  return (
    <View style={estilos.filaChips}>
      {opciones.map((op) => {
        const activo = valor === op.clave;
        return (
          <TouchableOpacity
            key={op.clave}
            style={[estilos.chip, activo && estilos.chipActivo]}
            onPress={() => onSeleccionar(op.clave)}
            accessibilityRole="button"
            accessibilityLabel={op.etiqueta}
            accessibilityState={{ selected: activo }}
          >
            <Text style={[estilos.chipTexto, activo && estilos.chipTextoActivo]}>{op.etiqueta}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ------------------------------------------------------------
// FiltrosModal: los 3 filtros (Dónde/Luz/Tipo) + el acceso al medidor de
// luz viven aquí, detrás del botón "🔧 Filtros" — antes ocupaban toda la
// tarjeta bajo el buscador, empujando los resultados fuera de la
// pantalla en cuanto salía el teclado. Mismo patrón visual de hoja
// inferior que MedidorLuzModal, justo debajo.
// ------------------------------------------------------------
function FiltrosModal({ visible, onCerrar, filtros, onCambiarFiltro, onQuitarFiltros, onAbrirMedidor }) {
  if (!visible) return null;
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onCerrar}>
      <View style={estilos.modalFondoInferior}>
        <ScrollView style={estilos.modalPanelInferior} contentContainerStyle={estilos.modalPanelInferiorContenido}>
          <View style={estilos.filaCabeceraModalCentrada}>
            <BotonX
              testID="boton-cerrar-filtros-x"
              onPress={onCerrar}
              accessibilityLabel="Cerrar filtros"
              style={estilos.botonXIzquierda}
            />
            <Text style={[tipografia.titulo, estilos.tituloCentrado]}>🔧 Filtros</Text>
          </View>

          <Text style={estilos.tituloFiltro}>📍 Dónde</Text>
          <FilaChips
            opciones={OPCIONES_DONDE}
            valor={filtros.donde}
            onSeleccionar={(v) => onCambiarFiltro('donde', v)}
          />

          <Text style={estilos.tituloFiltro}>☀️ Luz disponible</Text>
          <FilaChips
            opciones={OPCIONES_LUZ}
            valor={filtros.luz}
            onSeleccionar={(v) => onCambiarFiltro('luz', v)}
          />
          <BotonSecundario
            testID="boton-abrir-medidor-luz"
            titulo="📏 Medir la luz aquí"
            onPress={onAbrirMedidor}
            style={estilos.botonAbrirMedidor}
          />

          <Text style={estilos.tituloFiltro}>🌱 Tipo</Text>
          <FilaChips
            opciones={OPCIONES_TIPO}
            valor={filtros.tipo}
            onSeleccionar={(v) => onCambiarFiltro('tipo', v)}
          />

          <BotonSecundario titulo="Quitar filtros" onPress={onQuitarFiltros} style={estilos.botonQuitarFiltrosModal} />
          <BotonPrimario titulo="Ver resultados" onPress={onCerrar} style={estilos.botonCerrarFiltros} />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ------------------------------------------------------------
// MedidorLuzModal: en Android, mide lux reales con el sensor de luz
// ambiente (expo-sensors, solo disponible en Android — ver cabecera
// del archivo); en iOS/web muestra una guía orientativa honesta en vez
// de fingir una medición. Nunca lanza: cualquier fallo del sensor
// (no disponible, error al suscribirse) se resuelve en un mensaje
// claro, nunca en un crash. La suscripción se limpia con `.remove()`
// tanto al cerrarse el modal como al desmontarse el componente.
// ------------------------------------------------------------
function MedidorLuzModal({ visible, onCerrar, onSeleccionarNivel }) {
  // 'comprobando' | 'disponible' | 'no_disponible'
  const [disponibilidad, setDisponibilidad] = useState('comprobando');
  const [midiendo, setMidiendo] = useState(false);
  const [luxMedido, setLuxMedido] = useState(null);

  const suscripcionRef = useRef(null);
  const timeoutRef = useRef(null);
  const muestrasRef = useRef([]);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const limpiarMedicion = useCallback(() => {
    if (suscripcionRef.current) {
      suscripcionRef.current.remove();
      suscripcionRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // Se comprueba disponibilidad cada vez que el modal se abre (no al
  // montar el componente: el modal vive montado todo el rato, solo
  // cambia `visible`, igual que DetallePlanta en components/DetallePlanta.js).
  // Al cerrarse (visible pasa a false) o desmontarse, se limpia
  // cualquier suscripción o temporizador en curso — nunca se deja un
  // listener del sensor vivo sin nadie escuchándolo.
  useEffect(() => {
    if (!visible) {
      limpiarMedicion();
      return undefined;
    }
    if (Platform.OS !== 'android') return undefined;

    setDisponibilidad('comprobando');
    setLuxMedido(null);

    LightSensor.isAvailableAsync()
      .then((disponible) => {
        if (isMountedRef.current) setDisponibilidad(disponible ? 'disponible' : 'no_disponible');
      })
      .catch(() => {
        if (isMountedRef.current) setDisponibilidad('no_disponible');
      });

    return () => {
      limpiarMedicion();
    };
  }, [visible, limpiarMedicion]);

  useEffect(() => () => limpiarMedicion(), [limpiarMedicion]);

  const medir = useCallback(() => {
    if (midiendo) return;
    muestrasRef.current = [];
    setLuxMedido(null);
    setMidiendo(true);

    try {
      suscripcionRef.current = LightSensor.addListener((evento) => {
        if (Number.isFinite(evento?.illuminance)) {
          muestrasRef.current.push(evento.illuminance);
        }
      });
    } catch (e) {
      console.log('No se pudo suscribir al sensor de luz (no bloqueante):', e?.message);
      if (isMountedRef.current) {
        setMidiendo(false);
        setDisponibilidad('no_disponible');
      }
      return;
    }

    timeoutRef.current = setTimeout(() => {
      limpiarMedicion();
      if (!isMountedRef.current) return;
      const muestras = muestrasRef.current;
      if (muestras.length === 0) {
        // El sensor decía estar disponible pero no ha entregado ni una
        // muestra en 2.5s: mejor decirlo claramente que mostrar un "0 lux"
        // engañoso.
        setDisponibilidad('no_disponible');
        setMidiendo(false);
        return;
      }
      const media = muestras.reduce((suma, v) => suma + v, 0) / muestras.length;
      setLuxMedido(Math.round(media));
      setMidiendo(false);
    }, DURACION_MEDICION_MS);
  }, [midiendo, limpiarMedicion]);

  if (!visible) return null;

  const nivel = luxMedido != null ? clasificarLux(luxMedido) : null;
  const ejemplos = nivel ? EJEMPLOS_POR_NIVEL[nivel] : [];
  const etiquetaNivel = nivel ? OPCIONES_LUZ.find((o) => o.clave === nivel)?.etiqueta : null;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onCerrar}>
      <View style={estilos.modalFondoInferior}>
        <ScrollView style={estilos.modalPanelInferior} contentContainerStyle={estilos.modalPanelInferiorContenido}>
          <Text style={tipografia.titulo}>📏 Medidor de luz</Text>

          {Platform.OS === 'android' ? (
            <>
              {disponibilidad === 'comprobando' && (
                <Text style={estilos.textoMedidor}>Comprobando el sensor de luz de tu móvil…</Text>
              )}

              {disponibilidad === 'no_disponible' && (
                <Text style={estilos.textoMedidor}>
                  Tu móvil no tiene un sensor de luz ambiental accesible, o no se ha podido usar ahora mismo. Usa la
                  guía orientativa de más abajo para hacerte una idea igualmente.
                </Text>
              )}

              {disponibilidad === 'disponible' && (
                <>
                  <Text style={estilos.textoMedidor}>
                    Coloca el móvil justo donde pondrías la planta, con la pantalla hacia la luz, y pulsa medir.
                  </Text>
                  <BotonPrimario
                    testID="boton-medir-luz"
                    titulo={midiendo ? 'Midiendo…' : 'Medir la luz aquí'}
                    onPress={medir}
                    cargando={midiendo}
                    style={estilos.botonMedir}
                  />

                  {luxMedido != null && (
                    <View style={estilos.resultadoMedidor}>
                      <Text style={estilos.luxTexto}>{luxMedido} lux</Text>
                      <Text style={estilos.nivelTexto}>Eso es, aproximadamente: {etiquetaNivel}</Text>
                      {ejemplos.length > 0 && (
                        <Text style={estilos.ejemplosTexto}>Van bien ahí: {ejemplos.join(', ')}</Text>
                      )}
                      <BotonSecundario
                        titulo="Ver plantas con esta luz"
                        onPress={() => onSeleccionarNivel(nivel)}
                        style={estilos.botonVerPlantas}
                      />
                    </View>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <Text style={estilos.textoMedidor}>
                Tu dispositivo no tiene sensor de luz accesible, pero aquí tienes una guía orientativa para que
                calcules a ojo cuánta luz recibe cada rincón:
              </Text>
              {REFERENCIAS_LUZ.map((ref) => {
                const etiqueta = OPCIONES_LUZ.find((o) => o.clave === ref.clave)?.etiqueta;
                return (
                  <TouchableOpacity
                    key={ref.clave}
                    style={estilos.referenciaFila}
                    onPress={() => onSeleccionarNivel(ref.clave)}
                  >
                    <Text style={estilos.referenciaTexto}>
                      {ref.emoji} {ref.texto}
                    </Text>
                    <Text style={estilos.referenciaNivel}>→ {etiqueta} · ver plantas</Text>
                  </TouchableOpacity>
                );
              })}
            </>
          )}

          <BotonSecundario titulo="Cerrar" onPress={onCerrar} style={estilos.botonCerrarMedidor} />
        </ScrollView>
      </View>
    </Modal>
  );
}


export default function BuscarScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const [volverA, setVolverA] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  const [filtros, setFiltros] = useState(FILTROS_POR_DEFECTO);
  const [plantaSeleccionada, setPlantaSeleccionada] = useState(null);
  const [medidorVisible, setMedidorVisible] = useState(false);
  const [filtrosVisible, setFiltrosVisible] = useState(false);

  // Llegada desde "Tus plantas" (route.params.plantaNombre): abre la ficha
  // de esa especie y, al cerrarla, vuelve a la pestaña de origen.
  useEffect(() => {
    const nombre = route.params?.plantaNombre;
    if (!nombre) return;
    const buscado = normalizarBusqueda(nombre).trim();
    const planta = CATALOGO_PLANTAS.flatMap((c) => c.plantas).find((p) => normalizarBusqueda(p.nombre) === buscado);
    if (planta) {
      setPlantaSeleccionada(planta);
      setVolverA(route.params?.volverA || null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.t]);

  const cerrarFicha = useCallback(() => {
    setPlantaSeleccionada(null);
    if (volverA) {
      const destino = volverA;
      setVolverA(null);
      navigation.navigate(destino);
    }
  }, [volverA, navigation]);

  const hayFiltrosActivos =
    !!busqueda.trim() || filtros.donde !== 'todas' || filtros.luz !== 'todas' || filtros.tipo !== 'todas';

  // Cuántos de los 3 filtros de la hoja inferior están activos (no cuenta
  // el texto de búsqueda): es lo que se ve en la burbuja del botón
  // "Filtros" para que quede claro que hay filtros aplicados aunque estén
  // ocultos detrás del botón.
  const numeroFiltrosActivos =
    (filtros.donde !== 'todas' ? 1 : 0) + (filtros.luz !== 'todas' ? 1 : 0) + (filtros.tipo !== 'todas' ? 1 : 0);

  const secciones = useMemo(() => {
    const textoBusqueda = normalizarBusqueda(busqueda);
    return CATALOGO_PLANTAS.map((categoria) => ({
      title: `${categoria.icono} ${categoria.etiqueta}`,
      key: categoria.clave,
      data: categoria.plantas.filter((planta) => {
        if (textoBusqueda && !normalizarBusqueda(planta.nombre).includes(textoBusqueda)) return false;
        if (!coincideDonde(planta, filtros.donde)) return false;
        if (!coincideLuz(planta, filtros.luz)) return false;
        if (!coincideTipo(planta, filtros.tipo)) return false;
        return true;
      }),
    })).filter((seccion) => seccion.data.length > 0);
  }, [busqueda, filtros]);

  const quitarFiltros = useCallback(() => {
    setBusqueda('');
    setFiltros(FILTROS_POR_DEFECTO);
  }, []);

  const quitarSoloFiltros = useCallback(() => {
    setFiltros(FILTROS_POR_DEFECTO);
  }, []);

  const cambiarFiltro = useCallback((clave, valor) => {
    setFiltros((f) => ({ ...f, [clave]: valor }));
  }, []);

  // Puente entre el medidor de luz (real en Android, guía orientativa en
  // iOS/web) y el filtro de luz que ya existe arriba: reutiliza el mismo
  // mecanismo de setFiltros, no crea un estado paralelo.
  const seleccionarNivelDesdeMedidor = useCallback((clave) => {
    setFiltros((f) => ({ ...f, luz: clave }));
    setMedidorVisible(false);
  }, []);

  const abrirMedidorDesdeFiltros = useCallback(() => {
    setFiltrosVisible(false);
    setMedidorVisible(true);
  }, []);

  return (
    <View style={estilos.contenedor}>
      <SectionList
        style={estilos.lista}
        contentContainerStyle={estilos.contenido}
        sections={secciones}
        keyExtractor={(item) => item.nombre}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            <Text style={tipografia.titulo}>Buscar plantas</Text>
            <CampoTexto
              placeholder="Buscar por nombre… p.ej. limón"
              value={busqueda}
              onChangeText={setBusqueda}
              style={estilos.campoBusqueda}
            />

            {/* Los filtros viven detrás de este botón, no en la pantalla
                principal: antes la tarjeta de filtros ocupaba toda la
                pantalla y, con el teclado abierto, los resultados
                quedaban fuera de la vista mientras se escribía. */}
            <View style={estilos.filaAccionesBusqueda}>
              <View style={estilos.botonFiltrosWrap}>
                <BotonSecundario
                  testID="boton-abrir-filtros"
                  titulo="🔧 Filtros"
                  onPress={() => setFiltrosVisible(true)}
                  style={estilos.botonFiltros}
                />
                {numeroFiltrosActivos > 0 && (
                  <View style={estilos.badgeFiltros}>
                    <Text style={estilos.badgeFiltrosTexto}>{numeroFiltrosActivos}</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        }
        renderSectionHeader={({ section }) => <Text style={estilos.tituloSeccionLista}>{section.title}</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => setPlantaSeleccionada(item)}
            accessibilityRole="button"
            accessibilityLabel={`Ver ficha de ${item.nombre}`}
          >
            <Card style={estilos.tarjetaPlanta}>
              <Text style={estilos.emojiFila}>{item.emoji || '🌿'}</Text>
              <View style={estilos.filaTextos}>
                <Text style={tipografia.subtitulo}>{item.nombre}</Text>
                {!!item.nombreCientifico && <Text style={estilos.nombreCientificoFila}>{item.nombreCientifico}</Text>}
              </View>
            </Card>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={estilos.vacio}>
            <Text style={tipografia.subtitulo}>No hay ninguna planta que coincida</Text>
            <Text style={estilos.vacioTexto}>Prueba con otros filtros o borra la búsqueda.</Text>
            {hayFiltrosActivos && (
              <BotonSecundario titulo="Quitar filtros" onPress={quitarFiltros} style={estilos.botonVacio} />
            )}
          </View>
        }
      />

      {plantaSeleccionada && (
        <DetallePlanta planta={plantaSeleccionada} onCerrar={cerrarFicha} />
      )}
      <FiltrosModal
        visible={filtrosVisible}
        onCerrar={() => setFiltrosVisible(false)}
        filtros={filtros}
        onCambiarFiltro={cambiarFiltro}
        onQuitarFiltros={quitarSoloFiltros}
        onAbrirMedidor={abrirMedidorDesdeFiltros}
      />
      <MedidorLuzModal
        visible={medidorVisible}
        onCerrar={() => setMedidorVisible(false)}
        onSeleccionarNivel={seleccionarNivelDesdeMedidor}
      />
    </View>
  );
}

const estilos = StyleSheet.create({
  contenedor: { flex: 1, backgroundColor: colors.background },
  lista: { flex: 1 },
  // Hueco inferior para que el botón del Asistente no tape el final.
  contenido: { padding: spacing.lg, paddingBottom: 120 },
  campoBusqueda: { marginTop: spacing.md },
  tituloFiltro: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginTop: spacing.sm, marginBottom: spacing.xs },
  filaChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.badgeNeutroBg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActivo: { backgroundColor: colors.mint, borderColor: colors.mint },
  chipTexto: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  chipTextoActivo: { color: colors.textOnDark },
  botonAbrirMedidor: { marginTop: spacing.sm },
  tituloSeccionLista: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.lg, marginBottom: spacing.sm },
  tarjetaPlanta: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  emojiFila: { fontSize: 28, marginRight: spacing.md },
  filaTextos: { flex: 1 },
  nombreCientificoFila: { fontSize: 12, fontStyle: 'italic', color: colors.textSecondary, marginTop: 2 },
  vacio: { alignItems: 'center', paddingVertical: spacing.xl, paddingHorizontal: spacing.lg },
  vacioTexto: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm, marginBottom: spacing.md },
  botonVacio: { minWidth: 180 },
  modalFondoInferior: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalPanelInferior: { backgroundColor: colors.card, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, maxHeight: '85%' },
  modalPanelInferiorContenido: { padding: spacing.lg, paddingBottom: spacing.xl },
  filaCabeceraModal: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  // Título "Filtros" centrado en la ventana (la X queda fija a la izquierda).
  filaCabeceraModalCentrada: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 40, marginBottom: spacing.xs },
  botonXIzquierda: { position: 'absolute', left: 0 },
  tituloCentrado: { textAlign: 'center' },
  botonQuitarFiltrosModal: { marginTop: spacing.xl },
  botonCerrarFiltros: { marginTop: spacing.sm },
  filaAccionesBusqueda: { flexDirection: 'row', justifyContent: 'center', marginTop: spacing.md },
  botonFiltros: { paddingHorizontal: spacing.xl, minWidth: 180 },
  botonFiltrosWrap: { position: 'relative' },
  badgeFiltros: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: colors.mint,
    borderRadius: radii.pill,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  badgeFiltrosTexto: { color: colors.textOnDark, fontSize: 11, fontWeight: '700' },
  textoMedidor: { fontSize: 14, color: colors.textPrimary, marginTop: spacing.md, lineHeight: 20 },
  botonMedir: { marginTop: spacing.lg },
  resultadoMedidor: {
    marginTop: spacing.lg,
    backgroundColor: colors.badgeSembradoBg,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  luxTexto: { fontSize: 28, fontWeight: '700', color: colors.badgeSembradoText },
  nivelTexto: { fontSize: 14, fontWeight: '600', color: colors.textPrimary, marginTop: spacing.xs },
  ejemplosTexto: { fontSize: 13, color: colors.textSecondary, marginTop: spacing.xs, lineHeight: 18 },
  botonVerPlantas: { marginTop: spacing.md },
  referenciaFila: {
    marginTop: spacing.md,
    backgroundColor: colors.badgeNeutroBg,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  referenciaTexto: { fontSize: 14, color: colors.textPrimary, lineHeight: 20 },
  referenciaNivel: { fontSize: 13, fontWeight: '700', color: colors.mintDark, marginTop: spacing.xs },
  botonCerrarMedidor: { marginTop: spacing.xl },
});
