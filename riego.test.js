import { calcularRecomendacionesRiego, calcularRiegoOrientativo, formatearCantidadRegaderas, regadoHoy, calcularAvisosRiego } from './riego';

const CATALOGO_PRUEBA = [
  { nombre: 'Calabacín', tipo: '🥕 Hortaliza', metodoRiego: 'Riego por goteo, 2 veces por semana.' },
  { nombre: 'Zanahoria', tipo: '🥕 Hortaliza', metodoRiego: 'Riego a mano con regadera, suelo siempre húmedo.' },
  { nombre: 'Limonero', tipo: '🌳 Árbol frutal', metodoRiego: 'Cómo regar: mejor riego por goteo (2-4 goteros).' },
];

describe('calcularRecomendacionesRiego', () => {
  test('sin balance todavía -> null (aún no hay datos, no se muestra nada)', () => {
    expect(calcularRecomendacionesRiego([], CATALOGO_PRUEBA, null)).toBeNull();
  });

  test('lluvia suficiente -> no toca regar ningún cultivo', () => {
    const resultado = calcularRecomendacionesRiego(
      [{ id: 1, nombre: 'Calabacín' }],
      CATALOGO_PRUEBA,
      { lluviaSuficiente: true, litrosPorM2: 0 }
    );
    expect(resultado.tocaRegar).toBe(false);
    // Ahora se muestra igualmente una línea bajo cada planta (bug de Pol:
    // "no sale la cantidad de riego debajo de las plantas").
    expect(resultado.recomendaciones).toHaveLength(1);
    expect(resultado.recomendaciones[0].necesitaRiego).toBe(false);
    expect(resultado.recomendaciones[0].detalle).toMatch(/llovido/);
  });

  test('sin cultivos activos -> mensaje general con el déficit, sin lista por planta', () => {
    const resultado = calcularRecomendacionesRiego(
      [],
      CATALOGO_PRUEBA,
      { lluviaSuficiente: false, litrosPorM2: 4 }
    );
    expect(resultado.tocaRegar).toBe(true);
    expect(resultado.recomendaciones).toEqual([]);
    expect(resultado.mensajeGeneral).toMatch(/4 litros por m/);
  });

  test('cultivo con método de goteo -> recomendación en minutos, no en regaderas', () => {
    const resultado = calcularRecomendacionesRiego(
      [{ id: 1, nombre: 'Calabacín', cantidad: 1 }],
      CATALOGO_PRUEBA,
      { lluviaSuficiente: false, litrosPorM2: 3 }
    );
    expect(resultado.tocaRegar).toBe(true);
    expect(resultado.recomendaciones).toHaveLength(1);
    expect(resultado.recomendaciones[0].porGoteo).toBe(true);
    // Ahora también debe incluir la cantidad de agua equivalente, no
    // solo los minutos (petición explícita de Pol tras probar la app).
    expect(resultado.recomendaciones[0].detalle).toMatch(/^Goteo: unos \d+ min \(.+\)$/);
  });

  test('cultivo regado a mano -> recomendación en regaderas, no en minutos', () => {
    const resultado = calcularRecomendacionesRiego(
      [{ id: 2, nombre: 'Zanahoria', cantidad: 3 }],
      CATALOGO_PRUEBA,
      { lluviaSuficiente: false, litrosPorM2: 3 }
    );
    expect(resultado.recomendaciones[0].porGoteo).toBe(false);
    expect(resultado.recomendaciones[0].detalle).toMatch(/regadera|chorro/);
  });

  test('varias unidades del mismo cultivo (cantidad) piden más agua que una sola', () => {
    const uno = calcularRecomendacionesRiego(
      [{ id: 1, nombre: 'Zanahoria', cantidad: 1 }],
      CATALOGO_PRUEBA,
      { lluviaSuficiente: false, litrosPorM2: 3 }
    );
    const varios = calcularRecomendacionesRiego(
      [{ id: 1, nombre: 'Zanahoria', cantidad: 5 }],
      CATALOGO_PRUEBA,
      { lluviaSuficiente: false, litrosPorM2: 3 }
    );
    expect(varios.recomendaciones[0].litrosTotales).toBeGreaterThan(uno.recomendaciones[0].litrosTotales);
  });

  test('dos especies de la misma categoría con necesidad distinta: la sedienta necesita más agua al día y se riega más a menudo', () => {
    const catalogoConRiego = [
      { nombre: 'Sediento', tipo: '🥕 Hortaliza', metodoRiego: 'A mano.', riego: 2 },
      { nombre: 'Resistente', tipo: '🥕 Hortaliza', metodoRiego: 'A mano.', riego: 15 },
    ];
    const resultado = calcularRecomendacionesRiego(
      [
        { id: 1, nombre: 'Sediento', cantidad: 1 },
        { id: 2, nombre: 'Resistente', cantidad: 1 },
      ],
      catalogoConRiego,
      { lluviaSuficiente: false, litrosPorM2: 3 }
    );
    const [sediento, resistente] = resultado.recomendaciones;
    expect(sediento.litrosDia).toBeGreaterThan(resistente.litrosDia);
    expect(sediento.frecuencia).toBeLessThan(resistente.frecuencia);
  });

  test('cultivo que no está en el catálogo usa un valor por defecto en vez de romper', () => {
    const resultado = calcularRecomendacionesRiego(
      [{ id: 9, nombre: 'Planta rarísima que no existe' }],
      CATALOGO_PRUEBA,
      { lluviaSuficiente: false, litrosPorM2: 3 }
    );
    expect(resultado.recomendaciones).toHaveLength(1);
    expect(resultado.recomendaciones[0].litrosTotales).toBeGreaterThan(0);
  });

  test('sin datos de balance (deficit null) -> mensaje de "sin datos", no inventa una cifra', () => {
    const resultado = calcularRecomendacionesRiego(
      [{ id: 1, nombre: 'Calabacín' }],
      CATALOGO_PRUEBA,
      { lluviaSuficiente: false, litrosPorM2: null }
    );
    expect(resultado.tocaRegar).toBe(false);
    expect(resultado.mensajeGeneral).toMatch(/Sin datos/i);
  });
});

