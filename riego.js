// ============================================================
// riego.js — "Riego de hoy" personalizado por cultivo: cruza el balance
// hídrico real ya calculado por clima.js (lluvia de las últimas 48h
// frente a la demanda de evapotranspiración de hoy, en litros/m² que
// faltan por cubrir) con la ficha de cada especie sembrada
// (catalogoPlantas.js: tipo de planta y método de riego habitual) para
// decir, cultivo a cultivo, si toca regar hoy, cuánta agua aproximada y,
// si el método es goteo, cuántos minutos dejarlo abierto.
//
// Es una ESTIMACIÓN orientativa, no una medición real de humedad de
// suelo (no hay sensores): reparte el déficit ya calculado por m² entre
// las plantas según su tamaño típico (categoría del catálogo). Sigue
// siendo mucho más útil que un mensaje genérico de "riega hoy" sin más,
// que es lo que había antes.
// ============================================================

import { normalizarBusqueda } from './utils';

// Litros de referencia por planta/unidad cuando el déficit del día es
// "moderado" (unos 3 mm sin cubrir por la lluvia, ver DEFICIT_REFERENCIA_MM
// más abajo) — se escalan linealmente al déficit real de hoy. Valores
// orientativos por categoría (`tipo`, tal cual aparece en cada especie
// de catalogoPlantas.js).
// v14: recalibrado. Pol vio "15 regaderas" para un cerezo/limonero: el
// valor anterior (15 L/día) era de un árbol adulto grande y, además, se
// multiplicaba por los días entre riegos. Ahora es la referencia de un
// árbol MEDIANO (copa ~2-3 m), y se ajusta con el tamaño elegido en la
// planta (pequeño/joven x0.5, grande x2) — ver FACTOR_TAMANO.
// Resultado orientativo con demanda moderada (~3 mm/día): árbol mediano
// ~30 L por riego semanal; joven ~15 L; grande ~60 L.
const LITROS_REFERENCIA_POR_TIPO = {
  '🌳 Árbol frutal': 6,
  '🎍 Bonsái': 0.5,
  '🌺 Arbusto': 2,
  '🍓 Fruto del bosque': 1.5,
  '🥕 Hortaliza': 1.2,
  '🌿 Aromática': 0.4,
  '🧗 Trepadora': 2,
  '🌷 Bulbosa': 0.6,
  '🍠 Rizomatosa/tuberosa': 1,
  '🏠 Interior': 0.3,
  '🌵 Cactus/suculenta': 0.1,
  '🥩 Carnívora': 0.3,
  '🌸 Orquídea': 0.2,
};
const LITROS_REFERENCIA_DEFECTO = 2; // especie no identificada en el catálogo
const DEFICIT_REFERENCIA_MM = 3;
const KC_HORTALIZA = 1.05;
const LITROS_POR_REGADERA = 5;

// Tamaño de la planta (solo tiene sentido en leñosas grandes).
export const TIPOS_CON_TAMANO = ['🌳 Árbol frutal', '🌺 Arbusto', '🧗 Trepadora', '🍓 Fruto del bosque'];
export const FACTOR_TAMANO = { pequeno: 0.5, mediano: 1, grande: 2 };

// Evapotranspiración de referencia media mensual (mm/día) en clima
// mediterráneo peninsular — orientativa, para el riego SIN datos del
// tiempo de hoy (sin ubicación). Enero ... diciembre.
const ETO_MENSUAL_MM = [1.0, 1.5, 2.5, 3.3, 4.3, 5.2, 5.7, 5.0, 3.7, 2.3, 1.3, 0.9];
// Ajuste por zona climática (ver ajustes.js).
const FACTOR_ZONA_ETO = { calida: 1.1, mediterranea: 1, interior: 1.05, montana: 0.8 };

// Personalización real por especie (no solo por categoría): cada planta
// del catálogo tiene un campo `riego` = cada cuántos días se riega en
// condiciones normales (p.ej. un cactus con riego:20 aguanta 20 días
// entre riegos; una zanahoria con riego:4 necesita agua mucho más a
// menudo) — dato que ya existía en catalogoPlantas.js pero que hasta
// ahora ningún sitio de la app consultaba. Cuanto más bajo ese número,
// más intensa es la necesidad real de esa especie concreta, así que se
// usa para escalar los litros de referencia de su categoría: dos
// hortalizas de la misma categoría (p.ej. Calabacín y Zanahoria) ya no
// salen con la misma cifra si su necesidad real de riego es distinta.
const DIAS_RIEGO_REFERENCIA = 5;
const DIAS_RIEGO_DEFECTO = 5;
const INTENSIDAD_MIN = 0.35;
const INTENSIDAD_MAX = 2.5;

