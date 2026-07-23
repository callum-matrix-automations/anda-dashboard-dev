begin;

alter table public.meetings
  add column analysis_attempt integer not null default 0,
  add column analysis_run_id uuid,
  add column analysis_started_at timestamptz,
  add column human_owned boolean not null default false;

alter table public.meetings
  add constraint meetings_analysis_attempt_check
    check (analysis_attempt between 0 and 3),
  add constraint meetings_analysis_run_pair_check
    check ((analysis_run_id is null) = (analysis_started_at is null)),
  add constraint meetings_analysis_run_status_check
    check (analysis_run_id is null or status = 'AI_PROCESSING');

create index meetings_active_analysis_idx
  on public.meetings (analysis_run_id)
  where analysis_run_id is not null;

create function public.protect_human_owned_meeting()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.human_owned and not new.human_owned then
    raise exception 'Human ownership of meeting content is permanent.';
  end if;

  if current_user = 'authenticated'
    and new.minutes is distinct from old.minutes then
    new.human_owned := true;
  end if;

  return new;
end;
$$;

create trigger meetings_protect_human_owned
before update on public.meetings
for each row execute function public.protect_human_owned_meeting();

create function public.mark_related_meeting_human_owned()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_meeting_id uuid;
begin
  if current_user <> 'authenticated' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  target_meeting_id := case when tg_op = 'DELETE' then old.meeting_id else new.meeting_id end;
  update public.meetings
     set human_owned = true
   where id = target_meeting_id
     and not human_owned;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger meeting_attendees_mark_human_owned
after insert or update or delete on public.meeting_attendees
for each row execute function public.mark_related_meeting_human_owned();

create trigger motions_mark_human_owned
after insert or update or delete on public.motions
for each row execute function public.mark_related_meeting_human_owned();

create trigger votes_mark_human_owned
after insert or update or delete on public.votes
for each row execute function public.mark_related_meeting_human_owned();

create function public.claim_meeting_analysis(
  p_meeting_id uuid,
  p_manual_retry boolean default false
)
returns table (
  claim_status text,
  run_id uuid,
  attempt_number integer,
  analysis_input jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
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

  if not found then
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
        'participantRef', attendee.profile_id::text,
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
        'content', stored_transcript.content
      ),
      'participants', stored_participants
    );
end;
$$;

