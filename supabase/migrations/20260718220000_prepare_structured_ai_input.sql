begin;

alter type public.motion_outcome add value if not exists 'TABLED';

alter table public.meetings
  add column duration_minutes integer;

alter table public.meetings
  add constraint meetings_duration_minutes_check
  check (duration_minutes is null or duration_minutes between 1 and 1440);

drop function public.ingest_transcript_webhook(text, text, date, text, text);

create function public.ingest_transcript_webhook(
  p_source_meeting_id text,
  p_title text,
  p_meeting_date date,
  p_duration_minutes integer,
  p_source_transcript_id text,
  p_content text,
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
    '{}'::jsonb
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

comment on function public.ingest_transcript_webhook(text, text, date, integer, text, text, jsonb)
  is 'Atomically creates an AI_PROCESSING meeting, immutable transcript, duration, and matched active attendees.';

revoke execute on function public.ingest_transcript_webhook(text, text, date, integer, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_transcript_webhook(text, text, date, integer, text, text, jsonb)
  to service_role;

grant select on table public.profiles to service_role;
grant select on table public.meeting_attendees to service_role;

commit;