function intensidadPorEspecie(especie) {
  const dias = Number(especie?.riego) > 0 ? Number(especie.riego) : DIAS_RIEGO_DEFECTO;
  const intensidad = DIAS_RIEGO_REFERENCIA / dias;
  return Math.min(INTENSIDAD_MAX, Math.max(INTENSIDAD_MIN, intensidad));
}

// Caudal orientativo del goteo por planta (L/h), según su tamaño típico
// (más goteros/mayor caudal en un árbol que en una hortaliza pequeña).
const CAUDAL_LH_POR_TIPO = {
  '🌳 Árbol frutal': 8,
  '🌺 Arbusto': 4,
  '🍓 Fruto del bosque': 2,
  '🥕 Hortaliza': 2,
  '🧗 Trepadora': 3,
};
const CAUDAL_LH_DEFECTO = 2;

function esRiegoPorGoteo(metodoRiegoTexto) {
  return normalizarBusqueda(metodoRiegoTexto || '').includes('goteo');
}

// "Ya lo he regado hoy" (mismo patrón que ultima_poda en poda.js, ver
// migracion_v7.sql): si el cultivo ya se marcó como regado HOY (mismo
// día de calendario, hora local del móvil) en CUALQUIERA de los dos
// móviles, se suprime la recomendación de riego el resto del día en
// vez de seguir pidiendo regar algo que ya se ha regado.
export function regadoHoy(ultimoRiegoISO, ahora = new Date()) {
  if (!ultimoRiegoISO) return false;
  const fecha = new Date(ultimoRiegoISO);
  if (Number.isNaN(fecha.getTime())) return false;
  return (
    fecha.getFullYear() === ahora.getFullYear() &&
    fecha.getMonth() === ahora.getMonth() &&
    fecha.getDate() === ahora.getDate()
  );
}

// Traduce litros a una cantidad fácil de entender con una regadera
// doméstica estándar (~5 L) — lo que Pol pidió explícitamente ("media
// regadera") en vez de una cifra sola en litros.
export function formatearCantidadRegaderas(litros) {
  if (!(litros > 0)) return null;
  const regaderas = litros / LITROS_POR_REGADERA;
  if (regaderas < 0.15) return `un chorro pequeño (~${litros.toFixed(1)} L)`;
  if (regaderas < 0.4) return `un cuarto de regadera (~${litros.toFixed(1)} L)`;
  if (regaderas < 0.75) return `media regadera (~${litros.toFixed(1)} L)`;
  if (regaderas < 1.15) return `una regadera (~${litros.toFixed(1)} L)`;
  if (regaderas >= 3.75) return `~${Math.round(litros)} L (unas ${Math.round(regaderas)} regaderas)`;
  const enteras = Math.floor(regaderas);
  const resto = regaderas - enteras;
  const restoTexto = resto >= 0.4 ? ' y media' : '';
  return `${enteras} regadera${enteras > 1 ? 's' : ''}${restoTexto} (~${litros.toFixed(1)} L)`;
}

// Empareja el nombre guardado en cultivos_huerto con una especie del
// catálogo: primero coincidencia exacta (sin acentos/mayúsculas), y si
// no hay ninguna, la primera coincidencia parcial en cualquier
// dirección (p.ej. "Tomate" guardado a mano encuentra "Tomate de rama").
function buscarEnCatalogo(nombreCultivo, catalogoPlano) {
  const buscado = normalizarBusqueda(nombreCultivo);
  if (!buscado || !Array.isArray(catalogoPlano)) return null;
  const exacta = catalogoPlano.find((p) => normalizarBusqueda(p.nombre) === buscado);
  if (exacta) return exacta;
  return (
    catalogoPlano.find((p) => {
      const nombrePlanta = normalizarBusqueda(p.nombre);
      return nombrePlanta.includes(buscado) || buscado.includes(nombrePlanta);
    }) || null
  );
}

