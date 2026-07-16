begin;

create type public.account_type as enum (
  'MEMBER',
  'SUPERADMIN'
);

create type public.member_role as enum (
  'USER',
  'OFFICER',
  'TREASURER'
);

create type public.account_status as enum (
  'INVITED',
  'ACTIVE',
  'DEACTIVATED'
);

-- Deferral is orthogonal metadata, not a lifecycle state. This follows the
-- state diagram and application state machine rather than the older enum list
-- shown in the physical ERD.
create type public.meeting_status as enum (
  'AI_PROCESSING',
  'AI_FAILED',
  'PENDING_APPROVAL',
  'PDF_PROCESSING',
  'PDF_FAILED',
  'AWAITING_SIGNATURE',
  'ESIGN_FAILED',
  'ARCHIVE_FAILED',
  'COMPLETED'
);

create type public.motion_outcome as enum (
  'CARRIED',
  'FAILED'
);

create type public.vote_selection as enum (
  'FOR',
  'AGAINST',
  'ABSTAIN'
);

create type public.review_action as enum (
  'EDIT_SAVED',
  'MARKED_READY',
  'DEFERRED',
  'RESUMED',
  'APPROVED',
  'SIGNED',
  'TREASURER_REJECTED',
  'AI_RETRY',
  'PDF_RETRY',
  'ESIGN_RETRY'
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  account_type public.account_type not null,
  member_role public.member_role,
  is_admin boolean not null default false,
  display_name text not null check (btrim(display_name) <> ''),
  account_status public.account_status not null default 'INVITED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_account_role_check check (
    (account_type = 'MEMBER' and member_role is not null)
    or (account_type = 'SUPERADMIN' and member_role is null)
  )
);

-- This enforces at most one active Treasurer. Role transfer is performed by
-- transfer_treasurer(), which demotes and promotes inside one transaction.
create unique index profiles_one_active_treasurer_idx
  on public.profiles (member_role)
  where member_role = 'TREASURER' and account_status = 'ACTIVE';

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  teams_meeting_id text not null unique,
  title text not null check (btrim(title) <> ''),
  meeting_date date not null,
  status public.meeting_status not null default 'AI_PROCESSING',
  minutes jsonb,
  manual_tags text[] not null default '{}',
  deferred_at timestamptz,
  deferred_note text,
  approved_by uuid references public.profiles (id) on delete restrict,
  approved_at timestamptz,
  signed_by uuid references public.profiles (id) on delete restrict,
  signed_at timestamptz,
  signed_pdf_path text,
  esign_external_ref text,
  last_error_code text,
  last_error_message text,
  last_error_at timestamptz,
  version integer not null default 1 check (version > 0),
  search_vector tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint meetings_deferred_fields_check check (
    (deferred_at is null and deferred_note is null)
    or (
      deferred_at is not null
      and deferred_note is not null
      and btrim(deferred_note) <> ''
      and status in ('AI_FAILED', 'PENDING_APPROVAL')
    )
  ),
  constraint meetings_approval_pair_check check (
    (approved_by is null) = (approved_at is null)
  ),
  constraint meetings_signature_pair_check check (
    (signed_by is null) = (signed_at is null)
  ),
  constraint meetings_approved_state_check check (
    status not in (
      'PDF_PROCESSING',
      'PDF_FAILED',
      'AWAITING_SIGNATURE',
      'ESIGN_FAILED',
      'ARCHIVE_FAILED',
      'COMPLETED'
    )
    or (approved_by is not null and approved_at is not null)
  ),
  constraint meetings_signed_state_check check (
    status not in ('ARCHIVE_FAILED', 'COMPLETED')
    or (
      signed_by is not null
      and signed_at is not null
      and signed_pdf_path is not null
      and btrim(signed_pdf_path) <> ''
    )
  ),
  constraint meetings_completed_state_check check (
    (status = 'COMPLETED' and completed_at is not null)
    or (status <> 'COMPLETED' and completed_at is null)
  ),
  constraint meetings_error_fields_check check (
    (last_error_code is null and last_error_message is null and last_error_at is null)
    or (
      last_error_code is not null
      and btrim(last_error_code) <> ''
      and last_error_message is not null
      and btrim(last_error_message) <> ''
      and last_error_at is not null
    )
  )
);

