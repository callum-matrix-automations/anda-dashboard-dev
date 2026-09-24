begin;

-- A transcript can establish that a motion was carried, failed, or tabled even
-- when it does not identify who moved or seconded it. Preserve that outcome and
-- the null attribution instead of forcing a reviewer to invent a person.
do $$
declare
  definition text;
  old_fragment text;
  new_fragment text;
begin
  definition := pg_get_functiondef('public.validate_meeting_approval()'::regprocedure);
  old_fragment := E'or motion\\.moved_by_attendee_id is null\\s+'
    || E'or \\(motion\\.outcome <> ''NOT_SECONDED'' and motion\\.seconded_by_attendee_id is null\\)\\s+'
    || E'or \\(motion\\.outcome = ''NOT_SECONDED'' and motion\\.seconded_by_attendee_id is not null\\)';
  new_fragment := 'or (motion.outcome = ''NOT_SECONDED'' and motion.seconded_by_attendee_id is not null)';
  if definition !~ old_fragment then
    raise exception 'Could not relax the meeting approval transition attribution guard.';
  end if;
  definition := regexp_replace(definition, old_fragment, new_fragment);
  execute definition;
end;
$$;

do $$
declare
  definition text;
  old_fragment text;
  new_fragment text;
begin
  definition := pg_get_functiondef(
    'public.approve_meeting_for_pdf(uuid,integer,uuid,boolean)'::regprocedure
  );

  old_fragment := E'or motion\\.moved_by_attendee_id is null\\s+'
    || E'or \\(motion\\.outcome <> ''NOT_SECONDED'' and motion\\.seconded_by_attendee_id is null\\)\\s+'
    || E'or \\(motion\\.outcome = ''NOT_SECONDED'' and motion\\.seconded_by_attendee_id is not null\\)';
  new_fragment := 'or (motion.outcome = ''NOT_SECONDED'' and motion.seconded_by_attendee_id is not null)';
  if definition !~ old_fragment then
    raise exception 'Could not relax approve_meeting_for_pdf attribution validation.';
  end if;
  definition := regexp_replace(definition, old_fragment, new_fragment);

  old_fragment := 'join public.meeting_attendees as mover';
  new_fragment := 'left join public.meeting_attendees as mover';
  if position(old_fragment in definition) = 0 then
    raise exception 'Could not make the approved motion mover optional.';
  end if;
  definition := replace(definition, old_fragment, new_fragment);

  execute definition;
end;
$$;

commit;
