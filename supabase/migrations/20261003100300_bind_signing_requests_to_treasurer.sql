begin;
alter table public.meeting_signing_requests add column recipient_profile_id uuid references public.profiles(id) on delete restrict,
  add column recipient_first_name text,
  add column recipient_last_name text,
  add column expected_recipient_email text,
  add constraint signing_recipient_snapshot_complete check (
    (recipient_profile_id is null and recipient_first_name is null and recipient_last_name is null and expected_recipient_email is null)
    or (recipient_profile_id is not null and recipient_first_name is not null and recipient_last_name is not null and length(btrim(recipient_first_name)) > 0 and length(btrim(recipient_last_name)) > 0
      and expected_recipient_email is not null and expected_recipient_email = lower(btrim(expected_recipient_email))));

-- Existing provider requests are deliberately not assigned to today's Treasurer.
-- An operator must verify the actual recipient before any legacy snapshot backfill.
create function public.protect_signing_recipient_snapshot() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.recipient_profile_id is not null and
    row(new.recipient_profile_id,new.recipient_first_name,new.recipient_last_name,new.expected_recipient_email)
      is distinct from row(old.recipient_profile_id,old.recipient_first_name,old.recipient_last_name,old.expected_recipient_email) then
    raise exception 'Signing recipient snapshot is immutable.' using errcode='55000';
  end if;
  return new;
end;
$$;
create trigger signing_recipient_snapshot_immutable before update on public.meeting_signing_requests
for each row execute function public.protect_signing_recipient_snapshot();
create or replace function public.claim_meeting_signing_delivery(p_meeting_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  stored_meeting public.meetings%rowtype;
  stored_pdf public.meeting_pdfs%rowtype;
  signing_request public.meeting_signing_requests%rowtype;
  generated_run_id uuid;
  returned_attempt integer;
  deterministic_name text;
  recipient public.profiles%rowtype;
begin
  select meeting.* into stored_meeting
    from public.meetings as meeting
   where meeting.id = p_meeting_id
   for update;

  if not found then
    return jsonb_build_object('status', 'not_found', 'meetingId', p_meeting_id, 'attempt', null);
  end if;

  if stored_meeting.discarded_at is not null then return jsonb_build_object('status','protected','meetingId',p_meeting_id,'attempt',null); end if;
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
    select * into recipient from public.profiles where account_type='MEMBER' and member_role='TREASURER' and account_status='ACTIVE';
    if recipient.id is null or recipient.email is null or recipient.signing_first_name is null or recipient.signing_last_name is null then
      raise exception 'Treasurer signing identity is not configured.' using errcode='22023';
    end if;
    insert into public.meeting_signing_requests (
      meeting_id,
      pdf_id,
      document_version,
      provider,
      request_name, recipient_profile_id, recipient_first_name, recipient_last_name, expected_recipient_email
    ) values (
      p_meeting_id,
      stored_pdf.id,
      stored_pdf.document_version,
      'firma',
      deterministic_name, recipient.id, recipient.signing_first_name, recipient.signing_last_name, lower(btrim(recipient.email))
    )
    returning * into signing_request;
  end if;

  if signing_request.recipient_profile_id is null then return jsonb_build_object('status','protected','meetingId',p_meeting_id,'attempt',signing_request.attempt); end if;
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
    'recipientProfileId', signing_request.recipient_profile_id,
    'recipient', jsonb_build_object('firstName',signing_request.recipient_first_name,'lastName',signing_request.recipient_last_name,'email',signing_request.expected_recipient_email),
    'requestName', signing_request.request_name,
    'externalRequestId', signing_request.external_request_ref
  );
end;
$$;
create or replace function public.get_meeting_signing_session(p_meeting_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
  select case
    when meeting.id is null then jsonb_build_object('status', 'not_found', 'meetingId', p_meeting_id)
    when meeting.discarded_at is not null or request.recipient_profile_id is null or request.id is null
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
      'recipientProfileId', request.recipient_profile_id,
      'recipientEmail', request.expected_recipient_email
    )
  end
  from (select p_meeting_id as lookup_id) as input
  left join public.meetings as meeting on meeting.id = input.lookup_id
  left join public.meeting_signing_requests as request
    on request.meeting_id = meeting.id
   and request.pdf_id = meeting.unsigned_pdf_id
   and request.provider = 'firma';
