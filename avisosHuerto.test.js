import { normalizarHora, textoHora, calcularAvisosPoda } from './avisosHuerto';
import { calcularAvisosRiego } from './riego';

test('hora del aviso: valores por defecto y formato', () => {
  expect(normalizarHora({})).toEqual({ hora: 9, minuto: 0 });
  expect(normalizarHora({ hora: 21, minuto: 45 })).toEqual({ hora: 21, minuto: 45 });
  expect(normalizarHora({ hora: 30, minuto: -1 })).toEqual({ hora: 9, minuto: 0 });
  expect(textoHora({ hora: 7, minuto: 5 })).toBe('07:05');
});

test('los avisos de riego salen a la hora y minuto elegidos', () => {
  const ahora = new Date(2026, 9, 6, 8, 0);
  const recs = [{ id: 1, nombre: 'Tomate', necesitaRiego: true, frecuencia: 2 }];
  const avisos = calcularAvisosRiego(recs, [{ id: 1 }], ahora, 20, 30);
  expect(avisos.length).toBeGreaterThan(0);
  avisos.forEach((a) => {
    expect(a.fecha.getHours()).toBe(20);
    expect(a.fecha.getMinutes()).toBe(30);
  });
  expect(avisos[0].fecha.getDate()).toBe(6); // hoy a las 20:30
});

test('si la hora elegida ya pasó hoy y es tarde, el aviso de "hoy" pasa a mañana', () => {
  const ahora = new Date(2026, 9, 6, 22, 0);
  const avisos = calcularAvisosRiego([{ id: 1, nombre: 'Tomate', necesitaRiego: true }], [{ id: 1 }], ahora, 9, 15);
  expect(avisos).toHaveLength(1);
  expect(avisos[0].fecha.getDate()).toBe(7);
  expect(avisos[0].fecha.getHours()).toBe(9);
  expect(avisos[0].fecha.getMinutes()).toBe(15);
});

test('los avisos de poda usan la misma hora elegida', () => {
  const avisos = calcularAvisosPoda([{ nombre: 'Limonero' }], 'mediterranea', { hora: 18, minuto: 45 }, new Date(2026, 9, 6));
  expect(avisos.length).toBe(1);
  expect(avisos[0].fecha.getHours()).toBe(18);
  expect(avisos[0].fecha.getMinutes()).toBe(45);
});
