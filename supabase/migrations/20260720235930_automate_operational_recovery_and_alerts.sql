begin;

create type public.operational_alert_stage as enum (
  'TRANSCRIPT_IMPORT',
  'AI_ANALYSIS',
  'PDF_GENERATION',
  'SIGNING',
  'ARCHIVE',
  'USER_REPORT'
);

create type public.operational_alert_delivery_status as enum (
  'PENDING',
  'PROCESSING',
  'DELIVERED',
  'FAILED'
);

create table public.operational_alerts (
  id uuid primary key default gen_random_uuid(),
  stage public.operational_alert_stage not null,
  meeting_id uuid references public.meetings (id) on delete restrict,
  entity_ref text,
  failure_code text not null check (btrim(failure_code) <> '' and char_length(failure_code) <= 200),
  workflow_status text check (workflow_status is null or (btrim(workflow_status) <> '' and char_length(workflow_status) <= 100)),
  deduplication_key text not null check (btrim(deduplication_key) <> '' and char_length(deduplication_key) <= 500),
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  delivery_status public.operational_alert_delivery_status not null default 'PENDING',
  delivery_attempt_count integer not null default 0 check (delivery_attempt_count >= 0),
  delivery_run_id uuid,
  delivery_started_at timestamptz,
  next_delivery_at timestamptz not null default now(),
  delivered_at timestamptz,
  last_delivery_error_code text,
  last_delivery_error_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operational_alerts_identity_check check (meeting_id is not null or entity_ref is not null),
  constraint operational_alerts_entity_ref_check check (
    entity_ref is null or (btrim(entity_ref) <> '' and char_length(entity_ref) <= 500)
  ),
  constraint operational_alerts_delivery_run_check check (
    (delivery_status = 'PROCESSING' and delivery_run_id is not null and delivery_started_at is not null)
    or (delivery_status <> 'PROCESSING' and delivery_run_id is null and delivery_started_at is null)
  ),
  constraint operational_alerts_delivery_error_check check (
    (last_delivery_error_code is null and last_delivery_error_at is null)
    or (
      last_delivery_error_code is not null
      and btrim(last_delivery_error_code) <> ''
      and char_length(last_delivery_error_code) <= 200
      and last_delivery_error_at is not null
    )
  )
);

create unique index operational_alerts_unresolved_deduplication_idx
  on public.operational_alerts (deduplication_key)
  where resolved_at is null;

create index operational_alerts_pending_delivery_idx
  on public.operational_alerts (next_delivery_at, first_seen_at, id)
  where resolved_at is null and delivery_status = 'PENDING';

create index operational_alerts_meeting_idx
  on public.operational_alerts (meeting_id, stage, resolved_at);

create trigger operational_alerts_set_updated_at
before update on public.operational_alerts
for each row execute function public.set_updated_at();

create table public.operational_issue_reports (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.operational_alerts (id) on delete restrict,
  meeting_id uuid not null references public.meetings (id) on delete restrict,
  reporter_profile_id uuid not null references public.profiles (id) on delete restrict,
  comment text check (comment is null or (btrim(comment) <> '' and char_length(comment) <= 2000)),
  created_at timestamptz not null default now()
);

create index operational_issue_reports_meeting_idx
  on public.operational_issue_reports (meeting_id, created_at desc);

alter table public.operational_alerts enable row level security;
alter table public.operational_issue_reports enable row level security;
revoke all on table public.operational_alerts from public, anon, authenticated;
revoke all on table public.operational_issue_reports from public, anon, authenticated;
grant select, insert, update on table public.operational_alerts to service_role;
grant select, insert on table public.operational_issue_reports to service_role;

