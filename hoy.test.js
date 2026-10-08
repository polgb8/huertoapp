import { construirHoy } from './hoy';

const ahora = new Date(2026, 8, 25, 10);
const hoyISO = new Date(2026, 8, 25, 8).toISOString();
const CAT = [
  { nombre: 'Tomate', diasCosecha: 90 },
  { nombre: 'Limonero' },
];

test('agrupa riegos por zona, lista podas, cosechas y hechos; cuenta el progreso', () => {
  const activos = [
    { id: 1, nombre: 'Tomate', zona: 'Bancal 1', fecha_siembra: new Date(2026, 5, 1).toISOString(), dias_cosecha: 90 },
    { id: 2, nombre: 'Pimiento', zona: 'Bancal 1', fecha_siembra: new Date(2026, 8, 1).toISOString(), dias_cosecha: 90 },
    { id: 3, nombre: 'Limonero', origen: 'establecida', ultimo_riego: hoyISO },
    { id: 4, nombre: 'Lechuga', fecha_siembra: new Date(2026, 8, 1).toISOString(), dias_cosecha: 60 },
  ];
  const recomendaciones = [
    { id: 1, nombre: 'Tomate', necesitaRiego: true },
    { id: 2, nombre: 'Pimiento', necesitaRiego: true },
    { id: 4, nombre: 'Lechuga', necesitaRiego: true },
    { id: 3, nombre: 'Limonero', necesitaRiego: false, yaRegadoHoy: true },
  ];
  const r = construirHoy({
    activos,
    recomendaciones,
    alertasPoda: [{ cultivoId: 3, nombre: 'Limonero' }],
    tareas: [{ id: 't1', titulo: 'Sanear' }],
    catalogo: CAT,
    ahora,
  });
  expect(r.regarPorZona.map((z) => [z.zona, z.items.length])).toEqual([['Bancal 1', 2], ['Sin zona', 1]]);
  expect(r.podar).toHaveLength(1);
  expect(r.cosechar.map((c) => c.nombre)).toEqual(['Tomate']); // 116 días > 90; el limonero (perenne) no
  expect(r.hechos).toEqual([expect.objectContaining({ id: 3, tipo: 'riego' })]);
  expect(r.pendientes).toBe(3 + 1 + 1 + 1);
  expect(r.total).toBe(7);
});

test('sin nada -> todo a cero', () => {
  const r = construirHoy({});
  expect(r.total).toBe(0);
  expect(r.regarPorZona).toEqual([]);
});
