begin;
alter table public.profiles
  add column signing_first_name text check (signing_first_name is null or length(btrim(signing_first_name)) between 1 and 200),
  add column signing_last_name text check (signing_last_name is null or length(btrim(signing_last_name)) between 1 and 200);

-- Provisioning is operator-only. Historical superadmin/admin records are retained,
-- but cannot sign in through the application and confer no app permissions.
revoke all on public.profiles, public.meetings, public.transcripts,
  public.meeting_attendees, public.motions, public.votes, public.review_history from authenticated, anon;
grant select on public.profiles, public.meetings, public.transcripts,
  public.meeting_attendees, public.motions, public.votes, public.review_history to authenticated;
-- service_role used to inherit some grants from authenticated. Preserve explicit
-- trusted backend/operator access when removing that browser write path.
grant all on public.profiles, public.meetings, public.transcripts,
  public.meeting_attendees, public.motions, public.votes, public.review_history to service_role;
revoke execute on function public.transfer_treasurer(uuid) from public, authenticated, anon;
drop policy profiles_select_self_or_manager on public.profiles;
create policy profiles_select_self_or_manager on public.profiles for select to authenticated
  using (id = auth.uid() and account_type = 'MEMBER' and account_status = 'ACTIVE');
create or replace function public.meeting_review_actor_can_edit(p_actor_profile_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
  select exists (
    select 1
      from public.profiles as profile
     where profile.id = p_actor_profile_id
       and profile.account_type = 'MEMBER'
       and profile.account_status = 'ACTIVE'
       and profile.member_role in ('USER', 'OFFICER', 'TREASURER')
  );
$$;
create function public.meeting_actor_can_approve(p_actor_profile_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = p_actor_profile_id
    and account_type = 'MEMBER' and account_status = 'ACTIVE' and member_role in ('OFFICER','TREASURER'));
$$;
revoke all on function public.meeting_actor_can_approve(uuid) from public, anon, authenticated;
grant execute on function public.meeting_actor_can_approve(uuid) to service_role;
create or replace function public.approve_meeting_for_pdf(p_meeting_id uuid, p_expected_version integer, p_actor_profile_id uuid, p_acknowledge_unresolved_votes boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  stored_meeting public.meetings%rowtype;
  actor_display_name text;
  approval_time timestamptz := clock_timestamp();
  unresolved_vote_count integer;
  approval_snapshot jsonb;
  returned_version integer;
begin
  select meeting.*
    into stored_meeting
    from public.meetings as meeting
   where meeting.id = p_meeting_id
   for update;

  if not found then
    return jsonb_build_object(
      'status', 'not_found',
      'meetingId', p_meeting_id,
      'version', null,
      'unresolvedVoteCount', 0,
      'documentVersion', null
    );
  end if;

  select profile.display_name
    into actor_display_name
    from public.profiles as profile
   where profile.id = p_actor_profile_id;

  if actor_display_name is null or not public.meeting_actor_can_approve(p_actor_profile_id) then
    return jsonb_build_object(
      'status', 'invalid_actor',
      'meetingId', p_meeting_id,
      'version', stored_meeting.version,
      'unresolvedVoteCount', 0,
      'documentVersion', null
    );
  end if;
  if stored_meeting.version <> p_expected_version then
    return jsonb_build_object(
      'status', 'conflict',
      'meetingId', p_meeting_id,
      'version', stored_meeting.version,
      'unresolvedVoteCount', 0,
      'documentVersion', null
    );
  end if;
  if stored_meeting.deferred_at is not null then
    return jsonb_build_object(
      'status', 'deferred',
      'meetingId', p_meeting_id,
      'version', stored_meeting.version,
      'unresolvedVoteCount', 0,
      'documentVersion', null
    );
  end if;
  if stored_meeting.status <> 'PENDING_APPROVAL'
    or stored_meeting.approved_at is not null then
    return jsonb_build_object(
      'status', 'invalid_state',
      'meetingId', p_meeting_id,
      'version', stored_meeting.version,
      'unresolvedVoteCount', 0,
      'documentVersion', null
    );
  end if;

  if stored_meeting.minutes is null
    or jsonb_typeof(stored_meeting.minutes) <> 'object'
    or nullif(btrim(stored_meeting.minutes->>'summary'), '') is null
    or jsonb_typeof(stored_meeting.minutes->'sections') <> 'array'
    or jsonb_array_length(stored_meeting.minutes->'sections') = 0
    or exists (
      select 1
        from jsonb_array_elements(stored_meeting.minutes->'sections') as section
       where jsonb_typeof(section) <> 'object'
          or nullif(btrim(section->>'heading'), '') is null
          or nullif(btrim(section->>'content'), '') is null
    )
    or not exists (
      select 1 from public.meeting_attendees as attendee where attendee.meeting_id = p_meeting_id
    ) then
    return jsonb_build_object(
      'status', 'invalid_content',
      'meetingId', p_meeting_id,
      'version', stored_meeting.version,
      'unresolvedVoteCount', 0,
      'documentVersion', null
    );
  end if;

  if exists (
    select 1
      from public.motions as motion
     where motion.meeting_id = p_meeting_id
       and (
         motion.motion_text is null
         or nullif(btrim(motion.motion_text), '') is null
         or (motion.outcome = 'NOT_SECONDED' and motion.seconded_by_attendee_id is not null)
         or motion.outcome is null
       )
  ) then
    return jsonb_build_object(
      'status', 'invalid_content',
      'meetingId', p_meeting_id,
      'version', stored_meeting.version,
      'unresolvedVoteCount', 0,
      'documentVersion', null
    );
  end if;

  select count(*)::integer
    into unresolved_vote_count
    from public.votes as vote
   where vote.meeting_id = p_meeting_id
     and vote.selection is null;

  if unresolved_vote_count > 0 and not coalesce(p_acknowledge_unresolved_votes, false) then
    return jsonb_build_object(
      'status', 'acknowledgement_required',
      'meetingId', p_meeting_id,
      'version', stored_meeting.version,
      'unresolvedVoteCount', unresolved_vote_count,
      'documentVersion', stored_meeting.version
    );
  end if;

  approval_snapshot := jsonb_build_object(
    'schemaVersion', '1.0',
    'meeting', jsonb_build_object(
      'id', stored_meeting.id,
      'sourceMeetingId', stored_meeting.source_meeting_id,
      'title', stored_meeting.title,
      'meetingDate', stored_meeting.meeting_date::text,
      'durationMinutes', stored_meeting.duration_minutes,
      'contentVersion', stored_meeting.version
    ),
    'minutes', stored_meeting.minutes,
    'attendees', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'profileId', coalesce(attendee.profile_id, attendee.id),
            'displayName', attendee.display_name_snapshot
          )
          order by attendee.display_name_snapshot, attendee.id
        ),
        '[]'::jsonb
      )
      from public.meeting_attendees as attendee
      where attendee.meeting_id = p_meeting_id
    ),
    'motions', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'text', motion.motion_text,
            'moverProfileId', coalesce(mover.profile_id, mover.id),
            'moverDisplayName', mover.display_name_snapshot,
            'seconderProfileId', coalesce(seconder.profile_id, seconder.id),
            'seconderDisplayName', seconder.display_name_snapshot,
            'outcome', lower(motion.outcome::text),
            'votes', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'profileId', coalesce(voter.profile_id, voter.id),
                    'displayName', voter.display_name_snapshot,
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
      where motion.meeting_id = p_meeting_id
    ),
    'approval', jsonb_build_object(
      'approvedByProfileId', p_actor_profile_id,
      'approvedByDisplayName', actor_display_name,
      'approvedAt', approval_time,
      'unresolvedVotesAcknowledged', coalesce(p_acknowledge_unresolved_votes, false),
      'unresolvedVoteCount', unresolved_vote_count
    )
  );

  update public.meetings
     set status = 'PDF_PROCESSING',
         approved_by = p_actor_profile_id,
         approved_at = approval_time,
         approved_snapshot = approval_snapshot,
         approved_content_version = stored_meeting.version,
         unresolved_votes_acknowledged = coalesce(p_acknowledge_unresolved_votes, false),
         human_owned = true,
         unsigned_pdf_id = null,
         pdf_attempt = 0,
         pdf_run_id = null,
         pdf_started_at = null,
         last_error_code = null,
         last_error_message = null,
         last_error_at = null
   where id = p_meeting_id
   returning version into returned_version;

  insert into public.review_history (meeting_id, actor_profile_id, action)
  values (p_meeting_id, p_actor_profile_id, 'APPROVED');

  return jsonb_build_object(
    'status', 'approved',
    'meetingId', p_meeting_id,
    'version', returned_version,
    'unresolvedVoteCount', unresolved_vote_count,
    'documentVersion', stored_meeting.version
  );
