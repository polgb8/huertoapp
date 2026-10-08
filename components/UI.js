// ============================================================
// components/UI.js — Átomos visuales reutilizados por las pantallas:
// tarjeta, badge de estado, chip de zona, botones, barra de progreso,
// hero, avisos… v17: rediseño (degradados, sombras suaves, botones con
// respuesta táctil, campos con foco visible). La API de cada componente
// es la misma de siempre: las pantallas no necesitan cambios.
// ============================================================

import React, { useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Pressable, StyleSheet, ActivityIndicator, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radii, spacing, sombraTarjeta, sombraFuerte, gradientes, paletaEstado } from '../theme';

// Respuesta táctil: se "hunde" un poco al pulsar (sensación nativa).
function usarPulsacion(escala = 0.97) {
  const valor = useRef(new Animated.Value(1)).current;
  const animar = (a) => Animated.spring(valor, { toValue: a, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  return {
    estilo: { transform: [{ scale: valor }] },
    onPressIn: () => animar(escala),
    onPressOut: () => animar(1),
  };
}

export function Card({ children, style }) {
  return <View style={[estilos.card, style]}>{children}</View>;
}

export function Badge({ estado }) {
  const paleta = paletaEstado(estado);
  return (
    <View style={[estilos.badge, { backgroundColor: paleta.bg }]}>
      <Text style={[estilos.badgeTexto, { color: paleta.text }]}>{paleta.etiqueta}</Text>
    </View>
  );
}

// Chip de zona (p.ej. "Bancal 1"): cabecera de grupo en Mi huerto.
export function ChipZona({ texto }) {
  return (
    <View style={estilos.chipZona}>
      <Text style={estilos.chipZonaTexto}>📍 {texto}</Text>
    </View>
  );
}

// Botón principal: degradado verde, sombra y pulsación animada.
// `degradado` permite otros colores (p.ej. gradientes.agua).
export function BotonPrimario({ titulo, onPress, cargando, disabled, style, testID, degradado, icono }) {
  const p = usarPulsacion();
  const inactivo = disabled || cargando;
  const { fuera, dentro } = dividirEstilo(style);
  return (
    <Animated.View style={[estilos.botonPrimarioSombra, inactivo && estilos.botonDeshabilitado, p.estilo, fuera]}>
      <Pressable
        testID={testID}
        onPress={onPress}
        disabled={inactivo}
        onPressIn={p.onPressIn}
        onPressOut={p.onPressOut}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!inactivo, busy: !!cargando }}
        style={estilos.botonPrimarioPress}
      >
        <LinearGradient colors={degradado || gradientes.primario} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[estilos.botonPrimario, dentro]}>
          {cargando ? (
            <ActivityIndicator color={colors.textOnDark} />
          ) : (
            <Text style={estilos.botonPrimarioTexto}>
              {icono ? `${icono}  ` : ''}
              {titulo}
            </Text>
          )}
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

// Separa las claves de "colocación" (van al contenedor animado) de las
// visuales (van al botón), para que `style` funcione como antes.
const CLAVES_COLOCACION = ['flex', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf', 'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginHorizontal', 'marginVertical', 'width', 'minWidth', 'maxWidth', 'position', 'top', 'bottom', 'left', 'right'];
function dividirEstilo(style) {
  const plano = StyleSheet.flatten(style) || {};
  const fuera = {};
  const dentro = {};
  Object.keys(plano).forEach((k) => {
    if (CLAVES_COLOCACION.includes(k)) fuera[k] = plano[k];
    else dentro[k] = plano[k];
  });
  return { fuera, dentro };
}

export function BotonSecundario({ titulo, onPress, style, testID, icono, disabled }) {
  const p = usarPulsacion();
  const { fuera, dentro } = dividirEstilo(style);
  return (
    <Animated.View style={[p.estilo, fuera]}>
      <Pressable
        testID={testID}
        onPress={onPress}
        disabled={disabled}
        onPressIn={p.onPressIn}
        onPressOut={p.onPressOut}
        accessibilityRole="button"
        style={[estilos.botonSecundario, disabled && estilos.botonDeshabilitado, dentro]}
      >
        <Text style={estilos.botonSecundarioTexto}>
          {icono ? `${icono}  ` : ''}
          {titulo}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

// Campo de texto con etiqueta y borde verde al enfocar.
export function CampoTexto({ etiqueta, style, onFocus, onBlur, ...propsInput }) {
  const [foco, setFoco] = useState(false);
  return (
    <View style={style}>
      {!!etiqueta && <Text style={estilos.campoEtiqueta}>{etiqueta}</Text>}
      <TextInput
        style={[estilos.campoInput, foco && estilos.campoInputFoco]}
        placeholderTextColor="#94A39A"
        onFocus={(e) => {
          setFoco(true);
          onFocus && onFocus(e);
        }}
        onBlur={(e) => {
          setFoco(false);
          onBlur && onBlur(e);
        }}
        {...propsInput}
      />
    </View>
  );
}

export function BarraProgreso({ fraccion, degradado }) {
  const porcentaje = Math.round(Math.min(1, Math.max(0, fraccion || 0)) * 100);
  const colores = degradado || (porcentaje >= 100 ? [colors.mintDark, colors.mintDark] : gradientes.primario);
  return (
    <View style={estilos.barraFondo}>
      {porcentaje > 0 && (
        <LinearGradient colors={colores} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[estilos.barraRelleno, { width: `${porcentaje}%` }]} />
      )}
    </View>
  );
}

// Botón "✕" circular para cerrar modales/formularios.
export function BotonX({ onPress, testID, accessibilityLabel, style }) {
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel || 'Cerrar'}
      accessibilityRole="button"
      style={[estilos.botonX, style]}
      activeOpacity={0.7}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text style={estilos.botonXTexto}>✕</Text>
    </TouchableOpacity>
  );
}

// Fila de chips seleccionables (zona, método de siembra, filtros…).
export function SelectorChips({ opciones, valor, onSeleccionar, testIDPrefix, style }) {
  return (
    <View style={[estilos.filaChipsSelector, style]}>
      {opciones.map((op) => {
        const activo = valor === op.clave;
        return (
          <TouchableOpacity
            key={op.clave}
            testID={testIDPrefix ? `${testIDPrefix}-${op.clave}` : undefined}
            style={[estilos.chipSelector, activo && estilos.chipSelectorActivo]}
            onPress={() => onSeleccionar(op.clave)}
            activeOpacity={0.7}
            accessibilityRole="radio"
            accessibilityState={{ selected: activo }}
          >
            <Text style={[estilos.chipSelectorTexto, activo && estilos.chipSelectorTextoActivo]}>{op.etiqueta}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ------------------------------------------------------------
// Componentes de cabecera y secciones
// ------------------------------------------------------------

// Cabecera "hero": degradado verde con círculos decorativos, título,
// subtítulo y fila opcional de estadísticas (children).
export function Hero({ saludo, titulo, subtitulo, children, style, degradado, decoracion = '🌿' }) {
  return (
    <LinearGradient colors={degradado || gradientes.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[estilos.hero, style]}>
      <View style={estilos.heroCirculoGrande} />
      <View style={estilos.heroCirculoPeque} />
      <Text style={estilos.heroDecoracion} accessible={false}>
        {decoracion}
      </Text>
      {!!saludo && <Text style={estilos.heroSaludo}>{saludo}</Text>}
      <Text style={estilos.heroTitulo}>{titulo}</Text>
      {!!subtitulo && <Text style={estilos.heroSubtitulo}>{subtitulo}</Text>}
      {children ? <View style={estilos.heroStats}>{children}</View> : null}
    </LinearGradient>
  );
}

// Mini tarjeta de estadística "de cristal" para el Hero.
export function StatHero({ icono, valor, etiqueta, onPress, testID }) {
  const Contenedor = onPress ? TouchableOpacity : View;
  return (
    <Contenedor testID={testID} onPress={onPress} activeOpacity={0.75} style={estilos.statHero}>
      <Text style={estilos.statHeroIcono}>{icono}</Text>
      <Text style={estilos.statHeroValor}>{valor}</Text>
      <Text style={estilos.statHeroEtiqueta} numberOfLines={1}>
        {etiqueta}
      </Text>
    </Contenedor>
  );
}

// Icono (emoji) dentro de un cuadrado redondeado de color suave.
export function IconoCaja({ icono, fondo, tamano = 36, style }) {
  return (
    <View style={[estilos.iconoCaja, { width: tamano, height: tamano, borderRadius: tamano * 0.32, backgroundColor: fondo || colors.accentSoftBg }, style]}>
      <Text style={{ fontSize: tamano * 0.5 }}>{icono}</Text>
    </View>
  );
}

// Título de sección con icono y acción opcional a la derecha.
export function TituloSeccion({ icono, titulo, accion, onAccion, style }) {
  return (
    <View style={[estilos.tituloSeccionFila, style]}>
      <View style={estilos.tituloSeccionIzq}>
        {!!icono && <IconoCaja icono={icono} tamano={32} />}
        <Text style={estilos.tituloSeccionTexto}>{titulo}</Text>
      </View>
      {!!accion && (
        <TouchableOpacity onPress={onAccion} accessibilityRole="button" style={estilos.tituloSeccionAccionCaja}>
          <Text style={estilos.tituloSeccionAccion}>{accion}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// Tarjeta de aviso: fondo suave + franja de color a la izquierda.
export function TarjetaAviso({ color, fondo, children, style, testID }) {
  return (
    <View testID={testID} style={[estilos.card, estilos.tarjetaAviso, { backgroundColor: fondo || colors.card }, style]}>
      <View style={[estilos.tarjetaAvisoFranja, { backgroundColor: color || colors.mint }]} />
      {children}
    </View>
  );
}

// Pastilla informativa con icono (riego, poda, origen…).
export function Pastilla({ icono, texto, color, fondo, style }) {
  return (
    <View style={[estilos.pastilla, { backgroundColor: fondo || colors.badgeNeutroBg }, style]}>
      {!!icono && <Text style={estilos.pastillaIcono}>{icono}</Text>}
      <Text style={[estilos.pastillaTexto, { color: color || colors.textSecondary }]}>{texto}</Text>
    </View>
  );
}

// Estado vacío ilustrado (icono grande en círculo + texto + acción).
export function EstadoVacio({ icono, titulo, texto, children, style }) {
  return (
    <View style={[estilos.vacio, style]}>
      <View style={estilos.vacioCirculo}>
        <Text style={estilos.vacioIcono}>{icono}</Text>
      </View>
      {!!titulo && <Text style={estilos.vacioTitulo}>{titulo}</Text>}
      {!!texto && <Text style={estilos.vacioTexto}>{texto}</Text>}
      {children}
    </View>
  );
}

// Fila de uso con barra (plan gratuito, progreso…).
export function BarraUso({ etiqueta, detalle, fraccion, nivel }) {
  const deg = nivel === 'agotado' ? ['#F87171', '#DC2626'] : nivel === 'cerca' ? gradientes.poda : gradientes.primario;
  return (
    <View style={estilos.barraUso}>
      <View style={estilos.barraUsoFila}>
        <Text style={estilos.barraUsoEtiqueta}>{etiqueta}</Text>
        <Text style={[estilos.barraUsoDetalle, nivel !== 'ok' && { color: nivel === 'agotado' ? colors.danger : colors.warning }]}>{detalle}</Text>
      </View>
      <BarraProgreso fraccion={Math.max(fraccion, fraccion > 0 ? 0.02 : 0)} degradado={deg} />
    </View>
  );
}

// ------------------------------------------------------------
// Aviso inferior con "Deshacer" (5 s). Deja libre la esquina
// inferior derecha (botón del Asistente).
// ------------------------------------------------------------
export function ToastDeshacer({ aviso, onDeshacer, onCerrar, duracionMs = 5000 }) {
  React.useEffect(() => {
    if (!aviso) return undefined;
    const t = setTimeout(() => onCerrar && onCerrar(), duracionMs);
    return () => clearTimeout(t);
  }, [aviso, onCerrar, duracionMs]);
  if (!aviso) return null;
  return (
    <View style={estilos.toast} testID="toast-deshacer" accessibilityLiveRegion="polite">
      <Text style={estilos.toastTexto} numberOfLines={2}>
        {aviso.texto}
      </Text>
      {!!onDeshacer && aviso.deshacible !== false && (
        <TouchableOpacity onPress={onDeshacer} accessibilityRole="button" style={estilos.toastBoton} testID="boton-deshacer">
          <Text style={estilos.toastBotonTexto}>Deshacer</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// Casilla redonda de "hecho" (área táctil de 44 px).
export function Casilla({ marcada, onPress, testID, accessibilityLabel, color }) {
  const tono = color || colors.mint;
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: !!marcada }}
      accessibilityLabel={accessibilityLabel}
      style={estilos.casillaArea}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
    >
      <View style={[estilos.casilla, { borderColor: tono }, marcada && { backgroundColor: tono }]}>
        {marcada ? <Text style={estilos.casillaCheck}>✓</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

const estilos = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...sombraTarjeta,
  },
  tarjetaAviso: { paddingLeft: spacing.md + 6, overflow: 'hidden' },
  tarjetaAvisoFranja: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5 },
  toast: {
    position: 'absolute',
    left: spacing.md,
    right: 88,
    bottom: spacing.md,
    backgroundColor: 'rgba(18,32,25,0.96)',
    borderRadius: radii.lg,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    ...sombraFuerte,
  },
  toastTexto: { flex: 1, color: colors.textOnDark, fontSize: 14, fontWeight: '600' },
  toastBoton: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: radii.pill, backgroundColor: 'rgba(142,227,174,0.15)' },
  toastBotonTexto: { color: '#8EE3AE', fontWeight: '800', fontSize: 14 },
  casillaArea: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  casilla: { width: 30, height: 30, borderRadius: 15, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
  casillaCheck: { color: colors.textOnDark, fontWeight: '900', fontSize: 16 },
  hero: {
    borderRadius: radii.xl,
    padding: spacing.lg,
    paddingBottom: spacing.md,
    overflow: 'hidden',
    ...sombraFuerte,
  },
  heroCirculoGrande: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    right: -70,
    top: -90,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  heroCirculoPeque: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    right: 40,
    bottom: -70,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  heroDecoracion: { position: 'absolute', right: 14, top: 10, fontSize: 64, opacity: 0.22 },
  heroSaludo: { color: colors.textOnDarkSoft, fontSize: 14, fontWeight: '700', letterSpacing: 0.2 },
  heroTitulo: { color: colors.textOnDark, fontSize: 30, fontWeight: '800', letterSpacing: -0.7, marginTop: 2 },
  heroSubtitulo: { color: colors.textOnDarkSoft, fontSize: 14, marginTop: 4, lineHeight: 20 },
  heroStats: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  statHero: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    borderRadius: radii.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
  },
  statHeroIcono: { fontSize: 18 },
  statHeroValor: { color: colors.textOnDark, fontSize: 22, fontWeight: '800', marginTop: 2 },
  statHeroEtiqueta: { color: colors.textOnDarkSoft, fontSize: 11, fontWeight: '700' },
  iconoCaja: { alignItems: 'center', justifyContent: 'center' },
  tituloSeccionFila: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    marginBottom: spacing.sm + 2,
  },
  tituloSeccionIzq: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  tituloSeccionTexto: { fontSize: 19, fontWeight: '800', color: colors.textPrimary, flexShrink: 1, letterSpacing: -0.3 },
  tituloSeccionAccionCaja: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: radii.pill, backgroundColor: colors.accentSoftBg },
  tituloSeccionAccion: { fontSize: 13, fontWeight: '800', color: colors.mintDark },
  pastilla: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 4,
    flexShrink: 1,
  },
  pastillaIcono: { fontSize: 13 },
  pastillaTexto: { fontSize: 13, fontWeight: '700', flexShrink: 1 },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
  },
  badgeTexto: { fontSize: 12, fontWeight: '800' },
  chipZona: {
    alignSelf: 'flex-start',
    backgroundColor: colors.accentSoftBg,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
    marginBottom: spacing.sm,
  },
  chipZonaTexto: { fontSize: 12, fontWeight: '800', color: colors.accentSoftText, letterSpacing: 0.3 },
  botonPrimarioSombra: {
    borderRadius: radii.md + 2,
    shadowColor: colors.mintDark,
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  botonPrimarioPress: { borderRadius: radii.md + 2, overflow: 'hidden' },
  botonPrimario: {
    minHeight: 52,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botonPrimarioTexto: { color: '#FFFFFF', fontWeight: '800', fontSize: 16, textAlign: 'center', letterSpacing: 0.1 },
  botonDeshabilitado: { opacity: 0.5 },
  botonSecundario: {
    backgroundColor: colors.accentSoftBg,
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botonSecundarioTexto: { color: colors.mintDark, fontWeight: '800', fontSize: 15, textAlign: 'center' },
  barraFondo: {
    height: 10,
    borderRadius: radii.pill,
    backgroundColor: '#E6EDE6',
    overflow: 'hidden',
  },
  barraRelleno: {
    height: '100%',
    borderRadius: radii.pill,
  },
  campoEtiqueta: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginBottom: 6 },
  campoInput: {
    backgroundColor: '#FAFCF9',
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.textPrimary,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  campoInputFoco: { borderColor: colors.mint, backgroundColor: '#FFFFFF' },
  botonX: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    backgroundColor: colors.badgeNeutroBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botonXTexto: { fontSize: 16, fontWeight: '800', color: colors.textSecondary },
  filaChipsSelector: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chipSelector: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  chipSelectorActivo: { backgroundColor: colors.mint, borderColor: colors.mint },
  chipSelectorTexto: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  chipSelectorTextoActivo: { color: '#FFFFFF' },
  vacio: { alignItems: 'center', paddingVertical: spacing.lg, paddingHorizontal: spacing.md },
  vacioCirculo: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.accentSoftBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  vacioIcono: { fontSize: 40 },
  vacioTitulo: { fontSize: 18, fontWeight: '800', color: colors.textPrimary, textAlign: 'center' },
  vacioTexto: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginTop: 6, lineHeight: 20 },
  barraUso: { marginTop: spacing.md },
  barraUsoFila: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6, gap: spacing.sm },
  barraUsoEtiqueta: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, flexShrink: 1 },
  barraUsoDetalle: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
});
