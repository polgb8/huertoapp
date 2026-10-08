-- ============================================================
-- HuertoApp — Esquema de Base de Datos v2 (Supabase / PostgreSQL)
-- Ejecutar completo en: Supabase Dashboard > SQL Editor > New query
-- Es idempotente: puedes volver a ejecutarlo aunque ya tengas datos.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- Tabla: plantas
-- ------------------------------------------------------------
create table if not exists public.plantas (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  ubicacion   text,
  created_at  timestamptz not null default now()
);

-- UNIQUE en nombre: necesario para que el cliente pueda hacer
-- upsert(..., {onConflict:'nombre'}) de forma atómica al obtener/crear
-- la planta "General", evitando filas duplicadas si dos guardados
-- casi simultáneos compiten por crearla (bug real detectado en la
-- auditoría v1, ver AUDITORIA.md).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'plantas_nombre_key') then
    alter table public.plantas add constraint plantas_nombre_key unique (nombre);
  end if;
end $$;

-- ------------------------------------------------------------
-- Tabla: diagnosticos (Módulo A — Escáner)
-- ------------------------------------------------------------
create table if not exists public.diagnosticos (
  id           uuid primary key default gen_random_uuid(),
  planta_id    uuid not null references public.plantas(id) on delete cascade,
  fecha        timestamptz not null default now(),
  estado       text,
  problema     text,
  tratamiento  text
);

create index if not exists idx_diagnosticos_planta_id on public.diagnosticos (planta_id);

-- ------------------------------------------------------------
-- Tabla: cultivos_huerto (Módulos B y C — Planificador / Gestión)
-- ------------------------------------------------------------
create table if not exists public.cultivos_huerto (
  id             uuid primary key default gen_random_uuid(),
  planta_id      uuid references public.plantas(id) on delete cascade,
  nombre         text not null,
  variedad       text,
  fecha_siembra  timestamptz not null default now(),
  dias_cosecha   integer not null default 60,
  distancia_cm   integer,
  asociacion     text,
  instrucciones  text,
  -- estado: 'sembrado' | 'cosechado' | 'perdido'
  estado         text not null default 'sembrado',
  created_at     timestamptz not null default now()
);

create index if not exists idx_cultivos_huerto_estado on public.cultivos_huerto (estado);
create index if not exists idx_cultivos_huerto_planta_id on public.cultivos_huerto (planta_id);

-- ------------------------------------------------------------
-- Row Level Security (RLS) — uso local/personal, sin login (rol "anon")
-- ------------------------------------------------------------
alter table public.plantas          enable row level security;
alter table public.diagnosticos     enable row level security;
alter table public.cultivos_huerto  enable row level security;

-- Nota de la auditoría: se pidió literalmente "GRANT ALL" para anon, pero
-- eso concede también TRUNCATE/REFERENCES/TRIGGER a nivel de tabla — de
-- poco uso para una app y peligroso si la clave anon (pública por diseño
-- en un cliente móvil) queda expuesta. Se concede en su lugar el CRUD
-- completo que la app realmente necesita: SELECT, INSERT, UPDATE, DELETE.
grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on public.plantas         to anon, authenticated;
grant select, insert, update, delete on public.diagnosticos     to anon, authenticated;
grant select, insert, update, delete on public.cultivos_huerto  to anon, authenticated;

-- plantas
drop policy if exists "anon_select_plantas" on public.plantas;
create policy "anon_select_plantas" on public.plantas for select to anon, authenticated using (true);
drop policy if exists "anon_insert_plantas" on public.plantas;
create policy "anon_insert_plantas" on public.plantas for insert to anon, authenticated with check (true);
drop policy if exists "anon_update_plantas" on public.plantas;
create policy "anon_update_plantas" on public.plantas for update to anon, authenticated using (true) with check (true);
drop policy if exists "anon_delete_plantas" on public.plantas;
create policy "anon_delete_plantas" on public.plantas for delete to anon, authenticated using (true);

-- diagnosticos
drop policy if exists "anon_select_diagnosticos" on public.diagnosticos;
create policy "anon_select_diagnosticos" on public.diagnosticos for select to anon, authenticated using (true);
drop policy if exists "anon_insert_diagnosticos" on public.diagnosticos;
create policy "anon_insert_diagnosticos" on public.diagnosticos for insert to anon, authenticated with check (true);
drop policy if exists "anon_update_diagnosticos" on public.diagnosticos;
create policy "anon_update_diagnosticos" on public.diagnosticos for update to anon, authenticated using (true) with check (true);
drop policy if exists "anon_delete_diagnosticos" on public.diagnosticos;
create policy "anon_delete_diagnosticos" on public.diagnosticos for delete to anon, authenticated using (true);

-- cultivos_huerto
drop policy if exists "anon_select_cultivos" on public.cultivos_huerto;
create policy "anon_select_cultivos" on public.cultivos_huerto for select to anon, authenticated using (true);
drop policy if exists "anon_insert_cultivos" on public.cultivos_huerto;
create policy "anon_insert_cultivos" on public.cultivos_huerto for insert to anon, authenticated with check (true);
drop policy if exists "anon_update_cultivos" on public.cultivos_huerto;
create policy "anon_update_cultivos" on public.cultivos_huerto for update to anon, authenticated using (true) with check (true);
drop policy if exists "anon_delete_cultivos" on public.cultivos_huerto;
create policy "anon_delete_cultivos" on public.cultivos_huerto for delete to anon, authenticated using (true);