// Días desde el último riego confirmado (null si no se sabe).
function diasDesdeUltimoRiego(ultimoRiegoISO, ahora = new Date()) {
  if (!ultimoRiegoISO) return null;
  const t = new Date(ultimoRiegoISO).getTime();
  if (Number.isNaN(t)) return null;
  const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).getTime();
  const inicioDia = new Date(new Date(t).getFullYear(), new Date(t).getMonth(), new Date(t).getDate()).getTime();
  return Math.max(0, Math.round((inicioHoy - inicioDia) / (24 * 60 * 60 * 1000)));
}

// Frecuencia habitual (días) SOLO si la especie la tiene en el catálogo.
function frecuenciaEspecie(especie) {
  const dias = Number(especie?.riego);
  return dias > 0 ? Math.max(1, Math.round(dias)) : null;
}

function textoFrecuencia(frecuencia) {
  if (!frecuencia) return '';
  return frecuencia <= 1 ? 'a diario' : `cada ~${frecuencia} días`;
}

// `litros` es el total de TODAS las plantas de ese cultivo; en goteo cada
// planta tiene su gotero y riegan a la vez, así que el tiempo se calcula
// con los litros de UNA planta (bug v17: salían 864 min para 4 tomates).
export function textoCantidad(litros, porGoteo, tipo, cantidad = 1, caudalPlanta = null) {
  if (!(litros > 0)) return null;
  if (porGoteo) {
    const caudal = caudalPlanta || ((tipo && CAUDAL_LH_POR_TIPO[tipo]) ?? CAUDAL_LH_DEFECTO);
    const porPlanta = litros / Math.max(1, Number(cantidad) || 1);
    const minutos = Math.max(2, Math.round((porPlanta / caudal) * 60));
    const tiempo = minutos >= 90 ? `${Math.round((minutos / 60) * 2) / 2} h`.replace('.', ',') : `${minutos} min`;
    const reparto = minutos > 240 ? ', mejor en 2-3 tandas' : '';
    return `Goteo: unos ${tiempo}${reparto} (${Number(litros.toFixed(1)).toString().replace('.', ',')} L en total)`;
  }
  return formatearCantidadRegaderas(litros);
}

// Ficha base por cultivo (común a todos los casos).
// ------------------------------------------------------------
// v15 — ÁRBOLES: método FAO-56 (Allen et al., 1998, "Crop
// evapotranspiration", FAO Irrigation and Drainage Paper 56):
//   agua (L/día) = ETo (mm/día) × Kc × área de copa (m²)
// (1 mm sobre 1 m² = 1 L). El área de copa sale del diámetro estimado
// por la IA desde la foto, o del tamaño elegido. Kc orientativos de la
// tabla 12 de FAO-56 ajustados a árbol aislado de huerto; en caducos,
// Kc sigue la fenología (0 en reposo invernal). En cerezo y albaricoquero
// se aplica riego deficitario controlado tras la cosecha (≈60 %), práctica
// habitual y estudiada en frutales de hueso.
// ------------------------------------------------------------
export const DIAMETRO_COPA_POR_TAMANO = { pequeno: 1.2, mediano: 2.5, grande: 4.5 };

const KC_ARBOL = {
  limonero: 0.65, naranjo: 0.65, mandarino: 0.65, pomelo: 0.65, lima: 0.65,
  olivo: 0.6, aguacate: 0.75, nogal: 1.0, almendro: 0.85, pistachero: 0.8,
  higuera: 0.7, granado: 0.7, 'azufaifo (jinjolero)': 0.65, madrono: 0.6, nispero: 0.7,
};
const KC_CADUCO_DEFECTO = 0.9;
const KC_PERENNE_DEFECTO = 0.7;

const ARBOLES_CADUCOS = new Set([
  'manzano', 'peral', 'melocotonero', 'nectarino', 'ciruelo', 'cerezo', 'albaricoquero', 'membrillero',
  'higuera', 'granado', 'caqui', 'morera', 'azufaifo (jinjolero)', 'nogal', 'almendro', 'avellano',
  'castano', 'pistachero', 'pacana (nuez pecana)',
]);
// Fracción del Kc por mes (ene..dic) en caducos: reposo dic-feb.
const CURVA_CADUCO = [0, 0, 0.3, 0.6, 1, 1, 1, 1, 0.8, 0.55, 0.3, 0];
const RDI_POSTCOSECHA = new Set(['cerezo', 'albaricoquero']);
const MESES_POSTCOSECHA_RDI = new Set([7, 8, 9, 10]);

