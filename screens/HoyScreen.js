// ============================================================
// screens/HoyScreen.js — "Hoy": lo que toca hacer hoy en el huerto, en
// una sola lista con casillas. Regar (agrupado por zona, con "Regar todo"),
// podar (con pasos breves), cosechar, tareas y lo ya hecho hoy. Cada
// acción se puede DESHACER durante unos segundos.
// ============================================================

import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';

import { LinearGradient } from 'expo-linear-gradient';

import { colors, spacing, radii, gradientes, sombraTarjeta } from '../theme';
import { Card, Hero, BarraProgreso, TituloSeccion, Casilla, ToastDeshacer, Pastilla, BotonPrimario, EstadoVacio } from '../components/UI';
import { AvisoUsoGratis, useUsoGratis } from '../components/UsoGratis';
import useDatosHuerto, { CATALOGO_PLANO } from '../hooks/useDatosHuerto';
import { construirHoy } from '../hoy';
import { aplicarMarca, deshacerMarca } from '../acciones';
import { marcarCultivoComoCosechado, crearTareaSaneamiento, marcarTareaCompletada } from '../supabase';
import { mensajeDeError } from '../utils';

function saludo(fecha = new Date()) {
  const h = fecha.getHours();
  if (h < 6) return 'Buenas noches 🌙';
  if (h < 13) return 'Buenos días ☀️';
  if (h < 21) return 'Buenas tardes 🌤️';
  return 'Buenas noches 🌙';
}

