begin;

do $$
declare
  definition text;
  old_fragment text := '(''PENDING_APPROVAL''::public.meeting_status, ''PDF_PROCESSING''::public.meeting_status),';
  new_fragment text := '(''PENDING_APPROVAL''::public.meeting_status, ''AI_PROCESSING''::public.meeting_status),
      (''PENDING_APPROVAL''::public.meeting_status, ''PDF_PROCESSING''::public.meeting_status),';
begin
  definition := pg_get_functiondef('public.validate_meeting_transition()'::regprocedure);
  if position(old_fragment in definition) = 0 then
    raise exception 'Could not allow pending transcript renormalization transition.';
  end if;
  definition := replace(definition, old_fragment, new_fragment);
  execute definition;
end;
$$;

comment on function public.validate_meeting_transition()
  is 'Validates lifecycle transitions, including a protected PENDING_APPROVAL to AI_PROCESSING transition for transcript renormalization.';

commit;
