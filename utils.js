// ============================================================
// utils.js — Funciones puras compartidas por las 3 pantallas.
// Se mantienen aquí (sin dependencias de React) precisamente para
// que sean triviales de testear con Jest sin mockear nada.
// ============================================================

export const TIMEOUT_MS = 20000; // 20s: por encima asumimos red caída/colgada

// Crea un AbortSignal que se auto-cancela pasado timeoutMs. Se usa
// tanto para fetch(Gemini) como para supabase-js (soporta .abortSignal()).
// Sin esto, una petición "colgada" deja el spinner girando para siempre.
export function crearAbortConTimeout(timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, cancelar: () => clearTimeout(id) };
}

// Quita el posible envoltorio ```json ... ``` y parsea. Si el JSON viene
// truncado o inválido, devuelve `valorRespaldo` en vez de lanzar: así una
// respuesta rara de la IA nunca tira la pantalla abajo.
export function limpiarJSONSeguro(textoCrudo, valorRespaldo) {
  if (!textoCrudo) return valorRespaldo;
  const limpio = textoCrudo.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(limpio);
  } catch (e) {
    return valorRespaldo;
  }
}

// Progreso de un cultivo hacia su cosecha, acotado a [0, 1].
// diasCosecha <= 0 se trata como "sin dato" -> progreso 0 (evita división
// por cero o negativos, que darían un porcentaje absurdo en la barra).
export function calcularProgreso(fechaSiembraISO, diasCosecha) {
  if (!fechaSiembraISO || !diasCosecha || diasCosecha <= 0) {
    return { fraccion: 0, diasTranscurridos: 0, diasRestantes: diasCosecha || 0 };
  }
  const inicio = new Date(fechaSiembraISO).getTime();
  if (Number.isNaN(inicio)) {
    return { fraccion: 0, diasTranscurridos: 0, diasRestantes: diasCosecha };
  }
  const ahora = Date.now();
  const msPorDia = 1000 * 60 * 60 * 24;
  const diasTranscurridos = Math.max(0, Math.floor((ahora - inicio) / msPorDia));
  const fraccion = Math.min(1, Math.max(0, diasTranscurridos / diasCosecha));
  const diasRestantes = Math.max(0, diasCosecha - diasTranscurridos);
  return { fraccion, diasTranscurridos, diasRestantes };
}

// Traduce un error clasificado (ver gemini.js) a un mensaje humano en
// español. Centralizado para que Scan y Planner digan siempre lo mismo
// ante el mismo tipo de fallo.
// Quita acentos y pasa a minúsculas, para que buscar "limon" encuentre
// "Limonero" sin que el usuario tenga que teclear la tilde. Compartida
// por el selector de Mi huerto (GardenScreen) y el buscador de catálogo
// (BuscarScreen) para no duplicar la misma normalización en dos sitios.
export function normalizarBusqueda(texto) {
  return (texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// Quita etiquetas HTML simples (p.ej. <strong>...</strong>) de los textos
// enriquecidos del catálogo de plantas, que se escribieron pensando en un
// prototipo web y no se renderizan tal cual en React Native (Text no
// interpreta HTML). Solo se usa para mostrarlos en pantalla; el dato
// original en catalogoPlantas.js se deja intacto.
export function quitarEtiquetasHTML(texto) {
  if (!texto) return texto;
  return String(texto).replace(/<\/?[^>]+>/g, '');
}

// ¿El fallo es por falta de red/cobertura (no por la API en sí)? Se usa
// para guardar la foto en la cola offline en vez de perderla: NetInfo
// puede decir "conectado" con cobertura mínima y aun así fallar la
// petición (bug reportado por Pol: sin cobertura no se guardaba nada).
export function esErrorDeRed(e) {
  if (!e) return false;
  if (e.name === 'AbortError') return true;
  const msg = String(e.message || '').toLowerCase();
  return (
    msg.includes('network request failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('network') ||
    msg.includes('timed out') ||
    msg.includes('timeout')
  );
}

export function mensajeDeError(e) {
  if (e?.name === 'AbortError') {
    return 'La petición ha tardado demasiado (red lenta o caída). Comprueba tu conexión y reintenta.';
  }
  switch (e?.message) {
    case 'RATE_LIMIT':
      return 'Se ha alcanzado el límite gratuito de peticiones a Gemini. Espera un minuto y reintenta (si se repite, el cupo gratuito del día está agotado: vuelve a probar mañana).';
    case 'RATE_LIMIT_DIA':
      return 'Se ha agotado el cupo GRATUITO de hoy de Gemini (se renueva cada día sobre las 9:00). Mientras tanto, el resto de la app funciona con normalidad.';
    case 'AUTH_ERROR':
      return 'La clave de Gemini no es válida. Revísala en Ajustes (se consigue gratis en aistudio.google.com/apikey).';
    case 'SIN_CLAVE_GEMINI':
      return 'Falta tu clave de Gemini. Añádela en Ajustes (se consigue gratis en aistudio.google.com/apikey) para usar el análisis de fotos y el asistente.';
    case 'SERVER_ERROR':
      return 'El servicio de Gemini no está disponible ahora mismo. Ya se ha probado un modelo de respaldo sin éxito: reintenta en unos segundos.';
    case 'BLOQUEO_SEGURIDAD':
      return 'Gemini ha bloqueado esta respuesta por su filtro de seguridad. Prueba a reformular la pregunta o la foto.';
    case 'RESPUESTA_TRUNCADA':
      return 'La respuesta de Gemini se ha cortado por ser demasiado larga. Inténtalo de nuevo con una pregunta más breve.';
    case 'RESPUESTA_VACIA':
      return 'Gemini no ha devuelto un resultado válido. Inténtalo de nuevo.';
    case 'CONFLICTO_CONCURRENCIA':
      return 'Este cultivo se ha modificado desde otro móvil mientras lo editabas. Ciérralo y vuelve a abrirlo para ver los cambios más recientes.';
    case 'Network request failed':
      return 'Sin conexión a internet. Comprueba tu red y vuelve a intentarlo.';
    default:
      if (e?.message?.includes('Failed to fetch')) {
        return 'Sin conexión a internet. Comprueba tu red y vuelve a intentarlo.';
      }
      return 'Ha ocurrido un error inesperado. Inténtalo de nuevo.';
  }
}
