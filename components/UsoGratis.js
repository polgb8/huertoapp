// ============================================================
// components/UsoGratis.js — Uso de los planes GRATUITOS (Gemini y
// Supabase) y avisos cuando se acercan al límite (80 %).
//  - useUsoGratis(): carga el uso al enfocar la pantalla.
//  - TarjetaUsoGratis: detalle con barras (Ajustes).
//  - AvisoUsoGratis: aviso compacto que solo aparece si hay que avisar (Hoy).
// ============================================================

import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { colors, spacing } from '../theme';
import { Card, BarraUso, TarjetaAviso } from './UI';
import { leerUsoGemini, resumirUsoGemini, resumirUsoSupabase, horaReinicioLocal } from '../limitesGratis';
import { obtenerUsoSupabase } from '../supabase';

export function useUsoGratis() {
  const [gemini, setGemini] = useState(null);
  const [supa, setSupa] = useState(null);
  const recargar = useCallback(async () => {
    try {
      setGemini(resumirUsoGemini(await leerUsoGemini()));
    } catch (e) {
      setGemini(null);
    }
    try {
      setSupa(resumirUsoSupabase(await obtenerUsoSupabase()));
    } catch (e) {
      setSupa(null);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      recargar();
    }, [recargar])
  );
  return { gemini, supa, recargar };
}

function textoAvisoGemini(g) {
  if (!g || g.nivel === 'ok') return null;
  const reinicio = horaReinicioLocal();
  if (g.todosAgotados) return `Se ha agotado el cupo gratuito de IA de hoy. Vuelve a estar disponible a las ${reinicio}.`;
  if (g.principal.nivel === 'agotado')
    return `Cupo principal de IA agotado por hoy: la app usa el modelo de respaldo (también gratis). Se renueva a las ${reinicio}.`;
  return `Llevas ${g.principal.usado} de ${g.principal.limite} análisis con IA gratis de hoy. Se renueva a las ${reinicio}.`;
}

function textoAvisoSupa(s) {
  if (!s || s.nivel === 'ok') return null;
  const f = s.filas.find((x) => x.nivel !== 'ok');
  return f.nivel === 'agotado'
    ? `${f.nombre}: se ha llenado el espacio gratuito (${f.texto}). Borra fotos o plantas antiguas del historial.`
    : `${f.nombre}: ${f.texto} del plan gratuito. Si se llena, no se podrán guardar más datos.`;
}

export function AvisoUsoGratis({ gemini, supa, style }) {
  const tg = textoAvisoGemini(gemini);
  const ts = textoAvisoSupa(supa);
  if (!tg && !ts) return null;
  const grave = gemini?.nivel === 'agotado' || supa?.nivel === 'agotado';
  return (
    <TarjetaAviso color={grave ? colors.danger : colors.warning} fondo={grave ? '#FEF2F2' : '#FFF7ED'} style={style} testID="aviso-uso-gratis">
      <Text style={estilos.avisoTitulo}>{grave ? '⛔ Límite gratuito alcanzado' : '⚠️ Cerca del límite gratuito'}</Text>
      {!!tg && <Text style={estilos.avisoTexto}>🤖 {tg}</Text>}
      {!!ts && <Text style={estilos.avisoTexto}>🗄️ {ts}</Text>}
    </TarjetaAviso>
  );
}

export function TarjetaUsoGratis({ gemini, supa, style }) {
  return (
    <Card style={style}>
      <Text style={estilos.seccion}>🤖 IA de Google (hoy, en este móvil)</Text>
      {gemini ? (
        gemini.filas
          .filter((f) => f.usado > 0 || f.modelo === gemini.principal.modelo || f.nivel !== 'ok')
          .map((f) => (
            <BarraUso
              key={f.modelo}
              etiqueta={f.nombre}
              detalle={f.nivel === 'agotado' && f.usado < f.limite ? 'agotado hoy' : `${f.usado} / ${f.limite}`}
              fraccion={f.nivel === 'agotado' ? 1 : f.usado / f.limite}
              nivel={f.nivel}
            />
          ))
      ) : (
        <Text style={estilos.nota}>Cargando…</Text>
      )}
      <Text style={estilos.nota}>
        Peticiones gratis al día por clave de Google (se renuevan a las {horaReinicioLocal()}). Si usas la misma clave en
        varios móviles, el total es la suma.
      </Text>

      <Text style={[estilos.seccion, { marginTop: spacing.lg }]}>🗄️ Almacenamiento (Supabase gratis)</Text>
      {supa ? (
        supa.filas.map((f) => (
          <BarraUso key={f.clave} etiqueta={f.nombre} detalle={f.texto} fraccion={f.usado / f.limite} nivel={f.nivel} />
        ))
      ) : (
        <Text style={estilos.nota}>No disponible ahora (sin conexión).</Text>
      )}
      <Text style={estilos.nota}>Total compartido por todas las cuentas de la app. El plan gratuito nunca cobra: si se llena, solo limita.</Text>
    </Card>
  );
}

const estilos = StyleSheet.create({
  seccion: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
  nota: { fontSize: 12, color: colors.textSecondary, marginTop: spacing.sm, lineHeight: 17 },
  avisoTitulo: { fontSize: 15, fontWeight: '800', color: colors.textPrimary, marginBottom: 4 },
  avisoTexto: { fontSize: 13, color: colors.textPrimary, marginTop: 4, lineHeight: 19 },
});

export default TarjetaUsoGratis;
