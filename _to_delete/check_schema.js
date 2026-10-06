const fs = require('fs');

function cargarEnv(rutaEnv) {
  const contenido = fs.readFileSync(rutaEnv, 'utf8');
  contenido.split('\n').forEach((linea) => {
    const m = linea.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  });
}
cargarEnv('.env');

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

async function probarColumna(nombre) {
  const { error } = await supabase.from('cultivos_huerto').select(nombre).limit(1);
  return !error;
}

async function main() {
  const columnas = ['id', 'nombre', 'variedad', 'zona', 'cantidad', 'origen', 'imagen_url', 'dias_cosecha', 'estado', 'fecha_siembra', 'creado_por_email'];
  console.log('--- Columnas de cultivos_huerto ---');
  for (const col of columnas) {
    const existe = await probarColumna(col);
    console.log(col, '=>', existe ? 'EXISTE' : 'NO EXISTE');
  }

  console.log('--- Filas reales (solo nombre/cantidad/estado/zona) ---');
  const { data, error } = await supabase.from('cultivos_huerto').select('nombre, estado, zona, cantidad').order('id');
  if (error) {
    console.log('Error al listar:', error.message);
  } else {
    console.log('Total filas:', data.length);
    data.forEach((f) => console.log(JSON.stringify(f)));
  }

  console.log('--- Buckets de Storage ---');
  const { data: buckets, error: errBuckets } = await supabase.storage.listBuckets();
  if (errBuckets) {
    console.log('Error al listar buckets:', errBuckets.message);
  } else {
    console.log(buckets.map((b) => b.name));
  }

  console.log('--- Tabla tareas_saneamiento existe? ---');
  const { error: errTareas } = await supabase.from('tareas_saneamiento').select('id').limit(1);
  console.log(errTareas ? 'NO / error: ' + errTareas.message : 'SI');

  console.log('--- Tabla diagnosticos existe? ---');
  const { error: errDiag } = await supabase.from('diagnosticos').select('id').limit(1);
  console.log(errDiag ? 'NO / error: ' + errDiag.message : 'SI');

  console.log('--- Tabla plantas existe (para planta_id de insertarCultivo)? ---');
  const { data: plantas, error: errPlantas } = await supabase.from('plantas').select('id').limit(3);
  console.log(errPlantas ? 'NO / error: ' + errPlantas.message : 'SI, filas: ' + plantas.length);
}

main().catch((e) => console.log('FALLO GENERAL:', e.message));