export function edadEnAnios(cultivo, ahora = new Date()) {
  if (!cultivo?.fecha_siembra) return null;
  if (cultivo.origen === 'establecida' && !cultivo.edad_estimada) return null; // fecha de alta, no de plantación
  const t = new Date(cultivo.fecha_siembra).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, (ahora.getTime() - t) / (365.25 * 24 * 60 * 60 * 1000));
}

function factorArbol(especie, ahora) {
  const clave = normalizarBusqueda(especie?.nombre || '');
  const caduco = ARBOLES_CADUCOS.has(clave);
  let kc = KC_ARBOL[clave] ?? (caduco ? KC_CADUCO_DEFECTO : KC_PERENNE_DEFECTO);
  const mes = ahora.getMonth() + 1;
  if (caduco) kc *= CURVA_CADUCO[mes - 1];
  if (RDI_POSTCOSECHA.has(clave) && MESES_POSTCOSECHA_RDI.has(mes)) kc *= 0.6;
  return { kc, enReposo: caduco && CURVA_CADUCO[mes - 1] === 0 };
}

// v16 — Tipo de suelo: la arena retiene poca agua (riegos más cortos y
// seguidos), la arcilla mucha (más espaciados y abundantes). FAO-56
// (tabla 19: agua disponible total por textura). La cantidad por riego
// se ajusta sola porque se calcula como consumo diario × días del ciclo.
export const FACTOR_SUELO_FRECUENCIA = { arenoso: 0.7, franco: 1, arcilloso: 1.3 };

function fichaBase(cultivo, catalogoPlano, ahora = new Date(), opciones = {}) {
  const f = fichaBaseSinSuelo(cultivo, catalogoPlano, ahora);
  const suelo = cultivo.tipo_suelo || opciones.suelo;
  const factor = FACTOR_SUELO_FRECUENCIA[suelo];
  if (factor && f.frecuencia && f.frecuencia > 1) {
    f.frecuencia = Math.max(1, Math.round(f.frecuencia * factor));
  }
  return f;
}

function fichaBaseSinSuelo(cultivo, catalogoPlano, ahora = new Date()) {
  const especie = buscarEnCatalogo(cultivo.nombre, catalogoPlano);
  const tipo = especie?.tipo;
  const cantidad = Math.max(1, Number(cultivo.cantidad) || 1);
  const porGoteo = esRiegoPorGoteo(especie?.metodoRiego);
  let frecuencia = frecuenciaEspecie(especie);

  if (tipo === '🌳 Árbol frutal') {
    const diametro = Number(cultivo.diametro_copa) > 0
      ? Number(cultivo.diametro_copa)
      : DIAMETRO_COPA_POR_TAMANO[cultivo.tamano] ?? DIAMETRO_COPA_POR_TAMANO.mediano;
    const area = Math.PI * (diametro / 2) ** 2;
    const { kc, enReposo } = factorArbol(especie, ahora);
    // Árbol joven (<2 años): raíces superficiales -> riegos más seguidos.
    const edad = edadEnAnios(cultivo, ahora);
    if (frecuencia && edad != null && edad < 2) frecuencia = Math.max(2, Math.round(frecuencia / 2));
    return {
      especie,
      tipo,
      cantidad,
      esArbol: true,
      enReposo,
      litrosDiaReferencia: DEFICIT_REFERENCIA_MM * kc * area * cantidad,
      porGoteo,
      frecuencia,
      // Goteo de un árbol: ~1 gotero de 4 L/h por cada 1,5 m² de copa.
      caudal: Math.max(8, Math.ceil(area / 1.5) * 4),
    };
  }

  // v17 — Hortalizas: FAO-56 por superficie (ETo × Kc × marco de
  // plantación). Antes se usaba un valor fijo por tipo (1,2 L/día) que
  // multiplicado por la "intensidad" daba p.ej. ~3,6 L/día a una lechuga
  // (real: ~0,2-0,4 L/día). El marco sale de la distancia de siembra del
  // catálogo; Kc de mitad de ciclo ≈ 1,05 (FAO-56, tabla 12).
  const distanciaCm = Number(especie?.siembra?.distanciaCm);
  if (tipo === '🥕 Hortaliza' && distanciaCm > 0) {
    const marco = (Math.max(15, Math.min(120, distanciaCm)) / 100) ** 2;
    return {
      especie,
      tipo,
      cantidad,
      litrosDiaReferencia: DEFICIT_REFERENCIA_MM * KC_HORTALIZA * marco * cantidad,
      porGoteo,
      frecuencia,
      caudal: marco >= 0.49 ? 4 : 2, // plantas grandes (calabacín…): 2 goteros
    };
  }

  const litrosRef = (tipo && LITROS_REFERENCIA_POR_TIPO[tipo]) ?? LITROS_REFERENCIA_DEFECTO;
  const factorTamano = tipo && TIPOS_CON_TAMANO.includes(tipo) ? FACTOR_TAMANO[cultivo.tamano] ?? 1 : 1;
  return {
    especie,
    tipo,
    cantidad,
    litrosDiaReferencia: litrosRef * cantidad * factorTamano * intensidadPorEspecie(especie),
    porGoteo,
    frecuencia,
  };
}