end;
$$;
create or replace function public.retry_meeting_pdf_generation(p_meeting_id uuid, p_expected_version integer, p_actor_profile_id uuid)
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

  if not found then
    return jsonb_build_object(
      'status', 'not_found', 'meetingId', p_meeting_id, 'version', null, 'documentVersion', null
    );
  end if;
  if not public.meeting_actor_can_approve(p_actor_profile_id) then
    return jsonb_build_object(
      'status', 'invalid_actor', 'meetingId', p_meeting_id,
      'version', stored_meeting.version, 'documentVersion', stored_meeting.approved_content_version
    );
  end if;
  if stored_meeting.version <> p_expected_version then
    return jsonb_build_object(
      'status', 'conflict', 'meetingId', p_meeting_id,
      'version', stored_meeting.version, 'documentVersion', stored_meeting.approved_content_version
    );
  end if;
  if stored_meeting.status <> 'PDF_FAILED' or stored_meeting.approved_snapshot is null then
    return jsonb_build_object(
      'status', 'invalid_state', 'meetingId', p_meeting_id,
      'version', stored_meeting.version, 'documentVersion', stored_meeting.approved_content_version
    );
  end if;

  update public.meetings
     set status = 'PDF_PROCESSING',
         pdf_run_id = null,
         pdf_started_at = null,
         unsigned_pdf_id = null,
         last_error_code = null,
         last_error_message = null,
         last_error_at = null
   where id = p_meeting_id
   returning version into returned_version;

  insert into public.review_history (meeting_id, actor_profile_id, action)
  values (p_meeting_id, p_actor_profile_id, 'PDF_RETRY');

  return jsonb_build_object(
    'status', 'retry_started',
    'meetingId', p_meeting_id,
    'version', returned_version,
    'documentVersion', stored_meeting.approved_content_version
  );
