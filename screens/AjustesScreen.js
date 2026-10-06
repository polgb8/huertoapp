// ============================================================
// screens/AjustesScreen.js — Cuenta, clave de Gemini y ubicación.
// Todo lo que cada usuario debe poder configurar en SU móvil.
// ============================================================

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Linking, Alert, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { colors, spacing, radii } from '../theme';
import { Card, BotonPrimario, BotonSecundario, CampoTexto, IconoCaja, SelectorChips, Hero } from '../components/UI';
import { TarjetaUsoGratis, useUsoGratis } from '../components/UsoGratis';
import { guardarPreferenciasAvisos, PREFS_AVISOS_DEFECTO } from '../ajustes';
import { normalizarHora, textoHora } from '../avisosHuerto';
import { programarRecordatorio } from '../notificaciones';
import { supabase } from '../supabase';
import { useAppStore } from '../store';
import { refrescarUbicacion } from '../ubicacion';
import { vaciarColaPendiente } from '../colaOffline';
import { cancelarTodosLosAvisos } from '../notificaciones';
import { esAdmin } from '../admin';
import {
  leerClaveGeminiGuardada,
  guardarClaveGemini,
  borrarClaveGemini,
  claveGeminiPareceValida,
  verificarClaveGemini,
} from '../claveGemini';

// Cierra sesión y borra los datos locales de este móvil (claves
// "huertoapp:*": clave Gemini, respaldos, preferencias) para que otra
// persona que use el mismo móvil no herede nada.
export async function cerrarSesionYLimpiar() {
  try {
    await supabase.auth.signOut();
  } catch (e) {
    console.log('Error al cerrar sesión (no bloqueante):', e?.message);
  }
  try {
    await vaciarColaPendiente();
  } catch (e) {
    // la cola pendiente no debe bloquear el cierre de sesión
  }
  await cancelarTodosLosAvisos();
  // Estado en memoria de la cuenta anterior (ubicación, clima, zona...).
  useAppStore.setState({
    coords: null,
    clima: null,
    zonaClimatica: 'mediterranea',
    sueloHuerto: null,
    ultimoDiagnostico: null,
    prefsAvisos: { ...PREFS_AVISOS_DEFECTO },
  });
  try {
    const claves = await AsyncStorage.getAllKeys();
    const propias = claves.filter((k) => k.startsWith('huertoapp:'));
    if (propias.length) await AsyncStorage.multiRemove(propias);
  } catch (e) {
    console.log('No se pudieron limpiar los datos locales (no bloqueante):', e?.message);
  }
}

// Cabecera de cada bloque de Ajustes: icono + título + descripción.
function Cabecera({ icono, fondo, titulo, texto }) {
  return (
    <View style={estilos.cabecera}>
      <IconoCaja icono={icono} fondo={fondo} tamano={42} />
      <View style={estilos.cabeceraTextos}>
        <Text style={estilos.cabeceraTitulo}>{titulo}</Text>
        {!!texto && <Text style={estilos.cabeceraTexto}>{texto}</Text>}
      </View>
    </View>
  );
}

const HORAS_RAPIDAS = [
  { h: 7, m: 0 },
  { h: 8, m: 0 },
  { h: 9, m: 0 },
  { h: 19, m: 0 },
  { h: 20, m: 0 },
  { h: 21, m: 0 },
];

