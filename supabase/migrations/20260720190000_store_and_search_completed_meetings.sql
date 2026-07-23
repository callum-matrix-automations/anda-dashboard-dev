begin;

create type public.meeting_category as enum (
  'Board Meeting',
  'Annual General Meeting',
  'Special Session',
  'Committee Meeting'
);

alter table public.meetings
  add column category public.meeting_category not null default 'Board Meeting',
  add column signed_pdf_id uuid,
  add column archive_attempt integer not null default 0,
  add column archive_run_id uuid,
  add column archive_started_at timestamptz,
  add constraint meetings_signed_pdf_id_fkey
    foreign key (id, signed_pdf_id)
    references public.meeting_pdfs (meeting_id, id)
    on delete restrict,
  add constraint meetings_archive_attempt_check check (archive_attempt >= 0),
  add constraint meetings_archive_run_check check (
    (
      archive_run_id is null
      and archive_started_at is null
    ) or (
      archive_run_id is not null
      and archive_started_at is not null
      and status in ('AWAITING_SIGNATURE', 'ARCHIVE_FAILED')
    )
  );

alter table public.meetings
  drop constraint meetings_signed_state_check,
  add constraint meetings_signed_state_check check (
    status not in ('ARCHIVE_FAILED', 'COMPLETED')
    or (signed_by is not null and signed_at is not null)
  ),
  add constraint meetings_completed_archive_check check (
    status <> 'COMPLETED'
    or (
      signed_pdf_id is not null
      and signed_pdf_path is not null
      and btrim(signed_pdf_path) <> ''
    )
  ),
  add constraint meetings_archive_failure_error_check check (
    status <> 'ARCHIVE_FAILED'
    or (
      last_error_code is not null
      and last_error_message is not null
      and last_error_at is not null
    )
  );

create index meetings_completed_archive_filter_idx
  on public.meetings (category, meeting_date desc, id)
  where status = 'COMPLETED';

create or replace function public.prepare_meeting_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  motion_content text;
begin
  select string_agg(
      concat_ws(' ', motion.motion_text, motion.outcome::text),
      ' '
      order by motion.created_at, motion.id
    )
    into motion_content
    from public.motions as motion
   where motion.meeting_id = new.id;

  new.search_vector :=
    setweight(to_tsvector('pg_catalog.english'::regconfig, coalesce(new.title, '')), 'A')
    || setweight(to_tsvector('pg_catalog.english'::regconfig, coalesce(new.category::text, '')), 'A')
    || setweight(to_tsvector('pg_catalog.english'::regconfig, coalesce(new.meeting_date::text, '')), 'B')
    || setweight(to_tsvector(
      'pg_catalog.english'::regconfig,
      coalesce(array_to_string(new.manual_tags, ' '), '')
    ), 'B')
    || setweight(to_tsvector('pg_catalog.english'::regconfig, coalesce(new.minutes::text, '')), 'C')
    || setweight(to_tsvector('pg_catalog.english'::regconfig, coalesce(motion_content, '')), 'C');

  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.validate_meeting_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  legal_transition boolean;
  caller_role public.member_role;
