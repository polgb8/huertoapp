// ============================================================
// screens/ScanScreen.test.js — Tests de interacción del Módulo A (v4).
// La clasificación de errores HTTP y el parseo de Gemini se testean a
// su propio nivel en gemini.test.js; aquí se mockea `llamarGemini`,
// `../supabase`, `../store`, `../clima`, `../notificaciones` y
// `@react-navigation/native` (useRoute) para comprobar el
// comportamiento de la PANTALLA: esquema en lenguaje llano, selector
// de modo (plagas/poda/cosecha), acceso directo por parámetro de ruta,
// y el aviso de seguridad para gallinas.
// ============================================================

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';

let mockPermissionState = { granted: true };
const mockRequestPermission = jest.fn(() => Promise.resolve(mockPermissionState));
const mockTakePictureAsync = jest.fn();

jest.mock('expo-camera', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    useCameraPermissions: () => [mockPermissionState, mockRequestPermission],
    CameraView: React.forwardRef((props, ref) => {
      React.useImperativeHandle(ref, () => ({ takePictureAsync: mockTakePictureAsync }));
      React.useEffect(() => {
        props.onCameraReady && props.onCameraReady();
      }, []);
      return <View testID="camera-view">{props.children}</View>;
    }),
  };
});

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(() =>
    Promise.resolve({ uri: 'file://foto-redimensionada.jpg', base64: 'ZmFrZWJhc2U2NA==' })
  ),
  SaveFormat: { JPEG: 'jpeg' },
}));

jest.mock('expo-file-system/legacy', () => ({ deleteAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('react-native-url-polyfill/auto', () => ({}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));

jest.mock('expo-image', () => {
  const { Image: ImagenReal } = require('react-native');
  return { Image: ImagenReal };
});

jest.mock('../clima', () => ({ obtenerClimaActual: jest.fn(() => Promise.resolve(null)) }));
jest.mock('../notificaciones', () => ({ programarRecordatorio: jest.fn(() => Promise.resolve(null)), notificarAhora: jest.fn(() => Promise.resolve(null)), reprogramarAvisosPoda: jest.fn(() => Promise.resolve(true)) }));

const mockEncolarCapturaPendiente = jest.fn(() => Promise.resolve(true));
const mockContarColaPendiente = jest.fn(() => Promise.resolve({ total: 0, bloqueados: 0 }));
const mockObtenerColaPendiente = jest.fn(() => Promise.resolve([]));
jest.mock('../colaOffline', () => ({
  encolarCapturaPendiente: (...args) => mockEncolarCapturaPendiente(...args),
  contarColaPendiente: (...args) => mockContarColaPendiente(...args),
  obtenerColaPendiente: (...args) => mockObtenerColaPendiente(...args),
  guardarColaPendiente: jest.fn(() => Promise.resolve(true)),
  eliminarDeCola: jest.fn(() => Promise.resolve(true)),
  desbloquearCola: jest.fn(() => Promise.resolve(true)),
}));

// Estado de la store simplificado y mutable por test, sin depender de
// zustand real: como en ScanScreen se usa `useAppStore((s) => s.x)`,
// basta con que el mock invoque el selector sobre un objeto plano.
let mockEstadoStore = { conectado: true, coords: null, clima: null };
const mockSetClima = jest.fn();
const mockSetUltimoDiagnostico = jest.fn();
jest.mock('../store', () => ({
  useAppStore: (selector) =>
    selector({
      ...mockEstadoStore,
      setClima: mockSetClima,
      setUltimoDiagnostico: mockSetUltimoDiagnostico,
    }),
}));

// ScanScreen usa useRoute() de @react-navigation/native para leer un
// posible `modoInicial` (navegación directa desde la alerta de poda del
// Inicio). Al renderizar la pantalla suelta, sin NavigationContainer,
// useRoute() real lanzaría un error — se mockea con params mutables.
let mockRouteParams = {};
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: mockRouteParams }),
  useIsFocused: () => true,
}));

const mockLlamarGemini = jest.fn();
jest.mock('../gemini', () => ({ llamarGemini: (...args) => mockLlamarGemini(...args) }));

const mockInsertarDiagnostico = jest.fn();
const mockSubirFotoDiagnostico = jest.fn();
const mockListarCultivosHuerto = jest.fn();
jest.mock('../supabase', () => ({
  insertarDiagnostico: (...args) => mockInsertarDiagnostico(...args),
  subirFotoDiagnostico: (...args) => mockSubirFotoDiagnostico(...args),
  listarCultivosHuerto: (...args) => mockListarCultivosHuerto(...args),
}));

