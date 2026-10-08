// ============================================================
// theme.js — Design tokens centralizados de HuertoApp.
// Toda pantalla/componente importa de aquí en vez de hardcodear
// colores o radios sueltos, para que el look sea consistente y
// fácil de retocar desde un único sitio.
// ============================================================

export const colors = {
  // v17: paleta "huerto" renovada — verde hoja vivo, fondos salvia muy
  // claros, acentos de agua/poda/tierra y más contraste en los textos.
  background: '#F2F6F1',
  headerDeep: '#174A33', // verde follaje profundo (cabeceras, hero)
  headerSoft: '#22744A',
  mint: '#22A05A', // acento principal (acciones)
  mintDark: '#1A7F46',
  card: '#FFFFFF',
  border: '#E2EAE3',
  textPrimary: '#122019',
  textSecondary: '#5B6B61',
  textOnDark: '#F4FBF6',
  textOnDarkSoft: '#C3DCCB',
  danger: '#DC2626',
  warning: '#C2410C',
  badgeOptimoBg: '#DCFCE7',
  badgeOptimoText: '#166534',
  badgeEnfermaBg: '#FEE2E2',
  badgeEnfermaText: '#991B1B',
  badgeSembradoBg: '#E3F1E8',
  badgeSembradoText: '#1F6B42',
  badgeNeutroBg: '#F1F5F0',
  badgeNeutroText: '#4B5A50',
  accentSoftBg: '#E4F4EA',
  accentSoftText: '#1A7F46',
  backgroundAlt: '#E9F0E6',
  // Agua (riego)
  agua: '#1D6FD1',
  aguaSoft: '#E7F1FD',
  // Poda (tijeras / temporada)
  poda: '#B45309',
  podaSoft: '#FEF3E2',
  // Tierra (detalles, sin cultivo)
  tierra: '#8A6A45',
  tierraSoft: '#F5EEE4',
  // Pendiente / sin conexión
  pendiente: '#6D28D9',
  pendienteSoft: '#F1EBFE',
  // Cosecha
  cosecha: '#C2410C',
  cosechaSoft: '#FFF1E7',
};

// Degradados (expo-linear-gradient): [inicio, fin].
export const gradientes = {
  hero: ['#14412D', '#1F6E46'],
  primario: ['#2BB36A', '#1C8B4C'],
  agua: ['#3B8BEB', '#1D63C9'],
  poda: ['#F2A33A', '#D97706'],
  cosecha: ['#FB923C', '#EA580C'],
  aviso: ['#FFF7ED', '#FFEDD5'],
  suave: ['#FFFFFF', '#F6FAF5'],
};

export const radii = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 };

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };

// Sombra suave reutilizable para tarjetas (iOS via shadow*, Android via elevation).
export const sombraTarjeta = {
  shadowColor: '#0B2A18',
  shadowOpacity: 0.07,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
  elevation: 2,
};

export const sombraFuerte = {
  shadowColor: '#0B2A18',
  shadowOpacity: 0.16,
  shadowRadius: 20,
  shadowOffset: { width: 0, height: 10 },
  elevation: 8,
};

export const tipografia = {
  titulo: { fontSize: 28, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.6 },
  subtitulo: { fontSize: 17, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.2 },
  cuerpo: { fontSize: 15, color: colors.textPrimary, lineHeight: 21 },
  caption: { fontSize: 12, color: colors.textSecondary },
};

// Mapa estado -> paleta de badge, usado por <Badge/> en las 3 pantallas.
export const paletaEstado = (estadoCrudo) => {
  const estado = (estadoCrudo || '').toLowerCase();
  if (['sana', 'óptimo', 'optimo', 'buena'].includes(estado)) {
    return { bg: colors.badgeOptimoBg, text: colors.badgeOptimoText, etiqueta: 'Óptimo' };
  }
  if (['enferma', 'enfermo', 'plaga', 'error'].includes(estado)) {
    return { bg: colors.badgeEnfermaBg, text: colors.badgeEnfermaText, etiqueta: 'Enferma' };
  }
  if (['sembrado', 'sembrada'].includes(estado)) {
    return { bg: colors.badgeSembradoBg, text: colors.badgeSembradoText, etiqueta: 'Sembrado' };
  }
  if (['cosechado', 'cosechada'].includes(estado)) {
    return { bg: colors.badgeOptimoBg, text: colors.badgeOptimoText, etiqueta: 'Cosechado' };
  }
  if (['perdido', 'perdida'].includes(estado)) {
    return { bg: colors.badgeEnfermaBg, text: colors.badgeEnfermaText, etiqueta: 'Perdida' };
  }
  return { bg: colors.badgeNeutroBg, text: colors.badgeNeutroText, etiqueta: estadoCrudo || '—' };
};
