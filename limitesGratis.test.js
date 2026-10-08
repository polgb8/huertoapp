import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  diaPacifico,
  registrarPeticionGemini,
  leerUsoGemini,
  resumirUsoGemini,
  nivelUso,
  resumirUsoSupabase,
  formatearBytes,
} from './limitesGratis';

beforeEach(async () => {
  await AsyncStorage.clear();
});

test('el día de Google cambia a medianoche del Pacífico (verano UTC-7, invierno UTC-8)', () => {
  // 6 oct 2026 06:59 UTC = 5 oct 23:59 PDT
  expect(diaPacifico(new Date(Date.UTC(2026, 9, 6, 6, 59)))).toBe('2026-10-05');
  expect(diaPacifico(new Date(Date.UTC(2026, 9, 6, 7, 0)))).toBe('2026-10-06');
  // 15 dic 2026 07:59 UTC = 14 dic 23:59 PST
  expect(diaPacifico(new Date(Date.UTC(2026, 11, 15, 7, 59)))).toBe('2026-12-14');
  expect(diaPacifico(new Date(Date.UTC(2026, 11, 15, 8, 0)))).toBe('2026-12-15');
});

test('cuenta peticiones por modelo y se reinicia al cambiar de día', async () => {
  const hoy = new Date(Date.UTC(2026, 9, 6, 12));
  await registrarPeticionGemini('gemini-3.5-flash-lite', { ahora: hoy });
  await registrarPeticionGemini('gemini-3.5-flash-lite', { ahora: hoy });
  expect((await leerUsoGemini(hoy)).porModelo['gemini-3.5-flash-lite']).toBe(2);
  const manana = new Date(Date.UTC(2026, 9, 7, 12));
  expect((await leerUsoGemini(manana)).porModelo).toEqual({});
});

test('niveles: aviso al 80 % y agotado al 100 %', () => {
  expect(nivelUso(399, 500)).toBe('ok');
  expect(nivelUso(400, 500)).toBe('cerca');
  expect(nivelUso(500, 500)).toBe('agotado');
  const r = resumirUsoGemini({ porModelo: { 'gemini-3.5-flash-lite': 450 }, agotado: {} });
  expect(r.nivel).toBe('cerca');
  expect(r.principal.limite).toBe(500);
  const ag = resumirUsoGemini({ porModelo: {}, agotado: { 'gemini-3.5-flash-lite': true } });
  expect(ag.principal.nivel).toBe('agotado');
  expect(ag.todosAgotados).toBe(false);
});

test('Supabase: base de datos y fotos frente al plan Free', () => {
  const r = resumirUsoSupabase({ db_bytes: 11 * 1024 * 1024, storage_bytes: 900 * 1024 * 1024 });
  expect(r.filas[0].nivel).toBe('ok');
  expect(r.filas[1].nivel).toBe('cerca');
  expect(r.nivel).toBe('cerca');
  expect(formatearBytes(11 * 1024 * 1024)).toBe('11 MB');
  expect(formatearBytes(1024 ** 3)).toBe('1 GB');
  expect(formatearBytes(1.5 * 1024 ** 2)).toBe('1,5 MB');
  expect(resumirUsoSupabase(null)).toBeNull();
});
