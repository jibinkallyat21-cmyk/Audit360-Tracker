-- A reviewer added to a process after work was already sent to review gets a notification
-- for it (and sees it in My queue straight away). Same trigger function as 0012 plus that.

create or replace function public.notify_from_activity() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  lbl text;
  stage text;
  team uuid[];
  rp public.review_points;
  seq int;
  line_title text;
  waiting int;
begin
  if new.process_id is null then return new; end if;
  select p.process_code || ' ' || p.title into lbl from public.processes p where p.id = new.process_id;
  if new.subprocess_id is not null then
    select s.seq into seq from public.subprocesses s where s.id = new.subprocess_id;
    lbl := lbl || ' (step ' || seq || ')';
  end if;
  line_title := new.metadata ->> 'title';
  team := array(select public.profiles_for(new.process_id,
            array['production_lead', 'team_member']::public.assignment_type[]));

  case new.action_type
    when 'stage_changed' then
      stage := new.new_value ->> 'stage';
      if new.metadata ->> 'reason' = 'failed_test' then
        perform public.notify(team, new.actor_id, 'test_failed', new.process_id, new.subprocess_id, null,
          lbl || ' failed testing and returned to Solution Building');
      elsif new.metadata ->> 'reason' = 'all_lines_approved' then
        perform public.notify(team || array(select public.profiles_with_role('project_lead')),
          new.actor_id, 'stage_changed', new.process_id, new.subprocess_id, null,
          lbl || ' has every line approved and moved to Production');
      else
        perform public.notify(team, new.actor_id, 'stage_changed', new.process_id, new.subprocess_id, null,
          lbl || ' moved to ' || replace(stage, '_', ' '));
      end if;
      if stage = 'review' then
        perform public.notify(array(select public.profiles_for(new.process_id, array['reviewer']::public.assignment_type[])),
          new.actor_id, 'review_queue', new.process_id, new.subprocess_id, null,
          lbl || ' is ready for your review');
      elsif stage = 'production' then
        perform public.notify(array(select public.profiles_with_role('dashboard_lead')), new.actor_id,
          'production_ready', new.process_id, new.subprocess_id, null,
          lbl || ' reached Production and is ready for the website build');
      end if;
    when 'status_changed' then
      perform public.notify(team, new.actor_id, 'status_changed', new.process_id, new.subprocess_id, null,
        lbl || ' status is now ' || replace(new.new_value ->> 'status', '_', ' '));
    when 'line_sent_to_review', 'line_reopened' then
      perform public.notify(array(select public.profiles_for(new.process_id, array['reviewer']::public.assignment_type[])),
        new.actor_id, 'review_queue', new.process_id, new.subprocess_id, null,
        lbl || ': line “' || coalesce(line_title, 'a line') || '” is ready for your review');
    when 'line_decision' then
      if new.new_value ->> 'decision' = 'changes_required' then
        perform public.notify(team, new.actor_id, 'changes_requested', new.process_id, new.subprocess_id, null,
          'A reviewer requested changes on line “' || coalesce(line_title, 'a line') || '” of ' || lbl);
      else
        perform public.notify(
          team || array(select public.profiles_with_role('project_lead')), new.actor_id,
          'review_approved', new.process_id, new.subprocess_id, null,
          'Line “' || coalesce(line_title, 'a line') || '” of ' || lbl || ' was approved in review');
      end if;
    when 'review_decision' then
      if new.new_value ->> 'review_decision' = 'changes_required' then
        perform public.notify(team, new.actor_id, 'changes_requested', new.process_id, new.subprocess_id, null,
          'A reviewer requested changes on ' || lbl);
      else
        perform public.notify(
          team || array(select public.profiles_with_role('project_lead')), new.actor_id,
          'review_approved', new.process_id, new.subprocess_id, null,
          lbl || ' was approved in review');
      end if;
    when 'review_point_raised' then
      perform public.notify(
        array(select pr.id from public.profiles pr
              where pr.person_id = (new.new_value ->> 'owner_person_id')::uuid
                and pr.approval_state = 'approved' and pr.is_active),
        new.actor_id, 'review_point_assigned', new.process_id, new.subprocess_id, new.entity_id::uuid,
        'A review point was assigned to you on ' || lbl);
    when 'review_point_submit' then
      select * into rp from public.review_points where id = new.entity_id::uuid;
      perform public.notify(array[rp.raised_by], new.actor_id, 'response_submitted', new.process_id,
        new.subprocess_id, rp.id, 'A response is ready for your closure decision on ' || lbl);
    when 'review_point_approve_close', 'review_point_return' then
      select * into rp from public.review_points where id = new.entity_id::uuid;
      perform public.notify(
        array(select pr.id from public.profiles pr
              where pr.person_id = rp.assigned_to_person_id and pr.approval_state = 'approved' and pr.is_active),
        new.actor_id,
        case when new.action_type = 'review_point_return' then 'review_point_returned' else 'review_point_closed' end,
        new.process_id, new.subprocess_id, rp.id,
        case when new.action_type = 'review_point_return'
             then 'Your response was returned for changes on ' || lbl
             else 'Your response was approved on ' || lbl end);
    when 'document_uploaded', 'document_replaced' then
      perform public.notify(
        array(select public.profiles_for(new.process_id,
          array['production_lead', 'team_member', 'reviewer', 'supporting_role']::public.assignment_type[])),
        new.actor_id, 'document', new.process_id, new.subprocess_id, null,
        'A document was ' || case when new.action_type = 'document_uploaded' then 'uploaded' else 'updated' end
          || ' on ' || lbl);
    when 'assignment_added' then
      perform public.notify(
        array(select pr.id from public.profiles pr
              where pr.person_id = (new.new_value ->> 'person_id')::uuid
                and pr.approval_state = 'approved' and pr.is_active),
        new.actor_id,
        case when new.new_value ->> 'type' = 'reviewer' then 'reviewer_assigned' else 'assigned' end,
        new.process_id, null, null,
        'You were assigned as ' || replace(new.new_value ->> 'type', '_', ' ') || ' on ' || lbl);
      -- A reviewer who joins late is told about work that is already waiting for review.
      if new.new_value ->> 'type' = 'reviewer' then
        select (select count(*) from public.subprocess_lines l
                  join public.subprocesses s on s.id = l.subprocess_id
                 where s.process_id = new.process_id and l.status = 'in_review')
             + (select count(*) from public.subprocesses s
                 where s.process_id = new.process_id and s.current_stage = 'review'
                   and s.review_decision = 'pending_review'
                   and not exists (select 1 from public.subprocess_lines l where l.subprocess_id = s.id))
          into waiting;
        if waiting > 0 then
          perform public.notify(
            array(select pr.id from public.profiles pr
                  where pr.person_id = (new.new_value ->> 'person_id')::uuid
                    and pr.approval_state = 'approved' and pr.is_active),
            new.actor_id, 'review_queue', new.process_id, null, null,
            waiting || case when waiting = 1 then ' item is' else ' items are' end
              || ' already waiting for your review on ' || lbl);
        end if;
      end if;
    else
      null;
  end case;
  return new;
end;
$$;

revoke execute on function public.notify_from_activity() from public, anon, authenticated;
