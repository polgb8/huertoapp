import { calcularBalanceHidrico } from './clima';

test('balance: usa ayer/anteayer como lluvia caída, hoy para ETo y hoy+mañana como lluvia prevista', async () => {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          daily: {
            precipitation_sum: [1, 2, 0.5, 6], // anteayer, ayer, hoy, mañana
            et0_fao_evapotranspiration: [3, 3, 4.2, 3],
            temperature_2m_max: [25, 26, 28, 22],
            precipitation_probability_max: [0, 10, 30, 85],
          },
        }),
    })
  );
  const b = await calcularBalanceHidrico(41.1, 2.1);
  expect(b.lluviaAcumuladaMm).toBe(3);
  expect(b.etoHoyMm).toBe(4.2);
  expect(b.litrosPorM2).toBe(1.2);
  expect(b.lluviaPrevistaMm).toBe(6.5);
  expect(b.probabilidadLluviaPrevista).toBe(85);
  expect(b.tempMaxHoy).toBe(28);
});
