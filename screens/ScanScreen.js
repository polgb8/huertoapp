// ============================================================
// screens/ScanScreen.js — Módulo A: Escáner e IA, con 3 modos:
//   - Diagnóstico de Plagas (por defecto)
//   - Poda Guiada
//   - Momento de Cosecha (Ojo Clínico de Maduración)
// Cámara -> captura optimizada -> Gemini (razonamiento agronómico
// interno, respuesta en lenguaje llano) -> modal inferior -> foto a
// Supabase Storage + fila en `diagnosticos` -> recordatorio local.
// ============================================================

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Dimensions,
  ScrollView,
} from 'react-native';
import { useRoute, useIsFocused } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';

import { colors, radii, spacing, tipografia } from '../theme';
import { BotonPrimario, BotonSecundario, SelectorChips } from '../components/UI';
import { llamarGemini } from '../gemini';
import { supabase, insertarDiagnostico, subirFotoDiagnostico, listarCultivosHuerto } from '../supabase';
import { mensajeDeError, esErrorDeRed } from '../utils';
import { programarRecordatorio, notificarAhora } from '../notificaciones';
import { obtenerClimaActual } from '../clima';
import { encolarCapturaPendiente, obtenerColaPendiente, guardarColaPendiente, contarColaPendiente, eliminarDeCola, desbloquearCola } from '../colaOffline';
import { useAppStore } from '../store';

// Blur genérico verde-tierra como placeholder mientras carga la foto:
// no es un BlurHash calculado por imagen (requeriría decodificar
// píxeles en el cliente, ver AUDITORIA_V3.md), pero da la misma
// sensación de carga fluida que pide expo-image.
const PLACEHOLDER_BLURHASH = 'L6Ib_h~q00%M~qM{9Fxu00Rj9FIU';

// ------------------------------------------------------------
// Modos de escaneo. Los 3 comparten EXACTAMENTE el mismo esquema JSON
// (una única forma que parsear/renderizar): solo cambia el prompt que
// se le manda a Gemini. Esto evita multiplicar casos especiales en el
// parseo/render por cada modo.
// ------------------------------------------------------------
const MODOS = [
  { clave: 'plagas', etiqueta: 'Plagas', icono: '🐛' },
  { clave: 'poda', etiqueta: 'Poda', icono: '✂️' },
  { clave: 'cosecha', etiqueta: 'Cosecha', icono: '🍅' },
];

const TITULOS_RECORDATORIO = {
  plagas: '🌱 Toca revisar tu planta',
  poda: '✂️ Toca revisar cómo brota tras la poda',
  cosecha: '🍅 Toca revisar el punto de cosecha',
};

const SCHEMA_DIAGNOSTICO = {
  type: 'OBJECT',
  properties: {
    que_tiene: { type: 'STRING' },
    que_hacer_hoy: { type: 'ARRAY', items: { type: 'STRING' } },
    truco_experto: { type: 'STRING' },
    alerta_riego_hoy: { type: 'STRING' },
    dias_para_revisar: { type: 'NUMBER' },
    apto_para_gallinas: { type: 'BOOLEAN' },
    aviso_gallinas: { type: 'STRING' },
  },
  required: [
    'que_tiene',
    'que_hacer_hoy',
    'truco_experto',
    'alerta_riego_hoy',
    'dias_para_revisar',
    'apto_para_gallinas',
    'aviso_gallinas',
  ],
};

const RESPALDO_DIAGNOSTICO = {
  que_tiene: 'No se ha podido interpretar la foto',
  que_hacer_hoy: ['Repite la foto con mejor luz y encuadre'],
  truco_experto: '',
  alerta_riego_hoy: 'Sin datos suficientes para recomendar riego',
  dias_para_revisar: 3,
  // Failsafe de seguridad real: ante la duda, NUNCA se asume "apto para
  // gallinas" por defecto — es más seguro decir "no" sin datos que
  // arriesgar un envenenamiento por un resultado a medias.
  apto_para_gallinas: false,
  aviso_gallinas: 'Sin datos suficientes para saber si es seguro: no se lo des a las gallinas por precaución.',
};

function construirPrompt(climaTexto, modo) {
  const base =
    'Eres un ingeniero agrónomo experto en horticultura y permacultura. ' +
    'Internamente, razona usando: grados-día de desarrollo y demanda evapotranspirativa (ETo) ' +
    'para la recomendación de riego; la ley de movilidad foliar de Liebig (una carencia que amarillea ' +
    'primero las hojas basales/viejas es un nutriente móvil como nitrógeno, potasio o magnesio; si ' +
    'amarillea primero en las hojas nuevas/apicales es un nutriente inmóvil como hierro, calcio o boro); ' +
    'manejo integrado de plagas, valorando el ratio plaga frente a fauna auxiliar depredadora antes de ' +
    'recomendar cualquier tratamiento; y rotación/asociación de cultivos. ' +
    `Contexto climático actual: ${climaTexto}. `;

  const porModo = {
    plagas:
      'Analiza la foto para diagnosticar plagas, enfermedades o carencias nutricionales visibles en la planta. ' +
      'Antes de razonar sobre la causa, identifica tú mismo — a partir de lo que se ve en la foto, sin preguntar ' +
      'nada — en qué parte de la planta se aprecia el problema (hojas, tallo o tronco, flores, frutos, o raíz/base); ' +
      'y si la planta es un cactus, una crasa o una planta de interior, valora también síntomas típicos de esas ' +
      'plantas como cochinilla o estiolamiento. Ten esa parte identificada en cuenta para el diagnóstico y las ' +
      'recomendaciones, pero sin mencionar en la respuesta que has hecho esa identificación (va implícita en el ' +
      'propio diagnóstico).',
    poda:
      'Estás en modo "Poda Guiada": analiza la estructura de la planta o árbol en la foto (ramas cruzadas, ' +
      'chupones, madera muerta, densidad de copa) y explica qué cortar y por qué, con pasos concretos de poda.',
    cosecha:
      'Estás en modo "Momento de Cosecha" (ojo clínico de maduración): analiza el fruto en la foto valorando ' +
      'el brillo epidérmico, el estado del pedúnculo (seco/verde, fácil o no de desprender) y si conviene ' +
      'recolectar ya por riesgo de agrietamiento ante lluvias inminentes, o si es mejor dejarlo madurar más. ' +
      'Usa "dias_para_revisar" para indicar en cuántos días estará en su punto óptimo (0 si ya está listo hoy).',
  };

  const gallinas =
    'Además, evalúa si los restos que se generan al atender esta planta hoy (hojas retiradas, poda, restos ' +
    'de cosecha) son seguros como forraje verde para gallinas, o si son tóxicos (por ejemplo: solanina en ' +
    'hojas/tallos de tomatera o patatera, restos podridos con hongos, otras plantas tóxicas conocidas). ' +
    'Rellena "apto_para_gallinas" (true/false) y "aviso_gallinas" con una frase clara tipo "Dáselo a las ' +
    'gallinas sin problema" o "Tóxico para las gallinas por motivo, tíralo a la basura". Ante la duda, marca ' +
    'apto_para_gallinas como false y explica la incertidumbre.';

  const reglaDeOro =
    'REGLA DE ORO: en tu respuesta NUNCA uses vocabulario técnico (nada de "ETo", "Liebig", "nitrógeno ' +
    'móvil", "manejo integrado de plagas", etc.). Explícalo como se lo explicaría un abuelo agricultor con ' +
    'mucha experiencia a alguien sin conocimientos de agronomía: frases cortas, directas y prácticas. ' +
    'Devuelve ÚNICAMENTE un JSON estricto con estas claves exactas: ' +
    '{"que_tiene": "frase directa y sencilla", ' +
    '"que_hacer_hoy": ["paso 1 concreto", "paso 2 concreto"], ' +
    '"truco_experto": "consejo tradicional práctico", ' +
    '"alerta_riego_hoy": "recomendación de agua para hoy según el calor/viento", ' +
    '"dias_para_revisar": numero_de_dias, ' +
    '"apto_para_gallinas": true_o_false, ' +
    '"aviso_gallinas": "frase clara sobre si es seguro para las gallinas"}. ' +
    'Si la imagen es borrosa o no se distingue bien, usa que_tiene: "No se distingue bien en la foto" y ' +
    'que_hacer_hoy: ["Repite la foto con mejor luz y más cerca"].';

  return `${base}${porModo[modo] || porModo.plagas} ${gallinas} ${reglaDeOro}`;
}

