-- ============================================================
-- MIGRACIÓN v11 — MULTIUSUARIO (login + datos aislados por usuario)
-- Ejecutar UNA vez, completa, en: Supabase > SQL Editor > New query.
-- Es idempotente (se puede repetir). Ejecútala DESPUÉS de las migraciones
-- anteriores (supabase_schema.sql y migracion_v2 ... v10).
--
-- Qué hace:
--  1) Añade user_id (por defecto = usuario logueado) a las tablas con datos
--     personales.
--  2) Sustituye las políticas abiertas de "anon" por políticas que solo
--     dejan ver/editar las filas propias (user_id = auth.uid()).
--  3) Fotos (Storage): lectura pública por URL, pero solo se puede subir y
--     borrar dentro de la carpeta propia.
--  4) `plantas` (catálogo compartido): solo usuarios logueados.
--
-- IMPORTANTE (datos que ya tenías): las filas antiguas quedan con
-- user_id = NULL y NADIE las ve hasta que las reclames. Mira el bloque
-- final "RECLAMAR DATOS ANTIGUOS".
-- ============================================================

-- 1) Columna user_id en cada tabla personal ---------------------------
do $$
declare t text;
begin
  foreach t in array array['cultivos_huerto','diagnosticos','tareas_huerto','mensajes_asistente','cosechas']
  loop
    if to_regclass('public.' || t) is not null then
      execute format(
        'alter table public.%I add column if not exists user_id uuid default auth.uid() references auth.users(id) on delete cascade',
        t);
      execute format('create index if not exists %I on public.%I (user_id)', 'idx_' || t || '_user_id', t);
      execute format('alter table public.%I enable row level security', t);
    end if;
  end loop;
end $$;

-- 2) Políticas: cada usuario solo ve y toca lo suyo --------------------
do $$
declare t text; p record;
begin
  foreach t in array array['cultivos_huerto','diagnosticos','tareas_huerto','mensajes_asistente','cosechas']
  loop
    if to_regclass('public.' || t) is not null then
      -- Fuera TODAS las políticas anteriores (las abiertas a anon)
      for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
        execute format('drop policy if exists %I on public.%I', p.policyname, t);
      end loop;
      execute format('revoke all on public.%I from anon', t);
      execute format('grant select, insert, update, delete on public.%I to authenticated', t);
      execute format('create policy %I on public.%I for select to authenticated using (user_id = auth.uid())', 'own_select_' || t, t);
      execute format('create policy %I on public.%I for insert to authenticated with check (user_id = auth.uid())', 'own_insert_' || t, t);
      execute format('create policy %I on public.%I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', 'own_update_' || t, t);
      execute format('create policy %I on public.%I for delete to authenticated using (user_id = auth.uid())', 'own_delete_' || t, t);
    end if;
  end loop;
end $$;

-- 3) Catálogo compartido `plantas` (ventanas de poda + fila "General") --
alter table public.plantas enable row level security;
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'plantas' loop
    execute format('drop policy if exists %I on public.plantas', p.policyname);
  end loop;
end $$;
revoke all on public.plantas from anon;
grant select, insert, update on public.plantas to authenticated;
create policy "auth_select_plantas" on public.plantas for select to authenticated using (true);
create policy "auth_insert_plantas" on public.plantas for insert to authenticated with check (true);
create policy "auth_update_plantas" on public.plantas for update to authenticated using (true) with check (true);

-- 4) Storage: carpeta por usuario (<user_id>/archivo.jpg) --------------
do $$
declare b text; p record;
begin
  foreach b in array array['diagnosticos-fotos','cultivos-fotos']
  loop
    if exists (select 1 from storage.buckets where id = b) then
      for p in select policyname from pg_policies
               where schemaname = 'storage' and tablename = 'objects'
                 and (qual ilike '%' || b || '%' or with_check ilike '%' || b || '%') loop
        execute format('drop policy if exists %I on storage.objects', p.policyname);
      end loop;
      execute format('create policy %I on storage.objects for select to anon, authenticated using (bucket_id = %L)', 'fotos_select_' || b, b);
      execute format('create policy %I on storage.objects for insert to authenticated with check (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text)', 'fotos_insert_' || b, b);
      execute format('create policy %I on storage.objects for delete to authenticated using (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text)', 'fotos_delete_' || b, b);
    end if;
  end loop;
end $$;

-- ============================================================
-- RECLAMAR DATOS ANTIGUOS (solo el dueño original, UNA vez)
-- 1. Abre la app y crea tu cuenta (o entra con ella).
-- 2. Sustituye el email de abajo por el de tu cuenta y ejecuta SOLO este
--    bloque (quita los comentarios "--" de las líneas).
-- ============================================================
-- do $$
-- declare uid uuid := (select id from auth.users where email = 'TU_EMAIL@ejemplo.com');
-- begin
--   if uid is null then raise exception 'No existe ese email en auth.users'; end if;
--   update public.cultivos_huerto     set user_id = uid where user_id is null;
--   update public.diagnosticos        set user_id = uid where user_id is null;
--   update public.tareas_huerto       set user_id = uid where user_id is null;
--   update public.mensajes_asistente  set user_id = uid where user_id is null;
--   update public.cosechas            set user_id = uid where user_id is null;
-- end $$;
