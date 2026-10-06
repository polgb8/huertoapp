// ============================================================
// gemini.js — Llamada centralizada a la API de Gemini, compartida
// por ScanScreen (diagnóstico de una foto), PlannerScreen
// (sugerencias de rotación de cultivos) y AsistenteScreen (chat
// multi-turno). El fetch/timeout/clasificación de errores vive en
// una única función interna (llamarGeminiInterno) para que los tres
// llamadores compartan exactamente la misma lógica de red.
//
// Fiabilidad (auditoría de mejoras): un único modelo fijo hacía que,
// si Google lo retiraba/renombraba/saturaba, las tres pantallas de IA
// fallaran a la vez sin alternativa, y un error transitorio (límite de
// peticiones, sobrecarga puntual) obligaba a Pol a pulsar "reintentar"
// a mano. Ahora llamarConReintentosYRespaldo() se encarga de ambas
// cosas de forma centralizada: reintento automático corto ante un
// error transitorio, y modelo de respaldo si el principal sigue sin
// responder — ScanScreen/PlannerScreen/AsistenteScreen no cambian ni
// una línea, siguen llamando a llamarGemini/llamarGeminiChat igual.
// ============================================================

import { crearAbortConTimeout, limpiarJSONSeguro } from './utils';
import { obtenerClaveGemini } from './claveGemini';
import { registrarPeticionGemini, leerUsoGemini } from './limitesGratis';

// La clave real vive en variables de entorno (.env, prefijo EXPO_PUBLIC_ para que
// Expo la incluya en el bundle del cliente) en vez de hardcodeada aquí — ver
// .env.example. Si falta, la llamada a Gemini fallará con AUTH_ERROR (401/403),
// que ya se gestiona más abajo como un error normal, no un crash.
export const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY;

