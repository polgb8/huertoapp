-- ============================================================
-- migracion_v4_origen.sql — Migración aditiva sobre el esquema
-- existente (supabase_schema.sql + migracion_v2_zonas_cantidad.sql +
-- migracion_v3_atribucion.sql, que se dejan intactos). Solo añade una
-- columna nueva con ADD COLUMN IF NOT EXISTS: no borra ni reescribe
-- nada existente, así que tus 2 cultivos ya guardados (Calabacín,
-- Zanahoria) no se ven afectados en absoluto. Ejecutar a mano en el
-- editor SQL de Supabase.
--
-- Motivo: distinguir si un cultivo se sembró por semilla o se compró ya
-- crecido y se trasplantó — afecta a cuánta ventaja lleva hacia la
-- cosecha. Se guarda como texto libre con un valor por defecto
-- ('semilla') para que las filas ya existentes (que no tenían este
-- concepto) queden en el estado más neutro/conservador posible.
--
-- IMPORTANTE: hasta que ejecutes este script, la app sigue funcionando
-- exactamente igual que antes (el código comprueba si la columna existe
-- antes de intentar escribirla, igual que hizo con `creado_por_email`
-- en su momento), así que no hay prisa ni riesgo en ejecutarlo cuando
-- te venga bien.
-- ============================================================

alter table public.cultivos_huerto
  add column if not exists origen text not null default 'semilla';
