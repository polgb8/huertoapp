// ============================================================
// contextoAsistente.js — Resumen del huerto real para el Asistente
// (cultivos con zona, tamaño, edad, suelo y último riego; zona
// climática; fecha y estación; tiempo actual; pantalla abierta).
// Pura y testeable: recibe los datos ya cargados.
// ============================================================

import { edadEnAnios } from './riego';

const ESTACIONES = ['invierno', 'invierno', 'primavera', 'primavera', 'primavera', 'verano', 'verano', 'verano', 'otoño', 'otoño', 'otoño', 'invierno'];
const NOMBRE_ZONA = { calida: 'cálida (casi sin heladas)', mediterranea: 'mediterránea', interior: 'interior con heladas', montana: 'montaña / fría' };
const NOMBRE_PANTALLA = { Hoy: 'Hoy (tareas del día)', Huerto: 'Mi huerto', Escanear: 'Diagnóstico con foto', Planificar: 'Planificador de siembra', Buscar: 'Buscador de plantas', Ajustes: 'Ajustes (cuenta, clave de IA y ubicación)' };

function diasDesde(iso, ahora) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((ahora.getTime() - t) / 864e5));
}

export function construirContextoAsistente({ cultivos = [], zona, suelo, clima, coords, pantalla, ahora = new Date() } = {}) {
  const partes = [];
  const fecha = ahora.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  partes.push(`Hoy es ${fecha} (${ESTACIONES[ahora.getMonth()]}, hemisferio norte).`);
  if (coords) partes.push(`Huerto en España aprox. en lat ${coords.lat.toFixed(1)}, lon ${coords.lon.toFixed(1)}.`);
  if (zona) partes.push(`Zona climática: ${NOMBRE_ZONA[zona] || zona}.`);
  if (suelo) partes.push(`Suelo del huerto: ${suelo}.`);
  if (clima?.resumenTexto) partes.push(`Tiempo ahora: ${clima.resumenTexto}.`);
  const activos = cultivos.filter((c) => c.estado === 'sembrado').slice(0, 30);
  if (activos.length) {
    const lineas = activos.map((c) => {
      const d = [];
      if (c.variedad) d.push(c.variedad);
      if (c.zona) d.push(`zona ${c.zona}`);
      if (c.cantidad > 1) d.push(`${c.cantidad} uds`);
      if (c.tamano) d.push(`tamaño ${c.tamano}`);
      const edad = edadEnAnios(c, ahora);
      if (edad != null) d.push(edad >= 1 ? `~${Math.round(edad)} años` : `${Math.round(edad * 12)} meses`);
      if (c.tipo_suelo) d.push(`suelo ${c.tipo_suelo}`);
      const riego = diasDesde(c.ultimo_riego, ahora);
      if (riego != null) d.push(riego === 0 ? 'YA REGADO HOY, no hace falta volver a regarlo hoy' : riego === 1 ? 'regado ayer' : `regado hace ${riego} días`);
      return `${c.nombre}${d.length ? ` (${d.join(', ')})` : ''}`;
    });
    partes.push(`Plantas del usuario: ${lineas.join('; ')}.`);
  } else {
    partes.push('El usuario aún no tiene plantas guardadas en la app.');
  }
  if (pantalla) partes.push(`El usuario está ahora en la pantalla "${NOMBRE_PANTALLA[pantalla] || pantalla}".`);
  partes.push('Usa este contexto solo si viene a cuento; no lo repitas entero.');
  return `Contexto del huerto: ${partes.join(' ')}`;
}
