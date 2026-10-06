// ============================================================
// App.js — Contenedor de navegación (Bottom Tabs) de HuertoApp.
// La lógica de cada módulo vive en screens/*.js; este archivo solo
// monta la navegación y el theming de la barra inferior.
//
// Login (v11): Supabase Auth con email y contraseña. Cada usuario ve solo
// su huerto (RLS por user_id, ver migracion_v11_multiusuario.sql). Sin
// sesión se muestra AuthScreen; la sesión se recuerda en el móvil.
// ============================================================

import 'react-native-url-polyfill/auto';
import React, { useEffect, useState } from 'react';
import { StatusBar, View, Text, AppState } from 'react-native';
import { NavigationContainer, DefaultTheme, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';

import { colors } from './theme';
import { useAppStore } from './store';
import { SUPABASE_CONFIGURADO, supabase } from './supabase';
import { obtenerUbicacionAutomatica } from './ubicacion';
import { leerZonaClimatica, sugerirZona, leerSueloHuerto, leerPreferenciasAvisos } from './ajustes';
import { obtenerElevacion } from './clima';
import ScanScreen, { procesarColaPendiente } from './screens/ScanScreen';
import PlannerScreen from './screens/PlannerScreen';
import GardenScreen from './screens/GardenScreen';
import BuscarScreen from './screens/BuscarScreen';
import HoyScreen from './screens/HoyScreen';
import AuthScreen from './screens/AuthScreen';
import AjustesScreen from './screens/AjustesScreen';
import BotonAsistente from './components/BotonAsistente';

const navegacionRef = createNavigationContainerRef();

const Tab = createBottomTabNavigator();

const temaNavegacion = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.card,
    primary: colors.mint,
    text: colors.textPrimary,
    border: colors.border,
  },
};

const ICONOS = {
  Hoy: 'today',
  Huerto: 'flower',
  Escanear: 'camera',
  Planificar: 'leaf',
  Buscar: 'search',
  Ajustes: 'settings',
};

// Pantalla de diagnostico si el build no trae las variables de entorno de
// Supabase: en vez de crashear a ciegas (ver supabase.js), se explica en
// pantalla que falta configuracion de build, para no depender de adivinar
// la causa desde un dialogo generico de Android.
function PantallaConfigIncompleta() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 32,
          backgroundColor: colors.background,
        }}
      >
        <Text
          style={{
            fontSize: 20,
            fontWeight: '800',
            color: colors.textPrimary,
            textAlign: 'center',
            marginBottom: 16,
          }}
        >
          Configuracion incompleta
        </Text>
        <Text
          style={{
            fontSize: 14,
            color: colors.textSecondary,
            textAlign: 'center',
            lineHeight: 20,
          }}
        >
          Este build no incluye las variables de entorno de Supabase
          (EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY).{'\n\n'}
          Revisa "eas env:list --environment preview" en el proyecto de EAS,
          confirma que las 3 variables EXPO_PUBLIC_* existen ahi, y vuelve a
          compilar con "eas build --profile preview --platform android".
        </Text>
      </View>
    </SafeAreaProvider>
  );
}


