begin;

create type public.signing_delivery_status as enum (
  'PENDING',
  'PROCESSING',
  'DELIVERED',
  'FAILED'
);

create table public.meeting_signing_requests (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null,
  pdf_id uuid not null,
  document_version integer not null check (document_version > 0),
  provider text not null check (btrim(provider) <> ''),
  request_name text not null check (btrim(request_name) <> '' and char_length(request_name) <= 255),
  external_request_ref text,
  delivery_status public.signing_delivery_status not null default 'PENDING',
  attempt integer not null default 0 check (attempt >= 0),
  run_id uuid,
  started_at timestamptz,
  sent_at timestamptz,
  last_error_code text,
  last_error_message text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meeting_signing_requests_pdf_fkey
    foreign key (meeting_id, pdf_id)
    references public.meeting_pdfs (meeting_id, id)
    on delete restrict,
  constraint meeting_signing_requests_pdf_provider_key unique (pdf_id, provider),
  constraint meeting_signing_requests_run_pair_check check (
    (
      delivery_status = 'PROCESSING'
      and run_id is not null
      and started_at is not null
    ) or (
      delivery_status <> 'PROCESSING'
      and run_id is null
      and started_at is null
    )
  ),
  constraint meeting_signing_requests_delivery_check check (
    delivery_status <> 'DELIVERED'
    or (
      external_request_ref is not null
      and btrim(external_request_ref) <> ''
      and sent_at is not null
    )
  ),
  constraint meeting_signing_requests_failure_check check (
    delivery_status <> 'FAILED'
    or (
      last_error_code is not null
      and last_error_message is not null
      and last_error_at is not null
    )
  )
);

create unique index meeting_signing_requests_external_ref_idx
  on public.meeting_signing_requests (provider, external_request_ref)
  where external_request_ref is not null;

create index meeting_signing_requests_meeting_idx
  on public.meeting_signing_requests (meeting_id, created_at);

create trigger meeting_signing_requests_set_updated_at
before update on public.meeting_signing_requests
for each row execute function public.set_updated_at();

create function public.protect_meeting_signing_request_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Signing request records cannot be deleted.';
  end if;

  if new.id is distinct from old.id
    or new.meeting_id is distinct from old.meeting_id
    or new.pdf_id is distinct from old.pdf_id
    or new.document_version is distinct from old.document_version
    or new.provider is distinct from old.provider
    or new.request_name is distinct from old.request_name
    or (
      old.external_request_ref is not null
      and new.external_request_ref is distinct from old.external_request_ref
    ) then
    raise exception 'Signing request identity and PDF association are immutable.';
  end if;

  return new;
end;
$$;

create trigger meeting_signing_requests_protect_identity
before update or delete on public.meeting_signing_requests
for each row execute function public.protect_meeting_signing_request_identity();

-- Rows produced by ANDA-006 reached AWAITING_SIGNATURE as soon as the PDF was
-- written. They have not been routed to a provider, so put them back at the
-- locked processing boundary before enforcing the corrected lifecycle.
alter table public.meetings disable trigger meetings_validate_transition;
update public.meetings
   set status = 'PDF_PROCESSING'
 where status = 'AWAITING_SIGNATURE'
   and esign_external_ref is null
   and unsigned_pdf_id is not null;
alter table public.meetings enable trigger meetings_validate_transition;

alter table public.meetings
  add constraint meetings_esign_reference_state_check check (
    status <> 'AWAITING_SIGNATURE'
    or (esign_external_ref is not null and btrim(esign_external_ref) <> '')
  );

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
    'PDF_PROCESSING',
    'PDF_FAILED',
    'AWAITING_SIGNATURE',
    'ESIGN_FAILED',
    'ARCHIVE_FAILED'
  ) and (
    new.title is distinct from old.title
    or new.meeting_date is distinct from old.meeting_date
    or new.minutes is distinct from old.minutes
    or new.manual_tags is distinct from old.manual_tags
  ) then
    raise exception 'Approved meeting content is locked.';
  end if;

  if old.deferred_at is not null and (
    new.title is distinct from old.title
    or new.meeting_date is distinct from old.meeting_date
    or new.minutes is distinct from old.minutes
    or new.manual_tags is distinct from old.manual_tags
  ) then
    raise exception 'Resume the meeting before editing its content.';
  end if;

  return new;
end;
$$;

