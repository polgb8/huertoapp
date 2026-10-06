// ============================================================
// limitesGratis.js — Cuánto queda de los planes GRATUITOS y avisos.
//
// Gemini (Google AI Studio, nivel gratuito). Límites leídos en AI Studio
// → "Límite de frecuencia" el 6 oct 2026 (Google no los publica en la
// documentación y pueden cambiar; se aplican POR PROYECTO de Google, es
// decir, por clave). El cupo diario se reinicia a medianoche hora del
// Pacífico (≈ 9:00 en España).
//
// Supabase Free: 500 MB de base de datos y 1 GB de fotos (supabase.com/
// pricing). En el plan gratuito Supabase NO cobra: si se supera, limita.
//
// Contador local: cada móvil cuenta las peticiones que hace. Si usas la
// MISMA clave en dos móviles, el total real es la suma (se avisa en
// Ajustes). Nunca lanza.
// ============================================================

import AsyncStorage from '@react-native-async-storage/async-storage';

export const LIMITES_GEMINI = {
  'gemini-3.5-flash-lite': { rpm: 15, rpd: 500, nombre: 'Gemini 3.5 Flash-Lite' },
  'gemini-3.1-flash-lite': { rpm: 15, rpd: 500, nombre: 'Gemini 3.1 Flash-Lite' },
  'gemini-flash-latest': { rpm: 5, rpd: 20, nombre: 'Gemini Flash (respaldo)' },
};

export const LIMITES_SUPABASE = {
  baseDatosBytes: 500 * 1024 * 1024,
  fotosBytes: 1024 * 1024 * 1024,
};

export const UMBRAL_AVISO = 0.8; // avisar al 80 %

const CLAVE = 'huertoapp:uso-gemini-v1';

// Día "de Google": medianoche en hora del Pacífico (PST UTC-8, PDT UTC-7
// del 2º domingo de marzo al 1er domingo de noviembre). Se calcula a mano
// para no depender de Intl con zonas horarias (incompleto en Hermes).
function enHorarioVerano(fechaUTC) {
  const anio = fechaUTC.getUTCFullYear();
  const domingoN = (mes, n) => {
    const d = new Date(Date.UTC(anio, mes, 1));
    const primerDomingo = 1 + ((7 - d.getUTCDay()) % 7);
    return primerDomingo + 7 * (n - 1);
  };
  // Cambios a las 2:00 locales = 10:00 UTC (marzo) y 9:00 UTC (noviembre).
  const inicio = Date.UTC(anio, 2, domingoN(2, 2), 10);
  const fin = Date.UTC(anio, 10, domingoN(10, 1), 9);
  const t = fechaUTC.getTime();
  return t >= inicio && t < fin;
}

export function diaPacifico(ahora = new Date()) {
  const desfaseHoras = enHorarioVerano(ahora) ? -7 : -8;
  const local = new Date(ahora.getTime() + desfaseHoras * 3600 * 1000);
  return local.toISOString().slice(0, 10);
}

// Hora (en el móvil) a la que se reinicia el cupo diario de Gemini.
export function horaReinicioLocal(ahora = new Date()) {
  const desfaseHoras = enHorarioVerano(ahora) ? 7 : 8;
  const dia = diaPacifico(ahora);
  const [a, m, d] = dia.split('-').map(Number);
  const siguiente = new Date(Date.UTC(a, m - 1, d + 1, desfaseHoras));
  return `${String(siguiente.getHours()).padStart(2, '0')}:${String(siguiente.getMinutes()).padStart(2, '0')}`;
}

async function leerBruto() {
  try {
    const v = JSON.parse((await AsyncStorage.getItem(CLAVE)) || 'null');
    return v && typeof v === 'object' ? v : null;
  } catch (e) {
    return null;
  }
}

// Uso de hoy: { dia, porModelo: { [modelo]: n }, agotado: { [modelo]: true } }
export async function leerUsoGemini(ahora = new Date()) {
  const dia = diaPacifico(ahora);
  const v = await leerBruto();
  if (!v || v.dia !== dia) return { dia, porModelo: {}, agotado: {} };
  return { dia, porModelo: v.porModelo || {}, agotado: v.agotado || {} };
}

async function guardar(uso) {
  try {
    await AsyncStorage.setItem(CLAVE, JSON.stringify(uso));
  } catch (e) {
    // sin consecuencias
  }
}

// Se llama tras cada petición que llegó a Google (también si falló, salvo
// 429). `agotadoHoy` = Google respondió que el cupo DIARIO se acabó.
export async function registrarPeticionGemini(modelo, { agotadoHoy = false, ahora = new Date() } = {}) {
  try {
    const uso = await leerUsoGemini(ahora);
    if (agotadoHoy) {
      uso.agotado[modelo] = true;
    } else {
      uso.porModelo[modelo] = (uso.porModelo[modelo] || 0) + 1;
    }
    await guardar(uso);
  } catch (e) {
    // nunca bloquea una petición
  }
}

export function nivelUso(usado, limite) {
  if (!limite) return 'ok';
  const r = usado / limite;
  if (r >= 1) return 'agotado';
  if (r >= UMBRAL_AVISO) return 'cerca';
  return 'ok';
}

// Resumen para la UI. El modelo principal es el que marca el aviso.
export function resumirUsoGemini(uso, modeloPrincipal = 'gemini-3.5-flash-lite') {
  const filas = Object.entries(LIMITES_GEMINI).map(([modelo, l]) => {
    const usado = uso?.porModelo?.[modelo] || 0;
    const agotado = !!uso?.agotado?.[modelo];
    return {
      modelo,
      nombre: l.nombre,
      usado,
      limite: l.rpd,
      nivel: agotado ? 'agotado' : nivelUso(usado, l.rpd),
    };
  });
  const principal = filas.find((f) => f.modelo === modeloPrincipal) || filas[0];
  const todosAgotados = filas.every((f) => f.nivel === 'agotado');
  return { filas, principal, todosAgotados, nivel: todosAgotados ? 'agotado' : principal.nivel };
}

export function formatearBytes(b) {
  if (!Number.isFinite(b)) return '—';
  const fmt = (v, dec) => String(Number(v.toFixed(dec))).replace('.', ',');
  if (b >= 1024 ** 3) return `${fmt(b / 1024 ** 3, 2)} GB`;
  if (b >= 1024 ** 2) return `${fmt(b / 1024 ** 2, 1)} MB`;
  if (b >= 1024) return `${Math.round(b / 1024)} KB`;
  return `${b} B`;
}

export function resumirUsoSupabase(datos) {
  if (!datos) return null;
  const bd = Number(datos.db_bytes);
  const fotos = Number(datos.storage_bytes) || 0;
  const filas = [
    { clave: 'bd', nombre: 'Base de datos', usado: bd, limite: LIMITES_SUPABASE.baseDatosBytes },
    { clave: 'fotos', nombre: 'Fotos', usado: fotos, limite: LIMITES_SUPABASE.fotosBytes },
  ].map((f) => ({ ...f, nivel: nivelUso(f.usado, f.limite), texto: `${formatearBytes(f.usado)} de ${formatearBytes(f.limite)}` }));
  const peor = filas.some((f) => f.nivel === 'agotado') ? 'agotado' : filas.some((f) => f.nivel === 'cerca') ? 'cerca' : 'ok';
  return { filas, nivel: peor };
}
