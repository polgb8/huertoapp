// ============================================================
// colaOffline.js — Cola local de capturas pendientes cuando no hay red
// en el momento de analizar una foto. Se persiste en disco con
// expo-file-system (ya instalado, sin dependencias nuevas) en vez de
// en memoria: así sobrevive a que se cierre la app antes de recuperar
// la conexión.
//
// Principio de diseño (igual que clima.js/notificaciones.js): NUNCA
// lanza. Si falla la lectura/escritura del disco, se registra en
// consola y se sigue sin cola — el usuario ya tiene la foto delante
// en el modal; perder la cola es mejor que crashear la app.
// ============================================================

import * as FileSystem from 'expo-file-system/legacy';

const ARCHIVO_COLA = `${FileSystem.documentDirectory}cola-diagnosticos-pendientes.json`;

export async function obtenerColaPendiente() {
  try {
    const info = await FileSystem.getInfoAsync(ARCHIVO_COLA);
    if (!info.exists) return [];
    const contenido = await FileSystem.readAsStringAsync(ARCHIVO_COLA);
    const datos = JSON.parse(contenido);
    return Array.isArray(datos) ? datos : [];
  } catch (e) {
    console.log('No se pudo leer la cola pendiente (no bloqueante):', e?.message);
    return [];
  }
}

export async function encolarCapturaPendiente(item) {
  try {
    const cola = await obtenerColaPendiente();
    cola.push({ ...item, encoladoEn: new Date().toISOString() });
    await FileSystem.writeAsStringAsync(ARCHIVO_COLA, JSON.stringify(cola));
    return true;
  } catch (e) {
    console.log('No se pudo encolar la captura pendiente (no bloqueante):', e?.message);
    return false;
  }
}

// ------------------------------------------------------------
// guardarColaPendiente: persiste el array COMPLETO tal cual se le pasa
// (a diferencia de encolarCapturaPendiente, que añade un elemento nuevo).
// La usa el drenaje automático de la cola (ver App.js) para ir quitando
// el elemento ya procesado sin tener que vaciar toda la cola de golpe.
// ------------------------------------------------------------
export async function guardarColaPendiente(cola) {
  try {
    await FileSystem.writeAsStringAsync(ARCHIVO_COLA, JSON.stringify(Array.isArray(cola) ? cola : []));
    return true;
  } catch (e) {
    console.log('No se pudo guardar la cola pendiente (no bloqueante):', e?.message);
    return false;
  }
}

export async function vaciarColaPendiente() {
  try {
    await FileSystem.deleteAsync(ARCHIVO_COLA, { idempotent: true });
  } catch (e) {
    console.log('No se pudo vaciar la cola pendiente (no bloqueante):', e?.message);
  }
}

// ------------------------------------------------------------
// contarColaPendiente: usado por ScanScreen para mostrar un indicador de
// cuántos diagnósticos quedan por sincronizar (auditoría de mejoras: antes
// no había ninguna pista en pantalla de que hubiera algo pendiente).
// Distingue los "bloqueados" (ver MAX_INTENTOS_ITEM en ScanScreen.js: ya
// se ha reintentado el máximo de veces sin éxito, p.ej. porque Gemini lo
// bloquea sistemáticamente por seguridad) de los que aún se van a seguir
// reintentando solos en cuanto vuelva la conexión.
// ------------------------------------------------------------
export async function contarColaPendiente() {
  const cola = await obtenerColaPendiente();
  return {
    total: cola.length,
    bloqueados: cola.filter((item) => item?.bloqueado).length,
  };
}

// ------------------------------------------------------------
// Pantalla de pendientes (ScanScreen): borrar un elemento concreto y
// desbloquear los que agotaron sus reintentos para volver a probar.
// ------------------------------------------------------------
export async function eliminarDeCola(encoladoEn) {
  const cola = await obtenerColaPendiente();
  return guardarColaPendiente(cola.filter((c) => c.encoladoEn !== encoladoEn));
}

export async function desbloquearCola() {
  const cola = await obtenerColaPendiente();
  return guardarColaPendiente(cola.map((c) => ({ ...c, bloqueado: false, intentosFallidos: 0 })));
}
