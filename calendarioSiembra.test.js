import { obtenerPlantableEsteMes, CALENDARIO_SIEMBRA, MESES, ESTACIONES } from './calendarioSiembra';

describe('obtenerPlantableEsteMes', () => {
  test('mes con especies de un solo método (directa) las etiqueta como directa', () => {
    const lista = obtenerPlantableEsteMes(5); // mayo
    const zanahoria = lista.find((x) => x.nombre === 'Zanahoria');
    expect(zanahoria).toBeDefined();
    expect(zanahoria.metodo).toBe('directa');
  });

  test('mes con especie de un solo método (semillero) la etiqueta como semillero', () => {
    const lista = obtenerPlantableEsteMes(2); // febrero
    const apio = lista.find((x) => x.nombre === 'Apio');
    expect(apio).toBeDefined();
    expect(apio.metodo).toBe('semillero');
  });

  test('mes en el que una especie admite AMBOS métodos se etiqueta como cualquiera', () => {
    const lista = obtenerPlantableEsteMes(4); // abril: Calabacín admite directa [4,5,6] y semillero [3,4]
    const calabacin = lista.find((x) => x.nombre === 'Calabacín');
    expect(calabacin).toBeDefined();
    expect(calabacin.metodo).toBe('cualquiera');
  });

  test('una especie que no admite nada ese mes no aparece en la lista', () => {
    const lista = obtenerPlantableEsteMes(6); // junio: Tomate solo semillero en 1,2,3
    expect(lista.find((x) => x.nombre === 'Tomate')).toBeUndefined();
  });

  test('mes en el que una especie solo admite un método se etiqueta con ese método (no cualquiera)', () => {
    const lista = obtenerPlantableEsteMes(6); // junio: Calabacín solo directa [4,5,6] ese mes
    const calabacin = lista.find((x) => x.nombre === 'Calabacín');
    expect(calabacin).toBeDefined();
    expect(calabacin.metodo).toBe('directa');
  });

  test('MESES y ESTACIONES tienen 12 elementos, uno por mes', () => {
    expect(MESES).toHaveLength(12);
    expect(ESTACIONES).toHaveLength(12);
  });

  test('todas las especies del calendario tienen al menos un método definido', () => {
    Object.entries(CALENDARIO_SIEMBRA).forEach(([nombre, info]) => {
      const tieneAlgo = Array.isArray(info.directa) || Array.isArray(info.semillero);
      expect(tieneAlgo).toBe(true);
    });
  });
});