create function public.record_operational_alert(
  p_stage text,
  p_failure_code text,
  p_meeting_id uuid default null,
  p_entity_ref text default null,
  p_workflow_status text default null,
  p_deduplication_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleaned_stage public.operational_alert_stage;
  cleaned_failure_code text := left(nullif(btrim(p_failure_code), ''), 200);
  cleaned_entity_ref text := left(nullif(btrim(p_entity_ref), ''), 500);
  cleaned_workflow_status text := left(nullif(btrim(p_workflow_status), ''), 100);
  cleaned_key text;
  stored_alert public.operational_alerts%rowtype;
  result_status text;
begin
  begin
    cleaned_stage := upper(btrim(p_stage))::public.operational_alert_stage;
  exception when invalid_text_representation then
    raise exception 'Operational alert stage is invalid.' using errcode = '22023';
  end;
  if cleaned_failure_code is null then
    raise exception 'Operational alert failure code is required.' using errcode = '22023';
  end if;
  if p_meeting_id is null and cleaned_entity_ref is null then
    raise exception 'Operational alert identity is required.' using errcode = '22023';
  end if;
  if p_meeting_id is not null and not exists (
    select 1 from public.meetings as meeting where meeting.id = p_meeting_id
  ) then
    raise exception 'Operational alert meeting does not exist.' using errcode = '23503';
  end if;

  cleaned_key := left(coalesce(
    nullif(btrim(p_deduplication_key), ''),
    cleaned_stage::text || ':' || coalesce(p_meeting_id::text, cleaned_entity_ref) || ':' || cleaned_failure_code
  ), 500);

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(cleaned_key));

  select alert.* into stored_alert
    from public.operational_alerts as alert
   where alert.deduplication_key = cleaned_key
     and alert.resolved_at is null
   for update;

  if found then
    update public.operational_alerts
       set occurrence_count = occurrence_count + 1,
           last_seen_at = now(),
           workflow_status = coalesce(cleaned_workflow_status, workflow_status)
     where id = stored_alert.id
     returning * into stored_alert;
    result_status := 'deduplicated';
  else
    insert into public.operational_alerts (
      stage, meeting_id, entity_ref, failure_code, workflow_status, deduplication_key
    ) values (
      cleaned_stage, p_meeting_id, cleaned_entity_ref, cleaned_failure_code,
      cleaned_workflow_status, cleaned_key
    ) returning * into stored_alert;
    result_status := 'created';
  end if;

  return jsonb_build_object(
    'status', result_status,
    'alertId', stored_alert.id,
    'occurrenceCount', stored_alert.occurrence_count,
    'deliveryStatus', stored_alert.delivery_status
  );
end;
$$;