const TEXTO_REPOSO = 'En reposo invernal: no necesita riego (solo si hay sequía larga)';

function entrada(cultivo, base, extra) {
  return {
    id: cultivo.id,
    nombre: cultivo.nombre,
    zona: cultivo.zona || null,
    cantidad: base.cantidad,
    porGoteo: base.porGoteo,
    frecuencia: base.frecuencia,
    litrosTotales: 0,
    necesitaRiego: false,
    yaRegadoHoy: false,
    ...extra,
  };
}

// calcularRecomendacionesRiego: núcleo de "Riego de hoy" en GardenScreen.
//   - cultivosActivos: filas reales de cultivos_huerto (estado 'sembrado'),
//     cada una con al menos {id, nombre, zona?, cantidad?, ultimo_riego?}.
//   - catalogoPlano: lista plana de especies del catálogo.
//   - balance: el objeto que devuelve calcularBalanceHidrico() (clima.js).
// Devuelve null si no hay balance todavía (ver calcularRiegoOrientativo).
// SIEMPRE devuelve una entrada por cultivo cuando hay balance (antes, con
// lluvia o sin déficit, no salía nada debajo de cada planta y parecía que
// la app no calculaba el riego — bug reportado por Pol).
export function calcularRecomendacionesRiego(cultivosActivos, catalogoPlano, balance, ahora = new Date(), opciones = {}) {
  if (!balance) return null;
  const lista = Array.isArray(cultivosActivos) ? cultivosActivos : [];
  const deficitMm = balance.litrosPorM2;

  const sinRiegoHoy = (mensajeGeneral, detalle) => ({
    tocaRegar: false,
    mensajeGeneral,
    recomendaciones: lista.map((c) => {
      const base = fichaBase(c, catalogoPlano, ahora, opciones);
      const yaRegadoHoy = regadoHoy(c.ultimo_riego);
      return entrada(c, base, { yaRegadoHoy, detalle: yaRegadoHoy ? 'Ya regado hoy ✓' : detalle });
    }),
  });

  if (balance.lluviaSuficiente) {
    return sinRiegoHoy('La lluvia ha regado por ti: hoy no hace falta regar ningún cultivo.', 'Hoy no hace falta regar (ha llovido) 🌧️');
  }
  if (deficitMm == null) {
    return sinRiegoHoy('Sin datos suficientes para recomendar riego hoy. Usa tu criterio.', 'Sin datos del tiempo hoy: revisa la humedad de la tierra');
  }
  if (!(deficitMm > 0)) {
    return sinRiegoHoy('Con la lluvia reciente y la demanda de hoy, no hace falta regar.', 'Hoy no hace falta regar');
  }

  if (lista.length === 0) {
    return {
      tocaRegar: true,
      mensajeGeneral: `Riega hoy: unos ${deficitMm} litros por m² en general. Añade tus cultivos abajo para ver la cantidad exacta por planta.`,
      recomendaciones: [],
    };
  }

  const factorEscala = deficitMm / DEFICIT_REFERENCIA_MM;
  const lluviaPrevista = Number(balance.lluviaPrevistaMm) || 0;
  const prob = balance.probabilidadLluviaPrevista;
  const lluviaFuerte = lluviaPrevista >= 8 && (prob == null || prob >= 60);
  const lluviaModerada = !lluviaFuerte && lluviaPrevista >= 3 && (prob == null || prob >= 50);

  const recomendaciones = lista.map((cultivo) => {
    const base = fichaBase(cultivo, catalogoPlano, ahora, opciones);
    const yaRegadoHoy = regadoHoy(cultivo.ultimo_riego);
    if (yaRegadoHoy) return entrada(cultivo, base, { yaRegadoHoy: true, detalle: 'Ya regado hoy ✓' });
    if (base.enReposo) return entrada(cultivo, base, { detalle: TEXTO_REPOSO });

    // Respeta la frecuencia de la especie: si se regó hace menos días de
    // los que aguanta (p.ej. un cactus cada 20 días), hoy no toca.
    const diasDesde = diasDesdeUltimoRiego(cultivo.ultimo_riego, ahora);
    if (base.frecuencia && diasDesde != null && diasDesde < base.frecuencia) {
      const faltan = base.frecuencia - diasDesde;
      return entrada(cultivo, base, {
        detalle: `Regado hace ${diasDesde} día${diasDesde === 1 ? '' : 's'} · próximo riego en ~${faltan} día${faltan === 1 ? '' : 's'}`,
      });
    }

    // Riego profundo y espaciado: la cantidad cubre el agua de un ciclo
    // de su frecuencia (o los días transcurridos, si son menos).
    let diasAcumulados = base.frecuencia || 1;
    if (diasDesde != null && base.frecuencia) diasAcumulados = Math.min(Math.max(diasDesde, 1), base.frecuencia);
    let litrosTotales = Number((base.litrosDiaReferencia * factorEscala * diasAcumulados).toFixed(1));
    const frecuenciaTexto = textoFrecuencia(base.frecuencia);

    // v16 — Lluvia prevista (hoy + mañana): si viene bastante, esperar;
    // si viene poca, regar menos.
    if (lluviaFuerte) {
      return entrada(cultivo, base, {
        esperaLluvia: true,
        detalle: `🌧️ Se esperan ~${lluviaPrevista} mm: mejor espera, no riegues hoy`,
      });
    }
    let notaLluvia = '';
    if (lluviaModerada) {
      litrosTotales = Number((litrosTotales * Math.max(0.3, 1 - lluviaPrevista / 8)).toFixed(1));
      notaLluvia = ` · menos agua: se esperan ~${lluviaPrevista} mm`;
    }
    const cantidadTexto = textoCantidad(litrosTotales, base.porGoteo, base.tipo, base.cantidad, base.caudal);

    return entrada(cultivo, base, {
      litrosTotales,
      litrosDia: Number((base.litrosDiaReferencia * factorEscala).toFixed(2)),
      necesitaRiego: litrosTotales > 0,
      detalle: cantidadTexto
        ? `${cantidadTexto}${notaLluvia}${frecuenciaTexto && base.frecuencia > 1 ? ` · luego ${frecuenciaTexto}` : ''}`
        : 'Hoy no necesita riego extra',
    });
  });

  return {
    tocaRegar: recomendaciones.some((r) => r.necesitaRiego),
    mensajeGeneral: lluviaFuerte
      ? `🌧️ Se esperan ~${lluviaPrevista} mm entre hoy y mañana: espera antes de regar.`
      : `Déficit de hoy: ${deficitMm} L/m² sin cubrir por la lluvia.${
          lluviaModerada ? ` Viene algo de lluvia (~${lluviaPrevista} mm): riega menos.` : ''
        }`,
    recomendaciones,
  };
}