// Barra de pestañas (necesita los márgenes seguros del móvil para que las
// etiquetas no queden tapadas por la barra de gestos de Android).
function Pestanias({ email }) {
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      initialRouteName="Hoy"
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.headerDeep },
        headerTintColor: colors.textOnDark,
        headerTitleStyle: { fontWeight: '800', fontSize: 20, letterSpacing: -0.3 },
        headerTitleAlign: 'left',
        tabBarActiveTintColor: colors.mintDark,
        tabBarInactiveTintColor: '#7C8B82',
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopWidth: 0,
          paddingTop: 6,
          height: 64 + insets.bottom,
          paddingBottom: Math.max(insets.bottom, 8),
          shadowColor: '#0B2A18',
          shadowOpacity: 0.08,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: -4 },
          elevation: 14,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '800', marginTop: 2 },
        headerShadowVisible: false,
        // Icono activo dentro de una "píldora" verde suave.
        tabBarIcon: ({ color, focused }) => (
          <View
            style={{
              width: 48,
              height: 30,
              borderRadius: 15,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: focused ? colors.accentSoftBg : 'transparent',
            }}
          >
            <Ionicons name={`${ICONOS[route.name]}${focused ? '' : '-outline'}`} size={22} color={color} />
          </View>
        ),
      })}
    >
      <Tab.Screen name="Hoy" component={HoyScreen} options={{ title: 'Hoy', tabBarLabel: 'Hoy' }} />
      <Tab.Screen name="Huerto" component={GardenScreen} options={{ title: 'Mi huerto', tabBarLabel: 'Huerto' }} />
      <Tab.Screen name="Escanear" component={ScanScreen} options={{ title: 'Diagnóstico', tabBarLabel: 'Analizar' }} />
      <Tab.Screen name="Planificar" component={PlannerScreen} options={{ title: 'Planificador', tabBarLabel: 'Plantar' }} />
      <Tab.Screen name="Buscar" component={BuscarScreen} options={{ title: 'Buscar plantas', tabBarLabel: 'Buscar' }} />
      <Tab.Screen name="Ajustes" options={{ title: 'Ajustes', tabBarLabel: 'Ajustes' }}>
        {() => <AjustesScreen email={email} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

export default function App() {
  const setConectado = useAppStore((s) => s.setConectado);
  const setCoords = useAppStore((s) => s.setCoords);
  const setZonaClimatica = useAppStore((s) => s.setZonaClimatica);
  const setSueloHuerto = useAppStore((s) => s.setSueloHuerto);
  const setPrefsAvisos = useAppStore((s) => s.setPrefsAvisos);
  // Pantalla abierta (contexto para el Asistente flotante).
  const [pantalla, setPantalla] = useState('Hoy');
  // Sesión: undefined = comprobando, null = sin sesión, objeto = logueado.
  const [sesion, setSesion] = useState(undefined);

  useEffect(() => {
    if (!SUPABASE_CONFIGURADO) return undefined;
    let cancelado = false;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!cancelado) setSesion(data?.session ?? null);
      })
      .catch(() => {
        if (!cancelado) setSesion(null);
      });
    const { data: suscripcion } = supabase.auth.onAuthStateChange((_evento, nuevaSesion) => {
      setSesion(nuevaSesion ?? null);
    });
    // La renovación del token solo corre con la app en primer plano.
    const subApp = AppState.addEventListener('change', (e) => {
      if (e === 'active') supabase.auth.startAutoRefresh?.();
      else supabase.auth.stopAutoRefresh?.();
    });
    return () => {
      cancelado = true;
      suscripcion?.subscription?.unsubscribe?.();
      subApp?.remove?.();
    };
  }, []);

  // Ubicación cacheada (ver ubicacion.js): se lee aquí, una sola vez al
  // arrancar la app entera, en vez de solo cuando se visita Planificar por
  // primera vez. Sin esto, si Pol ya había concedido el permiso antes pero
  // abre la app directamente en "Mi huerto" (la pestaña por defecto), el
  // panel de "Riego de hoy" pedía "Activa tu ubicación en Planificar"
  // aunque la posición ya estuviera guardada de una sesión anterior —
  // exactamente el patrón de "dato real que ya existe pero ningún sitio
  // lo consulta a tiempo" que preocupa a Pol. Nunca pide permiso ni toca
  // el GPS (leerCoordsCacheadas es solo lectura de AsyncStorage, ver
  // ubicacion.js); PlannerScreen sigue teniendo su propio efecto igual de
  // inofensivo (comprueba `if (coords) return`, así que aquí no duplica
  // ninguna petición real una vez esta ya ha rellenado el store).
  // v11: se repite al cambiar de cuenta (al cerrar sesión se limpia todo).
  const usuarioId = sesion?.user?.id || null;
  useEffect(() => {
    if (!usuarioId) return undefined;
    let cancelado = false;
    // v14: si no hay nada guardado pero el permiso ya está concedido, se
    // obtiene y guarda en silencio (sin diálogos): la ubicación se pide
    // UNA vez y ya no hay que activarla en cada apertura.
    (async () => {
      const suelo = await leerSueloHuerto();
      if (suelo && !cancelado) setSueloHuerto?.(suelo);
      const prefs = await leerPreferenciasAvisos();
      if (!cancelado) setPrefsAvisos?.(prefs);
      const coords = await obtenerUbicacionAutomatica();
      if (cancelado) return;
      if (coords) setCoords(coords);
      // Zona climática: la elegida por el usuario o, si nunca eligió,
      // una sugerencia por latitud/altitud.
      const guardada = await leerZonaClimatica();
      if (cancelado) return;
      if (guardada) {
        setZonaClimatica?.(guardada);
      } else if (coords) {
        const elevacion = await obtenerElevacion(coords.lat, coords.lon);
        if (!cancelado) setZonaClimatica?.(sugerirZona({ lat: coords.lat, elevacion }));
      }
    })().catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [usuarioId, setCoords, setZonaClimatica, setSueloHuerto, setPrefsAvisos]);

  // Se comprueba una sola vez aquí y se comparte por Zustand: así Scan y
  // Planner pueden fallar rápido ("sin conexión") en vez de esperar el
  // timeout de 20s de sus propias peticiones cuando ya sabemos que no hay red.
  useEffect(() => {
    // null = todavía no sabemos (primer evento de NetInfo). El primer
    // evento SÍ debe intentar un drenaje si llega ya conectado: si la
    // app se cerró estando sin red con fotos encoladas, ese primer
    // evento "conectado" (arranque en frío, ya con internet) es la
    // única oportunidad de drenarlas — de lo contrario se quedarían
    // esperando un ciclo real de desconexión/reconexión que puede no
    // llegar nunca en esta sesión.
    let estabaConectado = null;
    const desuscribir = NetInfo.addEventListener((estado) => {
      // isInternetReachable: con cobertura mínima el móvil puede estar
      // "conectado" a la red móvil pero sin salida real a internet.
      // Bug real (datos móviles sin wifi): la comprobación de "internet
      // alcanzable" de NetInfo hace una petición a Google con un timeout
      // corto que en 4G/3G lento falla aunque haya cobertura, y la app
      // creía estar SIN conexión (la foto ni se intentaba analizar). Ahora
      // solo se considera sin conexión si el móvil no tiene ninguna red;
      // si la red falla de verdad, la petición real lo detecta y la foto
      // va a la cola offline.
      const ahoraConectado = estado.isConnected !== false;
      if (ahoraConectado === true && (estabaConectado === false || estabaConectado === null)) {
        // Se acaba de recuperar la conexión (o es el primer evento tras
        // arrancar ya conectado): se drena la cola de diagnósticos
        // pendientes en segundo plano. procesarColaPendiente nunca lanza
        // (ver screens/ScanScreen.js), pero el .catch es un cinturón de
        // seguridad extra para no dejar nunca una promesa sin capturar
        // en este listener.
        procesarColaPendiente().catch(() => {});
      }
      estabaConectado = ahoraConectado;
      setConectado(ahoraConectado);
    });
    return () => desuscribir();
  }, [setConectado]);

  // Reintento periódico de la cola offline (cada 2 min) y al volver la
  // app a primer plano: con cobertura intermitente puede no producirse
  // nunca un cambio limpio desconectado->conectado que dispare el drenaje.
  // procesarColaPendiente es barato si la cola está vacía (lee un archivo)
  // y tiene guardián de reentrada.
  useEffect(() => {
    const intentar = () => {
      if (useAppStore.getState?.()?.conectado !== false) procesarColaPendiente().catch(() => {});
    };
    const intervalo = setInterval(intentar, 2 * 60 * 1000);
    const sub = AppState.addEventListener('change', (estadoApp) => {
      if (estadoApp === 'active') intentar();
    });
    return () => {
      clearInterval(intervalo);
      sub?.remove?.();
    };
  }, []);

  // SUPABASE_CONFIGURADO es una constante fijada al cargar el modulo (no
  // cambia entre renders), asi que este return condicional DESPUES de
  // todos los hooks no rompe las Reglas de los Hooks: el orden de
  // llamadas a useEffect/useAppStore es siempre el mismo en cada render.
  if (!SUPABASE_CONFIGURADO) {
    return <PantallaConfigIncompleta />;
  }

  if (sesion === undefined) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }} />
    );
  }

  if (sesion === null) {
    return (
      <SafeAreaProvider>
        <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
        <AuthScreen />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.headerDeep} />
      <NavigationContainer
        theme={temaNavegacion}
        ref={navegacionRef}
        onStateChange={() => setPantalla(navegacionRef.getCurrentRoute?.()?.name || 'Hoy')}
      >
        <Pestanias email={sesion?.user?.email} />
      </NavigationContainer>
      {/* Asistente disponible en todas las pantallas (botón 🤖 flotante). */}
      <BotonAsistente pantalla={pantalla} />
    </SafeAreaProvider>
  );
}
