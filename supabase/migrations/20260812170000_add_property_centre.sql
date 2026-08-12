begin;

create type public.property_type as enum (
  'SINGLE_FAMILY',
  'MULTIFAMILY',
  'VACANT_LAND'
);

create type public.property_parking_type as enum (
  'NONE',
  'STREET',
  'DRIVEWAY',
  'CARPORT',
  'GARAGE',
  'OTHER'
);

create type public.property_lot_size_unit as enum (
  'SQUARE_FEET',
  'ACRES'
);

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  property_type public.property_type not null,
  address_line_1 text,
  address_line_2 text,
  city text not null check (btrim(city) <> ''),
  state text not null check (state ~ '^[A-Z]{2}$'),
  postal_code text check (postal_code is null or postal_code ~ '^\d{5}(-\d{4})?$'),
  parcel_reference text,
  notes text,
  bedrooms integer check (bedrooms between 0 and 99),
  bathrooms numeric(5, 2) check (bathrooms between 0 and 99),
  square_feet integer check (square_feet between 1 and 10000000),
  year_built integer check (year_built between 1700 and 3000),
  parking_type public.property_parking_type,
  multifamily_subtype text,
  lot_size numeric(16, 4) check (lot_size > 0),
  lot_size_unit public.property_lot_size_unit,
  zoning text,
  land_specifications text,
  version integer not null default 1 check (version > 0),
  created_by uuid not null references public.profiles (id) on delete restrict,
  updated_by uuid not null references public.profiles (id) on delete restrict,
  archived_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint properties_address_identity_check check (
    nullif(btrim(address_line_1), '') is not null
    or (
      property_type = 'VACANT_LAND'
      and nullif(btrim(parcel_reference), '') is not null
    )
  ),
  constraint properties_archive_pair_check check (
    (archived_at is null) = (archived_by is null)
  ),
  constraint properties_lot_size_pair_check check (
    (lot_size is null) = (lot_size_unit is null)
  ),
  constraint properties_type_details_check check (
    (
      property_type = 'SINGLE_FAMILY'
      and multifamily_subtype is null
      and lot_size is null
      and lot_size_unit is null
      and zoning is null
      and land_specifications is null
    )
    or (
      property_type = 'MULTIFAMILY'
      and bedrooms is null
      and bathrooms is null
      and square_feet is null
      and year_built is null
      and parking_type is null
      and lot_size is null
      and lot_size_unit is null
      and zoning is null
      and land_specifications is null
    )
    or (
      property_type = 'VACANT_LAND'
      and bedrooms is null
      and bathrooms is null
      and square_feet is null
      and year_built is null
      and parking_type is null
      and multifamily_subtype is null
    )
  )
);