import ScanScreen from './ScanScreen';

async function dispararCaptura() {
  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-capturar'));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPermissionState = { granted: true };
  mockEstadoStore = { conectado: true, coords: null, clima: null };
  mockRouteParams = {};
  mockTakePictureAsync.mockResolvedValue({ uri: 'file://foto-original.jpg' });
  mockEncolarCapturaPendiente.mockResolvedValue(true);
  mockLlamarGemini.mockResolvedValue({
    que_tiene: 'Le falta hierro, las hojas nuevas amarillean',
    que_hacer_hoy: ['No toques el riego', 'Añade quelato de hierro'],
    truco_experto: 'Riega con agua de lluvia de vez en cuando',
    alerta_riego_hoy: 'Con este calor, riega por la tarde',
    dias_para_revisar: 5,
    apto_para_gallinas: false,
    aviso_gallinas: 'Las hojas de tomatera tienen solanina, tíralo a la basura',
  });
  mockInsertarDiagnostico.mockResolvedValue(undefined);
  mockListarCultivosHuerto.mockResolvedValue([]);
  mockSubirFotoDiagnostico.mockResolvedValue('https://ejemplo.supabase.co/foto.jpg');
});

test('pide permiso de cámara si no está concedido', async () => {
  mockPermissionState = { granted: false };
  await render(<ScanScreen />);

  expect(screen.getByText(/necesita acceso a la cámara/i)).toBeTruthy();
  fireEvent.press(screen.getByText('Conceder permiso'));
  expect(mockRequestPermission).toHaveBeenCalled();
});

test('flujo feliz: muestra el diagnóstico en lenguaje llano y el spinner desaparece', async () => {
  await render(<ScanScreen />);
  await dispararCaptura();

  await waitFor(() => expect(mockTakePictureAsync).toHaveBeenCalled());
  await screen.findByText('Le falta hierro, las hojas nuevas amarillean');
  expect(screen.getByText(/No toques el riego/)).toBeTruthy();
  expect(screen.getByText(/Con este calor, riega por la tarde/)).toBeTruthy();
  expect(screen.queryByText(/Analizando con Gemini/i)).toBeNull();
}, 15000);

test('sin conexión (store.conectado=false): no llama a Gemini, encola la captura localmente', async () => {
  mockEstadoStore.conectado = false;
  await render(<ScanScreen />);
  await dispararCaptura();

  expect(mockLlamarGemini).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(mockEncolarCapturaPendiente).toHaveBeenCalledWith(
      expect.objectContaining({ modo: 'plagas', fotoBase64: expect.any(String) })
    )
  );
  await screen.findByText(/hemos guardado la foto/i);
}, 15000);

test('si llamarGemini rechaza, se muestra el mensaje mapeado y el spinner se apaga', async () => {
  mockLlamarGemini.mockRejectedValueOnce(new Error('RATE_LIMIT'));
  await render(<ScanScreen />);
  await dispararCaptura();

  await screen.findByText(/límite gratuito de peticiones/i);
  expect(screen.queryByText(/Analizando con Gemini/i)).toBeNull();
});

test('doble-tap en el botón de captura no dispara dos análisis', async () => {
  await render(<ScanScreen />);

  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-capturar'));
    fireEvent.press(screen.getByTestId('boton-capturar'));
  });

  await waitFor(() => expect(mockLlamarGemini).toHaveBeenCalledTimes(1));
  expect(mockTakePictureAsync).toHaveBeenCalledTimes(1);
});

test('guardar: sube la foto, inserta el diagnóstico (con modo) y programa un recordatorio', async () => {
  const { programarRecordatorio } = require('../notificaciones');

  await render(<ScanScreen />);
  await dispararCaptura();
  await screen.findByText('Le falta hierro, las hojas nuevas amarillean');

  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-guardar'));
  });

  await waitFor(() => expect(mockSubirFotoDiagnostico).toHaveBeenCalled());
  await waitFor(() =>
    expect(mockInsertarDiagnostico).toHaveBeenCalledWith(
      expect.objectContaining({
        modo: 'plagas',
        que_tiene: 'Le falta hierro, las hojas nuevas amarillean',
        imagen_url: 'https://ejemplo.supabase.co/foto.jpg',
      })
    )
  );
  expect(programarRecordatorio).toHaveBeenCalled();
  // El modal se cierra tras guardar.
  await waitFor(() => expect(screen.queryByText('Le falta hierro, las hojas nuevas amarillean')).toBeNull());
});

