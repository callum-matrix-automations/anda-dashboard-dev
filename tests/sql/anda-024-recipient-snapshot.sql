-- Local-only regression check after the fake-provider signing integration suite.
-- Everything is rolled back, including the temporary Treasurer role change.
begin;
do $$
declare
  request public.meeting_signing_requests%rowtype;
  processing_run uuid := gen_random_uuid();
  result text;
  replacement uuid := '10000000-0000-4000-8000-000000000003';
begin
  select r.* into request from public.meeting_signing_requests r
    join public.meetings m on m.id=r.meeting_id and m.unsigned_pdf_id=r.pdf_id
    where r.external_request_ref like 'fake-firma-request-%'
      and r.recipient_profile_id='10000000-0000-4000-8000-000000000006'
      and r.outcome_status='AWAITING' and r.delivery_status='DELIVERED'
      and m.status='AWAITING_SIGNATURE' and m.signed_at is null
    order by r.created_at desc limit 1 for update of r;
  if not found then raise exception 'Run the local fake-provider signing integration suite first.'; end if;

  begin
    update public.meeting_signing_requests set expected_recipient_email='replacement@example.test' where id=request.id;
    raise exception 'Recipient identity was unexpectedly mutable.';
  exception when sqlstate '55000' then null;
  end;

  update public.profiles set member_role='USER' where id=request.recipient_profile_id;
  update public.profiles set member_role='TREASURER' where id=replacement;
  update public.meeting_signing_requests set outcome_status='PROCESSING', outcome_run_id=processing_run,
    outcome_started_at=now() where id=request.id;
  result := public.complete_meeting_signing_outcome(request.id,processing_run,null,'finished','fake-recipient',
    request.expected_recipient_email,now(),repeat('a',64),1234);
  if result <> 'saved' then raise exception 'Snapshot completion failed: %',result; end if;
  if (select signed_by from public.meetings where id=request.meeting_id) is distinct from request.recipient_profile_id then
    raise exception 'Completion incorrectly attributed the signature to the replacement Treasurer.';
  end if;
  if not exists (select 1 from public.review_history where meeting_id=request.meeting_id
    and action='SIGNED' and actor_profile_id=request.recipient_profile_id) then
    raise exception 'Signature history does not match the original recipient.';
  end if;
  raise notice 'Recipient immutability and original-signer attribution passed.';
end;
$$;
rollback;