create table public.transcripts (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null unique
    references public.meetings (id) on delete restrict,
  teams_transcript_id text not null unique,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.meeting_attendees (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null
    references public.meetings (id) on delete cascade,
  profile_id uuid not null
    references public.profiles (id) on delete restrict,
  display_name_snapshot text not null check (btrim(display_name_snapshot) <> ''),
  created_at timestamptz not null default now(),
  constraint meeting_attendees_meeting_profile_key unique (meeting_id, profile_id),
  constraint meeting_attendees_meeting_id_id_key unique (meeting_id, id)
);

create table public.motions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null
    references public.meetings (id) on delete cascade,
  motion_text text,
  moved_by_attendee_id uuid,
  seconded_by_attendee_id uuid,
  outcome public.motion_outcome,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint motions_meeting_id_id_key unique (meeting_id, id),
  constraint motions_mover_attends_meeting_fk
    foreign key (meeting_id, moved_by_attendee_id)
    references public.meeting_attendees (meeting_id, id)
    on delete restrict,
  constraint motions_seconder_attends_meeting_fk
    foreign key (meeting_id, seconded_by_attendee_id)
    references public.meeting_attendees (meeting_id, id)
    on delete restrict,
  constraint motions_distinct_mover_seconder_check check (
    moved_by_attendee_id is null
    or seconded_by_attendee_id is null
    or moved_by_attendee_id <> seconded_by_attendee_id
  )
);

create table public.votes (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null
    references public.meetings (id) on delete cascade,
  motion_id uuid not null,
  attendee_id uuid not null,
  selection public.vote_selection,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint votes_motion_attendee_key unique (motion_id, attendee_id),
  constraint votes_motion_belongs_to_meeting_fk
    foreign key (meeting_id, motion_id)
    references public.motions (meeting_id, id)
    on delete cascade,
  constraint votes_attendee_belongs_to_meeting_fk
    foreign key (meeting_id, attendee_id)
    references public.meeting_attendees (meeting_id, id)
    on delete cascade
);

create table public.review_history (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null
    references public.meetings (id) on delete restrict,
  actor_profile_id uuid not null
    references public.profiles (id) on delete restrict,
  action public.review_action not null,
  note text,
  created_at timestamptz not null default now(),
  constraint review_history_required_note_check check (
    action not in ('DEFERRED', 'TREASURER_REJECTED')
    or (note is not null and btrim(note) <> '')
  )
);

create index meetings_status_date_idx
  on public.meetings (status, meeting_date desc);

create index meetings_completed_search_idx
  on public.meetings using gin (search_vector)
  where status = 'COMPLETED';

create index transcripts_content_search_idx
  on public.transcripts using gin (
    to_tsvector('english'::regconfig, content)
  );

create index meeting_attendees_profile_idx
  on public.meeting_attendees (profile_id, meeting_id);

create index motions_meeting_idx
  on public.motions (meeting_id, created_at);

create index votes_meeting_motion_idx
  on public.votes (meeting_id, motion_id);

create index review_history_meeting_created_idx
  on public.review_history (meeting_id, created_at);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create function public.prepare_meeting_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.search_vector := to_tsvector(
    'pg_catalog.english'::regconfig,
    concat_ws(
      ' ',
      new.title,
      array_to_string(new.manual_tags, ' '),
      new.minutes::text
    )
  );

  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger meetings_prepare_write
before insert or update on public.meetings
for each row execute function public.prepare_meeting_write();

create trigger transcripts_set_updated_at
before update on public.transcripts
for each row execute function public.set_updated_at();

create trigger motions_set_updated_at
before update on public.motions
for each row execute function public.set_updated_at();

