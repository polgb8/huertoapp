import { calcularProgreso, limpiarJSONSeguro, mensajeDeError, crearAbortConTimeout } from './utils';

describe('calcularProgreso', () => {
  test('a mitad de camino da una fracción ~0.5', () => {
    const hace15dias = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    const { fraccion, diasTranscurridos } = calcularProgreso(hace15dias, 30);
    expect(diasTranscurridos).toBe(15);
    expect(fraccion).toBeCloseTo(0.5, 1);
  });

  test('se acota a 1 si ya se pasó la fecha de cosecha (no da >100%)', () => {
    const hace100dias = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    const { fraccion, diasRestantes } = calcularProgreso(hace100dias, 30);
    expect(fraccion).toBe(1);
    expect(diasRestantes).toBe(0);
  });

  test('diasCosecha en 0 o nulo no revienta (evita división por cero)', () => {
    expect(calcularProgreso(new Date().toISOString(), 0)).toEqual({
      fraccion: 0,
      diasTranscurridos: 0,
      diasRestantes: 0,
    });
    expect(calcularProgreso(new Date().toISOString(), null)).toEqual({
      fraccion: 0,
      diasTranscurridos: 0,
      diasRestantes: 0,
    });
  });

  test('fecha_siembra ausente o inválida no revienta', () => {
    expect(calcularProgreso(null, 30).fraccion).toBe(0);
    expect(calcularProgreso('no-es-una-fecha', 30).fraccion).toBe(0);
  });
});

describe('limpiarJSONSeguro', () => {
  test('parsea JSON directo', () => {
    expect(limpiarJSONSeguro('{"a":1}', null)).toEqual({ a: 1 });
  });

  test('quita el envoltorio ```json ... ```', () => {
    expect(limpiarJSONSeguro('```json\n{"a":1}\n```', null)).toEqual({ a: 1 });
  });

  test('JSON truncado/ inválido cae al valor de respaldo, no lanza', () => {
    expect(limpiarJSONSeguro('{"a": ', { a: 'respaldo' })).toEqual({ a: 'respaldo' });
  });

  test('texto vacío cae directo al respaldo', () => {
    expect(limpiarJSONSeguro('', 'x')).toBe('x');
    expect(limpiarJSONSeguro(null, 'x')).toBe('x');
  });
});

describe('mensajeDeError', () => {
  test('mapea los códigos conocidos a mensajes específicos', () => {
    expect(mensajeDeError({ message: 'RATE_LIMIT' })).toMatch(/límite gratuito/i);
    expect(mensajeDeError({ message: 'AUTH_ERROR' })).toMatch(/clave de Gemini/i);
    expect(mensajeDeError({ message: 'SERVER_ERROR' })).toMatch(/no está disponible/i);
    expect(mensajeDeError({ name: 'AbortError' })).toMatch(/tardado demasiado/i);
  });

  test('un error desconocido no revienta: da un mensaje genérico', () => {
    expect(mensajeDeError({ message: 'ALGO_RARO_NO_MAPEADO' })).toMatch(/inesperado/i);
    expect(mensajeDeError(undefined)).toMatch(/inesperado/i);
  });
});

describe('crearAbortConTimeout', () => {
  test('aborta la señal pasado el timeout indicado', () => {
    jest.useFakeTimers();
    const { signal, cancelar } = crearAbortConTimeout(1000);
    expect(signal.aborted).toBe(false);
    jest.advanceTimersByTime(1000);
    expect(signal.aborted).toBe(true);
    cancelar();
    jest.useRealTimers();
  });

  test('cancelar() evita que salte el timeout', () => {
    jest.useFakeTimers();
    const { signal, cancelar } = crearAbortConTimeout(1000);
    cancelar();
    jest.advanceTimersByTime(2000);
    expect(signal.aborted).toBe(false);
    jest.useRealTimers();
  });
});
