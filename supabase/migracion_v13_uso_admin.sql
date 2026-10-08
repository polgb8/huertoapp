-- ============================================================
-- MIGRACIÓN v13 — El uso del plan gratuito solo para el administrador
-- Ejecutar completa en Supabase > SQL Editor. Idempotente.
-- Devuelve NULL a cualquier usuario que no sea la cuenta admin.
-- ============================================================
create or replace function public.uso_huerto()
returns json
language sql
security definer
set search_path = public, storage, pg_catalog
stable
as $$
  select case
    when lower(coalesce(auth.jwt() ->> 'email', '')) = 'polgaba8@gmail.com' then
      json_build_object(
        'db_bytes', pg_database_size(current_database()),
        'storage_bytes', coalesce((select sum((metadata->>'size')::bigint) from storage.objects), 0)
      )
    else null
  end;
$$;

revoke all on function public.uso_huerto() from public, anon;
grant execute on function public.uso_huerto() to authenticated;