create trigger votes_set_updated_at
before update on public.votes
for each row execute function public.set_updated_at();

create function public.prevent_profile_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Profiles are historical identities and cannot be deleted; deactivate the account instead.';
end;
$$;

create trigger profiles_prevent_delete
before delete on public.profiles
for each row execute function public.prevent_profile_delete();

create function public.prevent_completed_meeting_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'COMPLETED' then
    raise exception 'Completed meetings are immutable.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create trigger meetings_prevent_completed_changes
before update or delete on public.meetings
for each row execute function public.prevent_completed_meeting_changes();

create function public.prevent_completed_related_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_meeting_id uuid;
  target_status public.meeting_status;
begin
  target_meeting_id := case when tg_op = 'DELETE' then old.meeting_id else new.meeting_id end;

  select meeting.status
    into target_status
    from public.meetings as meeting
    where meeting.id = target_meeting_id;

  if target_status = 'COMPLETED' then
    raise exception 'Completed meeting records are immutable.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create trigger transcripts_prevent_completed_changes
before insert or update or delete on public.transcripts
for each row execute function public.prevent_completed_related_changes();

create trigger meeting_attendees_prevent_completed_changes
before insert or update or delete on public.meeting_attendees
for each row execute function public.prevent_completed_related_changes();

create trigger motions_prevent_completed_changes
before insert or update or delete on public.motions
for each row execute function public.prevent_completed_related_changes();

create trigger votes_prevent_completed_changes
before insert or update or delete on public.votes
for each row execute function public.prevent_completed_related_changes();

create function public.protect_transcript_evidence()
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
    or new.teams_transcript_id is distinct from old.teams_transcript_id
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

create trigger transcripts_protect_evidence
before update or delete on public.transcripts
for each row execute function public.protect_transcript_evidence();

create function public.protect_review_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Review history is append-only.';
end;
$$;

create trigger review_history_append_only
before update or delete on public.review_history
for each row execute function public.protect_review_history();

create function public.validate_meeting_transition()
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

create trigger meetings_validate_transition
before update on public.meetings
for each row execute function public.validate_meeting_transition();

create function public.validate_meeting_approval()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'PENDING_APPROVAL' and new.status = 'PDF_PROCESSING' then
    if new.deferred_at is not null then
      raise exception 'A deferred meeting must be resumed before approval.';
    end if;

    if new.approved_by is null or new.approved_at is null then
      raise exception 'Approval requires an approver and approval timestamp.';
    end if;

    if current_user = 'authenticated' and new.approved_by <> auth.uid() then
      raise exception 'The approver must match the authenticated profile.';
    end if;

    if exists (
      select 1
      from public.motions as motion
      where motion.meeting_id = old.id
        and (
          motion.motion_text is null
          or btrim(motion.motion_text) = ''
          or motion.moved_by_attendee_id is null
          or motion.seconded_by_attendee_id is null
          or motion.outcome is null
        )
    ) then
      raise exception 'Every motion must be complete before approval.';
    end if;
  end if;

  return new;
end;
$$;

create trigger meetings_validate_approval
before update on public.meetings
for each row execute function public.validate_meeting_approval();

create function public.current_user_is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as profile
    where profile.id = auth.uid()
      and profile.account_type = 'SUPERADMIN'
      and profile.account_status = 'ACTIVE'
  );
$$;

create function public.current_user_is_account_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as profile
    where profile.id = auth.uid()
      and profile.account_type = 'MEMBER'
      and profile.account_status = 'ACTIVE'
      and profile.is_admin
  );
$$;

create function public.current_user_can_access_meetings()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as profile
    where profile.id = auth.uid()
      and profile.account_type = 'MEMBER'
      and profile.account_status = 'ACTIVE'
  );
$$;

