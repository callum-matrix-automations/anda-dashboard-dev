begin;

alter table public.meetings
  add column approved_snapshot jsonb,
  add column approved_content_version integer,
  add column unresolved_votes_acknowledged boolean,
  add column pdf_attempt integer not null default 0,
  add column pdf_run_id uuid,
  add column pdf_started_at timestamptz;

create type public.meeting_pdf_type as enum ('UNSIGNED', 'SIGNED');

create table public.meeting_pdfs (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete restrict,
  pdf_type public.meeting_pdf_type not null,
  document_version integer not null check (document_version > 0),
  storage_path text not null unique check (btrim(storage_path) <> ''),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes bigint not null check (size_bytes > 0),
  page_count integer not null check (page_count > 0),
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint meeting_pdfs_meeting_version_type_key
    unique (meeting_id, document_version, pdf_type),
  constraint meeting_pdfs_meeting_id_id_key unique (meeting_id, id)
);

alter table public.meetings
  add column unsigned_pdf_id uuid,
  add constraint meetings_unsigned_pdf_id_fkey
    foreign key (id, unsigned_pdf_id)
    references public.meeting_pdfs (meeting_id, id)
    on delete restrict;

alter table public.meetings
  add constraint meetings_approved_snapshot_check check (
    (
      approved_by is null
      and approved_at is null
      and approved_snapshot is null
      and approved_content_version is null
      and unresolved_votes_acknowledged is null
    )
    or (
      approved_by is not null
      and approved_at is not null
      and approved_snapshot is not null
      and jsonb_typeof(approved_snapshot) = 'object'
      and approved_content_version is not null
      and approved_content_version > 0
      and unresolved_votes_acknowledged is not null
    )
  ),
  add constraint meetings_pdf_attempt_check check (pdf_attempt >= 0),
  add constraint meetings_pdf_run_pair_check check (
    (pdf_run_id is null and pdf_started_at is null)
    or (pdf_run_id is not null and pdf_started_at is not null and status = 'PDF_PROCESSING')
  ),
  add constraint meetings_unsigned_pdf_state_check check (
    status not in ('AWAITING_SIGNATURE', 'ESIGN_FAILED')
    or unsigned_pdf_id is not null
  ),
  add constraint meetings_pdf_failure_error_check check (
    status <> 'PDF_FAILED' or last_error_code is not null
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'meeting-minutes',
  'meeting-minutes',
  false,
  52428800,
  array['application/pdf']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create function public.prevent_meeting_pdf_artifact_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Meeting PDF artifact records are immutable.';
end;
$$;

create trigger meeting_pdfs_prevent_changes
before update or delete on public.meeting_pdfs
for each row execute function public.prevent_meeting_pdf_artifact_changes();

create function public.prevent_approved_structured_content_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_meeting_id uuid;
  target_approved_at timestamptz;
begin
  target_meeting_id := case when tg_op = 'DELETE' then old.meeting_id else new.meeting_id end;

  select meeting.approved_at
    into target_approved_at
    from public.meetings as meeting
   where meeting.id = target_meeting_id;

  if target_approved_at is not null then
    raise exception 'Approved meeting structured content is locked.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger meeting_attendees_prevent_approved_changes
before insert or update or delete on public.meeting_attendees
for each row execute function public.prevent_approved_structured_content_changes();

create trigger motions_prevent_approved_changes
before insert or update or delete on public.motions
for each row execute function public.prevent_approved_structured_content_changes();

create trigger votes_prevent_approved_changes
before insert or update or delete on public.votes
for each row execute function public.prevent_approved_structured_content_changes();

create function public.protect_approved_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.approved_snapshot is not null
    and new.approved_snapshot is distinct from old.approved_snapshot then
    raise exception 'The approved meeting snapshot is immutable.';
  end if;
  return new;
end;
$$;

create trigger meetings_protect_approved_snapshot
before update on public.meetings
for each row execute function public.protect_approved_snapshot();

create function public.approve_meeting_for_pdf(
  p_meeting_id uuid,
  p_expected_version integer,
  p_actor_profile_id uuid,
  p_acknowledge_unresolved_votes boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

  if actor_display_name is null then
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
         or motion.moved_by_attendee_id is null
         or motion.seconded_by_attendee_id is null
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
            'profileId', attendee.profile_id,
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
            'moverProfileId', mover.profile_id,
            'moverDisplayName', mover.display_name_snapshot,
            'seconderProfileId', seconder.profile_id,
            'seconderDisplayName', seconder.display_name_snapshot,
            'outcome', lower(motion.outcome::text),
            'votes', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'profileId', voter.profile_id,
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
      join public.meeting_attendees as mover
        on mover.id = motion.moved_by_attendee_id
       and mover.meeting_id = motion.meeting_id
      join public.meeting_attendees as seconder
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

create function public.claim_meeting_pdf_generation(p_meeting_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_meeting public.meetings%rowtype;
  generated_run_id uuid;
  returned_attempt integer;
begin
  select meeting.* into stored_meeting
    from public.meetings as meeting
   where meeting.id = p_meeting_id
   for update;

  if not found then
    return jsonb_build_object('status', 'not_found', 'meetingId', p_meeting_id, 'attempt', null);
  end if;
  if stored_meeting.status = 'PDF_FAILED' then
    return jsonb_build_object(
      'status', 'retry_required',
      'meetingId', p_meeting_id,
      'attempt', stored_meeting.pdf_attempt
    );
  end if;
  if stored_meeting.status in ('AWAITING_SIGNATURE', 'ESIGN_FAILED', 'ARCHIVE_FAILED', 'COMPLETED') then
    return jsonb_build_object(
      'status', 'already_completed',
      'meetingId', p_meeting_id,
      'attempt', stored_meeting.pdf_attempt
    );
  end if;
  if stored_meeting.status <> 'PDF_PROCESSING' or stored_meeting.approved_snapshot is null then
    return jsonb_build_object(
      'status', 'protected',
      'meetingId', p_meeting_id,
      'attempt', stored_meeting.pdf_attempt
    );
  end if;
  if stored_meeting.pdf_run_id is not null then
    return jsonb_build_object(
      'status', 'already_processing',
      'meetingId', p_meeting_id,
      'attempt', stored_meeting.pdf_attempt
    );
  end if;

  generated_run_id := gen_random_uuid();
  update public.meetings
     set pdf_run_id = generated_run_id,
         pdf_started_at = now(),
         pdf_attempt = pdf_attempt + 1
   where id = p_meeting_id
   returning pdf_attempt into returned_attempt;

  return jsonb_build_object(
    'status', 'claimed',
    'meetingId', p_meeting_id,
    'runId', generated_run_id,
    'attempt', returned_attempt,
    'documentVersion', stored_meeting.approved_content_version,
    'snapshot', stored_meeting.approved_snapshot
  );
end;
$$;

create function public.complete_meeting_pdf_generation(
  p_meeting_id uuid,
  p_run_id uuid,
  p_path text,
  p_sha256 text,
  p_size_bytes bigint,
  p_page_count integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_meeting public.meetings%rowtype;
  generated_pdf_id uuid;
begin
  select meeting.* into stored_meeting
    from public.meetings as meeting
   where meeting.id = p_meeting_id
   for update;

  if not found then return 'not_found'; end if;
  if stored_meeting.status <> 'PDF_PROCESSING'
    or stored_meeting.pdf_run_id is distinct from p_run_id then
    return 'stale';
  end if;
  if nullif(btrim(p_path), '') is null
    or p_sha256 !~ '^[a-f0-9]{64}$'
    or p_size_bytes <= 0
    or p_page_count <= 0 then
    raise exception 'PDF artifact metadata is invalid.' using errcode = '22023';
  end if;

  insert into public.meeting_pdfs (
    meeting_id,
    pdf_type,
    document_version,
    storage_path,
    sha256,
    size_bytes,
    page_count
  )
  values (
    p_meeting_id,
    'UNSIGNED',
    stored_meeting.approved_content_version,
    btrim(p_path),
    p_sha256,
    p_size_bytes,
    p_page_count
  )
  returning id into generated_pdf_id;

  update public.meetings
     set status = 'AWAITING_SIGNATURE',
         unsigned_pdf_id = generated_pdf_id,
         pdf_run_id = null,
         pdf_started_at = null,
         last_error_code = null,
         last_error_message = null,
         last_error_at = null
   where id = p_meeting_id;

  return 'saved';
end;
$$;

create function public.record_meeting_pdf_failure(
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
begin
  select meeting.* into stored_meeting
    from public.meetings as meeting
   where meeting.id = p_meeting_id
   for update;

  if not found then return 'not_found'; end if;
  if stored_meeting.status <> 'PDF_PROCESSING'
    or stored_meeting.pdf_run_id is distinct from p_run_id then
    return 'stale';
  end if;

  update public.meetings
     set status = 'PDF_FAILED',
         pdf_run_id = null,
         pdf_started_at = null,
         last_error_code = left(coalesce(nullif(btrim(p_error_code), ''), 'pdf_generation_failed'), 200),
         last_error_message = left(coalesce(nullif(btrim(p_error_message), ''), 'PDF generation failed.'), 2000),
         last_error_at = now()
   where id = p_meeting_id;

  return 'failed';
end;
$$;

create function public.retry_meeting_pdf_generation(
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
    return jsonb_build_object(
      'status', 'not_found', 'meetingId', p_meeting_id, 'version', null, 'documentVersion', null
    );
  end if;
  if not exists (
    select 1 from public.profiles as profile where profile.id = p_actor_profile_id
  ) then
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
  left join public.profiles as approver on approver.id = meeting.approved_by
  left join public.meeting_pdfs as unsigned_pdf on unsigned_pdf.id = meeting.unsigned_pdf_id
  where meeting.id = p_meeting_id;
$$;

comment on function public.approve_meeting_for_pdf(uuid, integer, uuid, boolean)
  is 'Validates and locks the current reviewed content as an immutable PDF source snapshot.';
comment on function public.claim_meeting_pdf_generation(uuid)
  is 'Claims one PDF worker run against the approved snapshot.';
comment on function public.complete_meeting_pdf_generation(uuid, uuid, text, text, bigint, integer)
  is 'Creates the unsigned PDF record, associates it with its meeting, and advances the meeting to awaiting signature.';
comment on function public.record_meeting_pdf_failure(uuid, uuid, text, text)
  is 'Records a sanitised PDF generation failure for the active run.';
comment on function public.retry_meeting_pdf_generation(uuid, integer, uuid)
  is 'Restarts PDF generation from the unchanged approved snapshot.';

revoke all on table public.meeting_pdfs from public, anon, authenticated;
revoke all on function public.prevent_meeting_pdf_artifact_changes() from public, anon, authenticated;
revoke all on function public.prevent_approved_structured_content_changes() from public, anon, authenticated;
revoke all on function public.protect_approved_snapshot() from public, anon, authenticated;
revoke all on function public.approve_meeting_for_pdf(uuid, integer, uuid, boolean) from public, anon, authenticated;
revoke all on function public.claim_meeting_pdf_generation(uuid) from public, anon, authenticated;
revoke all on function public.complete_meeting_pdf_generation(uuid, uuid, text, text, bigint, integer) from public, anon, authenticated;
revoke all on function public.record_meeting_pdf_failure(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.retry_meeting_pdf_generation(uuid, integer, uuid) from public, anon, authenticated;

grant execute on function public.approve_meeting_for_pdf(uuid, integer, uuid, boolean) to service_role;
grant execute on function public.claim_meeting_pdf_generation(uuid) to service_role;
grant execute on function public.complete_meeting_pdf_generation(uuid, uuid, text, text, bigint, integer) to service_role;
grant execute on function public.record_meeting_pdf_failure(uuid, uuid, text, text) to service_role;
grant execute on function public.retry_meeting_pdf_generation(uuid, integer, uuid) to service_role;
grant select, insert on table public.meeting_pdfs to service_role;

commit;
