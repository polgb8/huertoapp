// ============================================================
// colaOffline.test.js — Pruebas unitarias de la cola local de
// capturas pendientes. Se mockea expo-file-system (nunca el disco
// real) para comprobar que el módulo persiste bien Y que nunca lanza
// aunque el disco falle o el contenido guardado esté corrupto.
// ============================================================

import * as FileSystem from 'expo-file-system/legacy';
import { encolarCapturaPendiente, obtenerColaPendiente, vaciarColaPendiente } from './colaOffline';

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file://mock-dir/',
  getInfoAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

test('obtenerColaPendiente devuelve [] si el archivo no existe todavía', async () => {
  FileSystem.getInfoAsync.mockResolvedValue({ exists: false });
  await expect(obtenerColaPendiente()).resolves.toEqual([]);
});

test('encolarCapturaPendiente añade un elemento y persiste el array completo', async () => {
  FileSystem.getInfoAsync.mockResolvedValue({ exists: true });
  FileSystem.readAsStringAsync.mockResolvedValue(JSON.stringify([{ modo: 'plagas', fotoBase64: 'AAA' }]));
  FileSystem.writeAsStringAsync.mockResolvedValue();

  const ok = await encolarCapturaPendiente({ modo: 'poda', fotoBase64: 'BBB' });

  expect(ok).toBe(true);
  expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
    expect.any(String),
    expect.stringContaining('"modo":"poda"')
  );
});

test('nunca lanza si el disco falla al escribir: encolarCapturaPendiente devuelve false en vez de rechazar', async () => {
  FileSystem.getInfoAsync.mockResolvedValue({ exists: false });
  FileSystem.writeAsStringAsync.mockRejectedValue(new Error('DISCO_LLENO'));
  await expect(encolarCapturaPendiente({ modo: 'plagas', fotoBase64: 'X' })).resolves.toBe(false);
});

test('nunca lanza si el JSON guardado está corrupto: obtenerColaPendiente devuelve []', async () => {
  FileSystem.getInfoAsync.mockResolvedValue({ exists: true });
  FileSystem.readAsStringAsync.mockResolvedValue('{esto no es json valido');
  await expect(obtenerColaPendiente()).resolves.toEqual([]);
});

test('vaciarColaPendiente borra el archivo sin lanzar aunque falle', async () => {
  FileSystem.deleteAsync.mockRejectedValue(new Error('NO_EXISTE'));
  await expect(vaciarColaPendiente()).resolves.toBeUndefined();
});