create function public.current_user_has_meeting_role(required_role public.member_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case profile.member_role
      when 'TREASURER' then 2
      when 'OFFICER' then 1
      when 'USER' then 0
    end >= case required_role
      when 'TREASURER' then 2
      when 'OFFICER' then 1
      when 'USER' then 0
    end
    from public.profiles as profile
    where profile.id = auth.uid()
      and profile.account_type = 'MEMBER'
      and profile.account_status = 'ACTIVE'
  ), false);
$$;

create function public.meeting_is_editable(target_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.meetings as meeting
    where meeting.id = target_meeting_id
      and meeting.status in ('AI_FAILED', 'PENDING_APPROVAL')
      and meeting.deferred_at is null
  );
$$;

create function public.enforce_profile_update_permissions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if auth.uid() = old.id then
    if new.account_type is distinct from old.account_type
      or new.member_role is distinct from old.member_role
      or new.is_admin is distinct from old.is_admin
      or new.account_status is distinct from old.account_status then
      raise exception 'Profiles cannot change their own account privileges.';
    end if;

    return new;
  end if;

  if public.current_user_is_superadmin() then
    if new.account_type is distinct from old.account_type
      or new.member_role is distinct from old.member_role
      or new.account_status is distinct from old.account_status
      or new.display_name is distinct from old.display_name then
      raise exception 'Superadmins may only manage the account-admin flag directly.';
    end if;

    return new;
  end if;

  if public.current_user_is_account_admin() then
    if old.account_type <> 'MEMBER'
      or new.account_type <> 'MEMBER'
      or new.is_admin is distinct from old.is_admin
      or old.member_role = 'TREASURER'
      or new.member_role = 'TREASURER' then
      raise exception 'Account admins cannot alter Superadmins, admin flags, or the Treasurer role.';
    end if;

    return new;
  end if;

  raise exception 'This profile update is not permitted.';
end;
$$;

create trigger profiles_enforce_update_permissions
before update on public.profiles
for each row execute function public.enforce_profile_update_permissions();

create function public.transfer_treasurer(target_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.current_user_is_superadmin() then
    raise exception 'Only an active Superadmin can transfer the Treasurer role.';
  end if;

  perform 1
  from public.profiles as profile
  where profile.id = target_profile_id
    and profile.account_type = 'MEMBER'
    and profile.account_status = 'ACTIVE'
  for update;

  if not found then
    raise exception 'The next Treasurer must be an active member.';
  end if;

  perform 1
  from public.profiles as profile
  where profile.member_role = 'TREASURER'
    and profile.account_status = 'ACTIVE'
  for update;

  update public.profiles
  set member_role = 'OFFICER'
  where member_role = 'TREASURER'
    and account_status = 'ACTIVE'
    and id <> target_profile_id;

  update public.profiles
  set member_role = 'TREASURER'
  where id = target_profile_id;

  if (
    select count(*)
    from public.profiles as profile
    where profile.member_role = 'TREASURER'
      and profile.account_status = 'ACTIVE'
  ) <> 1 then
    raise exception 'Treasurer transfer did not leave exactly one active Treasurer.';
  end if;
end;
$$;

alter table public.profiles enable row level security;
alter table public.meetings enable row level security;
alter table public.transcripts enable row level security;
alter table public.meeting_attendees enable row level security;
alter table public.motions enable row level security;
alter table public.votes enable row level security;
alter table public.review_history enable row level security;

create policy profiles_select_self_or_manager
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.current_user_is_account_admin()
  or public.current_user_is_superadmin()
);

create policy profiles_update_self_or_manager
on public.profiles
for update
to authenticated
using (
  id = auth.uid()
  or public.current_user_is_account_admin()
  or public.current_user_is_superadmin()
)
with check (
  id = auth.uid()
  or public.current_user_is_account_admin()
  or public.current_user_is_superadmin()
);

create policy meetings_select_active_members
on public.meetings
for select
to authenticated
using (public.current_user_can_access_meetings());

create policy meetings_update_officer_or_treasurer
on public.meetings
for update
to authenticated
using (
  public.current_user_has_meeting_role('OFFICER')
  and status <> 'COMPLETED'
)
with check (public.current_user_has_meeting_role('OFFICER'));