describe('regadoHoy', () => {
  test('sin fecha -> false', () => {
    expect(regadoHoy(null)).toBe(false);
    expect(regadoHoy(undefined)).toBe(false);
  });

  test('fecha inválida -> false, nunca lanza', () => {
    expect(regadoHoy('no-es-una-fecha')).toBe(false);
  });

  test('regado hace un momento (hoy) -> true', () => {
    expect(regadoHoy(new Date().toISOString())).toBe(true);
  });

  test('regado ayer -> false (ya no cuenta como "hoy")', () => {
    const ayer = new Date();
    ayer.setDate(ayer.getDate() - 1);
    expect(regadoHoy(ayer.toISOString())).toBe(false);
  });
});

describe('calcularRecomendacionesRiego con "ya regado hoy"', () => {
  test('cultivo marcado como regado hoy -> no toca regar, aunque haya déficit', () => {
    const resultado = calcularRecomendacionesRiego(
      [{ id: 1, nombre: 'Calabacín', cantidad: 1, ultimo_riego: new Date().toISOString() }],
      CATALOGO_PRUEBA,
      { lluviaSuficiente: false, litrosPorM2: 3 }
    );
    expect(resultado.recomendaciones).toHaveLength(1);
    expect(resultado.recomendaciones[0].necesitaRiego).toBe(false);
    expect(resultado.recomendaciones[0].yaRegadoHoy).toBe(true);
    expect(resultado.recomendaciones[0].detalle).toMatch(/Ya regado hoy/);
  });

  test('cultivo regado AYER (no hoy) -> sigue pidiendo riego con normalidad', () => {
    const ayer = new Date();
    ayer.setDate(ayer.getDate() - 1);
    const resultado = calcularRecomendacionesRiego(
      [{ id: 1, nombre: 'Calabacín', cantidad: 1, ultimo_riego: ayer.toISOString() }],
      CATALOGO_PRUEBA,
      { lluviaSuficiente: false, litrosPorM2: 3 }
    );
    expect(resultado.recomendaciones[0].necesitaRiego).toBe(true);
    expect(resultado.recomendaciones[0].yaRegadoHoy).toBe(false);
  });
});

