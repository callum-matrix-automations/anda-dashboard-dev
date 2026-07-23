begin;

create function public.meeting_review_actor_can_edit(p_actor_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles as profile
     where profile.id = p_actor_profile_id
       and profile.account_type = 'MEMBER'
       and profile.account_status = 'ACTIVE'
       and profile.member_role in ('OFFICER', 'TREASURER')
  );
$$;

create function public.list_meeting_reviews()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', meeting.id,
        'sourceMeetingId', meeting.source_meeting_id,
        'title', meeting.title,
        'meetingDate', meeting.meeting_date::text,
        'durationMinutes', meeting.duration_minutes,
        'status', meeting.status,
        'version', meeting.version,
        'deferredAt', meeting.deferred_at,
        'deferredNote', meeting.deferred_note,
        'humanOwned', meeting.human_owned,
        'failure', case
          when meeting.last_error_code is null then null
          else jsonb_build_object(
            'code', meeting.last_error_code,
            'message', meeting.last_error_message,
            'at', meeting.last_error_at
          )
        end,
        'updatedAt', meeting.updated_at
      )
      order by meeting.meeting_date desc, meeting.created_at desc
    ),
    '[]'::jsonb
  )
  from public.meetings as meeting;
$$;

create function public.get_meeting_review(p_meeting_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', meeting.id,
    'sourceMeetingId', meeting.source_meeting_id,
    'title', meeting.title,
    'meetingDate', meeting.meeting_date::text,
    'durationMinutes', meeting.duration_minutes,
    'status', meeting.status,
    'version', meeting.version,
    'deferredAt', meeting.deferred_at,
    'deferredNote', meeting.deferred_note,
    'humanOwned', meeting.human_owned,
    'failure', case
      when meeting.last_error_code is null then null
      else jsonb_build_object(
        'code', meeting.last_error_code,
        'message', meeting.last_error_message,
        'at', meeting.last_error_at
      )
    end,
    'updatedAt', meeting.updated_at,
    'tags', to_jsonb(meeting.manual_tags),
    'minutes', meeting.minutes,
    'transcript', (
      select jsonb_build_object(
        'id', transcript.id,
        'sourceTranscriptId', transcript.source_transcript_id,
        'content', transcript.content,
        'metadata', transcript.metadata,
        'importedAt', transcript.imported_at
      )
      from public.transcripts as transcript
      where transcript.meeting_id = meeting.id
    ),
    'attendees', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'attendeeId', attendee.id,
            'profileId', attendee.profile_id,
            'displayName', attendee.display_name_snapshot
          )
          order by attendee.display_name_snapshot, attendee.id
        ),
        '[]'::jsonb
      )
      from public.meeting_attendees as attendee
      where attendee.meeting_id = meeting.id
    ),
    'motions', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'motionId', motion.id,
            'text', coalesce(motion.motion_text, ''),
            'moverProfileId', mover.profile_id,
            'seconderProfileId', seconder.profile_id,
            'outcome', case
              when motion.outcome is null then 'unresolved'
              else lower(motion.outcome::text)
            end,
            'votes', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'voteId', vote.id,
                    'profileId', voter.profile_id,
                    'selection', case
                      when vote.selection is null then 'unresolved'
                      else lower(vote.selection::text)
                    end
                  )
                  order by voter.display_name_snapshot, vote.id
                ),
                '[]'::jsonb
              )
              from public.votes as vote
              join public.meeting_attendees as voter
                on voter.id = vote.attendee_id
               and voter.meeting_id = vote.meeting_id
              where vote.motion_id = motion.id
            )
          )
          order by motion.created_at, motion.id
        ),
        '[]'::jsonb
      )
      from public.motions as motion
      left join public.meeting_attendees as mover
        on mover.id = motion.moved_by_attendee_id
       and mover.meeting_id = motion.meeting_id
      left join public.meeting_attendees as seconder
        on seconder.id = motion.seconded_by_attendee_id
       and seconder.meeting_id = motion.meeting_id
      where motion.meeting_id = meeting.id
    ),
    'history', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', history.id,
            'actorProfileId', history.actor_profile_id,
            'actorDisplayName', actor.display_name,
            'action', history.action,
            'note', history.note,
            'createdAt', history.created_at
          )
          order by history.created_at, history.id
        ),
        '[]'::jsonb
      )
      from public.review_history as history
      join public.profiles as actor on actor.id = history.actor_profile_id
      where history.meeting_id = meeting.id
    )
  )
  from public.meetings as meeting
  where meeting.id = p_meeting_id;
