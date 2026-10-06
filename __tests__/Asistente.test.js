import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockChat = jest.fn();
jest.mock('../gemini', () => ({ llamarGeminiChat: (...a) => mockChat(...a) }));
const mockBorrar = jest.fn(() => Promise.resolve());
jest.mock('../supabase', () => ({
  listarCultivosHuerto: jest.fn(() => Promise.resolve([{ id: 'x', nombre: 'Limonero', estado: 'sembrado', zona: 'Patio' }])),
  listarMensajesAsistente: jest.fn(() => Promise.resolve([])),
  insertarMensajeAsistente: jest.fn(() => Promise.resolve()),
  borrarMensajesAsistente: (...a) => mockBorrar(...a),
}));
let mockConectado = true;
jest.mock('../store', () => ({
  useAppStore: (sel) => sel({ conectado: mockConectado, zonaClimatica: 'interior', sueloHuerto: 'arcilloso', clima: null, coords: null }),
}));

import { SafeAreaProvider } from 'react-native-safe-area-context';
import BotonAsistente from '../components/BotonAsistente';

const METRICAS = { frame: { x: 0, y: 0, width: 390, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
import TextoFormateado, { trocearNegrita } from '../components/TextoFormateado';

beforeEach(() => {
  jest.clearAllMocks();
  mockConectado = true;
});

async function abrir() {
  await render(
    <SafeAreaProvider initialMetrics={METRICAS}>
      <BotonAsistente pantalla="Huerto" />
    </SafeAreaProvider>
  );
  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-asistente'));
  });
}

test('el botón 🤖 abre el chat, se oculta mientras está abierto y se cierra con ✕', async () => {
  await abrir();
  expect(screen.getByText('Asistente del huerto')).toBeTruthy();
  expect(screen.queryByTestId('boton-asistente')).toBeNull();
  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-cerrar-asistente'));
  });
  expect(screen.getByTestId('boton-asistente')).toBeTruthy();
});

test('pregunta -> respuesta con contexto del huerto (plantas, zona, suelo, pantalla)', async () => {
  mockChat.mockResolvedValueOnce('Riega el **limonero** cada 7 días.\n- Por la mañana');
  await abrir();
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('campo-chat'), '¿Cuándo riego el limonero?');
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-enviar-chat'));
  });
  await waitFor(() => expect(mockChat).toHaveBeenCalled());
  const args = mockChat.mock.calls[0][0];
  expect(args.mensajeNuevo).toBe('¿Cuándo riego el limonero?');
  expect(args.contextoSistema).toMatch(/Limonero \(zona Patio\)/);
  expect(args.contextoSistema).toMatch(/interior con heladas/);
  expect(args.contextoSistema).toMatch(/Suelo del huerto: arcilloso/);
  expect(args.contextoSistema).toMatch(/Mi huerto/);
  expect(await screen.findByText('limonero')).toBeTruthy(); // negrita renderizada
  expect(screen.getByText('Por la mañana')).toBeTruthy();
});

test('sugerencia rápida envía la pregunta directamente', async () => {
  mockChat.mockResolvedValueOnce('En otoño: habas, ajos, guisantes…');
  await abrir();
  await act(async () => {
    fireEvent.press(screen.getByTestId('sugerencia-1'));
  });
  await waitFor(() => expect(mockChat).toHaveBeenCalledWith(expect.objectContaining({ mensajeNuevo: '¿Qué puedo sembrar este mes?' })));
  expect(await screen.findByText(/habas, ajos/)).toBeTruthy();
});

test('error -> "Reintentar" repite sin duplicar el turno del usuario', async () => {
  mockChat.mockRejectedValueOnce(new Error('SERVER_ERROR')).mockResolvedValueOnce('Ahora sí.');
  await abrir();
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('campo-chat'), 'Hola');
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-enviar-chat'));
  });
  expect(await screen.findByTestId('boton-reintentar-chat')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-reintentar-chat'));
  });
  expect(await screen.findByText('Ahora sí.')).toBeTruthy();
  expect(mockChat.mock.calls[1][0].historial).toEqual([]);
  expect(screen.getAllByText('Hola')).toHaveLength(1);
});

test('sin conexión avisa y no llama a la IA', async () => {
  mockConectado = false;
  await abrir();
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('campo-chat'), 'Hola');
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-enviar-chat'));
  });
  expect(mockChat).not.toHaveBeenCalled();
  expect(screen.getByText(/Sin conexión ahora mismo/)).toBeTruthy();
});

test('"Nueva conversación" borra el historial tras confirmar', async () => {
  const spy = jest.spyOn(Alert, 'alert').mockImplementation((t, m, botones) => botones.find((b) => b.text === 'Borrar').onPress());
  await abrir();
  await act(async () => {
    fireEvent.press(screen.getByTestId('boton-nuevo-chat'));
  });
  expect(mockBorrar).toHaveBeenCalled();
  spy.mockRestore();
});

test('trocearNegrita y listas', async () => {
  expect(trocearNegrita('a **b** c')).toEqual([
    { texto: 'a ', negrita: false },
    { texto: 'b', negrita: true },
    { texto: ' c', negrita: false },
  ]);
  await render(<TextoFormateado texto={'# Título\n1. Uno\n* Dos'} />);
  expect(screen.getByText('Título')).toBeTruthy();
  expect(screen.getByText('1.')).toBeTruthy();
  expect(screen.getByText('•')).toBeTruthy();
});