// calcularRiegoOrientativo: cuando todavía no hay balance (sin ubicación
// o sin conexión con el servicio del tiempo), se muestra igualmente bajo
// cada planta su riego HABITUAL según el catálogo (frecuencia + cantidad
// orientativa en un día de demanda moderada), en vez de no mostrar nada.
export function calcularRiegoOrientativo(cultivosActivos, catalogoPlano, ahora = new Date(), zona = 'mediterranea', opciones = {}) {
  const lista = Array.isArray(cultivosActivos) ? cultivosActivos : [];
  // Demanda típica del mes (en invierno mucho menos agua y más espaciada).
  const factorMes = (ETO_MENSUAL_MM[ahora.getMonth()] * (FACTOR_ZONA_ETO[zona] ?? 1)) / DEFICIT_REFERENCIA_MM;
  return {
    tocaRegar: false,
    orientativo: true,
    mensajeGeneral: 'Riego orientativo (sin datos del tiempo de hoy).',
    recomendaciones: lista.map((c) => {
      const base = fichaBase(c, catalogoPlano, ahora, opciones);
      const yaRegadoHoy = regadoHoy(c.ultimo_riego);
      const frecuenciaAjustada = base.frecuencia
        ? Math.max(1, Math.round(base.frecuencia / Math.min(1, Math.max(0.35, factorMes))))
        : null;
      const litros = Number((base.litrosDiaReferencia * factorMes * (frecuenciaAjustada || 1)).toFixed(1));
      const cantidad = textoCantidad(litros, base.porGoteo, base.tipo, base.cantidad, base.caudal);
      const frecuencia = textoFrecuencia(frecuenciaAjustada);
      let detalle;
      if (yaRegadoHoy) detalle = 'Ya regado hoy ✓';
      else if (base.enReposo) detalle = TEXTO_REPOSO;
      else if (cantidad && frecuencia) detalle = `Habitual: ${frecuencia} · ${cantidad}`;
      else if (cantidad) detalle = `Habitual: ${cantidad}`;
      else detalle = 'Riega cuando la tierra esté seca a 2-3 cm';
      return entrada(c, base, { yaRegadoHoy, litrosTotales: litros, detalle });
    }),
  };
}