// ------------------------------------------------------------
// construirResultadoDiagnostico: normaliza la respuesta cruda de Gemini
// (parseado, ya puede venir incompleta o con tipos raros) al mismo objeto
// que consume el modal y que se guarda en Supabase. Compartida entre la
// captura en vivo (analizarConGemini) y el drenaje de la cola offline
// (procesarItemColaPendiente) para no tener la misma lógica dos veces.
// ------------------------------------------------------------
function construirResultadoDiagnostico(modoActual, parseado) {
  return {
    modo: modoActual,
    que_tiene: parseado?.que_tiene ?? RESPALDO_DIAGNOSTICO.que_tiene,
    que_hacer_hoy: Array.isArray(parseado?.que_hacer_hoy) && parseado.que_hacer_hoy.length > 0
      ? parseado.que_hacer_hoy
      : RESPALDO_DIAGNOSTICO.que_hacer_hoy,
    truco_experto: parseado?.truco_experto ?? '',
    alerta_riego_hoy: parseado?.alerta_riego_hoy ?? RESPALDO_DIAGNOSTICO.alerta_riego_hoy,
    dias_para_revisar: Number.isFinite(parseado?.dias_para_revisar)
      ? parseado.dias_para_revisar
      : RESPALDO_DIAGNOSTICO.dias_para_revisar,
    // Failsafe de seguridad: si Gemini omite el campo o no es
    // estrictamente booleano, se asume false (no apto) por precaución.
    apto_para_gallinas: parseado?.apto_para_gallinas === true,
    aviso_gallinas:
      typeof parseado?.aviso_gallinas === 'string' && parseado.aviso_gallinas.trim()
        ? parseado.aviso_gallinas
        : RESPALDO_DIAGNOSTICO.aviso_gallinas,
  };
}

// ------------------------------------------------------------
// procesarItemColaPendiente: re-ejecuta EXACTAMENTE el mismo pipeline que
// una captura en vivo (llamarGemini -> normalizar -> subir foto ->
// insertarDiagnostico -> programarRecordatorio) para un elemento ya
// encolado en colaOffline.js, sin depender de ningún estado de componente
// (se llama desde App.js, fuera de cualquier pantalla montada).
//
// No se pide el clima real aquí (evita pedir permiso de ubicación en
// mitad de un drenaje en segundo plano); se analiza con el texto genérico
// de "sin datos climáticos", igual que hace analizarConGemini cuando no
// hay coords disponibles todavía.
//
// NUNCA lanza (mismo principio que colaOffline.js): devuelve true/false.
// ------------------------------------------------------------
export async function procesarItemColaPendiente(item) {
  try {
    // Dos tipos de elemento en la cola:
    //  - foto sin analizar (no había red al hacerla): se analiza ahora.
    //  - diagnóstico YA analizado que no se pudo guardar (mejora v14):
    //    solo se sube, sin volver a llamar a Gemini.
    const yaAnalizado = !!item.resultado;
    let resultado;
    if (yaAnalizado) {
      resultado = item.resultado;
    } else {
      const climaTexto = 'sin datos climáticos disponibles';
      const parseado = await llamarGemini({
        promptTexto: construirPrompt(climaTexto, item.modo),
        imagenBase64: item.fotoBase64,
        responseSchema: SCHEMA_DIAGNOSTICO,
        valorRespaldo: RESPALDO_DIAGNOSTICO,
        maxOutputTokens: 640,
      });
      resultado = construirResultadoDiagnostico(item.modo, parseado);
    }

    const imagenUrl = item.fotoBase64
      ? await subirFotoDiagnostico(item.fotoBase64).catch((e) => {
          console.log('No se pudo subir la foto de la cola (no bloqueante):', e?.message);
          return null;
        })
      : null;

    await insertarDiagnostico({ ...resultado, imagen_url: imagenUrl, cultivo_id: item.cultivoId || null });

    // Aviso inmediato: el análisis se hizo en segundo plano (quizá horas
    // después de la foto), así que hay que contarle a Pol el resultado.
    const icono = { plagas: '🐛', poda: '✂️', cosecha: '🍅' }[resultado.modo] || '🌱';
    notificarAhora({
      titulo: yaAnalizado ? `${icono} Diagnóstico guardado` : `${icono} Diagnóstico pendiente listo`,
      cuerpo: `${resultado.que_tiene}${resultado.que_hacer_hoy?.[0] ? ` — ${resultado.que_hacer_hoy[0]}` : ''}`,
    });

    if (resultado.dias_para_revisar > 0) {
      const fecha = new Date(Date.now() + resultado.dias_para_revisar * 24 * 60 * 60 * 1000);
      programarRecordatorio({
        titulo: TITULOS_RECORDATORIO[resultado.modo] || TITULOS_RECORDATORIO.plagas,
        cuerpo: resultado.que_tiene,
        fecha,
      });
    }

    return true;
  } catch (e) {
    console.log('No se pudo procesar un elemento de la cola pendiente (no bloqueante):', e?.message);
    // Sin red otra vez: no es culpa del elemento; se marca para que el
    // drenaje pare y NO cuente como intento fallido (no se bloquea).
    return esErrorDeRed(e) ? 'SIN_RED' : false;
  }
}

