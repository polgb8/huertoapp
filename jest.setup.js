// ============================================================
// jest.setup.js — Mocks globales de módulos nativos de Expo (no hay
// cámara, GPS ni notificaciones reales en Jest) + un guardián de
// unhandled promise rejections para toda la suite.
//
// Se registra vía "setupFilesAfterEnv" en package.json, así que
// jest.mock / beforeEach / afterEach / process ya están disponibles
// aquí. Un archivo de test puede redefinir cualquiera de estos mocks
// con su propio jest.mock(...) local si necesita control fino por test
// (p.ej. permiso de cámara denegado en un caso concreto): el mock
// local de ese archivo gana sobre este por defecto, exactamente igual
// que ya hace screens/ScanScreen.test.js.
// ============================================================

jest.mock('expo-camera', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    useCameraPermissions: () => [
      { granted: true },
      jest.fn(() => Promise.resolve({ granted: true })),
    ],
    CameraView: React.forwardRef((props, ref) => {
      React.useImperativeHandle(ref, () => ({
        takePictureAsync: jest.fn(() => Promise.resolve({ uri: 'file://foto-mock.jpg' })),
      }));
      return React.createElement(View, { testID: 'camera-view' }, props.children);
    }),
  };
});

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(() =>
    Promise.resolve({ uri: 'file://foto-redimensionada-mock.jpg', base64: 'ZmFrZWJhc2U2NA==' })
  ),
  SaveFormat: { JPEG: 'jpeg' },
}));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('id-notificacion-mock')),
  cancelScheduledNotificationAsync: jest.fn(() => Promise.resolve()),
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  getForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  getLastKnownPositionAsync: jest.fn(() => Promise.resolve(null)),
  Accuracy: { Balanced: 3 },
  getCurrentPositionAsync: jest.fn(() =>
    Promise.resolve({ coords: { latitude: 40.4, longitude: -3.7 } })
  ),
}));

// Módulos adicionales necesarios para montar cualquier pantalla sin
// tocar código nativo real. No estaban en la lista pedida explícita
// pero son imprescindibles: sin ellos, `npx jest` fallaría igual al
// intentar cargar módulos con partes nativas.
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file://mock-document-directory/',
  deleteAsync: jest.fn(() => Promise.resolve()),
  getInfoAsync: jest.fn(() => Promise.resolve({ exists: false })),
  readAsStringAsync: jest.fn(() => Promise.resolve('[]')),
  writeAsStringAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));

jest.mock('expo-image', () => {
  const { Image } = require('react-native');
  return { Image };
});

// expo-image-picker: usado por GardenScreen para la foto opcional de un
// cultivo (ver seleccionarYComprimirImagen). Por defecto simula que el
// usuario cancela el selector, así ningún test que no toque este botón
// se ve afectado; un test que sí lo necesite puede redefinir este mock
// localmente con jest.mock('expo-image-picker', ...) como ya hace
// ScanScreen.test.js con expo-camera.
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(() => Promise.resolve({ canceled: true, assets: null })),
  launchCameraAsync: jest.fn(() => Promise.resolve({ canceled: true, assets: null })),
  requestCameraPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  MediaTypeOptions: { Images: 'Images' },
}));

jest.mock('react-native-url-polyfill/auto', () => ({}));

// Iconos: en Jest se sustituyen por un <Text> con el nombre (evita cargar
// fuentes nativas / expo-asset).
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  const Icono = ({ name }) => React.createElement(Text, null, name);
  return { Ionicons: Icono, MaterialCommunityIcons: Icono };
});

// AsyncStorage (registroLocal.js, ubicacion.js): mock oficial en memoria.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// ------------------------------------------------------------
// Variables de entorno EXPO_PUBLIC_* (gemini.js/supabase.js las leen en vez
// de tener las claves hardcodeadas — ver AUDITORIA_V6.md). En Jest no se carga
// ningún .env real: se ponen valores de prueba aquí para que los tests que
// comprueban cabeceras/llamadas (gemini.test.js) sigan viendo un valor
// truthy, sin depender de que exista un .env en el entorno de CI/local.
// ------------------------------------------------------------
process.env.EXPO_PUBLIC_GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || 'test-gemini-key';
process.env.EXPO_PUBLIC_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'test-anon-key';

// ------------------------------------------------------------
// Guardián de unhandled promise rejections (requisito nº1 del QA:
// "sin lanzar un unhandled promise rejection"). Se engancha y
// desengancha en cada test individual -- no se queda un listener
// acumulado entre archivos de test.
// ------------------------------------------------------------
let rechazosNoCapturados = [];
function onRechazoNoCapturado(motivo) {
  rechazosNoCapturados.push(motivo);
}

beforeEach(() => {
  rechazosNoCapturados = [];
  process.on('unhandledRejection', onRechazoNoCapturado);
});

afterEach(() => {
  process.off('unhandledRejection', onRechazoNoCapturado);
  if (rechazosNoCapturados.length > 0) {
    const primero = rechazosNoCapturados[0];
    const detalle = primero?.stack || primero?.message || String(primero);
    throw new Error(
      `Se ${rechazosNoCapturados.length > 1 ? 'han' : 'ha'} detectado ${rechazosNoCapturados.length} ` +
        `unhandled promise rejection(s) durante el test. Primera: ${detalle}`
    );
  }
});
