-- ============================================================
-- MIGRACIÓN v7 (aditiva, no destructiva): cuatro columnas/tablas nuevas
-- para la tanda de mejoras de septiembre 2026. Como el resto de
-- migraciones de este proyecto, es segura de volver a ejecutar entera
-- (usa "if not exists"/"or replace" en todo) y no toca ninguna fila ya
-- guardada — todo lo nuevo queda en null/vacío hasta que la app lo rellene.
--
-- Ejecutar en: Supabase Dashboard > SQL Editor > New query.
-- ============================================================

-- ------------------------------------------------------------
-- 1) "Ya lo he regado hoy" — espejo exacto de ultima_poda
-- (migracion_v6_poda.sql): permite que marcarCultivoRegado() suprima la
-- recomendación de riego de un cultivo concreto el resto del día, en
-- vez de que cada móvil la siga mostrando aunque el otro ya haya regado
-- (ver riego.js).
-- ------------------------------------------------------------
alter table public.cultivos_huerto add column if not exists ultimo_riego timestamptz;

-- ------------------------------------------------------------
-- 2) Diagnósticos vinculados al cultivo real (no solo a la planta
-- genérica "General"): permite un historial de diagnósticos POR
-- cultivo. Nullable a propósito — un diagnóstico sigue siendo válido
-- sin cultivo asociado (p.ej. una planta del jardín que no está en "Mi
-- huerto"), así que nunca se exige.
-- ------------------------------------------------------------
alter table public.diagnosticos add column if not exists cultivo_id uuid references public.cultivos_huerto(id) on delete set null;

create index if not exists idx_diagnosticos_cultivo_id on public.diagnosticos (cultivo_id);

-- ------------------------------------------------------------
-- 3) Control de concurrencia optimista en cultivos_huerto: dos móviles
-- editando el mismo cultivo casi a la vez ganaba siempre el último
-- guardado, sin ningún aviso de que se había pisado el cambio del otro.
-- `updated_at` se actualiza SOLA en cada UPDATE (vía trigger, no
-- depende de que el cliente se acuerde de mandarla) y la app la manda
-- de vuelta como condición del UPDATE (ver actualizarCultivo en
-- supabase.js): si no coincide, 0 filas se actualizan y la app avisa
-- del conflicto en vez de sobrescribir a ciegas.
-- ------------------------------------------------------------
alter table public.cultivos_huerto add column if not exists updated_at timestamptz not null default now();

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_cultivos_huerto_updated_at on public.cultivos_huerto;
create trigger trg_cultivos_huerto_updated_at
  before update on public.cultivos_huerto
  for each row
  execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 4) Historial de chat del Asistente compartido entre los dos móviles
-- (antes vivía solo en memoria del componente y se perdía al cerrar la
-- pantalla). Mismo patrón de RLS/permisos abierto que el resto del
-- esquema (uso personal, sin login, ver supabase_schema.sql).
-- ------------------------------------------------------------
create table if not exists public.mensajes_asistente (
  id          uuid primary key default gen_random_uuid(),
  rol         text not null check (rol in ('user', 'model')),
  texto       text not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_mensajes_asistente_created_at on public.mensajes_asistente (created_at);

alter table public.mensajes_asistente enable row level security;
grant select, insert, update, delete on public.mensajes_asistente to anon, authenticated;

drop policy if exists "anon_select_mensajes_asistente" on public.mensajes_asistente;
create policy "anon_select_mensajes_asistente" on public.mensajes_asistente for select to anon, authenticated using (true);
drop policy if exists "anon_insert_mensajes_asistente" on public.mensajes_asistente;
create policy "anon_insert_mensajes_asistente" on public.mensajes_asistente for insert to anon, authenticated with check (true);
drop policy if exists "anon_delete_mensajes_asistente" on public.mensajes_asistente;
create policy "anon_delete_mensajes_asistente" on public.mensajes_asistente for delete to anon, authenticated using (true);
