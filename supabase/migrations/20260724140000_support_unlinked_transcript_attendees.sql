begin;

-- Transcript participants are evidence even when they do not yet correspond to
-- an application account. A profile link is enrichment, not a prerequisite.
alter table public.meeting_attendees
  alter column profile_id drop not null;

create or replace function public.ingest_transcript_webhook(
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
     where nullif(btrim(attendee->>'display_name_snapshot'), '') is null
  ) then
    raise exception 'Transcript attendees require a display name.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_to_recordset(p_attendees) as attendee(
        profile_id uuid,
        display_name_snapshot text,
        source_email_snapshot text
      )
      left join public.profiles as profile on profile.id = attendee.profile_id
     where attendee.profile_id is not null
       and (
         profile.id is null
         or profile.account_type <> 'MEMBER'
         or profile.account_status <> 'ACTIVE'
         or (
           nullif(btrim(attendee.source_email_snapshot), '') is not null
           and profile.email is distinct from lower(btrim(attendee.source_email_snapshot))
         )
         or (
           nullif(btrim(attendee.source_email_snapshot), '') is null
           and lower(regexp_replace(btrim(profile.display_name), '\s+', ' ', 'g'))
             <> lower(regexp_replace(btrim(attendee.display_name_snapshot), '\s+', ' ', 'g'))
         )
       )
  ) then
    raise exception 'A linked transcript attendee no longer matches an active member profile.'
      using errcode = '23503';
  end if;

  if (
    select count(*)
      from jsonb_to_recordset(p_attendees) as attendee(profile_id uuid)
     where attendee.profile_id is not null
  ) <> (
    select count(distinct attendee.profile_id)
      from jsonb_to_recordset(p_attendees) as attendee(profile_id uuid)
     where attendee.profile_id is not null
  ) then
    raise exception 'Transcript attendees contain a duplicate linked profile.'
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
      select 1
        from public.transcripts as transcript
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
  select
    stored_meeting_id,
    attendee.profile_id,
    regexp_replace(btrim(attendee.display_name_snapshot), '\s+', ' ', 'g'),
    lower(nullif(btrim(attendee.source_email_snapshot), ''))
  from jsonb_to_recordset(p_attendees) as attendee(
    profile_id uuid,
    display_name_snapshot text,
    source_email_snapshot text
  );

  get diagnostics inserted_attendee_count = row_count;
  if inserted_attendee_count <> jsonb_array_length(p_attendees) then
    raise exception 'One or more transcript attendees could not be stored.'
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

comment on function public.ingest_transcript_webhook(text, text, date, integer, text, text, jsonb, jsonb)
  is 'Atomically stores a transcript and every source attendee, linking active profiles when available.';

-- Reuse the meeting-attendee row as the participant identity when no profile is
-- linked. Existing linked participants retain their established profile UUID.
do $$
declare
  definition text;
  old_fragment text;
  new_fragment text;
begin
  definition := pg_get_functiondef(
    'public.claim_meeting_analysis(uuid,boolean)'::regprocedure
  );
  old_fragment := '''participantRef'', attendee.profile_id::text';
  new_fragment := '''participantRef'', coalesce(attendee.profile_id, attendee.id)::text';
  if position(old_fragment in definition) = 0 then
    raise exception 'Could not extend claim_meeting_analysis for unlinked attendees.';
  end if;
  execute replace(definition, old_fragment, new_fragment);
end;
$$;

do $$
declare
  definition text;
  old_fragments text[] := array[
    'attendee.profile_id = (draft_attendee->>''participantRef'')::uuid',
    'attendee.profile_id = (draft_motion->''mover''->>''participantRef'')::uuid',
    'attendee.profile_id = (draft_motion->''seconder''->>''participantRef'')::uuid',
    'attendee.profile_id = (draft_vote->>''participantRef'')::uuid'
  ];
  old_fragment text;
begin
  definition := pg_get_functiondef(
    'public.persist_meeting_analysis_draft(uuid,uuid,jsonb)'::regprocedure
  );
  foreach old_fragment in array old_fragments loop
    if position(old_fragment in definition) = 0 then
      raise exception 'Could not extend persist_meeting_analysis_draft for fragment: %', old_fragment;
    end if;
    definition := replace(
      definition,
      old_fragment,
      replace(old_fragment, 'attendee.profile_id', 'coalesce(attendee.profile_id, attendee.id)')
    );
  end loop;
  execute definition;
