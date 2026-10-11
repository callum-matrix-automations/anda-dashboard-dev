begin;
-- Apply the same revocation guard to existing permitted writes. This grants no
-- additional Property Centre or Financial Records capabilities.
do $$
declare table_name text;
begin
  for table_name in select tablename from pg_tables where schemaname='public' and rowsecurity
    and (has_table_privilege('authenticated',format('%I.%I',schemaname,tablename),'INSERT')
      or has_table_privilege('authenticated',format('%I.%I',schemaname,tablename),'UPDATE')
      or has_table_privilege('authenticated',format('%I.%I',schemaname,tablename),'DELETE'))
  loop
    execute format('create policy board_session_write_required on public.%I as restrictive for all to authenticated using (public.current_board_session_is_active()) with check (public.current_board_session_is_active())',table_name);
  end loop;
end;
$$;
commit;