export default function AjustesScreen({ email }) {
  const coords = useAppStore((s) => s.coords);
  const setCoords = useAppStore((s) => s.setCoords);
  const prefsAvisos = useAppStore((s) => s.prefsAvisos);
  const setPrefsAvisos = useAppStore((s) => s.setPrefsAvisos);
  const uso = useUsoGratis();

  const [clave, setClave] = useState('');
  const [claveGuardada, setClaveGuardada] = useState(false);
  const [msgClave, setMsgClave] = useState(null);
  const [comprobandoClave, setComprobandoClave] = useState(false);
  const [buscandoUbicacion, setBuscandoUbicacion] = useState(false);
  const [msgUbicacion, setMsgUbicacion] = useState(null);
  const [msgAvisos, setMsgAvisos] = useState(null);

  useEffect(() => {
    leerClaveGeminiGuardada().then((k) => setClaveGuardada(!!k));
  }, []);

  // --- Recordatorios ---
  const cambiarAvisos = useCallback(
    (cambios) => {
      const nuevas = { ...useAppStore.getState().prefsAvisos, ...cambios };
      setPrefsAvisos(nuevas);
      guardarPreferenciasAvisos(nuevas);
      setMsgAvisos(null);
    },
    [setPrefsAvisos]
  );
  const { hora, minuto } = normalizarHora(prefsAvisos);
  const moverHora = useCallback(
    (deltaMin) => {
      const total = (((hora * 60 + minuto + deltaMin) % 1440) + 1440) % 1440;
      cambiarAvisos({ hora: Math.floor(total / 60), minuto: total % 60 });
    },
    [hora, minuto, cambiarAvisos]
  );
  const probarRecordatorio = useCallback(async () => {
    const id = await programarRecordatorio({
      titulo: '💧 Prueba de recordatorio',
      cuerpo: `Así te llegarán los avisos de riego (cada día a las ${textoHora(prefsAvisos)}).`,
      fecha: new Date(Date.now() + 60 * 1000),
    });
    setMsgAvisos(
      id
        ? '✅ Programado: te llegará una notificación en 1 minuto (aunque cierres la app).'
        : '⚠️ No se pudo programar. Activa las notificaciones de HuertoApp en Ajustes del móvil.'
    );
  }, [prefsAvisos]);

  // --- Clave Gemini ---
  const guardarClave = useCallback(async () => {
    if (!claveGeminiPareceValida(clave)) {
      setMsgClave('Esa clave no parece válida. Cópiala entera, sin espacios.');
      return;
    }
    setComprobandoClave(true);
    setMsgClave(null);
    try {
      const estado = await verificarClaveGemini(clave);
      if (estado === 'invalida') {
        setMsgClave('Google dice que esa clave no es válida. Cópiala de nuevo desde aistudio.google.com/apikey.');
        return;
      }
      const ok = await guardarClaveGemini(clave);
      if (!ok) {
        setMsgClave('No se pudo guardar. Inténtalo de nuevo.');
        return;
      }
      setMsgClave(
        estado === 'ok'
          ? 'Clave comprobada y guardada en este móvil. ✅'
          : 'Clave guardada. No se ha podido comprobar ahora (sin conexión): se usará cuando vuelva la red.'
      );
      setClave('');
      setClaveGuardada(true);
    } finally {
      setComprobandoClave(false);
    }
  }, [clave]);

  const quitarClave = useCallback(async () => {
    await borrarClaveGemini();
    setClaveGuardada(false);
    setMsgClave('Clave eliminada de este móvil.');
  }, []);

  // --- Ubicación ---
  const actualizarUbicacion = useCallback(async () => {
    setBuscandoUbicacion(true);
    setMsgUbicacion(null);
    try {
      const { coords: nuevas, denegado } = await refrescarUbicacion();
      if (nuevas) {
        setCoords(nuevas);
        setMsgUbicacion('Ubicación guardada. ✅');
      } else if (denegado) {
        setMsgUbicacion('Permiso denegado. Actívalo en los ajustes de Android para esta app.');
      } else {
        setMsgUbicacion('No se pudo obtener la ubicación. Prueba al aire libre o con el GPS activado.');
      }
    } finally {
      setBuscandoUbicacion(false);
    }
  }, [setCoords]);

  const salir = useCallback(() => {
    Alert.alert(
      'Cerrar sesión',
      'Se borrarán de este móvil la clave de Gemini y las preferencias locales. Tus datos siguen guardados en tu cuenta.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Cerrar sesión', style: 'destructive', onPress: () => cerrarSesionYLimpiar() },
      ]
    );
  }, []);

  const inicial = (email || '?').trim().charAt(0).toUpperCase();

  return (
    <ScrollView style={estilos.contenedor} contentContainerStyle={estilos.contenido} keyboardShouldPersistTaps="handled">
      <Hero saludo="Tu cuenta" titulo="Ajustes" decoracion="⚙️">
        <View style={estilos.cuentaFila}>
          <View style={estilos.avatar}>
            <Text style={estilos.avatarTexto}>{inicial}</Text>
          </View>
          <Text style={estilos.cuentaEmail} numberOfLines={1}>
            {email || 'Sesión iniciada'}
          </Text>
        </View>
      </Hero>

      {/* Recordatorios */}
      <Card style={estilos.tarjeta}>
        <Cabecera
          icono="🔔"
          fondo={colors.aguaSoft}
          titulo="Recordatorios"
          texto="Avisos en el móvil aunque la app esté cerrada, a la hora que elijas."
        />
        <SelectorChips
          testIDPrefix="avisos"
          opciones={[
            { clave: 'riego', etiqueta: `💧 Riego ${prefsAvisos?.riego !== false ? '✓' : '✕'}` },
            { clave: 'poda', etiqueta: `✂️ Poda ${prefsAvisos?.poda !== false ? '✓' : '✕'}` },
          ]}
          valor={null}
          onSeleccionar={(k) => cambiarAvisos({ [k]: prefsAvisos?.[k] === false })}
          style={estilos.bloque}
        />
        <Text style={estilos.etiqueta}>Hora del aviso</Text>
        <View style={estilos.reloj}>
          <TouchableOpacity accessibilityLabel="Retrasar 15 minutos" onPress={() => moverHora(-15)} style={estilos.relojBoton} testID="hora-menos">
            <Text style={estilos.relojBotonTexto}>−</Text>
          </TouchableOpacity>
          <View style={estilos.relojCentro}>
            <Text style={estilos.relojHora} testID="hora-avisos">
              {textoHora(prefsAvisos)}
            </Text>
            <Text style={estilos.relojNota}>cada día</Text>
          </View>
          <TouchableOpacity accessibilityLabel="Adelantar 15 minutos" onPress={() => moverHora(15)} style={estilos.relojBoton} testID="hora-mas">
            <Text style={estilos.relojBotonTexto}>+</Text>
          </TouchableOpacity>
        </View>
        <View style={estilos.horasRapidas}>
          <TouchableOpacity onPress={() => moverHora(-60)} style={estilos.chipHora}>
            <Text style={estilos.chipHoraTexto}>−1 h</Text>
          </TouchableOpacity>
          {HORAS_RAPIDAS.map(({ h, m }) => {
            const activa = h === hora && m === minuto;
            return (
              <TouchableOpacity
                key={`${h}:${m}`}
                testID={`hora-rapida-${h}`}
                onPress={() => cambiarAvisos({ hora: h, minuto: m })}
                style={[estilos.chipHora, activa && estilos.chipHoraActiva]}
              >
                <Text style={[estilos.chipHoraTexto, activa && estilos.chipHoraTextoActiva]}>{`${h}:00`}</Text>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity onPress={() => moverHora(60)} style={estilos.chipHora}>
            <Text style={estilos.chipHoraTexto}>+1 h</Text>
          </TouchableOpacity>
        </View>
        <Text style={estilos.texto}>
          Los días que toque regar te avisaremos a las {textoHora(prefsAvisos)}. El aviso de poda llega el primer día de su época, a la misma hora.
        </Text>
        <BotonSecundario titulo="Probar: aviso dentro de 1 minuto" icono="🧪" onPress={probarRecordatorio} style={estilos.boton} />
        {!!msgAvisos && <Text style={estilos.mensaje}>{msgAvisos}</Text>}
      </Card>

      {/* Clave de Gemini */}
      <Card style={estilos.tarjeta}>
        <Cabecera
          icono="🤖"
          fondo={colors.pendienteSoft}
          titulo="Clave de Gemini"
          texto="El análisis de fotos y el asistente usan Gemini con TU clave personal y gratuita de Google AI Studio."
        />
        <View style={[estilos.estadoClave, { backgroundColor: claveGuardada ? colors.accentSoftBg : '#FFF7ED' }]}>
          <Text style={[estilos.estadoClaveTexto, { color: claveGuardada ? colors.mintDark : colors.warning }]}>
            {claveGuardada ? '✅ Clave guardada en este móvil' : '⚠️ Todavía no has añadido tu clave'}
          </Text>
        </View>
        <CampoTexto
          etiqueta={claveGuardada ? 'Sustituir clave' : 'Pega tu clave'}
          placeholder="AIza..."
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          value={clave}
          onChangeText={setClave}
          style={estilos.bloque}
        />
        {!!msgClave && <Text style={estilos.mensaje}>{msgClave}</Text>}
        <BotonPrimario titulo="Guardar clave" onPress={guardarClave} cargando={comprobandoClave} style={estilos.boton} />
        <View style={estilos.fila}>
          <BotonSecundario
            titulo="Conseguir clave gratis"
            onPress={() => Linking.openURL('https://aistudio.google.com/apikey').catch(() => {})}
            style={estilos.botonFila}
          />
          {claveGuardada && <BotonSecundario titulo="Quitar clave" onPress={quitarClave} style={estilos.botonFila} />}
        </View>
      </Card>

      {/* Uso gratuito */}
      {esAdmin(email) && (
        <>
          <View style={estilos.tituloBloque}>
            <IconoCaja icono="📊" fondo={colors.podaSoft} tamano={34} />
            <Text style={estilos.tituloBloqueTexto}>Uso del plan gratuito</Text>
          </View>
          <TarjetaUsoGratis gemini={uso.gemini} supa={uso.supa} style={estilos.tarjeta} />
        </>
      )}

      {/* Ubicación */}
      <Card style={estilos.tarjeta}>
        <Cabecera
          icono="📍"
          fondo={colors.tierraSoft}
          titulo="Ubicación del huerto"
          texto="Para el clima, el riego y los cultivos de temporada. Se guarda solo en este móvil."
        />
        <Text style={estilos.texto}>
          {coords ? `Guardada: ${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)}` : 'Aún no hay ubicación guardada.'}
        </Text>
        {!!msgUbicacion && <Text style={estilos.mensaje}>{msgUbicacion}</Text>}
        <BotonPrimario
          titulo={coords ? 'Actualizar ubicación' : 'Usar mi ubicación'}
          icono="📍"
          onPress={actualizarUbicacion}
          cargando={buscandoUbicacion}
          style={estilos.boton}
        />
      </Card>

      <BotonSecundario titulo="Cerrar sesión" icono="🚪" onPress={salir} style={estilos.botonSalir} />
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  contenedor: { flex: 1, backgroundColor: colors.background },
  contenido: { padding: spacing.md, paddingBottom: 120 },
  tarjeta: { marginTop: spacing.md },
  cabecera: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cabeceraTextos: { flex: 1 },
  cabeceraTitulo: { fontSize: 18, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.2 },
  cabeceraTexto: { fontSize: 13, color: colors.textSecondary, marginTop: 2, lineHeight: 18 },
  cuentaFila: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  avatarTexto: { color: '#fff', fontSize: 18, fontWeight: '800' },
  cuentaEmail: { color: colors.textOnDark, fontSize: 15, fontWeight: '700', flex: 1 },
  bloque: { marginTop: spacing.md },
  etiqueta: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginTop: spacing.md },
  reloj: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    backgroundColor: colors.aguaSoft,
    borderRadius: radii.lg,
    padding: spacing.sm,
  },
  relojBoton: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  relojBotonTexto: { fontSize: 26, fontWeight: '800', color: colors.agua },
  relojCentro: { alignItems: 'center' },
  relojHora: { fontSize: 40, fontWeight: '800', color: colors.agua, letterSpacing: 1 },
  relojNota: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  horasRapidas: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  chipHora: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
  chipHoraActiva: { backgroundColor: colors.agua, borderColor: colors.agua },
  chipHoraTexto: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  chipHoraTextoActiva: { color: '#fff' },
  texto: { fontSize: 14, color: colors.textSecondary, marginTop: spacing.sm, lineHeight: 20 },
  mensaje: { fontSize: 13, color: colors.textPrimary, marginTop: spacing.sm, fontWeight: '600' },
  estadoClave: { marginTop: spacing.md, borderRadius: radii.md, paddingVertical: 8, paddingHorizontal: 12 },
  estadoClaveTexto: { fontSize: 13, fontWeight: '800' },
  boton: { marginTop: spacing.md },
  fila: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  botonFila: { flex: 1 },
  tituloBloque: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: spacing.lg },
  tituloBloqueTexto: { fontSize: 19, fontWeight: '800', color: colors.textPrimary },
  botonSalir: { marginTop: spacing.lg },
});
