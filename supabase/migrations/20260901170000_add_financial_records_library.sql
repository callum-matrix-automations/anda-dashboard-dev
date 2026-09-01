begin;

create table public.financial_folders (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> '' and char_length(btrim(name)) <= 80),
  is_system boolean not null default false,
  sort_order integer not null default 1000 check (sort_order >= 0),
  version integer not null default 1 check (version > 0),
  created_by uuid references public.profiles (id) on delete restrict,
  updated_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_folders_system_actor_check check (
    not is_system or (created_by is null and updated_by is null)
  )
);

create unique index financial_folders_unique_name_idx
  on public.financial_folders (lower(btrim(name)));

create table public.financial_records (
  id uuid primary key,
  folder_id uuid not null references public.financial_folders (id) on delete restrict,
  storage_path text not null unique check (btrim(storage_path) <> ''),
  display_name text not null check (btrim(display_name) <> '' and char_length(btrim(display_name)) <= 180),
  original_file_name text not null check (btrim(original_file_name) <> '' and char_length(btrim(original_file_name)) <= 255),
  mime_type text not null check (mime_type in (
    'application/pdf',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png'
  )),
  size_bytes bigint not null check (size_bytes between 1 and 26214400),
  record_year integer not null check (record_year between 1900 and 2200),
  record_month integer not null check (record_month between 1 and 12),
  description text check (description is null or char_length(description) <= 2000),
  version integer not null default 1 check (version > 0),
  created_by uuid not null references public.profiles (id) on delete restrict,
  updated_by uuid not null references public.profiles (id) on delete restrict,
  archived_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint financial_records_archive_pair_check check (
    (archived_at is null) = (archived_by is null)
  )
);

create index financial_records_folder_period_idx
  on public.financial_records (folder_id, archived_at, record_year desc, record_month desc, updated_at desc);

create index financial_records_status_updated_idx
  on public.financial_records (archived_at, updated_at desc);

create trigger financial_folders_set_updated_at
before update on public.financial_folders
for each row execute function public.set_updated_at();

create trigger financial_records_set_updated_at
before update on public.financial_records
for each row execute function public.set_updated_at();

insert into public.financial_folders (id, name, is_system, sort_order)
values
  ('20240000-0000-4000-8000-000000000024', '2024', true, 0),
  ('20250000-0000-4000-8000-000000000025', '2025', true, 1),
  ('20260000-0000-4000-8000-000000000026', '2026', true, 2)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'financial-records',
  'financial-records',
  false,
  26214400,
  array[
    'application/pdf',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png'
  ]::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create function public.current_user_can_access_financial_records()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles as profile
     where profile.id = auth.uid()
       and profile.account_type = 'MEMBER'
       and profile.account_status = 'ACTIVE'
  );
$$;

create function public.financial_folder_json(p_folder_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', folder.id,
    'name', folder.name,
    'isSystem', folder.is_system,
    'sortOrder', folder.sort_order,
    'version', folder.version,
    'createdBy', folder.created_by,
    'updatedBy', folder.updated_by,
    'createdAt', folder.created_at,
    'updatedAt', folder.updated_at
  )
  from public.financial_folders as folder
  where folder.id = p_folder_id;
$$;

create function public.financial_record_json(p_record_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', record.id,
    'version', record.version,
    'folderId', record.folder_id,
    'displayName', record.display_name,
    'originalFileName', record.original_file_name,
    'mimeType', record.mime_type,
    'sizeBytes', record.size_bytes,
    'recordYear', record.record_year,
    'recordMonth', record.record_month,
    'description', record.description,
    'createdBy', record.created_by,
    'updatedBy', record.updated_by,
    'createdAt', record.created_at,
    'updatedAt', record.updated_at,
    'archivedBy', record.archived_by,
    'archivedAt', record.archived_at,
    'contentUrl', format('/api/financials/records/%s/content', record.id)
  )
  from public.financial_records as record
  where record.id = p_record_id;
$$;

create function public.list_financial_folders()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'folders', coalesce(jsonb_agg(public.financial_folder_json(folder.id)
      order by folder.is_system desc, folder.sort_order, lower(folder.name), folder.id), '[]'::jsonb)
  )
  from public.financial_folders as folder;
$$;