-- ------------------------------------------------------------
-- Dato inicial: planta "General" para poder guardar diagnósticos y
-- cultivos desde el primer arranque sin fricción. Idempotente gracias
-- al UNIQUE(nombre) + ON CONFLICT.
-- ------------------------------------------------------------
insert into public.plantas (nombre, ubicacion)
values ('General', 'Huerto')
on conflict (nombre) do nothing;

-- ============================================================
-- MIGRACIÓN v3 (aditiva, no destructiva): nuevo esquema de
-- diagnóstico en lenguaje llano + foto en Storage.
-- Las columnas antiguas (estado/problema/tratamiento) se conservan
-- para no perder el historial ya guardado; la app a partir de ahora
-- escribe en las columnas nuevas.
-- ============================================================

alter table public.diagnosticos add column if not exists que_tiene text;
alter table public.diagnosticos add column if not exists que_hacer_hoy jsonb;
alter table public.diagnosticos add column if not exists truco_experto text;
alter table public.diagnosticos add column if not exists alerta_riego_hoy text;
alter table public.diagnosticos add column if not exists dias_para_revisar integer;
alter table public.diagnosticos add column if not exists imagen_url text;

-- ------------------------------------------------------------
-- Supabase Storage: bucket público para las fotos de diagnóstico.
-- Público de lectura (para poder mostrarlas con una URL directa desde
-- el móvil sin firmar cada petición); inserción abierta a anon, igual
-- de permisiva que el resto del esquema (uso personal, sin login).
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('diagnosticos-fotos', 'diagnosticos-fotos', true)
on conflict (id) do nothing;

drop policy if exists "anon_select_fotos_diagnostico" on storage.objects;
create policy "anon_select_fotos_diagnostico"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'diagnosticos-fotos');

drop policy if exists "anon_insert_fotos_diagnostico" on storage.objects;
create policy "anon_insert_fotos_diagnostico"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'diagnosticos-fotos');

-- ============================================================
-- MIGRACIÓN v4 (aditiva, no destructiva): filtro de seguridad para
-- gallinas, calendario/alertas de poda, protocolo de saneamiento
-- post-cosecha.
-- ============================================================

-- Diagnósticos: modo de escaneo + seguridad para gallinas
alter table public.diagnosticos add column if not exists modo text not null default 'plagas';
alter table public.diagnosticos add column if not exists apto_para_gallinas boolean;
alter table public.diagnosticos add column if not exists aviso_gallinas text;

-- Plantas: ventana biológica de poda (mes 1-12; inicio puede ser mayor
-- que fin cuando la ventana cruza el año, p.ej. diciembre-febrero)
alter table public.plantas add column if not exists mes_poda_inicio integer;
alter table public.plantas add column if not exists mes_poda_fin integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'plantas_mes_poda_inicio_check') then
    alter table public.plantas
      add constraint plantas_mes_poda_inicio_check check (mes_poda_inicio between 1 and 12);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'plantas_mes_poda_fin_check') then
    alter table public.plantas
      add constraint plantas_mes_poda_fin_check check (mes_poda_fin between 1 and 12);
  end if;
end $$;

-- Semillas: árboles frecuentes con su ventana de poda tradicional.
-- Añade aquí más filas directamente si tienes otras especies en el huerto
-- (todavía no hay pantalla de gestión de árboles, solo este seed inicial).
insert into public.plantas (nombre, ubicacion, mes_poda_inicio, mes_poda_fin)
values
  ('Limonero', 'Huerto', 3, 4),
  ('Cerezo', 'Huerto', 6, 7),
  ('Granado', 'Huerto', 1, 2)
on conflict (nombre) do update set
  mes_poda_inicio = excluded.mes_poda_inicio,
  mes_poda_fin = excluded.mes_poda_fin;

-- ------------------------------------------------------------
-- Tabla: tareas_huerto — protocolo de saneamiento post-cosecha y
-- futuras tareas generadas automáticamente por la app.
-- ------------------------------------------------------------
create table if not exists public.tareas_huerto (
  id           uuid primary key default gen_random_uuid(),
  tipo         text not null,
  titulo       text not null,
  descripcion  text,
  pasos        jsonb,
  completada   boolean not null default false,
  cultivo_id   uuid references public.cultivos_huerto(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_tareas_huerto_completada on public.tareas_huerto (completada);

alter table public.tareas_huerto enable row level security;
grant select, insert, update, delete on public.tareas_huerto to anon, authenticated;

drop policy if exists "anon_select_tareas" on public.tareas_huerto;
create policy "anon_select_tareas" on public.tareas_huerto for select to anon, authenticated using (true);
drop policy if exists "anon_insert_tareas" on public.tareas_huerto;
create policy "anon_insert_tareas" on public.tareas_huerto for insert to anon, authenticated with check (true);
drop policy if exists "anon_update_tareas" on public.tareas_huerto;
create policy "anon_update_tareas" on public.tareas_huerto for update to anon, authenticated using (true) with check (true);
drop policy if exists "anon_delete_tareas" on public.tareas_huerto;
create policy "anon_delete_tareas" on public.tareas_huerto for delete to anon, authenticated using (true);