$$;
create or replace function public.complete_meeting_signing_outcome(p_request_id uuid, p_run_id uuid, p_event_record_id uuid, p_provider_status text, p_recipient_ref text, p_recipient_email text, p_provider_completed_at timestamp with time zone, p_signed_document_sha256 text, p_signed_document_size_bytes bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
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

  treasurer_id := signing_request.recipient_profile_id;
  if treasurer_id is null or signing_request.expected_recipient_email is distinct from lower(btrim(p_recipient_email)) then
    raise exception 'Signing recipient does not match the request snapshot.' using errcode='22023';
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
create or replace function public.claim_firma_webhook_event(p_provider_event_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
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

  if not found or signing_request.recipient_profile_id is null
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
    'status', 'claimed', 'recipientEmail', signing_request.expected_recipient_email,
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
create or replace function public.claim_meeting_signing_reconciliation(p_meeting_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
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

  if not found or signing_request.recipient_profile_id is null
    or stored_meeting.status not in ('AWAITING_SIGNATURE', 'ESIGN_FAILED')
    or stored_meeting.esign_external_ref is distinct from signing_request.external_request_ref
    or signing_request.delivery_status <> 'DELIVERED' then
    return jsonb_build_object('status', 'protected', 'meetingId', p_meeting_id, 'attempt', null);
  end if;
  if signing_request.outcome_status = 'REJECTING'
    or (
      signing_request.outcome_status = 'PROCESSING'
      and signing_request.outcome_started_at >= now() - interval '10 minutes'
    ) then
    return jsonb_build_object('status', 'already_processing', 'meetingId', p_meeting_id, 'attempt', signing_request.outcome_attempt);
  end if;
  if signing_request.outcome_status = 'READY_FOR_ARCHIVE' then
    return jsonb_build_object('status', 'already_completed', 'meetingId', p_meeting_id, 'attempt', signing_request.outcome_attempt);
  end if;
  if signing_request.outcome_status not in ('AWAITING', 'COMPLETION_FAILED', 'PROCESSING') then
    return jsonb_build_object('status', 'protected', 'meetingId', p_meeting_id, 'attempt', signing_request.outcome_attempt);
  end if;

  generated_run_id := gen_random_uuid();
  update public.meeting_signing_requests
     set outcome_status = 'PROCESSING',
         outcome_run_id = generated_run_id,
         outcome_started_at = now(),
         outcome_attempt = outcome_attempt + 1,
         last_reconciled_at = now(),
         last_error_code = null,
         last_error_message = null,
         last_error_at = null
   where id = signing_request.id
   returning outcome_attempt into returned_attempt;

  return jsonb_build_object(
    'status', 'claimed', 'recipientEmail', signing_request.expected_recipient_email,
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
create or replace function public.claim_meeting_signing_rejection(p_meeting_id uuid, p_expected_version integer, p_actor_profile_id uuid, p_comment text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
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
       and exists (select 1 from public.meeting_signing_requests r where r.meeting_id=p_meeting_id and r.pdf_id=stored_meeting.unsigned_pdf_id and r.recipient_profile_id=p_actor_profile_id)
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
create or replace function public.retry_meeting_signing_outcome(p_meeting_id uuid, p_expected_version integer, p_actor_profile_id uuid)
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
    return jsonb_build_object('status', 'not_found', 'meetingId', p_meeting_id, 'version', null);
  end if;
  if not exists (
    select 1 from public.profiles as profile
     where profile.id = p_actor_profile_id
       and profile.account_type = 'MEMBER'
       and profile.member_role = 'TREASURER'
       and profile.account_status = 'ACTIVE'
       and exists (select 1 from public.meeting_signing_requests r where r.meeting_id=p_meeting_id and r.pdf_id=stored_meeting.unsigned_pdf_id and r.recipient_profile_id=p_actor_profile_id)
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
create or replace function public.claim_stale_signing_reconciliations(p_age_minutes integer DEFAULT 10, p_limit integer DEFAULT 25, p_max_attempts integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  candidate public.meeting_signing_requests%rowtype;
  generated_run_id uuid;
  returned_attempt integer;
  results jsonb := '[]'::jsonb;
  bounded_age integer := greatest(1, least(coalesce(p_age_minutes, 10), 10080));
  bounded_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
  bounded_attempts integer := greatest(1, least(coalesce(p_max_attempts, 5), 20));
begin
  for candidate in
    select request.*
      from public.meeting_signing_requests as request
      join public.meetings as meeting
        on meeting.id = request.meeting_id
       and meeting.unsigned_pdf_id = request.pdf_id
     where request.provider = 'firma'
       and request.delivery_status = 'DELIVERED'
       and request.external_request_ref is not null and request.recipient_profile_id is not null and meeting.discarded_at is null
       and meeting.status in ('AWAITING_SIGNATURE', 'ESIGN_FAILED')
       and request.outcome_attempt < bounded_attempts
       and (
         (
           request.outcome_status in ('AWAITING', 'COMPLETION_FAILED')
           and not (
             request.outcome_status = 'COMPLETION_FAILED'
             and lower(coalesce(request.provider_status, '')) in ('cancelled', 'canceled', 'declined', 'expired')
           )
           and coalesce(request.last_reconciled_at, request.last_error_at, request.sent_at, request.updated_at)
             <= now() - pg_catalog.make_interval(mins => bounded_age)
         ) or (
           request.outcome_status = 'PROCESSING'
           and request.outcome_started_at < now() - interval '10 minutes'
         )
       )
     order by coalesce(request.last_reconciled_at, request.last_error_at, request.sent_at, request.updated_at), request.meeting_id
     for update of request skip locked
     limit bounded_limit
  loop
    generated_run_id := gen_random_uuid();
    update public.meeting_signing_requests
       set outcome_status = 'PROCESSING',
           outcome_run_id = generated_run_id,
           outcome_started_at = now(),
           outcome_attempt = outcome_attempt + 1,
           last_reconciled_at = now(),
           last_error_code = null,
           last_error_message = null,
           last_error_at = null
     where id = candidate.id
     returning outcome_attempt into returned_attempt;

    results := results || jsonb_build_array(jsonb_build_object(
      'status', 'claimed', 'recipientEmail', candidate.expected_recipient_email,
      'eventId', null,
      'eventRecordId', null,
      'meetingId', candidate.meeting_id,
      'requestId', candidate.id,
      'externalRequestId', candidate.external_request_ref,
      'documentVersion', candidate.document_version,
      'runId', generated_run_id,
      'attempt', returned_attempt
    ));
  end loop;
  return results;
end;
$$;
commit;
