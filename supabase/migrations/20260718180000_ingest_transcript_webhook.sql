begin;

-- Import the provider-neutral webhook payload as one atomic database operation.
-- The source identifiers provide durable idempotency while the generated UUID
-- remains the internal relationship key between meetings and transcripts.
create or replace function public.ingest_transcript_webhook(
  p_source_meeting_id text,
  p_title text,
  p_meeting_date date,
  p_source_transcript_id text,
  p_content text
)
returns table (
  ingestion_status text,
  meeting_id uuid,
  transcript_id uuid,
  imported_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_source_meeting_id text;
  existing_content text;
  stored_meeting_id uuid;
  stored_transcript_id uuid;
  stored_imported_at timestamptz;
begin
  if nullif(btrim(p_source_meeting_id), '') is null
    or nullif(btrim(p_source_transcript_id), '') is null
    or nullif(btrim(p_title), '') is null
    or nullif(btrim(p_content), '') is null
    or p_meeting_date is null then
    raise exception 'Transcript import fields must not be blank.'
      using errcode = '22023';
  end if;

  select meeting.source_meeting_id, transcript.meeting_id, transcript.id,
         transcript.content, transcript.imported_at
    into existing_source_meeting_id, stored_meeting_id, stored_transcript_id,
         existing_content, stored_imported_at
    from public.transcripts as transcript
    join public.meetings as meeting on meeting.id = transcript.meeting_id
    where transcript.source_transcript_id = p_source_transcript_id;

  if found then
    if existing_source_meeting_id is distinct from p_source_meeting_id
      or existing_content is distinct from p_content then
      raise exception 'Source transcript identifier conflicts with immutable evidence.'
        using errcode = '23505';
    end if;

    return query select 'duplicate'::text, stored_meeting_id,
      stored_transcript_id, stored_imported_at;
    return;
  end if;

  select meeting.id
    into stored_meeting_id
    from public.meetings as meeting
    where meeting.source_meeting_id = p_source_meeting_id;

  if found then
    if exists (
      select 1 from public.transcripts as transcript
      where transcript.meeting_id = stored_meeting_id
    ) then
      raise exception 'Source meeting already has a different transcript.'
        using errcode = '23505';
    end if;
  else
    insert into public.meetings (
      source_meeting_id,
      title,
      meeting_date,
      status
    ) values (
      p_source_meeting_id,
      p_title,
      p_meeting_date,
      'AI_PROCESSING'
    )
    returning id into stored_meeting_id;
  end if;

  insert into public.transcripts as inserted_transcript (
    meeting_id,
    source_transcript_id,
    content,
    metadata
  ) values (
    stored_meeting_id,
    p_source_transcript_id,
    p_content,
    '{}'::jsonb
  )
  returning inserted_transcript.id, inserted_transcript.imported_at
    into stored_transcript_id, stored_imported_at;

  return query select 'received'::text, stored_meeting_id,
    stored_transcript_id, stored_imported_at;
exception
  when unique_violation then
    -- A concurrent delivery may have committed the same immutable transcript
    -- after this transaction checked for it. The exception rolls back any
    -- meeting inserted above before this handler verifies the winning row.
    select meeting.source_meeting_id, transcript.meeting_id, transcript.id,
           transcript.content, transcript.imported_at
      into existing_source_meeting_id, stored_meeting_id, stored_transcript_id,
           existing_content, stored_imported_at
      from public.transcripts as transcript
      join public.meetings as meeting on meeting.id = transcript.meeting_id
      where transcript.source_transcript_id = p_source_transcript_id;

    if found
      and existing_source_meeting_id = p_source_meeting_id
      and existing_content = p_content then
      return query select 'duplicate'::text, stored_meeting_id,
        stored_transcript_id, stored_imported_at;
      return;
    end if;

    raise;
end;
$$;

comment on function public.ingest_transcript_webhook(text, text, date, text, text)
  is 'Atomically creates an AI_PROCESSING meeting and its immutable source transcript.';

revoke execute on function public.ingest_transcript_webhook(text, text, date, text, text)
  from public, anon, authenticated;
grant execute on function public.ingest_transcript_webhook(text, text, date, text, text)
  to service_role;

-- Browser roles retain their existing RLS policies and grants. The server-only
-- service role needs read access for subsequent processing of imported evidence.
grant select on table public.meetings to service_role;
grant select on table public.transcripts to service_role;

commit;
