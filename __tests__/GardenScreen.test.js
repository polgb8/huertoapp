// Tests de las mejoras de v13 en "Mi huerto": poda por temporada con
// "Ya lo he podado" que SÍ hace desaparecer el aviso (aunque la migración
// v6 no esté), riego bajo cada planta sin ubicación, "ya estaba plantada"
// y foto con cámara.
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react-native';

let mockRouteParams = {};
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useRoute: () => ({ params: mockRouteParams }),
  useFocusEffect: (callback) => {
    const ReactReal = require('react');
    ReactReal.useEffect(callback, []);
  },
}));

const mockListar = jest.fn();
const mockInsertarDiagnostico = jest.fn(() => Promise.resolve());
const mockMarcarPodado = jest.fn(() => Promise.resolve(false)); // migración v6 sin ejecutar
const mockInsertar = jest.fn(() => Promise.resolve({ id: 'nuevo', origenGuardado: true }));
jest.mock('../supabase', () => ({
  listarCultivosHuerto: (...a) => mockListar(...a),
  marcarCultivoPodado: (...a) => mockMarcarPodado(...a),
  marcarCultivoRegado: jest.fn(() => Promise.resolve(false)),
  insertarCultivo: (...a) => mockInsertar(...a),
  listarTareasPendientes: jest.fn(() => Promise.resolve([])),
  marcarTareaCompletada: jest.fn(),
  marcarCultivoComoCosechado: jest.fn(),
  marcarCultivoComoPerdido: jest.fn(),
  eliminarCultivoDefinitivamente: jest.fn(),
  eliminarFotoCultivo: jest.fn(),
  crearTareaSaneamiento: jest.fn(() => Promise.resolve()),
  actualizarCultivo: jest.fn(),
  subirFotoCultivo: jest.fn(),
  listarDiagnosticosPorCultivo: jest.fn(() => Promise.resolve([])),
  insertarDiagnostico: (...a) => mockInsertarDiagnostico(...a),
  tablaCosechasDisponible: jest.fn(() => Promise.resolve(false)),
  insertarCosechaRemota: jest.fn(),
  listarCosechasRemotas: jest.fn(() => Promise.resolve([])),
  eliminarCosechaRemota: jest.fn(),
}));
jest.mock('../store', () => ({
  useAppStore: (selector) => selector({ coords: null, conectado: true }),
}));
jest.mock('../clima', () => ({ calcularBalanceHidrico: jest.fn(() => Promise.resolve(null)) }));

const mockEstimar = jest.fn();
jest.mock('../estimarPlanta', () => ({ estimarTamanoYEdad: (...a) => mockEstimar(...a), analizarFotoPlanta: (...a) => mockEstimar(...a) }));

import GardenScreen from '../screens/GardenScreen';

const LAVANDA = {
  id: 'lav-1',
  nombre: 'Lavanda',
  estado: 'sembrado',
  origen: 'establecida',
  fecha_siembra: new Date(2026, 8, 20).toISOString(),
  dias_cosecha: 60,
  cantidad: 1,
};

beforeEach(async () => {
  await require('@react-native-async-storage/async-storage').clear();
  jest.useFakeTimers({
    now: new Date(2026, 8, 25, 10, 0, 0), // septiembre: época de poda de la lavanda
    doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'hrtime'],
  });
  jest.clearAllMocks();
  mockListar.mockResolvedValue([LAVANDA]);
});

afterEach(() => {
  jest.useRealTimers();
});

test('lavanda establecida en septiembre: aviso de poda en su época, sin cuenta atrás de cosecha', async () => {
  await render(<GardenScreen />);
  expect(await screen.findByText(/Toca podar: Lavanda/)).toBeTruthy();
  // En la tarjeta de la planta solo sale la pastilla mientras toca (no
  // el calendario de poda todo el año — petición de Pol).
  expect(screen.getByText('Toca podar')).toBeTruthy();
  expect(screen.queryByText(/Poda: agosto y septiembre/)).toBeNull();
  expect(screen.getByText(/Ya plantado/)).toBeTruthy();
  expect(screen.queryByText(/Lista para cosechar/)).toBeNull();
  expect(screen.queryByText('Marcar como cosechado')).toBeNull();
});

test('"Ya lo he podado" hace desaparecer el aviso aunque Supabase no tenga la columna', async () => {
  await render(<GardenScreen />);
  const boton = await screen.findByTestId('boton-ya-podado-lav-1');
  await act(async () => {
    fireEvent.press(boton);
  });
  expect(mockMarcarPodado).toHaveBeenCalledWith('lav-1');
  expect(screen.queryByText(/Toca podar: Lavanda/)).toBeNull();
});