create table public.property_units (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  label text not null check (btrim(label) <> ''),
  bedrooms integer check (bedrooms between 0 and 99),
  bathrooms numeric(5, 2) check (bathrooms between 0 and 99),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index property_units_unique_label_idx
  on public.property_units (property_id, lower(btrim(label)));

create index property_units_property_sort_idx
  on public.property_units (property_id, sort_order, id);

create table public.property_images (
  id uuid primary key,
  property_id uuid not null references public.properties (id) on delete cascade,
  storage_path text not null unique check (btrim(storage_path) <> ''),
  file_name text not null check (btrim(file_name) <> ''),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index property_images_property_sort_idx
  on public.property_images (property_id, sort_order, id);

create index properties_active_type_updated_idx
  on public.properties (archived_at, property_type, updated_at desc);

create trigger properties_set_updated_at
before update on public.properties
for each row execute function public.set_updated_at();

create trigger property_units_set_updated_at
before update on public.property_units
for each row execute function public.set_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'property-images',
  'property-images',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create function public.current_user_can_access_properties()
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

create function public.format_property_address(
  p_address_line_1 text,
  p_address_line_2 text,
  p_city text,
  p_state text,
  p_postal_code text,
  p_parcel_reference text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select concat_ws(
    ', ',
    coalesce(nullif(btrim(p_address_line_1), ''), 'Parcel ' || nullif(btrim(p_parcel_reference), '')),
    nullif(btrim(p_address_line_2), ''),
    nullif(btrim(p_city), ''),
    nullif(concat_ws(' ', nullif(btrim(p_state), ''), nullif(btrim(p_postal_code), '')), '')
  );
$$;

create function public.property_detail_json(p_property_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', property.id,
    'version', property.version,
    'address', jsonb_build_object(
      'line1', property.address_line_1,
      'line2', property.address_line_2,
      'city', property.city,
      'state', property.state,
      'postalCode', property.postal_code,
      'parcelReference', property.parcel_reference
    ),
    'formattedAddress', public.format_property_address(
      property.address_line_1,
      property.address_line_2,
      property.city,
      property.state,
      property.postal_code,
      property.parcel_reference
    ),
    'notes', property.notes,
    'details', case property.property_type
      when 'SINGLE_FAMILY' then jsonb_build_object(
        'type', 'SINGLE_FAMILY',
        'bedrooms', property.bedrooms,
        'bathrooms', property.bathrooms,
        'squareFeet', property.square_feet,
        'yearBuilt', property.year_built,
        'parkingType', property.parking_type
      )
      when 'MULTIFAMILY' then jsonb_build_object(
        'type', 'MULTIFAMILY',
        'subtype', property.multifamily_subtype,
        'units', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', unit.id,
            'label', unit.label,
            'bedrooms', unit.bedrooms,
            'bathrooms', unit.bathrooms,
            'sortOrder', unit.sort_order
          ) order by unit.sort_order, unit.id)
          from public.property_units as unit
          where unit.property_id = property.id
        ), '[]'::jsonb)
      )
      else jsonb_build_object(
        'type', 'VACANT_LAND',
        'lotSize', case when property.lot_size is null then null else jsonb_build_object(
          'value', property.lot_size,
          'unit', property.lot_size_unit
        ) end,
        'zoning', property.zoning,
        'specifications', property.land_specifications
      )
    end,
    'images', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', image.id,
        'fileName', image.file_name,
        'mimeType', image.mime_type,
        'sizeBytes', image.size_bytes,
        'sortOrder', image.sort_order,
        'createdBy', image.created_by,
        'createdAt', image.created_at,
        'contentUrl', format('/api/properties/%s/images/%s', property.id, image.id)
      ) order by image.sort_order, image.id)
      from public.property_images as image
      where image.property_id = property.id
    ), '[]'::jsonb),
    'createdBy', property.created_by,
    'updatedBy', property.updated_by,
    'createdAt', property.created_at,
    'updatedAt', property.updated_at,
    'archivedBy', property.archived_by,
    'archivedAt', property.archived_at
  )
  from public.properties as property
  where property.id = p_property_id;
$$;