create function public.create_financial_folder(p_actor_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_id uuid;
  normalized_name text := btrim(p_name);
begin
  if exists (
    select 1 from public.financial_folders where lower(btrim(name)) = lower(normalized_name)
  ) then
    return jsonb_build_object('status', 'duplicate');
  end if;

  insert into public.financial_folders (name, created_by, updated_by)
  values (normalized_name, p_actor_id, p_actor_id)
  returning id into created_id;

  return jsonb_build_object('status', 'saved', 'folder', public.financial_folder_json(created_id));
end;
$$;

create function public.update_financial_folder(
  p_folder_id uuid,
  p_expected_version integer,
  p_actor_id uuid,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_folder public.financial_folders%rowtype;
  normalized_name text := btrim(p_name);
begin
  select * into stored_folder
    from public.financial_folders
   where id = p_folder_id
   for update;

  if not found then return jsonb_build_object('status', 'not_found', 'version', null); end if;
  if stored_folder.version <> p_expected_version then
    return jsonb_build_object('status', 'conflict', 'version', stored_folder.version);
  end if;
  if stored_folder.is_system then
    return jsonb_build_object('status', 'system_folder', 'version', stored_folder.version);
  end if;
  if exists (
    select 1 from public.financial_folders
     where id <> p_folder_id and lower(btrim(name)) = lower(normalized_name)
  ) then
    return jsonb_build_object('status', 'duplicate', 'version', stored_folder.version);
  end if;

  update public.financial_folders
     set name = normalized_name,
         version = version + 1,
         updated_by = p_actor_id
   where id = p_folder_id;

  return jsonb_build_object('status', 'saved', 'folder', public.financial_folder_json(p_folder_id));
end;
$$;

create function public.list_financial_records(
  p_query text default '',
  p_folder_id uuid default null,
  p_year integer default null,
  p_month integer default null,
  p_status text default 'active',
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_query text := lower(btrim(coalesce(p_query, '')));
begin
  if p_status not in ('active', 'archived', 'all') then
    raise exception 'The financial record status filter is invalid.';
  end if;
  if p_year is not null and (p_year < 1900 or p_year > 2200) then
    raise exception 'The financial record year is invalid.';
  end if;
  if p_month is not null and (p_month < 1 or p_month > 12) then
    raise exception 'The financial record month is invalid.';
  end if;
  if p_limit < 1 or p_limit > 100 or p_offset < 0 then
    raise exception 'The financial record pagination values are invalid.';
  end if;

  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(public.financial_record_json(filtered.id)
        order by filtered.record_year desc, filtered.record_month desc, filtered.updated_at desc, filtered.id)
      from (
        select record.id, record.record_year, record.record_month, record.updated_at
          from public.financial_records as record
         where (p_folder_id is null or record.folder_id = p_folder_id)
           and (p_year is null or record.record_year = p_year)
           and (p_month is null or record.record_month = p_month)
           and (
             p_status = 'all'
             or (p_status = 'active' and record.archived_at is null)
             or (p_status = 'archived' and record.archived_at is not null)
           )
           and (
             normalized_query = ''
             or position(normalized_query in lower(concat_ws(
               ' ', record.display_name, record.original_file_name, record.description
             ))) > 0
           )
         order by record.record_year desc, record.record_month desc, record.updated_at desc, record.id
         limit p_limit offset p_offset
      ) as filtered
    ), '[]'::jsonb),
    'total', (
      select count(*)
        from public.financial_records as record
       where (p_folder_id is null or record.folder_id = p_folder_id)
         and (p_year is null or record.record_year = p_year)
         and (p_month is null or record.record_month = p_month)
         and (
           p_status = 'all'
           or (p_status = 'active' and record.archived_at is null)
           or (p_status = 'archived' and record.archived_at is not null)
         )
         and (
           normalized_query = ''
           or position(normalized_query in lower(concat_ws(
             ' ', record.display_name, record.original_file_name, record.description
           ))) > 0
         )
    ),
    'limit', p_limit,
    'offset', p_offset,
    'summary', jsonb_build_object(
      'activeTotal', (select count(*) from public.financial_records where archived_at is null),
      'archivedTotal', (select count(*) from public.financial_records where archived_at is not null),
      'activeSizeBytes', coalesce((select sum(size_bytes) from public.financial_records where archived_at is null), 0)
    )
  );
end;
$$;

