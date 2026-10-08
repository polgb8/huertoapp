// ============================================================
// screens/AuthScreen.js — Login real con Supabase Auth (email +
// contraseña). Cada cuenta tiene su propio huerto, aislado por RLS
// (ver migracion_v11_multiusuario.sql). La sesión se recuerda en el móvil.
// ============================================================

import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { colors, spacing, radii, gradientes, sombraTarjeta, sombraFuerte } from '../theme';
import { BotonPrimario, CampoTexto } from '../components/UI';
import { supabase } from '../supabase';

// Errores típicos de Supabase Auth: llegan como {message} en texto plano
// (inglés). Se traducen los más frecuentes; el resto cae en un mensaje
// genérico, igual que hace mensajeDeError() en utils.js para Gemini.
function mensajeDeErrorAuth(e) {
  const msg = (e?.message || '').toLowerCase();
  if (msg.includes('invalid login credentials')) {
    return 'Email o contraseña incorrectos. Revísalos e inténtalo de nuevo.';
  }
  if (msg.includes('user already registered') || msg.includes('already registered')) {
    return 'Ya existe una cuenta con ese email. Prueba a iniciar sesión en vez de crear una nueva.';
  }
  if (msg.includes('password') && (msg.includes('short') || msg.includes('at least') || msg.includes('weak'))) {
    return 'La contraseña es demasiado corta o débil. Usa al menos 6 caracteres.';
  }
  if (msg.includes('rate limit') || msg.includes('too many')) {
    return 'Demasiados intentos seguidos. Espera un minuto y vuelve a intentarlo.';
  }
  if (msg.includes('email') && msg.includes('confirm')) {
    return 'Confirma tu email antes de entrar: revisa tu bandeja de entrada.';
  }
  if (msg.includes('network') || msg.includes('fetch')) {
    return 'Sin conexión a internet. Comprueba tu red y vuelve a intentarlo.';
  }
  return 'No se ha podido completar la operación. Inténtalo de nuevo.';
}

