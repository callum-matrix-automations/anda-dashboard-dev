-- Keep transcript ingestion provider-neutral while preserving the existing
-- uniqueness and immutability guarantees on source identifiers.
alter table public.meetings
  rename column teams_meeting_id to source_meeting_id;

alter table public.meetings
  rename constraint meetings_teams_meeting_id_key to meetings_source_meeting_id_key;

alter table public.transcripts
  rename column teams_transcript_id to source_transcript_id;

alter table public.transcripts
  rename constraint transcripts_teams_transcript_id_key to transcripts_source_transcript_id_key;

-- PL/pgSQL function bodies are stored as text, so recreate the evidence guard
-- with the renamed transcript identifier.
create or replace function public.protect_transcript_evidence()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  meeting_is_signed boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'Transcripts are source evidence and cannot be deleted.';
  end if;

  if new.id is distinct from old.id
    or new.meeting_id is distinct from old.meeting_id
    or new.source_transcript_id is distinct from old.source_transcript_id
    or new.content is distinct from old.content
    or new.imported_at is distinct from old.imported_at then
    raise exception 'Transcript identity and content are immutable.';
  end if;

  if new.metadata is distinct from old.metadata then
    select meeting.signed_at is not null
      into meeting_is_signed
      from public.meetings as meeting
      where meeting.id = old.meeting_id;

    if meeting_is_signed then
      raise exception 'Transcript metadata cannot change after signing.';
    end if;
  end if;

  return new;
end;
$$;
