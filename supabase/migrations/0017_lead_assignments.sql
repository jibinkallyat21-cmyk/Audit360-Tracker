-- A Production Lead can add people to, and remove people from, their own process: team members
-- and supporting roles. Reviewers, the Production Lead and everything else stay with the
-- administrator. People work on a whole process (all its steps), not on single steps.

create function public.lead_set_assignment(
  p_process uuid, p_person uuid, p_type public.assignment_type, p_assigned boolean
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare name text;
begin
  if not public.is_approved_user() then perform public.deny(); end if;
  if not public.has_assignment(p_process, array['production_lead']::public.assignment_type[]) then
    perform public.deny();
  end if;
  if p_type not in ('team_member', 'supporting_role') then
    raise exception 'A Production Lead can add team members and supporting roles only.';
  end if;
  select display_name into name from public.people where id = p_person;
  if not found then raise exception 'Unknown person.'; end if;

  if p_assigned then
    if exists (select 1 from public.process_assignments
               where process_id = p_process and person_id = p_person
                 and assignment_type in ('reviewer', 'production_lead')) then
      raise exception '% already has another role on this process (reviewer or lead), so cannot also work on it.', name;
    end if;
    if exists (select 1 from public.process_assignments
               where process_id = p_process and person_id = p_person and assignment_type = p_type) then
      raise exception '% is already on this process in that role.', name;
    end if;
    insert into public.process_assignments (process_id, person_id, assignment_type, assigned_by)
      values (p_process, p_person, p_type, auth.uid());
  else
    if exists (select 1 from public.review_points
               where assigned_to_person_id = p_person and status <> 'closed'
                 and subprocess_id in (select id from public.subprocesses where process_id = p_process)) then
      raise exception '% owns open review points on this process. Close or hand them over first.', name;
    end if;
    delete from public.process_assignments
      where process_id = p_process and person_id = p_person and assignment_type = p_type;
    if not found then raise exception '% is not on this process in that role.', name; end if;
  end if;
  perform public.log_activity(auth.uid(), case when p_assigned then 'assignment_added' else 'assignment_removed' end,
    'process_assignment', p_process::text, null,
    jsonb_build_object('person_id', p_person, 'type', p_type), p_process, null);
end;
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.lead_set_assignment(uuid, uuid, public.assignment_type, boolean) to authenticated;