$$;

create function public.save_meeting_review_draft(
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
      from jsonb_array_elements_text(p_draft->'attendeeProfileIds') as attendee(profile_id)
    ) <> (
      select count(distinct profile_id)
      from jsonb_array_elements_text(p_draft->'attendeeProfileIds') as attendee(profile_id)
    ) then
    raise exception 'Meeting attendees must be unique and no more than 250.' using errcode = '22023';
  end if;

  select count(*)
    into attendee_count
    from public.profiles as profile
   where profile.id in (
      select profile_id::uuid
      from jsonb_array_elements_text(p_draft->'attendeeProfileIds') as attendee(profile_id)
   )
     and profile.account_type = 'MEMBER'
     and profile.account_status = 'ACTIVE';

  if attendee_count <> jsonb_array_length(p_draft->'attendeeProfileIds') then
    raise exception 'Every attendee must reference an active member profile.' using errcode = '23503';
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
         or motion->>'outcome' not in ('carried', 'failed', 'tabled', 'unresolved')
         or jsonb_typeof(motion->'votes') <> 'array'
         or (motion->>'moverProfileId') is not null and not (p_draft->'attendeeProfileIds') ? (motion->>'moverProfileId')
         or (motion->>'seconderProfileId') is not null and not (p_draft->'attendeeProfileIds') ? (motion->>'seconderProfileId')
         or (
           (motion->>'moverProfileId') is not null
           and motion->>'moverProfileId' = motion->>'seconderProfileId'
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

  insert into public.meeting_attendees (meeting_id, profile_id, display_name_snapshot)
  select p_meeting_id, profile.id, profile.display_name
    from jsonb_array_elements_text(p_draft->'attendeeProfileIds') with ordinality as requested(profile_id, position)
    join public.profiles as profile on profile.id = requested.profile_id::uuid
   order by requested.position;

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
         and attendee.profile_id = (motion_payload->>'moverProfileId')::uuid;
    end if;
    if motion_payload->>'seconderProfileId' is not null then
      select attendee.id into seconder_attendee_id
        from public.meeting_attendees as attendee
       where attendee.meeting_id = p_meeting_id
         and attendee.profile_id = (motion_payload->>'seconderProfileId')::uuid;
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
         and attendee.profile_id = (vote_payload->>'profileId')::uuid;

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

create function public.defer_meeting_review(
  p_meeting_id uuid,
  p_expected_version integer,
  p_actor_profile_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_meeting public.meetings%rowtype;
  returned_version integer;
begin
  select meeting.* into stored_meeting
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
  if nullif(btrim(p_note), '') is null then
    raise exception 'Deferring a meeting requires an explanation.' using errcode = '22023';
  end if;
  if stored_meeting.status not in ('AI_FAILED', 'PENDING_APPROVAL') or stored_meeting.approved_at is not null then
    return jsonb_build_object('status', 'invalid_state', 'meetingId', p_meeting_id, 'version', stored_meeting.version);
  end if;
  if stored_meeting.deferred_at is not null then
    return jsonb_build_object('status', 'protected', 'meetingId', p_meeting_id, 'version', stored_meeting.version);
  end if;

  update public.meetings
     set deferred_at = now(),
         deferred_note = left(btrim(p_note), 2000),
         human_owned = true
   where id = p_meeting_id
   returning version into returned_version;

  insert into public.review_history (meeting_id, actor_profile_id, action, note)
  values (p_meeting_id, p_actor_profile_id, 'DEFERRED', left(btrim(p_note), 2000));

  return jsonb_build_object('status', 'deferred', 'meetingId', p_meeting_id, 'version', returned_version);
end;
$$;

create function public.resume_meeting_review(
  p_meeting_id uuid,
  p_expected_version integer,
  p_actor_profile_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_meeting public.meetings%rowtype;
  returned_version integer;
begin
  select meeting.* into stored_meeting
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
  if stored_meeting.status not in ('AI_FAILED', 'PENDING_APPROVAL') or stored_meeting.approved_at is not null then
    return jsonb_build_object('status', 'invalid_state', 'meetingId', p_meeting_id, 'version', stored_meeting.version);
  end if;
  if stored_meeting.deferred_at is null then
    return jsonb_build_object('status', 'invalid_state', 'meetingId', p_meeting_id, 'version', stored_meeting.version);
  end if;

  update public.meetings
     set deferred_at = null,
         deferred_note = null,
         human_owned = true
   where id = p_meeting_id
   returning version into returned_version;

  insert into public.review_history (meeting_id, actor_profile_id, action)
  values (p_meeting_id, p_actor_profile_id, 'RESUMED');

  return jsonb_build_object('status', 'resumed', 'meetingId', p_meeting_id, 'version', returned_version);
end;
$$;

create function public.mark_meeting_ready(
  p_meeting_id uuid,
  p_expected_version integer,
  p_actor_profile_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_meeting public.meetings%rowtype;
  returned_version integer;
begin
  select meeting.* into stored_meeting
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
  if stored_meeting.deferred_at is not null then
    return jsonb_build_object('status', 'protected', 'meetingId', p_meeting_id, 'version', stored_meeting.version);
  end if;
  if stored_meeting.status <> 'AI_FAILED' or stored_meeting.approved_at is not null then
    return jsonb_build_object('status', 'invalid_state', 'meetingId', p_meeting_id, 'version', stored_meeting.version);
  end if;
  if stored_meeting.minutes is null
    or jsonb_typeof(stored_meeting.minutes) <> 'object'
    or nullif(btrim(stored_meeting.minutes->>'summary'), '') is null
    or jsonb_typeof(stored_meeting.minutes->'sections') <> 'array'
    or jsonb_array_length(stored_meeting.minutes->'sections') = 0
    or not exists (
      select 1 from public.meeting_attendees as attendee where attendee.meeting_id = p_meeting_id
    ) then
    return jsonb_build_object('status', 'invalid_state', 'meetingId', p_meeting_id, 'version', stored_meeting.version);
  end if;

  update public.meetings
     set status = 'PENDING_APPROVAL',
         human_owned = true,
         analysis_run_id = null,
         analysis_started_at = null
   where id = p_meeting_id
   returning version into returned_version;

  insert into public.review_history (meeting_id, actor_profile_id, action)
  values (p_meeting_id, p_actor_profile_id, 'MARKED_READY');

  return jsonb_build_object('status', 'ready', 'meetingId', p_meeting_id, 'version', returned_version);
end;
$$;

comment on function public.list_meeting_reviews()
  is 'Returns backend meeting-list data without exposing direct table access.';
comment on function public.get_meeting_review(uuid)
  is 'Returns the complete human-review meeting aggregate including immutable transcript evidence.';
comment on function public.save_meeting_review_draft(uuid, integer, uuid, jsonb)
  is 'Atomically replaces editable meeting draft content using optimistic version checking.';
comment on function public.defer_meeting_review(uuid, integer, uuid, text)
  is 'Defers human review with a required explanation while preserving lifecycle status.';
comment on function public.resume_meeting_review(uuid, integer, uuid)
  is 'Resumes a deferred human review without changing lifecycle status.';
comment on function public.mark_meeting_ready(uuid, integer, uuid)
  is 'Moves a manually completed AI_FAILED meeting to PENDING_APPROVAL.';

revoke all on function public.meeting_review_actor_can_edit(uuid) from public, anon, authenticated;
revoke all on function public.list_meeting_reviews() from public, anon, authenticated;
revoke all on function public.get_meeting_review(uuid) from public, anon, authenticated;
revoke all on function public.save_meeting_review_draft(uuid, integer, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.defer_meeting_review(uuid, integer, uuid, text) from public, anon, authenticated;
revoke all on function public.resume_meeting_review(uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.mark_meeting_ready(uuid, integer, uuid) from public, anon, authenticated;

grant execute on function public.list_meeting_reviews() to service_role;
grant execute on function public.get_meeting_review(uuid) to service_role;
grant execute on function public.save_meeting_review_draft(uuid, integer, uuid, jsonb) to service_role;
grant execute on function public.defer_meeting_review(uuid, integer, uuid, text) to service_role;
grant execute on function public.resume_meeting_review(uuid, integer, uuid) to service_role;
grant execute on function public.mark_meeting_ready(uuid, integer, uuid) to service_role;

commit;
