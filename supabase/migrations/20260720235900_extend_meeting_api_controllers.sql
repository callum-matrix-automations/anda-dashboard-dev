begin;

create or replace function public.list_meeting_reviews()
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
  left join public.meeting_pdfs as unsigned_pdf on unsigned_pdf.id = meeting.unsigned_pdf_id;
$$;

create or replace function public.get_meeting_review(p_meeting_id uuid)
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
  left join public.profiles as approver on approver.id = meeting.approved_by
  left join public.meeting_pdfs as unsigned_pdf on unsigned_pdf.id = meeting.unsigned_pdf_id
  where meeting.id = p_meeting_id;
$$;

create function public.prepare_meeting_analysis_retry(
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
  select meeting.*
    into stored_meeting
    from public.meetings as meeting
   where meeting.id = p_meeting_id
   for update;

  if not found then
    return jsonb_build_object(
      'status', 'not_found',
      'meetingId', p_meeting_id,
      'version', null
    );
  end if;

  if not public.meeting_review_actor_can_edit(p_actor_profile_id) then
    return jsonb_build_object(
      'status', 'forbidden',
      'meetingId', p_meeting_id,
      'version', stored_meeting.version
    );
  end if;

  if stored_meeting.version <> p_expected_version then
    return jsonb_build_object(
      'status', 'conflict',
      'meetingId', p_meeting_id,
      'version', stored_meeting.version
    );
  end if;

  if stored_meeting.deferred_at is not null
    or stored_meeting.human_owned
    or stored_meeting.approved_at is not null then
    return jsonb_build_object(
      'status', 'protected',
      'meetingId', p_meeting_id,
      'version', stored_meeting.version
    );
  end if;

  if stored_meeting.status <> 'AI_FAILED' then
    return jsonb_build_object(
      'status', 'invalid_state',
      'meetingId', p_meeting_id,
      'version', stored_meeting.version
    );
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
   returning version into returned_version;

  insert into public.review_history (meeting_id, actor_profile_id, action)
  values (p_meeting_id, p_actor_profile_id, 'AI_RETRY');

  return jsonb_build_object(
    'status', 'retry_started',
    'meetingId', p_meeting_id,
    'version', returned_version
  );
end;
$$;

comment on function public.prepare_meeting_analysis_retry(uuid, integer, uuid)
  is 'Atomically authorises and prepares a version-checked manual retry of an AI_FAILED meeting.';

revoke all on function public.prepare_meeting_analysis_retry(uuid, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_meeting_analysis_retry(uuid, integer, uuid)
  to service_role;

commit;