export default function AuthScreen() {
  const [modo, setModo] = useState('entrar'); // 'entrar' | 'crear'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [cargando, setCargando] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [avisoRegistro, setAvisoRegistro] = useState(null);

  const enviar = useCallback(async () => {
    const emailLimpio = email.trim().toLowerCase();
    if (!emailLimpio || !password) {
      setErrorMsg('Rellena el email y la contraseña.');
      return;
    }
    setCargando(true);
    setErrorMsg(null);
    setAvisoRegistro(null);
    try {
      if (modo === 'entrar') {
        const { error } = await supabase.auth.signInWithPassword({ email: emailLimpio, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email: emailLimpio, password });
        if (error) throw error;
        // Si el proyecto de Supabase requiere confirmar el email, la
        // cuenta se crea pero todavía no hay sesión activa (data.session
        // llega null): se avisa en vez de dejar la pantalla como si no
        // hubiera pasado nada.
        if (data && !data.session) {
          setAvisoRegistro(
            'Cuenta creada. Si tu correo pide confirmación, revisa tu bandeja de entrada antes de entrar.'
          );
        }
      }
    } catch (e) {
      console.log('Error de autenticación:', e?.message);
      setErrorMsg(mensajeDeErrorAuth(e));
    } finally {
      setCargando(false);
    }
  }, [modo, email, password]);

  const cambiarModo = (m) => {
    setModo(m);
    setErrorMsg(null);
    setAvisoRegistro(null);
  };

  return (
    <KeyboardAvoidingView style={estilos.contenedor} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={estilos.contenido} keyboardShouldPersistTaps="handled">
        <LinearGradient colors={gradientes.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={estilos.cabecera}>
          <View style={estilos.circulo1} />
          <View style={estilos.circulo2} />
          <View style={estilos.logo}>
            <Text style={estilos.logoEmoji}>🌱</Text>
          </View>
          <Text style={estilos.marca}>HuertoApp</Text>
          <Text style={estilos.lema}>Riego, poda y diagnóstico con IA para tu huerto</Text>
        </LinearGradient>

        <View style={estilos.tarjeta}>
          <View style={estilos.segmentos}>
            {[
              ['entrar', 'Entrar'],
              ['crear', 'Crear cuenta'],
            ].map(([clave, texto]) => {
              const activo = modo === clave;
              return (
                <TouchableOpacity
                  key={clave}
                  onPress={() => cambiarModo(clave)}
                  style={[estilos.segmento, activo && estilos.segmentoActivo]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: activo }}
                >
                  <Text style={[estilos.segmentoTexto, activo && estilos.segmentoTextoActivo]}>{texto}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={estilos.explicacion}>
            {modo === 'entrar'
              ? 'Tu huerto se guarda en tu cuenta: lo tendrás en cualquier móvil donde entres.'
              : 'Crea tu cuenta gratis con tu email. Tu huerto será solo tuyo.'}
          </Text>

          <CampoTexto
            etiqueta="Email"
            placeholder="tu@email.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
            style={estilos.campo}
          />
          <CampoTexto
            etiqueta="Contraseña"
            placeholder={modo === 'crear' ? 'Mínimo 6 caracteres' : '••••••••'}
            secureTextEntry
            autoCapitalize="none"
            autoComplete={modo === 'crear' ? 'new-password' : 'password'}
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={enviar}
            style={estilos.campo}
          />

          {!!errorMsg && <Text style={estilos.error}>{errorMsg}</Text>}
          {!!avisoRegistro && <Text style={estilos.aviso}>{avisoRegistro}</Text>}

          <BotonPrimario
            titulo={modo === 'entrar' ? 'Entrar' : 'Crear cuenta'}
            onPress={enviar}
            cargando={cargando}
            style={estilos.botonEnviar}
          />
        </View>
        <Text style={estilos.pie}>🔒 Tus datos están protegidos: nadie más puede ver tu huerto.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const estilos = StyleSheet.create({
  contenedor: { flex: 1, backgroundColor: colors.background },
  contenido: { flexGrow: 1, paddingBottom: spacing.xl },
  cabecera: {
    paddingTop: 72,
    paddingBottom: 72,
    alignItems: 'center',
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
    overflow: 'hidden',
  },
  circulo1: { position: 'absolute', width: 260, height: 260, borderRadius: 130, top: -120, right: -80, backgroundColor: 'rgba(255,255,255,0.07)' },
  circulo2: { position: 'absolute', width: 160, height: 160, borderRadius: 80, bottom: -60, left: -40, backgroundColor: 'rgba(255,255,255,0.06)' },
  logo: {
    width: 84,
    height: 84,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoEmoji: { fontSize: 44 },
  marca: { color: colors.textOnDark, fontSize: 32, fontWeight: '800', marginTop: spacing.md, letterSpacing: -0.6 },
  lema: { color: colors.textOnDarkSoft, fontSize: 14, marginTop: 4, textAlign: 'center', paddingHorizontal: spacing.lg },
  tarjeta: {
    marginTop: -44,
    marginHorizontal: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    padding: spacing.lg,
    ...sombraFuerte,
  },
  segmentos: { flexDirection: 'row', backgroundColor: colors.badgeNeutroBg, borderRadius: radii.pill, padding: 4 },
  segmento: { flex: 1, paddingVertical: 10, borderRadius: radii.pill, alignItems: 'center' },
  segmentoActivo: { backgroundColor: colors.card, ...sombraTarjeta },
  segmentoTexto: { fontSize: 15, fontWeight: '700', color: colors.textSecondary },
  segmentoTextoActivo: { color: colors.mintDark, fontWeight: '800' },
  explicacion: { fontSize: 14, color: colors.textSecondary, marginTop: spacing.md, lineHeight: 20 },
  campo: { marginTop: spacing.md },
  error: { fontSize: 14, color: colors.danger, marginTop: spacing.md, fontWeight: '600' },
  aviso: { fontSize: 14, color: colors.warning, marginTop: spacing.md, fontWeight: '600' },
  botonEnviar: { marginTop: spacing.lg },
  pie: { textAlign: 'center', fontSize: 12, color: colors.textSecondary, marginTop: spacing.lg, paddingHorizontal: spacing.lg },
});
