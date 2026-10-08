// ============================================================
// calendarioSiembra.js — Calendario de siembra mes a mes, portado tal
// cual del prototipo (mockup.html) que Pol aprobó como referencia
// visual y funcional para "¿Qué planto ahora?". Es un dato ESTÁTICO y
// determinista (no depende de IA ni de red): para cada especie, en qué
// meses (1=enero … 12=diciembre) tiene sentido sembrarla directa a
// tierra y/o empezarla en semillero para trasplantar después.
//
// Orientativo para clima templado, igual que decía el prototipo — no
// pretende ser exacto para cualquier zona, es la misma referencia que
// ya se le enseñó a Pol y aprobó.
// ============================================================

export const CALENDARIO_SIEMBRA = {
  Acelga: { directa: [1, 2, 3, 4, 5, 9, 10, 11, 12] },
  Espinaca: { directa: [1, 2, 3, 4, 9, 10, 11, 12] },
  Lechuga: { directa: [2, 3, 4, 5, 6, 7, 8, 9, 10], semillero: [1, 2] },
  Rábano: { directa: [2, 3, 4, 5, 6, 9, 10, 11] },
  Zanahoria: { directa: [2, 3, 4, 5, 6, 7] },
  Apio: { semillero: [2, 3, 4] },
  Pimiento: { semillero: [1, 2, 3] },
  Berenjena: { semillero: [1, 2, 3] },
  Cebolla: { directa: [1, 2, 3, 8, 9, 10], semillero: [1, 2, 3, 8, 9] },
  Ajo: { directa: [9, 10, 11, 12, 1, 2] },
  Guisante: { directa: [1, 9, 10, 11, 12] },
  'Judía verde': { directa: [4, 5, 6, 7] },
  Col: { semillero: [2, 3, 4, 6, 7] },
  Brócoli: { semillero: [2, 3, 4, 5, 6, 7] },
  Coliflor: { semillero: [2, 3, 4, 5, 6, 7] },
  Calabacín: { directa: [4, 5, 6], semillero: [3, 4] },
  Calabaza: { directa: [4, 5, 6] },
  Pepino: { directa: [4, 5, 6], semillero: [3, 4] },
  Patata: { directa: [2, 3, 4, 8, 9] },
  Puerro: { semillero: [2, 3, 4] },
  Remolacha: { directa: [3, 4, 5, 6, 7] },
  Maíz: { directa: [5, 6] },
  Fresa: { directa: [8, 9, 10] },
  Albahaca: { semillero: [3, 4], directa: [5, 6, 7] },
  Perejil: { directa: [1, 2, 3, 4, 9, 10, 11, 12] },
  Cilantro: { directa: [3, 4, 5, 9, 10] },
  Cebollino: { directa: [3, 4, 5, 6, 7, 8, 9] },
  Tomate: { semillero: [1, 2, 3] },
};

export const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export const ESTACIONES = [
  'Invierno', 'Invierno', 'Primavera', 'Primavera', 'Primavera', 'Verano',
  'Verano', 'Verano', 'Otoño', 'Otoño', 'Otoño', 'Invierno',
];

// obtenerPlantableEsteMes: para un mes (1-12), qué especies del
// calendario tiene sentido plantar y con qué método.
//   - Si SOLO admite un método ese mes (directa o semillero), se
//     devuelve ese.
//   - Si admite AMBOS ese mismo mes, se devuelve 'cualquiera' (no se
//     prioriza uno sobre otro arbitrariamente, a diferencia del
//     prototipo original: Pol pidió explícitamente distinguir este
//     caso en vez de mostrar siempre "Directa").
// Devuelve [{nombre, metodo}], en el mismo orden en que aparecen en
// CALENDARIO_SIEMBRA (no alfabético: es el orden ya revisado del
// prototipo, de las hortalizas más comunes a las menos habituales).
export function obtenerPlantableEsteMes(mesNumero) {
  const resultado = [];
  for (const nombre of Object.keys(CALENDARIO_SIEMBRA)) {
    const info = CALENDARIO_SIEMBRA[nombre];
    const admiteDirecta = Array.isArray(info.directa) && info.directa.includes(mesNumero);
    const admiteSemillero = Array.isArray(info.semillero) && info.semillero.includes(mesNumero);
    if (!admiteDirecta && !admiteSemillero) continue;
    const metodo = admiteDirecta && admiteSemillero ? 'cualquiera' : admiteDirecta ? 'directa' : 'semillero';
    resultado.push({ nombre, metodo });
  }
  return resultado;
}