// Cuántas veces se reintenta automáticamente UN MISMO elemento de la
// cola antes de dejar de insistir con él (auditoría de mejoras: antes,
// un elemento atascado para siempre — p.ej. una foto que Gemini bloquea
// sistemáticamente por seguridad — dejaba TODA la cola bloqueada detrás
// de él, porque el drenaje se paraba en seco en el primer fallo). Al
// llegar a este número se marca `bloqueado: true` y se deja de
// reintentar solo, pero la foto NO se borra ni se pierde: sigue
// contando en el indicador de pendientes (ver contarColaPendiente en
// colaOffline.js) para que Pol sepa que algo se quedó sin sincronizar.
export const MAX_INTENTOS_ITEM = 5;

// ------------------------------------------------------------
// procesarColaPendiente: drena la cola offline, en orden (el más antiguo
// primero). A diferencia de antes, un elemento que falla NO detiene el
// drenaje del resto (auditoría de mejoras: un único item atascado ya no
// bloquea items nuevos y perfectamente sincronizables detrás de él) —
// simplemente se cuenta su intento fallido y se sigue con el siguiente.
// Pensado para llamarse desde App.js cuando NetInfo detecta que se ha
// recuperado la conexión (ver useEffect de App.js). NUNCA lanza.
// ------------------------------------------------------------
// Guardián de reentrada a nivel de módulo: si NetInfo dispara el listener
// varias veces seguidas (la red parpadea conectado/desconectado más rápido
// de lo que tarda en procesarse un solo item, algo plausible ya que cada
// item hace una llamada a Gemini + subida de foto con timeouts de hasta
// 20s), una segunda llamada a procesarColaPendiente() no debe arrancar un
// segundo drenaje en paralelo — eso duplicaría diagnósticos en Supabase,
// fotos subidas dos veces y recordatorios programados dos veces.
let procesandoColaPendiente = false;

export async function procesarColaPendiente() {
  if (procesandoColaPendiente) return; // ya hay un drenaje en curso, no dupliques
  // v11: sin sesión iniciada RLS rechazaría cada envío y se gastarían los
  // reintentos de cada foto encolada. Se espera a que haya sesión.
  try {
    const { data } = await supabase.auth.getSession();
    if (!data?.session) return;
  } catch (e) {
    return;
  }
  procesandoColaPendiente = true;
  try {
    // Claves (encoladoEn) de los elementos ya intentados EN ESTA PASADA
    // (con éxito o con fallo): sin esto, un elemento que sigue en la cola
    // tras fallar (no se ha llegado a MAX_INTENTOS_ITEM) volvería a salir
    // elegido en la siguiente vuelta del bucle una y otra vez, sin dejar
    // nunca hueco a los demás elementos de la cola dentro de esta misma
    // pasada. En la SIGUIENTE llamada a procesarColaPendiente() (próxima
    // vez que vuelva la conexión) sí se reintentará con normalidad.
    const yaIntentadosEnEstaPasada = new Set();

    // Importante: la cola se relee de disco en CADA vuelta del bucle (nunca
    // se confía en una copia en memoria calculada al principio). Si no se
    // hiciera así, una foto nueva encolada por el usuario mientras el
    // drenaje está en curso se perdería sin aviso: el drenaje sobrescribiría
    // el archivo al terminar con una copia en memoria que nunca la tuvo.
    for (;;) {
      const cola = await obtenerColaPendiente();
      const pendientes = cola.filter(
        (c) => !c.bloqueado && !yaIntentadosEnEstaPasada.has(c.encoladoEn)
      );
      if (pendientes.length === 0) break;

      const item = pendientes[0];
      const ok = await procesarItemColaPendiente(item);
      yaIntentadosEnEstaPasada.add(item.encoladoEn);
      if (ok === 'SIN_RED') break; // se reintentará cuando vuelva la cobertura

      // Se relee otra vez tras procesar (pudo haberse encolado algo nuevo
      // mientras tanto) y se localiza el elemento por su marca de tiempo
      // de encolado, no por un índice calculado en memoria.
      const colaTrasProcesar = await obtenerColaPendiente();
      const idx = colaTrasProcesar.findIndex(
        (c) => c.encoladoEn === item.encoladoEn && c.modo === item.modo
      );
      if (idx === -1) continue; // ya no está (caso raro), sigue con el resto

      if (ok === true) {
        colaTrasProcesar.splice(idx, 1); // éxito: fuera de la cola
      } else {
        const intentosFallidos = (colaTrasProcesar[idx].intentosFallidos || 0) + 1;
        colaTrasProcesar[idx] = {
          ...colaTrasProcesar[idx],
          intentosFallidos,
          bloqueado: intentosFallidos >= MAX_INTENTOS_ITEM,
        };
      }
      await guardarColaPendiente(colaTrasProcesar);
    }
  } catch (e) {
    console.log('No se pudo drenar la cola pendiente (no bloqueante):', e?.message);
  } finally {
    procesandoColaPendiente = false;
  }
}

