-- ============================================================
-- MIGRACIÓN v8 (aditiva, no destructiva): tamaño de la planta
-- ('pequeno' | 'mediano' | 'grande') para ajustar el riego de árboles,
-- arbustos y trepadoras (un limonero joven no bebe lo mismo que uno
-- adulto). Opcional: sin ella la app guarda el tamaño solo en el móvil.
-- Ejecutar en: Supabase Dashboard > SQL Editor > New query.
-- ============================================================
alter table public.cultivos_huerto add column if not exists tamano text;
