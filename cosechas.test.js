import AsyncStorage from '@react-native-async-storage/async-storage';

const mockDisponible = jest.fn(() => Promise.resolve(false));
const mockInsertar = jest.fn(() => Promise.resolve());
jest.mock('./supabase', () => ({
  tablaCosechasDisponible: (...a) => mockDisponible(...a),
  insertarCosechaRemota: (...a) => mockInsertar(...a),
  listarCosechasRemotas: jest.fn(() => Promise.resolve([{ id: 'r1', cultivo_id: 'a', kg: 2, fecha: '2026-07-01T10:00:00Z' }])),
  eliminarCosechaRemota: jest.fn(() => Promise.resolve()),
}));

import { registrarCosecha, listarCosechas, resumenCosechasAnio, normalizarKg, eliminarCosecha } from './cosechas';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

test('normalizarKg acepta coma y rechaza valores no válidos', () => {
  expect(normalizarKg('1,5')).toBe(1.5);
  expect(() => normalizarKg('abc')).toThrow('KG_INVALIDO');
  expect(() => normalizarKg(0)).toThrow('KG_INVALIDO');
});

test('sin tabla remota: se guarda en el móvil y se lista', async () => {
  const r = await registrarCosecha({ cultivoId: 'a', kg: '3', nota: 'primera' });
  expect(r.remota).toBe(false);
  const lista = await listarCosechas();
  expect(lista).toHaveLength(1);
  expect(lista[0]).toMatchObject({ cultivo_id: 'a', kg: 3, local: true });
  await eliminarCosecha(lista[0]);
  expect(await listarCosechas()).toHaveLength(0);
});

test('con tabla remota: inserta en Supabase y fusiona con las locales', async () => {
  mockDisponible.mockResolvedValue(true);
  const r = await registrarCosecha({ cultivoId: 'a', kg: 1 });
  expect(r.remota).toBe(true);
  expect(mockInsertar).toHaveBeenCalledWith(expect.objectContaining({ cultivoId: 'a', kg: 1 }));
  const lista = await listarCosechas();
  expect(lista[0].id).toBe('r1');
});

test('resumen del año: suma kg y número de cosechas por cultivo', () => {
  const res = resumenCosechasAnio(
    [
      { cultivo_id: 'a', kg: 2.5, fecha: '2026-06-01T00:00:00Z' },
      { cultivo_id: 'a', kg: 1.25, fecha: '2026-07-01T00:00:00Z' },
      { cultivo_id: 'a', kg: 9, fecha: '2025-07-01T00:00:00Z' },
    ],
    new Date(2026, 8, 25)
  );
  expect(res.a).toEqual({ kg: 3.75, veces: 2 });
});
