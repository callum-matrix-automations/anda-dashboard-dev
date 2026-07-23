begin;

create type public.signing_outcome_status as enum (
  'AWAITING',
  'PROCESSING',
  'READY_FOR_ARCHIVE',
  'REJECTING',
  'REJECTED',
  'COMPLETION_FAILED',
  'REJECTION_FAILED'
);

create type public.signing_webhook_event_status as enum (
  'RECEIVED',
  'PROCESSING',
  'PROCESSED',
  'FAILED',
  'IGNORED'
);

alter table public.meeting_signing_requests
  add column recipient_ref text,
  add column recipient_email text,
  add column provider_status text,
  add column outcome_status public.signing_outcome_status not null default 'AWAITING',
  add column outcome_attempt integer not null default 0,
  add column outcome_run_id uuid,
  add column outcome_started_at timestamptz,
  add column provider_completed_at timestamptz,
  add column signed_document_sha256 text,
  add column signed_document_size_bytes bigint,
  add column rejection_comment text,
  add column rejected_by uuid references public.profiles (id) on delete restrict,
  add column rejected_at timestamptz,
  add constraint meeting_signing_requests_outcome_attempt_check
    check (outcome_attempt >= 0),
  add constraint meeting_signing_requests_outcome_run_check check (
    (
      outcome_status in ('PROCESSING', 'REJECTING')
      and outcome_run_id is not null
      and outcome_started_at is not null
    ) or (
      outcome_status not in ('PROCESSING', 'REJECTING')
      and outcome_run_id is null
      and outcome_started_at is null
    )
  ),
  add constraint meeting_signing_requests_signed_document_check check (
    (
      outcome_status = 'READY_FOR_ARCHIVE'
      and provider_completed_at is not null
      and signed_document_sha256 ~ '^[a-f0-9]{64}$'
      and signed_document_size_bytes > 0
    ) or (
      outcome_status <> 'READY_FOR_ARCHIVE'
      and signed_document_sha256 is null
      and signed_document_size_bytes is null
    )
  ),
  add constraint meeting_signing_requests_rejection_check check (
    (
      outcome_status in ('REJECTING', 'REJECTED', 'REJECTION_FAILED')
      and rejection_comment is not null
      and btrim(rejection_comment) <> ''
      and rejected_by is not null
    ) or (
      outcome_status not in ('REJECTING', 'REJECTED', 'REJECTION_FAILED')
      and rejection_comment is null
      and rejected_by is null
      and rejected_at is null
    )
  ),
  add constraint meeting_signing_requests_rejected_at_check check (
    (outcome_status = 'REJECTED' and rejected_at is not null)
    or (outcome_status <> 'REJECTED' and rejected_at is null)
  );

create table public.signing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (btrim(provider) <> ''),
  provider_event_id text not null check (btrim(provider_event_id) <> ''),
  event_type text not null check (btrim(event_type) <> ''),
  external_request_ref text,
  signing_request_id uuid references public.meeting_signing_requests (id) on delete restrict,
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  processing_status public.signing_webhook_event_status not null,
  attempt integer not null default 0 check (attempt >= 0),
  run_id uuid,
  started_at timestamptz,
  processed_at timestamptz,
  last_error_code text,
  last_error_message text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint signing_webhook_events_provider_event_key unique (provider, provider_event_id),
  constraint signing_webhook_events_run_check check (
    (
      processing_status = 'PROCESSING'
      and run_id is not null
      and started_at is not null
    ) or (
      processing_status <> 'PROCESSING'
      and run_id is null
      and started_at is null
    )
  ),
  constraint signing_webhook_events_processed_check check (
    (processing_status in ('PROCESSED', 'IGNORED') and processed_at is not null)
    or (processing_status not in ('PROCESSED', 'IGNORED') and processed_at is null)
  ),
  constraint signing_webhook_events_failure_check check (
    (
      processing_status = 'FAILED'
      and last_error_code is not null
      and last_error_message is not null
      and last_error_at is not null
    ) or processing_status <> 'FAILED'
  )
);

create index signing_webhook_events_request_idx
  on public.signing_webhook_events (signing_request_id, created_at);

create trigger signing_webhook_events_set_updated_at
before update on public.signing_webhook_events
for each row execute function public.set_updated_at();

