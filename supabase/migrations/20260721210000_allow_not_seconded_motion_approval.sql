begin;

alter type public.motion_outcome add value if not exists 'NOT_SECONDED';

-- Preserve the existing atomic review implementation while extending its accepted
-- outcome and persistence mapping. The guards make baseline drift fail loudly.
do $$
declare
  definition text;
  old_fragment text;
  new_fragment text;
begin
  definition := pg_get_functiondef(
    'public.save_meeting_review_draft(uuid,integer,uuid,jsonb)'::regprocedure
  );

  old_fragment := 'motion->>''outcome'' not in (''carried'', ''failed'', ''tabled'', ''unresolved'')';
  new_fragment := 'motion->>''outcome'' not in (''carried'', ''failed'', ''tabled'', ''not_seconded'', ''unresolved'')';
  if position(old_fragment in definition) = 0 then
    raise exception 'Could not extend save_meeting_review_draft outcome validation.';
  end if;
  definition := replace(definition, old_fragment, new_fragment);

  old_fragment := 'when ''tabled'' then ''TABLED''::public.motion_outcome';
  new_fragment := old_fragment || chr(10)
    || '        when ''not_seconded'' then ''NOT_SECONDED''::public.motion_outcome';
  if position(old_fragment in definition) = 0 then
    raise exception 'Could not extend save_meeting_review_draft outcome persistence.';
  end if;
  definition := replace(definition, old_fragment, new_fragment);

  execute definition;
end;
$$;

-- Keep the table-level transition guard aligned with the approval RPC. This is
-- defense in depth for any future server-side approval path.
do $$
declare
  definition text;
  old_fragment text;
  new_fragment text;
begin
  definition := pg_get_functiondef('public.validate_meeting_approval()'::regprocedure);
  old_fragment := 'or motion.seconded_by_attendee_id is null';
  new_fragment := 'or (motion.outcome <> ''NOT_SECONDED'' and motion.seconded_by_attendee_id is null)
          or (motion.outcome = ''NOT_SECONDED'' and motion.seconded_by_attendee_id is not null)';
  if position(old_fragment in definition) = 0 then
    raise exception 'Could not extend the meeting approval transition guard.';
  end if;
  definition := replace(definition, old_fragment, new_fragment);
  execute definition;
end;
$$;

-- Approval still requires a mover and a final outcome. A seconder is required for
-- carried, failed, and tabled motions, but must be absent for NOT_SECONDED.
do $$
declare
  definition text;
  old_fragment text;
  new_fragment text;
begin
  definition := pg_get_functiondef(
    'public.approve_meeting_for_pdf(uuid,integer,uuid,boolean)'::regprocedure
  );

  old_fragment := 'or motion.seconded_by_attendee_id is null';
  new_fragment := 'or (motion.outcome <> ''NOT_SECONDED'' and motion.seconded_by_attendee_id is null)
         or (motion.outcome = ''NOT_SECONDED'' and motion.seconded_by_attendee_id is not null)';
  if position(old_fragment in definition) = 0 then
    raise exception 'Could not extend approve_meeting_for_pdf readiness validation.';
  end if;
  definition := replace(definition, old_fragment, new_fragment);

  old_fragment := 'join public.meeting_attendees as seconder';
  new_fragment := 'left join public.meeting_attendees as seconder';
  if position(old_fragment in definition) = 0 then
    raise exception 'Could not make the approved snapshot seconder optional.';
  end if;
  definition := replace(definition, old_fragment, new_fragment);

  execute definition;
end;
$$;

commit;
