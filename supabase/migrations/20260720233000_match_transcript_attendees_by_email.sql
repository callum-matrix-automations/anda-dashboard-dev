begin;

alter table public.profiles
  add column email text;

update public.profiles as profile
   set email = lower(btrim(auth_user.email))
  from auth.users as auth_user
 where auth_user.id = profile.id
   and auth_user.email_confirmed_at is not null
   and nullif(btrim(auth_user.email), '') is not null;

alter table public.profiles
  add constraint profiles_email_normalized_check check (
    email is null
    or (
      email = lower(btrim(email))
      and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  );

create unique index profiles_current_email_key
  on public.profiles (email)
  where email is not null;

create function public.normalize_profile_email()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.email := lower(nullif(btrim(new.email), ''));
  return new;
end;
$$;

create trigger profiles_normalize_email
before insert or update of email on public.profiles
for each row execute function public.normalize_profile_email();

create function public.protect_verified_profile_email()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and new.email is distinct from old.email then
    raise exception 'Verified profile emails can only be changed by a trusted server operation.';
  end if;
  return new;
end;
$$;

create trigger profiles_protect_verified_email
before update of email on public.profiles
for each row execute function public.protect_verified_profile_email();

alter table public.meeting_attendees
  add column source_email_snapshot text,
  add constraint meeting_attendees_source_email_normalized_check check (
    source_email_snapshot is null
    or (
      source_email_snapshot = lower(btrim(source_email_snapshot))
      and source_email_snapshot ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  );

create function public.protect_meeting_attendee_source_email()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' and new.source_email_snapshot is not null then
      raise exception 'Transcript source email snapshots can only be set by a trusted server operation.';
    end if;
    if tg_op = 'UPDATE'
      and new.source_email_snapshot is distinct from old.source_email_snapshot then
      raise exception 'Transcript source email snapshots are immutable.';
    end if;
  end if;
  return new;
end;
$$;

create trigger meeting_attendees_protect_source_email
before insert or update of source_email_snapshot on public.meeting_attendees
for each row execute function public.protect_meeting_attendee_source_email();

drop function public.ingest_transcript_webhook(text, text, date, integer, text, text, jsonb, jsonb);

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
        or nullif(btrim(attendee ->> 'source_email_snapshot'), '') is null
  ) then
    raise exception 'Matched transcript attendees require a profile, display name, and source email.'
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
    display_name_snapshot,
    source_email_snapshot
  )
  select stored_meeting_id,
         profile.id,
         regexp_replace(btrim(attendee.display_name_snapshot), '\s+', ' ', 'g'),
         lower(btrim(attendee.source_email_snapshot))
    from jsonb_to_recordset(p_attendees) as attendee(
      profile_id uuid,
      display_name_snapshot text,
      source_email_snapshot text
    )
    join public.profiles as profile on profile.id = attendee.profile_id
    where profile.account_type = 'MEMBER'
      and profile.account_status = 'ACTIVE'
      and profile.email = lower(btrim(attendee.source_email_snapshot));

  get diagnostics inserted_attendee_count = row_count;
  if inserted_attendee_count <> jsonb_array_length(p_attendees) then
    raise exception 'One or more transcript attendees no longer match a unique active profile email.'
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

create function public.resolve_unmatched_transcript_participants(
  p_meeting_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_count integer;
begin
  if not exists (
    select 1 from public.meetings as meeting where meeting.id = p_meeting_id
  ) then
    raise exception 'Meeting was not found.' using errcode = 'P0002';
  end if;

  with source_participants as (
    select participant.value,
           participant.position
      from public.transcripts as transcript
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(transcript.metadata->'participants') = 'array'
            then transcript.metadata->'participants'
          else '[]'::jsonb
        end
      ) with ordinality as participant(value, position)
     where transcript.meeting_id = p_meeting_id
       and transcript.metadata->>'provider' = 'read_ai'
  ), resolved_profiles as (
    select distinct on (profile.id)
           profile.id as profile_id,
           regexp_replace(btrim(source.value->>'name'), '\s+', ' ', 'g') as display_name_snapshot,
           lower(btrim(source.value->>'email')) as source_email_snapshot
      from source_participants as source
      join public.profiles as profile
        on profile.email = lower(btrim(source.value->>'email'))
       and profile.account_type = 'MEMBER'
       and profile.account_status = 'ACTIVE'
     where nullif(btrim(source.value->>'name'), '') is not null
       and nullif(btrim(source.value->>'email'), '') is not null
     order by profile.id, source.position
  )
  insert into public.meeting_attendees as attendee (
    meeting_id,
    profile_id,
    display_name_snapshot,
    source_email_snapshot
  )
  select p_meeting_id,
         resolved.profile_id,
         resolved.display_name_snapshot,
         resolved.source_email_snapshot
    from resolved_profiles as resolved
  on conflict (meeting_id, profile_id) do update
     set source_email_snapshot = excluded.source_email_snapshot
   where attendee.source_email_snapshot is null;

  get diagnostics resolved_count = row_count;
  return resolved_count;
end;
$$;

comment on column public.profiles.email
  is 'Current normalized verified email used for exact transcript participant matching.';
comment on column public.meeting_attendees.source_email_snapshot
  is 'Normalized Read AI participant email that established the profile association.';
comment on function public.ingest_transcript_webhook(text, text, date, integer, text, text, jsonb, jsonb)
  is 'Atomically stores a transcript and creates meeting attendees only for verified current-email matches.';
comment on function public.resolve_unmatched_transcript_participants(uuid)
  is 'Idempotently rechecks Read AI transcript metadata against current active profile emails.';

revoke execute on function public.ingest_transcript_webhook(text, text, date, integer, text, text, jsonb, jsonb)
  from public, anon, authenticated;
revoke execute on function public.resolve_unmatched_transcript_participants(uuid)
  from public, anon, authenticated;

grant execute on function public.ingest_transcript_webhook(text, text, date, integer, text, text, jsonb, jsonb)
  to service_role;
grant execute on function public.resolve_unmatched_transcript_participants(uuid)
  to service_role;
grant insert, update on table public.profiles to service_role;

commit;
