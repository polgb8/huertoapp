-- ============================================================
-- MIGRACIÓN v9 (aditiva, no destructiva): datos de la estimación por IA
-- al añadir un árbol con foto.
--   diametro_copa  -> metros; el riego de árboles se calcula por área de
--                     copa (método FAO-56, ver riego.js).
--   edad_estimada  -> true si fecha_siembra se calculó a partir de la
--                     edad estimada por la IA (no es la fecha real).
-- Opcional: sin ella la app guarda estos datos solo en el móvil.
-- Ejecutar en: Supabase Dashboard > SQL Editor > New query.
-- ============================================================
alter table public.cultivos_huerto add column if not exists diametro_copa numeric;
alter table public.cultivos_huerto add column if not exists edad_estimada boolean;