describe('formatearCantidadRegaderas', () => {
  test('0 o negativo -> null (no se ofrece una cantidad sin sentido)', () => {
    expect(formatearCantidadRegaderas(0)).toBeNull();
    expect(formatearCantidadRegaderas(-2)).toBeNull();
  });

  test('cantidades pequeñas y medianas se expresan en fracciones de regadera', () => {
    expect(formatearCantidadRegaderas(2.5)).toMatch(/media regadera/);
    expect(formatearCantidadRegaderas(5)).toMatch(/una regadera/);
  });

  test('cantidades grandes se expresan en regaderas enteras', () => {
    expect(formatearCantidadRegaderas(15)).toMatch(/3 regaderas/);
  });
});

describe('árboles: método FAO-56 (ETo × Kc × área de copa)', () => {
  const CAT = [
    { nombre: 'Limonero', tipo: '🌳 Árbol frutal', riego: 7, metodoRiego: 'A mano' },
    { nombre: 'Cerezo', tipo: '🌳 Árbol frutal', riego: 7, metodoRiego: 'A mano' },
    { nombre: 'Granado', tipo: '🌳 Árbol frutal', riego: 10, metodoRiego: 'A mano' },
  ];
  const balance = { lluviaSuficiente: false, litrosPorM2: 3 };
  const julio = new Date(2026, 6, 15);
  const septiembre = new Date(2026, 8, 25);
  const enero = new Date(2027, 0, 15);

  test('limonero mediano (copa 2,5 m), 3 mm/día: ≈ 3 × 0,65 × 4,9 m² × 7 días ≈ 67 L por riego semanal', () => {
    const r = calcularRecomendacionesRiego([{ id: 1, nombre: 'Limonero' }], CAT, balance, julio);
    expect(r.recomendaciones[0].litrosTotales).toBeGreaterThan(60);
    expect(r.recomendaciones[0].litrosTotales).toBeLessThan(75);
  });

  test('el diámetro de copa estimado manda sobre el tamaño genérico', () => {
    const peq = calcularRecomendacionesRiego([{ id: 1, nombre: 'Limonero', diametro_copa: 1 }], CAT, balance, julio);
    const gr = calcularRecomendacionesRiego([{ id: 1, nombre: 'Limonero', diametro_copa: 4 }], CAT, balance, julio);
    expect(gr.recomendaciones[0].litrosTotales).toBeCloseTo(peq.recomendaciones[0].litrosTotales * 16, -1);
  });

  test('cerezo tras la cosecha (septiembre) bebe bastante menos que en junio (fenología + riego deficitario)', () => {
    const jul = calcularRecomendacionesRiego([{ id: 1, nombre: 'Cerezo' }], CAT, balance, new Date(2026, 5, 15));
    const sep = calcularRecomendacionesRiego([{ id: 1, nombre: 'Cerezo' }], CAT, balance, septiembre);
    expect(sep.recomendaciones[0].litrosTotales).toBeLessThan(jul.recomendaciones[0].litrosTotales * 0.6);
  });

  test('caduco en enero: en reposo, no pide riego', () => {
    const r = calcularRecomendacionesRiego([{ id: 1, nombre: 'Granado' }], CAT, balance, enero);
    expect(r.recomendaciones[0].necesitaRiego).toBe(false);
    expect(r.recomendaciones[0].detalle).toMatch(/reposo/);
  });

  test('árbol joven (<2 años, fecha real) se riega más a menudo', () => {
    const joven = calcularRecomendacionesRiego(
      [{ id: 1, nombre: 'Limonero', fecha_siembra: new Date(2026, 0, 1).toISOString() }], CAT, balance, julio
    );
    expect(joven.recomendaciones[0].frecuencia).toBe(4);
  });

  test('orientativo en invierno: limonero (perenne) más espaciado que en verano', () => {
    const inv = calcularRiegoOrientativo([{ id: 1, nombre: 'Limonero' }], CAT, enero);
    const ver = calcularRiegoOrientativo([{ id: 1, nombre: 'Limonero' }], CAT, julio);
    expect(inv.recomendaciones[0].detalle).toMatch(/cada ~20 días/);
    expect(ver.recomendaciones[0].detalle).toMatch(/cada ~7 días/);
  });
});

