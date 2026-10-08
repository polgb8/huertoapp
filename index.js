import React from 'react';
import { View, Text, ScrollView, StatusBar } from 'react-native';
import { registerRootComponent } from 'expo';

// ============================================================
// index.js — Punto de entrada real de la app (registrado en
// package.json como "main"). Antes solo hacía
// registerRootComponent(App) directo.
//
// RED DE SEGURIDAD: si algo revienta al CARGAR ./App.js (error en
// tiempo de importación — como pasaba antes con createClient() en
// supabase.js cuando faltaban las variables de entorno) o durante el
// PRIMER RENDER (vía Error Boundary de React), Android mostraba el
// diálogo genérico "la app se ha cerrado / borrar caché" — que no dice
// NADA sobre la causa real, y en un build de producción (Hermes, sin
// herramientas de desarrollo) no hay otra forma de ver el error sin
// conectar el móvil a un ordenador con adb/logcat.
//
// Con esto, cualquier error de ese tipo se muestra en pantalla con su
// mensaje y traza completos, en vez de cerrar la app a ciegas. Se deja
// como red de seguridad PERMANENTE, no solo para depurar el problema
// actual: cualquier fallo de arranque futuro será visible directamente
// en el móvil, sin depender de nada externo.
// ============================================================

function PantallaError({ titulo, error }) {
  const mensaje = (error && (error.stack || error.message || String(error))) || 'Error desconocido (sin mensaje).';
  return (
    <View style={{ flex: 1, backgroundColor: '#1a1a1a', paddingTop: 48 }}>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a1a" />
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Text style={{ color: '#ff6b6b', fontSize: 18, fontWeight: '800', marginBottom: 4 }}>
          🌱 HuertoApp
        </Text>
        <Text style={{ color: '#ff6b6b', fontSize: 15, fontWeight: '700', marginBottom: 16 }}>
          {titulo}
        </Text>
        <Text style={{ color: '#eee', fontSize: 13, lineHeight: 19 }} selectable>
          {mensaje}
        </Text>
      </ScrollView>
    </View>
  );
}

class LimiteDeErrores extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // No bloqueante: solo se deja constancia en consola además de
    // mostrarlo en pantalla via el estado.
    console.log('LimiteDeErrores capturo un error de render:', error?.message, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return <PantallaError titulo="Error al renderizar la app" error={this.state.error} />;
    }
    return this.props.children;
  }
}

// La importacion de ./App se hace con require() dentro de un try/catch
// (en vez de un `import` estatico arriba del archivo) precisamente para
// poder atrapar un error que ocurra al CARGAR ese modulo — un `import`
// estatico se evalua antes de que cualquier try/catch del propio
// archivo pueda envolverlo.
let AppComponent = null;
let errorDeImportacion = null;
try {
  AppComponent = require('./App').default;
} catch (e) {
  errorDeImportacion = e;
}

function Raiz() {
  if (errorDeImportacion) {
    return <PantallaError titulo="Error al iniciar la app" error={errorDeImportacion} />;
  }
  return (
    <LimiteDeErrores>
      <AppComponent />
    </LimiteDeErrores>
  );
}

// registerRootComponent llama a AppRegistry.registerComponent('main', () => Raiz).
// Tambien asegura que, tanto en Expo Go como en un build nativo, el
// entorno quede configurado correctamente.
registerRootComponent(Raiz);
