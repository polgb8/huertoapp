-- ============================================================
-- MIGRACIÓN v12 — Uso del plan gratuito de Supabase (solo lectura)
-- Función que la app llama para avisar cuando la base de datos o las
-- fotos se acercan al límite del plan Free (500 MB / 1 GB).
-- Devuelve solo totales (nunca datos de otros usuarios). Idempotente.
-- ============================================================
create or replace function public.uso_huerto()
returns json
language sql
security definer
set search_path = public, storage, pg_catalog
stable
as $$
  select json_build_object(
    'db_bytes', pg_database_size(current_database()),
    'storage_bytes', coalesce((select sum((metadata->>'size')::bigint) from storage.objects), 0)
  );
$$;

revoke all on function public.uso_huerto() from public, anon;
grant execute on function public.uso_huerto() to authenticated;
