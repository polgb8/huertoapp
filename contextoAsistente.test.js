import { construirContextoAsistente } from './contextoAsistente';

test('incluye fecha/estación, zona, plantas con detalle y pantalla', () => {
  const ctx = construirContextoAsistente({
    cultivos: [
      { nombre: 'Limonero', estado: 'sembrado', zona: 'Patio', tamano: 'mediano', tipo_suelo: 'arcilloso', ultimo_riego: new Date(2026, 8, 23).toISOString() },
      { nombre: 'Tomate', estado: 'cosechado' },
    ],
    zona: 'interior',
    coords: { lat: 41.39, lon: 2.17 },
    pantalla: 'Hoy',
    ahora: new Date(2026, 8, 25, 10),
  });
  expect(ctx).toMatch(/otoño/);
  expect(ctx).toMatch(/interior con heladas/);
  expect(ctx).toMatch(/Limonero \(zona Patio, tamaño mediano, suelo arcilloso, regado hace 2 días\)/);
  expect(ctx).not.toMatch(/Tomate/);
  expect(ctx).toMatch(/Hoy \(tareas del día\)/);
});

test('sin plantas lo indica', () => {
  expect(construirContextoAsistente({ ahora: new Date(2026, 0, 1) })).toMatch(/aún no tiene plantas/);
});