export default function HoyScreen() {
  const navigation = useNavigation();
  const datos = useDatosHuerto();
  const uso = useUsoGratis();
  const { activos, tareas, setTareas, balance, cargando, error, recargar, recomendaciones, alertasPoda, parchearCultivo, setCultivos } = datos;
  const [aviso, setAviso] = useState(null); // { texto, deshacer: [{id, campo, previo}] }
  const [ocupado, setOcupado] = useState(null);
  const [pasosAbiertos, setPasosAbiertos] = useState({});
  const [errorAccion, setErrorAccion] = useState(null);

  const hoy = useMemo(
    () =>
      construirHoy({
        activos,
        recomendaciones: recomendaciones?.recomendaciones || [],
        alertasPoda,
        tareas,
        catalogo: CATALOGO_PLANO,
      }),
    [activos, recomendaciones, alertasPoda, tareas]
  );

  const marcar = useCallback(
    async (items, campo, texto) => {
      const ahoraISO = new Date().toISOString();
      items.forEach((it) => parchearCultivo(it.id, { [campo]: ahoraISO }));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setAviso({ texto, deshacer: items.map((it) => ({ id: it.id, campo, previo: it.previo ?? null })) });
      await Promise.all(items.map((it) => aplicarMarca(it.id, campo)));
    },
    [parchearCultivo]
  );

  const deshacer = useCallback(async () => {
    const lista = aviso?.deshacer || [];
    setAviso(null);
    lista.forEach((d) => parchearCultivo(d.id, { [d.campo]: d.previo }));
    await Promise.all(lista.map((d) => deshacerMarca(d.id, d.campo, d.previo)));
  }, [aviso, parchearCultivo]);

  const deshacerHecho = useCallback(
    async (h) => {
      parchearCultivo(h.id, { [h.campo]: null });
      await deshacerMarca(h.id, h.campo, null);
    },
    [parchearCultivo]
  );

  const cosechar = useCallback(
    (c) => {
      Alert.alert(`¿Cosechado "${c.nombre}"?`, 'Pasará al historial y se creará la tarea de sanear la tierra.', [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sí, cosechado',
          onPress: async () => {
            setOcupado(c.id);
            try {
              await marcarCultivoComoCosechado(c.id);
              setCultivos((prev) => prev.map((x) => (x.id === c.id ? { ...x, estado: 'cosechado' } : x)));
              crearTareaSaneamiento({ cultivoId: c.id, nombreCultivo: c.nombre }).catch(() => {});
              setAviso({ texto: `🧺 ${c.nombre} cosechado`, deshacible: false });
            } catch (e) {
              setErrorAccion(mensajeDeError(e));
            } finally {
              setOcupado(null);
            }
          },
        },
      ]);
    },
    [setCultivos]
  );

  const completarTarea = useCallback(
    async (t) => {
      setOcupado(t.id);
      try {
        await marcarTareaCompletada(t.id);
        setTareas((prev) => prev.filter((x) => x.id !== t.id));
        setAviso({ texto: '📝 Tarea hecha', deshacible: false });
      } catch (e) {
        setErrorAccion(mensajeDeError(e));
      } finally {
        setOcupado(null);
      }
    },
    [setTareas]
  );

  const fecha = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  const hechas = hoy.hechos.length;
  const fraccion = hoy.total > 0 ? hechas / hoy.total : 1;
  const sinNada = hoy.total === 0 && !cargando;

  return (
    <View style={estilos.contenedor}>
      <ScrollView
        contentContainerStyle={estilos.contenido}
        refreshControl={<RefreshControl refreshing={cargando} onRefresh={recargar} />}
      >
        <Hero saludo={saludo()} titulo={`${fecha.charAt(0).toUpperCase()}${fecha.slice(1)}`}>
          <View style={estilos.heroProgreso}>
            <Text style={estilos.heroProgresoTexto} testID="progreso-hoy">
              {hoy.total === 0 ? 'Nada pendiente' : `${hechas} de ${hoy.total} hechas`}
            </Text>
            <BarraProgreso fraccion={fraccion} />
          </View>
        </Hero>

        {!!balance && (
          <View style={estilos.filaTiempo}>
            {balance.tempMaxHoy != null && (
              <Pastilla icono="🌡️" texto={`Máx. ${Math.round(balance.tempMaxHoy)}°`} color={colors.tierra} fondo={colors.tierraSoft} />
            )}
            <Pastilla
              icono="🌧️"
              texto={balance.lluviaPrevistaMm > 0 ? `${String(balance.lluviaPrevistaMm).replace('.', ',')} mm previstos` : 'Sin lluvia prevista'}
              color={colors.agua}
              fondo={colors.aguaSoft}
            />
          </View>
        )}
        {!balance && !datos.coords && (
          <Text style={estilos.nota}>📍 Sin ubicación: el riego es orientativo. Actívala en la pestaña Ajustes.</Text>
        )}
        {!!error && <Text style={estilos.error}>{error}</Text>}
        {!!errorAccion && <Text style={estilos.error}>{errorAccion}</Text>}

        <AvisoUsoGratis gemini={uso.gemini} supa={uso.supa} style={estilos.avisoUso} />

        {sinNada && (
          <Card style={estilos.vacio}>
            <EstadoVacio
              icono={activos.length === 0 ? '🌱' : '🎉'}
              titulo={activos.length === 0 ? 'Empieza tu huerto' : 'Todo al día'}
              texto={
                activos.length === 0
                  ? 'Haz una foto a una planta: la IA la reconoce y aquí verás cada día qué regar, podar y cosechar.'
                  : 'Hoy no hay nada pendiente en tu huerto. ¡Disfrútalo!'
              }
            >
              {activos.length === 0 && (
                <BotonPrimario
                  titulo="Añadir planta con foto"
                  icono="📷"
                  onPress={() => navigation.navigate('Huerto', { accion: 'foto', t: Date.now() })}
                  style={estilos.botonVacio}
                />
              )}
            </EstadoVacio>
          </Card>
        )}

        {hoy.regarPorZona.length > 0 && (
          <>
            <TituloSeccion icono="💧" titulo={`Regar (${hoy.totalRegar})`} />
            {hoy.regarPorZona.map((grupo) => (
              <Card key={grupo.zona} style={estilos.tarjeta}>
                <View style={estilos.cabeceraGrupo}>
                  <Text style={estilos.zona}>📍 {grupo.zona}</Text>
                  {grupo.items.length > 1 && (
                    <TouchableOpacity
                      testID={`regar-todo-${grupo.zona}`}
                      onPress={() => marcar(grupo.items, 'ultimo_riego', `💧 ${grupo.items.length} plantas de ${grupo.zona} regadas`)}
                      style={estilos.botonTodo}
                      accessibilityRole="button"
                    >
                      <Text style={estilos.botonTodoTexto}>✓ Regar todo</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {grupo.items.map((r) => (
                  <View key={r.id} style={estilos.fila}>
                    <Casilla
                      testID={`hoy-regar-${r.id}`}
                      color={colors.agua}
                      onPress={() => marcar([r], 'ultimo_riego', `💧 ${r.nombre} regado`)}
                      accessibilityLabel={`Marcar ${r.nombre} como regado`}
                    />
                    <View style={estilos.filaTextos}>
                      <Text style={estilos.nombre}>{r.nombre}</Text>
                      <Text style={estilos.detalleAgua}>{r.detalle}</Text>
                    </View>
                  </View>
                ))}
              </Card>
            ))}
          </>
        )}

        {hoy.esperandoLluvia.length > 0 && (
          <Card style={[estilos.tarjeta, { backgroundColor: colors.aguaSoft }]}>
            <Text style={estilos.detalleAgua}>
              🌧️ Esperando la lluvia: {hoy.esperandoLluvia.map((r) => r.nombre).join(', ')}
            </Text>
          </Card>
        )}

        {hoy.podar.length > 0 && (
          <>
            <TituloSeccion icono="✂️" titulo={`Podar (${hoy.podar.length})`} />
            <Card style={estilos.tarjeta}>
              {hoy.podar.map((a) => (
                <View key={a.cultivoId} style={estilos.bloquePoda}>
                  <View style={estilos.fila}>
                    <Casilla
                      testID={`hoy-podar-${a.cultivoId}`}
                      color={colors.poda}
                      onPress={() => marcar([{ id: a.cultivoId, previo: a.previo }], 'ultima_poda', `✂️ ${a.nombre} podado`)}
                      accessibilityLabel={`Marcar ${a.nombre} como podado`}
                    />
                    <TouchableOpacity
                      style={estilos.filaTextos}
                      onPress={() => setPasosAbiertos((p) => ({ ...p, [a.cultivoId]: !p[a.cultivoId] }))}
                      accessibilityRole="button"
                    >
                      <Text style={estilos.nombre}>{a.nombre}{a.variedad ? ` (${a.variedad})` : ''}</Text>
                      <Text style={estilos.detallePoda}>
                        {a.tipoPoda} · hasta finales de {a.mesFin} · {pasosAbiertos[a.cultivoId] ? 'ocultar ▲' : 'cómo ▼'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {pasosAbiertos[a.cultivoId] &&
                    (a.pasos || []).map((p, i) => (
                      <Text key={i} style={estilos.paso}>
                        {i + 1}. {p}
                      </Text>
                    ))}
                </View>
              ))}
            </Card>
          </>
        )}

        {hoy.cosechar.length > 0 && (
          <>
            <TituloSeccion icono="🧺" titulo={`Listo para cosechar (${hoy.cosechar.length})`} />
            <Card style={estilos.tarjeta}>
              {hoy.cosechar.map((c) => (
                <View key={c.id} style={estilos.fila}>
                  <Casilla
                    testID={`hoy-cosechar-${c.id}`}
                    color={colors.tierra}
                    onPress={() => cosechar(c)}
                    accessibilityLabel={`Marcar ${c.nombre} como cosechado`}
                  />
                  <View style={estilos.filaTextos}>
                    <Text style={estilos.nombre}>{c.nombre}</Text>
                    <Text style={estilos.detalle}>{ocupado === c.id ? 'Guardando…' : 'Ya ha cumplido su ciclo'}</Text>
                  </View>
                </View>
              ))}
            </Card>
          </>
        )}

        {hoy.tareas.length > 0 && (
          <>
            <TituloSeccion icono="📝" titulo={`Tareas (${hoy.tareas.length})`} />
            <Card style={estilos.tarjeta}>
              {hoy.tareas.map((t) => (
                <View key={t.id} style={estilos.fila}>
                  <Casilla testID={`hoy-tarea-${t.id}`} onPress={() => completarTarea(t)} accessibilityLabel={`Marcar ${t.titulo} como hecha`} />
                  <View style={estilos.filaTextos}>
                    <Text style={estilos.nombre}>{t.titulo}</Text>
                    {!!t.descripcion && <Text style={estilos.detalle}>{t.descripcion}</Text>}
                  </View>
                </View>
              ))}
            </Card>
          </>
        )}

        {hoy.hechos.length > 0 && (
          <>
            <TituloSeccion icono="✅" titulo={`Hecho hoy (${hoy.hechos.length})`} />
            <Card style={estilos.tarjeta}>
              {hoy.hechos.map((h) => (
                <View key={h.clave} style={estilos.fila}>
                  <Casilla marcada color={h.tipo === 'riego' ? colors.agua : colors.poda} onPress={() => deshacerHecho(h)} accessibilityLabel={`Desmarcar ${h.nombre}`} />
                  <View style={estilos.filaTextos}>
                    <Text style={[estilos.nombre, estilos.nombreHecho]}>{h.nombre}</Text>
                    <Text style={estilos.detalle}>{h.tipo === 'riego' ? '💧 Regado' : '✂️ Podado'} · toca para desmarcar</Text>
                  </View>
                </View>
              ))}
            </Card>
          </>
        )}

        <View style={estilos.accesos}>
          <TouchableOpacity
            style={estilos.acceso}
            activeOpacity={0.85}
            accessibilityRole="button"
            onPress={() => navigation.navigate('Huerto', { accion: 'foto', t: Date.now() })}
          >
            <LinearGradient colors={gradientes.primario} style={estilos.accesoIcono}>
              <Text style={estilos.accesoEmoji}>📷</Text>
            </LinearGradient>
            <Text style={estilos.accesoTitulo}>Añadir planta</Text>
            <Text style={estilos.accesoTexto}>La IA la reconoce con una foto</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={estilos.acceso}
            activeOpacity={0.85}
            accessibilityRole="button"
            onPress={() => navigation.navigate('Escanear')}
          >
            <LinearGradient colors={gradientes.cosecha} style={estilos.accesoIcono}>
              <Text style={estilos.accesoEmoji}>🔍</Text>
            </LinearGradient>
            <Text style={estilos.accesoTitulo}>Diagnosticar</Text>
            <Text style={estilos.accesoTexto}>Plagas, poda o cosecha</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <ToastDeshacer aviso={aviso} onDeshacer={aviso?.deshacer ? deshacer : null} onCerrar={() => setAviso(null)} />
    </View>
  );
}

const estilos = StyleSheet.create({
  contenedor: { flex: 1, backgroundColor: colors.background },
  // Hueco inferior generoso: el botón del Asistente y el aviso "Deshacer"
  // nunca tapan la última fila.
  contenido: { padding: spacing.md, paddingBottom: 120 },
  heroProgreso: { flex: 1, gap: 6 },
  heroProgresoTexto: { color: colors.textOnDark, fontWeight: '700', fontSize: 14 },
  filaTiempo: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md },
  nota: { fontSize: 13, color: colors.textSecondary, marginTop: spacing.md },
  error: { fontSize: 14, color: colors.danger, marginTop: spacing.md },
  tarjeta: { marginBottom: spacing.sm, paddingVertical: spacing.sm },
  vacio: { marginTop: spacing.md, paddingVertical: spacing.sm },
  botonVacio: { marginTop: spacing.lg, alignSelf: 'stretch' },
  avisoUso: { marginTop: spacing.md },
  cabeceraGrupo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  zona: { fontSize: 13, fontWeight: '800', color: colors.textSecondary },
  botonTodo: { backgroundColor: colors.aguaSoft, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 6 },
  botonTodoTexto: { color: colors.agua, fontWeight: '800', fontSize: 13 },
  fila: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 52 },
  filaTextos: { flex: 1, paddingVertical: 6 },
  nombre: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  nombreHecho: { textDecorationLine: 'line-through', color: colors.textSecondary },
  detalle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  detalleAgua: { fontSize: 13, color: colors.agua, fontWeight: '600', marginTop: 2, lineHeight: 18 },
  detallePoda: { fontSize: 13, color: colors.poda, fontWeight: '600', marginTop: 2 },
  bloquePoda: { paddingBottom: 4 },
  paso: { fontSize: 13, color: colors.textPrimary, marginLeft: 50, marginTop: 4, lineHeight: 19 },
  accesos: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  acceso: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...sombraTarjeta,
  },
  accesoIcono: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  accesoEmoji: { fontSize: 22 },
  accesoTitulo: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
  accesoTexto: { fontSize: 12, color: colors.textSecondary, marginTop: 2, lineHeight: 16 },
});
