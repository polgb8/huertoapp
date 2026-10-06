// ============================================================
// components/DetallePlanta.js — Ficha visual completa de una especie
// del catálogo (emoji, cuidados, siembra, plagas, companionismo...).
// Compartida por Buscar (solo consulta) y Planificador (consulta +
// botón "+ Agregar a mi huerto", vía la prop opcional `onAgregar`).
//
// Rediseño pedido por Pol tras probarla ("todo el texto igual, no es
// atractivo, mejor una X arriba"): antes era una lista de texto plano
// sobre fondo blanco; ahora hay una cabecera oscura con el emoji/nombre
// (mismo lenguaje visual que la tarjeta de mes de Planificador), cada
// sección vive en su propia tarjeta con icono, y el cierre es una X
// flotante arriba a la derecha en vez de un botón "Cerrar" al final.
// ============================================================

import React from 'react';
import { View, Text, StyleSheet, Modal, ScrollView } from 'react-native';

import { colors, spacing, radii, tipografia, sombraTarjeta } from '../theme';
import { Card, BotonPrimario, BotonX } from './UI';
import { quitarEtiquetasHTML } from '../utils';
import { buscarInfoPoda, describirMesesPoda } from '../poda';

export default function DetallePlanta({ planta, onCerrar, onAgregar, agregando, agregado }) {
  if (!planta) return null;
  // Calendario real de poda (poda.js): el campo `poda` del catálogo no son
  // días reales (Lavanda = 6), así que ya no se muestra tal cual.
  const infoPoda = buscarInfoPoda(planta.nombre);
  const tieneCuidados = !!(planta.luz || planta.metodoRiego || planta.fertilizante || infoPoda);
  const companion = planta.companionismo;
  const tieneCompanionismo = !!(companion && ((companion.bien && companion.bien.length) || (companion.mal && companion.mal.length)));

  return (
    <Modal visible animationType="slide" onRequestClose={onCerrar}>
      <View style={estilos.pantalla}>
        <View style={estilos.cabecera}>
          <BotonX
            testID="boton-cerrar-detalle-x"
            onPress={onCerrar}
            accessibilityLabel="Cerrar ficha de la planta"
            style={estilos.botonXFlotante}
          />
          <Text style={estilos.emojiGrande}>{planta.emoji || '🌿'}</Text>
          <Text style={estilos.nombreGrande}>{planta.nombre}</Text>
          {!!planta.nombreCientifico && <Text style={estilos.nombreCientifico}>{planta.nombreCientifico}</Text>}
        </View>

        <ScrollView style={estilos.contenedor} contentContainerStyle={estilos.contenido}>
          {!!planta.nivelLuz && (
            <View style={estilos.calloutLuz}>
              <Text style={estilos.calloutLuzTexto}>💡 Esta planta necesita: {planta.luz || planta.nivelLuz}</Text>
            </View>
          )}

          {!!planta.dondePlantarla && (
            <Card style={estilos.seccion}>
              <Text style={estilos.tituloSeccion}>🌍 Dónde plantarla</Text>
              <Text style={estilos.textoSeccion}>{planta.dondePlantarla}</Text>
            </Card>
          )}

          {tieneCuidados && (
            <Card style={estilos.seccion}>
              <Text style={estilos.tituloSeccion}>🩺 Cuidados</Text>
              {!!planta.metodoRiego && <Text style={estilos.textoSeccion}>{quitarEtiquetasHTML(planta.metodoRiego)}</Text>}
              {!!planta.fertilizante && <Text style={estilos.textoSeccion}>{quitarEtiquetasHTML(planta.fertilizante)}</Text>}
              {!!infoPoda && (
                <Text style={estilos.textoSeccion}>
                  ✂️ Poda: {describirMesesPoda(infoPoda.meses)} — {infoPoda.tipo.toLowerCase()}. {infoPoda.consejo}
                </Text>
              )}
            </Card>
          )}

          {!!planta.caracteristicas && (
            <Card style={estilos.seccion}>
              <Text style={estilos.tituloSeccion}>🔎 Características</Text>
              <Text style={estilos.textoSeccion}>{planta.caracteristicas}</Text>
            </Card>
          )}

          {!!planta.plagas && (
            <Card style={[estilos.seccion, estilos.seccionAlerta]}>
              <Text style={estilos.tituloSeccion}>🐛 Plagas habituales</Text>
              <Text style={estilos.textoSeccion}>{planta.plagas}</Text>
            </Card>
          )}

          {!!planta.siembra && (
            <Card style={estilos.seccion}>
              <Text style={estilos.tituloSeccion}>🌾 Siembra</Text>
              {!!planta.siembra.distanciaCm && (
                <Text style={estilos.textoSeccion}>Distancia entre plantas: ~{planta.siembra.distanciaCm} cm</Text>
              )}
              {!!planta.siembra.profundidadCm && (
                <Text style={estilos.textoSeccion}>Profundidad: ~{planta.siembra.profundidadCm} cm</Text>
              )}
              {!!planta.siembra.semillas && <Text style={estilos.textoSeccion}>{planta.siembra.semillas}</Text>}
            </Card>
          )}

          {!!planta.senalCosecha && (
            <Card style={[estilos.seccion, estilos.seccionExito]}>
              <Text style={estilos.tituloSeccion}>✅ Señal de que está lista para cosechar</Text>
              <Text style={estilos.textoSeccion}>{planta.senalCosecha}</Text>
            </Card>
          )}

          {tieneCompanionismo && (
            <Card style={estilos.seccion}>
              <Text style={estilos.tituloSeccion}>🤝 Companionismo</Text>
              {!!(companion.bien && companion.bien.length) && (
                <Text style={estilos.textoSeccion}>Le sienta bien junto a: {companion.bien.join(', ')}</Text>
              )}
              {!!(companion.mal && companion.mal.length) && (
                <Text style={estilos.textoSeccion}>Evita plantarla junto a: {companion.mal.join(', ')}</Text>
              )}
            </Card>
          )}

          {!!onAgregar && (
            <BotonPrimario
              testID="boton-agregar-detalle"
              titulo={agregado ? 'Añadido a tu huerto ✓' : agregando ? 'Añadiendo…' : '+ Agregar a mi huerto'}
              onPress={onAgregar}
              cargando={!!agregando}
              disabled={!!agregado}
              style={estilos.botonAgregar}
            />
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colors.background },
  cabecera: {
    backgroundColor: colors.headerDeep,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    borderBottomLeftRadius: radii.lg,
    borderBottomRightRadius: radii.lg,
  },
  botonXFlotante: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.lg,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  emojiGrande: { fontSize: 52, marginBottom: spacing.xs },
  nombreGrande: { fontSize: 22, fontWeight: '800', color: colors.textOnDark, textAlign: 'center' },
  nombreCientifico: { fontSize: 14, fontStyle: 'italic', color: colors.textOnDark, opacity: 0.8, marginTop: 2 },
  contenedor: { flex: 1 },
  contenido: { padding: spacing.lg, paddingBottom: spacing.xl },
  calloutLuz: {
    backgroundColor: colors.badgeSembradoBg,
    borderRadius: radii.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  calloutLuzTexto: { fontSize: 13, color: colors.badgeSembradoText, fontWeight: '600' },
  seccion: { marginBottom: spacing.md },
  seccionAlerta: { borderColor: colors.badgeEnfermaBg, borderWidth: 1 },
  seccionExito: { borderColor: colors.mint, borderWidth: 1 },
  tituloSeccion: { fontSize: 12, fontWeight: '700', color: colors.mintDark, textTransform: 'uppercase', marginBottom: spacing.xs, letterSpacing: 0.3 },
  textoSeccion: { fontSize: 14, color: colors.textPrimary, marginTop: 2, lineHeight: 20 },
  botonAgregar: { marginTop: spacing.sm },
});
