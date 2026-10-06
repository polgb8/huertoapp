// ============================================================
// acciones.js — Acciones rápidas sobre cultivos compartidas por "Hoy" y
// "Mi huerto": marcar regado/podado (con respaldo local y en Supabase)
// y DESHACER (restaura el valor anterior). Nunca lanza.
// ============================================================

import { guardarMarcaLocal } from './registroLocal';
import { marcarCultivoPodado, marcarCultivoRegado, actualizarCultivo } from './supabase';

// campo: 'ultimo_riego' | 'ultima_poda'. Devuelve la fecha puesta.
export async function aplicarMarca(cultivoId, campo) {
  const ahoraISO = new Date().toISOString();
  await guardarMarcaLocal(cultivoId, campo, ahoraISO);
  try {
    if (campo === 'ultimo_riego') await marcarCultivoRegado(cultivoId);
    else await marcarCultivoPodado(cultivoId);
  } catch (e) {
    console.log('Marca guardada solo en el móvil (no bloqueante):', e?.message);
  }
  return ahoraISO;
}

// Deshacer: vuelve a dejar el valor que había antes (o vacío).
export async function deshacerMarca(cultivoId, campo, valorPrevio) {
  await guardarMarcaLocal(cultivoId, campo, valorPrevio ?? null);
  try {
    // Devuelve el nuevo updated_at (para refrescar la copia local).
    return await actualizarCultivo(cultivoId, { [campo]: valorPrevio ?? null });
  } catch (e) {
    console.log('No se pudo deshacer en Supabase (no bloqueante):', e?.message);
    return undefined;
  }
}
