// Humo: las pantallas secundarias montan sin romper con el tema/UI nuevos
// y el botón de filtros abre el modal con el título centrado.
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react-native';

jest.mock('expo-sensors', () => ({ LightSensor: { isAvailableAsync: jest.fn(() => Promise.resolve(false)), addListener: jest.fn(() => ({ remove: jest.fn() })) } }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: (cb) => require('react').useEffect(cb, []),
  useIsFocused: () => true,
}));
jest.mock('../supabase', () => ({
  listarHistorialCultivos: jest.fn(() => Promise.resolve([])),
  insertarCultivo: jest.fn(() => Promise.resolve({ id: 'x' })),
  listarCultivosSembrados: jest.fn(() => Promise.resolve([])),
  listarMensajesAsistente: jest.fn(() => Promise.resolve([])),
  insertarMensajeAsistente: jest.fn(() => Promise.resolve()),
}));
jest.mock('../gemini', () => ({ llamarGemini: jest.fn(), llamarGeminiChat: jest.fn() }));
jest.mock('../clima', () => ({ obtenerClimaActual: jest.fn(() => Promise.resolve(null)) }));
jest.mock('../store', () => ({
  useAppStore: (sel) => sel({ coords: { lat: 41.4, lon: 2.2 }, conectado: true, clima: null, setCoords: jest.fn(), setClima: jest.fn() }),
}));

import BuscarScreen from '../screens/BuscarScreen';
import PlannerScreen from '../screens/PlannerScreen';

test('Buscar monta y abre Filtros', async () => {
  await render(<BuscarScreen />);
  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-abrir-filtros'));
  });
  expect(screen.getByTestId('boton-cerrar-filtros-x')).toBeTruthy();
  expect(screen.getAllByText('🔧 Filtros').length).toBe(2);
});

test('Planificador monta', async () => {
  await render(<PlannerScreen />);
  expect(screen.toJSON()).toBeTruthy();
});