// Las claves nuevas de Gemini (prefijo "AQ.") no funcionan con ?key= en
// la query string: van por cabecera x-goog-api-key.
// Ver: https://ai.google.dev/gemini-api/docs/api-key
function endpointDelModelo(modelo) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`;
}

// Modelo principal: el mismo que ya se venía usando y que se sabe que
// funciona en esta app. Modelo de respaldo: el alias oficial de Google
// que siempre apunta al modelo "flash" recomendado del momento (ver
// https://ai.google.dev/gemini-api/docs/models) — red de seguridad para
// cuando el principal se retire/renombre/sature, sin depender de que
// alguien recuerde salir a actualizar esta cadena a mano cada vez que
// Google cambia su catálogo de modelos.
export const MODELO_GEMINI_PRINCIPAL = 'gemini-3.5-flash-lite';
// Respaldo con cupo gratuito grande (500/día). 'gemini-flash-latest' solo
// tiene 20/día en el nivel gratuito: queda como último recurso.
export const MODELO_GEMINI_RESPALDO = 'gemini-3.1-flash-lite';
export const MODELO_GEMINI_ULTIMO_RECURSO = 'gemini-flash-latest';
const MODELOS_GEMINI = [MODELO_GEMINI_PRINCIPAL, MODELO_GEMINI_RESPALDO, MODELO_GEMINI_ULTIMO_RECURSO];

// Errores donde reintentar la MISMA petición al MISMO modelo tiene
// sentido (fallo puntual de capacidad/tráfico, no del contenido de la
// petición): un pequeño reintento automático ahorra a Pol tener que
// pulsar "reintentar" a mano para algo que probablemente se resuelve solo.
const ERRORES_TRANSITORIOS = new Set(['RATE_LIMIT', 'SERVER_ERROR']);
// RATE_LIMIT_DIA: cupo diario de ESE modelo agotado -> se pasa al siguiente.

// Todo el conjunto de errores que esta función sabe clasificar (ver
// llamarGeminiInterno más abajo). Solo estos entran en la lógica de
// reintento/respaldo: un fallo de red crudo (sin conexión, timeout del
// AbortController) o un HTTP no reconocido se propagan tal cual, sin
// reintentar ni cambiar de modelo — repetir una petición sin red no
// arregla nada y solo alarga la espera del usuario.
const CODIGOS_CONOCIDOS = new Set([
  'RATE_LIMIT',
  'RATE_LIMIT_DIA',
  'AUTH_ERROR',
  'SERVER_ERROR',
  'BLOQUEO_SEGURIDAD',
  'RESPUESTA_TRUNCADA',
  'RESPUESTA_VACIA',
]);

const RETRASO_REINTENTO_MS = 1500; // 429/503 del nivel gratuito: dar un respiro real
export const TIMEOUT_IMAGEN_MS = 45000;
export const TIMEOUT_TEXTO_MS = 30000;

// Fallo de red "rápido" (la petición ni salió: cambio de antena, wifi->datos):
// merece UN reintento corto. Un timeout (AbortError) no se reintenta: ya
// se esperó bastante y el llamador guardará la foto en la cola offline.
function esFalloDeRedRapido(e) {
  if (!e || e.name === 'AbortError') return false;
  const m = String(e.message || '').toLowerCase();
  return m.includes('network request failed') || m.includes('failed to fetch');
}
function esperar(ms) {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

// ------------------------------------------------------------
// llamarGeminiInterno: la parte "de bajo nivel" — un único intento a un
// único modelo. Construye el body con `contents` ya armados, aplica el
// timeout con AbortController, clasifica errores HTTP y de contenido en
// mensajes-código estables y devuelve el texto crudo de la respuesta
// (sin parsear como JSON: eso lo decide cada llamador, porque el chat
// de AsistenteScreen quiere texto plano, no JSON).
//
// - contents: array ya en el formato de la API ({role, parts:[{text}]}).
// - systemInstruction: opcional, texto de encuadre de sistema.
// - generationConfig: opcional, se mezcla con los valores por defecto
//   (temperature/maxOutputTokens ya puestos aquí).
// - modelo: qué modelo llamar (ver llamarConReintentosYRespaldo).
// ------------------------------------------------------------
async function llamarGeminiInterno({
  contents,
  systemInstruction = null,
  generationConfig = {},
  maxOutputTokens = 512,
  modelo,
}) {
  // Con datos móviles (sin wifi) subir una foto + que Gemini la analice
  // puede pasar de 20 s: con imagen se da más margen (bug real: con
  // cobertura 4G y sin wifi el análisis acababa en error por timeout).
  const llevaImagen = Array.isArray(contents) && contents.some((c) => c?.parts?.some?.((pt) => pt?.inline_data || pt?.inlineData));
  const { signal, cancelar } = crearAbortConTimeout(llevaImagen ? TIMEOUT_IMAGEN_MS : TIMEOUT_TEXTO_MS);
  try {
    const body = {
      contents,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens,
        ...generationConfig,
      },
      ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
    };

    // v11: clave del usuario (Ajustes) o, como respaldo, la del build.
    const claveApi = await obtenerClaveGemini();
    if (!claveApi) throw new Error('SIN_CLAVE_GEMINI');

    const response = await fetch(endpointDelModelo(modelo), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': claveApi,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      if (response.status === 429) {
        // ¿Cupo por minuto (esperar un poco) o DIARIO (agotado hasta mañana)?
        const cuerpo429 = await response.text().catch(() => '');
        const esDiario = /PerDay|per day|RequestsPerDay/i.test(cuerpo429);
        if (esDiario) registrarPeticionGemini(modelo, { agotadoHoy: true });
        throw new Error(esDiario ? 'RATE_LIMIT_DIA' : 'RATE_LIMIT');
      }
      registrarPeticionGemini(modelo);
      if (response.status === 401 || response.status === 403) throw new Error('AUTH_ERROR');
      if (response.status >= 500) throw new Error('SERVER_ERROR');
      const cuerpo = await response.text().catch(() => '');
      // Clave mal copiada: Google responde 400 con API_KEY_INVALID (no 401/403).
      if (response.status === 400 && /API_KEY_INVALID|API key not valid/i.test(cuerpo)) throw new Error('AUTH_ERROR');
      throw new Error(`HTTP_${response.status}: ${cuerpo}`);
    }

    registrarPeticionGemini(modelo);
    const data = await response.json();
    const candidato = data?.candidates?.[0];
    const textoRespuesta = candidato?.content?.parts?.[0]?.text;

    if (!textoRespuesta) {
      // El candidato puede venir vacío por tres motivos bien distintos —
      // antes todos caían en el mismo "RESPUESTA_VACIA" genérico, lo que
      // le impedía a mensajeDeError() (utils.js) dar una pista útil de
      // cuál era el problema real:
      //   1) Bloqueo de seguridad del propio prompt (promptFeedback).
      //   2) Bloqueo de seguridad del candidato ya generado (finishReason).
      //   3) Corte por límite de tokens de salida (finishReason MAX_TOKENS).
      if (data?.promptFeedback?.blockReason || candidato?.finishReason === 'SAFETY') {
        throw new Error('BLOQUEO_SEGURIDAD');
      }
      if (candidato?.finishReason === 'MAX_TOKENS') {
        throw new Error('RESPUESTA_TRUNCADA');
      }
      throw new Error('RESPUESTA_VACIA');
    }

    return textoRespuesta;
  } finally {
    cancelar();
  }
}

// ------------------------------------------------------------
// llamarConReintentosYRespaldo: orquesta reintento (mismo modelo, error
// transitorio) y modelo de respaldo (tras agotar reintentos, o ante un
// error que repetir la misma petición no arreglaría) para que los
// llamadores no tengan que saber nada de esto.
//
// - AUTH_ERROR nunca se reintenta ni cambia de modelo: la clave es la
//   misma para todos los modelos, así que el resultado sería idéntico.
// - Un error NO reconocido (red caída, timeout del AbortController, un
//   HTTP no mapeado) tampoco se reintenta ni cambia de modelo: no se
//   sabe qué lo causó, así que no se puede asumir que reintentar ayude,
//   y alargar la espera del usuario sin motivo es peor que fallar rápido.
// - RATE_LIMIT/SERVER_ERROR (transitorios): un reintento corto al mismo
//   modelo; si sigue fallando, se prueba el modelo de respaldo (con su
//   propio reintento).
// - BLOQUEO_SEGURIDAD/RESPUESTA_TRUNCADA/RESPUESTA_VACIA: repetir la
//   MISMA petición al MISMO modelo no cambiaría el resultado, así que se
//   pasa directo al modelo de respaldo sin reintentar antes.
// ------------------------------------------------------------
async function llamarConReintentosYRespaldo(args) {
  let ultimoError = null;

  // Modelos cuyo cupo diario ya se sabe agotado hoy: se saltan (sin gastar
  // una petición ni tiempo). Si todos lo están, se prueba igualmente.
  let agotados = {};
  try {
    agotados = (await leerUsoGemini()).agotado || {};
  } catch (e) {
    agotados = {};
  }
  const disponibles = MODELOS_GEMINI.filter((m) => !agotados[m]);
  const orden = disponibles.length ? disponibles : MODELOS_GEMINI;

  for (let indiceModelo = 0; indiceModelo < orden.length; indiceModelo += 1) {
    const modelo = orden[indiceModelo];
    const maxIntentosDeEsteModelo = 2; // 1 intento + 1 reintento ante error transitorio

    for (let intento = 0; intento < maxIntentosDeEsteModelo; intento += 1) {
      try {
        return await llamarGeminiInterno({ ...args, modelo });
      } catch (e) {
        ultimoError = e;
        const codigo = e?.message;

        if (esFalloDeRedRapido(e) && intento === 0) {
          await esperar(RETRASO_REINTENTO_MS);
          continue; // un reintento ante un corte puntual de red
        }
        if (!CODIGOS_CONOCIDOS.has(codigo) || codigo === 'AUTH_ERROR') {
          throw e; // no reconocido, o de autenticación: no reintentar ni cambiar de modelo
        }
        if (ERRORES_TRANSITORIOS.has(codigo) && intento === 0) {
          await esperar(RETRASO_REINTENTO_MS);
          continue; // reintenta el MISMO modelo una vez más
        }
        break; // agotado este modelo: prueba el siguiente (si queda alguno)
      }
    }
  }

  throw ultimoError;
}

// ------------------------------------------------------------
// llamarGemini: uso "single-shot" (una instrucción + opcionalmente una
// imagen -> un JSON estructurado). Firma y comportamiento sin cambios
// respecto a antes del refactor: ScanScreen y PlannerScreen siguen
// llamándola exactamente igual.
//
// - promptTexto: instrucción de sistema + contexto (texto plano).
// - imagenBase64: opcional; si se pasa, se adjunta como inline_data.
// - responseSchema: schema (subset OpenAPI) que fuerza a Gemini a
//   devolver esa forma exacta — reduce (no elimina del todo) el riesgo
//   de JSON malformado, ver AUDITORIA.md.
// - valorRespaldo: qué devolver si, aun así, el JSON no se puede parsear.
// ------------------------------------------------------------
export async function llamarGemini({
  promptTexto,
  imagenBase64 = null,
  responseSchema,
  valorRespaldo,
  maxOutputTokens = 512,
}) {
  const parts = [{ text: promptTexto }];
  if (imagenBase64) {
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: imagenBase64 } });
  }

  const textoRespuesta = await llamarConReintentosYRespaldo({
    contents: [{ parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      ...(responseSchema ? { responseSchema } : {}),
    },
    maxOutputTokens,
  });

  return limpiarJSONSeguro(textoRespuesta, valorRespaldo);
}

// Encuadre de sistema por defecto del Asistente: experto de verdad, pero
// que explica todo en llano, igual que el "abuelo agricultor" que ya usa
// ScanScreen para sus diagnósticos — mismo tono en toda la app.
const SYSTEM_ASISTENTE_BASE =
  'Eres "Asistente del huerto", un ingeniero agrónomo con muchos años de campo, experto en TODA la ' +
  'agricultura: huerto, frutales, olivo, viña, cereales, aromáticas, plantas de interior y jardín, suelos, ' +
  'compost y abonado, riego, poda e injerto, plagas y enfermedades (con manejo integrado: primero medidas ' +
  'preventivas, biológicas y ecológicas), calendario de siembra, rotaciones y asociaciones, semillas, ' +
  'clima y heladas, y cría básica de gallinas. Respondes SIEMPRE en español de España, con frases cortas y ' +
  'prácticas, sin tecnicismos salvo que el usuario los use. Formato: respuesta directa primero; luego, si ' +
  'ayuda, una lista breve con guiones "- " y **negrita** solo para lo clave. Máximo ~180 palabras salvo que ' +
  'pidan más detalle. Si falta un dato imprescindible (especie, zona, síntomas), haz UNA pregunta concreta. ' +
  'Si no estás seguro, dilo y explica cómo comprobarlo. Nunca inventes dosis: para fitosanitarios indica ' +
  'usar solo productos autorizados en España, seguir la etiqueta y respetar el plazo de seguridad. ' +
  'Si te mandan una foto, analízala. Usa el contexto del huerto del usuario cuando venga a cuento. Si la ' +
  'pregunta no tiene nada que ver con agricultura o plantas, redirige amablemente.';

// Cuántos turnos recientes del chat se reenvían a Gemini como historial
// (auditoría de mejoras: antes se reenviaba la conversación ENTERA en
// cada mensaje nuevo, sin límite — cuanto más larga la charla, más caro
// y lento cada turno siguiente, sin que el usuario note por qué). 24
// turnos (~12 idas y vueltas) es de sobra para que el Asistente no
// pierda el hilo de una conversación normal sobre el huerto, sin dejar
// crecer el coste sin límite en una charla muy larga.
export const MAX_TURNOS_HISTORIAL_CHAT = 24;

// ------------------------------------------------------------
// llamarGeminiChat: uso multi-turno (chat). A diferencia de llamarGemini,
// no fuerza JSON: el Asistente es conversación en lenguaje natural, así
// que se devuelve el texto de Gemini tal cual (recortando espacios).
//
// - historial: array de turnos previos, cada uno {rol: 'user'|'model', texto}.
//   Se recorta a los últimos MAX_TURNOS_HISTORIAL_CHAT aquí mismo (no en
//   cada pantalla que lo use) para que el límite sea uno solo y
//   consistente pase lo que pase con quien llame a esta función.
// - mensajeNuevo: el mensaje que el usuario acaba de escribir.
// - contextoSistema: opcional, texto extra (p.ej. resumen de cultivos
//   guardados) que se añade al encuadre de sistema por defecto.
// ------------------------------------------------------------
export async function llamarGeminiChat({ historial = [], mensajeNuevo, maxOutputTokens = 512, contextoSistema = '', imagenBase64 = null }) {
  const historialRecortado = historial.slice(-MAX_TURNOS_HISTORIAL_CHAT);

  const contents = [
    ...historialRecortado.map((turno) => ({
      role: turno.rol === 'model' ? 'model' : 'user',
      parts: [{ text: turno.texto }],
    })),
    {
      role: 'user',
      parts: imagenBase64
        ? [{ text: mensajeNuevo }, { inline_data: { mime_type: 'image/jpeg', data: imagenBase64 } }]
        : [{ text: mensajeNuevo }],
    },
  ];

  const systemInstruction = contextoSistema
    ? `${SYSTEM_ASISTENTE_BASE} ${contextoSistema}`
    : SYSTEM_ASISTENTE_BASE;

  const texto = await llamarConReintentosYRespaldo({
    contents,
    systemInstruction,
    maxOutputTokens,
  });

  return texto.trim();
}
