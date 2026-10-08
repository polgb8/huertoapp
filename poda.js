// ============================================================
// poda.js — Avisos de poda POR TEMPORADA y por cultivo real.
//
// Qué cambió (v13, bugs reportados por Pol):
//  - Antes se usaba el campo `poda` del catálogo como "días entre podas".
//    Ese dato viene del prototipo y NO son días (Lavanda = 6, frutales =
//    12…), así que la lavanda pedía poda cada 6 días y cualquier planta
//    añadida "hace 400 días" salía con aviso inmediato, fuera de época.
//  - Ahora cada especie tiene su VENTANA de poda (meses del año, clima
//    mediterráneo / hemisferio norte). El aviso solo sale si:
//      1) la especie se poda (está en CALENDARIO_PODA),
//      2) estamos en su época,
//      3) no se ha podado ya en esta temporada (ultima_poda), y
//      4) no está recién plantada (<90 días, salvo "ya estaba plantada").
//  - Especies que se "pinzan" en crecimiento (albahaca, bonsáis) pueden
//    repetir el aviso dentro de la temporada (repetirCadaDias).
//
// Orientativo: ajusta según tu zona (heladas tardías, variedad, etc.).
// Nunca lanza: datos raros se ignoran.
// ============================================================

import { normalizarBusqueda } from './utils';
import { edadEnAnios } from './riego';

const MS_POR_DIA = 24 * 60 * 60 * 1000;
const DIAS_RECIEN_PLANTADA = 90;

export const NOMBRES_MES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

// Meses 1-12. `tipo` = qué poda se hace; `consejo` = una frase práctica.
const INVIERNO_FRUTAL = { meses: [12, 1, 2], tipo: 'Poda de invierno (en reposo)', consejo: 'Quita ramas secas, cruzadas y chupones; aclara el centro para que entre luz.' };
const CITRICO = { meses: [2, 3, 4], tipo: 'Poda de primavera (tras la cosecha)', consejo: 'Poda suave: chupones, ramas secas y las que tocan el suelo. Evita días de helada.' };
const HUESO_FIN_INVIERNO = { meses: [2, 3], tipo: 'Poda de final de invierno', consejo: 'Poda con la yema hinchada; en frutales de hueso evita cortes grandes con lluvia.' };
const HUESO_VERANO = { meses: [7, 8], tipo: 'Poda de verano (tras la cosecha)', consejo: 'En verano cicatriza mejor y evita la goma; elimina ramas mal orientadas.' };
const PINZADO_BONSAI = { meses: [4, 5, 6, 7, 8, 9], tipo: 'Pinzado de brotes', consejo: 'Recorta los brotes nuevos a 1-2 pares de hojas para mantener la forma.', repetirCadaDias: 30 };

