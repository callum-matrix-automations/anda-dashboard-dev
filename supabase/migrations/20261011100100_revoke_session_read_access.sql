begin;
-- Restrictive policies preserve each feature's existing permissions, while
-- preventing revoked access JWTs from reading through the direct REST path.
create function public.current_board_session_is_active()
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.sessions
    where user_id=auth.uid() and id::text=auth.jwt()->>'session_id');
$$;
revoke all on function public.current_board_session_is_active() from public,anon;
grant execute on function public.current_board_session_is_active() to authenticated;
do $$
declare table_name text;
begin
  for table_name in select tablename from pg_tables where schemaname='public'
    and rowsecurity and has_table_privilege('authenticated',format('%I.%I',schemaname,tablename),'SELECT')
  loop
    execute format('create policy board_session_required on public.%I as restrictive for select to authenticated using (public.current_board_session_is_active())',table_name);
  end loop;
end;
$$;
commit;