create function public.list_properties(
  p_query text default '',
  p_type public.property_type default null,
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
    raise exception 'The property status filter is invalid.';
  end if;
  if p_limit < 1 or p_limit > 100 or p_offset < 0 then
    raise exception 'The property pagination values are invalid.';
  end if;

  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(public.property_detail_json(filtered.id) order by filtered.updated_at desc, filtered.id)
      from (
        select property.id, property.updated_at
          from public.properties as property
         where (p_type is null or property.property_type = p_type)
           and (
             p_status = 'all'
             or (p_status = 'active' and property.archived_at is null)
             or (p_status = 'archived' and property.archived_at is not null)
           )
           and (
             normalized_query = ''
             or position(normalized_query in lower(concat_ws(
               ' ',
               property.address_line_1,
               property.address_line_2,
               property.city,
               property.state,
               property.postal_code,
               property.parcel_reference
             ))) > 0
           )
         order by property.updated_at desc, property.id
         limit p_limit
        offset p_offset
      ) as filtered
    ), '[]'::jsonb),
    'total', (
      select count(*)
        from public.properties as property
       where (p_type is null or property.property_type = p_type)
         and (
           p_status = 'all'
           or (p_status = 'active' and property.archived_at is null)
           or (p_status = 'archived' and property.archived_at is not null)
         )
         and (
           normalized_query = ''
           or position(normalized_query in lower(concat_ws(
             ' ',
             property.address_line_1,
             property.address_line_2,
             property.city,
             property.state,
             property.postal_code,
             property.parcel_reference
           ))) > 0
         )
    ),
    'limit', p_limit,
    'offset', p_offset,
    'summary', jsonb_build_object(
      'activeTotal', (select count(*) from public.properties where archived_at is null),
      'singleFamily', (select count(*) from public.properties where archived_at is null and property_type = 'SINGLE_FAMILY'),
      'multifamily', (select count(*) from public.properties where archived_at is null and property_type = 'MULTIFAMILY'),
      'vacantLand', (select count(*) from public.properties where archived_at is null and property_type = 'VACANT_LAND'),
      'totalUnits', (
        select count(*)
          from public.property_units as unit
          join public.properties as property on property.id = unit.property_id
         where property.archived_at is null
      ),
      'archivedTotal', (select count(*) from public.properties where archived_at is not null)
    )
  );
end;
$$;