end;
$$;

-- Existing source attendees can be linked later when a profile with the same
-- current verified email is created.
create or replace function public.resolve_unmatched_transcript_participants(
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

  update public.meeting_attendees as attendee
     set profile_id = profile.id
    from public.profiles as profile
   where attendee.meeting_id = p_meeting_id
     and attendee.profile_id is null
     and attendee.source_email_snapshot is not null
     and profile.email = attendee.source_email_snapshot
     and profile.account_type = 'MEMBER'
     and profile.account_status = 'ACTIVE'
     and not exists (
       select 1
         from public.meeting_attendees as linked
        where linked.meeting_id = p_meeting_id
          and linked.profile_id = profile.id
     );

  get diagnostics resolved_count = row_count;
  return resolved_count;
end;
$$;

-- Human editing keeps source-only attendees and their stable row IDs rather
-- than requiring every selected attendee to be an application profile.
create or replace function public.save_meeting_review_draft(
  p_meeting_id uuid,
  p_expected_version integer,
  p_actor_profile_id uuid,
  p_draft jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_meeting public.meetings%rowtype;
  returned_version integer;
  attendee_count integer;
  selected_attendees jsonb;
  stored_motion_id uuid;
  mover_attendee_id uuid;
  seconder_attendee_id uuid;
  voter_attendee_id uuid;
  motion_payload jsonb;
  vote_payload jsonb;
begin
  select meeting.*
    into stored_meeting
    from public.meetings as meeting
   where meeting.id = p_meeting_id
   for update;

  if not found then
    return jsonb_build_object('status', 'not_found', 'meetingId', p_meeting_id, 'version', null);
  end if;
  if not public.meeting_review_actor_can_edit(p_actor_profile_id) then
    return jsonb_build_object('status', 'forbidden', 'meetingId', p_meeting_id, 'version', stored_meeting.version);
  end if;
  if stored_meeting.version <> p_expected_version then
    return jsonb_build_object('status', 'conflict', 'meetingId', p_meeting_id, 'version', stored_meeting.version);
  end if;
  if stored_meeting.deferred_at is not null
    or stored_meeting.approved_at is not null
    or stored_meeting.status not in ('AI_FAILED', 'PENDING_APPROVAL') then
    return jsonb_build_object('status', 'protected', 'meetingId', p_meeting_id, 'version', stored_meeting.version);
  end if;

  if p_draft is null
    or jsonb_typeof(p_draft) <> 'object'
    or jsonb_typeof(p_draft->'minutes') <> 'object'
    or nullif(btrim(p_draft->'minutes'->>'summary'), '') is null
    or jsonb_typeof(p_draft->'minutes'->'sections') <> 'array'
    or jsonb_array_length(p_draft->'minutes'->'sections') = 0
    or jsonb_typeof(p_draft->'attendeeProfileIds') <> 'array'
    or jsonb_array_length(p_draft->'attendeeProfileIds') = 0
    or jsonb_typeof(p_draft->'motions') <> 'array'
    or jsonb_typeof(p_draft->'tags') <> 'array' then
    raise exception 'Meeting review draft does not match the required structure.' using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_draft->'minutes'->'sections') as section
     where jsonb_typeof(section) <> 'object'
        or nullif(btrim(section->>'heading'), '') is null
        or nullif(btrim(section->>'content'), '') is null
  ) then
    raise exception 'Every minutes section requires a heading and content.' using errcode = '22023';
  end if;

  if jsonb_array_length(p_draft->'attendeeProfileIds') > 250
    or (
      select count(*)
        from jsonb_array_elements_text(p_draft->'attendeeProfileIds') as attendee(participant_id)
    ) <> (
      select count(distinct participant_id)
        from jsonb_array_elements_text(p_draft->'attendeeProfileIds') as attendee(participant_id)
    ) then
    raise exception 'Meeting attendees must be unique and no more than 250.' using errcode = '22023';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', coalesce(existing.id, gen_random_uuid()),
        'profile_id', coalesce(existing.profile_id, profile.id),
        'display_name_snapshot', coalesce(existing.display_name_snapshot, profile.display_name),
        'source_email_snapshot', existing.source_email_snapshot
      )
      order by requested.position
    ),
    '[]'::jsonb
  ), count(coalesce(existing.id, profile.id))
    into selected_attendees, attendee_count
    from jsonb_array_elements_text(p_draft->'attendeeProfileIds')
      with ordinality as requested(participant_id, position)
    left join public.meeting_attendees as existing
      on existing.meeting_id = p_meeting_id
     and coalesce(existing.profile_id, existing.id) = requested.participant_id::uuid
    left join public.profiles as profile
      on profile.id = requested.participant_id::uuid
     and profile.account_type = 'MEMBER'
     and profile.account_status = 'ACTIVE';

  if attendee_count <> jsonb_array_length(p_draft->'attendeeProfileIds') then
    raise exception 'Every attendee must reference an existing source attendee or active member profile.'
      using errcode = '23503';
  end if;

  if jsonb_array_length(p_draft->'tags') > 20
    or exists (
      select 1
        from jsonb_array_elements(p_draft->'tags') as tag
       where jsonb_typeof(tag) <> 'string'
          or nullif(btrim(tag #>> '{}'), '') is null
          or length(btrim(tag #>> '{}')) > 40
    ) then
    raise exception 'Meeting tags must be non-blank, at most 40 characters, and no more than 20.' using errcode = '22023';
  end if;

  if jsonb_array_length(p_draft->'motions') > 250
    or exists (
      select 1
        from jsonb_array_elements(p_draft->'motions') as motion
       where jsonb_typeof(motion) <> 'object'
          or nullif(btrim(motion->>'text'), '') is null
          or motion->>'outcome' not in ('carried', 'failed', 'tabled', 'not_seconded', 'unresolved')
          or jsonb_typeof(motion->'votes') <> 'array'
          or (motion->>'moverProfileId') is not null and not (p_draft->'attendeeProfileIds') ? (motion->>'moverProfileId')
          or (motion->>'seconderProfileId') is not null and not (p_draft->'attendeeProfileIds') ? (motion->>'seconderProfileId')
          or (
            (motion->>'moverProfileId') is not null
            and motion->>'moverProfileId' = motion->>'seconderProfileId'
          )
          or (
            motion->>'outcome' = 'not_seconded'
            and motion->>'seconderProfileId' is not null
          )
    ) then
    raise exception 'Meeting motions contain invalid text, roles, outcomes, or votes.' using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_draft->'motions') as motion
      cross join lateral jsonb_array_elements(motion->'votes') as vote
     where jsonb_typeof(vote) <> 'object'
        or not (p_draft->'attendeeProfileIds') ? (vote->>'profileId')
        or vote->>'selection' not in ('for', 'against', 'abstain', 'unresolved')
  ) or exists (
    select 1
      from jsonb_array_elements(p_draft->'motions') with ordinality as motion(payload, position)
      cross join lateral jsonb_array_elements(motion.payload->'votes') as vote
     group by motion.position, vote->>'profileId'
    having count(*) > 1
  ) then
    raise exception 'Motion votes must reference unique meeting attendees and valid selections.' using errcode = '22023';
  end if;

  delete from public.motions where meeting_id = p_meeting_id;
  delete from public.meeting_attendees where meeting_id = p_meeting_id;

  insert into public.meeting_attendees (
    id,
    meeting_id,
    profile_id,
    display_name_snapshot,
    source_email_snapshot
  )
  select
    attendee.id,
    p_meeting_id,
    attendee.profile_id,
    attendee.display_name_snapshot,
    attendee.source_email_snapshot
  from jsonb_to_recordset(selected_attendees) as attendee(
    id uuid,
    profile_id uuid,
    display_name_snapshot text,
    source_email_snapshot text
  );

  for motion_payload in
    select payload
      from jsonb_array_elements(p_draft->'motions') with ordinality as motion(payload, position)
     order by position
  loop
    mover_attendee_id := null;
    seconder_attendee_id := null;
    if motion_payload->>'moverProfileId' is not null then
      select attendee.id into mover_attendee_id
        from public.meeting_attendees as attendee
       where attendee.meeting_id = p_meeting_id
         and coalesce(attendee.profile_id, attendee.id) = (motion_payload->>'moverProfileId')::uuid;
    end if;
    if motion_payload->>'seconderProfileId' is not null then
      select attendee.id into seconder_attendee_id
        from public.meeting_attendees as attendee
       where attendee.meeting_id = p_meeting_id
         and coalesce(attendee.profile_id, attendee.id) = (motion_payload->>'seconderProfileId')::uuid;
    end if;

    insert into public.motions (
      meeting_id,
      motion_text,
      moved_by_attendee_id,
      seconded_by_attendee_id,
      outcome
    ) values (
      p_meeting_id,
      btrim(motion_payload->>'text'),
      mover_attendee_id,
      seconder_attendee_id,
      case motion_payload->>'outcome'
        when 'carried' then 'CARRIED'::public.motion_outcome
        when 'failed' then 'FAILED'::public.motion_outcome
        when 'tabled' then 'TABLED'::public.motion_outcome
        when 'not_seconded' then 'NOT_SECONDED'::public.motion_outcome
        else null
      end
    ) returning id into stored_motion_id;

    for vote_payload in
      select payload
        from jsonb_array_elements(motion_payload->'votes') with ordinality as vote(payload, position)
       order by position
    loop
      select attendee.id into voter_attendee_id
        from public.meeting_attendees as attendee
       where attendee.meeting_id = p_meeting_id
         and coalesce(attendee.profile_id, attendee.id) = (vote_payload->>'profileId')::uuid;

      insert into public.votes (meeting_id, motion_id, attendee_id, selection)
      values (
        p_meeting_id,
        stored_motion_id,
        voter_attendee_id,
        case vote_payload->>'selection'
          when 'for' then 'FOR'::public.vote_selection
          when 'against' then 'AGAINST'::public.vote_selection
          when 'abstain' then 'ABSTAIN'::public.vote_selection
          else null
        end
      );
    end loop;
  end loop;

  update public.meetings
     set minutes = p_draft->'minutes',
         manual_tags = array(
           select btrim(tag #>> '{}')
             from jsonb_array_elements(p_draft->'tags') with ordinality as requested(tag, position)
            order by position
         ),
         human_owned = true
   where id = p_meeting_id
   returning version into returned_version;

  insert into public.review_history (meeting_id, actor_profile_id, action)
  values (p_meeting_id, p_actor_profile_id, 'EDIT_SAVED');

  return jsonb_build_object('status', 'saved', 'meetingId', p_meeting_id, 'version', returned_version);
end;
$$;

-- Keep existing API and PDF contracts stable: the field is historically named
-- profileId, but for an unlinked participant it carries the attendee row UUID.
do $$
declare
  definition text;
  replacements text[][] := array[
    [
      '''profileId'', attendee.profile_id',
      '''profileId'', coalesce(attendee.profile_id, attendee.id), ''linkedProfileId'', attendee.profile_id'
    ],
    ['''profileId'', voter.profile_id', '''profileId'', coalesce(voter.profile_id, voter.id)'],
    ['''moverProfileId'', mover.profile_id', '''moverProfileId'', coalesce(mover.profile_id, mover.id)'],
    ['''seconderProfileId'', seconder.profile_id', '''seconderProfileId'', coalesce(seconder.profile_id, seconder.id)']
  ];
  replacement text[];
begin
  definition := pg_get_functiondef('public.get_meeting_review(uuid)'::regprocedure);
  foreach replacement slice 1 in array replacements loop
    if position(replacement[1] in definition) = 0 then
      raise exception 'Could not extend get_meeting_review for fragment: %', replacement[1];
    end if;
    definition := replace(definition, replacement[1], replacement[2]);
  end loop;
  execute definition;
end;
$$;

do $$
declare
  definition text;
  replacements text[][] := array[
    ['''profileId'', attendee.profile_id', '''profileId'', coalesce(attendee.profile_id, attendee.id)'],
    ['''profileId'', voter.profile_id', '''profileId'', coalesce(voter.profile_id, voter.id)'],
    ['''moverProfileId'', mover.profile_id', '''moverProfileId'', coalesce(mover.profile_id, mover.id)'],
    ['''seconderProfileId'', seconder.profile_id', '''seconderProfileId'', coalesce(seconder.profile_id, seconder.id)']
  ];
  replacement text[];
begin
  definition := pg_get_functiondef(
    'public.approve_meeting_for_pdf(uuid,integer,uuid,boolean)'::regprocedure
  );
  foreach replacement slice 1 in array replacements loop
    if position(replacement[1] in definition) = 0 then
      raise exception 'Could not extend approve_meeting_for_pdf for fragment: %', replacement[1];
    end if;
    definition := replace(definition, replacement[1], replacement[2]);
  end loop;
  execute definition;
end;
$$;

comment on column public.meeting_attendees.profile_id
  is 'Optional active profile linked to this source attendee; null when the participant has no account match.';

commit;
