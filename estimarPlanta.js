// ============================================================
// estimarPlanta.js — La IA (Gemini) mira la foto de un árbol/arbusto al
// añadirlo y estima: tamaño (pequeño/mediano/grande), diámetro de copa,
// altura y edad aproximada. Con eso el riego se calcula por área de copa
// (FAO-56, ver riego.js) y la poda sabe si es un árbol joven.
//
// Es una ESTIMACIÓN visual: el usuario siempre puede corregirla.
// Lanza los errores de red/API (el llamador decide: es opcional).
// ============================================================

import { llamarGemini } from './gemini';

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    es_planta: { type: 'BOOLEAN' },
    especie_probable: { type: 'STRING' },
    tamano: { type: 'STRING', enum: ['pequeno', 'mediano', 'grande'] },
    altura_m: { type: 'NUMBER' },
    diametro_copa_m: { type: 'NUMBER' },
    edad_anios: { type: 'NUMBER' },
    confianza: { type: 'STRING', enum: ['baja', 'media', 'alta'] },
    comentario: { type: 'STRING' },
    tipo_suelo: { type: 'STRING', enum: ['arenoso', 'franco', 'arcilloso', 'no_visible'] },
    suelo_detalle: { type: 'STRING' },
    salud_estado: { type: 'STRING', enum: ['sana', 'leve', 'problema'] },
    salud_detalle: { type: 'STRING' },
    agua_estado: { type: 'STRING', enum: ['bien', 'falta', 'exceso', 'no_se_sabe'] },
    agua_detalle: { type: 'STRING' },
    recomendaciones: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['es_planta', 'tamano', 'diametro_copa_m', 'edad_anios', 'confianza', 'tipo_suelo', 'salud_estado', 'agua_estado'],
};

const RESPALDO = { es_planta: false };

function acotar(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.min(max, Math.max(min, v));
}

export function normalizarEstimacion(crudo) {
  if (!crudo || crudo.es_planta !== true) return null;
  const tamano = ['pequeno', 'mediano', 'grande'].includes(crudo.tamano) ? crudo.tamano : null;
  const diametro = acotar(crudo.diametro_copa_m, 0.2, 15);
  if (!tamano && !diametro && !crudo.especie_probable) return null;
  return {
    especieProbable: typeof crudo.especie_probable === 'string' ? crudo.especie_probable.trim() : '',
    tamano: tamano || (diametro ? (diametro < 1.8 ? 'pequeno' : diametro < 3.5 ? 'mediano' : 'grande') : 'mediano'),
    diametroCopa: diametro ? Math.round(diametro * 10) / 10 : null,
    altura: acotar(crudo.altura_m, 0.1, 40),
    edadAnios: acotar(crudo.edad_anios, 0, 150) != null ? Math.round(acotar(crudo.edad_anios, 0, 150)) : null,
    confianza: ['baja', 'media', 'alta'].includes(crudo.confianza) ? crudo.confianza : 'baja',
    comentario: typeof crudo.comentario === 'string' ? crudo.comentario.trim() : '',
    tipoSuelo: ['arenoso', 'franco', 'arcilloso'].includes(crudo.tipo_suelo) ? crudo.tipo_suelo : null,
    sueloDetalle: texto(crudo.suelo_detalle),
    salud: ['sana', 'leve', 'problema'].includes(crudo.salud_estado) ? crudo.salud_estado : null,
    saludDetalle: texto(crudo.salud_detalle),
    agua: ['bien', 'falta', 'exceso'].includes(crudo.agua_estado) ? crudo.agua_estado : null,
    aguaDetalle: texto(crudo.agua_detalle),
    recomendaciones: Array.isArray(crudo.recomendaciones)
      ? crudo.recomendaciones.filter((r) => typeof r === 'string' && r.trim()).map((r) => r.trim()).slice(0, 3)
      : [],
  };
}

function texto(v) {
  return typeof v === 'string' ? v.trim() : '';
}

// v16: análisis completo de la foto al añadir una planta.
export async function analizarFotoPlanta(fotoBase64, nombreIndicado) {
  return estimarTamanoYEdad(fotoBase64, nombreIndicado);
}

export async function estimarTamanoYEdad(fotoBase64, nombreIndicado) {
  const prompt =
    'Eres un ingeniero agrónomo experto en fruticultura y arboricultura. Mira la foto de esta planta' +
    (nombreIndicado ? ` (el usuario dice que es: "${nombreIndicado}")` : '') +
    ' y estima de forma realista, usando referencias visuales de escala (personas, muros, macetas, vallas, ' +
    'puertas, hojas): la especie probable, el tamaño (pequeno = joven o menos de ~1,8 m de copa; mediano = ' +
    '~1,8-3,5 m; grande = más de ~3,5 m), el diámetro de la copa en metros, la altura en metros y la edad ' +
    'aproximada en años (grosor del tronco, estructura de ramas, porte). Si no hay referencias de escala, ' +
    'baja la confianza. Si la foto no muestra una planta, es_planta=false. "comentario": una frase corta ' +
    'en español llano explicando en qué te basas. ' +
    'Además: (1) TIPO DE SUELO: solo si se ve tierra desnuda en la foto, estima su textura por el color, ' +
    'las grietas al secarse (arcilloso), si se ve suelta y granulada (arenoso) o intermedia (franco); si no se ' +
    've tierra o hay mantillo/césped, usa "no_visible". "suelo_detalle": una frase. ' +
    '(2) SALUD: "sana", "leve" (algo menor) o "problema"; "salud_detalle": qué ves (hojas, manchas, plagas). ' +
    '(3) AGUA: "falta" si ves hojas lacias, enrolladas, bordes secos o tierra muy agrietada; "exceso" si ves ' +
    'amarilleo general con tierra encharcada; "bien" si parece correcta; "no_se_sabe" si no se aprecia. ' +
    '"agua_detalle": una frase. (4) "recomendaciones": hasta 3 consejos prácticos y cortos para hoy. ' +
    'Todo en español llano, sin tecnicismos. Devuelve solo el JSON.';
  const crudo = await llamarGemini({
    promptTexto: prompt,
    imagenBase64: fotoBase64,
    responseSchema: SCHEMA,
    valorRespaldo: RESPALDO,
    maxOutputTokens: 700,
  });
  return normalizarEstimacion(crudo);
}
