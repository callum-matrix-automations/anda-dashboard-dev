begin;

create table public.transcript_normalizations (
  id uuid primary key default gen_random_uuid(),
  transcript_id uuid not null references public.transcripts(id) on delete cascade,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  version integer not null check (version > 0),
  method text not null check (method in ('deterministic', 'gpt-6-luna')),
  detected_format text not null check (detected_format in (
    'speaker_colon',
    'timestamp_speaker_blocks',
    'timestamped_speaker_lines',
    'webvtt',
    'srt',
    'unknown'
  )),
  model text,
  response_id text,
  request_id text,
  original_content_hash text not null check (original_content_hash ~ '^[a-f0-9]{64}$'),
  normalized_content_hash text not null check (normalized_content_hash ~ '^[a-f0-9]{64}$'),
  normalized_content text not null check (length(btrim(normalized_content)) > 0),
  participants jsonb not null check (jsonb_typeof(participants) = 'array'),
  possible_aliases jsonb not null check (jsonb_typeof(possible_aliases) = 'array'),
  warnings jsonb not null check (jsonb_typeof(warnings) = 'array'),
  turn_count integer not null check (turn_count > 0),
  attribution_coverage numeric(6, 5) not null check (
    attribution_coverage >= 0 and attribution_coverage <= 1
  ),
  created_at timestamptz not null default now(),
  unique (transcript_id, version)
);

create index transcript_normalizations_meeting_created_idx
  on public.transcript_normalizations (meeting_id, created_at desc, version desc);

comment on table public.transcript_normalizations
  is 'Immutable, versioned transcript normalization audit records. The original evidence remains in transcripts.content.';
comment on column public.transcript_normalizations.normalized_content
  is 'Canonical speaker-labelled text used as AI analysis input; never replaces the source transcript.';

create function public.capture_manual_transcript_normalization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalization jsonb;
begin
  if new.metadata->>'provider' <> 'manual_upload' then
    return new;
  end if;

  normalization := new.metadata->'normalization';
  if normalization is null then
    return new;
  end if;
  if jsonb_typeof(normalization) <> 'object'
    or nullif(btrim(normalization->>'normalizedContent'), '') is null
    or coalesce(normalization->>'originalContentHash', '') !~ '^[a-f0-9]{64}$'
    or coalesce(normalization->>'normalizedContentHash', '') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(normalization->'participants') <> 'array'
    or jsonb_typeof(normalization->'possibleAliases') <> 'array'
    or jsonb_typeof(normalization->'warnings') <> 'array' then
    raise exception 'Manual transcript normalization metadata is invalid.' using errcode = '22023';
  end if;

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
    new.id,
    new.meeting_id,
    1,
    normalization->>'method',
    normalization->>'detectedFormat',
    nullif(btrim(normalization->>'model'), ''),
    nullif(btrim(normalization->>'responseId'), ''),
    nullif(btrim(normalization->>'requestId'), ''),
    normalization->>'originalContentHash',
    normalization->>'normalizedContentHash',
    normalization->>'normalizedContent',
    normalization->'participants',
    normalization->'possibleAliases',
    normalization->'warnings',
    (normalization->>'turnCount')::integer,
    (normalization->>'attributionCoverage')::numeric
  );

  return new;
end;
$$;

create trigger transcripts_capture_manual_normalization
after insert on public.transcripts
for each row execute function public.capture_manual_transcript_normalization();

create function public.prevent_transcript_normalization_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Transcript normalization audit records are immutable.' using errcode = '55000';
end;
$$;

create trigger transcript_normalizations_prevent_update
before update on public.transcript_normalizations
for each row execute function public.prevent_transcript_normalization_changes();

do $$
declare
  definition text;
  old_fragment text := '''content'', stored_transcript.content';
  new_fragment text := '''content'', coalesce(
          (
            select normalization.normalized_content
              from public.transcript_normalizations as normalization
             where normalization.transcript_id = stored_transcript.id
             order by normalization.version desc
             limit 1
          ),
          stored_transcript.content
        )';
begin
  definition := pg_get_functiondef('public.claim_meeting_analysis(uuid,boolean)'::regprocedure);
  if position(old_fragment in definition) = 0 then
    raise exception 'Could not route meeting analysis through transcript normalization.';
  end if;
  definition := replace(definition, old_fragment, new_fragment);
  execute definition;
end;
$$;

alter table public.transcript_normalizations enable row level security;

revoke all on table public.transcript_normalizations from public, anon, authenticated;
grant select, insert on table public.transcript_normalizations to service_role;

revoke execute on function public.capture_manual_transcript_normalization()
  from public, anon, authenticated;
revoke execute on function public.prevent_transcript_normalization_changes()
  from public, anon, authenticated;

commit;