test('si falla la subida de la foto, el diagnóstico se guarda igual (la foto es un extra)', async () => {
  mockSubirFotoDiagnostico.mockRejectedValueOnce(new Error('STORAGE_DOWN'));

  await render(<ScanScreen />);
  await dispararCaptura();
  await screen.findByText('Le falta hierro, las hojas nuevas amarillean');

  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-guardar'));
  });

  await waitFor(() =>
    expect(mockInsertarDiagnostico).toHaveBeenCalledWith(expect.objectContaining({ imagen_url: null }))
  );
});

test('muestra el aviso de seguridad para gallinas que devuelve Gemini', async () => {
  await render(<ScanScreen />);
  await dispararCaptura();

  await screen.findByText(/No apto para gallinas/i);
  expect(screen.getByText(/tienen solanina/i)).toBeTruthy();
});

test('failsafe de gallinas: si Gemini omite el campo, se asume "no apto" por precaución', async () => {
  mockLlamarGemini.mockResolvedValueOnce({
    que_tiene: 'Hojas con manchas',
    que_hacer_hoy: ['Retira las hojas afectadas'],
    truco_experto: '',
    alerta_riego_hoy: 'Riego normal',
    dias_para_revisar: 4,
    // sin apto_para_gallinas ni aviso_gallinas
  });

  await render(<ScanScreen />);
  await dispararCaptura();

  await screen.findByText(/No apto para gallinas/i);
  expect(screen.getByText(/no se lo des a las gallinas por precaución/i)).toBeTruthy();
});

test('selector de modo: pulsar "Poda" cambia el modo enviado en el diagnóstico guardado', async () => {
  await render(<ScanScreen />);

  await act(async () => {
    fireEvent.press(screen.getByTestId('modo-poda'));
  });
  await dispararCaptura();
  await screen.findByText('Le falta hierro, las hojas nuevas amarillean');

  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-guardar'));
  });

  await waitFor(() =>
    expect(mockInsertarDiagnostico).toHaveBeenCalledWith(expect.objectContaining({ modo: 'poda' }))
  );
});

test('acceso directo desde la alerta de poda: route.params.modoInicial abre ya en modo Poda', async () => {
  mockRouteParams = { modoInicial: 'poda' };

  await render(<ScanScreen />);
  await dispararCaptura();
  await screen.findByText('Le falta hierro, las hojas nuevas amarillean');

  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-guardar'));
  });

  await waitFor(() =>
    expect(mockInsertarDiagnostico).toHaveBeenCalledWith(expect.objectContaining({ modo: 'poda' }))
  );
});

test('guardar SIN red: el diagnóstico ya analizado se guarda en la cola (no se pierde)', async () => {
  await render(<ScanScreen />);
  await dispararCaptura();
  await screen.findByText('Le falta hierro, las hojas nuevas amarillean');
  mockEstadoStore.conectado = false;
  // re-render para que la pantalla vea el cambio de red
  await act(async () => {
    screen.rerender(<ScanScreen />);
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-guardar'));
  });
  await waitFor(() =>
    expect(mockEncolarCapturaPendiente).toHaveBeenCalledWith(
      expect.objectContaining({ modo: 'plagas', resultado: expect.objectContaining({ que_tiene: 'Le falta hierro, las hojas nuevas amarillean' }) })
    )
  );
  expect(mockInsertarDiagnostico).not.toHaveBeenCalled();
  await screen.findByText(/Guardado en el móvil/);
});

test('banner de pendientes abre la lista con cada elemento', async () => {
  mockContarColaPendiente.mockResolvedValue({ total: 1, bloqueados: 0 });
  mockObtenerColaPendiente.mockResolvedValue([
    { encoladoEn: '2026-09-25T10:00:00.000Z', modo: 'plagas', fotoBase64: 'AAA' },
  ]);
  await render(<ScanScreen />);
  const banner = await screen.findByTestId('banner-cola-pendiente');
  await act(async () => {
    fireEvent.press(banner);
  });
  expect(await screen.findByText(/Foto sin analizar/)).toBeTruthy();
  expect(screen.getByTestId('boton-reintentar-pendientes')).toBeTruthy();
});