create function public.persist_meeting_analysis_draft(
  p_meeting_id uuid,
  p_run_id uuid,
  p_draft jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_meeting public.meetings%rowtype;
  draft_motion jsonb;
  draft_vote jsonb;
  stored_motion_id uuid;
  mover_attendee_id uuid;
  seconder_attendee_id uuid;
  voter_attendee_id uuid;
  stored_outcome public.motion_outcome;
  stored_selection public.vote_selection;
begin
  select meeting.*
    into stored_meeting
    from public.meetings as meeting
   where meeting.id = p_meeting_id
   for update;

  if not found then
    return 'not_found';
  end if;
  if stored_meeting.human_owned then
    return 'protected';
  end if;
  if stored_meeting.status <> 'AI_PROCESSING'
    or stored_meeting.analysis_run_id is distinct from p_run_id then
    return 'stale';
  end if;

  if jsonb_typeof(p_draft) <> 'object'
    or p_draft->>'schemaVersion' <> '1.0'
    or jsonb_typeof(p_draft->'minutes') <> 'object'
    or jsonb_typeof(p_draft->'attendees') <> 'array'
    or jsonb_typeof(p_draft->'motions') <> 'array' then
    raise exception 'Meeting analysis draft does not match the persistence contract.';
  end if;

  if jsonb_array_length(p_draft->'attendees') <>
      (select count(*) from public.meeting_attendees where meeting_id = p_meeting_id)
    or exists (
      select 1
        from jsonb_array_elements(p_draft->'attendees') as draft_attendee
       where not exists (
         select 1
           from public.meeting_attendees as attendee
          where attendee.meeting_id = p_meeting_id
            and attendee.profile_id = (draft_attendee->>'participantRef')::uuid
            and attendee.display_name_snapshot = draft_attendee->>'displayName'
       )
    ) then
    raise exception 'Meeting analysis attendees do not match the stored meeting attendees.';
  end if;

  delete from public.motions where meeting_id = p_meeting_id;

  for draft_motion in
    select value from jsonb_array_elements(p_draft->'motions')
  loop
    mover_attendee_id := null;
    seconder_attendee_id := null;

    if draft_motion->'mover'->>'status' = 'resolved' then
      select attendee.id
        into mover_attendee_id
        from public.meeting_attendees as attendee
       where attendee.meeting_id = p_meeting_id
         and attendee.profile_id = (draft_motion->'mover'->>'participantRef')::uuid;
      if mover_attendee_id is null then
        raise exception 'Resolved motion mover is not a stored meeting attendee.';
      end if;
    end if;

    if draft_motion->'seconder'->>'status' = 'resolved' then
      select attendee.id
        into seconder_attendee_id
        from public.meeting_attendees as attendee
       where attendee.meeting_id = p_meeting_id
         and attendee.profile_id = (draft_motion->'seconder'->>'participantRef')::uuid;
      if seconder_attendee_id is null then
        raise exception 'Resolved motion seconder is not a stored meeting attendee.';
      end if;
    end if;

    stored_outcome := case draft_motion->>'outcome'
      when 'unresolved' then null
      else upper(draft_motion->>'outcome')::public.motion_outcome
    end;

    insert into public.motions (
      meeting_id,
      motion_text,
      moved_by_attendee_id,
      seconded_by_attendee_id,
      outcome
    ) values (
      p_meeting_id,
      draft_motion->>'text',
      mover_attendee_id,
      seconder_attendee_id,
      stored_outcome
    ) returning id into stored_motion_id;

    for draft_vote in
      select value from jsonb_array_elements(draft_motion->'votes')
    loop
      select attendee.id
        into voter_attendee_id
        from public.meeting_attendees as attendee
       where attendee.meeting_id = p_meeting_id
         and attendee.profile_id = (draft_vote->>'participantRef')::uuid;
      if voter_attendee_id is null then
        raise exception 'Motion vote references an unknown meeting attendee.';
      end if;

      stored_selection := case draft_vote->>'value'
        when 'unresolved' then null
        else upper(draft_vote->>'value')::public.vote_selection
      end;

      insert into public.votes (
        meeting_id,
        motion_id,
        attendee_id,
        selection
      ) values (
        p_meeting_id,
        stored_motion_id,
        voter_attendee_id,
        stored_selection
      );
    end loop;
  end loop;

  update public.meetings
     set minutes = p_draft->'minutes',
         status = 'PENDING_APPROVAL',
         analysis_run_id = null,
         analysis_started_at = null,
         last_error_code = null,
         last_error_message = null,
         last_error_at = null,
         version = version + 1
   where id = p_meeting_id;

  return 'saved';
end;
$$;

create function public.record_meeting_analysis_failure(
  p_meeting_id uuid,
  p_run_id uuid,
  p_error_code text,
  p_error_message text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_meeting public.meetings%rowtype;
  terminal_failure boolean;
begin
  select meeting.*
    into stored_meeting
    from public.meetings as meeting
   where meeting.id = p_meeting_id
   for update;

  if not found then
    return 'not_found';
  end if;
  if stored_meeting.human_owned then
    return 'protected';
  end if;
  if stored_meeting.status <> 'AI_PROCESSING'
    or stored_meeting.analysis_run_id is distinct from p_run_id then
    return 'stale';
  end if;

  terminal_failure := stored_meeting.analysis_attempt >= 3;

  update public.meetings
     set status = case when terminal_failure then 'AI_FAILED'::public.meeting_status else status end,
         analysis_run_id = null,
         analysis_started_at = null,
         last_error_code = left(coalesce(nullif(btrim(p_error_code), ''), 'analysis_failed'), 200),
         last_error_message = left(coalesce(nullif(btrim(p_error_message), ''), 'Meeting analysis failed.'), 1000),
         last_error_at = now(),
         version = version + 1
   where id = p_meeting_id;

  return case when terminal_failure then 'failed' else 'retry_scheduled' end;
end;
$$;

create function public.mark_meeting_human_owned(p_meeting_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.meetings
     set human_owned = true,
         version = version + 1
   where id = p_meeting_id
     and not human_owned;

  if found then
    return 'marked';
  end if;
  if exists (select 1 from public.meetings where id = p_meeting_id) then
    return 'marked';
  end if;
  return 'not_found';
end;
$$;

comment on function public.claim_meeting_analysis(uuid, boolean)
  is 'Atomically claims one of three AI analysis attempts and returns immutable analysis input.';
comment on function public.persist_meeting_analysis_draft(uuid, uuid, jsonb)
  is 'Atomically stores a validated AI draft and moves its meeting to PENDING_APPROVAL.';
comment on function public.record_meeting_analysis_failure(uuid, uuid, text, text)
  is 'Records a token-guarded AI failure and moves the third failed attempt to AI_FAILED.';
comment on function public.mark_meeting_human_owned(uuid)
  is 'Permanently marks meeting content as human-owned before a server-side edit.';

revoke all on function public.claim_meeting_analysis(uuid, boolean) from public, anon, authenticated;
revoke all on function public.persist_meeting_analysis_draft(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.record_meeting_analysis_failure(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.mark_meeting_human_owned(uuid) from public, anon, authenticated;

grant execute on function public.claim_meeting_analysis(uuid, boolean) to service_role;
grant execute on function public.persist_meeting_analysis_draft(uuid, uuid, jsonb) to service_role;
grant execute on function public.record_meeting_analysis_failure(uuid, uuid, text, text) to service_role;
grant execute on function public.mark_meeting_human_owned(uuid) to service_role;

grant select on table public.motions to service_role;
grant select on table public.votes to service_role;

commit;