const CALENDARIO_BASE = {
  // Cítricos
  Limonero: CITRICO, Naranjo: CITRICO, Mandarino: CITRICO, Pomelo: CITRICO, Lima: CITRICO,
  // Pepita
  Manzano: INVIERNO_FRUTAL, Peral: INVIERNO_FRUTAL, Membrillero: INVIERNO_FRUTAL,
  // Hueso
  Melocotonero: HUESO_FIN_INVIERNO, Nectarino: HUESO_FIN_INVIERNO, Ciruelo: HUESO_FIN_INVIERNO,
  Cerezo: HUESO_VERANO, Albaricoquero: HUESO_VERANO,
  // Otros frutales
  Higuera: INVIERNO_FRUTAL, Caqui: INVIERNO_FRUTAL, Morera: INVIERNO_FRUTAL, 'Azufaifo (jinjolero)': INVIERNO_FRUTAL,
  Granado: { meses: [1, 2, 3], tipo: 'Poda de final de invierno', consejo: 'Quita chupones de la base y ramas secas; deja 3-4 troncos o un pie limpio.' },
  Olivo: { meses: [2, 3, 4], tipo: 'Poda tras la recolección', consejo: 'Aclara el centro ("que pase un pájaro volando") y quita chupones.' },
  Níspero: { meses: [6, 7], tipo: 'Poda tras la cosecha', consejo: 'Aclara ramas interiores y acorta las muy largas justo después de cosechar.' },
  Aguacate: { meses: [3, 4], tipo: 'Poda ligera de primavera', consejo: 'Solo formación y ramas secas: el aguacate tolera mal podas fuertes.' },
  Chirimoya: { meses: [2, 3], tipo: 'Poda de final de invierno', consejo: 'Poda antes de la brotación; acorta ramas para mantener el árbol bajo.' },
  Madroño: { meses: [2, 3], tipo: 'Poda de limpieza', consejo: 'Solo ramas secas o mal colocadas; apenas necesita poda.' },
  Feijoa: { meses: [3, 4], tipo: 'Poda ligera tras la cosecha', consejo: 'Aclara el interior y da forma, sin podas fuertes.' },
  // Frutos secos
  Nogal: { meses: [8, 9], tipo: 'Poda de final de verano', consejo: 'En primavera "sangra": pódalo a finales de verano, solo lo imprescindible.' },
  Almendro: { meses: [11, 12, 1], tipo: 'Poda en reposo', consejo: 'Aclara el centro y elimina ramas secas tras la caída de la hoja.' },
  Avellano: { meses: [12, 1, 2], tipo: 'Poda de invierno', consejo: 'Quita los hijuelos de la base y aclara las varas viejas.' },
  Castaño: INVIERNO_FRUTAL, Pistachero: INVIERNO_FRUTAL, 'Pacana (nuez pecana)': INVIERNO_FRUTAL,
  // Aromáticas
  Albahaca: { meses: [6, 7, 8, 9], tipo: 'Pinzado (quitar flores)', consejo: 'Despunta los tallos florales para que siga echando hojas.', repetirCadaDias: 21 },
  Romero: { meses: [3, 4], tipo: 'Recorte tras la floración', consejo: 'Recorta 1/3 de los tallos verdes, sin cortar en madera vieja.' },
  Tomillo: { meses: [6, 7], tipo: 'Recorte tras la floración', consejo: 'Recorta las flores secas y un poco de tallo verde para que no se lignifique.' },
  Menta: { meses: [8, 9], tipo: 'Recorte de final de verano', consejo: 'Corta a ras para que rebrote tierna; controla que no invada.' },
  Orégano: { meses: [9, 10], tipo: 'Recorte tras la floración', consejo: 'Corta los tallos florecidos a unos 5 cm del suelo.' },
  Salvia: { meses: [3, 4], tipo: 'Recorte de primavera', consejo: 'Acorta los tallos a la mitad para que no se abra y se haga leñosa.' },
  Laurel: { meses: [3, 4], tipo: 'Poda de forma', consejo: 'Da forma y elimina chupones de la base.' },
  Estragón: { meses: [10, 11], tipo: 'Corte de otoño', consejo: 'Corta los tallos secos a ras de suelo; rebrotará en primavera.' },
  Mejorana: { meses: [7, 8], tipo: 'Recorte tras la floración', consejo: 'Recorta ligeramente para mantenerla compacta.' },
  'Melisa (toronjil)': { meses: [7, 8], tipo: 'Recorte tras la floración', consejo: 'Corta a la mitad para renovar hojas.' },
  'Verbena limón (hierbaluisa)': { meses: [2, 3], tipo: 'Poda fuerte de final de invierno', consejo: 'Corta a 30-40 cm antes de que brote.' },
  // Frutos del bosque
  Frambuesa: { meses: [1, 2], tipo: 'Poda de invierno', consejo: 'Elimina a ras de suelo las cañas que ya dieron fruto y deja 6-8 por metro.' },
  Mora: { meses: [9, 10], tipo: 'Poda tras la cosecha', consejo: 'Corta a ras las cañas que ya fructificaron y guía las nuevas.' },
  Grosella: INVIERNO_FRUTAL,
  Arándano: { meses: [1, 2], tipo: 'Poda de invierno', consejo: 'Quita ramas de más de 5-6 años y las débiles para renovar.' },
  // Arbustos
  Rosal: { meses: [1, 2], tipo: 'Poda de invierno', consejo: 'Deja 3-5 tallos fuertes a 3-4 yemas, corte inclinado sobre yema exterior.' },
  Hortensia: { meses: [2, 3], tipo: 'Poda de final de invierno', consejo: 'Quita flores secas hasta el primer par de yemas gordas; no podes fuerte.' },
  Lavanda: { meses: [8, 9], tipo: 'Recorte tras la floración', consejo: 'Corta las espigas y 2-3 cm de hoja; nunca hasta la madera vieja sin hojas.' },
  Boj: { meses: [5, 6, 9], tipo: 'Recorte de forma', consejo: 'Recorta el crecimiento nuevo para mantener la forma.' },
  Adelfa: { meses: [10, 11], tipo: 'Poda tras la floración', consejo: 'Acorta y aclara. ¡Tóxica!: usa guantes y no la des a las gallinas.' },
  Buganvilla: { meses: [2, 3], tipo: 'Poda de final de invierno', consejo: 'Acorta los tallos del año anterior; florece en madera nueva.' },
  Jazmín: { meses: [9, 10], tipo: 'Poda tras la floración', consejo: 'Aclara y acorta los tallos que ya florecieron.' },
  Camelia: { meses: [4, 5], tipo: 'Poda tras la floración', consejo: 'Poda ligera justo después de florecer, antes de que forme yemas nuevas.' },
  Hibisco: { meses: [3, 4], tipo: 'Poda de primavera', consejo: 'Acorta un tercio para que ramifique y florezca más.' },
  Photinia: { meses: [3, 4, 9], tipo: 'Recorte de forma', consejo: 'Recortar estimula los brotes rojos nuevos.' },
  Durillo: { meses: [4, 5], tipo: 'Poda tras la floración', consejo: 'Recorte ligero de forma tras florecer.' },
  Forsythia: { meses: [4, 5], tipo: 'Poda tras la floración', consejo: 'Poda justo al acabar de florecer; florece en madera del año anterior.' },
  'Buddleja (arbusto de las mariposas)': { meses: [2, 3], tipo: 'Poda fuerte de final de invierno', consejo: 'Corta a 30-50 cm del suelo; florece en madera nueva.' },
  // Interior
  'Ficus lyrata': { meses: [3, 4, 5], tipo: 'Poda de primavera', consejo: 'Despunta para que ramifique; sella el látex con agua tibia.' },
  // Trepadoras
  Hiedra: { meses: [3, 4, 9], tipo: 'Recorte de control', consejo: 'Recorta lo que invada tejados, canalones o ventanas.' },
  Vid: { meses: [1, 2], tipo: 'Poda en seco (invierno)', consejo: 'Deja pulgares de 2 yemas en los sarmientos del año.' },
  'Jazmín trepador': { meses: [6, 7], tipo: 'Poda tras la floración', consejo: 'Aclara y guía los tallos tras florecer.' },
  Clemátide: { meses: [2, 3], tipo: 'Poda de final de invierno', consejo: 'Depende del grupo: en duda, poda suave por encima de yemas vivas.' },
  Madreselva: { meses: [2, 3], tipo: 'Poda de final de invierno', consejo: 'Aclara tallos viejos y enredados.' },
  Kiwi: { meses: [1, 2], tipo: 'Poda de invierno', consejo: 'Acorta los brotes que fructificaron a 2-3 yemas tras la última fruta.' },
  'Pasionaria (maracuyá)': { meses: [3], tipo: 'Poda de primavera', consejo: 'Aclara tallos secos y enredados antes de la brotación.' },
  Glicinia: { meses: [1, 2, 7, 8], tipo: 'Poda de invierno y de verano', consejo: 'Verano: acorta brotes largos a 5-6 hojas. Invierno: a 2-3 yemas.' },
  // Bonsáis
  'Ficus bonsái': PINZADO_BONSAI, 'Junípero bonsái': PINZADO_BONSAI, 'Carmona bonsái': PINZADO_BONSAI,
  'Olivo bonsái': { ...PINZADO_BONSAI, meses: [3, 4, 5, 9] },
  'Arce japonés bonsái': { ...PINZADO_BONSAI, meses: [4, 5, 6] },
};

