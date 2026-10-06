import { normalizarEstimacion } from './estimarPlanta';

describe('normalizarEstimacion', () => {
  test('no es planta o respuesta vacía -> null', () => {
    expect(normalizarEstimacion(null)).toBeNull();
    expect(normalizarEstimacion({ es_planta: false })).toBeNull();
  });
  test('valores normales se redondean y acotan', () => {
    const r = normalizarEstimacion({ es_planta: true, tamano: 'mediano', diametro_copa_m: 2.46, edad_anios: 6.4, altura_m: 3, confianza: 'media' });
    expect(r).toMatchObject({ tamano: 'mediano', diametroCopa: 2.5, edadAnios: 6, confianza: 'media' });
  });
  test('análisis completo: suelo, salud, agua y recomendaciones (máx. 3)', () => {
    const r = normalizarEstimacion({
      es_planta: true, tamano: 'pequeno', diametro_copa_m: 1, edad_anios: 2,
      tipo_suelo: 'arcilloso', suelo_detalle: 'Grietas', salud_estado: 'leve', salud_detalle: 'Pulgón',
      agua_estado: 'falta', agua_detalle: 'Hojas lacias', recomendaciones: ['a', 'b', 'c', 'd', 3],
    });
    expect(r).toMatchObject({ tipoSuelo: 'arcilloso', salud: 'leve', agua: 'falta', saludDetalle: 'Pulgón' });
    expect(r.recomendaciones).toEqual(['a', 'b', 'c']);
  });
  test('suelo no visible / valores raros -> null', () => {
    const r = normalizarEstimacion({ es_planta: true, tamano: 'mediano', diametro_copa_m: 2, tipo_suelo: 'no_visible', agua_estado: 'no_se_sabe', salud_estado: 'x' });
    expect(r.tipoSuelo).toBeNull();
    expect(r.agua).toBeNull();
    expect(r.salud).toBeNull();
  });
  test('tamaño inválido se deduce del diámetro; valores absurdos se acotan', () => {
    const r = normalizarEstimacion({ es_planta: true, tamano: 'enorme', diametro_copa_m: 99, edad_anios: -3 });
    expect(r.tamano).toBe('grande');
    expect(r.diametroCopa).toBe(15);
    expect(r.edadAnios).toBe(0);
    expect(r.confianza).toBe('baja');
  });
});
