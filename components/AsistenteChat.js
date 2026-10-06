// ============================================================
// components/AsistenteChat.js — Chat del Asistente del huerto (se abre
// desde el botón flotante 🤖 en cualquier pantalla, ver BotonAsistente).
//
// Buenas prácticas de chatbot aplicadas (Cloudflare, "¿Qué es un bot
// conversacional?" y "Chat agents"): historial persistente entre
// sesiones y dispositivos, contexto del usuario en cada turno,
// sugerencias para empezar, indicador de "escribiendo", reintento ante
// errores, reinicio de conversación y entrada multimodal (foto).
// ============================================================

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Image } from 'expo-image';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';

import { colors, radii, spacing } from '../theme';
import TextoFormateado from './TextoFormateado';
import { llamarGeminiChat } from '../gemini';
import { listarCultivosHuerto, listarMensajesAsistente, insertarMensajeAsistente, borrarMensajesAsistente } from '../supabase';
import { aplicarMarcasLocales } from '../registroLocal';
import { construirContextoAsistente } from '../contextoAsistente';
import { mensajeDeError } from '../utils';
import { useAppStore } from '../store';

const BIENVENIDA = {
  id: 'bienvenida',
  rol: 'model',
  texto:
    '¡Hola! Soy tu **asistente del huerto** 🌱. Conozco tus plantas y el tiempo de tu zona.\n' +
    'Pregúntame lo que quieras de agricultura: riego, plagas, poda, abonado, qué sembrar… ' +
    'También puedes mandarme una **foto** 📷.',
};

export const SUGERENCIAS = [
  '¿Qué tengo que hacer hoy en el huerto?',
  '¿Qué puedo sembrar este mes?',
  'Tengo pulgón, ¿qué hago sin químicos?',
  '¿Cómo hago compost en casa?',
  '¿Cómo mejoro un suelo arcilloso?',
  'Plan de abonado para mis frutales',
];

let contador = 0;
const nuevoId = () => `m-${Date.now()}-${(contador += 1)}`;