// ------------------------------------------------------------
// v15 — calcularAvisosRiego: fechas de los próximos recordatorios de
// riego (notificaciones locales), agrupadas por día. Pura y testeable.
//   recomendaciones: salida de calcularRecomendacionesRiego/Orientativo
//   cultivos: filas (para ultimo_riego)
//   hora: hora del aviso (0-23). Devuelve [{ fecha: Date, nombres: [] }]
// Reglas: hoy si toca y la hora no ha pasado (si ya pasó, a las 19:00
// si aún se llega); después, cada `frecuencia` días desde el último
// riego (o desde hoy), hasta 3 ciclos y como mucho 30 días vista.
// ------------------------------------------------------------
export function calcularAvisosRiego(recomendaciones, cultivos, ahora = new Date(), hora = 9, minuto = 0) {
  const porId = new Map((Array.isArray(cultivos) ? cultivos : []).map((c) => [c.id, c]));
  const limite = ahora.getTime() + 30 * 24 * 60 * 60 * 1000;
  const grupos = new Map();
  const anadir = (fecha, nombre) => {
    if (fecha.getTime() <= ahora.getTime() || fecha.getTime() > limite) return;
    const clave = fecha.toISOString();
    if (!grupos.has(clave)) grupos.set(clave, { fecha, nombres: [] });
    if (!grupos.get(clave).nombres.includes(nombre)) grupos.get(clave).nombres.push(nombre);
  };
  const diaA = (base, sumaDias, h, m = minuto) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + sumaDias, h, m, 0);

  (Array.isArray(recomendaciones) ? recomendaciones : []).forEach((r) => {
    if (!r || r.enReposo || /reposo/i.test(r.detalle || '')) return;
    const nombre = r.nombre;
    const freq = r.frecuencia || null;
    if (r.necesitaRiego) {
      const hoyHora = diaA(ahora, 0, hora);
      // Si la hora elegida ya pasó hoy, se avisa a las 19:00 (si aún no
      // han pasado); si no, mañana a la hora elegida.
      const tarde = diaA(ahora, 0, 19, 0);
      if (hoyHora.getTime() > ahora.getTime()) anadir(hoyHora, nombre);
      else if (tarde.getTime() > ahora.getTime()) anadir(tarde, nombre);
      else anadir(diaA(ahora, 1, hora), nombre);
    }
    if (!freq) return;
    const ultimo = porId.get(r.id)?.ultimo_riego ? new Date(porId.get(r.id).ultimo_riego) : null;
    const base = ultimo && !Number.isNaN(ultimo.getTime()) ? ultimo : ahora;
    for (let k = 1; k <= 3; k += 1) anadir(diaA(base, freq * k, hora), nombre);
  });

  return [...grupos.values()].sort((a, b) => a.fecha - b.fecha).slice(0, 20);
}