describe('frecuencia por especie y riego orientativo', () => {
  const CAT = [{ nombre: 'Aloe vera', tipo: '🌵 Cactus/suculenta', riego: 16, metodoRiego: 'A mano' }];
  const balance = { lluviaSuficiente: false, litrosPorM2: 4 };

  test('suculenta regada hace 3 días -> no toca, indica próximo riego', () => {
    const hace3 = new Date();
    hace3.setDate(hace3.getDate() - 3);
    const r = calcularRecomendacionesRiego([{ id: 1, nombre: 'Aloe vera', ultimo_riego: hace3.toISOString() }], CAT, balance);
    expect(r.recomendaciones[0].necesitaRiego).toBe(false);
    expect(r.recomendaciones[0].detalle).toMatch(/próximo riego en ~13 días/);
  });

  test('sin balance -> riego orientativo con frecuencia para cada planta', () => {
    const julio = new Date(2026, 6, 15);
    const r = calcularRiegoOrientativo([{ id: 1, nombre: 'Aloe vera' }, { id: 2, nombre: 'Planta desconocida' }], CAT, julio);
    expect(r.recomendaciones).toHaveLength(2);
    expect(r.recomendaciones[0].detalle).toMatch(/cada ~16 días/);
    expect(r.recomendaciones[1].detalle).toMatch(/Habitual|tierra/);
  });
});

describe('calcularAvisosRiego (notificaciones)', () => {
  const ahora = new Date(2026, 8, 25, 8, 0, 0);
  test('toca regar hoy -> aviso hoy a las 9 y siguientes según frecuencia', () => {
    const avisos = calcularAvisosRiego([{ id: 1, nombre: 'Tomate', necesitaRiego: true, frecuencia: 3 }], [{ id: 1 }], ahora, 9);
    expect(avisos[0].fecha).toEqual(new Date(2026, 8, 25, 9, 0, 0));
    expect(avisos.map((a) => a.fecha.getDate())).toEqual([25, 28, 1, 4]);
  });
  test('agrupa plantas del mismo día en un solo aviso', () => {
    const avisos = calcularAvisosRiego(
      [
        { id: 1, nombre: 'Tomate', necesitaRiego: true, frecuencia: 3 },
        { id: 2, nombre: 'Pimiento', necesitaRiego: true, frecuencia: 3 },
      ],
      [],
      ahora,
      9
    );
    expect(avisos[0].nombres).toEqual(['Tomate', 'Pimiento']);
  });
  test('en reposo -> sin avisos; hora ya pasada -> aviso a las 19:00', () => {
    expect(calcularAvisosRiego([{ id: 1, nombre: 'Cerezo', enReposo: true, frecuencia: 7, necesitaRiego: false }], [], ahora)).toEqual([]);
    const tarde = new Date(2026, 8, 25, 12, 0, 0);
    const a = calcularAvisosRiego([{ id: 1, nombre: 'Tomate', necesitaRiego: true }], [], tarde, 9);
    expect(a[0].fecha.getHours()).toBe(19);
  });
});

