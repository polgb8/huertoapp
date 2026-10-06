// ============================================================
// components/TextoFormateado.js — Muestra respuestas del Asistente con
// un "markdown" mínimo: **negrita**, listas con "- " / "* " / "1. " y
// títulos "#". Sin dependencias nuevas.
// ============================================================

import React from 'react';
import { Text, View, StyleSheet } from 'react-native';

export function trocearNegrita(linea) {
  const partes = [];
  const re = /\*\*(.+?)\*\*/g;
  let ultimo = 0;
  let m;
  while ((m = re.exec(linea)) !== null) {
    if (m.index > ultimo) partes.push({ texto: linea.slice(ultimo, m.index), negrita: false });
    partes.push({ texto: m[1], negrita: true });
    ultimo = m.index + m[0].length;
  }
  if (ultimo < linea.length) partes.push({ texto: linea.slice(ultimo), negrita: false });
  return partes;
}

export default function TextoFormateado({ texto, estilo }) {
  const lineas = String(texto || '').replace(/\r/g, '').split('\n');
  return (
    <View>
      {lineas.map((cruda, i) => {
        const linea = cruda.trimEnd();
        if (!linea.trim()) return <View key={i} style={estilos.hueco} />;
        const titulo = /^#{1,6}\s+/.test(linea);
        const vineta = /^\s*[-*•]\s+/.test(linea);
        const numero = linea.match(/^\s*(\d+)[.)]\s+/);
        let contenido = linea;
        if (titulo) contenido = linea.replace(/^#{1,6}\s+/, '');
        else if (vineta) contenido = linea.replace(/^\s*[-*•]\s+/, '');
        else if (numero) contenido = linea.replace(/^\s*\d+[.)]\s+/, '');
        const trozos = trocearNegrita(contenido).map((p, k) => (
          <Text key={k} style={p.negrita || titulo ? estilos.negrita : null}>
            {p.texto}
          </Text>
        ));
        if (vineta || numero) {
          return (
            <View key={i} style={estilos.filaLista}>
              <Text style={estilo}>{vineta ? '•' : `${numero[1]}.`}</Text>
              <Text style={[estilo, estilos.textoLista]}>{trozos}</Text>
            </View>
          );
        }
        return (
          <Text key={i} style={[estilo, titulo && estilos.titulo]}>
            {trozos}
          </Text>
        );
      })}
    </View>
  );
}

const estilos = StyleSheet.create({
  negrita: { fontWeight: '800' },
  titulo: { fontSize: 16, marginTop: 2 },
  hueco: { height: 6 },
  filaLista: { flexDirection: 'row', gap: 6, marginTop: 2 },
  textoLista: { flex: 1 },
});
