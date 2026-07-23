begin;

create table public.transcript_import_failures (
  id uuid primary key default gen_random_uuid(),
  source_provider text not null check (btrim(source_provider) <> ''),
  source_meeting_id text not null check (btrim(source_meeting_id) <> ''),
  latest_request_id text,
  title text,
  platform_meeting_id text,
  error_code text not null check (btrim(error_code) <> ''),
  error_message text not null check (btrim(error_message) <> ''),
  attempts integer not null check (attempts >= 0),
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  first_failed_at timestamptz not null,
  last_failed_at timestamptz not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transcript_import_failures_source_key unique (source_provider, source_meeting_id),
  constraint transcript_import_failures_resolution_check check (
    resolved_at is null or resolved_at >= first_failed_at
  )
);

alter table public.transcript_import_failures enable row level security;
revoke all on table public.transcript_import_failures from public, anon, authenticated;
grant select on table public.transcript_import_failures to service_role;

drop function public.ingest_transcript_webhook(text, text, date, integer, text, text, jsonb);

create function public.ingest_transcript_webhook(
  p_source_meeting_id text,
  p_title text,
  p_meeting_date date,
  p_duration_minutes integer,
  p_source_transcript_id text,
  p_content text,
  p_metadata jsonb,
  p_attendees jsonb
)
returns table (
  ingestion_status text,
  meeting_id uuid,
  transcript_id uuid,
  imported_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_source_meeting_id text;
  existing_duration_minutes integer;
  existing_content text;
  stored_meeting_id uuid;
  stored_transcript_id uuid;
  stored_imported_at timestamptz;
  inserted_attendee_count integer;
begin
  if nullif(btrim(p_source_meeting_id), '') is null
    or nullif(btrim(p_source_transcript_id), '') is null
    or nullif(btrim(p_title), '') is null
    or nullif(btrim(p_content), '') is null
    or p_meeting_date is null
    or p_duration_minutes is null
    or p_duration_minutes not between 1 and 1440 then
    raise exception 'Transcript import fields must not be blank and duration must be between 1 and 1440 minutes.'
      using errcode = '22023';
  end if;

  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'Transcript metadata must be a JSON object.'
      using errcode = '22023';
  end if;

  if p_attendees is null or jsonb_typeof(p_attendees) <> 'array' then
    raise exception 'Transcript attendees must be a JSON array.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_attendees) as attendee
      where nullif(attendee ->> 'profile_id', '') is null
        or nullif(btrim(attendee ->> 'display_name_snapshot'), '') is null
  ) then
    raise exception 'Matched transcript attendees require a profile identifier and display name.'
      using errcode = '22023';
  end if;

  select meeting.source_meeting_id, meeting.duration_minutes,
         transcript.meeting_id, transcript.id, transcript.content,
         transcript.imported_at
    into existing_source_meeting_id, existing_duration_minutes,
         stored_meeting_id, stored_transcript_id, existing_content,
         stored_imported_at
    from public.transcripts as transcript
    join public.meetings as meeting on meeting.id = transcript.meeting_id
    where transcript.source_transcript_id = p_source_transcript_id;

  if found then
    if existing_source_meeting_id is distinct from p_source_meeting_id
      or existing_duration_minutes is distinct from p_duration_minutes
      or existing_content is distinct from p_content then
      raise exception 'Source transcript identifier conflicts with immutable evidence.'
        using errcode = '23505';
    end if;

    return query select 'duplicate'::text, stored_meeting_id,
      stored_transcript_id, stored_imported_at;
    return;
  end if;

  select meeting.id
    into stored_meeting_id
    from public.meetings as meeting
    where meeting.source_meeting_id = p_source_meeting_id;

  if found then
    if exists (
      select 1 from public.transcripts as transcript
      where transcript.meeting_id = stored_meeting_id
    ) then
      raise exception 'Source meeting already has a different transcript.'
        using errcode = '23505';
    end if;
  else
    insert into public.meetings (
      source_meeting_id,
      title,
      meeting_date,
      duration_minutes,
      status
    ) values (
      p_source_meeting_id,
      p_title,
      p_meeting_date,
      p_duration_minutes,
      'AI_PROCESSING'
    )
    returning id into stored_meeting_id;
  end if;

  insert into public.transcripts as inserted_transcript (
    meeting_id,
    source_transcript_id,
    content,
    metadata
  ) values (
    stored_meeting_id,
    p_source_transcript_id,
    p_content,
    p_metadata
  )
  returning inserted_transcript.id, inserted_transcript.imported_at
    into stored_transcript_id, stored_imported_at;

  insert into public.meeting_attendees (
    meeting_id,
    profile_id,
    display_name_snapshot
  )
  select stored_meeting_id, profile.id, profile.display_name
    from jsonb_to_recordset(p_attendees) as attendee(
      profile_id uuid,
      display_name_snapshot text
    )
    join public.profiles as profile on profile.id = attendee.profile_id
    where profile.account_type = 'MEMBER'
      and profile.account_status = 'ACTIVE'
      and lower(regexp_replace(btrim(profile.display_name), '\s+', ' ', 'g'))
        = lower(regexp_replace(btrim(attendee.display_name_snapshot), '\s+', ' ', 'g'));

  get diagnostics inserted_attendee_count = row_count;
  if inserted_attendee_count <> jsonb_array_length(p_attendees) then
    raise exception 'One or more matched attendees no longer identify a unique active member profile.'
      using errcode = '23503';
  end if;

  return query select 'received'::text, stored_meeting_id,
    stored_transcript_id, stored_imported_at;
