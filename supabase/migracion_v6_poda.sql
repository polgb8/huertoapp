-- ============================================================
-- MIGRACIÓN v6 (aditiva, no destructiva): fecha de última poda POR
-- CULTIVO, para que la alerta de poda sea individual a cada árbol/seto
-- realmente plantado (antes solo había una lista genérica de especies
-- de ejemplo en `plantas`, desconectada del huerto real).
--
-- Ejecutar en: Supabase Dashboard > SQL Editor > New query.
-- Segura de re-ejecutar (usa "if not exists"); no toca ninguna fila
-- existente en cultivos_huerto — Calabacín y Zanahoria (u otros
-- cultivos ya guardados) quedan intactos, simplemente con esta columna
-- nueva en null.
-- ============================================================

alter table public.cultivos_huerto add column if not exists ultima_poda timestamptz;
