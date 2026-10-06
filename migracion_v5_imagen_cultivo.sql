-- ============================================================
-- migracion_v5_imagen_cultivo.sql — Migración aditiva sobre el esquema
-- existente (supabase_schema.sql + v2 + v3 + v4, que se dejan
-- intactos). Solo añade una columna nueva y un bucket de Storage
-- nuevo: no borra ni reescribe nada existente, así que tus cultivos ya
-- guardados no se ven afectados. Ejecutar a mano en el editor SQL de
-- Supabase.
--
-- Motivo: poder poner una foto real a cada cultivo (opcional); si no
-- se pone ninguna, la app sigue mostrando el emoji de la especie como
-- hasta ahora.
--
-- IMPORTANTE: hasta que ejecutes este script, la app sigue funcionando
-- exactamente igual que antes (el código comprueba si la columna existe
-- antes de intentar escribirla, igual que ya hizo con `origen` y
-- `creado_por_email`), así que no hay prisa ni riesgo en ejecutarlo
-- cuando te venga bien.
-- ============================================================

alter table public.cultivos_huerto
  add column if not exists imagen_url text;

-- Bucket de Storage para las fotos de cultivo, con las mismas políticas
-- (públicas de lectura, inserción abierta a anon) que ya tiene
-- 'diagnosticos-fotos' en supabase_schema.sql.
insert into storage.buckets (id, name, public)
values ('cultivos-fotos', 'cultivos-fotos', true)
on conflict (id) do nothing;

drop policy if exists "anon_select_fotos_cultivo" on storage.objects;
create policy "anon_select_fotos_cultivo"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'cultivos-fotos');

drop policy if exists "anon_insert_fotos_cultivo" on storage.objects;
create policy "anon_insert_fotos_cultivo"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'cultivos-fotos');
