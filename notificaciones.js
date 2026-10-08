// ============================================================
// notificaciones.js — Recordatorios locales (sin servidor push,
// coste 0). Se usan para "revisa esta planta en N días" (Scan) y
// para avisar cerca de la fecha de cosecha (Garden/Planner).
//
// Principio de diseño: nunca deben bloquear el flujo principal. Si el
// usuario deniega el permiso, o el dispositivo no soporta algo, se
// registra en consola y se sigue sin recordatorio — guardar el
// diagnóstico/cultivo es lo importante, la notificación es un extra.
//
// Desde Expo SDK 53, Expo Go ya no soporta expo-notifications en
// Android: en cuanto el módulo nativo se toca, muestra un aviso amarillo
// persistente en pantalla — y esto pasa nada más CARGARSE el módulo
// (con un `import` normal), aunque luego no se llame a ninguna de sus
// funciones. Por eso aquí NO hay un `import * as Notifications from
// 'expo-notifications'` de los normales: se hace con un `require()`
// perezoso, dentro del `if`, para que en Expo Go el módulo no se toque
// EN ABSOLUTO — ni siquiera para registrarlo. En un build nativo real
// (no Expo Go) esto no cambia nada: se sigue requiriendo y usando igual
// que siempre.
// ============================================================

import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ENTORNO_ES_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

let Notifications = null;
if (!ENTORNO_ES_EXPO_GO) {
  // eslint-disable-next-line global-require
  Notifications = require('expo-notifications');
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

let permisoSolicitado = false;

async function asegurarPermiso() {
  if (!Notifications) return false;
  try {
    const actual = await Notifications.getPermissionsAsync();
    if (actual.granted) return true;
    if (permisoSolicitado && !actual.canAskAgain) return false;

    permisoSolicitado = true;
    const pedido = await Notifications.requestPermissionsAsync();
    return !!pedido.granted;
  } catch (e) {
    console.log('No se pudo comprobar/pedir permiso de notificaciones:', e?.message);
    return false;
  }
}

// ------------------------------------------------------------
// programarRecordatorio: agenda una notificación local en una fecha
// futura. Devuelve el id (o null si no se pudo programar) sin lanzar
// nunca — un fallo aquí no debe tirar abajo el guardado del dato real.
// En Expo Go (ver nota de cabecera) siempre devuelve null sin más: no
// hay recordatorio, pero tampoco ningún aviso molesto en pantalla.
// ------------------------------------------------------------
export async function programarRecordatorio({ titulo, cuerpo, fecha }) {
  if (!Notifications) return null;
  try {
    if (!fecha || fecha.getTime() <= Date.now()) return null;

    const concedido = await asegurarPermiso();
    if (!concedido) return null;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('avisos-huerto', {
        name: 'Avisos del huerto (riego, poda, revisiones)',
        importance: Notifications.AndroidImportance.HIGH ?? Notifications.AndroidImportance.DEFAULT,
      });
    }

    return await Notifications.scheduleNotificationAsync({
      content: { title: titulo, body: cuerpo },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fecha, channelId: 'avisos-huerto' },
    });
  } catch (e) {
    console.log('No se pudo programar el recordatorio (no bloqueante):', e?.message);
    return null;
  }
}

// ------------------------------------------------------------
// notificarAhora: aviso local inmediato (p.ej. "tu diagnóstico pendiente
// ya está listo" al drenar la cola offline). Nunca lanza.
// ------------------------------------------------------------
export async function notificarAhora({ titulo, cuerpo }) {
  if (!Notifications) return null;
  try {
    const concedido = await asegurarPermiso();
    if (!concedido) return null;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('avisos-huerto', {
        name: 'Avisos del huerto (riego, poda, revisiones)',
        importance: Notifications.AndroidImportance.HIGH ?? Notifications.AndroidImportance.DEFAULT,
      });
    }
    return await Notifications.scheduleNotificationAsync({
      content: { title: titulo, body: cuerpo },
      // Android: canal propio (importancia alta = aparece en pantalla).
      trigger: Platform.OS === 'android' ? { channelId: 'avisos-huerto' } : null,
    });
  } catch (e) {
    console.log('No se pudo mostrar la notificación (no bloqueante):', e?.message);
    return null;
  }
}

