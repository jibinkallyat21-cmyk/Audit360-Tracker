-- In-app notifications (generated from the audit log), read-state functions, team admin.

alter table public.notifications
  add column process_id uuid references public.processes (id) on delete cascade;
create index notifications_recipient_idx on public.notifications (recipient_user_id, is_read, created_at desc);

-- ---------- internal helpers (not granted to clients) ----------

create function public.profiles_for(p_process uuid, p_types public.assignment_type[]) returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select distinct pr.id
  from public.process_assignments a join public.profiles pr on pr.person_id = a.person_id
  where a.process_id = p_process and a.assignment_type = any (p_types)
    and pr.approval_state = 'approved' and pr.is_active
$$;

create function public.profiles_with_role(p_role text) returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select distinct pr.id
  from public.profiles pr
  join public.person_roles r on r.person_id = pr.person_id
  join public.roles ro on ro.id = r.role_id
  where ro.name = p_role and pr.approval_state = 'approved' and pr.is_active
$$;

create function public.notify(
  p_users uuid[], p_actor uuid, p_event text, p_process uuid, p_sub uuid, p_rp uuid, p_message text
) returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.notifications (recipient_user_id, event_type, process_id, subprocess_id, review_point_id, message)
  select distinct u, p_event, p_process, p_sub, p_rp, p_message
  from unnest(p_users) u
  where u is not null and u is distinct from p_actor
$$;

-- ---------- events ----------
-- Recipients are always chosen from people assigned to (or holding a role over) the process,
-- so nobody is told about a process they cannot open.

create function public.notify_from_activity() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  lbl text;
  stage text;
  team uuid[];
  rp public.review_points;
  seq int;
begin
  if new.process_id is null then return new; end if;
  select p.process_code || ' ' || p.title into lbl from public.processes p where p.id = new.process_id;
  if new.subprocess_id is not null then
    select s.seq into seq from public.subprocesses s where s.id = new.subprocess_id;
    lbl := lbl || ' (step ' || seq || ')';
  end if;
  team := array(select public.profiles_for(new.process_id,
            array['production_lead', 'team_member']::public.assignment_type[]));

  case new.action_type
    when 'stage_changed' then
      stage := new.new_value ->> 'stage';
      if new.metadata ->> 'reason' = 'failed_test' then
        perform public.notify(team, new.actor_id, 'test_failed', new.process_id, new.subprocess_id, null,
          lbl || ' failed testing and returned to Solution Building');
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
    else
      null;
  end case;
  return new;
end;
$$;

create trigger activity_notifications after insert on public.activity_logs
  for each row execute function public.notify_from_activity();

-- Losing all access to a process also removes its notifications, so titles do not linger.
create function public.drop_notifications_on_unassign() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid;
begin
  select id into uid from public.profiles where person_id = old.person_id;
  if uid is not null
     and not exists (select 1 from public.process_assignments
                     where process_id = old.process_id and person_id = old.person_id)
     and not exists (select 1 from public.person_roles r join public.roles ro on ro.id = r.role_id
                     where r.person_id = old.person_id and ro.name = 'project_lead') then
    delete from public.notifications where recipient_user_id = uid and process_id = old.process_id;
  end if;
  return old;
end;
$$;
create trigger assignment_removed_notifications after delete on public.process_assignments
  for each row execute function public.drop_notifications_on_unassign();

-- ---------- client-callable ----------

create function public.mark_notification_read(p_id uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.notifications set is_read = true, read_at = now()
  where id = p_id and recipient_user_id = auth.uid() and not is_read and public.is_approved_user()
$$;

create function public.mark_all_notifications_read() returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.notifications set is_read = true, read_at = now()
  where recipient_user_id = auth.uid() and not is_read and public.is_approved_user()
$$;

create function public.admin_set_team_member(p_team uuid, p_person uuid, p_member boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_role('system_admin') then perform public.deny(); end if;
  if not exists (select 1 from public.teams where id = p_team) then raise exception 'Unknown team.'; end if;
  if not exists (select 1 from public.people where id = p_person) then raise exception 'Unknown person.'; end if;
  if p_member then
    insert into public.team_members values (p_team, p_person) on conflict do nothing;
  else
    delete from public.team_members where team_id = p_team and person_id = p_person;
  end if;
  perform public.log_activity(auth.uid(), case when p_member then 'team_member_added' else 'team_member_removed' end,
    'team', p_team::text, null, jsonb_build_object('person_id', p_person), null, null);
end;
$$;

revoke execute on all functions in schema public from public, anon;
revoke execute on function
  public.profiles_for(uuid, public.assignment_type[]), public.profiles_with_role(text),
  public.notify(uuid[], uuid, text, uuid, uuid, uuid, text), public.notify_from_activity(),
  public.drop_notifications_on_unassign()
  from authenticated;
grant execute on function
  public.mark_notification_read(uuid), public.mark_all_notifications_read(),
  public.admin_set_team_member(uuid, uuid, boolean)
to authenticated;