create function public.protect_signing_webhook_event_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Signing webhook events cannot be deleted.';
  end if;

  if new.id is distinct from old.id
    or new.provider is distinct from old.provider
    or new.provider_event_id is distinct from old.provider_event_id
    or new.event_type is distinct from old.event_type
    or new.external_request_ref is distinct from old.external_request_ref
    or new.signing_request_id is distinct from old.signing_request_id
    or new.payload_sha256 is distinct from old.payload_sha256
    or new.payload is distinct from old.payload
    or new.created_at is distinct from old.created_at then
    raise exception 'Signing webhook event evidence is immutable.';
  end if;

  return new;
end;
$$;

create trigger signing_webhook_events_protect_identity
before update or delete on public.signing_webhook_events
for each row execute function public.protect_signing_webhook_event_identity();

-- A Treasurer rejection is the only valid way to unlock an approved snapshot.
-- The old snapshot remains recoverable through the immutable PDF and signing rows.
create or replace function public.protect_approved_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  is_treasurer_rejection boolean;
begin
  is_treasurer_rejection := old.status in ('AWAITING_SIGNATURE', 'ESIGN_FAILED')
    and new.status = 'PENDING_APPROVAL'
    and new.approved_by is null
    and new.approved_at is null
    and new.approved_snapshot is null
    and new.approved_content_version is null
    and new.unresolved_votes_acknowledged is null
    and new.unsigned_pdf_id is null
    and new.esign_external_ref is null;

  if old.approved_snapshot is not null
    and new.approved_snapshot is distinct from old.approved_snapshot
    and not is_treasurer_rejection then
    raise exception 'The approved meeting snapshot is immutable.';
  end if;
  return new;
end;
$$;

