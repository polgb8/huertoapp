// ============================================================
// components/BotonAsistente.js — Botón flotante redondo con un robot,
// abajo a la derecha, en todas las pantallas. Abre el chat del
// Asistente a pantalla completa.
//
// Para no tapar nada: queda justo encima de la barra de pestañas; se
// oculta con el teclado abierto; las listas de la app dejan un hueco
// inferior de ≥110 px y los avisos inferiores reservan su esquina.
// ============================================================

import React, { useState, useEffect } from 'react';
import { View, TouchableOpacity, StyleSheet, Modal, Keyboard, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { colors } from '../theme';
import AsistenteChat from './AsistenteChat';

export const ALTO_BARRA_PESTANAS = 53; // 49 por defecto + 4 de paddingTop (App.js)
export const TAMANO_BOTON = 56;

export default function BotonAsistente({ pantalla }) {
  const insets = useSafeAreaInsets();
  const [abierto, setAbierto] = useState(false);
  const [teclado, setTeclado] = useState(false);

  useEffect(() => {
    const a = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setTeclado(true));
    const b = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setTeclado(false));
    return () => {
      a?.remove?.();
      b?.remove?.();
    };
  }, []);

  return (
    <>
      {!teclado && !abierto && (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          <TouchableOpacity
            testID="boton-asistente"
            accessibilityRole="button"
            accessibilityLabel="Abrir el asistente del huerto"
            activeOpacity={0.85}
            onPress={() => setAbierto(true)}
            style={[estilos.boton, { bottom: insets.bottom + ALTO_BARRA_PESTANAS + 12 }]}
          >
            <MaterialCommunityIcons name="robot-happy-outline" size={30} color={colors.textOnDark} />
          </TouchableOpacity>
        </View>
      )}
      <Modal visible={abierto} animationType="slide" onRequestClose={() => setAbierto(false)}>
        <View style={[estilos.modal, { paddingTop: Platform.OS === 'ios' ? insets.top : 0, paddingBottom: insets.bottom }]}>
          {abierto && <AsistenteChat onCerrar={() => setAbierto(false)} pantalla={pantalla} />}
        </View>
      </Modal>
    </>
  );
}

const estilos = StyleSheet.create({
  boton: {
    position: 'absolute',
    right: 16,
    width: TAMANO_BOTON,
    height: TAMANO_BOTON,
    borderRadius: TAMANO_BOTON / 2,
    backgroundColor: colors.headerDeep,
    borderWidth: 2,
    borderColor: colors.mint,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  modal: { flex: 1, backgroundColor: colors.headerDeep },
});