begin
  if new.status is distinct from old.status then
    legal_transition := (old.status, new.status) in (
      ('AI_PROCESSING'::public.meeting_status, 'AI_FAILED'::public.meeting_status),
      ('AI_PROCESSING'::public.meeting_status, 'PENDING_APPROVAL'::public.meeting_status),
      ('AI_FAILED'::public.meeting_status, 'AI_PROCESSING'::public.meeting_status),
      ('AI_FAILED'::public.meeting_status, 'PENDING_APPROVAL'::public.meeting_status),
      ('PENDING_APPROVAL'::public.meeting_status, 'PDF_PROCESSING'::public.meeting_status),
      ('PDF_PROCESSING'::public.meeting_status, 'PDF_FAILED'::public.meeting_status),
      ('PDF_PROCESSING'::public.meeting_status, 'AWAITING_SIGNATURE'::public.meeting_status),
      ('PDF_PROCESSING'::public.meeting_status, 'ESIGN_FAILED'::public.meeting_status),
      ('PDF_FAILED'::public.meeting_status, 'PDF_PROCESSING'::public.meeting_status),
      ('AWAITING_SIGNATURE'::public.meeting_status, 'COMPLETED'::public.meeting_status),
      ('AWAITING_SIGNATURE'::public.meeting_status, 'ESIGN_FAILED'::public.meeting_status),
      ('AWAITING_SIGNATURE'::public.meeting_status, 'ARCHIVE_FAILED'::public.meeting_status),
      ('AWAITING_SIGNATURE'::public.meeting_status, 'PENDING_APPROVAL'::public.meeting_status),
      ('ESIGN_FAILED'::public.meeting_status, 'AWAITING_SIGNATURE'::public.meeting_status),
      ('ESIGN_FAILED'::public.meeting_status, 'PENDING_APPROVAL'::public.meeting_status),
      ('ARCHIVE_FAILED'::public.meeting_status, 'COMPLETED'::public.meeting_status)
    );

    if not legal_transition then
      raise exception 'Meeting transition from % to % is not allowed.', old.status, new.status;
    end if;
    if old.deferred_at is not null then
      raise exception 'Resume a deferred meeting before changing its lifecycle state.';
    end if;

    if current_user = 'authenticated' then
      select profile.member_role
        into caller_role
        from public.profiles as profile
       where profile.id = auth.uid()
         and profile.account_type = 'MEMBER'
         and profile.account_status = 'ACTIVE';
      if caller_role is null then
        raise exception 'An active member profile is required.';
      end if;
      if (
        old.status = 'AWAITING_SIGNATURE'
        and new.status in ('COMPLETED', 'ESIGN_FAILED', 'ARCHIVE_FAILED', 'PENDING_APPROVAL')
      ) or (
        old.status = 'ESIGN_FAILED'
        and new.status in ('AWAITING_SIGNATURE', 'PENDING_APPROVAL')
      ) then
        if caller_role <> 'TREASURER' then
          raise exception 'This transition requires the Treasurer role.';
        end if;
      elsif caller_role not in ('OFFICER', 'TREASURER') then
        raise exception 'This transition requires at least the Officer role.';
      end if;
    end if;
  end if;

  if old.status in (
    'PDF_PROCESSING', 'PDF_FAILED', 'AWAITING_SIGNATURE', 'ESIGN_FAILED', 'ARCHIVE_FAILED'
  ) and (
    new.title is distinct from old.title
    or new.meeting_date is distinct from old.meeting_date
    or new.category is distinct from old.category
    or new.minutes is distinct from old.minutes
    or new.manual_tags is distinct from old.manual_tags
  ) then
    raise exception 'Approved meeting content is locked.';
  end if;

  if old.deferred_at is not null and (
    new.title is distinct from old.title
    or new.meeting_date is distinct from old.meeting_date
    or new.category is distinct from old.category
    or new.minutes is distinct from old.minutes
    or new.manual_tags is distinct from old.manual_tags
  ) then
    raise exception 'Resume the meeting before editing its content.';
  end if;
  return new;
end;
$$;

-- Rebuild vectors now that category and motions are part of the archive index.
-- The completed lock is temporarily disabled only for this migration backfill.
alter table public.meetings disable trigger meetings_prevent_completed_changes;
update public.meetings set category = category;
alter table public.meetings enable trigger meetings_prevent_completed_changes;

create trigger meeting_pdfs_prevent_completed_inserts
before insert on public.meeting_pdfs
for each row execute function public.prevent_completed_related_changes();

