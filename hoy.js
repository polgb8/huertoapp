// ============================================================
// hoy.js — Lógica pura de la pestaña "Hoy": junta en una sola lista lo
// que toca hacer HOY (regar, podar, cosechar, tareas) y lo ya hecho hoy.
// Sin React: testeable con Jest.
// ============================================================

import { calcularProgreso, normalizarBusqueda } from './utils';
import { regadoHoy } from './riego';

const SIN_ZONA = 'Sin zona';

function mismoDia(iso, ahora) {
  if (!iso) return false;
  const f = new Date(iso);
  return (
    !Number.isNaN(f.getTime()) &&
    f.getFullYear() === ahora.getFullYear() &&
    f.getMonth() === ahora.getMonth() &&
    f.getDate() === ahora.getDate()
  );
}

function buscarEspecie(nombre, catalogo) {
  const b = normalizarBusqueda(nombre).trim();
  if (!b || !Array.isArray(catalogo)) return null;
  return (
    catalogo.find((p) => normalizarBusqueda(p.nombre) === b) ||
    catalogo.find((p) => {
      const n = normalizarBusqueda(p.nombre);
      return n.includes(b) || b.includes(n);
    }) ||
    null
  );
}

export function construirHoy({ activos = [], recomendaciones = [], alertasPoda = [], tareas = [], catalogo = [], ahora = new Date() }) {
  const porId = new Map(activos.map((c) => [c.id, c]));

  // 💧 Regar, agrupado por zona (para "Regar todo" de una zona).
  const regar = recomendaciones
    .filter((r) => r.necesitaRiego && porId.has(r.id))
    .map((r) => ({ ...r, zona: porId.get(r.id).zona || SIN_ZONA, previo: porId.get(r.id).ultimo_riego || null }));
  const zonasMap = new Map();
  regar.forEach((r) => {
    if (!zonasMap.has(r.zona)) zonasMap.set(r.zona, []);
    zonasMap.get(r.zona).push(r);
  });
  const regarPorZona = [...zonasMap.entries()]
    .sort(([a], [b]) => (a === SIN_ZONA ? 1 : b === SIN_ZONA ? -1 : a.localeCompare(b, 'es')))
    .map(([zona, items]) => ({ zona, items }));

  const esperandoLluvia = recomendaciones.filter((r) => r.esperaLluvia && porId.has(r.id));

  // ✂️ Podar
  const podar = alertasPoda.map((a) => ({ ...a, previo: porId.get(a.cultivoId)?.ultima_poda || null }));

  // 🧺 Cosechar: anuales con su ciclo cumplido (las perennes no, cosechan por temporada).
  const cosechar = activos.filter((c) => {
    if (c.origen === 'establecida') return false;
    const especie = buscarEspecie(c.nombre, catalogo);
    if (especie && !especie.diasCosecha) return false;
    const { diasRestantes } = calcularProgreso(c.fecha_siembra, c.dias_cosecha);
    return c.fecha_siembra && c.dias_cosecha > 0 && diasRestantes === 0;
  });

  // ✅ Hecho hoy
  const hechos = [];
  activos.forEach((c) => {
    if (regadoHoy(c.ultimo_riego, ahora)) hechos.push({ clave: `r-${c.id}`, id: c.id, nombre: c.nombre, tipo: 'riego', campo: 'ultimo_riego' });
    if (mismoDia(c.ultima_poda, ahora)) hechos.push({ clave: `p-${c.id}`, id: c.id, nombre: c.nombre, tipo: 'poda', campo: 'ultima_poda' });
  });

  const pendientes = regar.length + podar.length + cosechar.length + (tareas?.length || 0);
  return {
    regarPorZona,
    totalRegar: regar.length,
    esperandoLluvia,
    podar,
    cosechar,
    tareas: tareas || [],
    hechos,
    pendientes,
    total: pendientes + hechos.length,
  };
}
