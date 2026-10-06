// ============================================================
// __tests__/AppFlow.test.js — Suite de QA de arquitectura completa.
// Monta pantallas REALES (ScanScreen, GardenScreen) y mockea solo las
// capas de servicio (../gemini, ../supabase, ../store, ../clima,
// ../notificaciones, ../colaOffline) y la navegación — el mismo
// criterio que ya usa screens/ScanScreen.test.js. Los mocks nativos
// genéricos (expo-notifications, expo-location, expo-file-system,
// expo-haptics, expo-image, react-native-url-polyfill) vienen de
// jest.setup.js; aquí solo se redefine expo-camera / expo-image-
// manipulator porque los escenarios 1, 2, 3 y 5 necesitan controlar
// por test el permiso de cámara y el resultado de la captura.
//
// El guardián de unhandled promise rejections (jest.setup.js) corre
// automáticamente en cada test de este archivo: si algo dejara una
// promesa rechazada sin capturar, el test fallaría aunque no se
// compruebe explícitamente.
// ============================================================

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';

// ------------------------------------------------------------
// Cámara: mock local con permiso y captura controlables por test.
// ------------------------------------------------------------
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
      return React.createElement(View, { testID: 'camera-view' }, props.children);
    }),
  };
});

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(() =>
    Promise.resolve({ uri: 'file://foto-redimensionada.jpg', base64: 'ZmFrZWJhc2U2NA==' })
  ),
  SaveFormat: { JPEG: 'jpeg' },
}));

// Navegación: ScanScreen usa useRoute(); GardenScreen usa useFocusEffect()
// y useNavigation() (para el "Ir a Planificar"/"Ir a podar" del panel
// superior).
let mockRouteParams = {};
const mockNavigate = jest.fn();
const mockSetOptions = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: mockRouteParams }),
  useNavigation: () => ({ navigate: mockNavigate, setOptions: mockSetOptions }),
  useFocusEffect: (callback) => {
    const ReactReal = require('react');
    ReactReal.useEffect(callback, []);
  },
  // ScanScreen usa useIsFocused (ver ciclo de vida de <CameraView>, que
  // se desmonta al perder el foco): en los tests siempre se considera
  // enfocada, así se sigue montando la cámara igual que antes.
  useIsFocused: () => true,
}));

// Capas de servicio (nunca se mockea fetch/supabase-js/FileSystem en
// crudo: se mockea el módulo "servicio" que ya las envuelve, igual que
// en el resto de la suite del proyecto).
const mockLlamarGemini = jest.fn();
jest.mock('../gemini', () => ({ llamarGemini: (...args) => mockLlamarGemini(...args) }));

const mockInsertarDiagnostico = jest.fn();
const mockSubirFotoDiagnostico = jest.fn();
const mockListarCultivosHuerto = jest.fn();
const mockMarcarCultivoComoCosechado = jest.fn();
const mockCrearTareaSaneamiento = jest.fn();
// GardenScreen también trae el panel superior (antes HomeScreen):
// alertas de poda y tareas pendientes — de ahí las funciones de
// supabase.js añadidas aquí. No hay login (ver App.js/store.js), así
// que no hace falta mockear ningún auth.*.
jest.mock('../supabase', () => ({
  insertarDiagnostico: (...args) => mockInsertarDiagnostico(...args),
  subirFotoDiagnostico: (...args) => mockSubirFotoDiagnostico(...args),
  listarCultivosHuerto: (...args) => mockListarCultivosHuerto(...args),
  marcarCultivoComoCosechado: (...args) => mockMarcarCultivoComoCosechado(...args),
  crearTareaSaneamiento: (...args) => mockCrearTareaSaneamiento(...args),
  listarPlantasConPoda: jest.fn(() => Promise.resolve([])),
  listarTareasPendientes: jest.fn(() => Promise.resolve([])),
  marcarTareaCompletada: jest.fn(() => Promise.resolve()),
}));