create policy transcripts_select_active_members
on public.transcripts
for select
to authenticated
using (public.current_user_can_access_meetings());

create policy meeting_attendees_select_active_members
on public.meeting_attendees
for select
to authenticated
using (public.current_user_can_access_meetings());

create policy meeting_attendees_insert_editors
on public.meeting_attendees
for insert
to authenticated
with check (
  public.current_user_has_meeting_role('OFFICER')
  and public.meeting_is_editable(meeting_id)
);

create policy meeting_attendees_update_editors
on public.meeting_attendees
for update
to authenticated
using (
  public.current_user_has_meeting_role('OFFICER')
  and public.meeting_is_editable(meeting_id)
)
with check (
  public.current_user_has_meeting_role('OFFICER')
  and public.meeting_is_editable(meeting_id)
);

create policy meeting_attendees_delete_editors
on public.meeting_attendees
for delete
to authenticated
using (
  public.current_user_has_meeting_role('OFFICER')
  and public.meeting_is_editable(meeting_id)
);

create policy motions_select_active_members
on public.motions
for select
to authenticated
using (public.current_user_can_access_meetings());

create policy motions_insert_editors
on public.motions
for insert
to authenticated
with check (
  public.current_user_has_meeting_role('OFFICER')
  and public.meeting_is_editable(meeting_id)
);

create policy motions_update_editors
on public.motions
for update
to authenticated
using (
  public.current_user_has_meeting_role('OFFICER')
  and public.meeting_is_editable(meeting_id)
)
with check (
  public.current_user_has_meeting_role('OFFICER')
  and public.meeting_is_editable(meeting_id)
);

create policy motions_delete_editors
on public.motions
for delete
to authenticated
using (
  public.current_user_has_meeting_role('OFFICER')
  and public.meeting_is_editable(meeting_id)
);

create policy votes_select_active_members
on public.votes
for select
to authenticated
using (public.current_user_can_access_meetings());

create policy votes_insert_editors
on public.votes
for insert
to authenticated
with check (
  public.current_user_has_meeting_role('OFFICER')
  and public.meeting_is_editable(meeting_id)
);

create policy votes_update_editors
on public.votes
for update
to authenticated
using (
  public.current_user_has_meeting_role('OFFICER')
  and public.meeting_is_editable(meeting_id)
)
with check (
  public.current_user_has_meeting_role('OFFICER')
  and public.meeting_is_editable(meeting_id)
);

create policy votes_delete_editors
on public.votes
for delete
to authenticated
using (
  public.current_user_has_meeting_role('OFFICER')
  and public.meeting_is_editable(meeting_id)
);

create policy review_history_select_active_members
on public.review_history
for select
to authenticated
using (public.current_user_can_access_meetings());

create policy review_history_insert_reviewers
on public.review_history
for insert
to authenticated
with check (
  public.current_user_has_meeting_role('OFFICER')
  and actor_profile_id = auth.uid()
  and (
    action not in ('SIGNED', 'TREASURER_REJECTED')
    or public.current_user_has_meeting_role('TREASURER')
  )
);

revoke all on table public.profiles from anon;
revoke all on table public.meetings from anon;
revoke all on table public.transcripts from anon;
revoke all on table public.meeting_attendees from anon;
revoke all on table public.motions from anon;
revoke all on table public.votes from anon;
revoke all on table public.review_history from anon;

grant select, update on table public.profiles to authenticated;
grant select, update on table public.meetings to authenticated;
grant select on table public.transcripts to authenticated;
grant select, insert, update, delete on table public.meeting_attendees to authenticated;
grant select, insert, update, delete on table public.motions to authenticated;
grant select, insert, update, delete on table public.votes to authenticated;
grant select, insert on table public.review_history to authenticated;

revoke execute on function public.transfer_treasurer(uuid) from public;
grant execute on function public.transfer_treasurer(uuid) to authenticated;

commit;