describe('v16: tipo de suelo y lluvia prevista', () => {
  const CAT = [{ nombre: 'Tomate', tipo: '🥕 Hortaliza', riego: 3, metodoRiego: 'A mano' }];
  const b = { lluviaSuficiente: false, litrosPorM2: 4 };
  test('suelo arenoso: riegos más seguidos y menos agua por riego; arcilloso al revés', () => {
    const franco = calcularRecomendacionesRiego([{ id: 1, nombre: 'Tomate' }], CAT, b).recomendaciones[0];
    const arena = calcularRecomendacionesRiego([{ id: 1, nombre: 'Tomate', tipo_suelo: 'arenoso' }], CAT, b).recomendaciones[0];
    const arcilla = calcularRecomendacionesRiego([{ id: 1, nombre: 'Tomate' }], CAT, b, new Date(), { suelo: 'arcilloso' }).recomendaciones[0];
    expect(arena.frecuencia).toBe(2);
    expect(arcilla.frecuencia).toBe(4);
    expect(arena.litrosTotales).toBeLessThan(franco.litrosTotales);
    expect(arcilla.litrosTotales).toBeGreaterThan(franco.litrosTotales);
  });
  test('lluvia fuerte prevista: no pide riego y lo explica', () => {
    const r = calcularRecomendacionesRiego([{ id: 1, nombre: 'Tomate' }], CAT, { ...b, lluviaPrevistaMm: 12, probabilidadLluviaPrevista: 80 });
    expect(r.recomendaciones[0].necesitaRiego).toBe(false);
    expect(r.recomendaciones[0].detalle).toMatch(/Se esperan ~12 mm/);
    expect(r.mensajeGeneral).toMatch(/espera/);
  });
  test('lluvia moderada prevista: menos agua', () => {
    const normal = calcularRecomendacionesRiego([{ id: 1, nombre: 'Tomate' }], CAT, b).recomendaciones[0];
    const r = calcularRecomendacionesRiego([{ id: 1, nombre: 'Tomate' }], CAT, { ...b, lluviaPrevistaMm: 4, probabilidadLluviaPrevista: 70 }).recomendaciones[0];
    expect(r.necesitaRiego).toBe(true);
    expect(r.litrosTotales).toBeLessThan(normal.litrosTotales);
    expect(r.detalle).toMatch(/menos agua/);
  });
  test('lluvia poco probable: se ignora', () => {
    const r = calcularRecomendacionesRiego([{ id: 1, nombre: 'Tomate' }], CAT, { ...b, lluviaPrevistaMm: 12, probabilidadLluviaPrevista: 20 }).recomendaciones[0];
    expect(r.necesitaRiego).toBe(true);
  });
});

describe('v17 — cantidades realistas', () => {
  const { CATALOGO_PLANTAS } = require('./catalogoPlantas');
  const cat = CATALOGO_PLANTAS.flatMap((c) => c.plantas);
  test('lechuga: FAO-56 por marco de plantación (< 0,5 L/planta/día)', () => {
    const r = calcularRecomendacionesRiego([{ id: 1, nombre: 'Lechuga', cantidad: 1 }], cat, { litrosPorM2: 3, lluviaPrevistaMm: 0 });
    const porDia = r.recomendaciones[0].litrosTotales / (r.recomendaciones[0].frecuencia || 1);
    expect(porDia).toBeLessThan(0.5);
    expect(porDia).toBeGreaterThan(0.1);
  });
  test('goteo: el tiempo NO se multiplica por el número de plantas (cada una tiene su gotero)', () => {
    const una = calcularRecomendacionesRiego([{ id: 1, nombre: 'Tomate', cantidad: 1 }], cat, { litrosPorM2: 3, lluviaPrevistaMm: 0 });
    const cuatro = calcularRecomendacionesRiego([{ id: 1, nombre: 'Tomate', cantidad: 4 }], cat, { litrosPorM2: 3, lluviaPrevistaMm: 0 });
    const min = (t) => Number((t.match(/unos (\d+) min/) || [])[1]);
    expect(Math.abs(min(una.recomendaciones[0].detalle) - min(cuatro.recomendaciones[0].detalle))).toBeLessThanOrEqual(2);
    expect(cuatro.recomendaciones[0].litrosTotales).toBeCloseTo(una.recomendaciones[0].litrosTotales * 4, 0);
  });
});
