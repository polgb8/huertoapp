// ============================================================
// screens/GardenScreen.js — "Mi huerto": pantalla única que reúne todo
// lo que antes vivía repartido entre dos pestañas ("Tu huerto" +
// "Mi huerto"), porque para Pol son la misma cosa: el estado de su
// huerto hoy. De arriba a abajo:
//   - Riego de hoy (recomendación real y por cultivo, ver riego.js)
//   - Alertas estacionales de poda (con acceso directo a Escanear)
//   - Tareas pendientes (protocolo de saneamiento post-cosecha, etc.)
//   - Formulario "Añadir cultivo que ya tengo" (con zona y origen)
//   - Dashboard de cultivos activos agrupados por zona + historial
//
// Sin login (ver App.js/store.js): no hay icono de "Compartir huerto" en
// la cabecera — la app se usa desde varios móviles a la vez sin cuenta,
// viendo todos el mismo huerto.
// ============================================================

import React, { useState, useCallback, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, SectionList, TouchableOpacity, Alert, RefreshControl, Modal, ScrollView } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Image } from 'expo-image';

import { colors, spacing, tipografia, radii } from '../theme';
import { Card, Badge, BarraProgreso, BotonPrimario, BotonSecundario, BotonX, CampoTexto, SelectorChips, Hero, StatHero, TituloSeccion, TarjetaAviso, Pastilla, ToastDeshacer } from '../components/UI';
import AutocompletarPlanta from '../components/AutocompletarPlanta';
import {
  listarCultivosHuerto,
  marcarCultivoComoCosechado,
  marcarCultivoComoPerdido,
  eliminarCultivoDefinitivamente,
  eliminarFotoCultivo,
  crearTareaSaneamiento,
  insertarCultivo,
  insertarDiagnostico,
  actualizarCultivo,
  subirFotoCultivo,
  marcarCultivoPodado,
  marcarCultivoRegado,
  listarDiagnosticosPorCultivo,
  listarTareasPendientes,
  marcarTareaCompletada,
} from '../supabase';
import { calcularBalanceHidrico } from '../clima';
import { calcularRecomendacionesRiego, calcularRiegoOrientativo, TIPOS_CON_TAMANO } from '../riego';
import { calcularAlertasPoda } from '../poda';
import { programarAvisosHuerto, textoHora } from '../avisosHuerto';
import { refrescarUbicacion } from '../ubicacion';
import { ZONAS_CLIMATICAS, guardarZonaClimatica, guardarPreferenciasAvisos, TIPOS_SUELO, PRUEBA_SUELO, guardarSueloHuerto } from '../ajustes';
import { deshacerMarca } from '../acciones';
import { listarCosechas, registrarCosecha, resumenCosechasAnio } from '../cosechas';
import { analizarFotoPlanta } from '../estimarPlanta';
import { edadEnAnios } from '../riego';
import { enviarNotificacionPrueba } from '../notificaciones';
import { aplicarMarcasLocales, guardarMarcaLocal } from '../registroLocal';
import { calcularProgreso, mensajeDeError, normalizarBusqueda } from '../utils';
import { CATALOGO_PLANTAS } from '../catalogoPlantas';
import { useAppStore } from '../store';

const SIN_ZONA = 'Sin zona asignada';

// Mismos iconos que MODOS en ScanScreen.js (no se importa de allí para
// no acoplar GardenScreen a la pantalla de Escanear por un detalle visual).
const ICONOS_MODO = { plagas: '🐛', poda: '✂️', cosecha: '🍅' };

// Convierte "hace cuántos días lo plantaste" (0 = hoy) en la fecha ISO
// real de siembra, para que la barra de progreso hacia la cosecha sea
// correcta desde el primer momento en vez de asumir que se planta hoy.
function fechaSiembraDesdeDiasAtras(diasAtrasTexto) {
  const dias = Math.max(0, parseInt(diasAtrasTexto, 10) || 0);
  const fecha = new Date();
  fecha.setDate(fecha.getDate() - dias);
  return fecha.toISOString();
}

// Días de ventaja orientativos de un cultivo "comprado y trasplantado"
// frente a uno sembrado por semilla (edad típica de una planta joven de
// vivero/semillero en el momento de trasplantarla). Es solo una
// sugerencia inicial editable por el usuario en "¿Hace cuántos días lo
// plantaste?": si Pol sabe el dato real, lo cambia; si no, esto evita
// que se le olvide contar la ventaja del trasplante.
const DIAS_VENTAJA_TRASPLANTE = '14';

// Atajos para "¿Hace cuánto lo plantaste?" (escribir 400 días a mano es
// incómodo; con esto basta un toque).
const ATAJOS_DIAS_ATRAS = [
  { clave: '0', etiqueta: 'Hoy' },
  { clave: '7', etiqueta: '1 semana' },
  { clave: '30', etiqueta: '1 mes' },
  { clave: '90', etiqueta: '3 meses' },
  { clave: '180', etiqueta: '6 meses' },
  { clave: '365', etiqueta: '1 año' },
];

const OPCIONES_ORIGEN = [
  { clave: 'semilla', etiqueta: '🌱 Semilla' },
  { clave: 'trasplante', etiqueta: '🪴 Comprado y trasplantado' },
  { clave: 'establecida', etiqueta: '🌳 Ya plantado' },
];

const OPCIONES_TAMANO = [
  { clave: 'pequeno', etiqueta: '🌱 Pequeño / joven' },
  { clave: 'mediano', etiqueta: '🌿 Mediano' },
  { clave: 'grande', etiqueta: '🌳 Grande / adulto' },
];

function saludoSegunHora(fecha = new Date()) {
  const h = fecha.getHours();
  if (h < 6) return 'Buenas noches 🌙';
  if (h < 13) return 'Buenos días ☀️';
  if (h < 21) return 'Buenas tardes 🌤️';
  return 'Buenas noches 🌙';
}

const ETIQUETA_ORIGEN = {
  semilla: '🌱 Desde semilla',
  trasplante: '🪴 Comprado y trasplantado',
  establecida: '🌳 Ya plantado',
};

// Especie del catálogo por nombre (exacto primero, luego parcial).
function buscarEspecie(nombre, catalogoPlano) {
  const buscado = normalizarBusqueda(nombre).trim();
  if (!buscado) return null;
  const exacta = catalogoPlano.find((p) => normalizarBusqueda(p.nombre) === buscado);
  if (exacta) return exacta;
  return (
    catalogoPlano.find((p) => {
      const n = normalizarBusqueda(p.nombre);
      return n.includes(buscado) || buscado.includes(n);
    }) || null
  );
}