test('la marca de poda local persiste al volver a abrir la pantalla', async () => {
  await require('../registroLocal').guardarMarcaLocal('lav-1', 'ultima_poda', new Date(2026, 8, 24).toISOString());
  await render(<GardenScreen />);
  await screen.findByTestId('boton-opciones-lav-1');
  expect(screen.queryByText(/Toca podar/)).toBeNull();
});

test('sin ubicación: debajo de la planta sale igualmente su riego habitual', async () => {
  await render(<GardenScreen />);
  expect(await screen.findByText(/Habitual: cada ~16 días/)).toBeTruthy();
});

test('formulario: "Ya estaba plantada" oculta la fecha y guarda origen establecida', async () => {
  await render(<GardenScreen />);
  await screen.findByText(/Toca podar: Lavanda/);
  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-anadir-manual'));
  });
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('campo-nombre-cultivo'), 'Limonero');
    fireEvent.press(screen.getByTestId('origen-establecida'));
  });
  expect(screen.queryByText(/Hace cuántos días lo plantaste/)).toBeNull();
  expect(screen.getByTestId('boton-hacer-foto-alta')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-guardar-cultivo'));
  });
  expect(mockInsertar).toHaveBeenCalledWith(expect.objectContaining({ nombre: 'Limonero', origen: 'establecida' }));
});

test('"Hacer foto" abre la cámara (no la galería)', async () => {
  const ImagePicker = require('expo-image-picker');
  await render(<GardenScreen />);
  await screen.findByText(/Toca podar: Lavanda/);
  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-anadir-manual'));
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-hacer-foto-alta'));
  });
  expect(ImagePicker.requestCameraPermissionsAsync).toHaveBeenCalled();
  expect(ImagePicker.launchCameraAsync).toHaveBeenCalled();
  expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
});

test('fuera de temporada no sale nada de poda en la tarjeta', async () => {
  jest.setSystemTime(new Date(2026, 4, 10)); // mayo
  await render(<GardenScreen />);
  await screen.findByTestId('boton-opciones-lav-1');
  expect(screen.queryByText(/Toca podar/)).toBeNull();
});

test('limonero mediano sin ubicación: cantidad razonable, no 15 regaderas', async () => {
  mockListar.mockResolvedValue([
    { id: 'lim', nombre: 'Limonero', estado: 'sembrado', origen: 'establecida', fecha_siembra: new Date(2026, 8, 1).toISOString(), dias_cosecha: 60, cantidad: 1 },
  ]);
  await render(<GardenScreen />);
  const texto = await screen.findByText(/Habitual: cada ~7 días/);
  expect(texto.props.children).not.toMatch(/15 regaderas/);
});

test('al hacer la foto de un árbol, la IA estima tamaño, copa y edad y se guardan con el cultivo', async () => {
  const ImagePicker = require('expo-image-picker');
  ImagePicker.launchCameraAsync.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file://arbol.jpg' }] });
  mockEstimar.mockResolvedValueOnce({
    especieProbable: 'Cerezo', tamano: 'grande', diametroCopa: 4.2, altura: 5, edadAnios: 12, confianza: 'media', comentario: 'Tronco grueso.',
  });
  await render(<GardenScreen />);
  await screen.findByText(/Toca podar: Lavanda/);
  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-anadir-manual'));
  });
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('campo-nombre-cultivo'), 'Cerezo');
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-hacer-foto-alta'));
  });
  expect(await screen.findByText(/copa ~4,2 m · ~12 años/)).toBeTruthy();
  expect(screen.getByTestId('campo-edad-alta').props.value).toBe('12');
  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-guardar-cultivo'));
  });
  const llamada = mockInsertar.mock.calls[0][0];
  expect(llamada).toMatchObject({ nombre: 'Cerezo', origen: 'establecida', tamano: 'grande', diametro_copa: 4.2, edad_estimada: true });
  const anios = (Date.now() - new Date(llamada.fechaSiembraISO).getTime()) / (365.25 * 864e5);
  expect(Math.round(anios)).toBe(12);
});

