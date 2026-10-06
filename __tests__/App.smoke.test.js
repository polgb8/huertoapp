// Humo de la app completa: pestañas (Hoy primero, sin "Asistente") y el
// botón flotante 🤖 presente sobre la navegación.
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react-native';

jest.mock('expo-sensors', () => ({ LightSensor: { isAvailableAsync: jest.fn(() => Promise.resolve(false)), addListener: jest.fn(() => ({ remove: jest.fn() })) } }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
// Estado de sesión simulado: por defecto hay sesión; un test puede ponerlo a null.
let mockSesion = { user: { email: 'test@huerto.app' } };
jest.mock('../supabase', () =>
  new Proxy(
    {
      __esModule: true,
      SUPABASE_CONFIGURADO: true,
      supabase: {
        auth: {
          getSession: () => Promise.resolve({ data: { session: mockSesion } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe: jest.fn() } } }),
          signInWithPassword: jest.fn(() => Promise.resolve({ error: null })),
          signUp: jest.fn(() => Promise.resolve({ data: {}, error: null })),
          signOut: jest.fn(() => Promise.resolve({})),
        },
      },
    },
    { get: (t, k) => (k in t ? t[k] : jest.fn(() => Promise.resolve([]))) }
  )
);
jest.mock('../clima', () => ({
  calcularBalanceHidrico: jest.fn(() => Promise.resolve(null)),
  obtenerClimaActual: jest.fn(() => Promise.resolve(null)),
  obtenerElevacion: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('../gemini', () => ({ llamarGemini: jest.fn(), llamarGeminiChat: jest.fn(() => Promise.resolve('ok')) }));

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

import App from '../App';

test('arranca en "Hoy", no existe la pestaña Asistente y el botón 🤖 abre el chat', async () => {
  await render(<App />);
  expect(await screen.findByTestId('progreso-hoy')).toBeTruthy();
  expect(screen.queryByText('Asistente')).toBeNull();
  expect(screen.getAllByText('Huerto').length).toBeGreaterThan(0);
  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-asistente'));
  });
  expect(screen.getByText('Asistente del huerto')).toBeTruthy();
});

test('sin sesión muestra la pantalla de login y no la navegación', async () => {
  mockSesion = null;
  await render(<App />);
  expect(await screen.findByText('Crear cuenta')).toBeTruthy();
  expect(screen.queryByText('Mi huerto')).toBeNull();
  mockSesion = { user: { email: 'test@huerto.app' } };
});