function formatearFechaCorta(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function GardenScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const coords = useAppStore((s) => s.coords);
  const setCoords = useAppStore((s) => s.setCoords);
  const zonaClimatica = useAppStore((s) => s.zonaClimatica) || 'mediterranea';
  const setZonaClimatica = useAppStore((s) => s.setZonaClimatica);
  const [ajustesVisible, setAjustesVisible] = useState(false);
  const [buscandoUbicacion, setBuscandoUbicacion] = useState(false);
  const [avisoUbicacion, setAvisoUbicacion] = useState(null);
  const conectado = useAppStore((s) => s.conectado) !== false;
  const sueloHuerto = useAppStore((s) => s.sueloHuerto) || null;
  const setSueloHuerto = useAppStore((s) => s.setSueloHuerto);
  const opcionesRiego = useMemo(() => ({ suelo: sueloHuerto }), [sueloHuerto]);
  const [avisoDeshacer, setAvisoDeshacer] = useState(null);
  // Cosechas de perennes (v16).
  const [cosechas, setCosechas] = useState([]);
  const [cosechaCultivo, setCosechaCultivo] = useState(null);
  const [cosechaKg, setCosechaKg] = useState('');
  const [cosechaNota, setCosechaNota] = useState('');
  const [cosechaError, setCosechaError] = useState(null);
  const [guardandoCosecha, setGuardandoCosecha] = useState(false);
  // Preferencias de notificaciones (ajustes.js).
  // v17: compartidas en el store (se editan también en Ajustes).
  const prefsAvisos = useAppStore((st) => st.prefsAvisos);
  const setPrefsAvisos = useAppStore((st) => st.setPrefsAvisos);
  const [avisoPrueba, setAvisoPrueba] = useState(null);
  const cambiarPrefsAvisos = useCallback(
    (cambios) => {
      const nuevas = { ...useAppStore.getState().prefsAvisos, ...cambios };
      setPrefsAvisos(nuevas);
      guardarPreferenciasAvisos(nuevas);
    },
    [setPrefsAvisos]
  );

  // --- Cultivos (dashboard) ---
  const [cultivos, setCultivos] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [actualizandoId, setActualizandoId] = useState(null);
  // Historial (cosechados/perdidos) empieza oculto: la vista principal
  // muestra solo lo activo, que es lo que casi siempre se quiere ver.
  const [historialVisible, setHistorialVisible] = useState(false);

  // --- Panel superior (riego de hoy + alertas de poda + tareas) ---
  const [balance, setBalance] = useState(null);
  const [cargandoBalance, setCargandoBalance] = useState(false);
  const [tareas, setTareas] = useState([]);
  const [podaActualizando, setPodaActualizando] = useState(null);
  const [regandoId, setRegandoId] = useState(null);
  // Historial de diagnósticos de UN cultivo (ver "Historial" en el menú
  // "..." de cada tarjeta): se carga bajo demanda, no de golpe para
  // todos los cultivos, para no multiplicar peticiones a Supabase.
  const [historialDiagVisible, setHistorialDiagVisible] = useState(false);
  const [historialDiagCultivo, setHistorialDiagCultivo] = useState(null);
  const [historialDiagLista, setHistorialDiagLista] = useState([]);
  const [historialDiagCargando, setHistorialDiagCargando] = useState(false);
  const [historialDiagError, setHistorialDiagError] = useState(null);
  const [cargandoPanel, setCargandoPanel] = useState(false);
  const [errorPanel, setErrorPanel] = useState(null);
  const [tareaActualizando, setTareaActualizando] = useState(null);

  // --- Formulario "Añadir cultivo que ya tengo" ---
  const [formularioVisible, setFormularioVisible] = useState(false);
  const [guardandoManual, setGuardandoManual] = useState(false);
  const [errorManual, setErrorManual] = useState(null);
  const [campoNombre, setCampoNombre] = useState('');
  const [campoVariedad, setCampoVariedad] = useState('');
  const [campoZona, setCampoZona] = useState('');
  const [campoDiasCosecha, setCampoDiasCosecha] = useState('60');
  const [campoDiasAtras, setCampoDiasAtras] = useState('0');
  const [campoOrigen, setCampoOrigen] = useState('semilla'); // 'semilla' | 'trasplante'
  const [campoCantidad, setCampoCantidad] = useState('1');
  const [campoTamano, setCampoTamano] = useState('mediano');
  // Estimación por IA desde la foto (v15): tamaño, copa y edad.
  const [campoDiametro, setCampoDiametro] = useState(null);
  const [campoEdad, setCampoEdad] = useState('');
  const [campoSuelo, setCampoSuelo] = useState(null);
  const [estimacionAlta, setEstimacionAlta] = useState(null); // {cargando, datos, error}
  const [campoImagenUri, setCampoImagenUri] = useState(null);
  const [campoImagenBase64, setCampoImagenBase64] = useState(null);
  const [subiendoImagen, setSubiendoImagen] = useState(false);

  // --- Menú "..." (Editar/Quitar) y modal de edición de un cultivo ---
  const [edicionVisible, setEdicionVisible] = useState(false);
  const [cultivoEditando, setCultivoEditando] = useState(null);
  const [editVariedad, setEditVariedad] = useState('');
  const [editZona, setEditZona] = useState('');
  const [editCantidad, setEditCantidad] = useState('1');
  const [editDiasCosecha, setEditDiasCosecha] = useState('60');
  const [editOrigen, setEditOrigen] = useState('semilla');
  const [editTamano, setEditTamano] = useState('mediano');
  const [editDiametro, setEditDiametro] = useState(null);
  const [editEdad, setEditEdad] = useState('');
  const [estimacionEdicion, setEstimacionEdicion] = useState(null);
  const [editImagenUri, setEditImagenUri] = useState(null);
  const [editImagenBase64, setEditImagenBase64] = useState(null);
  const [editImagenUrlActual, setEditImagenUrlActual] = useState(null);
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);
  const [errorEdicion, setErrorEdicion] = useState(null);

  const isMountedRef = useRef(true);
  // No se reprograman avisos hasta tener los cultivos reales cargados
  // (evita cancelar todo con la lista vacía del primer render).
  const cargadoUnaVezRef = useRef(false);
  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Todas las plantas del catálogo en una única lista plana (nombre +
  // días de cosecha + tipo/método de riego), para el autocompletado del
  // formulario manual y para la recomendación de riego por cultivo.
  const plantasCatalogoPlano = useMemo(
    () => CATALOGO_PLANTAS.flatMap((categoria) => categoria.plantas),
    []
  );

  // Emoji por nombre de especie (para la miniatura de cada cultivo
  // cuando no tiene foto propia — ver imagen_url en el catálogo/BD).
  const emojiPorNombre = useMemo(() => {
    const mapa = new Map();
    plantasCatalogoPlano.forEach((p) => {
      if (p.nombre && p.emoji) mapa.set(p.nombre, p.emoji);
    });
    return mapa;
  }, [plantasCatalogoPlano]);

  // Selecciona una foto de la galería y la comprime/redimensiona igual
  // que ScanScreen (ver ImageManipulator ahí): evita subir fotos de
  // varios MB a Storage por una simple miniatura de cultivo. Devuelve
  // null si el usuario cancela el selector o algo falla (no bloqueante:
  // la foto es siempre opcional, con el emoji como respaldo).
  // fuente: 'camara' (hacer la foto en el momento) | 'galeria'.
  const seleccionarYComprimirImagen = useCallback(async (fuente = 'galeria') => {
    try {
      const opciones = { mediaTypes: ['images'], quality: 0.6, allowsEditing: true, aspect: [1, 1] };
      let resultado;
      if (fuente === 'camara') {
        const permiso = await ImagePicker.requestCameraPermissionsAsync();
        if (!permiso?.granted) {
          Alert.alert('Permiso de cámara', 'Activa el permiso de cámara de HuertoApp en los ajustes del móvil para hacer la foto.');
          return null;
        }
        resultado = await ImagePicker.launchCameraAsync(opciones);
      } else {
        resultado = await ImagePicker.launchImageLibraryAsync(opciones);
      }
      if (resultado.canceled || !resultado.assets?.[0]?.uri) return null;
      const manipulada = await ImageManipulator.manipulateAsync(
        resultado.assets[0].uri,
        [{ resize: { width: 600 } }],
        { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      return { uri: manipulada.uri, base64: manipulada.base64 };
    } catch (e) {
      console.log('No se pudo seleccionar la imagen (no bloqueante):', e?.message);
      return null;
    }
  }, []);

  // ------------------------------------------------------------
  // Carga de datos
  // ------------------------------------------------------------
  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorMsg(null);
    try {
      const datos = await aplicarMarcasLocales(await listarCultivosHuerto());
      if (isMountedRef.current) {
        setCultivos(datos);
        cargadoUnaVezRef.current = true;
      }
    } catch (e) {
      console.log('Error al listar cultivos:', e?.message);
      if (isMountedRef.current) setErrorMsg(mensajeDeError(e));
    } finally {
      if (isMountedRef.current) setCargando(false);
    }
  }, []);

  const cargarPanel = useCallback(async () => {
    setCargandoPanel(true);
    setErrorPanel(null);
    try {
      // Las alertas de poda YA NO se piden aquí: se calculan localmente
      // (ver alertasPoda más abajo) a partir de `cultivos` + el catálogo,
      // cruzando cada árbol/seto REAL con su intervalo de poda — sin
      // necesitar una consulta aparte a Supabase.
      const pendientes = await listarTareasPendientes().catch(() => []);
      if (!isMountedRef.current) return;
      setTareas(pendientes);
    } catch (e) {
      console.log('Error al cargar el panel del huerto:', e?.message);
      if (isMountedRef.current) setErrorPanel(mensajeDeError(e));
    } finally {
      if (isMountedRef.current) setCargandoPanel(false);
    }
  }, []);

  const cargarBalance = useCallback(async () => {
    if (!coords) return;
    setCargandoBalance(true);
    try {
      const valor = await calcularBalanceHidrico(coords.lat, coords.lon);
      if (isMountedRef.current) setBalance(valor);
    } finally {
      if (isMountedRef.current) setCargandoBalance(false);
    }
  }, [coords]);

  // Recarga TODO cada vez que la pestaña recupera el foco: el dashboard
  // de cultivos, las alertas de poda/tareas y el balance de riego.
  useFocusEffect(
    useCallback(() => {
      cargar();
      cargarPanel();
      cargarBalance();
    }, [cargar, cargarPanel, cargarBalance])
  );

  const completarTarea = useCallback(async (tarea) => {
    setTareaActualizando(tarea.id);
    try {
      await marcarTareaCompletada(tarea.id);
      if (isMountedRef.current) {
        setTareas((prev) => prev.filter((t) => t.id !== tarea.id));
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      console.log('Error al completar tarea:', e?.message);
      if (isMountedRef.current) setErrorPanel(mensajeDeError(e));
    } finally {
      if (isMountedRef.current) setTareaActualizando(null);
    }
  }, []);

  // Protocolo de Saneamiento Post-Cosecha: al marcar un cultivo como
  // cosechado, se genera automáticamente una tarea con los pasos
  // tradicionales de profilaxis de suelo (visible aquí arriba, en
  // "Tareas pendientes"). Si la creación de la tarea fallara, no
  // revertimos el cosechado: el dato principal (el cultivo ya está
  // cosechado) es más importante que el recordatorio, que es un extra.
  const marcarCosechado = useCallback(async (item) => {
    setActualizandoId(item.id);
    try {
      await marcarCultivoComoCosechado(item.id);
      setCultivos((prev) => prev.map((c) => (c.id === item.id ? { ...c, estado: 'cosechado' } : c)));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

      crearTareaSaneamiento({ cultivoId: item.id, nombreCultivo: item.nombre }).catch((e) => {
        console.log('No se pudo crear la tarea de saneamiento (no bloqueante):', e?.message);
      });
    } catch (e) {
      console.log('Error al marcar como cosechado:', e?.message);
      setErrorMsg(mensajeDeError(e));
    } finally {
      setActualizandoId(null);
    }
  }, []);

  // "Quitar" un cultivo activo: puede haberse muerto/perdido (se guarda
  // como historial, cuenta para la memoria de rotación de Planificador)
  // o haberse añadido por error (se borra del todo). Se pregunta con un
  // Alert nativo porque es una acción que no tiene deshacer sencillo.
  const quitarCultivo = useCallback(async (item, modo) => {
    setActualizandoId(item.id);
    try {
      if (modo === 'perdido') {
        await marcarCultivoComoPerdido(item.id);
        setCultivos((prev) => prev.map((c) => (c.id === item.id ? { ...c, estado: 'perdido' } : c)));
      } else {
        await eliminarCultivoDefinitivamente(item.id);
        setCultivos((prev) => prev.filter((c) => c.id !== item.id));
        // Best-effort, sin bloquear el borrado en sí: la fila ya se ha
        // eliminado igualmente aunque esto falle.
        if (item.imagen_url) eliminarFotoCultivo(item.imagen_url);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      console.log('Error al quitar cultivo:', e?.message);
      setErrorMsg(mensajeDeError(e));
    } finally {
      setActualizandoId(null);
    }
  }, []);

  const confirmarQuitar = useCallback(
    (item) => {
      Alert.alert(
        `Quitar "${item.nombre}"`,
        'Si se ha muerto o perdido, guarda el historial (cuenta para no repetir familia en Planificador). Si la añadiste por error, elimínala del todo.',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Se ha perdido', onPress: () => quitarCultivo(item, 'perdido') },
          { text: 'Eliminar del todo', style: 'destructive', onPress: () => quitarCultivo(item, 'eliminar') },
        ]
      );
    },
    [quitarCultivo]
  );

  // Limpieza de una fila ya resuelta (cosechada/perdida) del historial:
  // aquí no hay ambigüedad de "por qué", así que un único Alert basta.
  const confirmarEliminarDelHistorial = useCallback(
    (item) => {
      Alert.alert(`Eliminar "${item.nombre}" del historial`, 'Esta acción no se puede deshacer.', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Eliminar', style: 'destructive', onPress: () => quitarCultivo(item, 'eliminar') },
      ]);
    },
    [quitarCultivo]
  );

  // ------------------------------------------------------------
  // Editar cultivo: abre un modal con variedad/zona/cantidad/días de
  // cosecha/foto, precargado con los datos actuales. Guardar llama a
  // actualizarCultivo (solo manda lo que de verdad cambia).
  // ------------------------------------------------------------
  const abrirEdicion = useCallback((item) => {
    setCultivoEditando(item);
    setEditVariedad(item.variedad || '');
    setEditZona(item.zona || '');
    setEditCantidad(String(item.cantidad || 1));
    setEditDiasCosecha(String(item.dias_cosecha || 60));
    setEditOrigen(item.origen || 'semilla');
    setEditTamano(item.tamano || 'mediano');
    setEditDiametro(item.diametro_copa ?? null);
    const edadActual = edadEnAnios(item);
    setEditEdad(edadActual != null && (item.edad_estimada || item.origen !== 'establecida') ? String(Math.round(edadActual)) : '');
    setEstimacionEdicion(null);
    setEditImagenUri(null);
    setEditImagenBase64(null);
    setEditImagenUrlActual(item.imagen_url || null);
    setErrorEdicion(null);
    setEdicionVisible(true);
  }, []);

  const cerrarEdicion = useCallback(() => {
    setEdicionVisible(false);
    setCultivoEditando(null);
  }, []);

  // ¿Merece la pena estimar con IA? Árboles/arbustos/trepadoras del
  // catálogo, o una planta aún sin nombre / fuera del catálogo.
  const convieneEstimar = useCallback(
    (nombre) => {
      const especie = buscarEspecie(nombre || '', plantasCatalogoPlano);
      return !especie || TIPOS_CON_TAMANO.includes(especie.tipo);
    },
    [plantasCatalogoPlano]
  );

  const estimarConFoto = useCallback(
    async (base64, nombre, setEstado, aplicar) => {
      // v16: se analiza siempre (especie, salud, agua, suelo…); el tamaño
      // solo se usa en leñosas (ver convieneEstimar en el formulario).
      if (!base64 || !conectado) return;
      setEstado({ cargando: true });
      try {
        const datos = await analizarFotoPlanta(base64, nombre);
        if (!isMountedRef.current) return;
        if (!datos) {
          setEstado({ error: 'No he podido estimar el tamaño con esta foto. Elige el tamaño a mano.' });
          return;
        }
        aplicar(datos);
        setEstado({ datos });
      } catch (e) {
        if (isMountedRef.current) setEstado({ error: 'Sin conexión con la IA ahora. Elige el tamaño a mano.' });
      }
    },
    [conectado, convieneEstimar]
  );

  const elegirImagenEdicion = useCallback(async (fuente) => {
    const resultado = await seleccionarYComprimirImagen(fuente);
    if (!resultado) return;
    setEditImagenUri(resultado.uri);
    setEditImagenBase64(resultado.base64);
    estimarConFoto(resultado.base64, cultivoEditando?.nombre, setEstimacionEdicion, (d) => {
      setEditTamano(d.tamano);
      setEditDiametro(d.diametroCopa);
      if (d.edadAnios != null) setEditEdad(String(d.edadAnios));
    });
  }, [seleccionarYComprimirImagen, estimarConFoto, cultivoEditando]);

  const quitarImagenEdicion = useCallback(() => {
    setEditImagenUri(null);
    setEditImagenBase64(null);
    setEditImagenUrlActual(null);
  }, []);

  const guardarEdicion = useCallback(async () => {
    if (!cultivoEditando) return;
    setGuardandoEdicion(true);
    setErrorEdicion(null);
    try {
      let imagenUrl = editImagenUrlActual;
      if (editImagenBase64) {
        try {
          imagenUrl = await subirFotoCultivo(editImagenBase64);
        } catch (e) {
          console.log('No se pudo subir la foto del cultivo (no bloqueante):', e?.message);
        }
      }
      const cambios = {
        variedad: editVariedad.trim() || null,
        zona: editZona.trim() || null,
        cantidad: editCantidad,
        dias_cosecha: Math.max(1, parseInt(editDiasCosecha, 10) || 60),
      };
      if (editTamano !== (cultivoEditando.tamano || 'mediano')) {
        cambios.tamano = editTamano;
        guardarMarcaLocal(cultivoEditando.id, 'tamano', editTamano);
      }
      if ((editDiametro ?? null) !== (cultivoEditando.diametro_copa ?? null)) {
        cambios.diametro_copa = editDiametro;
        guardarMarcaLocal(cultivoEditando.id, 'diametro_copa', editDiametro);
      }
      // Edad aproximada: se traduce a una fecha de plantación estimada.
      const edadNum = parseFloat(String(editEdad).replace(',', '.'));
      const edadPrevia = edadEnAnios(cultivoEditando);
      if (Number.isFinite(edadNum) && edadNum >= 0 && (edadPrevia == null || Math.round(edadPrevia) !== Math.round(edadNum))) {
        const fecha = new Date();
        fecha.setFullYear(fecha.getFullYear() - Math.floor(edadNum));
        fecha.setMonth(fecha.getMonth() - Math.round((edadNum % 1) * 12));
        cambios.fecha_siembra = fecha.toISOString();
        cambios.edad_estimada = true;
        guardarMarcaLocal(cultivoEditando.id, 'edad_estimada', true);
      }
      if (editOrigen !== (cultivoEditando.origen || 'semilla')) {
        cambios.origen = editOrigen;
        // Respaldo local por si la migración v4 (columna origen) no está.
        guardarMarcaLocal(cultivoEditando.id, 'origen', editOrigen);
      }
      // imagen_url solo se manda si de verdad cambió (foto nueva, o se
      // quitó la que había): así no se pisa una URL válida con la misma
      // URL de siempre en cada edición que no toca la foto.
      if (editImagenBase64 || imagenUrl !== (cultivoEditando.imagen_url || null)) {
        cambios.imagen_url = imagenUrl;
      }
      // Control de concurrencia optimista (ver supabase.js): se manda el
      // updated_at que tenía el cultivo cuando se ABRIÓ esta edición, no
      // el actual — así, si el otro móvil lo cambió mientras tanto, el
      // guardado se rechaza con un aviso claro en vez de pisar su cambio.
      await actualizarCultivo(cultivoEditando.id, { ...cambios, updatedAtEsperado: cultivoEditando.updated_at });
      // Si la foto ha cambiado de verdad (reemplazada o quitada), la
      // antigua se queda huérfana en Storage si no se borra aquí — best
      // effort, después de que el guardado en sí ya haya funcionado.
      const urlAntigua = cultivoEditando.imagen_url || null;
      if (cambios.imagen_url !== undefined && urlAntigua && urlAntigua !== imagenUrl) {
        eliminarFotoCultivo(urlAntigua);
      }
      // Optimista para que la tarjeta se sienta instantánea, PERO seguido
      // siempre de un cargar() real: sin este refetch, si Supabase
      // rechazara el guardado en silencio (p.ej. `imagen_url` con la
      // migración v5 todavía sin ejecutar), la tarjeta seguiría
      // mostrando el cambio como guardado hasta el siguiente refresco
      // natural de la pestaña — el mismo tipo de "puesto pero no
      // aplicado" que ya pasó con el riego personalizado.
      setCultivos((prev) =>
        prev.map((c) => (c.id === cultivoEditando.id ? { ...c, ...cambios, cantidad: cambios.cantidad } : c))
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      cerrarEdicion();
      cargar();
    } catch (e) {
      console.log('Error al editar cultivo:', e?.message);
      setErrorEdicion(mensajeDeError(e));
      // Ante un conflicto de concurrencia, se refresca la lista en
      // segundo plano (sin cerrar el modal: el usuario puede seguir
      // viendo/ajustando lo que estaba escribiendo) para que, en cuanto
      // cierre y vuelva a abrir la edición, vea ya los datos más
      // recientes del otro móvil en vez de los suyos desactualizados.
      if (e?.message === 'CONFLICTO_CONCURRENCIA') cargar();
    } finally {
      setGuardandoEdicion(false);
    }
  }, [cultivoEditando, editVariedad, editZona, editCantidad, editDiasCosecha, editOrigen, editImagenBase64, editImagenUrlActual, cerrarEdicion, cargar, editTamano, editDiametro, editEdad]);

  // Botón "..." de cada tarjeta: abre Editar o Quitar (petición de Pol —
  // antes solo había "Marcar como cosechado"/"Quitar" como botones fijos;
  // esto añade la vía para corregir cantidad/variedad/zona/foto de un
  // cultivo ya guardado sin tener que borrarlo y volver a añadirlo).
  // Historial de diagnósticos de un cultivo real (ver ScanScreen: al
  // guardar un diagnóstico se puede vincular opcionalmente a un cultivo
  // de "Mi huerto"). Fail-soft: si la migración v7 no se ha ejecutado
  // todavía, listarDiagnosticosPorCultivo devuelve [] sin más — el
  // modal simplemente sale vacío en vez de romper nada.
  const abrirHistorialDiagnosticos = useCallback(async (item) => {
    setHistorialDiagCultivo(item);
    setHistorialDiagVisible(true);
    setHistorialDiagCargando(true);
    setHistorialDiagError(null);
    try {
      const lista = await listarDiagnosticosPorCultivo(item.id);
      if (isMountedRef.current) setHistorialDiagLista(lista);
    } catch (e) {
      console.log('Error al cargar el historial de diagnósticos:', e?.message);
      if (isMountedRef.current) setHistorialDiagError(mensajeDeError(e));
    } finally {
      if (isMountedRef.current) setHistorialDiagCargando(false);
    }
  }, []);

  const cerrarHistorialDiagnosticos = useCallback(() => {
    setHistorialDiagVisible(false);
    setHistorialDiagCultivo(null);
    setHistorialDiagLista([]);
    setHistorialDiagError(null);
  }, []);

  const abrirOpciones = useCallback(
    (item) => {
      Alert.alert(item.nombre, '¿Qué quieres hacer con este cultivo?', [
        { text: 'Editar', onPress: () => abrirEdicion(item) },
        { text: 'Historial de diagnósticos', onPress: () => abrirHistorialDiagnosticos(item) },
        { text: 'Quitar', style: 'destructive', onPress: () => confirmarQuitar(item) },
        { text: 'Cancelar', style: 'cancel' },
      ]);
    },
    [abrirEdicion, confirmarQuitar, abrirHistorialDiagnosticos]
  );

  const limpiarFormularioManual = useCallback(() => {
    setCampoNombre('');
    setCampoVariedad('');
    setCampoZona('');
    setCampoDiasCosecha('60');
    setCampoDiasAtras('0');
    setCampoOrigen('semilla');
    setCampoCantidad('1');
    setCampoTamano('mediano');
    setCampoDiametro(null);
    setCampoEdad('');
    setCampoSuelo(null);
    setEstimacionAlta(null);
    setCampoImagenUri(null);
    setCampoImagenBase64(null);
    setErrorManual(null);
  }, []);

  const elegirImagenAlta = useCallback(async (fuente) => {
    const resultado = await seleccionarYComprimirImagen(fuente);
    if (!resultado) return;
    setCampoImagenUri(resultado.uri);
    setCampoImagenBase64(resultado.base64);
    estimarConFoto(resultado.base64, campoNombre, setEstimacionAlta, (d) => {
      if (d.tipoSuelo) setCampoSuelo(d.tipoSuelo);
      setCampoTamano(d.tamano);
      setCampoDiametro(d.diametroCopa);
      if (d.edadAnios != null) {
        setCampoEdad(String(d.edadAnios));
        if (d.edadAnios >= 1) setCampoOrigen('establecida');
      }
      // Sin nombre todavía: se propone la especie que ve la IA.
      if (!campoNombre.trim() && d.especieProbable) {
        const enCatalogo = buscarEspecie(d.especieProbable, plantasCatalogoPlano);
        setCampoNombre(enCatalogo?.nombre || d.especieProbable);
      }
    });
  }, [seleccionarYComprimirImagen, estimarConFoto, campoNombre, plantasCatalogoPlano]);

  // Mejora v16 "Añadir con foto": abre el formulario y la cámara; la IA
  // rellena especie, tamaño, edad y suelo; el usuario solo confirma.
  const anadirConFoto = useCallback(() => {
    setFormularioVisible(true);
    elegirImagenAlta('camara');
  }, [elegirImagenAlta]);

  // Acceso directo desde la pestaña "Hoy" (route.params.accion = 'foto').
  React.useEffect(() => {
    if (route.params?.accion === 'foto') anadirConFoto();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.t]);

  const quitarImagenAlta = useCallback(() => {
    setCampoImagenUri(null);
    setCampoImagenBase64(null);
    setEstimacionAlta(null);
  }, []);

  const seleccionarPlantaDelCatalogo = useCallback((planta) => {
    setCampoNombre(planta.nombre);
    if (planta.diasCosecha) {
      setCampoDiasCosecha(String(planta.diasCosecha));
    }
  }, []);

  // Elegir "Comprado y trasplantado" sugiere automáticamente una ventaja
  // inicial en "¿Hace cuántos días lo plantaste?" (solo si el usuario no
  // había tocado ya ese campo), para que la barra de progreso hacia la
  // cosecha no empiece de cero como si acabara de germinar. Solo es una
  // sugerencia: el usuario puede corregirla si conoce el dato real.
  const seleccionarOrigen = useCallback(
    (origen) => {
      setCampoOrigen(origen);
      if (origen === 'establecida') return; // la fecha no se pregunta
      if (origen === 'trasplante' && campoDiasAtras === '0') {
        setCampoDiasAtras(DIAS_VENTAJA_TRASPLANTE);
      } else if (origen === 'semilla' && campoDiasAtras === DIAS_VENTAJA_TRASPLANTE) {
        setCampoDiasAtras('0');
      }
    },
    [campoDiasAtras]
  );

  const guardarCultivoManual = useCallback(async () => {
    const nombre = campoNombre.trim();
    if (!nombre) {
      setErrorManual('Ponle un nombre a la planta (p.ej. "Tomate de rama").');
      return;
    }
    setGuardandoManual(true);
    setErrorManual(null);
    try {
      // La foto es un extra opcional: si Storage fallara, no se bloquea
      // el guardado del cultivo en sí (mismo criterio que el resto de
      // subidas de foto del proyecto — ver subirFotoDiagnostico).
      let imagenUrl = null;
      if (campoImagenBase64) {
        setSubiendoImagen(true);
        try {
          imagenUrl = await subirFotoCultivo(campoImagenBase64);
        } catch (e) {
          console.log('No se pudo subir la foto del cultivo (no bloqueante):', e?.message);
        } finally {
          setSubiendoImagen(false);
        }
      }
      const establecida = campoOrigen === 'establecida';
      const especie = buscarEspecie(nombre, plantasCatalogoPlano);
      const edadNum = parseFloat(String(campoEdad).replace(',', '.'));
      let edadEstimadaISO = null;
      if (establecida && Number.isFinite(edadNum) && edadNum >= 0) {
        const f = new Date();
        f.setFullYear(f.getFullYear() - Math.floor(edadNum));
        f.setMonth(f.getMonth() - Math.round((edadNum % 1) * 12));
        edadEstimadaISO = f.toISOString();
      }
      const resultadoAlta = await insertarCultivo({
        nombre,
        variedad: campoVariedad.trim() || null,
        zona: campoZona.trim() || null,
        cantidad: campoCantidad,
        origen: campoOrigen,
        tamano: TIPOS_CON_TAMANO.includes(especie?.tipo) || campoDiametro ? campoTamano : undefined,
        diametro_copa: campoDiametro || undefined,
        tipo_suelo: campoSuelo || undefined,
        edad_estimada: edadEstimadaISO ? true : undefined,
        // "Ya plantado": si hay edad aproximada (IA o escrita), la fecha
        // de plantación se estima a partir de ella; si no, se guarda la de
        // alta y la app la trata como planta establecida.
        fechaSiembraISO: establecida
          ? edadEstimadaISO || new Date().toISOString()
          : fechaSiembraDesdeDiasAtras(campoDiasAtras),
        dias_cosecha: Math.max(1, parseInt(campoDiasCosecha, 10) || especie?.diasCosecha || 60),
        imagen_url: imagenUrl || undefined,
      });
      if (establecida && resultadoAlta?.id && !resultadoAlta.origenGuardado) {
        guardarMarcaLocal(resultadoAlta.id, 'origen', 'establecida');
      }
      if (TIPOS_CON_TAMANO.includes(especie?.tipo) && resultadoAlta?.id && !resultadoAlta.tamanoGuardado) {
        guardarMarcaLocal(resultadoAlta.id, 'tamano', campoTamano);
      }
      if (campoDiametro && resultadoAlta?.id && !resultadoAlta.diametroGuardado) {
        guardarMarcaLocal(resultadoAlta.id, 'diametro_copa', campoDiametro);
      }
      if (edadEstimadaISO && resultadoAlta?.id && !resultadoAlta.edadEstimadaGuardada) {
        guardarMarcaLocal(resultadoAlta.id, 'edad_estimada', true);
      }
      if (campoSuelo && resultadoAlta?.id && !resultadoAlta.sueloGuardado) {
        guardarMarcaLocal(resultadoAlta.id, 'tipo_suelo', campoSuelo);
      }
      // v16: si la IA vio algún problema de salud o de agua, queda como
      // primer diagnóstico en el historial de la planta (fail-soft).
      const est = estimacionAlta?.datos;
      if (est && resultadoAlta?.id && ((est.salud && est.salud !== 'sana') || est.agua === 'falta' || est.agua === 'exceso')) {
        insertarDiagnostico({
          modo: 'plagas',
          que_tiene: est.saludDetalle || est.aguaDetalle || 'Revisión al añadir la planta',
          que_hacer_hoy: est.recomendaciones?.length ? est.recomendaciones : ['Vigílala estos días'],
          truco_experto: '',
          alerta_riego_hoy: est.aguaDetalle || '',
          dias_para_revisar: 7,
          apto_para_gallinas: false,
          aviso_gallinas: 'Sin evaluar al añadir la planta.',
          imagen_url: imagenUrl || null,
          cultivo_id: resultadoAlta.id,
        }).catch((e) => console.log('No se pudo guardar el diagnóstico inicial (no bloqueante):', e?.message));
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      limpiarFormularioManual();
      setFormularioVisible(false);
      cargar();
    } catch (e) {
      console.log('Error al añadir cultivo manual:', e?.message);
      setErrorManual(mensajeDeError(e));
    } finally {
      setGuardandoManual(false);
    }
  }, [
    campoNombre,
    campoVariedad,
    campoZona,
    campoOrigen,
    campoCantidad,
    campoDiasCosecha,
    campoDiasAtras,
    campoImagenBase64,
    campoTamano,
    campoDiametro,
    campoEdad,
    campoSuelo,
    estimacionAlta,
    plantasCatalogoPlano,
    cargar,
    limpiarFormularioManual,
  ]);

  // Activos primero (lo que casi siempre se quiere ver); el historial
  // (cosechados/perdidos) se acumula aparte y solo se muestra si se pide,
  // para que la vista principal no crezca sin fin y siga siendo simple.
  const activos = useMemo(() => cultivos.filter((c) => c.estado === 'sembrado'), [cultivos]);
  const historial = useMemo(() => cultivos.filter((c) => c.estado !== 'sembrado'), [cultivos]);

  const zonasConocidas = useMemo(() => {
    const vistas = new Set();
    cultivos.forEach((c) => {
      const zona = (c.zona || '').trim();
      if (zona) vistas.add(zona);
    });
    return [...vistas].sort((a, b) => a.localeCompare(b, 'es')).map((zona) => ({ clave: zona, etiqueta: zona }));
  }, [cultivos]);

  // Recomendación de riego real, por cultivo (ver riego.js): cruza el
  // balance hídrico de hoy con la ficha de cada especie sembrada.
  const recomendacionRiego = useMemo(
    () => calcularRecomendacionesRiego(activos, plantasCatalogoPlano, balance, new Date(), opcionesRiego),
    [activos, plantasCatalogoPlano, balance, opcionesRiego]
  );
  // Sin balance (sin ubicación o sin red para el tiempo): riego habitual
  // por especie, para que SIEMPRE salga algo debajo de cada planta.
  const recomendacionOrientativa = useMemo(
    () => {
      // También si hay ubicación pero el servicio del tiempo no respondió.
      const sinDatosTiempo = !balance || (balance.litrosPorM2 == null && !balance.lluviaSuficiente);
      return sinDatosTiempo ? calcularRiegoOrientativo(activos, plantasCatalogoPlano, new Date(), zonaClimatica, opcionesRiego) : null;
    },
    [balance, activos, plantasCatalogoPlano, zonaClimatica, opcionesRiego]
  );

  // Alertas de poda: individualizadas por cultivo real (ver poda.js),
  // no por especie genérica — se calcula en el cliente a partir de lo
  // que ya está cargado (`activos` + el catálogo), sin pedir nada nuevo
  // a Supabase.
  const alertasPoda = useMemo(
    () => calcularAlertasPoda(activos, plantasCatalogoPlano, new Date(), zonaClimatica),
    [activos, plantasCatalogoPlano, zonaClimatica]
  );
  const idsConPoda = useMemo(() => new Set(alertasPoda.map((a) => a.cultivoId)), [alertasPoda]);

  const activarUbicacion = useCallback(async () => {
    setBuscandoUbicacion(true);
    setAvisoUbicacion(null);
    const { coords: nuevas, denegado } = await refrescarUbicacion();
    if (!isMountedRef.current) return;
    setBuscandoUbicacion(false);
    if (nuevas) {
      setCoords(nuevas);
    } else {
      setAvisoUbicacion(
        denegado
          ? 'Permiso denegado. Actívalo en Ajustes del móvil > Apps > HuertoApp > Ubicación.'
          : 'No se pudo obtener la ubicación ahora. Sal al exterior o activa el GPS y reinténtalo.'
      );
    }
  }, [setCoords]);

  const elegirZona = useCallback(
    (zona) => {
      setZonaClimatica?.(zona);
      guardarZonaClimatica(zona);
    },
    [setZonaClimatica]
  );

  // Recordatorios de riego y poda a la hora elegida (avisosHuerto.js).
  React.useEffect(() => {
    if (cargando || !cargadoUnaVezRef.current) return;
    programarAvisosHuerto({
      activos,
      recomendaciones: (recomendacionOrientativa || recomendacionRiego)?.recomendaciones,
      zona: zonaClimatica,
      prefs: prefsAvisos,
    });
  }, [recomendacionRiego, recomendacionOrientativa, activos, cargando, prefsAvisos, zonaClimatica]);

  const probarNotificacion = useCallback(async () => {
    const ok = await enviarNotificacionPrueba();
    if (isMountedRef.current) {
      setAvisoPrueba(ok ? '✅ Enviada. Si no la ves, revisa los permisos de notificaciones de HuertoApp en Ajustes del móvil.' : '⚠️ Sin permiso de notificaciones. Actívalo en Ajustes del móvil > Apps > HuertoApp > Notificaciones.');
    }
  }, []);

  const pendientesRiego = useMemo(
    () => (recomendacionRiego?.recomendaciones || []).filter((r) => r.necesitaRiego).length,
    [recomendacionRiego]
  );

  // Marca optimista + respaldo local SIEMPRE (bug de Pol: si la
  // migración v6 no estaba, "Ya lo he podado" no guardaba nada y el aviso
  // seguía saliendo). Supabase se intenta igualmente para compartirlo con
  // el otro móvil.
  const aplicarMarca = useCallback((cultivoId, campo, fechaISO) => {
    setCultivos((prev) => prev.map((c) => (c.id === cultivoId ? { ...c, [campo]: fechaISO } : c)));
  }, []);

  const marcarPodado = useCallback(async (cultivoId) => {
    setPodaActualizando(cultivoId);
    const ahoraISO = new Date().toISOString();
    const item = cultivos.find((c) => c.id === cultivoId);
    setAvisoDeshacer({ texto: `✂️ ${item?.nombre || 'Planta'} podada`, deshacer: [{ id: cultivoId, campo: 'ultima_poda', previo: item?.ultima_poda ?? null }] });
    aplicarMarca(cultivoId, 'ultima_poda', ahoraISO);
    await guardarMarcaLocal(cultivoId, 'ultima_poda', ahoraISO);
    try {
      const nuevoUpdatedAt = await marcarCultivoPodado(cultivoId);
      if (typeof nuevoUpdatedAt === 'string') aplicarMarca(cultivoId, 'updated_at', nuevoUpdatedAt);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      console.log('No se pudo guardar la poda en Supabase (queda guardada en este móvil):', e?.message);
    } finally {
      if (isMountedRef.current) setPodaActualizando(null);
    }
  }, [aplicarMarca, cultivos]);

  // Espejo exacto de marcarPodado, para el botón "Ya regado hoy" de cada
  // cultivo (ver riego.js: suprime la recomendación de riego el resto
  // del día, en los dos móviles, en cuanto se confirma aquí).
  const marcarRegado = useCallback(async (cultivoId) => {
    setRegandoId(cultivoId);
    const ahoraISO = new Date().toISOString();
    const item = cultivos.find((c) => c.id === cultivoId);
    setAvisoDeshacer({ texto: `💧 ${item?.nombre || 'Planta'} regada`, deshacer: [{ id: cultivoId, campo: 'ultimo_riego', previo: item?.ultimo_riego ?? null }] });
    aplicarMarca(cultivoId, 'ultimo_riego', ahoraISO);
    await guardarMarcaLocal(cultivoId, 'ultimo_riego', ahoraISO);
    try {
      const nuevoUpdatedAt = await marcarCultivoRegado(cultivoId);
      if (typeof nuevoUpdatedAt === 'string') aplicarMarca(cultivoId, 'updated_at', nuevoUpdatedAt);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      console.log('No se pudo guardar el riego en Supabase (queda guardado en este móvil):', e?.message);
    } finally {
      if (isMountedRef.current) setRegandoId(null);
    }
  }, [aplicarMarca, cultivos]);

  const deshacerUltimo = useCallback(async () => {
    const lista = avisoDeshacer?.deshacer || [];
    setAvisoDeshacer(null);
    lista.forEach((d) => aplicarMarca(d.id, d.campo, d.previo));
    const nuevos = await Promise.all(lista.map((d) => deshacerMarca(d.id, d.campo, d.previo)));
    if (!isMountedRef.current) return;
    lista.forEach((d, i) => {
      if (typeof nuevos[i] === 'string') aplicarMarca(d.id, 'updated_at', nuevos[i]);
    });
  }, [avisoDeshacer, aplicarMarca]);

  // --- Cosechas de perennes (v16) ---
  const resumenCosechas = useMemo(() => resumenCosechasAnio(cosechas), [cosechas]);
  const cargarCosechas = useCallback(() => {
    listarCosechas()
      .then((l) => {
        if (isMountedRef.current) setCosechas(l);
      })
      .catch(() => {});
  }, []);
  React.useEffect(() => {
    cargarCosechas();
  }, [cargarCosechas]);

  const abrirCosecha = useCallback((item) => {
    setCosechaCultivo(item);
    setCosechaKg('');
    setCosechaNota('');
    setCosechaError(null);
  }, []);

  const guardarCosecha = useCallback(async () => {
    if (!cosechaCultivo) return;
    setGuardandoCosecha(true);
    setCosechaError(null);
    try {
      await registrarCosecha({ cultivoId: cosechaCultivo.id, kg: cosechaKg, nota: cosechaNota.trim() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setAvisoDeshacer({ texto: `🧺 ${cosechaKg.replace('.', ',')} kg de ${cosechaCultivo.nombre} registrados`, deshacible: false });
      setCosechaCultivo(null);
      cargarCosechas();
    } catch (e) {
      setCosechaError(e?.message === 'KG_INVALIDO' ? 'Escribe los kilos (p.ej. 2,5).' : mensajeDeError(e));
    } finally {
      if (isMountedRef.current) setGuardandoCosecha(false);
    }
  }, [cosechaCultivo, cosechaKg, cosechaNota, cargarCosechas]);

  // Riego por cultivo: en vez de una lista aparte en "Riego de hoy" (poco
  // clara sobre a qué cultivo pertenece cada línea — petición de Pol),
  // se busca por id y se muestra debajo de cada tarjeta de "Tus
  // cultivos", justo donde está el cultivo al que se refiere.
  const recomendacionPorId = useMemo(() => {
    const mapa = new Map();
    ((recomendacionOrientativa || recomendacionRiego)?.recomendaciones || []).forEach((r) => mapa.set(r.id, r));
    return mapa;
  }, [recomendacionRiego, recomendacionOrientativa]);

  // Activos agrupados por zona (zona libre del formulario, p.ej.
  // "Bancal 1"): cada zona es su propia sección de la lista, y lo que
  // no tiene zona asignada cae en un grupo aparte al final. Si no hay
  // cultivos activos en absoluto, se mantiene una única sección vacía
  // para que el mensaje de bienvenida (más abajo) se siga mostrando.
  const seccionesActivosPorZona = useMemo(() => {
    if (activos.length === 0) {
      return [{ titulo: `🌱 Activos (0)`, data: [], esHistorial: false }];
    }
    const grupos = new Map();
    activos.forEach((c) => {
      const clave = (c.zona || '').trim() || SIN_ZONA;
      if (!grupos.has(clave)) grupos.set(clave, []);
      grupos.get(clave).push(c);
    });
    const clavesOrdenadas = [...grupos.keys()].sort((a, b) => {
      if (a === SIN_ZONA) return 1;
      if (b === SIN_ZONA) return -1;
      return a.localeCompare(b, 'es');
    });
    return clavesOrdenadas.map((zona) => ({
      titulo: `📍 ${zona} (${grupos.get(zona).length})`,
      data: grupos.get(zona),
      esHistorial: false,
    }));
  }, [activos]);

  const secciones = useMemo(() => {
    const s = [...seccionesActivosPorZona];
    if (historialVisible) {
      s.push({ titulo: `📜 Historial (${historial.length})`, data: historial, esHistorial: true });
    }
    return s;
  }, [seccionesActivosPorZona, historial, historialVisible]);

  const cargandoTodo = cargando || cargandoPanel || cargandoBalance;
  const recargarTodo = useCallback(() => {
    cargar();
    cargarPanel();
    cargarBalance();
  }, [cargar, cargarPanel, cargarBalance]);

  const renderFormularioManual = () => (
    <Card style={estilos.tarjetaFormulario}>
      {formularioVisible ? (
        <View style={estilos.filaCabeceraFormulario}>
          <Text style={tipografia.subtitulo}>Añadir planta</Text>
          <BotonX
            testID="boton-cerrar-formulario-x"
            onPress={() => {
              limpiarFormularioManual();
              setFormularioVisible(false);
            }}
            accessibilityLabel="Cerrar formulario"
          />
        </View>
      ) : (
        <View style={estilos.filaBotonesAlerta}>
          <BotonPrimario
            testID="boton-anadir-foto"
            titulo="📷 Añadir con foto"
            onPress={anadirConFoto}
            style={estilos.botonAccionMitad}
          />
          <BotonSecundario
            testID="boton-anadir-manual"
            titulo="+ Añadir a mano"
            onPress={() => setFormularioVisible(true)}
            style={estilos.botonAccionMitad}
          />
        </View>
      )}
      {formularioVisible && (
        <View style={estilos.formulario}>
          <AutocompletarPlanta
            testID="campo-nombre-cultivo"
            etiqueta="Nombre (obligatorio)"
            placeholder="p.ej. Tomate de rama — escribe para ver sugerencias"
            valor={campoNombre}
            onCambiarTexto={setCampoNombre}
            plantas={plantasCatalogoPlano}
            onSeleccionar={seleccionarPlantaDelCatalogo}
            style={estilos.campo}
          />
          <Text style={estilos.campoEtiquetaOrigen}>Foto (opcional)</Text>
          <Text style={estilos.textoAyudaFotoIA}>
            En árboles y arbustos, la IA estimará con la foto su tamaño y edad para calcular mejor el riego.
          </Text>
          {campoImagenUri ? (
            <View style={estilos.filaFotoElegida}>
              <Image source={{ uri: campoImagenUri }} style={estilos.miniaturaGrande} contentFit="cover" />
              <BotonSecundario testID="boton-quitar-foto-alta" titulo="Quitar foto" onPress={quitarImagenAlta} style={estilos.botonQuitarFoto} />
            </View>
          ) : (
            <View style={estilos.filaBotonesAlerta}>
              <BotonSecundario
                testID="boton-hacer-foto-alta"
                titulo="📷 Hacer foto"
                onPress={() => elegirImagenAlta('camara')}
                style={estilos.botonAccionMitad}
              />
              <BotonSecundario
                testID="boton-elegir-foto-alta"
                titulo="🖼️ Galería"
                onPress={() => elegirImagenAlta('galeria')}
                style={estilos.botonAccionMitad}
              />
            </View>
          )}

          {!!estimacionAlta && (
            <View style={estilos.cajaEstimacion} testID="estimacion-alta">
              {estimacionAlta.cargando ? (
                <Text style={estilos.textoEstimacion}>🤖 Analizando la foto…</Text>
              ) : estimacionAlta.error ? (
                <Text style={estilos.textoEstimacion}>{estimacionAlta.error}</Text>
              ) : (
                <>
                  <Text style={estilos.tituloEstimacion}>
                    🤖 {OPCIONES_TAMANO.find((t) => t.clave === estimacionAlta.datos.tamano)?.etiqueta}
                    {estimacionAlta.datos.diametroCopa ? ` · copa ~${String(estimacionAlta.datos.diametroCopa).replace('.', ',')} m` : ''}
                    {estimacionAlta.datos.edadAnios != null ? ` · ~${estimacionAlta.datos.edadAnios} años` : ''}
                  </Text>
                  {!!estimacionAlta.datos.comentario && (
                    <Text style={estilos.textoEstimacion}>{estimacionAlta.datos.comentario}</Text>
                  )}
                  {!!estimacionAlta.datos.salud && (
                    <Text style={estilos.textoEstimacion} testID="estimacion-salud">
                      {estimacionAlta.datos.salud === 'sana' ? '✅ Parece sana' : estimacionAlta.datos.salud === 'leve' ? '⚠️ Algo leve' : '🚨 Tiene un problema'}
                      {estimacionAlta.datos.saludDetalle ? `: ${estimacionAlta.datos.saludDetalle}` : ''}
                    </Text>
                  )}
                  {!!estimacionAlta.datos.agua && (
                    <Text style={estilos.textoEstimacion}>
                      {estimacionAlta.datos.agua === 'falta' ? '💧 Le falta agua' : estimacionAlta.datos.agua === 'exceso' ? '💦 Exceso de agua' : '💧 Agua correcta'}
                      {estimacionAlta.datos.aguaDetalle ? `: ${estimacionAlta.datos.aguaDetalle}` : ''}
                    </Text>
                  )}
                  <Text style={estilos.textoEstimacion}>
                    {estimacionAlta.datos.tipoSuelo
                      ? `🟫 Suelo ${estimacionAlta.datos.tipoSuelo}${estimacionAlta.datos.sueloDetalle ? `: ${estimacionAlta.datos.sueloDetalle}` : ''}`
                      : '🟫 No se ve la tierra: haz una foto que incluya el suelo o indícalo en Ajustes.'}
                  </Text>
                  {(estimacionAlta.datos.recomendaciones || []).map((r, i) => (
                    <Text key={i} style={estilos.textoEstimacion}>👉 {r}</Text>
                  ))}
                  <Text style={estilos.textoEstimacionPequeno}>
                    Estimación orientativa (confianza {estimacionAlta.datos.confianza}). Puedes corregirla abajo.
                  </Text>
                </>
              )}
            </View>
          )}
          <CampoTexto
            etiqueta="Variedad (opcional)"
            placeholder="p.ej. Raf"
            value={campoVariedad}
            onChangeText={setCampoVariedad}
            style={estilos.campo}
          />
          <CampoTexto
            etiqueta="Zona (opcional)"
            placeholder="p.ej. Bancal 1, Maceta terraza…"
            value={campoZona}
            onChangeText={setCampoZona}
            style={estilos.campoSinMargenInferior}
          />
          {zonasConocidas.length > 0 && (
            <SelectorChips
              testIDPrefix="zona-alta"
              opciones={zonasConocidas}
              valor={campoZona}
              onSeleccionar={setCampoZona}
              style={estilos.chipsZonaConocida}
            />
          )}

          <Text style={estilos.campoEtiquetaOrigen}>¿Cómo lo has plantado?</Text>
          <View style={estilos.filaOrigen}>
            {OPCIONES_ORIGEN.map((o) => (
              <TouchableOpacity
                key={o.clave}
                testID={`origen-${o.clave}`}
                style={[estilos.pillOrigen, campoOrigen === o.clave && estilos.pillOrigenActiva]}
                onPress={() => seleccionarOrigen(o.clave)}
                accessibilityRole="radio"
                accessibilityState={{ selected: campoOrigen === o.clave }}
              >
                <Text style={[estilos.pillOrigenTexto, campoOrigen === o.clave && estilos.pillOrigenTextoActiva]}>
                  {o.etiqueta}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {campoOrigen === 'establecida' ? (
            <CampoTexto
              testID="campo-edad-alta"
              etiqueta="Edad aproximada en años (opcional)"
              placeholder="Si no lo sabes, déjalo vacío"
              keyboardType="decimal-pad"
              value={campoEdad}
              onChangeText={setCampoEdad}
              style={estilos.campo}
            />
          ) : (
            <>
              <CampoTexto
                etiqueta="¿Hace cuántos días lo plantaste? (0 = hoy)"
                placeholder="0"
                keyboardType="number-pad"
                value={campoDiasAtras}
                onChangeText={setCampoDiasAtras}
                style={estilos.campoSinMargenInferior}
              />
              <SelectorChips
                testIDPrefix="dias-atras"
                opciones={ATAJOS_DIAS_ATRAS}
                valor={campoDiasAtras}
                onSeleccionar={setCampoDiasAtras}
                style={estilos.chipsZonaConocida}
              />
              <CampoTexto
                etiqueta="Días hasta la cosecha, desde que se plantó"
                placeholder="60"
                keyboardType="number-pad"
                value={campoDiasCosecha}
                onChangeText={setCampoDiasCosecha}
                style={estilos.campo}
              />
            </>
          )}
          {convieneEstimar(campoNombre) && (
            <>
              <Text style={estilos.campoEtiquetaOrigen}>Tamaño (ajusta el riego)</Text>
              <SelectorChips
                testIDPrefix="tamano-alta"
                opciones={OPCIONES_TAMANO}
                valor={campoTamano}
                onSeleccionar={(t) => {
                  setCampoTamano(t);
                  setCampoDiametro(null); // elección manual: manda el tamaño
                }}
                style={estilos.chipsZonaConocida}
              />
            </>
          )}
          <CampoTexto
            etiqueta="Cantidad"
            placeholder="1"
            keyboardType="number-pad"
            value={campoCantidad}
            onChangeText={setCampoCantidad}
            style={estilos.campo}
          />

          {!!errorManual && <Text style={estilos.error}>{errorManual}</Text>}
          <BotonPrimario
            testID="boton-guardar-cultivo"
            titulo={guardandoManual || subiendoImagen ? 'Guardando…' : 'Guardar'}
            onPress={guardarCultivoManual}
            cargando={guardandoManual || subiendoImagen}
            style={estilos.campo}
          />
        </View>
      )}
    </Card>
  );

  // Panel superior: riego de hoy + alertas de poda + tareas pendientes.
  // Es independiente de si hay o no cultivos activos (las plantas con
  // poda y las tareas de saneamiento no dependen de cultivos_huerto),
  // así que se muestra siempre, arriba del todo.
  const fechaHoy = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  const zonaActual = ZONAS_CLIMATICAS.find((z) => z.clave === zonaClimatica) || ZONAS_CLIMATICAS[1];

  // Panel superior: hero + riego de hoy + avisos de poda + tareas + ajustes.
  const renderPanelSuperior = () => (
    <>
      <Hero
        saludo={saludoSegunHora()}
        titulo="Mi huerto"
        subtitulo={`${fechaHoy.charAt(0).toUpperCase()}${fechaHoy.slice(1)} · ${zonaActual.etiqueta}`}
      >
        <StatHero icono="🌱" valor={activos.length} etiqueta={activos.length === 1 ? 'planta' : 'plantas'} />
        <StatHero icono="💧" valor={recomendacionRiego ? pendientesRiego : '–'} etiqueta="por regar" />
        <StatHero icono="✂️" valor={alertasPoda.length} etiqueta="a podar" />
      </Hero>

      {!!errorMsg && <Text style={[estilos.error, estilos.errorTrasHero]}>{errorMsg}</Text>}
      {!!errorPanel && <Text style={[estilos.error, estilos.errorTrasHero]}>{errorPanel}</Text>}

      <TarjetaAviso color={colors.agua} fondo={colors.aguaSoft} style={estilos.tarjetaPrimera}>
        <Text style={[estilos.etiquetaSeccion, { color: colors.agua }]}>💧 Riego de hoy</Text>
        {!coords ? (
          <>
            <Text style={estilos.textoCuerpo}>
              Activa la ubicación una sola vez: se guarda en el móvil y el riego se calculará con la lluvia y el
              calor reales de tu zona. Mientras tanto verás el riego habitual de cada planta.
            </Text>
            <BotonPrimario
              testID="boton-activar-ubicacion"
              titulo={buscandoUbicacion ? 'Buscando…' : '📍 Activar ubicación'}
              cargando={buscandoUbicacion}
              onPress={activarUbicacion}
              style={estilos.botonAccion}
            />
            {!!avisoUbicacion && <Text style={estilos.avisoPequeno}>{avisoUbicacion}</Text>}
          </>
        ) : cargandoBalance && !balance ? (
          <Text style={estilos.textoCuerpo}>Calculando con el tiempo de hoy…</Text>
        ) : recomendacionRiego ? (
          <Text style={estilos.textoCuerpoGrande}>{recomendacionRiego.mensajeGeneral}</Text>
        ) : (
          <Text style={estilos.textoCuerpo}>Sin datos del tiempo todavía. Desliza hacia abajo para actualizar.</Text>
        )}
      </TarjetaAviso>

      {alertasPoda.map((a) => (
        <TarjetaAviso key={a.cultivoId} color={colors.poda} fondo={colors.podaSoft} style={estilos.tarjeta}>
          <Text style={[estilos.etiquetaSeccion, { color: colors.poda }]}>
            ✂️ Toca podar: {a.nombre}
            {!!a.variedad && ` (${a.variedad})`}
          </Text>
          <Text style={estilos.textoCuerpo}>
            {a.zona ? `📍 ${a.zona} · ` : ''}
            {`${a.tipoPoda} · hasta finales de ${a.mesFin}`}
          </Text>
          {Array.isArray(a.pasos) && a.pasos.length > 0 && (
            <View style={estilos.listaPasos}>
              <Text style={estilos.tituloPasos}>Cómo podarlo:</Text>
              {a.pasos.map((paso, n) => (
                <Text key={n} style={estilos.consejo}>
                  {n + 1}. {paso}
                </Text>
              ))}
            </View>
          )}
          <View style={estilos.filaBotonesAlerta}>
            <BotonSecundario
              titulo="📷 Guía con foto"
              onPress={() => navigation.navigate('Escanear', { modoInicial: 'poda' })}
              style={estilos.botonAccionMitad}
            />
            <BotonPrimario
              testID={`boton-ya-podado-${a.cultivoId}`}
              titulo={podaActualizando === a.cultivoId ? 'Guardando…' : '✓ Ya podado'}
              onPress={() => marcarPodado(a.cultivoId)}
              style={estilos.botonAccionMitad}
            />
          </View>
        </TarjetaAviso>
      ))}

      {tareas.length > 0 && (
        <>
          <TituloSeccion icono="📝" titulo="Tareas pendientes" />
          {tareas.map((t) => (
            <Card key={t.id} style={estilos.tarjeta}>
              <Text style={tipografia.subtitulo}>{t.titulo}</Text>
              {!!t.descripcion && <Text style={estilos.textoCuerpo}>{t.descripcion}</Text>}
              {Array.isArray(t.pasos) &&
                t.pasos.map((paso, i) => (
                  <Text key={i} style={estilos.pasoTexto}>
                    {i + 1}. {paso}
                  </Text>
                ))}
              <BotonSecundario
                titulo={tareaActualizando === t.id ? 'Guardando…' : '✓ Marcar como hecho'}
                onPress={() => completarTarea(t)}
                style={estilos.botonAccion}
              />
            </Card>
          ))}
        </>
      )}

      <TouchableOpacity
        testID="boton-ajustes-huerto"
        onPress={() => setAjustesVisible((v) => !v)}
        style={estilos.filaAjustes}
        accessibilityRole="button"
      >
        <Text style={estilos.filaAjustesTexto}>⚙️ Ajustes del huerto · {zonaActual.etiqueta}</Text>
        <Text style={estilos.filaAjustesTexto}>{ajustesVisible ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {ajustesVisible && (
        <Card style={estilos.tarjeta}>
          <Text style={estilos.etiquetaSeccion}>🔔 Notificaciones</Text>
          <Text style={estilos.textoCuerpo}>
            Avisos en el móvil aunque la app esté cerrada. Se recalculan cada vez que abres Mi huerto.
          </Text>
          <SelectorChips
            testIDPrefix="avisos"
            opciones={[
              { clave: 'riego', etiqueta: `💧 Riego ${prefsAvisos.riego ? 'activado' : 'desactivado'}` },
              { clave: 'poda', etiqueta: `✂️ Poda ${prefsAvisos.poda ? 'activado' : 'desactivado'}` },
            ]}
            valor={null}
            onSeleccionar={(clave) => cambiarPrefsAvisos({ [clave]: !prefsAvisos[clave] })}
            style={estilos.chipsAjustes}
          />
          <Text style={estilos.avisoPequeno}>
            🕘 Hora de los avisos: {textoHora(prefsAvisos)} · cámbiala en Ajustes → Recordatorios.
          </Text>
          <BotonSecundario titulo="Enviar notificación de prueba" onPress={probarNotificacion} style={estilos.botonAccion} />
          {!!avisoPrueba && <Text style={estilos.avisoPequeno}>{avisoPrueba}</Text>}

          <Text style={[estilos.etiquetaSeccion, estilos.separadorAjustes]}>🟫 Tipo de suelo del huerto</Text>
          <Text style={estilos.textoCuerpo}>
            Cambia cada cuánto regar. La IA lo estima con la foto de cada planta si se ve la tierra; si no, se usa este.
          </Text>
          <SelectorChips
            testIDPrefix="suelo-huerto"
            opciones={TIPOS_SUELO}
            valor={sueloHuerto}
            onSeleccionar={(v) => {
              const nuevo = v === sueloHuerto ? null : v;
              setSueloHuerto?.(nuevo);
              guardarSueloHuerto(nuevo);
            }}
            style={estilos.chipsAjustes}
          />
          <Text style={estilos.avisoPequeno}>
            {sueloHuerto ? TIPOS_SUELO.find((t) => t.clave === sueloHuerto)?.descripcion : 'Sin indicar.'} {PRUEBA_SUELO}
          </Text>

          <Text style={[estilos.etiquetaSeccion, estilos.separadorAjustes]}>Zona climática</Text>
          <Text style={estilos.textoCuerpo}>
            Ajusta las épocas de poda de invierno (se retrasan si hay heladas) y el riego orientativo.
          </Text>
          <SelectorChips
            testIDPrefix="zona-climatica"
            opciones={ZONAS_CLIMATICAS}
            valor={zonaClimatica}
            onSeleccionar={elegirZona}
            style={estilos.chipsAjustes}
          />
          <Text style={estilos.avisoPequeno}>{zonaActual.descripcion}</Text>
          <Text style={[estilos.etiquetaSeccion, estilos.separadorAjustes]}>Ubicación</Text>
          <Text style={estilos.textoCuerpo}>
            {coords
              ? `Guardada en este móvil (${coords.lat.toFixed(2)}, ${coords.lon.toFixed(2)}). No hace falta volver a activarla.`
              : 'Sin ubicación guardada.'}
          </Text>
          <BotonSecundario
            titulo={buscandoUbicacion ? 'Buscando…' : coords ? '📍 Actualizar ubicación' : '📍 Activar ubicación'}
            onPress={activarUbicacion}
            style={estilos.botonAccion}
          />
          {!!avisoUbicacion && <Text style={estilos.avisoPequeno}>{avisoUbicacion}</Text>}
        </Card>
      )}
    </>
  );

  return (
    <>
    <SectionList
      style={estilos.contenedor}
      contentContainerStyle={estilos.contenido}
      sections={secciones}
      keyExtractor={(item) => item.id}
      stickySectionHeadersEnabled={false}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={cargandoTodo} onRefresh={recargarTodo} />}
      ListHeaderComponent={
        <>
          {renderPanelSuperior()}
          <TituloSeccion
            icono="🪴"
            titulo="Tus plantas"
            accion={historial.length > 0 ? (historialVisible ? 'Ocultar historial' : 'Ver historial') : null}
            onAccion={() => setHistorialVisible((v) => !v)}
          />
          {renderFormularioManual()}
        </>
      }
      renderSectionHeader={({ section }) => (
        <View style={estilos.cabeceraZona}>
          <Text style={estilos.tituloSeccion}>{section.titulo}</Text>
          <View style={estilos.lineaZona} />
        </View>
      )}
      renderSectionFooter={({ section }) => {
        if (section.data.length > 0) return null;
        if (!section.esHistorial && cultivos.length === 0 && !cargando) {
          // Huerto totalmente nuevo: mensaje de bienvenida en vez del
          // genérico "no tienes cultivos activos", con el siguiente
          // paso obvio (ir a Planificar, o usar el formulario de arriba).
          return (
            <View style={estilos.vacioTotal}>
              <Text style={tipografia.subtitulo}>Aún no tienes cultivos guardados</Text>
              <Text style={estilos.vacioTexto}>
                Ve a "Planificar" para recibir sugerencias, o usa el formulario de arriba para
                añadir lo que ya tengas plantado.
              </Text>
            </View>
          );
        }
        return (
          <Text style={estilos.vacioSeccionTexto}>
            {section.esHistorial ? 'Aún no hay nada en el historial.' : 'No tienes cultivos activos ahora mismo.'}
          </Text>
        );
      }}
      renderItem={({ item, section }) => {
        const { fraccion, diasTranscurridos, diasRestantes } = calcularProgreso(
          item.fecha_siembra,
          item.dias_cosecha
        );
        const cosechado = item.estado === 'cosechado';
        const ocupado = actualizandoId === item.id;
        const riegoItem = !section.esHistorial ? recomendacionPorId.get(item.id) : null;
        const especie = buscarEspecie(item.nombre, plantasCatalogoPlano);
        // Perenne = especie del catálogo sin ciclo de cosecha en días
        // (árboles, arbustos, aromáticas perennes…): cosechan por temporada,
        // así que ni cuenta atrás ni "Marcar como cosechado" (lo sacaría
        // del huerto). Se puede quitar desde el menú "⋯".
        const esPerenne = !!especie && !especie.diasCosecha;
        const sinCuentaAtras = esPerenne || item.origen === 'establecida';
        const tocaPodar = !section.esHistorial && idsConPoda.has(item.id);
        const porcentaje = Math.round((cosechado || item.estado === 'perdido' ? 1 : fraccion) * 100);
        const tamanoAplica = TIPOS_CON_TAMANO.includes(especie?.tipo);
        const edadItem = sinCuentaAtras ? edadEnAnios(item) : null;
        return (
          <Card style={[estilos.tarjeta, section.esHistorial && estilos.tarjetaHistorial]}>
            <View style={estilos.filaTitulo}>
              <View style={estilos.filaTituloIzq}>
                {item.imagen_url ? (
                  <Image source={{ uri: item.imagen_url }} style={estilos.miniatura} contentFit="cover" />
                ) : (
                  <View style={estilos.miniaturaEmojiCaja}>
                    <Text style={estilos.miniaturaEmoji}>{emojiPorNombre.get(item.nombre) || '🌱'}</Text>
                  </View>
                )}
                <View style={estilos.filaTituloTextos}>
                  <Text style={estilos.nombreCultivo} numberOfLines={1}>
                    {item.nombre}
                    {item.cantidad > 1 ? <Text style={estilos.cantidadTexto}>{`  ×${item.cantidad}`}</Text> : null}
                  </Text>
                  <Text style={estilos.subtituloCultivo} numberOfLines={2}>
                    {[
                      item.variedad,
                      ETIQUETA_ORIGEN[item.origen] || null,
                      tamanoAplica && item.tamano ? OPCIONES_TAMANO.find((t) => t.clave === item.tamano)?.etiqueta : null,
                      edadItem != null && edadItem >= 1 ? `~${Math.round(edadItem)} años` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || especie?.tipo || 'Planta'}
                  </Text>
                </View>
              </View>
              <View style={estilos.filaTituloDer}>
                {section.esHistorial && <Badge estado={item.estado} />}
                {!section.esHistorial && (
                  <TouchableOpacity
                    testID={`boton-opciones-${item.id}`}
                    onPress={() => abrirOpciones(item)}
                    accessibilityLabel={`Opciones de ${item.nombre}`}
                    accessibilityRole="button"
                    style={estilos.botonOpciones}
                  >
                    <Text style={estilos.botonOpcionesTexto}>⋯</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {((!!item.zona && section.esHistorial) || tocaPodar) && (
              <View style={estilos.filaPastillas}>
                {!!item.zona && section.esHistorial && <Pastilla icono="📍" texto={item.zona} color={colors.accentSoftText} fondo={colors.accentSoftBg} />}
                {tocaPodar && <Pastilla icono="✂️" texto="Toca podar" color={colors.poda} fondo={colors.podaSoft} />}
              </View>
            )}

            {!!riegoItem && (
              <View style={[estilos.cajaRiego, riegoItem.yaRegadoHoy && estilos.cajaRiegoHecho]}>
                <Text style={estilos.riegoIcono}>{riegoItem.yaRegadoHoy ? '✅' : riegoItem.necesitaRiego ? '💧' : '🌤️'}</Text>
                <Text style={[estilos.riegoDetalle, riegoItem.yaRegadoHoy && estilos.riegoDetalleHecho]}>{riegoItem.detalle}</Text>
                {!riegoItem.yaRegadoHoy && (
                  <TouchableOpacity
                    testID={`boton-ya-regado-${item.id}`}
                    onPress={() => marcarRegado(item.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Marcar ${item.nombre} como regado hoy`}
                    disabled={regandoId === item.id}
                    style={estilos.chipConfirmarRiego}
                    activeOpacity={0.7}
                  >
                    <Text style={estilos.chipConfirmarRiegoTexto}>
                      {regandoId === item.id ? '…' : '✓ Regado'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {sinCuentaAtras && item.estado === 'sembrado' ? null : (
              <View style={estilos.bloqueProgreso}>
                <View style={estilos.filaProgreso}>
                  <Text style={estilos.progresoTexto}>
                    {cosechado
                      ? '🧺 Cosechado'
                      : item.estado === 'perdido'
                      ? 'Se perdió antes de cosechar'
                      : diasRestantes > 0
                      ? `🌱 Día ${diasTranscurridos} de ${item.dias_cosecha} · faltan ~${diasRestantes}`
                      : '🧺 ¡Lista para cosechar!'}
                  </Text>
                  {item.estado === 'sembrado' && <Text style={estilos.progresoPorcentaje}>{porcentaje}%</Text>}
                </View>
                <BarraProgreso fraccion={porcentaje / 100} />
              </View>
            )}

            {!!item.asociacion && <Text style={estilos.detalle}>Asociación: {item.asociacion}</Text>}

            {esPerenne && !section.esHistorial && (
              <View style={estilos.filaCosecha}>
                <Text style={estilos.textoCosecha}>
                  🧺 {resumenCosechas[item.id]
                    ? `Este año: ${String(resumenCosechas[item.id].kg).replace('.', ',')} kg (${resumenCosechas[item.id].veces} ${resumenCosechas[item.id].veces === 1 ? 'cosecha' : 'cosechas'})`
                    : 'Sin cosechas este año'}
                </Text>
                <TouchableOpacity
                  testID={`boton-cosecha-${item.id}`}
                  onPress={() => abrirCosecha(item)}
                  style={estilos.chipCosecha}
                  accessibilityRole="button"
                  accessibilityLabel={`Registrar cosecha de ${item.nombre}`}
                >
                  <Text style={estilos.chipCosechaTexto}>+ Registrar</Text>
                </TouchableOpacity>
              </View>
            )}

            {!section.esHistorial ? (
              esPerenne ? null : <BotonSecundario
                titulo={ocupado ? 'Guardando…' : 'Marcar como cosechado'}
                onPress={() => marcarCosechado(item)}
                style={estilos.botonAccion}
              />
            ) : (
              <BotonSecundario
                titulo={ocupado ? 'Eliminando…' : 'Eliminar del historial'}
                onPress={() => confirmarEliminarDelHistorial(item)}
                style={estilos.botonAccion}
              />
            )}
          </Card>
        );
      }}
    />

    <Modal visible={edicionVisible} animationType="slide" transparent onRequestClose={cerrarEdicion}>
      <View style={estilos.modalFondo}>
        <View style={estilos.modalTarjeta}>
          <View style={estilos.modalCabecera}>
            <Text style={tipografia.subtitulo}>Editar {cultivoEditando?.nombre}</Text>
            <BotonX
              testID="boton-cerrar-edicion-x"
              onPress={cerrarEdicion}
              accessibilityLabel="Cerrar edición"
            />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            <CampoTexto
              etiqueta="Variedad (opcional)"
              placeholder="p.ej. Raf"
              value={editVariedad}
              onChangeText={setEditVariedad}
              style={estilos.campo}
            />
            <CampoTexto
              etiqueta="Zona (opcional)"
              placeholder="p.ej. Bancal 1, Maceta terraza…"
              value={editZona}
              onChangeText={setEditZona}
              style={estilos.campoSinMargenInferior}
            />
            {zonasConocidas.length > 0 && (
              <SelectorChips
                testIDPrefix="zona-edicion"
                opciones={zonasConocidas}
                valor={editZona}
                onSeleccionar={setEditZona}
                style={estilos.chipsZonaConocida}
              />
            )}
            <Text style={estilos.campoEtiquetaOrigen}>¿Cómo lo plantaste?</Text>
            <View style={estilos.filaOrigen}>
              {OPCIONES_ORIGEN.map((o) => (
                <TouchableOpacity
                  key={o.clave}
                  testID={`edit-origen-${o.clave}`}
                  style={[estilos.pillOrigen, editOrigen === o.clave && estilos.pillOrigenActiva]}
                  onPress={() => setEditOrigen(o.clave)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: editOrigen === o.clave }}
                >
                  <Text style={[estilos.pillOrigenTexto, editOrigen === o.clave && estilos.pillOrigenTextoActiva]}>
                    {o.etiqueta}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {!!estimacionEdicion && (
              <View style={estilos.cajaEstimacion}>
                <Text style={estilos.textoEstimacion}>
                  {estimacionEdicion.cargando
                    ? '🤖 Analizando la foto…'
                    : estimacionEdicion.error
                    ? estimacionEdicion.error
                    : `🤖 ${OPCIONES_TAMANO.find((t) => t.clave === estimacionEdicion.datos.tamano)?.etiqueta}${
                        estimacionEdicion.datos.diametroCopa ? ` · copa ~${String(estimacionEdicion.datos.diametroCopa).replace('.', ',')} m` : ''
                      }${estimacionEdicion.datos.edadAnios != null ? ` · ~${estimacionEdicion.datos.edadAnios} años` : ''}`}
                </Text>
              </View>
            )}
            {TIPOS_CON_TAMANO.includes(buscarEspecie(cultivoEditando?.nombre, plantasCatalogoPlano)?.tipo) && (
              <>
                <CampoTexto
                  etiqueta="Edad aproximada en años (opcional)"
                  placeholder="p.ej. 5"
                  keyboardType="decimal-pad"
                  value={editEdad}
                  onChangeText={setEditEdad}
                  style={estilos.campo}
                />
                <Text style={estilos.campoEtiquetaOrigen}>Tamaño (ajusta el riego)</Text>
                <SelectorChips
                  testIDPrefix="tamano-edicion"
                  opciones={OPCIONES_TAMANO}
                  valor={editTamano}
                  onSeleccionar={(t) => {
                    setEditTamano(t);
                    setEditDiametro(null);
                  }}
                  style={estilos.chipsZonaConocida}
                />
              </>
            )}
            <CampoTexto
              etiqueta="Cantidad"
              placeholder="1"
              keyboardType="number-pad"
              value={editCantidad}
              onChangeText={setEditCantidad}
              style={estilos.campo}
            />
            <CampoTexto
              etiqueta="Días hasta la cosecha, desde que se plantó"
              placeholder="60"
              keyboardType="number-pad"
              value={editDiasCosecha}
              onChangeText={setEditDiasCosecha}
              style={estilos.campo}
            />

            <Text style={estilos.campoEtiquetaOrigen}>Foto (opcional)</Text>
            {editImagenUri || editImagenUrlActual ? (
              <View style={estilos.filaFotoElegida}>
                <Image source={{ uri: editImagenUri || editImagenUrlActual }} style={estilos.miniaturaGrande} contentFit="cover" />
                <BotonSecundario testID="boton-quitar-foto-edicion" titulo="Quitar foto" onPress={quitarImagenEdicion} style={estilos.botonQuitarFoto} />
              </View>
            ) : (
              <View style={estilos.filaBotonesAlerta}>
                <BotonSecundario
                  testID="boton-hacer-foto-edicion"
                  titulo="📷 Hacer foto"
                  onPress={() => elegirImagenEdicion('camara')}
                  style={estilos.botonAccionMitad}
                />
                <BotonSecundario
                  testID="boton-elegir-foto-edicion"
                  titulo="🖼️ Galería"
                  onPress={() => elegirImagenEdicion('galeria')}
                  style={estilos.botonAccionMitad}
                />
              </View>
            )}
  
            {!!errorEdicion && <Text style={estilos.error}>{errorEdicion}</Text>}
            <BotonPrimario
              testID="boton-guardar-edicion"
              titulo={guardandoEdicion ? 'Guardando…' : 'Guardar cambios'}
              onPress={guardarEdicion}
              cargando={guardandoEdicion}
              style={estilos.campo}
            />
          </ScrollView>
        </View>
      </View>
    </Modal>

    <Modal visible={historialDiagVisible} animationType="slide" transparent onRequestClose={cerrarHistorialDiagnosticos}>
      <View style={estilos.modalFondo}>
        <View style={estilos.modalTarjeta}>
          <View style={estilos.modalCabecera}>
            <Text style={tipografia.subtitulo}>
              Historial de {historialDiagCultivo?.nombre || 'este cultivo'}
            </Text>
            <BotonX
              testID="boton-cerrar-historial-diag-x"
              onPress={cerrarHistorialDiagnosticos}
              accessibilityLabel="Cerrar historial"
            />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            {historialDiagCargando && <Text style={estilos.textoCuerpo}>Cargando…</Text>}
            {!!historialDiagError && !historialDiagCargando && (
              <Text style={estilos.error}>{historialDiagError}</Text>
            )}
            {!historialDiagCargando && !historialDiagError && historialDiagLista.length === 0 && (
              <Text style={estilos.textoCuerpo}>
                Todavía no hay diagnósticos guardados para este cultivo. Cuando analices una foto en
                "Escanear", elige este cultivo en "¿De cuál de tus cultivos es?" para que aparezca aquí.
              </Text>
            )}
            {historialDiagLista.map((d) => (
              <Card key={d.id} style={estilos.tarjetaHistorialDiag}>
                <Text style={estilos.fechaHistorialDiag}>
                  {ICONOS_MODO[d.modo] || '🔍'} {new Date(d.fecha).toLocaleDateString('es-ES', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </Text>
                <Text style={tipografia.cuerpo}>{d.que_tiene}</Text>
              </Card>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
    <Modal visible={!!cosechaCultivo} animationType="slide" transparent onRequestClose={() => setCosechaCultivo(null)}>
      <View style={estilos.modalFondo}>
        <View style={estilos.modalTarjeta}>
          <View style={estilos.modalCabecera}>
            <Text style={tipografia.subtitulo}>🧺 Cosecha de {cosechaCultivo?.nombre}</Text>
            <BotonX onPress={() => setCosechaCultivo(null)} accessibilityLabel="Cerrar cosecha" />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            <CampoTexto
              testID="campo-kg-cosecha"
              etiqueta="¿Cuántos kilos?"
              placeholder="p.ej. 2,5"
              keyboardType="decimal-pad"
              value={cosechaKg}
              onChangeText={setCosechaKg}
              style={estilos.campoSinMargenInferior}
            />
            <SelectorChips
              testIDPrefix="kg-rapido"
              opciones={['0.5', '1', '2', '5', '10'].map((k) => ({ clave: k, etiqueta: `${k.replace('.', ',')} kg` }))}
              valor={cosechaKg}
              onSeleccionar={setCosechaKg}
              style={estilos.chipsZonaConocida}
            />
            <CampoTexto etiqueta="Nota (opcional)" placeholder="p.ej. muy dulces" value={cosechaNota} onChangeText={setCosechaNota} style={estilos.campo} />
            {!!cosechaError && <Text style={estilos.error}>{cosechaError}</Text>}
            <BotonPrimario testID="boton-guardar-cosecha" titulo="Guardar cosecha" onPress={guardarCosecha} cargando={guardandoCosecha} style={estilos.campo} />
            {cosechas.filter((c) => c.cultivo_id === cosechaCultivo?.id).slice(0, 10).map((c) => (
              <Text key={c.id} style={estilos.textoCuerpo}>
                {new Date(c.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })} ·{' '}
                {String(c.kg).replace('.', ',')} kg{c.nota ? ` · ${c.nota}` : ''}
              </Text>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>

    <ToastDeshacer aviso={avisoDeshacer} onDeshacer={avisoDeshacer?.deshacer ? deshacerUltimo : null} onCerrar={() => setAvisoDeshacer(null)} />
    </>
  );
}

const estilos = StyleSheet.create({
  contenedor: { flex: 1, backgroundColor: colors.background },
  // Hueco inferior: el botón del Asistente y el aviso de deshacer no tapan nada.
  contenido: { padding: spacing.md, paddingBottom: 120 },
  error: { fontSize: 14, color: colors.danger, marginBottom: spacing.md },
  tarjeta: { marginBottom: spacing.md },
  tarjetaPrimera: { marginTop: spacing.md, marginBottom: spacing.md },
  tarjetaHistorial: { opacity: 0.85 },
  errorTrasHero: { marginTop: spacing.md, marginBottom: 0 },
  consejo: { fontSize: 13, color: colors.textPrimary, marginTop: 4, lineHeight: 19 },
  listaPasos: { marginTop: spacing.sm },
  filaCosecha: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.xs },
  textoCosecha: { flex: 1, fontSize: 13, color: colors.tierra, fontWeight: '600' },
  chipCosecha: { backgroundColor: colors.tierraSoft, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 8 },
  chipCosechaTexto: { color: colors.tierra, fontWeight: '800', fontSize: 13 },
  tituloPasos: { fontSize: 13, fontWeight: '800', color: colors.poda },
  textoAyudaFotoIA: { fontSize: 12, color: colors.textSecondary, marginBottom: spacing.sm },
  cajaEstimacion: {
    backgroundColor: colors.pendienteSoft,
    borderRadius: radii.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  tituloEstimacion: { fontSize: 14, fontWeight: '800', color: colors.pendiente },
  textoEstimacion: { fontSize: 13, color: colors.textPrimary, marginTop: 2 },
  textoEstimacionPequeno: { fontSize: 11, color: colors.textSecondary, marginTop: 4 },
  avisoPequeno: { fontSize: 12, color: colors.textSecondary, marginTop: spacing.sm },
  filaAjustes: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    marginTop: spacing.xs,
  },
  filaAjustesTexto: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  chipsAjustes: { marginTop: spacing.sm },
  separadorAjustes: { marginTop: spacing.lg },
  nombreCultivo: { fontSize: 17, fontWeight: '800', color: colors.textPrimary },
  subtituloCultivo: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  filaPastillas: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  cajaRiego: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.aguaSoft,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
  },
  cajaRiegoHecho: { backgroundColor: colors.accentSoftBg },
  riegoIcono: { fontSize: 18 },
  riegoDetalleHecho: { color: colors.accentSoftText },
  bloqueProgreso: { marginTop: spacing.xs },
  filaProgreso: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  progresoPorcentaje: { fontSize: 12, fontWeight: '800', color: colors.mintDark },
  cabeceraZona: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  lineaZona: { flex: 1, height: 1, backgroundColor: colors.border },
  tarjetaFormulario: { marginBottom: spacing.md },
  formulario: { marginTop: spacing.md },
  campo: { marginBottom: spacing.md },
  campoSinMargenInferior: { marginBottom: spacing.xs },
  chipsZonaConocida: { marginBottom: spacing.md },
  etiquetaSeccion: { fontSize: 15, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.xs },
  subtituloSeccion: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.lg, marginBottom: spacing.sm },
  subtituloSeccionSinMargen: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  filaTusCultivos: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  textoCuerpo: { fontSize: 14, color: colors.textSecondary, marginTop: 2, lineHeight: 20 },
  textoCuerpoGrande: { fontSize: 16, color: colors.textPrimary, fontWeight: '600' },
  detalle: { fontSize: 13, color: colors.textSecondary, marginTop: spacing.sm },
  pasoTexto: { fontSize: 14, color: colors.textPrimary, marginTop: 4 },
  botonAccion: { marginTop: spacing.md },
  filaBotonesAlerta: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  botonAccionMitad: { flex: 1 },
  tituloSeccion: { fontSize: 13, fontWeight: '800', color: colors.textSecondary, marginVertical: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.6 },
  enlaceHistorial: { fontSize: 13, fontWeight: '600', color: colors.mintDark },
  vacioSeccionTexto: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.md },
  vacioTotal: { paddingVertical: spacing.md, marginBottom: spacing.md },
  vacioTexto: { fontSize: 14, color: colors.textSecondary, marginTop: spacing.sm },
  filaTitulo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  origenEtiqueta: { fontSize: 12, color: colors.textSecondary, marginTop: -spacing.xs, marginBottom: spacing.sm },
  progresoTexto: { fontSize: 13, color: colors.textSecondary, fontWeight: '600', flexShrink: 1 },
  filaBotones: { flexDirection: 'row', marginTop: spacing.md, gap: spacing.sm },
  botonMitad: { flex: 1 },
  campoEtiquetaOrigen: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: spacing.xs },
  filaOrigen: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  pillOrigen: {
    flexGrow: 1,
    flexBasis: '30%',
    minHeight: 46,
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.badgeNeutroBg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  pillOrigenActiva: { backgroundColor: colors.mint, borderColor: colors.mint },
  pillOrigenTexto: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, textAlign: 'center' },
  pillOrigenTextoActiva: { color: colors.textOnDark, fontWeight: '700' },
  filaRiegoAccion: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  filaRiegoCultivo: {
    alignSelf: 'flex-start',
    backgroundColor: colors.badgeSembradoBg,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  riegoDetalle: { fontSize: 13, color: colors.agua, fontWeight: '700', flex: 1, lineHeight: 18 },
  chipConfirmarRiego: {
    backgroundColor: colors.card,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.agua,
  },
  chipConfirmarRiegoTexto: { fontSize: 12, fontWeight: '800', color: colors.agua },

  // --- Cabecera del formulario "Añadir cultivo" con X (sustituye al
  // botón "Cancelar" — petición de Pol) y botón "..." de cada tarjeta ---
  filaCabeceraFormulario: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  filaTituloIzq: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, gap: spacing.sm },
  filaTituloTextos: { flexShrink: 1 },
  filaTituloDer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  botonOpciones: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    backgroundColor: colors.badgeNeutroBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botonOpcionesTexto: { fontSize: 16, fontWeight: '700', color: colors.textSecondary },
  cantidadTexto: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },

  // --- Miniatura de cultivo (foto o emoji de respaldo) ---
  miniatura: { width: 58, height: 58, borderRadius: radii.lg, backgroundColor: colors.badgeNeutroBg },
  miniaturaEmojiCaja: {
    width: 58,
    height: 58,
    borderRadius: radii.lg,
    backgroundColor: colors.accentSoftBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniaturaEmoji: { fontSize: 30 },
  miniaturaGrande: { width: 80, height: 80, borderRadius: radii.md, backgroundColor: colors.badgeNeutroBg },
  filaFotoElegida: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  botonQuitarFoto: { flex: 1 },
  textoAyudaFoto: { fontSize: 12, color: colors.textSecondary, marginTop: -spacing.sm, marginBottom: spacing.md },

  // --- Modal de edición de cultivo ---
  modalFondo: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalTarjeta: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: spacing.lg,
    maxHeight: '85%',
  },
  modalCabecera: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },

  // --- Modal de historial de diagnósticos ---
  tarjetaHistorialDiag: { marginBottom: spacing.sm },
  fechaHistorialDiag: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginBottom: 4 },
});