const CALENDARIO_NORMALIZADO = new Map(
  Object.entries(CALENDARIO_BASE).map(([nombre, info]) => [normalizarBusqueda(nombre), { nombre, ...info }])
);

// ------------------------------------------------------------
// Zona climática (ajustes.js): las podas de invierno / final de invierno
// / primavera (sensibles a heladas) se retrasan en zonas frías y se
// adelantan en zonas cálidas. Las de verano/otoño (tras floración o
// cosecha) no se tocan: dependen de la propia planta.
// ------------------------------------------------------------
const DESPLAZAMIENTO_ZONA = { calida: -1, mediterranea: 0, interior: 1, montana: 1 };
const MESES_SENSIBLES_HELADA = new Set([11, 12, 1, 2, 3, 4]);

function ajustarMesesPorZona(meses, zona) {
  const desplazamiento = DESPLAZAMIENTO_ZONA[zona] || 0;
  if (!desplazamiento) return meses;
  // Solo si TODO el tramo es de invierno/primavera.
  if (!meses.every((m) => MESES_SENSIBLES_HELADA.has(m))) return meses;
  return meses.map((m) => ((m - 1 + desplazamiento + 12) % 12) + 1);
}

// Busca la ficha de poda de un cultivo por nombre (exacto primero, luego
// parcial en cualquier dirección: "Limonero Eureka" -> Limonero).
function buscarInfoPodaBase(nombreCultivo) {
  const buscado = normalizarBusqueda(nombreCultivo).trim();
  if (!buscado) return null;
  if (CALENDARIO_NORMALIZADO.has(buscado)) return CALENDARIO_NORMALIZADO.get(buscado);
  let mejor = null;
  CALENDARIO_NORMALIZADO.forEach((info, clave) => {
    if (buscado.includes(clave) || clave.includes(buscado)) {
      if (!mejor || clave.length > normalizarBusqueda(mejor.nombre).length) mejor = info;
    }
  });
  return mejor;
}