let mockEstadoStore = { conectado: true, coords: null, clima: null };
const mockSetClima = jest.fn();
const mockSetUltimoDiagnostico = jest.fn();
jest.mock('../store', () => ({
  useAppStore: (selector) =>
    selector({ ...mockEstadoStore, setClima: mockSetClima, setUltimoDiagnostico: mockSetUltimoDiagnostico }),
}));

jest.mock('../clima', () => ({
  obtenerClimaActual: jest.fn(() => Promise.resolve(null)),
  calcularBalanceHidrico: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('../notificaciones', () => ({ programarRecordatorio: jest.fn(() => Promise.resolve(null)), notificarAhora: jest.fn(() => Promise.resolve(null)), reprogramarAvisosPoda: jest.fn(() => Promise.resolve(true)) }));

const mockEncolarCapturaPendiente = jest.fn(() => Promise.resolve(true));
const mockContarColaPendiente = jest.fn(() => Promise.resolve({ total: 0, bloqueados: 0 }));
jest.mock('../colaOffline', () => ({
  encolarCapturaPendiente: (...args) => mockEncolarCapturaPendiente(...args),
  contarColaPendiente: (...args) => mockContarColaPendiente(...args),
}));

import ScanScreen from '../screens/ScanScreen';
import GardenScreen from '../screens/GardenScreen';

async function dispararCaptura() {
  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-capturar'));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPermissionState = { granted: true };
  mockRouteParams = {};
  mockEstadoStore = { conectado: true, coords: null, clima: null };
  mockTakePictureAsync.mockResolvedValue({ uri: 'file://foto-original.jpg' });
  mockEncolarCapturaPendiente.mockResolvedValue(true);
  mockListarCultivosHuerto.mockResolvedValue([]);
  mockLlamarGemini.mockResolvedValue({
    que_tiene: 'Le falta hierro, las hojas nuevas amarillean',
    que_hacer_hoy: ['No toques el riego', 'Añade quelato de hierro'],
    truco_experto: 'Riega con agua de lluvia de vez en cuando',
    alerta_riego_hoy: 'Con este calor, riega por la tarde',
    dias_para_revisar: 5,
    apto_para_gallinas: false,
    aviso_gallinas: 'Tóxico para las gallinas, tíralo a la basura',
  });
});

// ------------------------------------------------------------
// 1. Arranque sin red
// ------------------------------------------------------------
describe('1. Arranque sin red', () => {
  test('la captura se registra y se encola localmente sin unhandled promise rejection', async () => {
    mockEstadoStore.conectado = false;

    await render(<ScanScreen />);
    await dispararCaptura();

    // No debe intentar llamar a Gemini estando offline...
    expect(mockLlamarGemini).not.toHaveBeenCalled();
    // ...pero sí debe registrar la captura en la cola local.
    await waitFor(() =>
      expect(mockEncolarCapturaPendiente).toHaveBeenCalledWith(
        expect.objectContaining({ modo: 'plagas', fotoBase64: expect.any(String) })
      )
    );
    await screen.findByText(/hemos guardado la foto/i);
    // Si encolarCapturaPendiente (o cualquier otra promesa del flujo)
    // hubiera rechazado sin ser capturada, el afterEach de
    // jest.setup.js habría hecho fallar este test.
  }, 15000);
});

// ------------------------------------------------------------
// 2. Gemini en error (429 / 500 / timeout)
// ------------------------------------------------------------
describe('2. Gemini en error (429 / 500 / timeout)', () => {
  test.each([
    ['429 (límite de peticiones)', new Error('RATE_LIMIT'), /límite gratuito de peticiones/i],
    ['500 (servidor caído)', new Error('SERVER_ERROR'), /no está disponible ahora mismo/i],
  ])('%s: se desmonta el spinner, no se congela la UI y se muestra un aviso limpio', async (_etiqueta, error, mensajeEsperado) => {
    mockLlamarGemini.mockRejectedValueOnce(error);

    await render(<ScanScreen />);
    await dispararCaptura();

    await screen.findByText(mensajeEsperado);
    // El spinner de "Analizando con Gemini..." debe haber desaparecido:
    // la UI no se queda congelada mostrando un estado de carga eterno.
    expect(screen.queryByText(/Analizando con Gemini/i)).toBeNull();
  });
});

describe('2b. Sin cobertura real (NetInfo dice conectado pero la petición falla)', () => {
  test('timeout de red: la foto se encola para analizarla más tarde en vez de perderse', async () => {
    mockLlamarGemini.mockRejectedValueOnce(
      Object.assign(new Error('La petición ha excedido el tiempo'), { name: 'AbortError' })
    );
    await render(<ScanScreen />);
    await dispararCaptura();
    await waitFor(() =>
      expect(mockEncolarCapturaPendiente).toHaveBeenCalledWith(
        expect.objectContaining({ modo: 'plagas', fotoBase64: expect.any(String) })
      )
    );
    await screen.findByText(/Cobertura insuficiente/i);
  }, 15000);
});

// ------------------------------------------------------------
// 3. Gemini devuelve un resultado sucio / mal tipado
// ------------------------------------------------------------
describe('3. Gemini devuelve JSON sucio o incompleto', () => {
  test('el parser defensivo de ScanScreen recurre al respaldo en cada campo, sin romper la app', async () => {
    // El caso de texto plano/JSON truncado ya se cubre a nivel de
    // parseo puro en gemini.test.js (limpiarJSONSeguro). Aquí se
    // simula lo que puede llegar a ScanScreen si, aun con
    // responseSchema, algún campo llega con el tipo equivocado —
    // exactamente lo que hace saltar cada `??`/`Array.isArray`/
    // `Number.isFinite` de la normalización real de ScanScreen.js.
    mockLlamarGemini.mockResolvedValueOnce({
      que_tiene: null,
      que_hacer_hoy: 'esto no es un array, es texto suelto',
      truco_experto: undefined,
      alerta_riego_hoy: null,
      dias_para_revisar: 'no-es-un-numero',
      apto_para_gallinas: 'si', // ni siquiera es boolean
      aviso_gallinas: 42, // ni siquiera es string
    });

    await render(<ScanScreen />);
    await dispararCaptura();

    await screen.findByText('No se ha podido interpretar la foto');
    expect(screen.getByText(/Repite la foto con mejor luz y encuadre/)).toBeTruthy();
    // Failsafe de seguridad: ante un tipo inválido, nunca se asume "apto".
    expect(screen.getByText(/No apto para gallinas/i)).toBeTruthy();
    expect(screen.getByText(/no se lo des a las gallinas por precaución/i)).toBeTruthy();
  });
});

// ------------------------------------------------------------
// 4. Supabase / la base de datos no responde
// ------------------------------------------------------------
describe('4. Supabase pausado / fallo de conexión con la base de datos', () => {
  test('GardenScreen avisa con un mensaje limpio sin cerrarse ni quedarse cargando', async () => {
    mockListarCultivosHuerto.mockRejectedValueOnce(new Error('Failed to fetch'));

    await render(<GardenScreen />);

    await screen.findByText(/Sin conexión a internet/i);
  });
});

// ------------------------------------------------------------
// 5. Permiso de cámara denegado
// ------------------------------------------------------------
describe('5. Permiso de cámara denegado', () => {
  test('muestra el estado bloqueado con botón de reintentar, sin llamar a la API de cámara', async () => {
    mockPermissionState = { granted: false };

    await render(<ScanScreen />);

    expect(screen.getByText(/necesita acceso a la cámara/i)).toBeTruthy();
    const botonReintentar = screen.getByText('Conceder permiso');
    expect(botonReintentar).toBeTruthy();

    // No se ha intentado usar la cámara (que ni siquiera se ha montado).
    expect(mockTakePictureAsync).not.toHaveBeenCalled();

    fireEvent.press(botonReintentar);
    expect(mockRequestPermission).toHaveBeenCalled();
  });
});
