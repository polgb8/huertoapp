import { calcularAlertasPoda, buscarInfoPoda, describirMesesPoda, proximoMesPoda, inicioProximaTemporada, pasosPoda } from './poda';

const MS_POR_DIA = 24 * 60 * 60 * 1000;
// Fechas fijas (no Date.now) para que el test no dependa del mes en que se ejecute.
const SEPT = new Date(2026, 8, 25); // 25-sep-2026: temporada de lavanda (ago-sep)
const ENERO = new Date(2027, 0, 15); // 15-ene-2027: poda de invierno de frutales
const antesDe = (fecha, dias) => new Date(fecha.getTime() - dias * MS_POR_DIA).toISOString();

describe('calcularAlertasPoda (por temporada)', () => {
  test('entrada no válida o vacía -> []', () => {
    expect(calcularAlertasPoda(null)).toEqual([]);
    expect(calcularAlertasPoda([])).toEqual([]);
  });

  test('especie que no se poda (hortaliza) -> sin alerta', () => {
    expect(calcularAlertasPoda([{ id: 1, nombre: 'Tomate', fecha_siembra: antesDe(SEPT, 400) }], null, SEPT)).toEqual([]);
  });

  test('fuera de temporada -> sin alerta aunque lleve 400 días plantado (bug reportado)', () => {
    const r = calcularAlertasPoda([{ id: 1, nombre: 'Manzano', fecha_siembra: antesDe(SEPT, 400) }], null, SEPT);
    expect(r).toEqual([]);
  });

  test('en temporada y nunca podado -> alerta con tipo y consejo', () => {
    const r = calcularAlertasPoda([{ id: 7, nombre: 'Lavanda', fecha_siembra: antesDe(SEPT, 400), zona: 'Bancal 1' }], null, SEPT);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ cultivoId: 7, nombre: 'Lavanda', zona: 'Bancal 1', mesFin: 'septiembre' });
    expect(r[0].tipoPoda).toMatch(/floración/);
  });

  test('"Ya lo he podado" en esta temporada -> desaparece la alerta (bug reportado)', () => {
    const r = calcularAlertasPoda(
      [{ id: 7, nombre: 'Lavanda', fecha_siembra: antesDe(SEPT, 400), ultima_poda: antesDe(SEPT, 2) }],
      null,
      SEPT
    );
    expect(r).toEqual([]);
  });

  test('podado la temporada ANTERIOR -> vuelve a avisar en la nueva', () => {
    const r = calcularAlertasPoda(
      [{ id: 7, nombre: 'Lavanda', fecha_siembra: antesDe(SEPT, 800), ultima_poda: antesDe(SEPT, 365) }],
      null,
      SEPT
    );
    expect(r).toHaveLength(1);
  });

  test('temporada que cruza el año (dic-feb): podado en diciembre cuenta como esta temporada en enero', () => {
    const r = calcularAlertasPoda(
      [{ id: 1, nombre: 'Manzano', fecha_siembra: antesDe(ENERO, 900), ultima_poda: new Date(2026, 11, 20).toISOString() }],
      null,
      ENERO
    );
    expect(r).toEqual([]);
  });

  test('recién plantado (<90 días) -> no se avisa', () => {
    expect(calcularAlertasPoda([{ id: 1, nombre: 'Lavanda', fecha_siembra: antesDe(SEPT, 20) }], null, SEPT)).toEqual([]);
  });

  test('"ya estaba plantada" -> se avisa aunque la fecha de alta sea de hoy', () => {
    const r = calcularAlertasPoda(
      [{ id: 1, nombre: 'Lavanda', origen: 'establecida', fecha_siembra: SEPT.toISOString() }],
      null,
      SEPT
    );
    expect(r).toHaveLength(1);
  });

  test('pinzado repetible (albahaca): vuelve a avisar pasados sus días', () => {
    const base = { id: 1, nombre: 'Albahaca', origen: 'establecida' };
    expect(calcularAlertasPoda([{ ...base, ultima_poda: antesDe(SEPT, 5) }], null, SEPT)).toEqual([]);
    expect(calcularAlertasPoda([{ ...base, ultima_poda: antesDe(SEPT, 25) }], null, SEPT)).toHaveLength(1);
  });

  test('fecha inválida no rompe', () => {
    expect(() => calcularAlertasPoda([{ id: 1, nombre: 'Lavanda', fecha_siembra: 'x', ultima_poda: 'y' }], null, SEPT)).not.toThrow();
  });
});

describe('utilidades de calendario', () => {
  test('buscarInfoPoda: exacto, parcial y sin acentos', () => {
    expect(buscarInfoPoda('lavanda')?.nombre).toBe('Lavanda');
    expect(buscarInfoPoda('Limonero Eureka')?.nombre).toBe('Limonero');
    expect(buscarInfoPoda('Jazmín trepador')?.nombre).toBe('Jazmín trepador');
    expect(buscarInfoPoda('Tomate')).toBeNull();
  });

  test('describirMesesPoda y proximoMesPoda', () => {
    expect(describirMesesPoda([8, 9])).toBe('agosto y septiembre');
    expect(proximoMesPoda([12, 1, 2], SEPT)).toBe(12);
    expect(proximoMesPoda([8, 9], SEPT)).toBe(8);
  });
});

describe('zona climática y próxima temporada', () => {
  test('zona de interior retrasa un mes la poda de invierno del rosal; la lavanda (post-floración) no cambia', () => {
    expect(buscarInfoPoda('Rosal', 'interior').meses).toEqual([2, 3]);
    expect(buscarInfoPoda('Rosal', 'calida').meses).toEqual([12, 1]);
    expect(buscarInfoPoda('Lavanda', 'montana').meses).toEqual([8, 9]);
  });

  test('en zona de interior, un rosal no avisa en enero pero sí en marzo', () => {
    const rosal = [{ id: 1, nombre: 'Rosal', origen: 'establecida' }];
    expect(calcularAlertasPoda(rosal, null, ENERO, 'interior')).toEqual([]);
    expect(calcularAlertasPoda(rosal, null, new Date(2027, 2, 5), 'interior')).toHaveLength(1);
  });

  test('inicioProximaTemporada: primer día del tramo, cruzando el año', () => {
    const f = inicioProximaTemporada([12, 1, 2], SEPT);
    expect([f.getFullYear(), f.getMonth(), f.getDate()]).toEqual([2026, 11, 1]);
    const g = inicioProximaTemporada([8, 9], SEPT); // ya en temporada -> la del año que viene
    expect([g.getFullYear(), g.getMonth()]).toEqual([2027, 7]);
  });
});

describe('cómo podar (pasos breves)', () => {
  test('cada alerta trae 2-4 pasos cortos, empezando por el consejo de la especie', () => {
    const [a] = calcularAlertasPoda([{ id: 1, nombre: 'Lavanda', origen: 'establecida' }], null, SEPT);
    expect(a.pasos.length).toBeGreaterThanOrEqual(2);
    expect(a.pasos.length).toBeLessThanOrEqual(4);
    expect(a.pasos[0]).toMatch(/espigas/);
  });
  test('árbol joven (<3 años con fecha real) -> primer paso de poda de formación', () => {
    const r = calcularAlertasPoda([{ id: 1, nombre: 'Manzano', fecha_siembra: antesDe(ENERO, 400) }], null, ENERO);
    expect(r[0].joven).toBe(true);
    expect(r[0].pasos[0]).toMatch(/formación/);
  });
  test('pasosPoda sin info -> []', () => {
    expect(pasosPoda(null)).toEqual([]);
  });
});
