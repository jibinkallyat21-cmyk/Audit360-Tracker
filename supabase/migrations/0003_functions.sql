-- Authorization helpers and the only write paths for workflow state.
-- All state changes go through these functions; the authenticated role has no direct DML.

-- ---------- helpers (used by RLS and by the functions below) ----------

create function public.current_person_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select person_id from public.profiles
  where id = auth.uid() and approval_state = 'approved' and is_active
$$;

create function public.is_approved_user() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles
    where id = auth.uid() and approval_state = 'approved' and is_active)
$$;

create function public.has_role(p_role text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.person_roles pr join public.roles r on r.id = pr.role_id
    where pr.person_id = public.current_person_id() and r.name = p_role)
$$;

create function public.has_assignment(p_process uuid, p_types public.assignment_type[] default null)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.process_assignments
    where process_id = p_process and person_id = public.current_person_id()
      and (p_types is null or assignment_type = any (p_types)))
$$;

-- Full record access (documents, comments, review points, testing, history).
create function public.can_view_records(p_process uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.has_role('project_lead') or public.has_assignment(p_process)
$$;

-- Structure access (title, stage, status only). Does not imply access to records.
create function public.can_see_process(p_process uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.can_view_records(p_process)
    or public.has_role('project_head') or public.has_role('system_admin')
    or (public.has_role('dashboard_lead') and exists (
          select 1 from public.subprocesses where process_id = p_process and current_stage = 'production'))
$$;

create function public.can_see_subprocess(p_sub uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.subprocesses s
    where s.id = p_sub and (
      public.can_view_records(s.process_id)
      or public.has_role('project_head') or public.has_role('system_admin')
      or (public.has_role('dashboard_lead') and s.current_stage = 'production')))
$$;

create function public.can_view_subprocess_records(p_sub uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.subprocesses s
    where s.id = p_sub and public.can_view_records(s.process_id))
$$;

-- A reviewer may not review work they also contributed to.
create function public.is_conflicted_reviewer(p_process uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.has_assignment(p_process, array['team_member', 'production_lead', 'supporting_role']::public.assignment_type[])
$$;

create function public.deny() returns void language plpgsql as $$
begin
  raise exception 'Not authorized.' using errcode = '42501';
end;
$$;

-- Internal only (not granted to clients).
create function public.log_activity(
  p_actor uuid, p_action text, p_entity_type text, p_entity_id text,
  p_prev jsonb, p_new jsonb, p_process uuid, p_sub uuid, p_meta jsonb default '{}'::jsonb
) returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.activity_logs
    (actor_id, action_type, entity_type, entity_id, previous_value, new_value, process_id, subprocess_id, metadata)
  values (p_actor, p_action, p_entity_type, p_entity_id, p_prev, p_new, p_process, p_sub, p_meta)
$$;

create function public.next_stage(p public.workflow_stage) returns public.workflow_stage
language sql immutable as $$
  select case p
    when 'process_definition' then 'solution_building'
    when 'solution_building' then 'testing'
    when 'testing' then 'review'
    when 'review' then 'production'
    else 'production' end::public.workflow_stage
$$;

-- Loads and locks a subprocess; any miss or visibility failure reads as "Not authorized".
create function public.lock_subprocess(p_sub uuid) returns public.subprocesses
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.subprocesses;
begin
  select * into s from public.subprocesses where id = p_sub for update;
  if not found then perform public.deny(); end if;
  return s;
end;
$$;

-- ---------- workflow ----------

-- Production Leads manage status through Review; the Project Lead manages Production.
create function public.set_status(p_sub uuid, p_status public.workflow_status) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.subprocesses;
begin
  if not public.is_approved_user() then perform public.deny(); end if;
  s := public.lock_subprocess(p_sub);
  if s.current_stage = 'production' then
    if not public.has_role('project_lead') then perform public.deny(); end if;
  elsif not public.has_assignment(s.process_id, array['production_lead']::public.assignment_type[]) then
    perform public.deny();
  end if;
  -- Completed and Changes Required are set by the workflow itself, never by hand.
  if p_status not in ('not_started', 'in_progress', 'blocked') then
    raise exception 'Status % cannot be set directly.', p_status;
  end if;
  update public.subprocesses set current_status = p_status, updated_at = now(), updated_by = auth.uid()
    where id = p_sub;
  perform public.log_activity(auth.uid(), 'status_changed', 'subprocess', p_sub::text,
    jsonb_build_object('stage', s.current_stage, 'status', s.current_status),
    jsonb_build_object('stage', s.current_stage, 'status', p_status), s.process_id, p_sub);
end;
$$;

create function public.complete_stage(p_sub uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.subprocesses;
  last_approval timestamptz;
  new_stage public.workflow_stage;
begin
  if not public.is_approved_user() then perform public.deny(); end if;
  s := public.lock_subprocess(p_sub);
  if s.current_stage in ('review', 'production') then
    if not public.has_role('project_lead') then perform public.deny(); end if;
  elsif not public.has_assignment(s.process_id, array['production_lead']::public.assignment_type[]) then
    perform public.deny();
  end if;
  if s.current_status <> 'in_progress' then
    raise exception 'The item must be In Progress before its stage can be completed.';
  end if;

  if s.current_stage = 'testing' then
    if not exists (select 1 from public.testing_records t
        where t.subprocess_id = p_sub and t.result = 'pass' and t.created_at >= s.stage_entered_at) then
      raise exception 'A passing test result must be recorded before Testing can be completed.';
    end if;
  elsif s.current_stage = 'review' then
    select max(decided_at) into last_approval from public.approvals
      where subprocess_id = p_sub and approval_type = 'review_decision' and decision = 'approved';
    if s.review_decision is distinct from 'approved' or last_approval is null then
      raise exception 'Production requires an Approved review decision.';
    end if;
    if exists (select 1 from public.review_points where subprocess_id = p_sub and status <> 'closed') then
      raise exception 'All review points must be closed before Production.';
    end if;
    if s.evidence_changed_at is not null and s.evidence_changed_at > last_approval then
      raise exception 'Evidence changed after approval; the reviewer must approve again.';
    end if;
  end if;

  if s.current_stage = 'production' then
    update public.subprocesses set current_status = 'completed', updated_at = now(), updated_by = auth.uid()
      where id = p_sub;
    perform public.log_activity(auth.uid(), 'production_completed', 'subprocess', p_sub::text,
      jsonb_build_object('status', s.current_status), jsonb_build_object('status', 'completed'),
      s.process_id, p_sub);
    return;
  end if;

  new_stage := public.next_stage(s.current_stage);
  update public.subprocesses set
      current_stage = new_stage, current_status = 'not_started', stage_entered_at = now(),
      review_decision = case when new_stage = 'review' then 'pending_review'::public.review_decision
                             else review_decision end,
      dashboard_status = case when new_stage = 'production' then 'not_started'::public.dashboard_status
                              else null end,
      updated_at = now(), updated_by = auth.uid()
    where id = p_sub;
  if new_stage = 'production' then
    insert into public.approvals (subprocess_id, approval_type, decision, decided_by)
      values (p_sub, 'production_entry', 'entered_production', auth.uid());
  end if;
  perform public.log_activity(auth.uid(), 'stage_changed', 'subprocess', p_sub::text,
    jsonb_build_object('stage', s.current_stage, 'status', s.current_status),
    jsonb_build_object('stage', new_stage, 'status', 'not_started'), s.process_id, p_sub);
end;
$$;

create function public.record_testing(
  p_sub uuid, p_result public.test_result, p_notes text, p_evidence_document uuid default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.subprocesses;
begin
  if not public.is_approved_user() then perform public.deny(); end if;
  s := public.lock_subprocess(p_sub);
  if not public.has_assignment(s.process_id,
      array['production_lead', 'team_member', 'supporting_role']::public.assignment_type[]) then
    perform public.deny();
  end if;
  if s.current_stage <> 'testing' then raise exception 'Testing results can only be recorded during Testing.'; end if;
  if p_evidence_document is not null and not exists (
      select 1 from public.documents where id = p_evidence_document and subprocess_id = p_sub) then
    raise exception 'Evidence document does not belong to this item.';
  end if;
  insert into public.testing_records (subprocess_id, submitted_by, result, notes, evidence_document_id)
    values (p_sub, auth.uid(), p_result, p_notes, p_evidence_document);
  perform public.log_activity(auth.uid(), 'testing_recorded', 'subprocess', p_sub::text,
    null, jsonb_build_object('result', p_result), s.process_id, p_sub);
  if p_result = 'fail' then
    update public.subprocesses set current_stage = 'solution_building', current_status = 'changes_required',
      stage_entered_at = now(), updated_at = now(), updated_by = auth.uid() where id = p_sub;
    perform public.log_activity(auth.uid(), 'stage_changed', 'subprocess', p_sub::text,
      jsonb_build_object('stage', 'testing', 'status', s.current_status),
      jsonb_build_object('stage', 'solution_building', 'status', 'changes_required'),
      s.process_id, p_sub, jsonb_build_object('reason', 'failed_test'));
  end if;
end;
$$;

-- ---------- review ----------

create function public.raise_review_point(p_sub uuid, p_description text, p_owner_person uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.subprocesses; rp uuid;
begin
  if not public.is_approved_user() then perform public.deny(); end if;
  s := public.lock_subprocess(p_sub);
  if not public.has_assignment(s.process_id, array['reviewer']::public.assignment_type[])
     or public.is_conflicted_reviewer(s.process_id) then
    perform public.deny();
  end if;
  if s.current_stage not in ('testing', 'review') then
    raise exception 'Review points can only be raised during Testing or Review.';
  end if;
  if not exists (select 1 from public.process_assignments
      where process_id = s.process_id and person_id = p_owner_person
        and assignment_type in ('production_lead', 'team_member', 'supporting_role')) then
    raise exception 'The corrective owner must be assigned to this process.';
  end if;
  insert into public.review_points (subprocess_id, raised_by, assigned_to_person_id, description)
    values (p_sub, auth.uid(), p_owner_person, p_description) returning id into rp;
  perform public.log_activity(auth.uid(), 'review_point_raised', 'review_point', rp::text,
    null, jsonb_build_object('owner_person_id', p_owner_person), s.process_id, p_sub);
  return rp;
end;
$$;

create function public.record_review_decision(
  p_sub uuid, p_decision public.review_decision, p_note text default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.subprocesses;
begin
  if not public.is_approved_user() then perform public.deny(); end if;
  s := public.lock_subprocess(p_sub);
  if not public.has_assignment(s.process_id, array['reviewer']::public.assignment_type[])
     or public.is_conflicted_reviewer(s.process_id) then
    perform public.deny();
  end if;
  if s.current_stage <> 'review' then raise exception 'Decisions can only be recorded during Review.'; end if;
  if p_decision = 'pending_review' then raise exception 'Choose Approved or Changes Required.'; end if;

  if p_decision = 'approved' then
    if exists (select 1 from public.review_points where subprocess_id = p_sub and status <> 'closed') then
      raise exception 'Close all review points before approving.';
    end if;
    update public.subprocesses set review_decision = 'approved', updated_at = now(), updated_by = auth.uid()
      where id = p_sub;
  else
    if not exists (select 1 from public.review_points where subprocess_id = p_sub and status <> 'closed') then
      raise exception 'Raise a review point before requesting changes.';
    end if;
    update public.subprocesses set review_decision = 'changes_required', current_stage = 'solution_building',
      current_status = 'changes_required', stage_entered_at = now(), updated_at = now(), updated_by = auth.uid()
      where id = p_sub;
  end if;
  insert into public.approvals (subprocess_id, approval_type, decision, decided_by, decision_note)
    values (p_sub, 'review_decision', p_decision::text, auth.uid(), p_note);
  perform public.log_activity(auth.uid(), 'review_decision', 'subprocess', p_sub::text,
    jsonb_build_object('review_decision', s.review_decision),
    jsonb_build_object('review_decision', p_decision), s.process_id, p_sub);
end;
$$;

-- actions: start, submit (owner) / approve_close, return (reviewer)
create function public.update_review_point(p_rp uuid, p_action text, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare rp public.review_points; s public.subprocesses; new_status public.review_point_status;
begin
  if not public.is_approved_user() then perform public.deny(); end if;
  select * into rp from public.review_points where id = p_rp for update;
  if not found then perform public.deny(); end if;
  select * into s from public.subprocesses where id = rp.subprocess_id;

  if p_action in ('start', 'submit') then
    if rp.assigned_to_person_id is distinct from public.current_person_id() then perform public.deny(); end if;
    if p_action = 'start' then
      if rp.status not in ('open', 'changes_required') then raise exception 'Cannot start from %.', rp.status; end if;
      new_status := 'in_progress';
    else
      if rp.status not in ('open', 'in_progress', 'changes_required') then
        raise exception 'Cannot submit from %.', rp.status;
      end if;
      if p_note is null or length(btrim(p_note)) = 0 then raise exception 'A response is required.'; end if;
      new_status := 'submitted_for_closure';
    end if;
    update public.review_points set status = new_status, updated_at = now(),
      resolution_note = case when p_action = 'submit' then p_note else resolution_note end,
      submitted_at = case when p_action = 'submit' then now() else submitted_at end
      where id = p_rp;
  elsif p_action in ('approve_close', 'return') then
    if not public.has_assignment(s.process_id, array['reviewer']::public.assignment_type[])
       or public.is_conflicted_reviewer(s.process_id)
       or rp.assigned_to_person_id = public.current_person_id() then
      perform public.deny();
    end if;
    if rp.status <> 'submitted_for_closure' then
      raise exception 'Only a submitted response can be approved or returned.';
    end if;
    if p_action = 'return' then
      if p_note is null or length(btrim(p_note)) = 0 then raise exception 'A reason is required.'; end if;
      new_status := 'changes_required';
      update public.review_points set status = new_status, updated_at = now() where id = p_rp;
    else
      new_status := 'closed';
      update public.review_points set status = new_status, closed_by = auth.uid(), closed_at = now(),
        updated_at = now() where id = p_rp;
    end if;
    insert into public.approvals (subprocess_id, review_point_id, approval_type, decision, decided_by, decision_note)
      values (rp.subprocess_id, p_rp, 'review_point_closure',
              case when p_action = 'return' then 'returned' else 'closed' end, auth.uid(), p_note);
  else
    raise exception 'Unknown action.';
  end if;
  perform public.log_activity(auth.uid(), 'review_point_' || p_action, 'review_point', p_rp::text,
    jsonb_build_object('status', rp.status), jsonb_build_object('status', new_status), s.process_id, s.id);
end;
$$;

create function public.add_comment(
  p_sub uuid, p_text text, p_parent uuid default null, p_rp uuid default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.subprocesses; cid uuid;
begin
  if not public.is_approved_user() then perform public.deny(); end if;
  select * into s from public.subprocesses where id = p_sub;
  if not found or not public.can_view_records(s.process_id) then perform public.deny(); end if;
  if p_parent is not null and not exists (select 1 from public.comments where id = p_parent and subprocess_id = p_sub) then
    raise exception 'Parent comment does not belong to this item.';
  end if;
  if p_rp is not null and not exists (select 1 from public.review_points where id = p_rp and subprocess_id = p_sub) then
    raise exception 'Review point does not belong to this item.';
  end if;
  insert into public.comments (subprocess_id, review_point_id, parent_comment_id, author_id, comment_text)
    values (p_sub, p_rp, p_parent, auth.uid(), p_text) returning id into cid;
  perform public.log_activity(auth.uid(), 'comment_added', 'comment', cid::text, null, null, s.process_id, p_sub);
  return cid;
end;
$$;

-- ---------- documents ----------

-- Called by the server after the file is stored and validated. Never overwrites: adds a version.
create function public.register_document_version(
  p_sub uuid, p_rp uuid, p_document uuid, p_filename text, p_storage_path text,
  p_size int, p_mime text, p_note text default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.subprocesses; doc uuid := p_document; ver int; vid uuid;
begin
  if not public.is_approved_user() then perform public.deny(); end if;
  select * into s from public.subprocesses where id = p_sub for update;
  if not found or not public.has_assignment(s.process_id) then perform public.deny(); end if;
  if p_rp is not null and not exists (select 1 from public.review_points where id = p_rp and subprocess_id = p_sub) then
    raise exception 'Review point does not belong to this item.';
  end if;
  if doc is null then
    insert into public.documents (subprocess_id, review_point_id, original_filename, uploaded_by)
      values (p_sub, p_rp, p_filename, auth.uid()) returning id into doc;
  elsif not exists (select 1 from public.documents where id = doc and subprocess_id = p_sub) then
    perform public.deny();
  end if;
  select coalesce(max(version_number), 0) + 1 into ver from public.document_versions where document_id = doc;
  update public.document_versions set is_current = false where document_id = doc and is_current;
  insert into public.document_versions
    (document_id, version_number, original_filename, storage_path, file_size, mime_type, version_note, uploaded_by)
    values (doc, ver, p_filename, p_storage_path, p_size, p_mime, p_note, auth.uid()) returning id into vid;
  -- New evidence after an approval forces the reviewer to approve again.
  if s.review_decision = 'approved' and s.current_stage <> 'production' then
    update public.subprocesses set evidence_changed_at = now() where id = p_sub;
  end if;
  perform public.log_activity(auth.uid(), case when ver = 1 then 'document_uploaded' else 'document_replaced' end,
    'document', doc::text, null, jsonb_build_object('version', ver, 'filename', p_filename),
    s.process_id, p_sub);
  return vid;
end;
$$;

-- ---------- dashboard ----------

create function public.set_deadline(p_deadline timestamptz) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare prev jsonb;
begin
  if not public.has_role('dashboard_lead') then perform public.deny(); end if;
  if p_deadline is null then raise exception 'A deadline is required.'; end if;
  select setting_value into prev from public.project_settings where setting_key = 'project_deadline';
  insert into public.project_settings (setting_key, setting_value, updated_by)
    values ('project_deadline', to_jsonb(p_deadline), auth.uid())
    on conflict (setting_key) do update
      set setting_value = excluded.setting_value, updated_by = auth.uid(), updated_at = now();
  perform public.log_activity(auth.uid(), 'deadline_set', 'project_settings', 'project_deadline',
    prev, to_jsonb(p_deadline), null, null);
end;
$$;

create function public.set_dashboard_status(p_sub uuid, p_status public.dashboard_status) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.subprocesses;
begin
  if not public.has_role('dashboard_lead') or not public.can_see_subprocess(p_sub) then
    perform public.deny();
  end if;
  s := public.lock_subprocess(p_sub);
  if s.current_stage <> 'production' then raise exception 'Dashboard status applies only in Production.'; end if;
  update public.subprocesses set dashboard_status = p_status, updated_at = now(), updated_by = auth.uid()
    where id = p_sub;
  perform public.log_activity(auth.uid(), 'dashboard_status_changed', 'subprocess', p_sub::text,
    jsonb_build_object('dashboard_status', s.dashboard_status),
    jsonb_build_object('dashboard_status', p_status), s.process_id, p_sub);
end;
$$;

-- ---------- administration ----------

create function public.admin_approve_user(p_user uuid, p_person uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.profiles;
begin
  if not public.has_role('system_admin') then perform public.deny(); end if;
  select * into p from public.profiles where id = p_user for update;
  if not found then raise exception 'Unknown user.'; end if;
  if not exists (select 1 from public.people where id = p_person) then raise exception 'Unknown person.'; end if;
  if exists (select 1 from public.profiles where person_id = p_person and id <> p_user) then
    raise exception 'That person is already linked to another account.';
  end if;
  update public.profiles set approval_state = 'approved', is_active = true, person_id = p_person,
    updated_at = now() where id = p_user;
  perform public.log_activity(auth.uid(), 'user_approved', 'profile', p_user::text,
    jsonb_build_object('approval_state', p.approval_state, 'person_id', p.person_id),
    jsonb_build_object('approval_state', 'approved', 'person_id', p_person), null, null);
end;
$$;

create function public.admin_reject_user(p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.profiles;
begin
  if not public.has_role('system_admin') then perform public.deny(); end if;
  if p_user = auth.uid() then raise exception 'You cannot change your own access.'; end if;
  select * into p from public.profiles where id = p_user for update;
  if not found then raise exception 'Unknown user.'; end if;
  update public.profiles set approval_state = 'rejected', updated_at = now() where id = p_user;
  perform public.log_activity(auth.uid(), 'user_rejected', 'profile', p_user::text,
    jsonb_build_object('approval_state', p.approval_state), jsonb_build_object('approval_state', 'rejected'), null, null);
end;
$$;

create function public.admin_set_user_active(p_user uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.profiles;
begin
  if not public.has_role('system_admin') then perform public.deny(); end if;
  if p_user = auth.uid() then raise exception 'You cannot change your own access.'; end if;
  select * into p from public.profiles where id = p_user for update;
  if not found then raise exception 'Unknown user.'; end if;
  if p_active and p.person_id is null then raise exception 'Approve the user first.'; end if;
  update public.profiles set is_active = p_active,
    approval_state = case when p_active then 'approved'::public.approval_state else 'deactivated'::public.approval_state end,
    updated_at = now() where id = p_user;
  perform public.log_activity(auth.uid(), case when p_active then 'user_activated' else 'user_deactivated' end,
    'profile', p_user::text, jsonb_build_object('is_active', p.is_active), jsonb_build_object('is_active', p_active), null, null);
end;
$$;

create function public.admin_set_assignment(
  p_process uuid, p_person uuid, p_type public.assignment_type, p_assigned boolean
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_role('system_admin') then perform public.deny(); end if;
  if not exists (select 1 from public.processes where id = p_process) then raise exception 'Unknown process.'; end if;
  if p_assigned then
    insert into public.process_assignments (process_id, person_id, assignment_type, assigned_by)
      values (p_process, p_person, p_type, auth.uid()) on conflict do nothing;
  else
    delete from public.process_assignments
      where process_id = p_process and person_id = p_person and assignment_type = p_type;
  end if;
  perform public.log_activity(auth.uid(), case when p_assigned then 'assignment_added' else 'assignment_removed' end,
    'process_assignment', p_process::text, null,
    jsonb_build_object('person_id', p_person, 'type', p_type), p_process, null);
end;
$$;

create function public.admin_set_person_role(p_person uuid, p_role text, p_granted boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare rid smallint;
begin
  if not public.has_role('system_admin') then perform public.deny(); end if;
  select id into rid from public.roles where name = p_role;
  if rid is null then raise exception 'Unknown role.'; end if;
  if p_role = 'system_admin' and not p_granted and p_person = public.current_person_id() then
    raise exception 'You cannot remove your own administrator role.';
  end if;
  if p_granted then
    insert into public.person_roles values (p_person, rid) on conflict do nothing;
  else
    delete from public.person_roles where person_id = p_person and role_id = rid;
  end if;
  perform public.log_activity(auth.uid(), case when p_granted then 'role_granted' else 'role_revoked' end,
    'person_role', p_person::text, null, jsonb_build_object('role', p_role), null, null);
end;
$$;

-- One-time bootstrap, run by the project owner in the SQL editor (not callable by clients).
create function public.bootstrap_first_admin(p_email text, p_person_name text default 'Jibin K K') returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid; pid uuid;
begin
  if exists (select 1 from public.profiles pr
      join public.person_roles r on r.person_id = pr.person_id
      join public.roles ro on ro.id = r.role_id
      where ro.name = 'system_admin' and pr.approval_state = 'approved') then
    raise exception 'An administrator already exists.';
  end if;
  select id into uid from public.profiles where lower(email) = lower(p_email);
  if uid is null then raise exception 'Register this email in the app first.'; end if;
  select id into pid from public.people where display_name = p_person_name;
  if pid is null then raise exception 'Unknown person.'; end if;
  update public.profiles set approval_state = 'approved', is_active = true, person_id = pid, updated_at = now()
    where id = uid;
  perform public.log_activity(uid, 'bootstrap_admin', 'profile', uid::text, null,
    jsonb_build_object('person_id', pid), null, null);
end;
$$;