export default function ScanScreen() {
  const route = useRoute();
  const estaEnfocada = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef(null);

  // Si se navega aquí desde una alerta de poda del Inicio, se abre ya en
  // modo "Poda Guiada" ("acceso directo a la cámara" que pide el enunciado).
  const modoInicial = MODOS.some((m) => m.clave === route.params?.modoInicial)
    ? route.params.modoInicial
    : 'plagas';
  const [modo, setModo] = useState(modoInicial);
  const cambiarModo = useCallback((nuevoModo) => {
    setModo(nuevoModo);
  }, []);

  useEffect(() => {
    if (route.params?.modoInicial && MODOS.some((m) => m.clave === route.params.modoInicial)) {
      setModo(route.params.modoInicial);
    }
  }, [route.params?.modoInicial]);

  const [fotoUri, setFotoUri] = useState(null);
  const [fotoBase64, setFotoBase64] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [avisoOffline, setAvisoOffline] = useState(null);
  const [camaraLista, setCamaraLista] = useState(false);
  const [errorCamara, setErrorCamara] = useState(null);
  const [permisoRevocado, setPermisoRevocado] = useState(false);
  // Indicador de "N diagnósticos pendientes de sincronizar" (auditoría de
  // mejoras): se refresca al entrar en la pantalla y justo tras encolar
  // una foto nueva sin conexión. El drenaje real ocurre en segundo plano
  // (procesarColaPendiente, ver App.js) aunque esta pantalla no esté
  // montada, así que este número puede quedarse desactualizado mientras
  // Pol está en otra pestaña — se corrige solo la próxima vez que entre
  // aquí, que es suficiente para un indicador informativo, no crítico.
  const [colaPendiente, setColaPendiente] = useState({ total: 0, bloqueados: 0 });
  // Pantalla de pendientes (mejora v14).
  const [pendientesVisible, setPendientesVisible] = useState(false);
  const [listaPendientes, setListaPendientes] = useState([]);
  const [reintentando, setReintentando] = useState(false);
  const [mensajeFlotante, setMensajeFlotante] = useState(null);

  const refrescarPendientes = useCallback(async () => {
    const [lista, info] = await Promise.all([obtenerColaPendiente(), contarColaPendiente()]);
    if (!isMountedRef.current) return;
    setListaPendientes(lista);
    setColaPendiente(info);
  }, []);

  const abrirPendientes = useCallback(() => {
    setPendientesVisible(true);
    refrescarPendientes();
  }, [refrescarPendientes]);

  const reintentarPendientes = useCallback(async () => {
    setReintentando(true);
    await desbloquearCola();
    await procesarColaPendiente();
    await refrescarPendientes();
    if (isMountedRef.current) setReintentando(false);
  }, [refrescarPendientes]);

  const borrarPendiente = useCallback(
    async (item) => {
      await eliminarDeCola(item.encoladoEn);
      refrescarPendientes();
    },
    [refrescarPendientes]
  );

  useEffect(() => {
    if (!mensajeFlotante) return undefined;
    const t = setTimeout(() => setMensajeFlotante(null), 4000);
    return () => clearTimeout(t);
  }, [mensajeFlotante]);
  // Vincular el diagnóstico a un cultivo real de "Mi huerto" (opcional):
  // auditoría de mejoras — antes todo diagnóstico quedaba colgado de la
  // planta genérica "General", así que era imposible ver "solo los
  // diagnósticos de ESTE limonero". cultivosParaVincular se carga una
  // vez, best-effort (si falla o no hay cultivos activos, el selector
  // simplemente no aparece: guardar sigue funcionando igual que antes).
  const [cultivosParaVincular, setCultivosParaVincular] = useState([]);
  const [cultivoVinculadoId, setCultivoVinculadoId] = useState(null);
  const cargarCultivosParaVincular = useCallback(() => {
    listarCultivosHuerto()
      .then((cultivos) => {
        if (!isMountedRef.current) return;
        const activos = (cultivos || [])
          .filter((c) => c.estado === 'sembrado')
          .map((c) => ({
            clave: c.id,
            etiqueta: c.variedad ? `${c.nombre} · ${c.variedad}` : c.nombre,
          }));
        setCultivosParaVincular(activos);
      })
      .catch((e) => {
        console.log('No se pudo cargar la lista de cultivos para vincular (no bloqueante):', e?.message);
      });
  }, []);
  // Tamaño real (en píxeles) del contenedor de la cámara, medido con
  // onLayout. Ver más abajo (junto al <CameraView>) por qué se le pasa
  // un tamaño explícito en vez de flex/StyleSheet.absoluteFillObject.
  // Arranca con el tamaño de la ventana como valor inicial (nunca null):
  // así la cámara se pinta desde el primer frame aunque onLayout tarde
  // en llegar (o, como en los tests, no llegue nunca), y en cuanto el
  // contenedor real mide su layout, onLayout lo corrige al tamaño exacto.
  const [tamanoCamara, setTamanoCamara] = useState(() => {
    const { width, height } = Dimensions.get('window');
    return { width, height };
  });

  const conectado = useAppStore((s) => s.conectado);
  const coords = useAppStore((s) => s.coords);
  const clima = useAppStore((s) => s.clima);
  const setClima = useAppStore((s) => s.setClima);
  const setUltimoDiagnostico = useAppStore((s) => s.setUltimoDiagnostico);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Libera la cámara nativa cuando se sale de esta pestaña, y fuerza un
  // montaje limpio al volver a entrar: causa más probable del "tras un
  // rato dentro de la app, la cámara deja de verse/funcionar" que
  // reportó Pol. En Android, una sesión de <CameraView> que lleva mucho
  // tiempo inactiva en segundo plano (mientras se usan otras pestañas)
  // puede quedar en un estado roto que ya no se recupera por sí sola;
  // desmontar el componente al perder el foco y remontarlo de cero al
  // recuperarlo evita llegar a ese estado. camaraLista se resetea aquí
  // (no solo al montar) para que el botón de captura no quede habilitado
  // por error mientras la cámara nueva todavía no ha avisado que está
  // lista.
  useEffect(() => {
    if (!estaEnfocada) {
      setCamaraLista(false);
      setErrorCamara(null);
    } else {
      contarColaPendiente()
        .then((info) => {
          if (isMountedRef.current) setColaPendiente(info);
        })
        .catch(() => {});
      // Recarga la lista de cultivos para vincular cada vez que se vuelve
      // a esta pestaña (no solo al montar el componente, que con
      // React Navigation solo ocurre una vez): auditoría de mejoras — un
      // cultivo añadido en "Mi huerto" DESPUÉS de entrar a Escanear no
      // aparecía en el selector "¿De cuál de tus cultivos es?" hasta
      // reiniciar la app, porque la lista solo se pedía una vez.
      cargarCultivosParaVincular();
    }
  }, [estaEnfocada, cargarCultivosParaVincular]);

  const procesandoFotoRef = useRef(false);
  const guardandoRef = useRef(false);

  const analizarConGemini = useCallback(async (base64Image, modoActual) => {
    setAvisoOffline(null);

    // Balance Hídrico Digital / arranque sin red: en vez de bloquear con
    // un simple error, la captura se guarda en la cola local para
    // analizarla en cuanto vuelva la conexión. encolarCapturaPendiente
    // nunca lanza (ver colaOffline.js), así que aquí no hace falta un
    // try/catch adicional para evitar una unhandled promise rejection.
    const encolarYAvisar = async (texto) => {
      await encolarCapturaPendiente({ modo: modoActual, fotoBase64: base64Image });
      if (isMountedRef.current) {
        setAvisoOffline(texto);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        contarColaPendiente()
          .then((info) => {
            if (isMountedRef.current) setColaPendiente(info);
          })
          .catch(() => {});
      }
    };

    if (!conectado) {
      await encolarCapturaPendiente({ modo: modoActual, fotoBase64: base64Image });
      if (isMountedRef.current) {
        setAvisoOffline('Sin conexión: hemos guardado la foto. La analizaremos en cuanto vuelva la conexión y te avisaremos con una notificación.');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        contarColaPendiente()
          .then((info) => {
            if (isMountedRef.current) setColaPendiente(info);
          })
          .catch(() => {});
      }
      return;
    }

    setCargando(true);
    setErrorMsg(null);

    try {
      // El clima es un extra "best effort": solo lo usamos si ya tenemos
      // coordenadas (obtenidas antes en el Planificador) para no
      // interrumpir la captura con un permiso de ubicación a mitad de flujo.
      let climaActual = clima;
      if (!climaActual && coords) {
        climaActual = await obtenerClimaActual(coords.lat, coords.lon).catch(() => null);
        if (climaActual && isMountedRef.current) setClima(climaActual);
      }
      const climaTexto = climaActual?.resumenTexto ?? 'sin datos climáticos disponibles';

      const parseado = await llamarGemini({
        promptTexto: construirPrompt(climaTexto, modoActual),
        imagenBase64: base64Image,
        responseSchema: SCHEMA_DIAGNOSTICO,
        valorRespaldo: RESPALDO_DIAGNOSTICO,
        maxOutputTokens: 640,
      });

      const resultadoFinal = construirResultadoDiagnostico(modoActual, parseado);

      if (isMountedRef.current) {
        setResultado(resultadoFinal);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
    } catch (e) {
      console.log('Error en analizarConGemini:', e?.message);
      // Cobertura débil: NetInfo decía "conectado" pero la petición no
      // llegó. En vez de perder la foto, se guarda en la cola.
      if (esErrorDeRed(e)) {
        await encolarYAvisar('Cobertura insuficiente: hemos guardado la foto. La analizaremos sola cuando haya buena conexión y te avisaremos con una notificación.');
        return;
      }
      if (isMountedRef.current) {
        setErrorMsg(mensajeDeError(e));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      }
    } finally {
      if (isMountedRef.current) setCargando(false);
    }
  }, [conectado, coords, clima, setClima]);

  const tomarFoto = useCallback(async () => {
    if (!cameraRef.current || !camaraLista) return;
    if (procesandoFotoRef.current) return; // evita capturas solapadas
    procesandoFotoRef.current = true;

    setErrorMsg(null);
    setResultado(null);
    setCultivoVinculadoId(null);

    let uriOriginal = null;
    try {
      const foto = await cameraRef.current.takePictureAsync({
        quality: 0.5, // ver AUDITORIA.md: mitiga, no elimina, el riesgo de OOM
        base64: false,
        skipProcessing: true,
      });
      uriOriginal = foto.uri;

      const manipulada = await ImageManipulator.manipulateAsync(
        foto.uri,
        [{ resize: { width: 800 } }],
        { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );

      if (!isMountedRef.current) return;
      setFotoUri(manipulada.uri);
      setFotoBase64(manipulada.base64);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

      FileSystem.deleteAsync(uriOriginal, { idempotent: true }).catch(() => {});

      await analizarConGemini(manipulada.base64, modo);
    } catch (e) {
      console.log('Error en tomarFoto:', e?.message);
      const msg = (e?.message || '').toLowerCase();
      if (msg.includes('permission') || msg.includes('permiso')) {
        if (isMountedRef.current) setPermisoRevocado(true);
      } else if (isMountedRef.current) {
        setErrorMsg('No se pudo capturar o procesar la foto. Inténtalo de nuevo.');
      }
    } finally {
      procesandoFotoRef.current = false;
    }
  }, [camaraLista, analizarConGemini, modo]);

  // Mejora v14: sin red al GUARDAR, el diagnóstico ya analizado no se
  // pierde — se guarda en la cola y se sube solo cuando vuelva la red.
  const guardarEnColaParaMasTarde = useCallback(async () => {
    const ok = await encolarCapturaPendiente({
      modo: resultado.modo,
      fotoBase64,
      resultado,
      cultivoId: cultivoVinculadoId,
    });
    if (!isMountedRef.current) return;
    if (!ok) {
      setErrorMsg('No se pudo guardar en el móvil. Inténtalo de nuevo.');
      return;
    }
    setUltimoDiagnostico(resultado);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    contarColaPendiente()
      .then((info) => {
        if (isMountedRef.current) setColaPendiente(info);
      })
      .catch(() => {});
    cerrarModal();
    setMensajeFlotante('📥 Guardado en el móvil. Se subirá solo cuando haya conexión.');
  }, [resultado, fotoBase64, cultivoVinculadoId, setUltimoDiagnostico]);

  const guardarEnSupabase = useCallback(async () => {
    if (!resultado || guardandoRef.current) return;
    if (!conectado) {
      await guardarEnColaParaMasTarde();
      return;
    }
    guardandoRef.current = true;
    setGuardando(true);
    try {
      // La foto es un "extra" de valor (historial visual): si Storage
      // fallara, seguimos guardando el diagnóstico en texto igualmente
      // en vez de perder todo el trabajo del análisis.
      const imagenUrl = fotoBase64
        ? await subirFotoDiagnostico(fotoBase64).catch((e) => {
            console.log('No se pudo subir la foto (no bloqueante):', e?.message);
            return null;
          })
        : null;

      await insertarDiagnostico({ ...resultado, imagen_url: imagenUrl, cultivo_id: cultivoVinculadoId });

      if (resultado.dias_para_revisar > 0) {
        const fecha = new Date(Date.now() + resultado.dias_para_revisar * 24 * 60 * 60 * 1000);
        programarRecordatorio({
          titulo: TITULOS_RECORDATORIO[resultado.modo] || TITULOS_RECORDATORIO.plagas,
          cuerpo: resultado.que_tiene,
          fecha,
        });
      }

      if (isMountedRef.current) {
        setUltimoDiagnostico(resultado);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        cerrarModal();
      }
    } catch (e) {
      console.log('Error en guardarEnSupabase:', e?.message);
      if (esErrorDeRed(e)) {
        guardandoRef.current = false;
        if (isMountedRef.current) setGuardando(false);
        await guardarEnColaParaMasTarde();
        return;
      }
      let msg = mensajeDeError(e);
      if (e?.code === '23503') msg = 'No se encontró la planta asociada. Vuelve a intentarlo.';
      if (e?.message === 'SIN_PLANTA_ID') msg = 'No se pudo preparar la planta por defecto. Revisa tu conexión.';
      if (isMountedRef.current) {
        setErrorMsg(msg);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      }
    } finally {
      guardandoRef.current = false;
      if (isMountedRef.current) setGuardando(false);
    }
  }, [resultado, fotoBase64, conectado, setUltimoDiagnostico, cultivoVinculadoId, guardarEnColaParaMasTarde]);

  const cerrarModal = () => {
    if (fotoUri) FileSystem.deleteAsync(fotoUri, { idempotent: true }).catch(() => {});
    setFotoUri(null);
    setFotoBase64(null);
    setResultado(null);
    setErrorMsg(null);
    setAvisoOffline(null);
    setCultivoVinculadoId(null);
  };

  if (!permission) {
    return (
      <View style={estilos.centrado}>
        <ActivityIndicator size="large" color={colors.mint} />
      </View>
    );
  }

  if (!permission.granted || permisoRevocado) {
    return (
      <View style={estilos.centrado}>
        <Text style={estilos.textoPermiso}>
          {permisoRevocado
            ? 'Se ha revocado el permiso de cámara. Actívalo de nuevo para seguir diagnosticando plantas.'
            : 'HuertoApp necesita acceso a la cámara para diagnosticar tus plantas.'}
        </Text>
        <BotonPrimario
          titulo="Conceder permiso"
          onPress={() => requestPermission().then(() => setPermisoRevocado(false))}
        />
      </View>
    );
  }

  if (errorCamara) {
    return (
      <View style={estilos.centrado}>
        <Text style={estilos.textoError}>{errorCamara}</Text>
        <BotonPrimario
          testID="boton-reintentar-camara"
          titulo="Reintentar"
          onPress={() => setErrorCamara(null)}
          style={estilos.botonAccion}
        />
      </View>
    );
  }

  return (
    <View style={estilos.contenedor}>
      {(!conectado || colaPendiente.total > 0) && (
        <View style={estilos.bannerContenedor}>
          {!conectado && (
            <View style={estilos.bannerOffline}>
              <Text style={estilos.bannerOfflineTexto}>Sin conexión: las fotos se guardan y se analizan solas al volver la red</Text>
            </View>
          )}
          {colaPendiente.total > 0 && (
            <TouchableOpacity
              style={estilos.bannerPendiente}
              testID="banner-cola-pendiente"
              onPress={abrirPendientes}
              accessibilityRole="button"
              accessibilityLabel="Ver diagnósticos pendientes"
            >
              <Text style={estilos.bannerPendienteTexto}>
                {`📤 ${colaPendiente.total} diagnóstico${colaPendiente.total === 1 ? '' : 's'} pendiente${
                  colaPendiente.total === 1 ? '' : 's'
                } de sincronizar`}
                {colaPendiente.bloqueados > 0
                  ? ` (${colaPendiente.bloqueados} sin poder enviar tras varios intentos)`
                  : ''}
              </Text>
              <Text style={estilos.bannerPendienteAccion}>Toca para ver y gestionar ›</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* <CameraView> NO admite hijos (ver expo-camera/src/CameraView.tsx:
          "The <CameraView> component does not support children" — lanza
          un warning real de Expo y recomienda posicionamiento absoluto en
          su lugar). Por eso los controles se pintan en un <View> HERMANO,
          posicionado encima con position:'absolute' dentro de un
          contenedor común, en vez de como children de <CameraView>. */}
      <View
        style={estilos.camaraContenedor}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          // Solo se actualiza si cambia de verdad (evita un bucle de
          // renders si onLayout se disparase varias veces con el mismo
          // tamaño, cosa que puede pasar en Android tras una rotación
          // de layout del propio Tab.Navigator).
          setTamanoCamara((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
        }}
      >
        {/* La cámara se ancla con un tamaño en píxeles MEDIDO (onLayout),
            no con flex ni con StyleSheet.absoluteFillObject: el
            <CameraView> es una vista nativa (SurfaceView en Android) y,
            al pasar de ser hijo único con flex:1 a ser un hermano más
            dentro de un contenedor 'relative' (ver comentario de abajo
            sobre por qué los overlays son hermanos, no hijos), dejaba de
            recibir de forma fiable su tamaño real durante el primer
            layout — con flex:1 se quedaba a media pantalla, y con
            absoluteFillObject directamente no llegaba a pintar nada.
            Pasarle un ancho/alto numérico concretos, calculados con
            onLayout, evita depender de que esa resolución de layout
            llegue a tiempo al lado nativo. */}
        {tamanoCamara && estaEnfocada && (
          <CameraView
            ref={cameraRef}
            style={{ width: tamanoCamara.width, height: tamanoCamara.height }}
            facing="back"
            onCameraReady={() => setCamaraLista(true)}
            onMountError={() => setErrorCamara('No se pudo iniciar la cámara. Reinicia la app.')}
          />
        )}

        <View style={estilos.selectorModo} pointerEvents="box-none">
          {MODOS.map((m) => (
            <TouchableOpacity
              key={m.clave}
              testID={`modo-${m.clave}`}
              style={[estilos.pillModo, modo === m.clave && estilos.pillModoActiva]}
              onPress={() => cambiarModo(m.clave)}
              accessibilityRole="tab"
              accessibilityLabel={`Modo ${m.etiqueta}`}
              accessibilityState={{ selected: modo === m.clave }}
            >
              <Text style={[estilos.pillModoTexto, modo === m.clave && estilos.pillModoTextoActiva]}>
                {m.icono} {m.etiqueta}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={estilos.overlay} pointerEvents="none">
          <View style={estilos.marcoGuia} />
          <Text style={estilos.textoGuia}>Encuadra la hoja o la planta</Text>
        </View>

        <View style={estilos.overlayInferior}>
          {!camaraLista && <Text style={estilos.textoPreparando}>Preparando cámara…</Text>}
          <TouchableOpacity
            testID="boton-capturar"
            style={[estilos.botonCapturar, !camaraLista && estilos.botonDeshabilitado]}
            onPress={tomarFoto}
            disabled={!camaraLista}
            accessibilityRole="button"
            accessibilityLabel="Tomar foto para analizar"
          />
        </View>
      </View>

      <Modal visible={!!fotoUri} animationType="slide" transparent onRequestClose={cerrarModal}>
        <View style={estilos.modalFondo}>
          <View style={estilos.modalPanel}>
            <ScrollView style={estilos.modalScroll} keyboardShouldPersistTaps="handled">
            {!!fotoUri && (
              <Image
                source={{ uri: fotoUri }}
                placeholder={{ blurhash: PLACEHOLDER_BLURHASH }}
                transition={200}
                style={estilos.previewImagen}
                contentFit="cover"
              />
            )}

            {cargando && (
              <View style={estilos.bloqueEstado}>
                <ActivityIndicator size="large" color={colors.mint} />
                <Text style={estilos.textoInfo}>Analizando con Gemini…</Text>
              </View>
            )}

            {!!errorMsg && !cargando && (
              <View style={estilos.bloqueEstado}>
                <Text style={estilos.textoError}>{errorMsg}</Text>
              </View>
            )}

            {!!avisoOffline && !cargando && (
              <View style={estilos.bloqueEstado}>
                <Text style={estilos.textoInfo}>{avisoOffline}</Text>
              </View>
            )}

            {!!resultado && !cargando && (
              <View>
                <Text style={tipografia.subtitulo}>{resultado.que_tiene}</Text>

                <Text style={estilos.etiqueta}>Qué hacer hoy</Text>
                {resultado.que_hacer_hoy.map((paso, i) => (
                  <Text key={i} style={estilos.pasoTexto}>
                    {i + 1}. {paso}
                  </Text>
                ))}

                {!!resultado.truco_experto && (
                  <View style={estilos.callout}>
                    <Text style={estilos.calloutTitulo}>💡 Truco de la abuela</Text>
                    <Text style={estilos.calloutTexto}>{resultado.truco_experto}</Text>
                  </View>
                )}

                <Text style={estilos.etiqueta}>Riego para hoy</Text>
                <Text style={estilos.valor}>{resultado.alerta_riego_hoy}</Text>

                <View
                  style={[
                    estilos.calloutGallinas,
                    { backgroundColor: resultado.apto_para_gallinas ? colors.badgeOptimoBg : colors.badgeEnfermaBg },
                  ]}
                >
                  <Text
                    style={[
                      estilos.calloutTitulo,
                      { color: resultado.apto_para_gallinas ? colors.badgeOptimoText : colors.badgeEnfermaText },
                    ]}
                  >
                    🐔 {resultado.apto_para_gallinas ? 'Apto para gallinas' : 'No apto para gallinas'}
                  </Text>
                  <Text style={estilos.calloutTexto}>{resultado.aviso_gallinas}</Text>
                </View>

                {cultivosParaVincular.length > 0 && (
                  <>
                    <Text style={estilos.etiqueta}>¿De cuál de tus cultivos es? (opcional)</Text>
                    <SelectorChips
                      testIDPrefix="vincular-cultivo"
                      opciones={cultivosParaVincular}
                      valor={cultivoVinculadoId}
                      onSeleccionar={(clave) =>
                        setCultivoVinculadoId((actual) => (actual === clave ? null : clave))
                      }
                      style={estilos.chipsVincularCultivo}
                    />
                  </>
                )}

                <Text style={estilos.recordatorioTexto}>
                  Te avisaremos para revisarla en {resultado.dias_para_revisar} días.
                </Text>
              </View>
            )}
            </ScrollView>

            <View style={estilos.filaBotones}>
              <BotonSecundario titulo="Repetir foto" onPress={cerrarModal} style={estilos.botonMitad} />
              {!!resultado && !cargando && (
                <BotonPrimario
                  testID="boton-guardar"
                  titulo={conectado ? 'Guardar diagnóstico' : 'Guardar (se subirá luego)'}
                  onPress={guardarEnSupabase}
                  cargando={guardando}
                  style={estilos.botonMitad}
                />
              )}
            </View>
          </View>
        </View>
      </Modal>

      {!!mensajeFlotante && (
        <View style={estilos.toast} pointerEvents="none">
          <Text style={estilos.toastTexto}>{mensajeFlotante}</Text>
        </View>
      )}

      <Modal
        visible={pendientesVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setPendientesVisible(false)}
      >
        <View style={estilos.modalFondo}>
          <View style={estilos.modalPanel}>
            <View style={estilos.cabeceraPendientes}>
              <Text style={tipografia.subtitulo}>📤 Pendientes de enviar</Text>
              <TouchableOpacity
                onPress={() => setPendientesVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="Cerrar pendientes"
                style={estilos.botonCerrarPendientes}
              >
                <Text style={estilos.botonCerrarPendientesTexto}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={estilos.textoAyudaPendientes}>
              Se envían solos cuando hay buena conexión (cada 2 min y al abrir la app). Te avisaremos con una
              notificación.
            </Text>
            <ScrollView style={estilos.modalScroll}>
              {listaPendientes.length === 0 && (
                <Text style={estilos.textoAyudaPendientes}>No queda nada pendiente. ✅</Text>
              )}
              {listaPendientes.map((item) => (
                <View key={item.encoladoEn} style={estilos.filaPendiente} testID={`pendiente-${item.encoladoEn}`}>
                  {item.fotoBase64 ? (
                    <Image
                      source={{ uri: `data:image/jpeg;base64,${item.fotoBase64}` }}
                      style={estilos.miniPendiente}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={[estilos.miniPendiente, estilos.miniPendienteVacia]}>
                      <Text>🌱</Text>
                    </View>
                  )}
                  <View style={estilos.textosPendiente}>
                    <Text style={estilos.tituloPendiente} numberOfLines={1}>
                      {(MODOS.find((m) => m.clave === item.modo)?.icono || '🔍') + ' '}
                      {item.resultado ? item.resultado.que_tiene : 'Foto sin analizar'}
                    </Text>
                    <Text style={estilos.subPendiente}>
                      {item.encoladoEn ? new Date(item.encoladoEn).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                      {item.resultado ? ' · analizado, falta subir' : ' · falta analizar'}
                      {item.bloqueado ? ' · ⚠️ detenido tras varios intentos' : item.intentosFallidos ? ` · ${item.intentosFallidos} intento(s)` : ''}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => borrarPendiente(item)}
                    accessibilityRole="button"
                    accessibilityLabel="Eliminar este pendiente"
                    style={estilos.botonBorrarPendiente}
                  >
                    <Text style={estilos.botonBorrarPendienteTexto}>🗑️</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
            {listaPendientes.length > 0 && (
              <BotonPrimario
                testID="boton-reintentar-pendientes"
                titulo={conectado ? 'Enviar ahora' : 'Sin conexión ahora mismo'}
                onPress={reintentarPendientes}
                cargando={reintentando}
                disabled={!conectado}
                style={estilos.botonReintentarPendientes}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const estilos = StyleSheet.create({
  contenedor: { flex: 1, backgroundColor: '#000' },
  centrado: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  textoPermiso: { fontSize: 16, textAlign: 'center', marginBottom: spacing.lg, color: colors.textPrimary },
  bannerContenedor: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  bannerOffline: {
    backgroundColor: colors.warning,
    padding: spacing.sm,
    alignItems: 'center',
  },
  bannerOfflineTexto: { color: '#fff', fontWeight: '600', fontSize: 13 },
  bannerPendiente: {
    backgroundColor: colors.headerDeep,
    padding: spacing.sm,
    alignItems: 'center',
  },
  bannerPendienteTexto: { color: colors.textOnDark, fontWeight: '600', fontSize: 13, textAlign: 'center' },
  bannerPendienteAccion: { color: colors.textOnDarkSoft, fontSize: 12, marginTop: 2 },
  modalScroll: { maxHeight: Dimensions.get('window').height * 0.62 },
  toast: {
    position: 'absolute',
    bottom: 130,
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: 'rgba(22,38,29,0.92)',
    borderRadius: radii.pill,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  toastTexto: { color: colors.textOnDark, fontWeight: '600', fontSize: 13, textAlign: 'center' },
  cabeceraPendientes: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  botonCerrarPendientes: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.badgeNeutroBg, alignItems: 'center', justifyContent: 'center' },
  botonCerrarPendientesTexto: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  textoAyudaPendientes: { fontSize: 13, color: colors.textSecondary, marginVertical: spacing.sm },
  filaPendiente: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  miniPendiente: { width: 52, height: 52, borderRadius: radii.md, backgroundColor: colors.border },
  miniPendienteVacia: { alignItems: 'center', justifyContent: 'center' },
  textosPendiente: { flex: 1 },
  tituloPendiente: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  subPendiente: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  botonBorrarPendiente: { padding: spacing.sm },
  botonBorrarPendienteTexto: { fontSize: 18 },
  botonReintentarPendientes: { marginTop: spacing.md },
  camaraContenedor: { flex: 1, position: 'relative' },
  selectorModo: {
    position: 'absolute',
    top: spacing.md,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    zIndex: 5,
  },
  pillModo: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  pillModoActiva: { backgroundColor: colors.mint },
  pillModoTexto: { color: '#fff', fontSize: 12, fontWeight: '600' },
  pillModoTextoActiva: { color: colors.textOnDark },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  marcoGuia: { width: '78%', aspectRatio: 1, borderWidth: 2, borderColor: 'rgba(255,255,255,0.85)', borderRadius: radii.lg },
  textoGuia: { color: '#fff', marginTop: spacing.md, fontSize: 13 },
  overlayInferior: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', paddingBottom: 40 },
  textoPreparando: { color: '#fff', marginBottom: spacing.sm, fontSize: 14 },
  botonCapturar: { width: 76, height: 76, borderRadius: 38, backgroundColor: '#fff', borderWidth: 4, borderColor: colors.mint },
  botonDeshabilitado: { opacity: 0.5 },
  modalFondo: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalPanel: { backgroundColor: colors.card, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, padding: spacing.lg, paddingBottom: spacing.xl },
  previewImagen: { width: '100%', height: 160, borderRadius: radii.md, marginBottom: spacing.md, backgroundColor: colors.border },
  bloqueEstado: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.lg },
  textoInfo: { marginTop: spacing.md, fontSize: 15, color: colors.textSecondary },
  textoError: { fontSize: 15, color: colors.danger, textAlign: 'center' },
  etiqueta: { fontSize: 12, fontWeight: '700', color: colors.mintDark, textTransform: 'uppercase', marginTop: spacing.md },
  chipsVincularCultivo: { marginTop: spacing.xs },
  valor: { fontSize: 15, color: colors.textPrimary, marginTop: 2 },
  pasoTexto: { fontSize: 14, color: colors.textPrimary, marginTop: 4 },
  callout: { backgroundColor: colors.badgeSembradoBg, borderRadius: radii.md, padding: spacing.sm, marginTop: spacing.md },
  calloutGallinas: { borderRadius: radii.md, padding: spacing.sm, marginTop: spacing.md },
  calloutTitulo: { fontSize: 12, fontWeight: '700', color: colors.badgeSembradoText, marginBottom: 2 },
  calloutTexto: { fontSize: 13, color: colors.textPrimary },
  recordatorioTexto: { fontSize: 12, color: colors.textSecondary, marginTop: spacing.md, fontStyle: 'italic' },
  filaBotones: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  botonMitad: { flex: 1 },
});
