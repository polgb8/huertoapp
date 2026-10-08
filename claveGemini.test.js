import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  guardarClaveGemini,
  leerClaveGeminiGuardada,
  borrarClaveGemini,
  obtenerClaveGemini,
  claveGeminiPareceValida,
  verificarClaveGemini,
} from './claveGemini';

beforeEach(async () => {
  await AsyncStorage.clear();
});

test('rechaza claves cortas o con espacios', async () => {
  expect(claveGeminiPareceValida('abc')).toBe(false);
  expect(claveGeminiPareceValida('a'.repeat(30) + ' b')).toBe(false);
  expect(await guardarClaveGemini('abc')).toBe(false);
});

test('guarda, lee y borra la clave del usuario', async () => {
  const k = 'AIza' + 'x'.repeat(30);
  expect(await guardarClaveGemini(`  ${k}  `)).toBe(true);
  expect(await leerClaveGeminiGuardada()).toBe(k);
  expect(await obtenerClaveGemini()).toBe(k);
  await borrarClaveGemini();
  expect(await leerClaveGeminiGuardada()).toBe('');
});

test('sin clave guardada usa la del build como respaldo', async () => {
  const antes = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
  process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'clave-del-build-1234567890';
  expect(await obtenerClaveGemini()).toBe('clave-del-build-1234567890');
  process.env.EXPO_PUBLIC_GEMINI_API_KEY = antes;
});

describe('verificarClaveGemini', () => {
  const k = 'AIza' + 'y'.repeat(30);
  const conRespuesta = (status) => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: status >= 200 && status < 300, status }));
  };
  const original = global.fetch;
  afterEach(() => {
    global.fetch = original;
  });
  test('200 -> ok, 429 -> ok (cupo agotado pero clave válida)', async () => {
    conRespuesta(200);
    expect(await verificarClaveGemini(k)).toBe('ok');
    conRespuesta(429);
    expect(await verificarClaveGemini(k)).toBe('ok');
  });
  test('400/403 -> invalida; formato malo -> invalida sin llamar', async () => {
    conRespuesta(400);
    expect(await verificarClaveGemini(k)).toBe('invalida');
    conRespuesta(403);
    expect(await verificarClaveGemini(k)).toBe('invalida');
    global.fetch = jest.fn();
    expect(await verificarClaveGemini('abc')).toBe('invalida');
    expect(global.fetch).not.toHaveBeenCalled();
  });
  test('sin red -> sin_red', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('Network request failed')));
    expect(await verificarClaveGemini(k)).toBe('sin_red');
  });
});
