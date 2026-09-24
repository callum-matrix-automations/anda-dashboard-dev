begin;

create function public.renormalize_manual_transcript(
  p_meeting_id uuid,
  p_expected_version integer,
  p_actor_profile_id uuid,
  p_normalization jsonb,
  p_attendees jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

  if not found then
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

comment on function public.renormalize_manual_transcript(uuid, integer, uuid, jsonb, jsonb)
  is 'Version-checks a pending untouched manual meeting, stores a new immutable normalization, replaces source attendees, and prepares analysis.';

do $$
declare
  definition text;
  old_fragment text := '''metadata'', transcript.metadata';
  new_fragment text := '''metadata'', jsonb_set(
          transcript.metadata,
          ''{normalization}'',
          coalesce(
            (
              select jsonb_build_object(
                ''method'', normalization.method,
                ''detectedFormat'', normalization.detected_format,
                ''participants'', normalization.participants,
                ''possibleAliases'', normalization.possible_aliases,
                ''warnings'', normalization.warnings,
                ''turnCount'', normalization.turn_count,
                ''attributionCoverage'', normalization.attribution_coverage
              )
                from public.transcript_normalizations as normalization
               where normalization.transcript_id = transcript.id
               order by normalization.version desc
               limit 1
            ),
            transcript.metadata->''normalization'',
            ''{}''::jsonb
          ),
          true
        )';
begin
  definition := pg_get_functiondef('public.get_meeting_review(uuid)'::regprocedure);
  if position(old_fragment in definition) = 0 then
    raise exception 'Could not expose the latest transcript normalization in meeting review.';
  end if;
  definition := replace(definition, old_fragment, new_fragment);
  execute definition;
end;
$$;

revoke execute on function public.renormalize_manual_transcript(uuid, integer, uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.renormalize_manual_transcript(uuid, integer, uuid, jsonb, jsonb)
  to service_role;

commit;
