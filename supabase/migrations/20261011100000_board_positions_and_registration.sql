begin;

alter table public.profiles add column board_position text,
  add constraint profiles_board_position_check check (board_position is null or
    (account_type = 'MEMBER' and member_role = 'OFFICER' and board_position in ('PRESIDENT','VICE_PRESIDENT')));
create unique index profiles_one_active_board_position on public.profiles(board_position)
  where account_status = 'ACTIVE' and board_position is not null;

-- No automatic assignment to historical Officers: operators must explicitly assign positions.
create or replace function public.meeting_review_actor_can_edit(p_actor_profile_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id=p_actor_profile_id
    and account_type='MEMBER' and account_status='ACTIVE' and member_role='OFFICER' and board_position='PRESIDENT');
$$;
create or replace function public.meeting_actor_can_approve(p_actor_profile_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id=p_actor_profile_id
    and account_type='MEMBER' and account_status='ACTIVE'
    and (member_role='TREASURER' or (member_role='OFFICER' and board_position in ('PRESIDENT','VICE_PRESIDENT'))));
$$;

-- Preserve the existing version, lifecycle, evidence and signing-snapshot logic exactly.
-- Fail the migration if the expected previous definitions have drifted.
do $$
declare definition text; updated text;
begin
  definition := pg_get_functiondef('public.discard_meeting_draft(uuid,integer,uuid)'::regprocedure);
  updated := replace(definition, 'public.meeting_actor_can_approve(p_actor_profile_id)', 'public.meeting_review_actor_can_edit(p_actor_profile_id)');
  if updated=definition then raise exception 'Unexpected discard function definition'; end if;
  execute updated;
  definition := pg_get_functiondef('public.retry_meeting_signing_delivery(uuid,integer,uuid)'::regprocedure);
  updated := regexp_replace(definition,
    'if not exists \(\s*select 1\s*from public.profiles as profile\s*where profile.id = p_actor_profile_id\s*and profile.account_type = ''MEMBER''\s*and profile.member_role in \(''OFFICER'', ''TREASURER''\)\s*and profile.account_status = ''ACTIVE''\s*\) then',
    'if not public.meeting_actor_can_approve(p_actor_profile_id) then');
  if updated=definition then raise exception 'Unexpected signing delivery function definition'; end if;
  execute updated;
end;
$$;

create table public.board_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check(email=lower(btrim(email)) and length(email) between 3 and 254),
  token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  consumed_at timestamptz,
  registration_profile_id uuid not null unique default gen_random_uuid(),
  lease_id uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now()
);
alter table public.board_invitations enable row level security;
revoke all on public.board_invitations from public, anon, authenticated;
grant all on public.board_invitations to service_role;

-- Stable reserved Auth UUID makes retries recover an incomplete registration without
-- deleting accounts or accepting an existing account belonging to another invitation.
create function public.claim_board_invitation(p_token_hash text, p_email text, p_lease_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare reserved uuid;
begin
  update public.board_invitations set lease_id=p_lease_id, lease_until=now()+interval '2 minutes'
  where token_hash=p_token_hash and email=p_email and consumed_at is null and revoked_at is null
    and expires_at>now() and (lease_until is null or lease_until<now())
  returning registration_profile_id into reserved;
  return reserved;
end;
$$;
create function public.complete_board_registration(p_token_hash text, p_lease_id uuid, p_display_name text)
returns uuid language plpgsql security definer set search_path='' as $$
declare invitation public.board_invitations%rowtype;
begin
  select * into invitation from public.board_invitations where token_hash=p_token_hash for update;
  if not found or invitation.lease_id is distinct from p_lease_id or invitation.lease_until<now()
    or invitation.consumed_at is not null or invitation.revoked_at is not null or invitation.expires_at<=now()
    or length(btrim(p_display_name)) not between 1 and 200 then
    raise exception 'Invitation unavailable' using errcode='22023';
  end if;
  if not exists(select 1 from auth.users where id=invitation.registration_profile_id
    and lower(email)=invitation.email and email_confirmed_at is not null) then
    raise exception 'Registration incomplete' using errcode='22023';
  end if;
  insert into public.profiles(id,account_type,member_role,is_admin,display_name,email,account_status)
    values(invitation.registration_profile_id,'MEMBER','USER',false,btrim(p_display_name),invitation.email,'ACTIVE');
  update public.board_invitations set consumed_at=now(),lease_id=null,lease_until=null where id=invitation.id;
  return invitation.registration_profile_id;
end;
$$;
create function public.release_board_invitation(p_token_hash text, p_lease_id uuid)
returns void language sql security definer set search_path='' as $$
  update public.board_invitations set lease_id=null,lease_until=null
    where token_hash=p_token_hash and lease_id=p_lease_id and consumed_at is null;
$$;

-- Password resets revoke refresh sessions. The app also checks session existence,
-- because a signed-out access JWT otherwise remains usable until its expiry.
create function public.account_session_is_active(p_profile_id uuid,p_session_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.sessions where id=p_session_id and user_id=p_profile_id);
$$;
create function public.revoke_board_account_sessions(p_profile_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.profiles where id=p_profile_id and account_type='MEMBER') then
    raise exception 'Board account not found';
  end if;
  delete from auth.sessions where user_id=p_profile_id;
end;
$$;
revoke all on function public.claim_board_invitation(text,text,uuid),
  public.complete_board_registration(text,uuid,text),public.release_board_invitation(text,uuid),
  public.account_session_is_active(uuid,uuid),public.revoke_board_account_sessions(uuid) from public,anon,authenticated;
grant execute on function public.claim_board_invitation(text,text,uuid),
  public.complete_board_registration(text,uuid,text),public.release_board_invitation(text,uuid),
  public.account_session_is_active(uuid,uuid),public.revoke_board_account_sessions(uuid) to service_role;
commit;