create function public.resolve_operational_alerts(
  p_stage text,
  p_meeting_id uuid default null,
  p_entity_ref text default null,
  p_resolved_at timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleaned_stage public.operational_alert_stage;
  cleaned_entity_ref text := left(nullif(btrim(p_entity_ref), ''), 500);
  resolved_count integer;
begin
  begin
    cleaned_stage := upper(btrim(p_stage))::public.operational_alert_stage;
  exception when invalid_text_representation then
    raise exception 'Operational alert stage is invalid.' using errcode = '22023';
  end;
  if p_meeting_id is null and cleaned_entity_ref is null then
    raise exception 'Operational alert identity is required.' using errcode = '22023';
  end if;

  update public.operational_alerts
     set resolved_at = coalesce(p_resolved_at, now()),
         delivery_status = case when delivery_status = 'PROCESSING' then 'PENDING' else delivery_status end,
         delivery_run_id = null,
         delivery_started_at = null
   where stage = cleaned_stage
     and resolved_at is null
     and (p_meeting_id is null or meeting_id = p_meeting_id)
     and (cleaned_entity_ref is null or entity_ref = cleaned_entity_ref);
  get diagnostics resolved_count = row_count;
  return resolved_count;
end;
$$;

create function public.claim_operational_alert_deliveries(
  p_limit integer default 25,
  p_max_attempts integer default 3
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate public.operational_alerts%rowtype;
  generated_run_id uuid;
  results jsonb := '[]'::jsonb;
  bounded_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
  bounded_attempts integer := greatest(1, least(coalesce(p_max_attempts, 3), 10));
begin
  for candidate in
    select alert.*
     from public.operational_alerts as alert
     where alert.resolved_at is null
       and alert.delivery_attempt_count < bounded_attempts
       and (
         (alert.delivery_status = 'PENDING' and alert.next_delivery_at <= now())
         or (
           alert.delivery_status = 'PROCESSING'
           and alert.delivery_started_at < now() - interval '10 minutes'
         )
       )
     order by coalesce(alert.delivery_started_at, alert.next_delivery_at), alert.first_seen_at, alert.id
     for update skip locked
     limit bounded_limit
  loop
    generated_run_id := gen_random_uuid();
    update public.operational_alerts
       set delivery_status = 'PROCESSING',
           delivery_run_id = generated_run_id,
           delivery_started_at = now(),
           delivery_attempt_count = delivery_attempt_count + 1,
           last_delivery_error_code = null,
           last_delivery_error_at = null
     where id = candidate.id;

    results := results || jsonb_build_array(jsonb_build_object(
      'alertId', candidate.id,
      'runId', generated_run_id,
      'stage', candidate.stage,
      'meetingId', candidate.meeting_id,
      'entityRef', candidate.entity_ref,
      'failureCode', candidate.failure_code,
      'workflowStatus', candidate.workflow_status,
      'occurredAt', candidate.first_seen_at,
      'attempt', candidate.delivery_attempt_count + 1
    ));
  end loop;
  return results;
end;
$$;

create function public.complete_operational_alert_delivery(p_alert_id uuid, p_run_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.operational_alerts
     set delivery_status = 'DELIVERED',
         delivery_run_id = null,
         delivery_started_at = null,
         delivered_at = now(),
         last_delivery_error_code = null,
         last_delivery_error_at = null
   where id = p_alert_id
     and delivery_status = 'PROCESSING'
     and delivery_run_id = p_run_id
     and resolved_at is null;
  if found then return 'saved'; end if;
  if exists (select 1 from public.operational_alerts where id = p_alert_id) then return 'stale'; end if;
  return 'not_found';
end;
$$;

create function public.record_operational_alert_delivery_failure(
  p_alert_id uuid,
  p_run_id uuid,
  p_error_code text,
  p_retry_delay_seconds integer default 30,
  p_max_attempts integer default 3
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_alert public.operational_alerts%rowtype;
  cleaned_code text := left(coalesce(nullif(btrim(p_error_code), ''), 'alert_delivery_failed'), 200);
  bounded_delay integer := greatest(1, least(coalesce(p_retry_delay_seconds, 30), 86400));
  bounded_attempts integer := greatest(1, least(coalesce(p_max_attempts, 3), 10));
begin
  select alert.* into stored_alert
    from public.operational_alerts as alert
   where alert.id = p_alert_id
   for update;
  if not found then return 'not_found'; end if;
  if stored_alert.delivery_status <> 'PROCESSING'
    or stored_alert.delivery_run_id is distinct from p_run_id
    or stored_alert.resolved_at is not null then
    return 'stale';
  end if;

  update public.operational_alerts
     set delivery_status = case
           when delivery_attempt_count >= bounded_attempts then 'FAILED'::public.operational_alert_delivery_status
           else 'PENDING'::public.operational_alert_delivery_status
         end,
         delivery_run_id = null,
         delivery_started_at = null,
         next_delivery_at = now() + pg_catalog.make_interval(secs => bounded_delay),
         last_delivery_error_code = cleaned_code,
         last_delivery_error_at = now()
   where id = stored_alert.id;
  return case when stored_alert.delivery_attempt_count >= bounded_attempts then 'exhausted' else 'retry_scheduled' end;
end;
$$;

create function public.create_operational_issue_report(
  p_meeting_id uuid,
  p_reporter_profile_id uuid,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleaned_comment text := nullif(btrim(p_comment), '');
  alert_result jsonb;
  report_id uuid;
begin
  if cleaned_comment is not null and char_length(cleaned_comment) > 2000 then
    raise exception 'Issue report comment is too long.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.meetings as meeting where meeting.id = p_meeting_id) then
    return jsonb_build_object('status', 'not_found', 'meetingId', p_meeting_id);
  end if;
  if not exists (
    select 1 from public.profiles as profile
     where profile.id = p_reporter_profile_id
       and profile.account_status = 'ACTIVE'
  ) then
    return jsonb_build_object('status', 'invalid_actor', 'meetingId', p_meeting_id);
  end if;

  alert_result := public.record_operational_alert(
    'USER_REPORT',
    'user_reported_issue',
    p_meeting_id,
    null,
    null,
    'USER_REPORT:' || p_meeting_id::text
  );

  insert into public.operational_issue_reports (alert_id, meeting_id, reporter_profile_id, comment)
  values ((alert_result ->> 'alertId')::uuid, p_meeting_id, p_reporter_profile_id, cleaned_comment)
  returning id into report_id;

  return jsonb_build_object(
    'status', 'created',
    'meetingId', p_meeting_id,
    'reportId', report_id,
    'alertId', (alert_result ->> 'alertId')::uuid,
    'alertStatus', alert_result ->> 'status'
  );
end;
$$;

alter table public.meeting_signing_requests
  add column last_reconciled_at timestamptz;

create index meeting_signing_requests_reconciliation_idx
  on public.meeting_signing_requests (outcome_status, last_reconciled_at, sent_at)
  where delivery_status = 'DELIVERED' and external_request_ref is not null;

create function public.claim_stale_signing_reconciliations(
  p_age_minutes integer default 10,
  p_limit integer default 25,
  p_max_attempts integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
       and request.external_request_ref is not null
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
      'status', 'claimed',
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

create function public.list_stale_signing_reconciliation_candidates(
  p_age_minutes integer default 10,
  p_limit integer default 25,
  p_max_attempts integer default 5
)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(jsonb_agg(candidate.meeting_id order by candidate.retry_at, candidate.meeting_id), '[]'::jsonb)
    from (
      select request.meeting_id,
             coalesce(request.outcome_started_at, request.last_reconciled_at, request.last_error_at, request.sent_at, request.updated_at) as retry_at
        from public.meeting_signing_requests as request
        join public.meetings as meeting
          on meeting.id = request.meeting_id
         and meeting.unsigned_pdf_id = request.pdf_id
       where request.provider = 'firma'
         and request.delivery_status = 'DELIVERED'
         and request.external_request_ref is not null
         and meeting.status in ('AWAITING_SIGNATURE', 'ESIGN_FAILED')
         and request.outcome_attempt < greatest(1, least(coalesce(p_max_attempts, 5), 20))
         and request.outcome_status in ('AWAITING', 'COMPLETION_FAILED', 'PROCESSING')
         and not (
           request.outcome_status = 'COMPLETION_FAILED'
           and lower(coalesce(request.provider_status, '')) in ('cancelled', 'canceled', 'declined', 'expired')
         )
         and coalesce(request.outcome_started_at, request.last_reconciled_at, request.last_error_at, request.sent_at, request.updated_at)
           <= now() - pg_catalog.make_interval(mins => greatest(1, least(coalesce(p_age_minutes, 10), 10080)))
       order by retry_at, request.meeting_id
       limit greatest(1, least(coalesce(p_limit, 25), 100))
    ) as candidate;
$$;

create function public.list_operational_archive_recovery_candidates(
  p_limit integer default 25,
  p_max_attempts integer default 3
)
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
       where meeting.status in ('ARCHIVE_FAILED', 'AWAITING_SIGNATURE')
         and meeting.archive_attempt < greatest(1, least(coalesce(p_max_attempts, 3), 20))
         and (meeting.archive_run_id is null or meeting.archive_started_at < now() - interval '10 minutes')
       order by retry_at, meeting.id
       limit greatest(1, least(coalesce(p_limit, 25), 100))
    ) as candidate;
$$;

create or replace function public.claim_meeting_signing_reconciliation(p_meeting_id uuid)
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

revoke all on function public.record_operational_alert(text, text, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.resolve_operational_alerts(text, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_operational_alert_deliveries(integer, integer) from public, anon, authenticated;
revoke all on function public.complete_operational_alert_delivery(uuid, uuid) from public, anon, authenticated;
revoke all on function public.record_operational_alert_delivery_failure(uuid, uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.create_operational_issue_report(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.claim_stale_signing_reconciliations(integer, integer, integer) from public, anon, authenticated;
revoke all on function public.list_stale_signing_reconciliation_candidates(integer, integer, integer) from public, anon, authenticated;
revoke all on function public.list_operational_archive_recovery_candidates(integer, integer) from public, anon, authenticated;

grant execute on function public.record_operational_alert(text, text, uuid, text, text, text) to service_role;
grant execute on function public.resolve_operational_alerts(text, uuid, text, timestamptz) to service_role;
grant execute on function public.claim_operational_alert_deliveries(integer, integer) to service_role;
grant execute on function public.complete_operational_alert_delivery(uuid, uuid) to service_role;
grant execute on function public.record_operational_alert_delivery_failure(uuid, uuid, text, integer, integer) to service_role;
grant execute on function public.create_operational_issue_report(uuid, uuid, text) to service_role;
grant execute on function public.claim_stale_signing_reconciliations(integer, integer, integer) to service_role;
grant execute on function public.list_stale_signing_reconciliation_candidates(integer, integer, integer) to service_role;
grant execute on function public.list_operational_archive_recovery_candidates(integer, integer) to service_role;

comment on table public.operational_alerts
  is 'Durable, deduplicated workflow alerts containing safe operational identifiers only.';
comment on table public.operational_issue_reports
  is 'Authenticated user issue reports; free-text comments are never included in external alert messages.';

commit;