exception
  when unique_violation then
    select meeting.source_meeting_id, meeting.duration_minutes,
           transcript.meeting_id, transcript.id, transcript.content,
           transcript.imported_at
      into existing_source_meeting_id, existing_duration_minutes,
           stored_meeting_id, stored_transcript_id, existing_content,
           stored_imported_at
      from public.transcripts as transcript
      join public.meetings as meeting on meeting.id = transcript.meeting_id
      where transcript.source_transcript_id = p_source_transcript_id;

    if found
      and existing_source_meeting_id = p_source_meeting_id
      and existing_duration_minutes = p_duration_minutes
      and existing_content = p_content then
      return query select 'duplicate'::text, stored_meeting_id,
        stored_transcript_id, stored_imported_at;
      return;
    end if;

    raise;
end;
$$;

create function public.record_transcript_import_failure(
  p_source_provider text,
  p_source_meeting_id text,
  p_request_id text,
  p_title text,
  p_platform_meeting_id text,
  p_error_code text,
  p_error_message text,
  p_attempts integer,
  p_failed_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(p_source_provider), '') is null
    or nullif(btrim(p_source_meeting_id), '') is null
    or nullif(btrim(p_error_code), '') is null
    or nullif(btrim(p_error_message), '') is null
    or p_attempts is null
    or p_attempts < 0
    or p_failed_at is null then
    raise exception 'Transcript import failure fields are invalid.' using errcode = '22023';
  end if;

  insert into public.transcript_import_failures (
    source_provider,
    source_meeting_id,
    latest_request_id,
    title,
    platform_meeting_id,
    error_code,
    error_message,
    attempts,
    first_failed_at,
    last_failed_at
  ) values (
    lower(btrim(p_source_provider)),
    btrim(p_source_meeting_id),
    nullif(btrim(p_request_id), ''),
    nullif(btrim(p_title), ''),
    nullif(btrim(p_platform_meeting_id), ''),
    left(btrim(p_error_code), 200),
    left(btrim(p_error_message), 2000),
    p_attempts,
    p_failed_at,
    p_failed_at
  )
  on conflict (source_provider, source_meeting_id) do update
     set latest_request_id = excluded.latest_request_id,
         title = coalesce(excluded.title, public.transcript_import_failures.title),
         platform_meeting_id = coalesce(
           excluded.platform_meeting_id,
           public.transcript_import_failures.platform_meeting_id
         ),
         error_code = excluded.error_code,
         error_message = excluded.error_message,
         attempts = excluded.attempts,
         occurrence_count = public.transcript_import_failures.occurrence_count + 1,
         last_failed_at = excluded.last_failed_at,
         resolved_at = null,
         updated_at = now();
end;
$$;

create function public.resolve_transcript_import_failure(
  p_source_provider text,
  p_source_meeting_id text,
  p_resolved_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.transcript_import_failures
     set resolved_at = greatest(p_resolved_at, first_failed_at),
         updated_at = now()
   where source_provider = lower(btrim(p_source_provider))
     and source_meeting_id = btrim(p_source_meeting_id)
     and resolved_at is null;
end;
$$;

comment on table public.transcript_import_failures
  is 'Durable, deduplicated alerts for transcript imports that have not yet succeeded.';
comment on function public.ingest_transcript_webhook(text, text, date, integer, text, text, jsonb, jsonb)
  is 'Atomically creates an AI_PROCESSING meeting, immutable transcript with source metadata, and matched attendees.';
comment on function public.record_transcript_import_failure(text, text, text, text, text, text, text, integer, timestamptz)
  is 'Creates or refreshes one unresolved transcript import alert per provider meeting.';
comment on function public.resolve_transcript_import_failure(text, text, timestamptz)
  is 'Resolves an open transcript import alert after a successful or duplicate import.';

revoke execute on function public.ingest_transcript_webhook(text, text, date, integer, text, text, jsonb, jsonb)
  from public, anon, authenticated;
revoke execute on function public.record_transcript_import_failure(text, text, text, text, text, text, text, integer, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.resolve_transcript_import_failure(text, text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.ingest_transcript_webhook(text, text, date, integer, text, text, jsonb, jsonb)
  to service_role;
grant execute on function public.record_transcript_import_failure(text, text, text, text, text, text, text, integer, timestamptz)
  to service_role;
grant execute on function public.resolve_transcript_import_failure(text, text, timestamptz)
  to service_role;

commit;
