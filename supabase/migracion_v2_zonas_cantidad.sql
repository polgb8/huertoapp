-- ============================================================
-- migracion_v2_zonas_cantidad.sql — Migración aditiva sobre el
-- esquema v1 (supabase_schema.sql, que se deja intacto como registro
-- histórico). Solo añade columnas nuevas con ADD COLUMN IF NOT EXISTS:
-- no borra ni reescribe nada existente. Ejecutar a mano en el editor
-- SQL de Supabase.
-- ============================================================

-- cantidad: para poder registrar "10 lechugas" como una sola fila en vez
-- de 10 filas idénticas; por defecto 1 para no romper los cultivos ya
-- guardados (se comportan igual que antes, como si fueran 1 unidad).
alter table public.cultivos_huerto
  add column if not exists cantidad integer not null default 1;

-- zona: agrupación libre en texto (p.ej. "Bancal 1", "Maceta terraza")
-- para poder avisar de compatibilidad entre cultivos de la misma zona;
-- nullable porque los cultivos ya existentes no tienen zona asignada.
alter table public.cultivos_huerto
  add column if not exists zona text;