// ------------------------------------------------------------
// reprogramarAvisosPoda: una notificación el PRIMER DÍA de la época de
// poda de cada grupo de plantas (p.ej. "1 dic · ✂️ Empieza la poda:
// Manzano, Higuera"). Se agrupan por fecha para no llenar de avisos.
// Solo se reprograma si cambió algo (firma guardada), cancelando los
// avisos de poda anteriores. Nunca lanza.
//   avisos: [{ fecha: Date, nombres: string[] }]
// ------------------------------------------------------------
const CLAVE_AVISOS_PODA = 'huertoapp:avisos-poda-programados-v1';
const CLAVE_AVISOS_RIEGO = 'huertoapp:avisos-riego-programados-v1';

function listaNombres(nombres) {
  return nombres.length > 3 ? `${nombres.slice(0, 3).join(', ')} y ${nombres.length - 3} más` : nombres.join(', ');
}

async function asegurarCanal() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('avisos-huerto', {
      name: 'Avisos del huerto (riego, poda, revisiones)',
      importance: Notifications.AndroidImportance.HIGH ?? Notifications.AndroidImportance.DEFAULT,
    });
  }
}

// Reprograma un grupo de avisos (poda o riego): cancela los anteriores de
// ese grupo y programa los nuevos, solo si algo cambió (firma).
async function reprogramarGrupo(clave, avisos, construirContenido) {
  if (!Notifications) return false;
  try {
    const validos = (Array.isArray(avisos) ? avisos : [])
      .filter((a) => a?.fecha instanceof Date && a.fecha.getTime() > Date.now() && a.nombres?.length)
      .sort((a, b) => a.fecha - b.fecha);
    const firma = JSON.stringify(validos.map((a) => [a.fecha.toISOString(), [...a.nombres].sort()]));

    let previo = null;
    try {
      previo = JSON.parse((await AsyncStorage.getItem(clave)) || 'null');
    } catch (e) {
      previo = null;
    }
    if (previo?.firma === firma) return true;

    for (const id of previo?.ids || []) {
      await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
    }
    if (validos.length === 0) {
      await AsyncStorage.setItem(clave, JSON.stringify({ firma, ids: [] }));
      return true;
    }
    if (!(await asegurarPermiso())) return false;
    await asegurarCanal();
    const ids = [];
    for (const aviso of validos) {
      const id = await Notifications.scheduleNotificationAsync({
        content: construirContenido(aviso),
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: aviso.fecha, channelId: 'avisos-huerto' },
      }).catch(() => null);
      if (id) ids.push(id);
    }
    await AsyncStorage.setItem(clave, JSON.stringify({ firma, ids }));
    return true;
  } catch (e) {
    console.log('No se pudieron programar los avisos (no bloqueante):', e?.message);
    return false;
  }
}

// avisos: [{ fecha: Date, nombres: string[] }]. [] cancela todos.
export function reprogramarAvisosPoda(avisos) {
  return reprogramarGrupo(CLAVE_AVISOS_PODA, avisos, (a) => ({
    title: '✂️ Empieza la época de poda',
    body: `Toca podar: ${listaNombres(a.nombres)}. Abre Mi huerto para ver cómo, paso a paso.`,
  }));
}

export function reprogramarAvisosRiego(avisos) {
  return reprogramarGrupo(CLAVE_AVISOS_RIEGO, avisos, (a) => ({
    title: '💧 Toca regar',
    body: `${listaNombres(a.nombres)}. Abre Mi huerto para ver cuánta agua según el tiempo de hoy.`,
  }));
}

// Notificación de prueba desde Ajustes (comprueba permisos y canal).
// Al cerrar sesión (v11): cancela TODOS los avisos programados en este
// móvil, para que quien entre después no reciba los de la cuenta anterior.
// Nunca lanza.
export async function cancelarTodosLosAvisos() {
  if (!Notifications) return;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (e) {
    console.log('No se pudieron cancelar los avisos (no bloqueante):', e?.message);
  }
}

export async function enviarNotificacionPrueba() {
  const id = await notificarAhora({ titulo: '🌿 HuertoApp', cuerpo: 'Las notificaciones funcionan correctamente.' });
  return !!id;
}