create function public.receive_firma_webhook_event(
  p_provider_event_id text,
  p_event_type text,
  p_external_request_ref text,
  p_payload_sha256 text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleaned_event_id text := nullif(btrim(p_provider_event_id), '');
  cleaned_event_type text := nullif(btrim(p_event_type), '');
  cleaned_external_ref text := nullif(btrim(p_external_request_ref), '');
  stored_event public.signing_webhook_events%rowtype;
  signing_request public.meeting_signing_requests%rowtype;
  initial_status public.signing_webhook_event_status;
begin
  if cleaned_event_id is null
    or cleaned_event_type is null
    or p_payload_sha256 !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Firma webhook event is invalid.' using errcode = '22023';
  end if;

  select event.* into stored_event
    from public.signing_webhook_events as event
   where event.provider = 'firma'
     and event.provider_event_id = cleaned_event_id
   for update;

  if found then
    if stored_event.payload_sha256 <> p_payload_sha256 then
      return jsonb_build_object(
        'status', 'conflict',
        'eventRecordId', stored_event.id,
        'meetingId', null
      );
    end if;

    return jsonb_build_object(
      'status', case
        when stored_event.processing_status in ('RECEIVED', 'FAILED') then 'retry'
        else 'duplicate'
      end,
      'eventRecordId', stored_event.id,
      'meetingId', (
        select request.meeting_id
          from public.meeting_signing_requests as request
         where request.id = stored_event.signing_request_id
      )
    );
  end if;

  if cleaned_external_ref is not null then
    select request.* into signing_request
      from public.meeting_signing_requests as request
     where request.provider = 'firma'
       and request.external_request_ref = cleaned_external_ref;
  end if;

  initial_status := case
    when signing_request.id is null then 'IGNORED'::public.signing_webhook_event_status
    when cleaned_event_type in (
      'signing_request.completed',
      'signing_request.cancelled',
      'signing_request.expired',
      'signing_request.declined',
      'signing_request.recipient.declined'
    ) then 'RECEIVED'::public.signing_webhook_event_status
    else 'IGNORED'::public.signing_webhook_event_status
  end;

  insert into public.signing_webhook_events (
    provider,
    provider_event_id,
    event_type,
    external_request_ref,
    signing_request_id,
    payload_sha256,
    payload,
    processing_status,
    processed_at
  ) values (
    'firma',
    cleaned_event_id,
    cleaned_event_type,
    cleaned_external_ref,
    signing_request.id,
    p_payload_sha256,
    p_payload,
    initial_status,
    case when initial_status = 'IGNORED' then now() else null end
  )
  returning * into stored_event;

  return jsonb_build_object(
    'status', case when initial_status = 'IGNORED' then 'ignored' else 'accepted' end,
    'eventRecordId', stored_event.id,
    'meetingId', signing_request.meeting_id
  );
end;
$$;

create function public.claim_firma_webhook_event(p_provider_event_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_event public.signing_webhook_events%rowtype;
  signing_request public.meeting_signing_requests%rowtype;
  stored_meeting public.meetings%rowtype;
  generated_run_id uuid;
  returned_attempt integer;
begin
  select event.* into stored_event
    from public.signing_webhook_events as event
   where event.provider = 'firma'
     and event.provider_event_id = nullif(btrim(p_provider_event_id), '')
   for update;

  if not found then
    return jsonb_build_object('status', 'not_found', 'eventId', p_provider_event_id, 'attempt', null);
  end if;
  if stored_event.processing_status in ('PROCESSED', 'IGNORED') then
    return jsonb_build_object('status', 'already_completed', 'eventId', p_provider_event_id, 'attempt', stored_event.attempt);
  end if;
  if stored_event.processing_status = 'PROCESSING' then
    return jsonb_build_object('status', 'already_processing', 'eventId', p_provider_event_id, 'attempt', stored_event.attempt);
  end if;

  select request.* into signing_request
    from public.meeting_signing_requests as request
   where request.id = stored_event.signing_request_id
   for update;

  if not found then
    update public.signing_webhook_events
       set processing_status = 'IGNORED', processed_at = now()
     where id = stored_event.id;
    return jsonb_build_object('status', 'stale', 'eventId', p_provider_event_id, 'attempt', stored_event.attempt);
  end if;

  select meeting.* into stored_meeting
    from public.meetings as meeting
   where meeting.id = signing_request.meeting_id
   for update;

  if not found
    or stored_meeting.unsigned_pdf_id is distinct from signing_request.pdf_id
    or stored_meeting.esign_external_ref is distinct from signing_request.external_request_ref
    or stored_meeting.status not in ('AWAITING_SIGNATURE', 'ESIGN_FAILED')
    or signing_request.delivery_status <> 'DELIVERED'
    or signing_request.outcome_status not in ('AWAITING', 'COMPLETION_FAILED') then
    update public.signing_webhook_events
       set processing_status = 'IGNORED', processed_at = now()
     where id = stored_event.id;
    return jsonb_build_object('status', 'stale', 'eventId', p_provider_event_id, 'attempt', stored_event.attempt);
  end if;

  generated_run_id := gen_random_uuid();
  update public.meeting_signing_requests
     set outcome_status = 'PROCESSING',
         outcome_run_id = generated_run_id,
         outcome_started_at = now(),
         outcome_attempt = outcome_attempt + 1,
         last_error_code = null,
         last_error_message = null,
         last_error_at = null
   where id = signing_request.id
   returning outcome_attempt into returned_attempt;

  update public.signing_webhook_events
     set processing_status = 'PROCESSING',
         run_id = generated_run_id,
         started_at = now(),
         attempt = attempt + 1,
         last_error_code = null,
         last_error_message = null,
         last_error_at = null
   where id = stored_event.id;

  return jsonb_build_object(
    'status', 'claimed',
    'eventId', stored_event.provider_event_id,
    'eventRecordId', stored_event.id,
    'meetingId', signing_request.meeting_id,
    'requestId', signing_request.id,
    'externalRequestId', signing_request.external_request_ref,
    'documentVersion', signing_request.document_version,
    'runId', generated_run_id,
    'attempt', returned_attempt
  );
end;
$$;

create function public.claim_meeting_signing_reconciliation(p_meeting_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_meeting public.meetings%rowtype;
  signing_request public.meeting_signing_requests%rowtype;
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

  select request.* into signing_request
    from public.meeting_signing_requests as request
   where request.meeting_id = p_meeting_id
     and request.pdf_id = stored_meeting.unsigned_pdf_id
     and request.provider = 'firma'
   for update;

  if not found
    or stored_meeting.status not in ('AWAITING_SIGNATURE', 'ESIGN_FAILED')
    or stored_meeting.esign_external_ref is distinct from signing_request.external_request_ref
    or signing_request.delivery_status <> 'DELIVERED' then
    return jsonb_build_object('status', 'protected', 'meetingId', p_meeting_id, 'attempt', null);
  end if;
  if signing_request.outcome_status = 'PROCESSING' or signing_request.outcome_status = 'REJECTING' then
    return jsonb_build_object('status', 'already_processing', 'meetingId', p_meeting_id, 'attempt', signing_request.outcome_attempt);
  end if;
  if signing_request.outcome_status = 'READY_FOR_ARCHIVE' then
    return jsonb_build_object('status', 'already_completed', 'meetingId', p_meeting_id, 'attempt', signing_request.outcome_attempt);
  end if;
  if signing_request.outcome_status not in ('AWAITING', 'COMPLETION_FAILED') then
    return jsonb_build_object('status', 'protected', 'meetingId', p_meeting_id, 'attempt', signing_request.outcome_attempt);
  end if;

  generated_run_id := gen_random_uuid();
  update public.meeting_signing_requests
     set outcome_status = 'PROCESSING',
         outcome_run_id = generated_run_id,
         outcome_started_at = now(),
         outcome_attempt = outcome_attempt + 1,
         last_error_code = null,
         last_error_message = null,
         last_error_at = null
   where id = signing_request.id
   returning outcome_attempt into returned_attempt;

  return jsonb_build_object(
    'status', 'claimed',
    'eventId', null,
    'eventRecordId', null,
    'meetingId', p_meeting_id,
    'requestId', signing_request.id,
    'externalRequestId', signing_request.external_request_ref,
    'documentVersion', signing_request.document_version,
    'runId', generated_run_id,
    'attempt', returned_attempt
  );
end;
$$;

create function public.complete_meeting_signing_outcome(
  p_request_id uuid,
  p_run_id uuid,
  p_event_record_id uuid,
  p_provider_status text,
  p_recipient_ref text,
  p_recipient_email text,
  p_provider_completed_at timestamptz,
  p_signed_document_sha256 text,
  p_signed_document_size_bytes bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  signing_request public.meeting_signing_requests%rowtype;
  stored_meeting public.meetings%rowtype;
  treasurer_id uuid;
begin
  if p_signed_document_sha256 !~ '^[a-f0-9]{64}$'
    or p_signed_document_size_bytes <= 0
    or p_provider_completed_at is null then
    raise exception 'Signed PDF metadata is invalid.' using errcode = '22023';
  end if;

  select request.* into signing_request
    from public.meeting_signing_requests as request
   where request.id = p_request_id
   for update;
  if not found then return 'not_found'; end if;
  if signing_request.outcome_status <> 'PROCESSING'
    or signing_request.outcome_run_id is distinct from p_run_id then
    return 'stale';
  end if;

  select meeting.* into stored_meeting
    from public.meetings as meeting
   where meeting.id = signing_request.meeting_id
   for update;
  if not found
    or stored_meeting.status not in ('AWAITING_SIGNATURE', 'ESIGN_FAILED')
    or stored_meeting.unsigned_pdf_id is distinct from signing_request.pdf_id
    or stored_meeting.esign_external_ref is distinct from signing_request.external_request_ref then
    return 'stale';
  end if;

  select profile.id into treasurer_id
    from public.profiles as profile
   where profile.account_type = 'MEMBER'
     and profile.member_role = 'TREASURER'
     and profile.account_status = 'ACTIVE';
  if treasurer_id is null then
    raise exception 'An active Treasurer profile is required.' using errcode = '22023';
  end if;

  update public.meeting_signing_requests
     set outcome_status = 'READY_FOR_ARCHIVE',
         outcome_run_id = null,
         outcome_started_at = null,
         recipient_ref = nullif(btrim(p_recipient_ref), ''),
         recipient_email = lower(nullif(btrim(p_recipient_email), '')),
         provider_status = left(coalesce(nullif(btrim(p_provider_status), ''), 'finished'), 100),
         provider_completed_at = p_provider_completed_at,
         signed_document_sha256 = p_signed_document_sha256,
         signed_document_size_bytes = p_signed_document_size_bytes,
         last_error_code = null,
         last_error_message = null,
         last_error_at = null
   where id = signing_request.id;

  update public.meetings
     set status = 'AWAITING_SIGNATURE',
         signed_by = treasurer_id,
         signed_at = p_provider_completed_at,
         last_error_code = null,
         last_error_message = null,
         last_error_at = null
   where id = stored_meeting.id;

  if not exists (
    select 1 from public.review_history as history
     where history.meeting_id = stored_meeting.id and history.action = 'SIGNED'
  ) then
    insert into public.review_history (meeting_id, actor_profile_id, action)
    values (stored_meeting.id, treasurer_id, 'SIGNED');
  end if;

  if p_event_record_id is not null then
    update public.signing_webhook_events
       set processing_status = 'PROCESSED',
           run_id = null,
           started_at = null,
           processed_at = now(),
           last_error_code = null,
           last_error_message = null,
           last_error_at = null
     where id = p_event_record_id
       and run_id = p_run_id;
  end if;

  return 'saved';
end;
$$;

create function public.complete_meeting_signing_no_change(
  p_request_id uuid,
  p_run_id uuid,
  p_event_record_id uuid,
  p_provider_status text,
  p_recipient_ref text,
  p_recipient_email text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  signing_request public.meeting_signing_requests%rowtype;
begin
  update public.meeting_signing_requests
     set outcome_status = 'AWAITING',
         outcome_run_id = null,
         outcome_started_at = null,
         recipient_ref = coalesce(nullif(btrim(p_recipient_ref), ''), recipient_ref),
         recipient_email = coalesce(lower(nullif(btrim(p_recipient_email), '')), recipient_email),
         provider_status = left(coalesce(nullif(btrim(p_provider_status), ''), 'in_progress'), 100),
         last_error_code = null,
         last_error_message = null,
         last_error_at = null
   where id = p_request_id
     and outcome_status = 'PROCESSING'
     and outcome_run_id = p_run_id
   returning * into signing_request;
  if not found then return 'stale'; end if;

  update public.meetings
     set status = 'AWAITING_SIGNATURE',
         last_error_code = null,
         last_error_message = null,
         last_error_at = null
   where id = signing_request.meeting_id
     and status in ('AWAITING_SIGNATURE', 'ESIGN_FAILED')
     and unsigned_pdf_id = signing_request.pdf_id;

  if p_event_record_id is not null then
    update public.signing_webhook_events
       set processing_status = 'PROCESSED',
           run_id = null,
           started_at = null,
           processed_at = now(),
           last_error_code = null,
           last_error_message = null,
           last_error_at = null
     where id = p_event_record_id
       and run_id = p_run_id;
  end if;
  return 'saved';
end;
$$;

create function public.record_meeting_signing_outcome_failure(
  p_request_id uuid,
  p_run_id uuid,
  p_event_record_id uuid,
  p_provider_status text,
  p_error_code text,
  p_error_message text,
  p_retryable boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  signing_request public.meeting_signing_requests%rowtype;
  cleaned_code text := left(coalesce(nullif(btrim(p_error_code), ''), 'esign_completion_failed'), 200);
  cleaned_message text := left(coalesce(nullif(btrim(p_error_message), ''), 'Signing completion failed.'), 2000);
  failure_time timestamptz := now();
begin
  select request.* into signing_request
    from public.meeting_signing_requests as request
   where request.id = p_request_id
   for update;
  if not found then return 'not_found'; end if;
  if signing_request.outcome_status <> 'PROCESSING'
    or signing_request.outcome_run_id is distinct from p_run_id then
    return 'stale';
  end if;

  update public.meeting_signing_requests
     set outcome_status = 'COMPLETION_FAILED',
         outcome_run_id = null,
         outcome_started_at = null,
         provider_status = left(nullif(btrim(p_provider_status), ''), 100),
         last_error_code = cleaned_code,
         last_error_message = cleaned_message,
         last_error_at = failure_time
   where id = signing_request.id;

  update public.meetings
     set status = 'ESIGN_FAILED',
         last_error_code = cleaned_code,
         last_error_message = cleaned_message,
         last_error_at = failure_time
   where id = signing_request.meeting_id
     and status in ('AWAITING_SIGNATURE', 'ESIGN_FAILED')
     and unsigned_pdf_id = signing_request.pdf_id;

  if p_event_record_id is not null then
    update public.signing_webhook_events
       set processing_status = case
         when p_retryable then 'FAILED'::public.signing_webhook_event_status
         else 'PROCESSED'::public.signing_webhook_event_status
       end,
           run_id = null,
           started_at = null,
           processed_at = case when p_retryable then null else now() end,
           last_error_code = case when p_retryable then cleaned_code else null end,
           last_error_message = case when p_retryable then cleaned_message else null end,
           last_error_at = case when p_retryable then failure_time else null end
     where id = p_event_record_id
       and run_id = p_run_id;
  end if;

  return 'failed';
end;
$$;

create function public.get_meeting_signing_session(p_meeting_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when meeting.id is null then jsonb_build_object('status', 'not_found', 'meetingId', p_meeting_id)
    when request.id is null
      or meeting.status not in ('AWAITING_SIGNATURE', 'ESIGN_FAILED')
      or meeting.unsigned_pdf_id is distinct from request.pdf_id
      or meeting.esign_external_ref is distinct from request.external_request_ref
      or request.delivery_status <> 'DELIVERED'
      or request.outcome_status not in ('AWAITING', 'COMPLETION_FAILED')
      then jsonb_build_object('status', 'invalid_state', 'meetingId', p_meeting_id)
    else jsonb_build_object(
      'status', 'available',
      'meetingId', meeting.id,
      'requestId', request.id,
      'externalRequestId', request.external_request_ref,
      'documentVersion', request.document_version,
      'outcomeStatus', request.outcome_status,
      'recipientEmail', request.recipient_email
    )
  end
  from (select p_meeting_id as lookup_id) as input
  left join public.meetings as meeting on meeting.id = input.lookup_id
  left join public.meeting_signing_requests as request
    on request.meeting_id = meeting.id
   and request.pdf_id = meeting.unsigned_pdf_id
   and request.provider = 'firma';
$$;

create function public.claim_meeting_signing_rejection(
  p_meeting_id uuid,
  p_expected_version integer,
  p_actor_profile_id uuid,
  p_comment text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_meeting public.meetings%rowtype;
  signing_request public.meeting_signing_requests%rowtype;
  cleaned_comment text := nullif(btrim(p_comment), '');
  generated_run_id uuid;
begin
  select meeting.* into stored_meeting
    from public.meetings as meeting
   where meeting.id = p_meeting_id
   for update;
  if not found then
    return jsonb_build_object('status', 'not_found', 'meetingId', p_meeting_id, 'version', null);
  end if;
  if not exists (
    select 1 from public.profiles as profile
     where profile.id = p_actor_profile_id
       and profile.account_type = 'MEMBER'
       and profile.member_role = 'TREASURER'
       and profile.account_status = 'ACTIVE'
  ) then
    return jsonb_build_object('status', 'invalid_actor', 'meetingId', p_meeting_id, 'version', stored_meeting.version);
  end if;
  if cleaned_comment is null then
    return jsonb_build_object('status', 'comment_required', 'meetingId', p_meeting_id, 'version', stored_meeting.version);
  end if;
  if stored_meeting.version <> p_expected_version then
    return jsonb_build_object('status', 'conflict', 'meetingId', p_meeting_id, 'version', stored_meeting.version);
  end if;

  select request.* into signing_request
    from public.meeting_signing_requests as request
   where request.meeting_id = p_meeting_id
     and request.pdf_id = stored_meeting.unsigned_pdf_id
     and request.provider = 'firma'
   for update;

  if not found
    or stored_meeting.status not in ('AWAITING_SIGNATURE', 'ESIGN_FAILED')
    or stored_meeting.esign_external_ref is distinct from signing_request.external_request_ref
    or signing_request.delivery_status <> 'DELIVERED'
    or signing_request.outcome_status not in ('AWAITING', 'COMPLETION_FAILED', 'REJECTION_FAILED') then
    return jsonb_build_object('status', 'invalid_state', 'meetingId', p_meeting_id, 'version', stored_meeting.version);
  end if;

  generated_run_id := gen_random_uuid();
  update public.meeting_signing_requests
     set outcome_status = 'REJECTING',
         outcome_run_id = generated_run_id,
         outcome_started_at = now(),
         outcome_attempt = outcome_attempt + 1,
         rejection_comment = left(cleaned_comment, 2000),
         rejected_by = p_actor_profile_id,
         rejected_at = null,
         last_error_code = null,
         last_error_message = null,
         last_error_at = null
   where id = signing_request.id;

  return jsonb_build_object(
    'status', 'claimed',
    'meetingId', p_meeting_id,
    'requestId', signing_request.id,
    'externalRequestId', signing_request.external_request_ref,
    'runId', generated_run_id,
    'version', stored_meeting.version,
    'documentVersion', signing_request.document_version
  );
end;
$$;

create function public.complete_meeting_signing_rejection(
  p_request_id uuid,
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  signing_request public.meeting_signing_requests%rowtype;
  returned_version integer;
begin
  select request.* into signing_request
    from public.meeting_signing_requests as request
   where request.id = p_request_id
   for update;
  if not found then
    return jsonb_build_object('status', 'not_found', 'meetingId', null, 'version', null);
  end if;
  if signing_request.outcome_status <> 'REJECTING'
    or signing_request.outcome_run_id is distinct from p_run_id then
    return jsonb_build_object('status', 'stale', 'meetingId', signing_request.meeting_id, 'version', null);
  end if;

  perform 1 from public.meetings as meeting
   where meeting.id = signing_request.meeting_id
     and meeting.status in ('AWAITING_SIGNATURE', 'ESIGN_FAILED')
     and meeting.unsigned_pdf_id = signing_request.pdf_id
     and meeting.esign_external_ref = signing_request.external_request_ref
   for update;
  if not found then
    return jsonb_build_object('status', 'stale', 'meetingId', signing_request.meeting_id, 'version', null);
  end if;

  update public.meeting_signing_requests
     set outcome_status = 'REJECTED',
         outcome_run_id = null,
         outcome_started_at = null,
         provider_status = 'cancelled',
         rejected_at = now(),
         last_error_code = null,
         last_error_message = null,
         last_error_at = null
   where id = signing_request.id;

  update public.meetings
     set status = 'PENDING_APPROVAL',
         approved_by = null,
         approved_at = null,
         approved_snapshot = null,
         approved_content_version = null,
         unresolved_votes_acknowledged = null,
         unsigned_pdf_id = null,
         pdf_run_id = null,
         pdf_started_at = null,
         esign_external_ref = null,
         signed_by = null,
         signed_at = null,
         signed_pdf_path = null,
         human_owned = true,
         last_error_code = null,
         last_error_message = null,
         last_error_at = null
   where id = signing_request.meeting_id
   returning version into returned_version;

  insert into public.review_history (meeting_id, actor_profile_id, action, note)
  values (
    signing_request.meeting_id,
    signing_request.rejected_by,
    'TREASURER_REJECTED',
    signing_request.rejection_comment
  );

  return jsonb_build_object(
    'status', 'rejected',
    'meetingId', signing_request.meeting_id,
    'version', returned_version,
    'documentVersion', signing_request.document_version
  );
end;
$$;

create function public.record_meeting_signing_rejection_failure(
  p_request_id uuid,
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
  cleaned_code text := left(coalesce(nullif(btrim(p_error_code), ''), 'esign_rejection_failed'), 200);
  cleaned_message text := left(coalesce(nullif(btrim(p_error_message), ''), 'Signing rejection failed.'), 2000);
  failure_time timestamptz := now();
begin
  select request.* into signing_request
    from public.meeting_signing_requests as request
   where request.id = p_request_id
   for update;
  if not found then return 'not_found'; end if;
  if signing_request.outcome_status <> 'REJECTING'
    or signing_request.outcome_run_id is distinct from p_run_id then
    return 'stale';
  end if;

  update public.meeting_signing_requests
     set outcome_status = 'REJECTION_FAILED',
         outcome_run_id = null,
         outcome_started_at = null,
         last_error_code = cleaned_code,
         last_error_message = cleaned_message,
         last_error_at = failure_time
   where id = signing_request.id;

  update public.meetings
     set status = 'ESIGN_FAILED',
         last_error_code = cleaned_code,
         last_error_message = cleaned_message,
         last_error_at = failure_time
   where id = signing_request.meeting_id
     and status in ('AWAITING_SIGNATURE', 'ESIGN_FAILED')
     and unsigned_pdf_id = signing_request.pdf_id;
  return 'failed';
end;
$$;

create function public.retry_meeting_signing_outcome(
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
    return jsonb_build_object('status', 'not_found', 'meetingId', p_meeting_id, 'version', null);
  end if;
  if not exists (
    select 1 from public.profiles as profile
     where profile.id = p_actor_profile_id
       and profile.account_type = 'MEMBER'
       and profile.member_role = 'TREASURER'
       and profile.account_status = 'ACTIVE'
  ) then
    return jsonb_build_object('status', 'invalid_actor', 'meetingId', p_meeting_id, 'version', stored_meeting.version);
  end if;
  if stored_meeting.version <> p_expected_version then
    return jsonb_build_object('status', 'conflict', 'meetingId', p_meeting_id, 'version', stored_meeting.version);
  end if;

  select request.* into signing_request
    from public.meeting_signing_requests as request
   where request.meeting_id = p_meeting_id
     and request.pdf_id = stored_meeting.unsigned_pdf_id
     and request.provider = 'firma'
   for update;
  if not found
    or stored_meeting.status <> 'ESIGN_FAILED'
    or signing_request.delivery_status <> 'DELIVERED'
    or signing_request.outcome_status <> 'COMPLETION_FAILED' then
    return jsonb_build_object('status', 'invalid_state', 'meetingId', p_meeting_id, 'version', stored_meeting.version);
  end if;

  update public.meeting_signing_requests
     set outcome_status = 'AWAITING',
         last_error_code = null,
         last_error_message = null,
         last_error_at = null
   where id = signing_request.id;

  update public.meetings
     set status = 'AWAITING_SIGNATURE',
         last_error_code = null,
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
    'documentVersion', signing_request.document_version
  );
end;
$$;

comment on table public.signing_webhook_events
  is 'Immutable Firma webhook evidence with durable idempotent processing state.';
comment on function public.claim_meeting_signing_reconciliation(uuid)
  is 'Claims provider reconciliation for a missed signing callback.';
comment on function public.complete_meeting_signing_outcome(uuid, uuid, uuid, text, text, text, timestamptz, text, bigint)
  is 'Records a verified signed PDF as ready for the separate archive workflow.';
comment on function public.claim_meeting_signing_rejection(uuid, integer, uuid, text)
  is 'Validates a Treasurer rejection and locks it while the Firma request is cancelled.';

revoke all on table public.signing_webhook_events from public, anon, authenticated;
revoke all on function public.protect_signing_webhook_event_identity() from public, anon, authenticated;
revoke all on function public.receive_firma_webhook_event(text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.claim_firma_webhook_event(text) from public, anon, authenticated;
revoke all on function public.claim_meeting_signing_reconciliation(uuid) from public, anon, authenticated;
revoke all on function public.complete_meeting_signing_outcome(uuid, uuid, uuid, text, text, text, timestamptz, text, bigint) from public, anon, authenticated;
revoke all on function public.complete_meeting_signing_no_change(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.record_meeting_signing_outcome_failure(uuid, uuid, uuid, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.get_meeting_signing_session(uuid) from public, anon, authenticated;
revoke all on function public.claim_meeting_signing_rejection(uuid, integer, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_meeting_signing_rejection(uuid, uuid) from public, anon, authenticated;
revoke all on function public.record_meeting_signing_rejection_failure(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.retry_meeting_signing_outcome(uuid, integer, uuid) from public, anon, authenticated;

grant select, insert, update on table public.signing_webhook_events to service_role;
grant execute on function public.receive_firma_webhook_event(text, text, text, text, jsonb) to service_role;
grant execute on function public.claim_firma_webhook_event(text) to service_role;
grant execute on function public.claim_meeting_signing_reconciliation(uuid) to service_role;
grant execute on function public.complete_meeting_signing_outcome(uuid, uuid, uuid, text, text, text, timestamptz, text, bigint) to service_role;
grant execute on function public.complete_meeting_signing_no_change(uuid, uuid, uuid, text, text, text) to service_role;
grant execute on function public.record_meeting_signing_outcome_failure(uuid, uuid, uuid, text, text, text, boolean) to service_role;
grant execute on function public.get_meeting_signing_session(uuid) to service_role;
grant execute on function public.claim_meeting_signing_rejection(uuid, integer, uuid, text) to service_role;
grant execute on function public.complete_meeting_signing_rejection(uuid, uuid) to service_role;
grant execute on function public.record_meeting_signing_rejection_failure(uuid, uuid, text, text) to service_role;
grant execute on function public.retry_meeting_signing_outcome(uuid, integer, uuid) to service_role;

commit;
