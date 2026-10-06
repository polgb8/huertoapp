-- ============================================================
-- migracion_v3_atribucion.sql — Migración aditiva sobre el esquema
-- existente (supabase_schema.sql + migracion_v2_zonas_cantidad.sql, que
-- se dejan intactos). Solo añade una columna nueva con
-- ADD COLUMN IF NOT EXISTS: no borra ni reescribe nada existente.
-- Ejecutar a mano en el editor SQL de Supabase.
--
-- Motivo: "Compartir huerto" — Pol y otra persona (p.ej. su pareja)
-- entran ahora con su propia cuenta real (Supabase Auth), pero siguen
-- viendo el mismo huerto compartido (no hay filas separadas por
-- usuario). Esta columna solo guarda, a título informativo, QUIÉN
-- hizo cada acción ("por Pol" / "por Marta"), sin cambiar en nada quién
-- puede ver o escribir qué: eso lo sigue decidiendo el RLS existente,
-- que ya da acceso completo a cualquier usuario autenticado.
--
-- IMPORTANTE: hasta que ejecutes este script, la app sigue funcionando
-- exactamente igual que antes (el código detecta si la columna existe
-- antes de intentar escribirla), así que no hay prisa ni riesgo en
-- ejecutarlo cuando te venga bien.
-- ============================================================

alter table public.cultivos_huerto add column if not exists creado_por_email text;
alter table public.diagnosticos    add column if not exists creado_por_email text;
alter table public.tareas_huerto   add column if not exists creado_por_email text;