create or replace function public.complete_meeting_pdf_generation(
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
     set status = 'PDF_PROCESSING',
         unsigned_pdf_id = generated_pdf_id,
         pdf_run_id = null,
         pdf_started_at = null,
         esign_external_ref = null,
         last_error_code = null,
         last_error_message = null,
         last_error_at = null
   where id = p_meeting_id;

  return 'saved';
end;
$$;

create function public.claim_meeting_signing_delivery(p_meeting_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_meeting public.meetings%rowtype;
  stored_pdf public.meeting_pdfs%rowtype;
  signing_request public.meeting_signing_requests%rowtype;
  generated_run_id uuid;
  returned_attempt integer;
  deterministic_name text;
begin
  select meeting.* into stored_meeting
    from public.meetings as meeting
   where meeting.id = p_meeting_id
   for update;

  if not found then
    return jsonb_build_object('status', 'not_found', 'meetingId', p_meeting_id, 'attempt', null);
  end if;

  if stored_meeting.status = 'AWAITING_SIGNATURE' then
    return jsonb_build_object('status', 'already_completed', 'meetingId', p_meeting_id, 'attempt', null);
  end if;

  if stored_meeting.status not in ('PDF_PROCESSING', 'ESIGN_FAILED')
    or stored_meeting.unsigned_pdf_id is null then
    return jsonb_build_object('status', 'protected', 'meetingId', p_meeting_id, 'attempt', null);
  end if;

  select pdf.* into stored_pdf
    from public.meeting_pdfs as pdf
   where pdf.id = stored_meeting.unsigned_pdf_id
     and pdf.meeting_id = p_meeting_id
     and pdf.pdf_type = 'UNSIGNED';

  if not found then
    return jsonb_build_object('status', 'protected', 'meetingId', p_meeting_id, 'attempt', null);
  end if;

  deterministic_name := format('ANDA meeting %s v%s', p_meeting_id, stored_pdf.document_version);

  select request.* into signing_request
    from public.meeting_signing_requests as request
   where request.pdf_id = stored_pdf.id
     and request.provider = 'firma'
   for update;

  if not found then
    insert into public.meeting_signing_requests (
      meeting_id,
      pdf_id,
      document_version,
      provider,
      request_name
    ) values (
      p_meeting_id,
      stored_pdf.id,
      stored_pdf.document_version,
      'firma',
      deterministic_name
    )
    returning * into signing_request;
  end if;

  if signing_request.delivery_status = 'DELIVERED' then
    return jsonb_build_object(
      'status', 'already_completed', 'meetingId', p_meeting_id, 'attempt', signing_request.attempt
    );
  end if;
  if signing_request.delivery_status = 'PROCESSING' then
    return jsonb_build_object(
      'status', 'already_processing', 'meetingId', p_meeting_id, 'attempt', signing_request.attempt
    );
  end if;
  if signing_request.delivery_status = 'FAILED' then
    return jsonb_build_object(
      'status', 'retry_required', 'meetingId', p_meeting_id, 'attempt', signing_request.attempt
    );
  end if;

  generated_run_id := gen_random_uuid();
  update public.meeting_signing_requests
     set delivery_status = 'PROCESSING',
         run_id = generated_run_id,
         started_at = now(),
         attempt = attempt + 1,
         last_error_code = null,
         last_error_message = null,
         last_error_at = null
   where id = signing_request.id
   returning attempt into returned_attempt;

  return jsonb_build_object(
    'status', 'claimed',
    'meetingId', p_meeting_id,
    'runId', generated_run_id,
    'attempt', returned_attempt,
    'pdfId', stored_pdf.id,
    'pdfPath', stored_pdf.storage_path,
    'pdfSha256', stored_pdf.sha256,
    'pdfSizeBytes', stored_pdf.size_bytes,
    'documentVersion', stored_pdf.document_version,
    'requestName', signing_request.request_name,
    'externalRequestId', signing_request.external_request_ref
  );
end;
$$;

create function public.record_meeting_signing_request_created(
  p_meeting_id uuid,
  p_run_id uuid,
  p_external_request_ref text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  signing_request public.meeting_signing_requests%rowtype;
  cleaned_external_ref text;
begin
  cleaned_external_ref := nullif(btrim(p_external_request_ref), '');
  if cleaned_external_ref is null then
    raise exception 'External signing request reference is required.' using errcode = '22023';
  end if;

  select request.* into signing_request
    from public.meeting_signing_requests as request
   where request.meeting_id = p_meeting_id
     and request.run_id = p_run_id
   for update;

  if not found then return 'not_found'; end if;
  if signing_request.delivery_status <> 'PROCESSING' then return 'stale'; end if;
  if signing_request.external_request_ref is not null
    and signing_request.external_request_ref <> cleaned_external_ref then
    return 'conflict';
  end if;

  perform 1
    from public.meetings as meeting
   where meeting.id = p_meeting_id
     and meeting.status in ('PDF_PROCESSING', 'ESIGN_FAILED')
     and meeting.unsigned_pdf_id = signing_request.pdf_id
   for update;
  if not found then return 'stale'; end if;

  update public.meeting_signing_requests
     set external_request_ref = cleaned_external_ref
   where id = signing_request.id;

  update public.meetings
     set esign_external_ref = cleaned_external_ref
   where id = p_meeting_id
     and status in ('PDF_PROCESSING', 'ESIGN_FAILED')
     and unsigned_pdf_id = signing_request.pdf_id;

  return 'saved';
end;
$$;

create function public.complete_meeting_signing_delivery(
  p_meeting_id uuid,
  p_run_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  signing_request public.meeting_signing_requests%rowtype;
begin
  select request.* into signing_request
    from public.meeting_signing_requests as request
   where request.meeting_id = p_meeting_id
     and request.run_id = p_run_id
   for update;

  if not found then return 'not_found'; end if;
  if signing_request.delivery_status <> 'PROCESSING'
    or signing_request.external_request_ref is null then
    return 'stale';
  end if;

  perform 1
    from public.meetings as meeting
   where meeting.id = p_meeting_id
     and meeting.status in ('PDF_PROCESSING', 'ESIGN_FAILED')
     and meeting.unsigned_pdf_id = signing_request.pdf_id
   for update;
  if not found then return 'stale'; end if;

  update public.meeting_signing_requests
     set delivery_status = 'DELIVERED',
         run_id = null,
         started_at = null,
         sent_at = now(),
         last_error_code = null,
         last_error_message = null,
         last_error_at = null
   where id = signing_request.id;

  update public.meetings
     set status = 'AWAITING_SIGNATURE',
         esign_external_ref = signing_request.external_request_ref,
         last_error_code = null,
         last_error_message = null,
         last_error_at = null
   where id = p_meeting_id
     and status in ('PDF_PROCESSING', 'ESIGN_FAILED')
     and unsigned_pdf_id = signing_request.pdf_id;

  return 'saved';
end;
$$;

create function public.record_meeting_signing_failure(
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
  signing_request public.meeting_signing_requests%rowtype;
  cleaned_error_code text;
  cleaned_error_message text;
  failure_time timestamptz := now();
begin
  select request.* into signing_request
    from public.meeting_signing_requests as request
   where request.meeting_id = p_meeting_id
     and request.run_id = p_run_id
   for update;

  if not found then return 'not_found'; end if;
  if signing_request.delivery_status <> 'PROCESSING' then return 'stale'; end if;

  perform 1
    from public.meetings as meeting
   where meeting.id = p_meeting_id
     and meeting.status in ('PDF_PROCESSING', 'ESIGN_FAILED')
     and meeting.unsigned_pdf_id = signing_request.pdf_id
   for update;
  if not found then return 'stale'; end if;

  cleaned_error_code := left(
    coalesce(nullif(btrim(p_error_code), ''), 'esign_delivery_failed'),
    200
  );
  cleaned_error_message := left(
    coalesce(nullif(btrim(p_error_message), ''), 'Signing request delivery failed.'),
    2000
  );

  update public.meeting_signing_requests
     set delivery_status = 'FAILED',
         run_id = null,
         started_at = null,
         last_error_code = cleaned_error_code,
         last_error_message = cleaned_error_message,
         last_error_at = failure_time
   where id = signing_request.id;

  update public.meetings
     set status = 'ESIGN_FAILED',
         last_error_code = cleaned_error_code,
         last_error_message = cleaned_error_message,
         last_error_at = failure_time
   where id = p_meeting_id
     and status in ('PDF_PROCESSING', 'ESIGN_FAILED')
     and unsigned_pdf_id = signing_request.pdf_id;

  return 'failed';
end;
$$;

create function public.retry_meeting_signing_delivery(
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
       and profile.member_role = 'TREASURER'
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

comment on table public.meeting_signing_requests
  is 'Durable provider delivery state for one immutable approved PDF version.';
comment on function public.claim_meeting_signing_delivery(uuid)
  is 'Claims one signing delivery attempt for the current immutable unsigned PDF.';
comment on function public.record_meeting_signing_request_created(uuid, uuid, text)
  is 'Stores the external request reference before any provider send attempt.';
comment on function public.complete_meeting_signing_delivery(uuid, uuid)
  is 'Marks provider delivery complete and advances the meeting to awaiting signature.';
comment on function public.record_meeting_signing_failure(uuid, uuid, text, text)
  is 'Records a sanitised signing delivery failure while keeping the approved PDF locked.';
comment on function public.retry_meeting_signing_delivery(uuid, integer, uuid)
  is 'Authorises a Treasurer retry using the same immutable approved PDF and provider request.';

revoke all on table public.meeting_signing_requests from public, anon, authenticated;
revoke all on function public.protect_meeting_signing_request_identity() from public, anon, authenticated;
revoke all on function public.claim_meeting_signing_delivery(uuid) from public, anon, authenticated;
revoke all on function public.record_meeting_signing_request_created(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_meeting_signing_delivery(uuid, uuid) from public, anon, authenticated;
revoke all on function public.record_meeting_signing_failure(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.retry_meeting_signing_delivery(uuid, integer, uuid) from public, anon, authenticated;

grant select, insert, update on table public.meeting_signing_requests to service_role;
grant execute on function public.claim_meeting_signing_delivery(uuid) to service_role;
grant execute on function public.record_meeting_signing_request_created(uuid, uuid, text) to service_role;
grant execute on function public.complete_meeting_signing_delivery(uuid, uuid) to service_role;
grant execute on function public.record_meeting_signing_failure(uuid, uuid, text, text) to service_role;
grant execute on function public.retry_meeting_signing_delivery(uuid, integer, uuid) to service_role;

commit;
