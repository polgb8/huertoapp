import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react-native';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (cb) => require('react').useEffect(cb, []),
}));

const mockListar = jest.fn();
const mockRegado = jest.fn(() => Promise.resolve(true));
const mockActualizar = jest.fn(() => Promise.resolve());
jest.mock('../supabase', () => ({
  listarCultivosHuerto: (...a) => mockListar(...a),
  listarTareasPendientes: jest.fn(() => Promise.resolve([{ id: 't1', titulo: 'Sanear bancal' }])),
  marcarCultivoRegado: (...a) => mockRegado(...a),
  marcarCultivoPodado: jest.fn(() => Promise.resolve(true)),
  actualizarCultivo: (...a) => mockActualizar(...a),
  marcarCultivoComoCosechado: jest.fn(() => Promise.resolve()),
  crearTareaSaneamiento: jest.fn(() => Promise.resolve()),
  marcarTareaCompletada: jest.fn(() => Promise.resolve()),
}));
jest.mock('../clima', () => ({
  calcularBalanceHidrico: jest.fn(() =>
    Promise.resolve({ lluviaSuficiente: false, litrosPorM2: 4, lluviaPrevistaMm: 0, probabilidadLluviaPrevista: 10, tempMaxHoy: 27.4 })
  ),
}));
jest.mock('../store', () => ({
  useAppStore: (sel) => sel({ coords: { lat: 41, lon: 2 }, zonaClimatica: 'mediterranea', sueloHuerto: null }),
}));

import HoyScreen from '../screens/HoyScreen';

beforeEach(async () => {
  await require('@react-native-async-storage/async-storage').clear();
  jest.clearAllMocks();
  mockListar.mockResolvedValue([
    { id: 'a', nombre: 'Tomate', zona: 'Bancal 1', estado: 'sembrado', fecha_siembra: new Date(Date.now() - 20 * 864e5).toISOString(), dias_cosecha: 90 },
    { id: 'b', nombre: 'Pimiento', zona: 'Bancal 1', estado: 'sembrado', fecha_siembra: new Date(Date.now() - 20 * 864e5).toISOString(), dias_cosecha: 90 },
  ]);
});

test('muestra qué regar por zona, el tiempo y las tareas', async () => {
  await render(<HoyScreen />);
  expect(await screen.findByText('Tomate')).toBeTruthy();
  expect(screen.getByText('📍 Bancal 1')).toBeTruthy();
  expect(screen.getByText(/Máx. 27°/)).toBeTruthy();
  expect(screen.getByText('Sanear bancal')).toBeTruthy();
  expect(screen.getByTestId('progreso-hoy').props.children).toBe('0 de 3 hechas');
});

test('"Regar todo" de una zona marca todas, pasa a "Hecho hoy" y se puede deshacer', async () => {
  await render(<HoyScreen />);
  await screen.findByText('Tomate');
  await act(async () => {
    fireEvent.press(screen.getByTestId('regar-todo-Bancal 1'));
  });
  expect(mockRegado).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId('progreso-hoy').props.children).toBe('2 de 3 hechas');
  expect(screen.getByText(/2 plantas de Bancal 1 regadas/)).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-deshacer'));
  });
  expect(screen.getByTestId('progreso-hoy').props.children).toBe('0 de 3 hechas');
  expect(mockActualizar).toHaveBeenCalledWith('a', { ultimo_riego: null });
});

test('sin plantas: estado vacío con acceso a añadir con foto', async () => {
  mockListar.mockResolvedValue([]);
  require('../supabase').listarTareasPendientes.mockResolvedValueOnce([]);
  await render(<HoyScreen />);
  expect(await screen.findByText('Empieza tu huerto')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByText(/Añadir planta con foto/));
  });
  expect(mockNavigate).toHaveBeenCalledWith('Huerto', expect.objectContaining({ accion: 'foto' }));
});