create function public.attach_financial_record(
  p_record_id uuid,
  p_actor_id uuid,
  p_folder_id uuid,
  p_storage_path text,
  p_display_name text,
  p_original_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_record_year integer,
  p_record_month integer,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_folder public.financial_folders%rowtype;
begin
  select * into stored_folder from public.financial_folders where id = p_folder_id;
  if not found then return jsonb_build_object('status', 'folder_not_found'); end if;
  if stored_folder.is_system and stored_folder.name::integer <> p_record_year then
    return jsonb_build_object('status', 'folder_year_mismatch');
  end if;

  insert into public.financial_records (
    id, folder_id, storage_path, display_name, original_file_name, mime_type,
    size_bytes, record_year, record_month, description, created_by, updated_by
  ) values (
    p_record_id, p_folder_id, p_storage_path, btrim(p_display_name), btrim(p_original_file_name),
    p_mime_type, p_size_bytes, p_record_year, p_record_month,
    nullif(btrim(p_description), ''), p_actor_id, p_actor_id
  );

  return jsonb_build_object('status', 'saved', 'record', public.financial_record_json(p_record_id));
end;
$$;

create function public.update_financial_record(
  p_record_id uuid,
  p_expected_version integer,
  p_actor_id uuid,
  p_record jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_record public.financial_records%rowtype;
  target_folder public.financial_folders%rowtype;
  target_folder_id uuid := (p_record ->> 'folderId')::uuid;
  target_year integer := (p_record ->> 'recordYear')::integer;
begin
  select * into stored_record from public.financial_records where id = p_record_id for update;
  if not found then return jsonb_build_object('status', 'not_found', 'version', null); end if;
  if stored_record.version <> p_expected_version then
    return jsonb_build_object('status', 'conflict', 'version', stored_record.version);
  end if;
  if stored_record.archived_at is not null then
    return jsonb_build_object('status', 'archived', 'version', stored_record.version);
  end if;

  select * into target_folder from public.financial_folders where id = target_folder_id;
  if not found then return jsonb_build_object('status', 'folder_not_found', 'version', stored_record.version); end if;
  if target_folder.is_system and target_folder.name::integer <> target_year then
    return jsonb_build_object('status', 'folder_year_mismatch', 'version', stored_record.version);
  end if;

  update public.financial_records
     set folder_id = target_folder_id,
         display_name = btrim(p_record ->> 'displayName'),
         record_year = target_year,
         record_month = (p_record ->> 'recordMonth')::integer,
         description = nullif(btrim(p_record ->> 'description'), ''),
         version = version + 1,
         updated_by = p_actor_id
   where id = p_record_id;

  return jsonb_build_object('status', 'saved', 'record', public.financial_record_json(p_record_id));
end;
$$;

create function public.set_financial_record_archived(
  p_record_id uuid,
  p_expected_version integer,
  p_actor_id uuid,
  p_archived boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_record public.financial_records%rowtype;
begin
  select * into stored_record from public.financial_records where id = p_record_id for update;
  if not found then return jsonb_build_object('status', 'not_found', 'version', null); end if;
  if stored_record.version <> p_expected_version then
    return jsonb_build_object('status', 'conflict', 'version', stored_record.version);
  end if;
  if (p_archived and stored_record.archived_at is not null)
     or (not p_archived and stored_record.archived_at is null) then
    return jsonb_build_object('status', 'invalid_state', 'version', stored_record.version);
  end if;

  update public.financial_records
     set archived_at = case when p_archived then now() else null end,
         archived_by = case when p_archived then p_actor_id else null end,
         version = version + 1,
         updated_by = p_actor_id
   where id = p_record_id;

  return jsonb_build_object('status', 'saved', 'record', public.financial_record_json(p_record_id));
end;
$$;

create function public.get_financial_record_file_metadata(p_record_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'storagePath', record.storage_path,
    'originalFileName', record.original_file_name,
    'mimeType', record.mime_type,
    'sizeBytes', record.size_bytes
  )
  from public.financial_records as record
  where record.id = p_record_id;
$$;

alter table public.financial_folders enable row level security;
alter table public.financial_records enable row level security;

create policy financial_folders_select_active_members
on public.financial_folders for select to authenticated
using (public.current_user_can_access_financial_records());

create policy financial_records_select_active_members
on public.financial_records for select to authenticated
using (public.current_user_can_access_financial_records());

revoke all on table public.financial_folders from anon;
revoke all on table public.financial_records from anon;
grant select on table public.financial_folders to authenticated;
grant select on table public.financial_records to authenticated;

revoke execute on function public.current_user_can_access_financial_records() from public;
grant execute on function public.current_user_can_access_financial_records() to authenticated;

revoke execute on function public.financial_folder_json(uuid) from public;
revoke execute on function public.financial_record_json(uuid) from public;
revoke execute on function public.list_financial_folders() from public;
revoke execute on function public.create_financial_folder(uuid, text) from public;
revoke execute on function public.update_financial_folder(uuid, integer, uuid, text) from public;
revoke execute on function public.list_financial_records(text, uuid, integer, integer, text, integer, integer) from public;
revoke execute on function public.attach_financial_record(uuid, uuid, uuid, text, text, text, text, bigint, integer, integer, text) from public;
revoke execute on function public.update_financial_record(uuid, integer, uuid, jsonb) from public;
revoke execute on function public.set_financial_record_archived(uuid, integer, uuid, boolean) from public;
revoke execute on function public.get_financial_record_file_metadata(uuid) from public;

grant execute on function public.financial_folder_json(uuid) to service_role;
grant execute on function public.financial_record_json(uuid) to service_role;
grant execute on function public.list_financial_folders() to service_role;
grant execute on function public.create_financial_folder(uuid, text) to service_role;
grant execute on function public.update_financial_folder(uuid, integer, uuid, text) to service_role;
grant execute on function public.list_financial_records(text, uuid, integer, integer, text, integer, integer) to service_role;
grant execute on function public.attach_financial_record(uuid, uuid, uuid, text, text, text, text, bigint, integer, integer, text) to service_role;
grant execute on function public.update_financial_record(uuid, integer, uuid, jsonb) to service_role;
grant execute on function public.set_financial_record_archived(uuid, integer, uuid, boolean) to service_role;
grant execute on function public.get_financial_record_file_metadata(uuid) to service_role;

commit;