end;
$$;
create or replace function public.retry_meeting_signing_delivery(p_meeting_id uuid, p_expected_version integer, p_actor_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  stored_meeting public.meetings%rowtype;
  signing_request public.meeting_signing_requests%rowtype;
  returned_version integer;
begin
  select meeting.* into stored_meeting
    from public.meetings as meeting
   where meeting.id = p_meeting_id
   for update;

  if not found then
    return jsonb_build_object(
      'status', 'not_found', 'meetingId', p_meeting_id,
      'version', null, 'pdfId', null, 'documentVersion', null
    );
  end if;

  if not exists (
    select 1
      from public.profiles as profile
     where profile.id = p_actor_profile_id
       and profile.account_type = 'MEMBER'
       and profile.member_role in ('OFFICER', 'TREASURER')
       and profile.account_status = 'ACTIVE'
  ) then
    return jsonb_build_object(
      'status', 'invalid_actor', 'meetingId', p_meeting_id,
      'version', stored_meeting.version, 'pdfId', stored_meeting.unsigned_pdf_id,
      'documentVersion', stored_meeting.approved_content_version
    );
  end if;

  if stored_meeting.version <> p_expected_version then
    return jsonb_build_object(
      'status', 'conflict', 'meetingId', p_meeting_id,
      'version', stored_meeting.version, 'pdfId', stored_meeting.unsigned_pdf_id,
      'documentVersion', stored_meeting.approved_content_version
    );
  end if;

  select request.* into signing_request
    from public.meeting_signing_requests as request
   where request.meeting_id = p_meeting_id
     and request.pdf_id = stored_meeting.unsigned_pdf_id
     and request.provider = 'firma'
   for update;

  if stored_meeting.status <> 'ESIGN_FAILED'
    or stored_meeting.unsigned_pdf_id is null
    or not found
    or signing_request.delivery_status <> 'FAILED' then
    return jsonb_build_object(
      'status', 'invalid_state', 'meetingId', p_meeting_id,
      'version', stored_meeting.version, 'pdfId', stored_meeting.unsigned_pdf_id,
      'documentVersion', stored_meeting.approved_content_version
    );
  end if;

  update public.meeting_signing_requests
     set delivery_status = 'PENDING',
         run_id = null,
         started_at = null,
         last_error_code = null,
         last_error_message = null,
         last_error_at = null
   where id = signing_request.id;

  update public.meetings
     set last_error_code = null,
         last_error_message = null,
         last_error_at = null
   where id = p_meeting_id
   returning version into returned_version;

  insert into public.review_history (meeting_id, actor_profile_id, action)
  values (p_meeting_id, p_actor_profile_id, 'ESIGN_RETRY');

  return jsonb_build_object(
    'status', 'retry_started',
    'meetingId', p_meeting_id,
    'version', returned_version,
    'pdfId', stored_meeting.unsigned_pdf_id,
    'documentVersion', signing_request.document_version
  );
end;
$$;
commit;
