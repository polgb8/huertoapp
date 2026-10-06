// store.js es un singleton (create() se ejecuta una vez al importar),
// así que cada test recarga el módulo para partir de estado limpio.
beforeEach(() => {
  jest.resetModules();
});

test('estado inicial: conectado=true, resto en null/vacío', () => {
  const { useAppStore } = require('./store');
  const estado = useAppStore.getState();
  expect(estado.conectado).toBe(true);
  expect(estado.coords).toBeNull();
  expect(estado.clima).toBeNull();
  expect(estado.ultimoDiagnostico).toBeNull();
});

test('setCoords y setClima actualizan el estado sin tocar el resto', () => {
  const { useAppStore } = require('./store');
  useAppStore.getState().setCoords({ lat: 40.4, lon: -3.7 });
  useAppStore.getState().setClima({ resumenTexto: '20°C' });

  const estado = useAppStore.getState();
  expect(estado.coords).toEqual({ lat: 40.4, lon: -3.7 });
  expect(estado.clima).toEqual({ resumenTexto: '20°C' });
  expect(estado.conectado).toBe(true); // no se ha tocado
});

test('setConectado(false) refleja que NetInfo detectó falta de red', () => {
  const { useAppStore } = require('./store');
  useAppStore.getState().setConectado(false);
  expect(useAppStore.getState().conectado).toBe(false);
});
