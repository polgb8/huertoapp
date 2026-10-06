import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reprogramarAvisosRiego, reprogramarAvisosPoda } from './notificaciones';

const futuro = (dias) => new Date(Date.now() + dias * 864e5);

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

test('programa un aviso por fecha y no reprograma si nada cambió', async () => {
  const avisos = [{ fecha: futuro(1), nombres: ['Tomate'] }, { fecha: futuro(3), nombres: ['Tomate', 'Pimiento'] }];
  expect(await reprogramarAvisosRiego(avisos)).toBe(true);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  const contenido = Notifications.scheduleNotificationAsync.mock.calls[1][0].content;
  expect(contenido.title).toMatch(/regar/);
  expect(contenido.body).toMatch(/Tomate, Pimiento/);

  jest.clearAllMocks();
  await reprogramarAvisosRiego(avisos);
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

test('si cambia, cancela los anteriores de ESE grupo; [] los cancela todos', async () => {
  await reprogramarAvisosPoda([{ fecha: futuro(10), nombres: ['Rosal'] }]);
  jest.clearAllMocks();
  await reprogramarAvisosPoda([]);
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

test('fechas pasadas se ignoran', async () => {
  await reprogramarAvisosRiego([{ fecha: new Date(Date.now() - 1000), nombres: ['X'] }]);
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});