create function public.create_property(p_actor_id uuid, p_property jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_id uuid;
  detail_type public.property_type := (p_property -> 'details' ->> 'type')::public.property_type;
begin
  insert into public.properties (
    property_type,
    address_line_1,
    address_line_2,
    city,
    state,
    postal_code,
    parcel_reference,
    notes,
    bedrooms,
    bathrooms,
    square_feet,
    year_built,
    parking_type,
    multifamily_subtype,
    lot_size,
    lot_size_unit,
    zoning,
    land_specifications,
    created_by,
    updated_by
  ) values (
    detail_type,
    nullif(btrim(p_property -> 'address' ->> 'line1'), ''),
    nullif(btrim(p_property -> 'address' ->> 'line2'), ''),
    btrim(p_property -> 'address' ->> 'city'),
    upper(btrim(p_property -> 'address' ->> 'state')),
    nullif(btrim(p_property -> 'address' ->> 'postalCode'), ''),
    nullif(btrim(p_property -> 'address' ->> 'parcelReference'), ''),
    nullif(btrim(p_property ->> 'notes'), ''),
    case when detail_type = 'SINGLE_FAMILY' then (p_property -> 'details' ->> 'bedrooms')::integer end,
    case when detail_type = 'SINGLE_FAMILY' then (p_property -> 'details' ->> 'bathrooms')::numeric end,
    case when detail_type = 'SINGLE_FAMILY' then (p_property -> 'details' ->> 'squareFeet')::integer end,
    case when detail_type = 'SINGLE_FAMILY' then (p_property -> 'details' ->> 'yearBuilt')::integer end,
    case when detail_type = 'SINGLE_FAMILY' and p_property -> 'details' ->> 'parkingType' is not null
      then (p_property -> 'details' ->> 'parkingType')::public.property_parking_type end,
    case when detail_type = 'MULTIFAMILY' then nullif(btrim(p_property -> 'details' ->> 'subtype'), '') end,
    case when detail_type = 'VACANT_LAND' then (p_property -> 'details' -> 'lotSize' ->> 'value')::numeric end,
    case when detail_type = 'VACANT_LAND' and p_property -> 'details' -> 'lotSize' ->> 'unit' is not null
      then (p_property -> 'details' -> 'lotSize' ->> 'unit')::public.property_lot_size_unit end,
    case when detail_type = 'VACANT_LAND' then nullif(btrim(p_property -> 'details' ->> 'zoning'), '') end,
    case when detail_type = 'VACANT_LAND' then nullif(btrim(p_property -> 'details' ->> 'specifications'), '') end,
    p_actor_id,
    p_actor_id
  ) returning id into created_id;

  if detail_type = 'MULTIFAMILY' then
    insert into public.property_units (property_id, label, bedrooms, bathrooms, sort_order)
    select created_id,
           btrim(unit.value ->> 'label'),
           (unit.value ->> 'bedrooms')::integer,
           (unit.value ->> 'bathrooms')::numeric,
           unit.ordinality - 1
      from jsonb_array_elements(coalesce(p_property -> 'details' -> 'units', '[]'::jsonb))
           with ordinality as unit(value, ordinality);
  end if;

  return public.property_detail_json(created_id);
end;
$$;

create function public.update_property(
  p_property_id uuid,
  p_expected_version integer,
  p_actor_id uuid,
  p_property jsonb,
  p_confirm_unit_removal boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_property public.properties%rowtype;
  detail_type public.property_type := (p_property -> 'details' ->> 'type')::public.property_type;
  removes_units boolean := false;
begin
  select * into stored_property
    from public.properties
   where id = p_property_id
   for update;

  if not found then
    return jsonb_build_object('status', 'not_found', 'version', null);
  end if;
  if stored_property.version <> p_expected_version then
    return jsonb_build_object('status', 'conflict', 'version', stored_property.version);
  end if;
  if stored_property.archived_at is not null then
    return jsonb_build_object('status', 'archived', 'version', stored_property.version);
  end if;

  if stored_property.property_type = 'MULTIFAMILY' then
    removes_units := exists (
      select 1
        from public.property_units as existing_unit
       where existing_unit.property_id = p_property_id
         and (
           detail_type <> 'MULTIFAMILY'
           or not exists (
             select 1
               from jsonb_array_elements(coalesce(p_property -> 'details' -> 'units', '[]'::jsonb)) as next_unit(value)
              where lower(btrim(next_unit.value ->> 'label')) = lower(btrim(existing_unit.label))
           )
         )
    );
  end if;

  if removes_units and not p_confirm_unit_removal then
    return jsonb_build_object('status', 'unit_removal_confirmation_required', 'version', stored_property.version);
  end if;

  update public.properties
     set property_type = detail_type,
         address_line_1 = nullif(btrim(p_property -> 'address' ->> 'line1'), ''),
         address_line_2 = nullif(btrim(p_property -> 'address' ->> 'line2'), ''),
         city = btrim(p_property -> 'address' ->> 'city'),
         state = upper(btrim(p_property -> 'address' ->> 'state')),
         postal_code = nullif(btrim(p_property -> 'address' ->> 'postalCode'), ''),
         parcel_reference = nullif(btrim(p_property -> 'address' ->> 'parcelReference'), ''),
         notes = nullif(btrim(p_property ->> 'notes'), ''),
         bedrooms = case when detail_type = 'SINGLE_FAMILY' then (p_property -> 'details' ->> 'bedrooms')::integer end,
         bathrooms = case when detail_type = 'SINGLE_FAMILY' then (p_property -> 'details' ->> 'bathrooms')::numeric end,
         square_feet = case when detail_type = 'SINGLE_FAMILY' then (p_property -> 'details' ->> 'squareFeet')::integer end,
         year_built = case when detail_type = 'SINGLE_FAMILY' then (p_property -> 'details' ->> 'yearBuilt')::integer end,
         parking_type = case when detail_type = 'SINGLE_FAMILY' and p_property -> 'details' ->> 'parkingType' is not null
           then (p_property -> 'details' ->> 'parkingType')::public.property_parking_type end,
         multifamily_subtype = case when detail_type = 'MULTIFAMILY' then nullif(btrim(p_property -> 'details' ->> 'subtype'), '') end,
         lot_size = case when detail_type = 'VACANT_LAND' then (p_property -> 'details' -> 'lotSize' ->> 'value')::numeric end,
         lot_size_unit = case when detail_type = 'VACANT_LAND' and p_property -> 'details' -> 'lotSize' ->> 'unit' is not null
           then (p_property -> 'details' -> 'lotSize' ->> 'unit')::public.property_lot_size_unit end,
         zoning = case when detail_type = 'VACANT_LAND' then nullif(btrim(p_property -> 'details' ->> 'zoning'), '') end,
         land_specifications = case when detail_type = 'VACANT_LAND' then nullif(btrim(p_property -> 'details' ->> 'specifications'), '') end,
         version = version + 1,
         updated_by = p_actor_id
   where id = p_property_id;

  delete from public.property_units where property_id = p_property_id;
  if detail_type = 'MULTIFAMILY' then
    insert into public.property_units (property_id, label, bedrooms, bathrooms, sort_order)
    select p_property_id,
           btrim(unit.value ->> 'label'),
           (unit.value ->> 'bedrooms')::integer,
           (unit.value ->> 'bathrooms')::numeric,
           unit.ordinality - 1
      from jsonb_array_elements(coalesce(p_property -> 'details' -> 'units', '[]'::jsonb))
           with ordinality as unit(value, ordinality);
  end if;

  return jsonb_build_object('status', 'saved', 'property', public.property_detail_json(p_property_id));
end;
$$;

create function public.set_property_archived(
  p_property_id uuid,
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
  stored_property public.properties%rowtype;
begin
  select * into stored_property
    from public.properties
   where id = p_property_id
   for update;

  if not found then
    return jsonb_build_object('status', 'not_found', 'version', null);
  end if;
  if stored_property.version <> p_expected_version then
    return jsonb_build_object('status', 'conflict', 'version', stored_property.version);
  end if;
  if (p_archived and stored_property.archived_at is not null)
     or (not p_archived and stored_property.archived_at is null) then
    return jsonb_build_object('status', 'invalid_state', 'version', stored_property.version);
  end if;

  update public.properties
     set archived_at = case when p_archived then now() else null end,
         archived_by = case when p_archived then p_actor_id else null end,
         version = version + 1,
         updated_by = p_actor_id
   where id = p_property_id;

  return jsonb_build_object('status', 'saved', 'property', public.property_detail_json(p_property_id));
end;
$$;

create function public.attach_property_image(
  p_property_id uuid,
  p_expected_version integer,
  p_actor_id uuid,
  p_image_id uuid,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_property public.properties%rowtype;
  next_sort_order integer;
  created_at_value timestamptz;
begin
  select * into stored_property
    from public.properties
   where id = p_property_id
   for update;

  if not found then return jsonb_build_object('status', 'not_found', 'version', null); end if;
  if stored_property.version <> p_expected_version then
    return jsonb_build_object('status', 'conflict', 'version', stored_property.version);
  end if;
  if stored_property.archived_at is not null then
    return jsonb_build_object('status', 'archived', 'version', stored_property.version);
  end if;
  if (select count(*) from public.property_images where property_id = p_property_id) >= 10 then
    return jsonb_build_object('status', 'image_limit', 'version', stored_property.version);
  end if;

  select coalesce(max(sort_order) + 1, 0) into next_sort_order
    from public.property_images
   where property_id = p_property_id;

  insert into public.property_images (
    id, property_id, storage_path, file_name, mime_type, size_bytes, sort_order, created_by
  ) values (
    p_image_id, p_property_id, p_storage_path, btrim(p_file_name), p_mime_type, p_size_bytes, next_sort_order, p_actor_id
  ) returning created_at into created_at_value;

  update public.properties
     set version = version + 1,
         updated_by = p_actor_id
   where id = p_property_id;

  return jsonb_build_object(
    'status', 'saved',
    'image', jsonb_build_object(
      'id', p_image_id,
      'fileName', btrim(p_file_name),
      'mimeType', p_mime_type,
      'sizeBytes', p_size_bytes,
      'sortOrder', next_sort_order,
      'createdBy', p_actor_id,
      'createdAt', created_at_value,
      'contentUrl', format('/api/properties/%s/images/%s', p_property_id, p_image_id)
    ),
    'propertyVersion', stored_property.version + 1
  );
end;
$$;

create function public.detach_property_image(
  p_property_id uuid,
  p_image_id uuid,
  p_expected_version integer,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_property public.properties%rowtype;
  stored_path text;
begin
  select * into stored_property
    from public.properties
   where id = p_property_id
   for update;

  if not found then return jsonb_build_object('status', 'not_found', 'version', null); end if;
  if stored_property.version <> p_expected_version then
    return jsonb_build_object('status', 'conflict', 'version', stored_property.version);
  end if;
  if stored_property.archived_at is not null then
    return jsonb_build_object('status', 'archived', 'version', stored_property.version);
  end if;

  delete from public.property_images
   where id = p_image_id and property_id = p_property_id
   returning storage_path into stored_path;

  if stored_path is null then
    return jsonb_build_object('status', 'image_not_found', 'version', stored_property.version);
  end if;

  update public.properties
     set version = version + 1,
         updated_by = p_actor_id
   where id = p_property_id;

  return jsonb_build_object(
    'status', 'saved',
    'storagePath', stored_path,
    'propertyVersion', stored_property.version + 1
  );
end;
$$;

create function public.get_property_image_metadata(p_property_id uuid, p_image_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'storagePath', image.storage_path,
    'fileName', image.file_name,
    'mimeType', image.mime_type,
    'sizeBytes', image.size_bytes
  )
  from public.property_images as image
  where image.property_id = p_property_id
    and image.id = p_image_id;
$$;

alter table public.properties enable row level security;
alter table public.property_units enable row level security;
alter table public.property_images enable row level security;

create policy properties_select_active_members
on public.properties for select to authenticated
using (public.current_user_can_access_properties());

create policy property_units_select_active_members
on public.property_units for select to authenticated
using (
  public.current_user_can_access_properties()
  and exists (select 1 from public.properties where id = property_id)
);

create policy property_images_select_active_members
on public.property_images for select to authenticated
using (
  public.current_user_can_access_properties()
  and exists (select 1 from public.properties where id = property_id)
);

revoke all on table public.properties from anon;
revoke all on table public.property_units from anon;
revoke all on table public.property_images from anon;
grant select on table public.properties to authenticated;
grant select on table public.property_units to authenticated;
grant select on table public.property_images to authenticated;

revoke execute on function public.current_user_can_access_properties() from public;
grant execute on function public.current_user_can_access_properties() to authenticated;

revoke execute on function public.property_detail_json(uuid) from public;
revoke execute on function public.list_properties(text, public.property_type, text, integer, integer) from public;
revoke execute on function public.create_property(uuid, jsonb) from public;
revoke execute on function public.update_property(uuid, integer, uuid, jsonb, boolean) from public;
revoke execute on function public.set_property_archived(uuid, integer, uuid, boolean) from public;
revoke execute on function public.attach_property_image(uuid, integer, uuid, uuid, text, text, text, bigint) from public;
revoke execute on function public.detach_property_image(uuid, uuid, integer, uuid) from public;
revoke execute on function public.get_property_image_metadata(uuid, uuid) from public;

grant execute on function public.property_detail_json(uuid) to service_role;
grant execute on function public.list_properties(text, public.property_type, text, integer, integer) to service_role;
grant execute on function public.create_property(uuid, jsonb) to service_role;
grant execute on function public.update_property(uuid, integer, uuid, jsonb, boolean) to service_role;
grant execute on function public.set_property_archived(uuid, integer, uuid, boolean) to service_role;
grant execute on function public.attach_property_image(uuid, integer, uuid, uuid, text, text, text, bigint) to service_role;
grant execute on function public.detach_property_image(uuid, uuid, integer, uuid) to service_role;
grant execute on function public.get_property_image_metadata(uuid, uuid) to service_role;

commit;