create or replace function public.claim_meeting_archive(p_meeting_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_meeting public.meetings%rowtype;
  signing_request public.meeting_signing_requests%rowtype;
  unsigned_pdf public.meeting_pdfs%rowtype;
  generated_run_id uuid;
  returned_attempt integer;
begin
  select meeting.* into stored_meeting
    from public.meetings as meeting
   where meeting.id = p_meeting_id
   for update;

  if not found then
    return jsonb_build_object(
      'status', 'not_found', 'meetingId', p_meeting_id, 'attempt', null
    );
  end if;
  if stored_meeting.status = 'COMPLETED' then
    return jsonb_build_object(
      'status', 'already_completed',
      'meetingId', stored_meeting.id,
      'attempt', stored_meeting.archive_attempt
    );
  end if;
  if stored_meeting.archive_run_id is not null
    and stored_meeting.archive_started_at >= now() - interval '10 minutes' then
    return jsonb_build_object(
      'status', 'already_processing',
      'meetingId', stored_meeting.id,
      'attempt', stored_meeting.archive_attempt
    );
  end if;
  if stored_meeting.status not in ('AWAITING_SIGNATURE', 'ARCHIVE_FAILED')
    or stored_meeting.signed_by is null
    or stored_meeting.signed_at is null
    or stored_meeting.unsigned_pdf_id is null then
    return jsonb_build_object(
      'status', 'protected',
      'meetingId', stored_meeting.id,
      'attempt', stored_meeting.archive_attempt
    );
  end if;

  select request.* into signing_request
    from public.meeting_signing_requests as request
   where request.meeting_id = stored_meeting.id
     and request.pdf_id = stored_meeting.unsigned_pdf_id
     and request.provider = 'firma'
     and request.outcome_status = 'READY_FOR_ARCHIVE'
   for update;

  select pdf.* into unsigned_pdf
    from public.meeting_pdfs as pdf
   where pdf.meeting_id = stored_meeting.id
     and pdf.id = stored_meeting.unsigned_pdf_id
     and pdf.pdf_type = 'UNSIGNED';

  if signing_request.id is null
    or unsigned_pdf.id is null
    or signing_request.external_request_ref is null
    or signing_request.signed_document_sha256 is null
    or signing_request.signed_document_size_bytes is null then
    return jsonb_build_object(
      'status', 'protected',
      'meetingId', stored_meeting.id,
      'attempt', stored_meeting.archive_attempt
    );
  end if;

  generated_run_id := gen_random_uuid();
  update public.meetings
     set archive_run_id = generated_run_id,
         archive_started_at = now(),
         archive_attempt = archive_attempt + 1
   where id = stored_meeting.id
   returning archive_attempt into returned_attempt;

  return jsonb_build_object(
    'status', 'claimed',
    'meetingId', stored_meeting.id,
    'requestId', signing_request.id,
    'externalRequestId', signing_request.external_request_ref,
    'documentVersion', signing_request.document_version,
    'runId', generated_run_id,
    'attempt', returned_attempt,
    'unsignedPdfPath', unsigned_pdf.storage_path,
    'expectedSha256', signing_request.signed_document_sha256,
    'expectedSizeBytes', signing_request.signed_document_size_bytes
  );
end;
$$;

create function public.complete_meeting_archive(
  p_meeting_id uuid,
  p_run_id uuid,
  p_storage_path text,
  p_sha256 text,
  p_size_bytes bigint,
  p_page_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_meeting public.meetings%rowtype;
  signing_request public.meeting_signing_requests%rowtype;
  signed_pdf public.meeting_pdfs%rowtype;
  finished_meeting public.meetings%rowtype;
begin
  if nullif(btrim(p_storage_path), '') is null
    or p_sha256 !~ '^[a-f0-9]{64}$'
    or p_size_bytes <= 0
    or p_page_count <= 0 then
    raise exception 'Signed archive metadata is invalid.' using errcode = '22023';
  end if;

  select meeting.* into stored_meeting
    from public.meetings as meeting
   where meeting.id = p_meeting_id
   for update;

  if not found then
    return jsonb_build_object('status', 'not_found', 'meetingId', p_meeting_id);
  end if;
  if stored_meeting.status = 'COMPLETED' then
    return jsonb_build_object(
      'status', 'already_completed',
      'meetingId', stored_meeting.id,
      'signedPdfId', stored_meeting.signed_pdf_id,
      'completedAt', stored_meeting.completed_at,
      'version', stored_meeting.version
    );
  end if;
  if stored_meeting.archive_run_id is distinct from p_run_id
    or stored_meeting.status not in ('AWAITING_SIGNATURE', 'ARCHIVE_FAILED') then
    return jsonb_build_object('status', 'stale', 'meetingId', stored_meeting.id);
  end if;

  select request.* into signing_request
    from public.meeting_signing_requests as request
   where request.meeting_id = stored_meeting.id
     and request.pdf_id = stored_meeting.unsigned_pdf_id
     and request.outcome_status = 'READY_FOR_ARCHIVE'
   for update;

  if not found
    or signing_request.signed_document_sha256 is distinct from p_sha256
    or signing_request.signed_document_size_bytes is distinct from p_size_bytes then
    raise exception 'Signed PDF does not match the verified signing outcome.' using errcode = '22023';
  end if;

  insert into public.meeting_pdfs (
    meeting_id,
    pdf_type,
    document_version,
    storage_path,
    sha256,
    size_bytes,
    page_count,
    generated_at
  ) values (
    stored_meeting.id,
    'SIGNED',
    signing_request.document_version,
    p_storage_path,
    p_sha256,
    p_size_bytes,
    p_page_count,
    coalesce(signing_request.provider_completed_at, now())
  )
  on conflict (meeting_id, document_version, pdf_type) do nothing;

  select pdf.* into signed_pdf
    from public.meeting_pdfs as pdf
   where pdf.meeting_id = stored_meeting.id
     and pdf.document_version = signing_request.document_version
     and pdf.pdf_type = 'SIGNED';

  if signed_pdf.id is null
    or signed_pdf.storage_path is distinct from p_storage_path
    or signed_pdf.sha256 is distinct from p_sha256
    or signed_pdf.size_bytes is distinct from p_size_bytes
    or signed_pdf.page_count is distinct from p_page_count then
    raise exception 'Existing signed archive metadata conflicts with the verified PDF.' using errcode = '23505';
  end if;

  update public.meetings
     set status = 'COMPLETED',
         signed_pdf_id = signed_pdf.id,
         signed_pdf_path = signed_pdf.storage_path,
         unsigned_pdf_id = null,
         archive_run_id = null,
         archive_started_at = null,
         completed_at = now(),
         last_error_code = null,
         last_error_message = null,
         last_error_at = null
   where id = stored_meeting.id
   returning * into finished_meeting;

  return jsonb_build_object(
    'status', 'completed',
    'meetingId', finished_meeting.id,
    'signedPdfId', signed_pdf.id,
    'completedAt', finished_meeting.completed_at,
    'version', finished_meeting.version
  );
end;
$$;

create function public.record_meeting_archive_failure(
  p_meeting_id uuid,
  p_run_id uuid,
  p_error_code text,
  p_error_message text
)
returns jsonb
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

  if not found then
    return jsonb_build_object('status', 'not_found', 'meetingId', p_meeting_id);
  end if;
  if stored_meeting.status = 'COMPLETED' then
    return jsonb_build_object('status', 'already_completed', 'meetingId', stored_meeting.id);
  end if;
  if stored_meeting.archive_run_id is distinct from p_run_id
    or stored_meeting.status not in ('AWAITING_SIGNATURE', 'ARCHIVE_FAILED') then
    return jsonb_build_object('status', 'stale', 'meetingId', stored_meeting.id);
  end if;

  update public.meetings
     set status = 'ARCHIVE_FAILED',
         archive_run_id = null,
         archive_started_at = null,
         last_error_code = left(coalesce(nullif(btrim(p_error_code), ''), 'archive_failed'), 200),
         last_error_message = left(coalesce(nullif(btrim(p_error_message), ''), 'Signed PDF archival failed.'), 2000),
         last_error_at = now()
   where id = stored_meeting.id
   returning * into stored_meeting;

  return jsonb_build_object(
    'status', 'failed',
    'meetingId', stored_meeting.id,
    'attempt', stored_meeting.archive_attempt,
    'version', stored_meeting.version
  );
end;
$$;

create or replace function public.list_archive_recovery_candidates(p_limit integer default 25)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(jsonb_agg(candidate.id order by candidate.retry_at, candidate.id), '[]'::jsonb)
    from (
      select meeting.id, coalesce(meeting.last_error_at, meeting.archive_started_at, meeting.updated_at) as retry_at
        from public.meetings as meeting
        join public.meeting_signing_requests as request
          on request.meeting_id = meeting.id
         and request.pdf_id = meeting.unsigned_pdf_id
         and request.outcome_status = 'READY_FOR_ARCHIVE'
       where (
            meeting.status = 'ARCHIVE_FAILED'
            and (
              meeting.archive_run_id is null
              or meeting.archive_started_at < now() - interval '10 minutes'
            )
          ) or (
            meeting.status = 'AWAITING_SIGNATURE'
            and (
              meeting.archive_run_id is null
              or meeting.archive_started_at < now() - interval '10 minutes'
            )
          )
       order by retry_at, meeting.id
       limit greatest(1, least(coalesce(p_limit, 25), 100))
    ) as candidate;
$$;

create function public.search_completed_meeting_archives(
  p_query text default null,
  p_year integer default null,
  p_category text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  cleaned_query text := nullif(btrim(p_query), '');
  cleaned_category text := nullif(btrim(p_category), '');
  result_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
  result_offset integer := greatest(0, coalesce(p_offset, 0));
  total_count bigint;
  result_items jsonb;
begin
  if p_year is not null and (p_year < 1900 or p_year > 2200) then
    raise exception 'Archive year is invalid.' using errcode = '22023';
  end if;
  if cleaned_category is not null
    and cleaned_category not in (
      'Board Meeting', 'Annual General Meeting', 'Special Session', 'Committee Meeting'
    ) then
    raise exception 'Archive category is invalid.' using errcode = '22023';
  end if;

  select count(*) into total_count
    from public.meetings as meeting
   where meeting.status = 'COMPLETED'
     and (p_year is null or extract(year from meeting.meeting_date)::integer = p_year)
     and (cleaned_category is null or meeting.category::text = cleaned_category)
     and (
       cleaned_query is null
       or meeting.search_vector @@ websearch_to_tsquery('pg_catalog.english'::regconfig, cleaned_query)
     );

  select coalesce(jsonb_agg(row_data order by row_data.meeting_date desc, row_data.id), '[]'::jsonb)
    into result_items
    from (
      select
        meeting.id,
        meeting.title,
        meeting.meeting_date,
        meeting.category,
        meeting.manual_tags,
        meeting.signed_by,
        meeting.signed_at,
        meeting.signed_pdf_id,
        meeting.completed_at,
        meeting.version
      from public.meetings as meeting
      where meeting.status = 'COMPLETED'
        and (p_year is null or extract(year from meeting.meeting_date)::integer = p_year)
        and (cleaned_category is null or meeting.category::text = cleaned_category)
        and (
          cleaned_query is null
          or meeting.search_vector @@ websearch_to_tsquery('pg_catalog.english'::regconfig, cleaned_query)
        )
      order by meeting.meeting_date desc, meeting.id
      limit result_limit
      offset result_offset
    ) as row_data;

  return jsonb_build_object(
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'meetingId', item->>'id',
        'title', item->>'title',
        'meetingDate', item->>'meeting_date',
        'category', item->>'category',
        'tags', coalesce(item->'manual_tags', '[]'::jsonb),
        'signedBy', item->>'signed_by',
        'signedAt', item->>'signed_at',
        'signedPdfId', item->>'signed_pdf_id',
        'completedAt', item->>'completed_at',
        'version', (item->>'version')::integer
      )), '[]'::jsonb)
      from jsonb_array_elements(result_items) as item
    ),
    'total', total_count,
    'limit', result_limit,
    'offset', result_offset
  );
