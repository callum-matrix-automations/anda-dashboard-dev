begin;

create function public.link_manual_transcript_attendees(
  p_meeting_id uuid,
  p_attendees jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  linked_count integer;
begin
  if not exists (
    select 1
      from public.transcripts as transcript
     where transcript.meeting_id = p_meeting_id
       and transcript.metadata->>'provider' = 'manual_upload'
  ) then
    raise exception 'Manual attendee linking requires a manually uploaded transcript.'
      using errcode = '22023';
  end if;

  if p_attendees is null or jsonb_typeof(p_attendees) <> 'array' then
    raise exception 'Manual transcript attendees must be a JSON array.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_attendees) as attendee
     where nullif(attendee->>'profile_id', '') is null
        or nullif(btrim(attendee->>'display_name_snapshot'), '') is null
  ) then
    raise exception 'Manual transcript attendee links require a profile and display name.'
      using errcode = '22023';
  end if;

  if (
    select count(*)
      from jsonb_array_elements(p_attendees)
  ) <> (
    select count(distinct attendee->>'profile_id')
      from jsonb_array_elements(p_attendees) as attendee
  ) then
    raise exception 'Manual transcript attendee links contain duplicate profiles.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_to_recordset(p_attendees) as attendee(
        profile_id uuid,
        display_name_snapshot text
      )
     where not exists (
       select 1
         from public.profiles as profile
        where profile.id = attendee.profile_id
          and profile.account_type = 'MEMBER'
          and profile.account_status = 'ACTIVE'
          and lower(regexp_replace(btrim(profile.display_name), '\s+', ' ', 'g'))
            = lower(regexp_replace(btrim(attendee.display_name_snapshot), '\s+', ' ', 'g'))
     )
  ) then
    raise exception 'A manual transcript speaker no longer matches a unique active member profile.'
      using errcode = '23503';
  end if;

  insert into public.meeting_attendees (
    meeting_id,
    profile_id,
    display_name_snapshot,
    source_email_snapshot
  )
  select
    p_meeting_id,
    attendee.profile_id,
    regexp_replace(btrim(attendee.display_name_snapshot), '\s+', ' ', 'g'),
    null
  from jsonb_to_recordset(p_attendees) as attendee(
    profile_id uuid,
    display_name_snapshot text
  )
  on conflict (meeting_id, profile_id) do nothing;

  select count(*)
    into linked_count
    from public.meeting_attendees
   where meeting_id = p_meeting_id
     and profile_id in (
       select attendee.profile_id
         from jsonb_to_recordset(p_attendees) as attendee(
           profile_id uuid,
           display_name_snapshot text
         )
     );

  if linked_count <> jsonb_array_length(p_attendees) then
    raise exception 'One or more manual transcript attendees could not be linked.'
      using errcode = '23503';
  end if;

  return linked_count;
end;
$$;

comment on function public.link_manual_transcript_attendees(uuid, jsonb)
  is 'Links plain-text manual transcript speakers to unique active member profiles by exact normalized display name.';

revoke execute on function public.link_manual_transcript_attendees(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.link_manual_transcript_attendees(uuid, jsonb)
  to service_role;

commit;
