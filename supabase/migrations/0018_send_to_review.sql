-- One step to review, and a Project Lead override.
--
-- Steps without lines used to need a status change and a "complete" press for every stage
-- (Process Definition, Solution Building, Testing) before reviewers saw anything. The Production
-- Lead now has a single "Send to review" for such a step, from any stage before Review. The
-- Project Lead can also push a step or a line to review on the team's behalf (with a reason), so
-- work is never stuck waiting on a gate.

create function public.send_to_review(p_sub uuid, p_tested boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.subprocesses;
begin
  if not public.is_approved_user() then perform public.deny(); end if;
  s := public.lock_subprocess(p_sub);
  if not public.has_assignment(s.process_id, array['production_lead']::public.assignment_type[]) then
    perform public.deny();
  end if;
  if public.has_lines(p_sub) then
    raise exception 'This step is managed line by line. Send each line to review.';
  end if;
  if s.current_stage not in ('process_definition', 'solution_building', 'testing') then
    raise exception 'This step is already in % and cannot be sent to review again.', replace(s.current_stage::text, '_', ' ');
  end if;
  if s.current_status = 'blocked' then
    raise exception 'Clear the Blocked status before sending this step to review.';
  end if;
  if not coalesce(p_tested, false) then
    raise exception 'Confirm that the work was tested before sending it to review.';
  end if;
  insert into public.testing_records (subprocess_id, submitted_by, result, notes)
    values (p_sub, auth.uid(), 'pass', nullif(btrim(coalesce(p_note, '')), ''));
  if p_note is not null and length(btrim(p_note)) > 0 then
    insert into public.comments (subprocess_id, author_id, comment_text) values (p_sub, auth.uid(), btrim(p_note));
  end if;
  update public.subprocesses set current_stage = 'review', current_status = 'in_progress',
    review_decision = 'pending_review', stage_entered_at = now(), updated_at = now(), updated_by = auth.uid()
    where id = p_sub;
  perform public.log_activity(auth.uid(), 'stage_changed', 'subprocess', p_sub::text,
    jsonb_build_object('stage', s.current_stage, 'status', s.current_status),
    jsonb_build_object('stage', 'review', 'status', 'in_progress'), s.process_id, p_sub,
    jsonb_build_object('reason', 'sent_to_review'));
end;
$$;

create function public.override_step_to_review(p_sub uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.subprocesses;
begin
  if not public.is_approved_user() or not public.has_role('project_lead') then perform public.deny(); end if;
  s := public.lock_subprocess(p_sub);
  if public.has_lines(p_sub) then
    raise exception 'This step is managed line by line. Send a line to review instead.';
  end if;
  if s.current_stage not in ('process_definition', 'solution_building', 'testing') then
    raise exception 'This step is already in % and cannot be sent to review.', replace(s.current_stage::text, '_', ' ');
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'Give a reason for sending it to review.';
  end if;
  insert into public.comments (subprocess_id, author_id, comment_text)
    values (p_sub, auth.uid(), 'Sent to review by the Project Lead: ' || btrim(p_reason));
  update public.subprocesses set current_stage = 'review', current_status = 'in_progress',
    review_decision = 'pending_review', stage_entered_at = now(), updated_at = now(), updated_by = auth.uid()
    where id = p_sub;
  perform public.log_activity(auth.uid(), 'stage_changed', 'subprocess', p_sub::text,
    jsonb_build_object('stage', s.current_stage, 'status', s.current_status),
    jsonb_build_object('stage', 'review', 'status', 'in_progress'), s.process_id, p_sub,
    jsonb_build_object('reason', 'project_lead_override', 'note', btrim(p_reason)));
end;
$$;

create function public.override_line_to_review(p_line uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.subprocess_lines; s public.subprocesses;
begin
  if not public.is_approved_user() or not public.has_role('project_lead') then perform public.deny(); end if;
  select * into l from public.subprocess_lines where id = p_line for update;
  if not found then perform public.deny(); end if;
  s := public.lock_subprocess(l.subprocess_id);
  if s.current_stage = 'production' then raise exception 'This step is already in Production.'; end if;
  if l.status not in ('not_started', 'in_progress', 'blocked', 'changes_required') then
    raise exception 'This line is already % .', replace(l.status::text, '_', ' ');
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'Give a reason for sending it to review.';
  end if;
  -- The files filed under the line become its evidence, if there are any.
  delete from public.line_evidence where line_id = p_line;
  insert into public.line_evidence (line_id, document_id)
    select p_line, d.id from public.documents d where d.line_id = p_line and d.removed_at is null;
  insert into public.comments (subprocess_id, line_id, author_id, comment_text)
    values (s.id, p_line, auth.uid(), 'Sent to review by the Project Lead: ' || btrim(p_reason));
  update public.subprocess_lines set status = 'in_review', updated_at = now(), updated_by = auth.uid()
    where id = p_line;
  perform public.log_activity(auth.uid(), 'line_sent_to_review', 'line', p_line::text,
    jsonb_build_object('status', l.status), jsonb_build_object('status', 'in_review'), s.process_id, s.id,
    jsonb_build_object('title', l.title, 'override', true, 'note', btrim(p_reason)));
  perform public.line_rollup(s.id, auth.uid());
end;
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.send_to_review(uuid, boolean, text),
  public.override_step_to_review(uuid, text),
  public.override_line_to_review(uuid, text)
to authenticated;
