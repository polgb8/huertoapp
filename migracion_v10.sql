-- ============================================================
-- MIGRACIÓN v10 (aditiva, no destructiva) — septiembre 2026
--  1) tipo_suelo por cultivo (arenoso | franco | arcilloso): lo estima
--     la IA con la foto al añadir la planta; ajusta la frecuencia de riego.
--  2) Tabla `cosechas`: registrar kilos cosechados de plantas perennes
--     (frutales, aromáticas…) sin sacarlas del huerto.
-- Opcional: sin ella la app guarda estos datos solo en el móvil.
-- Ejecutar en: Supabase Dashboard > SQL Editor > New query.
-- ============================================================
alter table public.cultivos_huerto add column if not exists tipo_suelo text;

create table if not exists public.cosechas (
  id          uuid primary key default gen_random_uuid(),
  cultivo_id  uuid references public.cultivos_huerto(id) on delete cascade,
  kg          numeric not null check (kg >= 0),
  nota        text,
  fecha       timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create index if not exists idx_cosechas_cultivo on public.cosechas (cultivo_id, fecha desc);

alter table public.cosechas enable row level security;
grant select, insert, update, delete on public.cosechas to anon, authenticated;
drop policy if exists "anon_select_cosechas" on public.cosechas;
create policy "anon_select_cosechas" on public.cosechas for select to anon, authenticated using (true);
drop policy if exists "anon_insert_cosechas" on public.cosechas;
create policy "anon_insert_cosechas" on public.cosechas for insert to anon, authenticated with check (true);
drop policy if exists "anon_delete_cosechas" on public.cosechas;
create policy "anon_delete_cosechas" on public.cosechas for delete to anon, authenticated using (true);
