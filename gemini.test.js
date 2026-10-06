import AsyncStorage from '@react-native-async-storage/async-storage';
import { llamarGemini, llamarGeminiChat, MODELO_GEMINI_PRINCIPAL, MODELO_GEMINI_RESPALDO, MODELO_GEMINI_ULTIMO_RECURSO } from './gemini';
import { leerUsoGemini } from './limitesGratis';

function respuestaOk(texto) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: texto }] } }] }),
  };
}

function respuestaError(status) {
  return { ok: false, status, text: () => Promise.resolve('detalle del error') };
}

function respuestaBloqueada() {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ candidates: [], promptFeedback: { blockReason: 'SAFETY' } }),
  };
}

function respuestaTruncada() {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ candidates: [{ finishReason: 'MAX_TOKENS' }] }),
  };
}

beforeEach(async () => {
  global.fetch = jest.fn();
  await AsyncStorage.clear();
});

test('éxito: devuelve el JSON ya parseado (un solo intento, sin reintentos de más)', async () => {
  global.fetch.mockResolvedValueOnce(respuestaOk('{"estado":"sana"}'));
  const resultado = await llamarGemini({ promptTexto: 'x', valorRespaldo: null });
  expect(resultado).toEqual({ estado: 'sana' });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('quita el envoltorio ```json de la respuesta antes de parsear', async () => {
  global.fetch.mockResolvedValueOnce(respuestaOk('```json\n{"estado":"sana"}\n```'));
  const resultado = await llamarGemini({ promptTexto: 'x', valorRespaldo: null });
  expect(resultado).toEqual({ estado: 'sana' });
});

test('JSON truncado cae al valorRespaldo en vez de lanzar', async () => {
  global.fetch.mockResolvedValueOnce(respuestaOk('{"estado": '));
  const resultado = await llamarGemini({ promptTexto: 'x', valorRespaldo: { estado: 'error' } });
  expect(resultado).toEqual({ estado: 'error' });
});

test('candidato vacío sin más pistas -> RESPUESTA_VACIA, tras probar los tres modelos', async () => {
  for (let i = 0; i < 3; i += 1) {
    global.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ candidates: [] }) });
  }
  await expect(llamarGemini({ promptTexto: 'x', valorRespaldo: null })).rejects.toThrow('RESPUESTA_VACIA');
  expect(global.fetch).toHaveBeenCalledTimes(3); // principal + respaldo + último recurso, sin reintento
});

test('bloqueo de seguridad (promptFeedback.blockReason) se clasifica como BLOQUEO_SEGURIDAD, no como RESPUESTA_VACIA genérica', async () => {
  global.fetch.mockResolvedValueOnce(respuestaBloqueada());
  global.fetch.mockResolvedValueOnce(respuestaBloqueada());
  global.fetch.mockResolvedValueOnce(respuestaBloqueada());
  await expect(llamarGemini({ promptTexto: 'x', valorRespaldo: null })).rejects.toThrow('BLOQUEO_SEGURIDAD');
});

test('corte por límite de tokens (finishReason MAX_TOKENS) se clasifica como RESPUESTA_TRUNCADA', async () => {
  global.fetch.mockResolvedValueOnce(respuestaTruncada());
  global.fetch.mockResolvedValueOnce(respuestaTruncada());
  global.fetch.mockResolvedValueOnce(respuestaTruncada());
  await expect(llamarGemini({ promptTexto: 'x', valorRespaldo: null })).rejects.toThrow('RESPUESTA_TRUNCADA');
});