export default function AsistenteChat({ onCerrar, pantalla }) {
  const [mensajes, setMensajes] = useState([BIENVENIDA]);
  const [texto, setTexto] = useState('');
  const [foto, setFoto] = useState(null); // { uri, base64 }
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const [ultimoFallido, setUltimoFallido] = useState(null);
  const listaRef = useRef(null);
  const interactuadoRef = useRef(false);
  const cultivosRef = useRef([]);
  const montado = useRef(true);

  const conectado = useAppStore((s) => s.conectado) !== false;
  const zona = useAppStore((s) => s.zonaClimatica);
  const suelo = useAppStore((s) => s.sueloHuerto);
  const clima = useAppStore((s) => s.clima);
  const coords = useAppStore((s) => s.coords);

  useEffect(() => {
    montado.current = true;
    listarCultivosHuerto()
      .then(aplicarMarcasLocales)
      .then((c) => {
        cultivosRef.current = c || [];
      })
      .catch(() => {});
    listarMensajesAsistente()
      .then((h) => {
        if (!montado.current || interactuadoRef.current || !Array.isArray(h) || h.length === 0) return;
        setMensajes([BIENVENIDA, ...h.map((m) => ({ id: m.id, rol: m.rol, texto: m.texto }))]);
      })
      .catch(() => {});
    return () => {
      montado.current = false;
    };
  }, []);

  const enviar = useCallback(
    // opciones: { textoDirecto, fotoDirecta, reintento }
    async (opciones = {}) => {
      const { textoDirecto, fotoDirecta, reintento = false } = opciones;
      const contenido = (textoDirecto ?? texto).trim();
      const adjunto = fotoDirecta !== undefined ? fotoDirecta : foto;
      if ((!contenido && !adjunto) || enviando) return;
      interactuadoRef.current = true;
      if (!conectado) {
        setError('Sin conexión ahora mismo. Conéctate y vuelve a intentarlo.');
        return;
      }
      const pregunta = contenido || '¿Qué ves en esta foto? ¿Está sana y qué debería hacer?';
      let historial = mensajes.filter((m) => m.id !== 'bienvenida').map((m) => ({ rol: m.rol, texto: m.texto }));
      // Reintento: la pregunta ya está en pantalla; no se duplica el turno.
      if (reintento && historial.length && historial[historial.length - 1].rol === 'user') historial = historial.slice(0, -1);
      if (!reintento) {
        setMensajes((prev) => [...prev, { id: nuevoId(), rol: 'user', texto: pregunta, fotoUri: adjunto?.uri }]);
        insertarMensajeAsistente({ rol: 'user', texto: adjunto ? `📷 ${pregunta}` : pregunta });
      }
      setTexto('');
      setFoto(null);
      setError(null);
      setUltimoFallido(null);
      setEnviando(true);
      try {
        const respuesta = await llamarGeminiChat({
          historial,
          mensajeNuevo: pregunta,
          imagenBase64: adjunto?.base64 || null,
          contextoSistema: construirContextoAsistente({ cultivos: cultivosRef.current, zona, suelo, clima, coords, pantalla }),
          maxOutputTokens: 900,
        });
        if (!montado.current) return;
        setMensajes((prev) => [...prev, { id: nuevoId(), rol: 'model', texto: respuesta || 'No he podido responder. ¿Me lo repites?' }]);
        insertarMensajeAsistente({ rol: 'model', texto: respuesta });
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      } catch (e) {
        if (!montado.current) return;
        setError(mensajeDeError(e));
        setUltimoFallido({ texto: pregunta, foto: adjunto });
      } finally {
        if (montado.current) setEnviando(false);
      }
    },
    [texto, foto, enviando, conectado, mensajes, zona, suelo, clima, coords, pantalla]
  );

  const reintentar = useCallback(() => {
    if (ultimoFallido) enviar({ textoDirecto: ultimoFallido.texto, fotoDirecta: ultimoFallido.foto || null, reintento: true });
  }, [ultimoFallido, enviar]);

  const adjuntarFoto = useCallback(() => {
    const elegir = async (fuente) => {
      try {
        if (fuente === 'camara') {
          const p = await ImagePicker.requestCameraPermissionsAsync();
          if (!p?.granted) return;
        }
        const opciones = { mediaTypes: ['images'], quality: 0.6 };
        const r = fuente === 'camara' ? await ImagePicker.launchCameraAsync(opciones) : await ImagePicker.launchImageLibraryAsync(opciones);
        if (r.canceled || !r.assets?.[0]?.uri) return;
        const m = await ImageManipulator.manipulateAsync(r.assets[0].uri, [{ resize: { width: 800 } }], {
          compress: 0.6,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: true,
        });
        if (montado.current) setFoto({ uri: m.uri, base64: m.base64 });
      } catch (e) {
        console.log('No se pudo adjuntar la foto (no bloqueante):', e?.message);
      }
    };
    Alert.alert('Adjuntar foto', '¿De dónde?', [
      { text: 'Cámara', onPress: () => elegir('camara') },
      { text: 'Galería', onPress: () => elegir('galeria') },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  }, []);

  const nuevoChat = useCallback(() => {
    Alert.alert('Nueva conversación', 'Se borrará el historial del chat de tu cuenta (en todos tus móviles).', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar',
        style: 'destructive',
        onPress: () => {
          setMensajes([BIENVENIDA]);
          setError(null);
          setUltimoFallido(null);
          borrarMensajesAsistente();
        },
      },
    ]);
  }, []);

  const soloBienvenida = mensajes.length === 1;

  return (
    <KeyboardAvoidingView style={estilos.contenedor} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={estilos.cabecera}>
        <View style={estilos.avatar}>
          <MaterialCommunityIcons name="robot-happy-outline" size={24} color={colors.textOnDark} />
        </View>
        <View style={estilos.cabeceraTextos}>
          <Text style={estilos.titulo}>Asistente del huerto</Text>
          <Text style={estilos.subtitulo}>{conectado ? 'Experto en agricultura · en línea' : 'Sin conexión'}</Text>
        </View>
        <TouchableOpacity testID="boton-nuevo-chat" onPress={nuevoChat} style={estilos.botonCab} accessibilityLabel="Nueva conversación">
          <Ionicons name="refresh" size={20} color={colors.textOnDark} />
        </TouchableOpacity>
        <TouchableOpacity testID="boton-cerrar-asistente" onPress={onCerrar} style={estilos.botonCab} accessibilityLabel="Cerrar asistente">
          <Ionicons name="close" size={24} color={colors.textOnDark} />
        </TouchableOpacity>
      </View>

      <FlatList
        ref={listaRef}
        style={estilos.lista}
        contentContainerStyle={estilos.contenidoLista}
        data={mensajes}
        keyExtractor={(m) => m.id}
        onContentSizeChange={() => listaRef.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <View style={[estilos.burbuja, item.rol === 'user' ? estilos.burbujaUsuario : estilos.burbujaBot]}>
            {!!item.fotoUri && <Image source={{ uri: item.fotoUri }} style={estilos.fotoBurbuja} contentFit="cover" />}
            {item.rol === 'user' ? (
              <Text style={estilos.textoUsuario}>{item.texto}</Text>
            ) : (
              <TextoFormateado texto={item.texto} estilo={estilos.textoBot} />
            )}
          </View>
        )}
        ListFooterComponent={
          <>
            {enviando && (
              <View style={estilos.escribiendo} testID="asistente-escribiendo">
                <ActivityIndicator size="small" color={colors.mint} />
                <Text style={estilos.escribiendoTexto}>Pensando la respuesta…</Text>
              </View>
            )}
            {!!error && (
              <View style={estilos.cajaError}>
                <Text style={estilos.textoError}>{error}</Text>
                {!!ultimoFallido && (
                  <TouchableOpacity onPress={reintentar} testID="boton-reintentar-chat">
                    <Text style={estilos.reintentar}>↻ Reintentar</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </>
        }
      />

      {soloBienvenida && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={estilos.sugerencias} contentContainerStyle={estilos.sugerenciasContenido} keyboardShouldPersistTaps="handled">
          {SUGERENCIAS.map((s, i) => (
            <TouchableOpacity key={s} testID={`sugerencia-${i}`} style={estilos.chip} onPress={() => enviar({ textoDirecto: s, fotoDirecta: null })}>
              <Text style={estilos.chipTexto}>{s}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {!!foto && (
        <View style={estilos.previa}>
          <Image source={{ uri: foto.uri }} style={estilos.previaImg} contentFit="cover" />
          <Text style={estilos.previaTexto}>Foto adjunta</Text>
          <TouchableOpacity onPress={() => setFoto(null)} accessibilityLabel="Quitar foto">
            <Ionicons name="close-circle" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      )}

      <View style={estilos.filaInput}>
        <TouchableOpacity testID="boton-foto-chat" onPress={adjuntarFoto} style={estilos.botonIcono} accessibilityLabel="Adjuntar foto">
          <Ionicons name="camera-outline" size={24} color={colors.mintDark} />
        </TouchableOpacity>
        <TextInput
          testID="campo-chat"
          style={estilos.input}
          placeholder="Escribe tu pregunta…"
          placeholderTextColor={colors.textSecondary}
          value={texto}
          onChangeText={setTexto}
          multiline
        />
        <TouchableOpacity
          testID="boton-enviar-chat"
          onPress={() => enviar()}
          disabled={enviando || (!texto.trim() && !foto)}
          style={[estilos.botonEnviar, (enviando || (!texto.trim() && !foto)) && estilos.deshabilitado]}
          accessibilityLabel="Enviar"
        >
          <Ionicons name="send" size={20} color={colors.textOnDark} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const estilos = StyleSheet.create({
  contenedor: { flex: 1, backgroundColor: colors.background },
  cabecera: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.headerDeep,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    paddingTop: Platform.OS === 'android' ? spacing.lg : spacing.sm,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' },
  cabeceraTextos: { flex: 1 },
  titulo: { color: colors.textOnDark, fontSize: 17, fontWeight: '800' },
  subtitulo: { color: colors.textOnDarkSoft, fontSize: 12 },
  botonCab: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  lista: { flex: 1 },
  contenidoLista: { padding: spacing.md, paddingBottom: spacing.lg },
  burbuja: { maxWidth: '88%', borderRadius: radii.lg, padding: 12, marginBottom: spacing.sm },
  burbujaUsuario: { alignSelf: 'flex-end', backgroundColor: colors.mint, borderBottomRightRadius: 4 },
  burbujaBot: { alignSelf: 'flex-start', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 4 },
  textoUsuario: { color: colors.textOnDark, fontSize: 15, lineHeight: 21 },
  textoBot: { color: colors.textPrimary, fontSize: 15, lineHeight: 21 },
  fotoBurbuja: { width: 180, height: 180, borderRadius: radii.md, marginBottom: 6 },
  escribiendo: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  escribiendoTexto: { fontSize: 13, color: colors.textSecondary },
  cajaError: { backgroundColor: colors.badgeEnfermaBg, borderRadius: radii.md, padding: spacing.sm, marginTop: spacing.xs },
  textoError: { color: colors.badgeEnfermaText, fontSize: 13 },
  reintentar: { color: colors.mintDark, fontWeight: '800', marginTop: 6 },
  sugerencias: { maxHeight: 52, flexGrow: 0 },
  sugerenciasContenido: { paddingHorizontal: spacing.md, gap: spacing.xs, alignItems: 'center' },
  chip: { backgroundColor: colors.accentSoftBg, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: colors.border },
  chipTexto: { color: colors.accentSoftText, fontWeight: '700', fontSize: 13 },
  previa: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.xs },
  previaImg: { width: 40, height: 40, borderRadius: radii.sm },
  previaTexto: { flex: 1, fontSize: 13, color: colors.textSecondary },
  filaInput: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.xs,
    padding: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
  botonIcono: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  input: {
    flex: 1,
    maxHeight: 110,
    minHeight: 44,
    backgroundColor: colors.badgeNeutroBg,
    borderRadius: 22,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.textPrimary,
  },
  botonEnviar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' },
  deshabilitado: { opacity: 0.45 },
});