export function buscarInfoPoda(nombreCultivo, zona = 'mediterranea') {
  const info = buscarInfoPodaBase(nombreCultivo);
  if (!info) return null;
  const meses = ajustarMesesPorZona(info.meses, zona);
  return meses === info.meses ? info : { ...info, meses };
}

// Fecha (Date, 9:00) del inicio de la PRÓXIMA temporada de poda que aún
// no ha empezado (para programar el aviso). null si no se poda.
export function inicioProximaTemporada(meses, ahora = new Date()) {
  if (!Array.isArray(meses) || meses.length === 0) return null;
  const set = new Set(meses);
  for (let i = 1; i <= 12; i += 1) {
    const fecha = new Date(ahora.getFullYear(), ahora.getMonth() + i, 1, 9, 0, 0);
    const mes = fecha.getMonth() + 1;
    const anterior = mes === 1 ? 12 : mes - 1;
    if (set.has(mes) && !set.has(anterior)) return fecha;
  }
  return null;
}

// "enero–febrero", "agosto y septiembre", "enero, febrero, julio y agosto"
export function describirMesesPoda(meses) {
  if (!Array.isArray(meses) || meses.length === 0) return '';
  const nombres = meses.map((m) => NOMBRES_MES[m - 1]).filter(Boolean);
  if (nombres.length === 1) return nombres[0];
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

// Inicio (Date) del tramo continuo de meses de poda que contiene `ahora`
// (maneja tramos que cruzan el año, p.ej. dic-ene-feb).
function inicioTemporadaActual(meses, ahora) {
  const set = new Set(meses);
  let mes = ahora.getMonth() + 1;
  let anio = ahora.getFullYear();
  for (let i = 0; i < 12; i += 1) {
    const anterior = mes === 1 ? 12 : mes - 1;
    if (!set.has(anterior)) break;
    mes = anterior;
    if (mes === 12) anio -= 1;
  }
  return new Date(anio, mes - 1, 1);
}

// Último día del tramo continuo que contiene `ahora`.
function finTemporadaActual(meses, ahora) {
  const set = new Set(meses);
  let mes = ahora.getMonth() + 1;
  let anio = ahora.getFullYear();
  for (let i = 0; i < 12; i += 1) {
    const siguiente = mes === 12 ? 1 : mes + 1;
    if (!set.has(siguiente)) break;
    mes = siguiente;
    if (mes === 1) anio += 1;
  }
  return new Date(anio, mes, 0); // día 0 del mes siguiente = último día de `mes`
}

// ------------------------------------------------------------
// v15 — "Cómo podarlo", en 3-4 pasos cortos, según el tipo de poda.
// ------------------------------------------------------------
const PASOS_POR_TIPO = [
  {
    clave: /pinzado/i,
    pasos: [
      'Con los dedos o una tijera pequeña, corta la punta de los brotes nuevos.',
      'Deja 1-2 pares de hojas en cada brote.',
      'Repite cuando vuelvan a alargarse.',
    ],
  },
  {
    clave: /floraci|cosecha|verano/i,
    pasos: [
      'Quita lo que ya floreció o fructificó y las ramas mal orientadas.',
      'No quites más de un tercio de la planta.',
      'Corte limpio justo por encima de una yema o de un par de hojas.',
    ],
  },
  {
    clave: /recorte|forma|control/i,
    pasos: [
      'Recorta solo el crecimiento nuevo.',
      'Deja la base algo más ancha que la parte de arriba para que le llegue luz.',
      'No cortes en madera vieja sin hojas: a veces no rebrota.',
    ],
  },
  {
    clave: /invierno|reposo|seco|primavera|limpieza/i,
    pasos: [
      'Herramienta limpia y afilada (desinfecta con alcohol entre plantas).',
      'Primero ramas secas, rotas o enfermas; luego las que se cruzan o van hacia dentro y los chupones.',
      'Corta en bisel, justo por encima de una yema que mire hacia fuera.',
    ],
  },
];

const ARBOLES_PODA = new Set([
  'limonero', 'naranjo', 'mandarino', 'pomelo', 'lima', 'manzano', 'peral', 'membrillero', 'melocotonero',
  'nectarino', 'ciruelo', 'cerezo', 'albaricoquero', 'higuera', 'caqui', 'morera', 'azufaifo (jinjolero)',
  'granado', 'olivo', 'nispero', 'aguacate', 'chirimoya', 'madrono', 'feijoa', 'nogal', 'almendro', 'avellano',
  'castano', 'pistachero', 'pacana (nuez pecana)',
]);

export function pasosPoda(info, { joven = false } = {}) {
  if (!info) return [];
  const genericos = (PASOS_POR_TIPO.find((p) => p.clave.test(info.tipo)) || PASOS_POR_TIPO[3]).pasos;
  const pasos = [];
  if (joven) {
    pasos.push('Árbol joven: poda de formación suave. Elige 3-4 ramas principales bien repartidas y quita solo lo que compita con ellas.');
  }
  if (info.consejo) pasos.push(info.consejo);
  genericos.forEach((p) => {
    if (pasos.length < 4 && !pasos.includes(p)) pasos.push(p);
  });
  return pasos.slice(0, 4);
}

// Próximo mes de poda a partir de hoy (para mostrar "Próxima poda: ...").
export function proximoMesPoda(meses, ahora = new Date()) {
  if (!Array.isArray(meses) || meses.length === 0) return null;
  const mesActual = ahora.getMonth() + 1;
  for (let i = 1; i <= 12; i += 1) {
    const m = ((mesActual - 1 + i) % 12) + 1;
    if (meses.includes(m)) return m;
  }
  return null;
}

// ------------------------------------------------------------
// calcularAlertasPoda(cultivosActivos, _catalogo?, ahora?)
// El 2º parámetro se mantiene por compatibilidad (ya no hace falta el
// catálogo: el calendario vive aquí).
// ------------------------------------------------------------
export function calcularAlertasPoda(cultivosActivos, _catalogo, ahora = new Date(), zona = 'mediterranea') {
  if (!Array.isArray(cultivosActivos)) return [];
  const mesActual = ahora.getMonth() + 1;
  const alertas = [];

  cultivosActivos.forEach((cultivo) => {
    try {
      const info = buscarInfoPoda(cultivo?.nombre, zona);
      if (!info || !info.meses.includes(mesActual)) return;

      const establecida = cultivo.origen === 'establecida';
      if (!establecida && cultivo.fecha_siembra) {
        const siembra = new Date(cultivo.fecha_siembra).getTime();
        if (!Number.isNaN(siembra) && (ahora.getTime() - siembra) / MS_POR_DIA < DIAS_RECIEN_PLANTADA) return;
      }

      if (cultivo.ultima_poda) {
        const ultima = new Date(cultivo.ultima_poda);
        if (!Number.isNaN(ultima.getTime())) {
          if (info.repetirCadaDias) {
            if ((ahora.getTime() - ultima.getTime()) / MS_POR_DIA < info.repetirCadaDias) return;
          } else if (ultima >= inicioTemporadaActual(info.meses, ahora)) {
            return; // ya podada esta temporada
          }
        }
      }

      const fin = finTemporadaActual(info.meses, ahora);
      const edad = edadEnAnios(cultivo, ahora);
      const joven = ARBOLES_PODA.has(normalizarBusqueda(info.nombre)) && edad != null && edad < 3;
      const diasHastaFin = Math.max(0, Math.ceil((fin.getTime() - ahora.getTime()) / MS_POR_DIA));
      alertas.push({
        cultivoId: cultivo.id,
        nombre: cultivo.nombre,
        variedad: cultivo.variedad || null,
        zona: cultivo.zona || null,
        tipoPoda: info.tipo,
        consejo: info.consejo,
        pasos: pasosPoda(info, { joven }),
        joven,
        mesFin: NOMBRES_MES[fin.getMonth()],
        diasHastaFin,
      });
    } catch (e) {
      // dato raro: se ignora ese cultivo
    }
  });

  alertas.sort((a, b) => a.diasHastaFin - b.diasHastaFin);
  return alertas;
}