test('"Añadir planta": abre el formulario y desde ahí "Hacer foto"; la IA analiza salud/agua/suelo y se guarda con diagnóstico inicial', async () => {
  const ImagePicker = require('expo-image-picker');
  ImagePicker.launchCameraAsync.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file://p.jpg' }] });
  mockEstimar.mockResolvedValueOnce({
    especieProbable: 'Limonero', tamano: 'mediano', diametroCopa: 2, edadAnios: 5, confianza: 'alta', comentario: '',
    tipoSuelo: 'arcilloso', sueloDetalle: 'Tierra agrietada', salud: 'leve', saludDetalle: 'Algo de pulgón en brotes',
    agua: 'falta', aguaDetalle: 'Hojas algo lacias', recomendaciones: ['Riega hoy en profundidad'],
  });
  await render(<GardenScreen />);
  await screen.findByText(/Toca podar: Lavanda/);
  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-anadir-manual'));
  });
  // "Añadir planta" abre el formulario sin lanzar la cámara.
  expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-hacer-foto-alta'));
  });
  expect(await screen.findByText(/Algo leve: Algo de pulgón/)).toBeTruthy();
  expect(screen.getByText(/Le falta agua/)).toBeTruthy();
  expect(screen.getByText(/Suelo arcilloso/)).toBeTruthy();
  expect(screen.getByTestId('campo-nombre-cultivo').props.value).toBe('Limonero');
  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-guardar-cultivo'));
  });
  expect(mockInsertar).toHaveBeenCalledWith(expect.objectContaining({ nombre: 'Limonero', tipo_suelo: 'arcilloso', origen: 'establecida' }));
  expect(mockInsertarDiagnostico).toHaveBeenCalledWith(expect.objectContaining({ cultivo_id: 'nuevo', que_tiene: 'Algo de pulgón en brotes' }));
});

test('IA: una especie que no es del catálogo (p.ej. "erizo") NO rellena el nombre, solo se muestra como sugerencia', async () => {
  const ImagePicker = require('expo-image-picker');
  ImagePicker.launchCameraAsync.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file://p.jpg' }] });
  mockEstimar.mockResolvedValueOnce({
    especieProbable: 'Erizo', tamano: 'mediano', diametroCopa: 2, edadAnios: 5, confianza: 'alta', comentario: '',
    tipoSuelo: null, sueloDetalle: '', salud: 'sana', saludDetalle: '', agua: 'bien', aguaDetalle: '', recomendaciones: [],
  });
  await render(<GardenScreen />);
  await screen.findByText(/Toca podar: Lavanda/);
  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-anadir-manual'));
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-hacer-foto-alta'));
  });
  expect(await screen.findByTestId('estimacion-especie')).toBeTruthy();
  expect(screen.getByTestId('campo-nombre-cultivo').props.value).toBe('');
});

test('Menú "⋯": se abre con una X para volver y "Editar" abre la edición', async () => {
  await render(<GardenScreen />);
  await act(async () => {
    fireEvent.press(await screen.findByTestId('boton-opciones-lav-1'));
  });
  expect(screen.getByTestId('boton-cerrar-opciones-x')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-cerrar-opciones-x'));
  });
  expect(screen.queryByTestId('boton-cerrar-opciones-x')).toBeNull();
  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-opciones-lav-1'));
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('opcion-editar'));
  });
  expect(screen.getByTestId('boton-cerrar-edicion-x')).toBeTruthy();
});

test('Tocar el nombre/foto de una planta abre su ficha en Buscar y vuelve a Huerto al cerrarla', async () => {
  mockNavigate.mockClear();
  await render(<GardenScreen />);
  await act(async () => {
    fireEvent.press(await screen.findByTestId('ficha-planta-lav-1'));
  });
  expect(mockNavigate).toHaveBeenCalledWith('Buscar', expect.objectContaining({ plantaNombre: expect.any(String), volverA: 'Huerto' }));
});

test('"✓ Regado" muestra aviso con Deshacer y deshacer lo revierte', async () => {
  await render(<GardenScreen />);
  const boton = await screen.findByTestId('boton-ya-regado-lav-1');
  await act(async () => {
    fireEvent.press(boton);
  });
  expect(screen.getByTestId('toast-deshacer')).toBeTruthy();
  expect(screen.queryByTestId('boton-ya-regado-lav-1')).toBeNull();
  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-deshacer'));
  });
  expect(screen.getByTestId('boton-ya-regado-lav-1')).toBeTruthy();
});

test('perenne: registrar cosecha en kg y ver el resumen del año', async () => {
  await render(<GardenScreen />);
  await act(async () => {
    fireEvent.press(await screen.findByTestId('boton-cosecha-lav-1'));
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('kg-rapido-2'));
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-guardar-cosecha'));
  });
  expect(await screen.findByText(/Este año: 2 kg \(1 cosecha\)/)).toBeTruthy();
});
