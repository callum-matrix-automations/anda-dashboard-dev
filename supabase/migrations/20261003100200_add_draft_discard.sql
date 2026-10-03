begin;
alter table public.meetings add column discarded_at timestamptz,
  add column discarded_by uuid references public.profiles(id) on delete restrict,
  add constraint meetings_discard_pair check ((discarded_at is null) = (discarded_by is null)),
  add constraint meetings_discard_only_draft check (discarded_at is null or
    (status in ('AI_FAILED','PENDING_APPROVAL') and approved_at is null and approved_by is null and signed_at is null));
create index meetings_active_date_idx on public.meetings(meeting_date desc) where discarded_at is null;

create function public.discard_meeting_draft(p_meeting_id uuid, p_expected_version integer, p_actor_profile_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare stored public.meetings%rowtype; returned_version integer;
begin
  select * into stored from public.meetings where id = p_meeting_id for update;
  if not found or stored.discarded_at is not null then
    return jsonb_build_object('status','not_found','meetingId',p_meeting_id,'version',null);
  end if;
  if not public.meeting_actor_can_approve(p_actor_profile_id) then
    return jsonb_build_object('status','forbidden','meetingId',p_meeting_id,'version',stored.version);
  end if;
  if stored.version is distinct from p_expected_version then
    return jsonb_build_object('status','conflict','meetingId',p_meeting_id,'version',stored.version);
  end if;
  if stored.status not in ('AI_FAILED','PENDING_APPROVAL') or stored.approved_at is not null or stored.approved_by is not null then
    return jsonb_build_object('status','protected','meetingId',p_meeting_id,'version',stored.version);
  end if;
  -- History must be appended before the record is frozen. Both writes are atomic.
  insert into public.review_history(meeting_id, actor_profile_id, action) values(p_meeting_id,p_actor_profile_id,'DISCARDED');
  update public.meetings set discarded_at=now(), discarded_by=p_actor_profile_id where id=p_meeting_id returning version into returned_version;
  return jsonb_build_object('status','discarded','meetingId',p_meeting_id,'version',returned_version);
end;
$$;
revoke all on function public.discard_meeting_draft(uuid,integer,uuid) from public, anon, authenticated;
grant execute on function public.discard_meeting_draft(uuid,integer,uuid) to service_role;

-- The meeting row lock serializes discard with all existing workflow RPCs.
-- Freeze evidence and related content too, including late worker results.
create function public.prevent_discarded_meeting_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare parent_id uuid; discarded timestamptz;
begin
  if tg_table_name = 'meetings' then
    if old.discarded_at is not null then raise exception 'Discarded meeting is immutable.' using errcode='55000'; end if;
  else
    if tg_table_name = 'votes' then
      select meeting_id into parent_id from public.motions where id = (case when tg_op='DELETE' then old.motion_id else new.motion_id end);
    else
      parent_id := case when tg_op='DELETE' then old.meeting_id else new.meeting_id end;
    end if;
    select discarded_at into discarded from public.meetings where id=parent_id for update;
    if discarded is not null then raise exception 'Discarded meeting is immutable.' using errcode='55000'; end if;
    -- A related row cannot be moved away from a discarded source meeting.
    if tg_op='UPDATE' then
      if tg_table_name='votes' then select meeting_id into parent_id from public.motions where id=old.motion_id;
      else parent_id := old.meeting_id; end if;
      select discarded_at into discarded from public.meetings where id=parent_id for update;
      if discarded is not null then raise exception 'Discarded meeting is immutable.' using errcode='55000'; end if;
    end if;
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end;
$$;
create trigger meetings_freeze_discarded before update or delete on public.meetings for each row execute function public.prevent_discarded_meeting_write();
create trigger transcripts_freeze_discarded before insert or update or delete on public.transcripts for each row execute function public.prevent_discarded_meeting_write();
create trigger meeting_attendees_freeze_discarded before insert or update or delete on public.meeting_attendees for each row execute function public.prevent_discarded_meeting_write();
create trigger motions_freeze_discarded before insert or update or delete on public.motions for each row execute function public.prevent_discarded_meeting_write();
create trigger votes_freeze_discarded before insert or update or delete on public.votes for each row execute function public.prevent_discarded_meeting_write();
create trigger review_history_freeze_discarded before insert or update or delete on public.review_history for each row execute function public.prevent_discarded_meeting_write();
create trigger meeting_pdfs_freeze_discarded before insert or update or delete on public.meeting_pdfs for each row execute function public.prevent_discarded_meeting_write();
create trigger meeting_signing_requests_freeze_discarded before insert or update or delete on public.meeting_signing_requests for each row execute function public.prevent_discarded_meeting_write();
create trigger transcript_normalizations_freeze_discarded before insert or update or delete on public.transcript_normalizations for each row execute function public.prevent_discarded_meeting_write();
create or replace function public.get_meeting_review(p_meeting_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
  select jsonb_build_object(
    'id', meeting.id,
    'sourceMeetingId', meeting.source_meeting_id,
    'title', meeting.title,
    'category', meeting.category,
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
    'approval', case
      when meeting.approved_at is null then null
      else jsonb_build_object(
        'approvedByProfileId', meeting.approved_by,
        'approvedByDisplayName', approver.display_name,
        'approvedAt', meeting.approved_at,
        'contentVersion', meeting.approved_content_version,
        'unresolvedVotesAcknowledged', meeting.unresolved_votes_acknowledged
      )
    end,
    'pdfArtifact', case
      when unsigned_pdf.id is null then null
      else jsonb_build_object(
        'id', unsigned_pdf.id,
        'path', unsigned_pdf.storage_path,
        'sha256', unsigned_pdf.sha256,
        'sizeBytes', unsigned_pdf.size_bytes,
        'pageCount', unsigned_pdf.page_count,
        'generatedAt', unsigned_pdf.generated_at,
        'documentVersion', unsigned_pdf.document_version
      )
    end,
    'pdfAttempt', meeting.pdf_attempt,
    'updatedAt', meeting.updated_at,
    'tags', to_jsonb(meeting.manual_tags),
    'minutes', meeting.minutes,
    'transcript', (
      select jsonb_build_object(
        'id', transcript.id,
        'sourceTranscriptId', transcript.source_transcript_id,
        'content', transcript.content,
        'metadata', jsonb_set(
          transcript.metadata,
          '{normalization}',
          coalesce(
            (
              select jsonb_build_object(
                'method', normalization.method,
                'detectedFormat', normalization.detected_format,
                'participants', normalization.participants,
                'possibleAliases', normalization.possible_aliases,
                'warnings', normalization.warnings,
                'turnCount', normalization.turn_count,
                'attributionCoverage', normalization.attribution_coverage
              )
                from public.transcript_normalizations as normalization
               where normalization.transcript_id = transcript.id
               order by normalization.version desc
               limit 1
            ),
            transcript.metadata->'normalization',
            '{}'::jsonb
          ),
          true
        ),
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
            'profileId', coalesce(attendee.profile_id, attendee.id), 'linkedProfileId', attendee.profile_id,
            'displayName', attendee.display_name_snapshot,
            'sourceEmailSnapshot', attendee.source_email_snapshot
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
            'moverProfileId', coalesce(mover.profile_id, mover.id),
            'seconderProfileId', coalesce(seconder.profile_id, seconder.id),
            'outcome', case
              when motion.outcome is null then 'unresolved'
              else lower(motion.outcome::text)
            end,
            'votes', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'voteId', vote.id,
                    'profileId', coalesce(voter.profile_id, voter.id),
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
  left join public.profiles as approver on approver.id = meeting.approved_by
  left join public.meeting_pdfs as unsigned_pdf on unsigned_pdf.id = meeting.unsigned_pdf_id
  where meeting.id = p_meeting_id and meeting.discarded_at is null;
$$;
create or replace function public.list_meeting_reviews()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', meeting.id,
        'sourceMeetingId', meeting.source_meeting_id,
        'title', meeting.title,
        'category', meeting.category,
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
        'approval', case
          when meeting.approved_at is null then null
          else jsonb_build_object(
            'approvedByProfileId', meeting.approved_by,
            'approvedByDisplayName', approver.display_name,
            'approvedAt', meeting.approved_at,
            'contentVersion', meeting.approved_content_version,
            'unresolvedVotesAcknowledged', meeting.unresolved_votes_acknowledged
          )
        end,
        'pdfArtifact', case
          when unsigned_pdf.id is null then null
          else jsonb_build_object(
            'id', unsigned_pdf.id,
            'path', unsigned_pdf.storage_path,
            'sha256', unsigned_pdf.sha256,
            'sizeBytes', unsigned_pdf.size_bytes,
            'pageCount', unsigned_pdf.page_count,
            'generatedAt', unsigned_pdf.generated_at,
            'documentVersion', unsigned_pdf.document_version
          )
        end,
        'pdfAttempt', meeting.pdf_attempt,
        'updatedAt', meeting.updated_at
      )
      order by meeting.meeting_date desc, meeting.created_at desc
    ),
    '[]'::jsonb
  )
  from public.meetings as meeting
  left join public.profiles as approver on approver.id = meeting.approved_by
  left join public.meeting_pdfs as unsigned_pdf on unsigned_pdf.id = meeting.unsigned_pdf_id
  where meeting.discarded_at is null;
$$;
create or replace function public.save_meeting_review_draft(p_meeting_id uuid, p_expected_version integer, p_actor_profile_id uuid, p_draft jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
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

  if not found or stored_meeting.discarded_at is not null then
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
create or replace function public.defer_meeting_review(p_meeting_id uuid, p_expected_version integer, p_actor_profile_id uuid, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  stored_meeting public.meetings%rowtype;
  returned_version integer;
begin
  select meeting.* into stored_meeting
    from public.meetings as meeting
   where meeting.id = p_meeting_id
   for update;

  if not found or stored_meeting.discarded_at is not null then
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
create or replace function public.resume_meeting_review(p_meeting_id uuid, p_expected_version integer, p_actor_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  stored_meeting public.meetings%rowtype;
  returned_version integer;
begin
  select meeting.* into stored_meeting
    from public.meetings as meeting
   where meeting.id = p_meeting_id
   for update;

  if not found or stored_meeting.discarded_at is not null then
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
create or replace function public.mark_meeting_ready(p_meeting_id uuid, p_expected_version integer, p_actor_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  stored_meeting public.meetings%rowtype;
  returned_version integer;
begin
  select meeting.* into stored_meeting
    from public.meetings as meeting
   where meeting.id = p_meeting_id
   for update;

  if not found or stored_meeting.discarded_at is not null then
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
create or replace function public.claim_meeting_analysis(p_meeting_id uuid, p_manual_retry boolean DEFAULT false)
 RETURNS TABLE(claim_status text, run_id uuid, attempt_number integer, analysis_input jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  stored_meeting public.meetings%rowtype;
  stored_transcript public.transcripts%rowtype;
  stored_participants jsonb;
  next_run_id uuid;
  next_attempt integer;
begin
  select meeting.*
    into stored_meeting
    from public.meetings as meeting
   where meeting.id = p_meeting_id
   for update;

  if not found or stored_meeting.discarded_at is not null then
    return query select 'not_found'::text, null::uuid, null::integer, null::jsonb;
    return;
  end if;

  if stored_meeting.human_owned or stored_meeting.deferred_at is not null then
    return query select 'protected'::text, null::uuid,
      stored_meeting.analysis_attempt, null::jsonb;
    return;
  end if;

  if stored_meeting.status = 'AI_FAILED' then
    if not p_manual_retry then
      return query select 'retry_required'::text, null::uuid,
        stored_meeting.analysis_attempt, null::jsonb;
      return;
    end if;

    update public.meetings
       set status = 'AI_PROCESSING',
           analysis_attempt = 0,
           analysis_run_id = null,
           analysis_started_at = null,
           last_error_code = null,
           last_error_message = null,
           last_error_at = null,
           version = version + 1
     where id = p_meeting_id
     returning * into stored_meeting;
  elsif stored_meeting.status <> 'AI_PROCESSING' then
    return query select 'already_completed'::text, null::uuid,
      stored_meeting.analysis_attempt, null::jsonb;
    return;
  elsif stored_meeting.analysis_run_id is not null then
    return query select 'already_processing'::text, stored_meeting.analysis_run_id,
      stored_meeting.analysis_attempt, null::jsonb;
    return;
  elsif stored_meeting.analysis_attempt >= 3 then
    return query select 'retry_required'::text, null::uuid,
      stored_meeting.analysis_attempt, null::jsonb;
    return;
  end if;

  select transcript.*
    into stored_transcript
    from public.transcripts as transcript
   where transcript.meeting_id = p_meeting_id;

  if not found then
    raise exception 'Meeting analysis requires a stored source transcript.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'participantRef', coalesce(attendee.profile_id, attendee.id)::text,
        'displayName', attendee.display_name_snapshot
      ) order by attendee.created_at, attendee.id
    ),
    '[]'::jsonb
  )
    into stored_participants
    from public.meeting_attendees as attendee
   where attendee.meeting_id = p_meeting_id;

  next_run_id := gen_random_uuid();
  next_attempt := stored_meeting.analysis_attempt + 1;

  update public.meetings
     set analysis_attempt = next_attempt,
         analysis_run_id = next_run_id,
         analysis_started_at = now(),
         last_error_code = null,
         last_error_message = null,
         last_error_at = null,
         version = version + 1
   where id = p_meeting_id;

  return query
  select
    'claimed'::text,
    next_run_id,
    next_attempt,
    jsonb_build_object(
      'meeting', jsonb_build_object(
        'sourceMeetingId', stored_meeting.source_meeting_id,
        'title', stored_meeting.title,
        'meetingDate', stored_meeting.meeting_date::text,
        'durationMinutes', stored_meeting.duration_minutes
      ),
      'transcript', jsonb_build_object(
        'language', coalesce(nullif(btrim(stored_transcript.metadata->>'language'), ''), 'und'),
        'content', coalesce(
          (
            select normalization.normalized_content
              from public.transcript_normalizations as normalization
             where normalization.transcript_id = stored_transcript.id
             order by normalization.version desc
             limit 1
          ),
          stored_transcript.content
        )
      ),
      'participants', stored_participants
    );
end;
$$;
create or replace function public.renormalize_manual_transcript(p_meeting_id uuid, p_expected_version integer, p_actor_profile_id uuid, p_normalization jsonb, p_attendees jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  stored_meeting public.meetings%rowtype;
  stored_transcript public.transcripts%rowtype;
  next_normalization_version integer;
  returned_version integer;
begin
  select meeting.*
    into stored_meeting
    from public.meetings as meeting
   where meeting.id = p_meeting_id
   for update;

  if not found or stored_meeting.discarded_at is not null then
    return jsonb_build_object('status', 'not_found', 'version', null);
  end if;
  if not public.meeting_review_actor_can_edit(p_actor_profile_id) then
    return jsonb_build_object('status', 'forbidden', 'version', stored_meeting.version);
  end if;
  if stored_meeting.version <> p_expected_version then
    return jsonb_build_object('status', 'conflict', 'version', stored_meeting.version);
  end if;
  if stored_meeting.human_owned
    or stored_meeting.deferred_at is not null
    or stored_meeting.approved_at is not null
    or stored_meeting.status not in ('PENDING_APPROVAL', 'AI_FAILED') then
    return jsonb_build_object('status', 'protected', 'version', stored_meeting.version);
  end if;

  select transcript.*
    into stored_transcript
    from public.transcripts as transcript
   where transcript.meeting_id = p_meeting_id
     and transcript.metadata->>'provider' = 'manual_upload';

  if not found then
    return jsonb_build_object('status', 'protected', 'version', stored_meeting.version);
  end if;

  if p_normalization is null
    or jsonb_typeof(p_normalization) <> 'object'
    or nullif(btrim(p_normalization->>'normalizedContent'), '') is null
    or coalesce(p_normalization->>'originalContentHash', '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_normalization->>'normalizedContentHash', '') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_normalization->'participants') <> 'array'
    or jsonb_typeof(p_normalization->'possibleAliases') <> 'array'
    or jsonb_typeof(p_normalization->'warnings') <> 'array'
    or p_attendees is null
    or jsonb_typeof(p_attendees) <> 'array'
    or jsonb_array_length(p_attendees) = 0 then
    raise exception 'Manual transcript renormalization input is invalid.' using errcode = '22023';
  end if;

  select coalesce(max(normalization.version), 0) + 1
    into next_normalization_version
    from public.transcript_normalizations as normalization
   where normalization.transcript_id = stored_transcript.id;

  insert into public.transcript_normalizations (
    transcript_id,
    meeting_id,
    version,
    method,
    detected_format,
    model,
    response_id,
    request_id,
    original_content_hash,
    normalized_content_hash,
    normalized_content,
    participants,
    possible_aliases,
    warnings,
    turn_count,
    attribution_coverage
  ) values (
    stored_transcript.id,
    p_meeting_id,
    next_normalization_version,
    p_normalization->>'method',
    p_normalization->>'detectedFormat',
    nullif(btrim(p_normalization->>'model'), ''),
    nullif(btrim(p_normalization->>'responseId'), ''),
    nullif(btrim(p_normalization->>'requestId'), ''),
    p_normalization->>'originalContentHash',
    p_normalization->>'normalizedContentHash',
    p_normalization->>'normalizedContent',
    p_normalization->'participants',
    p_normalization->'possibleAliases',
    p_normalization->'warnings',
    (p_normalization->>'turnCount')::integer,
    (p_normalization->>'attributionCoverage')::numeric
  );

  delete from public.motions where meeting_id = p_meeting_id;
  delete from public.meeting_attendees where meeting_id = p_meeting_id;

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
    attendee.source_email_snapshot
  from jsonb_to_recordset(p_attendees) as attendee(
    profile_id uuid,
    display_name_snapshot text,
    source_email_snapshot text
  );

  update public.meetings
     set status = 'AI_PROCESSING',
         minutes = null,
         human_owned = false,
         analysis_attempt = 0,
         analysis_run_id = null,
         analysis_started_at = null,
         last_error_code = null,
         last_error_message = null,
         last_error_at = null,
         version = version + 1
   where id = p_meeting_id
   returning version into returned_version;

  insert into public.review_history (meeting_id, actor_profile_id, action)
  values (p_meeting_id, p_actor_profile_id, 'AI_RETRY');

  return jsonb_build_object('status', 'saved', 'version', returned_version);
end;
$$;
commit;