end;
$$;

create or replace function public.get_completed_meeting_archive(p_meeting_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  stored_meeting public.meetings%rowtype;
  signed_pdf public.meeting_pdfs%rowtype;
  stored_motions jsonb;
begin
  select meeting.* into stored_meeting
    from public.meetings as meeting
   where meeting.id = p_meeting_id
     and meeting.status = 'COMPLETED';
  if not found then
    return jsonb_build_object('status', 'not_found', 'meetingId', p_meeting_id);
  end if;

  select pdf.* into signed_pdf
    from public.meeting_pdfs as pdf
   where pdf.meeting_id = stored_meeting.id
     and pdf.id = stored_meeting.signed_pdf_id
     and pdf.pdf_type = 'SIGNED';
  if signed_pdf.id is null then
    return jsonb_build_object('status', 'not_found', 'meetingId', p_meeting_id);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', motion.id,
      'text', motion.motion_text,
      'outcome', motion.outcome
    ) order by motion.created_at, motion.id), '[]'::jsonb)
    into stored_motions
    from public.motions as motion
   where motion.meeting_id = stored_meeting.id;

  return jsonb_build_object(
    'status', 'available',
    'meetingId', stored_meeting.id,
    'title', stored_meeting.title,
    'meetingDate', stored_meeting.meeting_date,
    'category', stored_meeting.category,
    'tags', stored_meeting.manual_tags,
    'minutes', stored_meeting.minutes,
    'motions', stored_motions,
    'signedBy', stored_meeting.signed_by,
    'signedAt', stored_meeting.signed_at,
    'signedPdfId', signed_pdf.id,
    'completedAt', stored_meeting.completed_at,
    'version', stored_meeting.version,
    'document', jsonb_build_object(
      'pdfId', signed_pdf.id,
      'path', signed_pdf.storage_path,
      'sha256', signed_pdf.sha256,
      'sizeBytes', signed_pdf.size_bytes,
      'pageCount', signed_pdf.page_count,
      'documentVersion', signed_pdf.document_version
    )
  );
end;
$$;

revoke all on function public.claim_meeting_archive(uuid) from public, anon, authenticated;
revoke all on function public.complete_meeting_archive(uuid, uuid, text, text, bigint, integer) from public, anon, authenticated;
revoke all on function public.record_meeting_archive_failure(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.list_archive_recovery_candidates(integer) from public, anon, authenticated;
revoke all on function public.search_completed_meeting_archives(text, integer, text, integer, integer) from public, anon, authenticated;
revoke all on function public.get_completed_meeting_archive(uuid) from public, anon, authenticated;

grant execute on function public.claim_meeting_archive(uuid) to service_role;
grant execute on function public.complete_meeting_archive(uuid, uuid, text, text, bigint, integer) to service_role;
grant execute on function public.record_meeting_archive_failure(uuid, uuid, text, text) to service_role;
grant execute on function public.list_archive_recovery_candidates(integer) to service_role;
grant execute on function public.search_completed_meeting_archives(text, integer, text, integer, integer) to service_role;
grant execute on function public.get_completed_meeting_archive(uuid) to service_role;

commit;
