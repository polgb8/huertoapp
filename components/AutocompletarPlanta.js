// ============================================================
// components/AutocompletarPlanta.js — Campo de texto con autocompletado
// inline: al escribir, aparece un desplegable con las plantas del
// catálogo que coinciden, superpuesto justo debajo del campo (no
// empuja el resto del formulario hacia abajo). Tocar una sugerencia
// rellena el campo y avisa al padre con la planta completa.
//
// Genérico y reutilizable: recibe la lista de plantas y el callback de
// selección desde fuera (hoy lo usa GardenScreen con CATALOGO_PLANTAS,
// pero no depende de esa forma de datos más allá de `nombre`).
// ============================================================

import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { CampoTexto } from './UI';
import { colors, radii, spacing, sombraTarjeta } from '../theme';
import { normalizarBusqueda } from '../utils';

const MAX_SUGERENCIAS_VISIBLES = 6;

export default function AutocompletarPlanta({
  etiqueta,
  placeholder,
  valor,
  onCambiarTexto,
  plantas,
  onSeleccionar,
  style,
  testID,
}) {
  const [enfocado, setEnfocado] = useState(false);
  // Altura real del campo (etiqueta + input), medida con onLayout: se usa
  // para colocar el desplegable justo debajo, sin depender de porcentajes
  // (una altura en '%' no se resuelve de forma fiable sobre un contenedor
  // de altura automática en React Native).
  const [alturaCampo, setAlturaCampo] = useState(0);

  const sugerencias = useMemo(() => {
    const texto = normalizarBusqueda(valor);
    if (!texto) return [];
    return (plantas || [])
      .filter((p) => normalizarBusqueda(p.nombre).includes(texto))
      .slice(0, MAX_SUGERENCIAS_VISIBLES);
  }, [valor, plantas]);

  const mostrarDesplegable = enfocado && !!valor.trim() && sugerencias.length > 0;

  return (
    <View
      style={[estilos.contenedor, style]}
      onLayout={(e) => setAlturaCampo(e.nativeEvent.layout.height)}
    >
      <CampoTexto
        testID={testID}
        etiqueta={etiqueta}
        placeholder={placeholder}
        value={valor}
        onChangeText={onCambiarTexto}
        onFocus={() => setEnfocado(true)}
        // Retraso corto para que el toque en una sugerencia se registre
        // antes de que el blur la oculte (si no, el desplegable
        // desaparece justo antes de procesar el tap).
        onBlur={() => setTimeout(() => setEnfocado(false), 150)}
        autoCorrect={false}
      />

      {mostrarDesplegable && (
        <View style={[estilos.desplegable, { top: alturaCampo + 2 }]}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            style={estilos.scroll}
          >
            {sugerencias.map((planta) => (
              <TouchableOpacity
                key={planta.nombre}
                style={estilos.fila}
                onPress={() => {
                  onSeleccionar(planta);
                  setEnfocado(false);
                }}
              >
                <Text style={estilos.filaTexto}>{planta.nombre}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const estilos = StyleSheet.create({
  contenedor: { position: 'relative', zIndex: 30 },
  desplegable: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: 190,
    zIndex: 40,
    elevation: 6,
    ...sombraTarjeta,
  },
  scroll: { maxHeight: 190 },
  fila: {
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filaTexto: { fontSize: 14, color: colors.textPrimary },
});