test.each([
  [401, 'AUTH_ERROR'],
  [403, 'AUTH_ERROR'],
])('HTTP %i se clasifica como %s y NO se reintenta (la clave es la misma para todos los modelos)', async (status, esperado) => {
  global.fetch.mockResolvedValueOnce(respuestaError(status));
  await expect(llamarGemini({ promptTexto: 'x', valorRespaldo: null })).rejects.toThrow(esperado);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test.each([
  [429, 'RATE_LIMIT'],
  [500, 'SERVER_ERROR'],
  [503, 'SERVER_ERROR'],
])('HTTP %i (%s) se reintenta en el mismo modelo y luego prueba el modelo de respaldo antes de rendirse', async (status, esperado) => {
  global.fetch.mockResolvedValueOnce(respuestaError(status)); // principal, intento 1
  global.fetch.mockResolvedValueOnce(respuestaError(status)); // principal, reintento
  global.fetch.mockResolvedValueOnce(respuestaError(status)); // respaldo, intento 1
  global.fetch.mockResolvedValueOnce(respuestaError(status)); // respaldo, reintento
  global.fetch.mockResolvedValueOnce(respuestaError(status)); // último recurso, intento 1
  global.fetch.mockResolvedValueOnce(respuestaError(status)); // último recurso, reintento
  await expect(llamarGemini({ promptTexto: 'x', valorRespaldo: null })).rejects.toThrow(esperado);
  expect(global.fetch).toHaveBeenCalledTimes(6);
});

test('429 por cupo DIARIO: no se reintenta ese modelo, pasa al respaldo y se recuerda el resto del día', async () => {
  const diario = { ok: false, status: 429, text: () => Promise.resolve('{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}') };
  global.fetch.mockResolvedValueOnce(diario);
  global.fetch.mockResolvedValueOnce(respuestaOk('{"a":1}'));
  expect(await llamarGemini({ promptTexto: 'x', valorRespaldo: null })).toEqual({ a: 1 });
  expect(global.fetch.mock.calls[1][0]).toContain(MODELO_GEMINI_RESPALDO);
  const uso = await leerUsoGemini();
  expect(uso.agotado[MODELO_GEMINI_PRINCIPAL]).toBe(true);
  expect(uso.porModelo[MODELO_GEMINI_RESPALDO]).toBe(1);
  // Siguiente petición: ya ni se intenta el principal.
  global.fetch.mockResolvedValueOnce(respuestaOk('{"b":2}'));
  await llamarGemini({ promptTexto: 'y', valorRespaldo: null });
  expect(global.fetch.mock.calls[2][0]).toContain(MODELO_GEMINI_RESPALDO);
  expect(MODELO_GEMINI_ULTIMO_RECURSO).toBe('gemini-flash-latest');
});

test('un error transitorio (RATE_LIMIT) se recupera solo si el reintento al mismo modelo tiene éxito', async () => {
  global.fetch.mockResolvedValueOnce(respuestaError(429));
  global.fetch.mockResolvedValueOnce(respuestaOk('{"a":1}'));
  const resultado = await llamarGemini({ promptTexto: 'x', valorRespaldo: null });
  expect(resultado).toEqual({ a: 1 });
  expect(global.fetch).toHaveBeenCalledTimes(2);
  // Ambos intentos deben haber sido al modelo PRINCIPAL, no al de respaldo.
  const [urlIntento1] = global.fetch.mock.calls[0];
  const [urlIntento2] = global.fetch.mock.calls[1];
  expect(urlIntento1).toContain(MODELO_GEMINI_PRINCIPAL);
  expect(urlIntento2).toContain(MODELO_GEMINI_PRINCIPAL);
});

test('si el modelo principal se agota (dos fallos), prueba el modelo de respaldo y tiene éxito ahí', async () => {
  global.fetch.mockResolvedValueOnce(respuestaError(500)); // principal, intento 1
  global.fetch.mockResolvedValueOnce(respuestaError(500)); // principal, reintento
  global.fetch.mockResolvedValueOnce(respuestaOk('{"a":2}')); // respaldo, éxito
  const resultado = await llamarGemini({ promptTexto: 'x', valorRespaldo: null });
  expect(resultado).toEqual({ a: 2 });
  expect(global.fetch).toHaveBeenCalledTimes(3);
  const [, , urlDelExito] = global.fetch.mock.calls.map((llamada) => llamada[0]);
  expect(urlDelExito).toContain(MODELO_GEMINI_RESPALDO);
});

test('un fallo de red rápido se reintenta UNA vez y luego se propaga (sin cambiar de modelo)', async () => {
  global.fetch.mockRejectedValueOnce(new Error('Network request failed'));
  global.fetch.mockRejectedValueOnce(new Error('Network request failed'));
  await expect(llamarGemini({ promptTexto: 'x', valorRespaldo: null })).rejects.toThrow('Network request failed');
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('un corte puntual de red (cambio wifi->datos) se recupera con el reintento', async () => {
  global.fetch.mockRejectedValueOnce(new Error('Network request failed'));
  global.fetch.mockResolvedValueOnce(respuestaOk('{"ok":true}'));
  await expect(llamarGemini({ promptTexto: 'x', valorRespaldo: null })).resolves.toEqual({ ok: true });
});

test('un timeout (AbortError) no se reintenta', async () => {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  global.fetch.mockRejectedValueOnce(e);
  await expect(llamarGemini({ promptTexto: 'x', valorRespaldo: null })).rejects.toThrow('Aborted');
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('envía la clave en la cabecera x-goog-api-key, no en la query string', async () => {
  global.fetch.mockResolvedValueOnce(respuestaOk('{"a":1}'));
  await llamarGemini({ promptTexto: 'x', valorRespaldo: null });

  const [url, opciones] = global.fetch.mock.calls[0];
  expect(url).not.toMatch(/[?&]key=/);
  expect(url).toContain(MODELO_GEMINI_PRINCIPAL);
  expect(opciones.headers['x-goog-api-key']).toBeTruthy();
});

describe('llamarGeminiChat (Asistente)', () => {
  test('manda historial + pregunta + foto y el encuadre de agrónomo con el contexto', async () => {
    global.fetch.mockResolvedValueOnce(respuestaOk('  Respuesta del experto  '));
    const r = await llamarGeminiChat({
      historial: [{ rol: 'user', texto: 'hola' }, { rol: 'model', texto: 'hola, ¿en qué te ayudo?' }],
      mensajeNuevo: '¿Qué le pasa?',
      imagenBase64: 'QUJD',
      contextoSistema: 'Contexto del huerto: Limonero.',
    });
    expect(r).toBe('Respuesta del experto');
    const cuerpo = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(cuerpo.contents).toHaveLength(3);
    expect(cuerpo.contents[1].role).toBe('model');
    expect(cuerpo.contents[2].parts[1].inline_data.data).toBe('QUJD');
    const sistema = JSON.stringify(cuerpo.systemInstruction || cuerpo.system_instruction);
    expect(sistema).toMatch(/agrónomo/);
    expect(sistema).toMatch(/Contexto del huerto: Limonero/);
  });
});
