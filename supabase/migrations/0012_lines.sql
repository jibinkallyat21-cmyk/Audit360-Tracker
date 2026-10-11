-- Lines: a step that bundles several pieces of work (for example EOSB, GOSI, Prepaid and
-- Depreciation under 3.5) can be split into lines. Each line is worked on, sent to review and
-- approved on its own. The step's stage follows its lines automatically; the step reaches
-- Production when every line is approved. Steps without lines work exactly as before.

alter type public.approval_type add value if not exists 'line_decision';

create type public.line_status as enum
  ('not_started', 'in_progress', 'blocked', 'in_review', 'changes_required', 'approved');

create table public.subprocess_lines (
  id uuid primary key default gen_random_uuid(),
  subprocess_id uuid not null references public.subprocesses (id) on delete cascade,
  seq int not null,
  title text not null check (length(btrim(title)) > 0 and length(title) <= 120),
  status public.line_status not null default 'not_started',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  unique (subprocess_id, seq)
);
create unique index subprocess_lines_title_unique on public.subprocess_lines (subprocess_id, lower(btrim(title)));

-- Comments and approvals are append-only, so these links have no cascade: a line that has
-- history cannot be removed (the function below says so in plain words).
alter table public.comments add column line_id uuid references public.subprocess_lines (id);
alter table public.approvals add column line_id uuid references public.subprocess_lines (id);
alter table public.documents add column line_id uuid references public.subprocess_lines (id) on delete set null;
alter table public.testing_records add column line_id uuid references public.subprocess_lines (id) on delete set null;
create index documents_line_idx on public.documents (line_id);

alter table public.subprocess_lines enable row level security;
revoke all on table public.subprocess_lines from anon, authenticated;
-- Line titles and statuses are structure (like step titles); everything attached to them
-- (documents, comments, tests) keeps its stricter record policies.
create policy lines_select on public.subprocess_lines for select to authenticated
  using (public.can_see_subprocess(subprocess_id));
grant select on public.subprocess_lines to authenticated;

-- ---------- internal helpers (not granted to clients) ----------

create function public.has_lines(p_sub uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.subprocess_lines where subprocess_id = p_sub)
$$;

-- The status a first line starts with, so turning lines on for a step that is already under
-- way keeps its progress instead of resetting it.
create function public.line_initial_status(s public.subprocesses) returns public.line_status
language sql immutable set search_path = public, pg_temp as $$
  select case
    when s.current_stage = 'production' then 'approved'
    when s.current_stage = 'review' then
      (case when s.review_decision = 'approved' then 'approved' else 'in_review' end)
    when s.current_status = 'in_progress' then 'in_progress'
    when s.current_status = 'blocked' then 'blocked'
    when s.current_status = 'changes_required' then 'changes_required'
    else 'not_started' end::public.line_status
$$;

-- Moves the step to the stage its lines imply. Internal: callers have already checked permission.
create function public.line_rollup(p_sub uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.subprocesses;
  total int; approved int; in_review int; changes int; working int; blocked int;
  new_stage public.workflow_stage; new_status public.workflow_status;
  new_decision public.review_decision;
begin
  select * into s from public.subprocesses where id = p_sub for update;
  if not found or s.current_stage = 'production' then return; end if;
  select count(*),
         count(*) filter (where status = 'approved'),
         count(*) filter (where status = 'in_review'),
         count(*) filter (where status = 'changes_required'),
         count(*) filter (where status = 'in_progress'),
         count(*) filter (where status = 'blocked')
    into total, approved, in_review, changes, working, blocked
    from public.subprocess_lines where subprocess_id = p_sub;
  if total = 0 then return; end if;

  if approved = total then
    update public.subprocesses set current_stage = 'production', current_status = 'not_started',
      review_decision = 'approved', dashboard_status = 'not_started', stage_entered_at = now(),
      evidence_changed_at = null, updated_at = now(), updated_by = p_actor
      where id = p_sub;
    if p_actor is not null then
      insert into public.approvals (subprocess_id, approval_type, decision, decided_by)
        values (p_sub, 'production_entry', 'entered_production', p_actor);
    end if;
    perform public.log_activity(p_actor, 'stage_changed', 'subprocess', p_sub::text,
      jsonb_build_object('stage', s.current_stage, 'status', s.current_status),
      jsonb_build_object('stage', 'production', 'status', 'not_started'), s.process_id, p_sub,
      jsonb_build_object('reason', 'all_lines_approved'));
    return;
  end if;

  if in_review > 0 then
    new_stage := 'review'; new_status := 'in_progress'; new_decision := 'pending_review';
  elsif changes > 0 then
    new_stage := 'solution_building'; new_status := 'changes_required'; new_decision := 'changes_required';
  elsif working > 0 or approved > 0 then
    new_stage := 'solution_building'; new_status := 'in_progress'; new_decision := null;
  elsif blocked > 0 then
    new_stage := 'solution_building'; new_status := 'blocked'; new_decision := null;
  else
    return; -- every line not started: leave the step where it is
  end if;
  update public.subprocesses set current_stage = new_stage, current_status = new_status,
    review_decision = new_decision, evidence_changed_at = null,
    stage_entered_at = case when new_stage is distinct from s.current_stage then now() else stage_entered_at end,
    updated_at = now(), updated_by = coalesce(p_actor, updated_by)
    where id = p_sub;
end;
$$;

-- ---------- functions clients may call ----------

-- Who runs a step's lines: its Production Lead, or the System Administrator (structure only).
create function public.can_manage_lines(p_sub uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.subprocesses s where s.id = p_sub and (
    public.has_assignment(s.process_id, array['production_lead']::public.assignment_type[])
    or public.has_role('system_admin')))
$$;

create function public.line_add(p_sub uuid, p_title text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.subprocesses; lid uuid; first_line boolean;
begin
  if not public.is_approved_user() then perform public.deny(); end if;
  s := public.lock_subprocess(p_sub);
  if not public.can_manage_lines(p_sub) then perform public.deny(); end if;
  if s.current_stage = 'production' then
    raise exception 'This step is already in Production, so its lines cannot change.';
  end if;
  if p_title is null or length(btrim(p_title)) = 0 then raise exception 'Give the line a name.'; end if;
  if exists (select 1 from public.subprocess_lines
      where subprocess_id = p_sub and lower(btrim(title)) = lower(btrim(p_title))) then
    raise exception 'This step already has a line with that name.';
  end if;
  first_line := not public.has_lines(p_sub);
  insert into public.subprocess_lines (subprocess_id, seq, title, status, updated_by)
    values (p_sub,
      coalesce((select max(seq) from public.subprocess_lines where subprocess_id = p_sub), 0) + 1,
      btrim(p_title),
      case when first_line then public.line_initial_status(s) else 'not_started' end,
      auth.uid())
    returning id into lid;
  perform public.log_activity(auth.uid(), 'line_added', 'line', lid::text, null,
    jsonb_build_object('title', btrim(p_title)), s.process_id, p_sub);
  perform public.line_rollup(p_sub, auth.uid());
  return lid;
end;
$$;

create function public.line_rename(p_line uuid, p_title text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.subprocess_lines; s public.subprocesses;
begin
  if not public.is_approved_user() then perform public.deny(); end if;
  select * into l from public.subprocess_lines where id = p_line for update;
  if not found then perform public.deny(); end if;
  s := public.lock_subprocess(l.subprocess_id);
  if not public.can_manage_lines(l.subprocess_id) then perform public.deny(); end if;
  if p_title is null or length(btrim(p_title)) = 0 then raise exception 'Give the line a name.'; end if;
  if exists (select 1 from public.subprocess_lines where subprocess_id = l.subprocess_id
      and id <> p_line and lower(btrim(title)) = lower(btrim(p_title))) then
    raise exception 'This step already has a line with that name.';
  end if;
  update public.subprocess_lines set title = btrim(p_title), updated_at = now(), updated_by = auth.uid()
    where id = p_line;
  perform public.log_activity(auth.uid(), 'line_renamed', 'line', p_line::text,
    jsonb_build_object('title', l.title), jsonb_build_object('title', btrim(p_title)),
    s.process_id, s.id);
end;
$$;

create function public.line_remove(p_line uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.subprocess_lines; s public.subprocesses;
begin
  if not public.is_approved_user() then perform public.deny(); end if;
  select * into l from public.subprocess_lines where id = p_line for update;
  if not found then perform public.deny(); end if;
  s := public.lock_subprocess(l.subprocess_id);
  if not public.can_manage_lines(l.subprocess_id) then perform public.deny(); end if;
  if s.current_stage = 'production' then
    raise exception 'This step is already in Production, so its lines cannot change.';
  end if;
  if l.status in ('in_review', 'approved') then
    raise exception 'A line that is in review or approved cannot be removed.';
  end if;
  if exists (select 1 from public.comments where line_id = p_line)
     or exists (select 1 from public.approvals where line_id = p_line) then
    raise exception 'This line has comments or decisions on record, so it cannot be removed. Rename it instead.';
  end if;
  delete from public.subprocess_lines where id = p_line;
  perform public.log_activity(auth.uid(), 'line_removed', 'line', p_line::text,
    jsonb_build_object('title', l.title), null, s.process_id, s.id);
  perform public.line_rollup(s.id, auth.uid());
end;
$$;

-- The Production Lead keeps a line's working status. Review and approval are never set by hand.
create function public.line_set_status(p_line uuid, p_status public.line_status) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.subprocess_lines; s public.subprocesses;
begin
  if not public.is_approved_user() then perform public.deny(); end if;
  select * into l from public.subprocess_lines where id = p_line for update;
  if not found then perform public.deny(); end if;
  s := public.lock_subprocess(l.subprocess_id);
  if not public.has_assignment(s.process_id, array['production_lead']::public.assignment_type[]) then
    perform public.deny();
  end if;
  if s.current_stage = 'production' then raise exception 'This step is already in Production.'; end if;
  if p_status not in ('not_started', 'in_progress', 'blocked') then
    raise exception 'Status % cannot be set directly.', p_status;
  end if;
  if l.status in ('in_review', 'approved') then
    raise exception 'This line is % and cannot be changed by hand.', replace(l.status::text, '_', ' ');
  end if;
  update public.subprocess_lines set status = p_status, updated_at = now(), updated_by = auth.uid()
    where id = p_line;
  perform public.log_activity(auth.uid(), 'line_status_changed', 'line', p_line::text,
    jsonb_build_object('status', l.status), jsonb_build_object('status', p_status), s.process_id, s.id,
    jsonb_build_object('title', l.title));
  perform public.line_rollup(s.id, auth.uid());
end;
$$;

-- One click to the reviewers: needs a file on the line and the lead's confirmation that it was tested.
create function public.line_send_to_review(p_line uuid, p_tested boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.subprocess_lines; s public.subprocesses; evidence uuid;
begin
  if not public.is_approved_user() then perform public.deny(); end if;
  select * into l from public.subprocess_lines where id = p_line for update;
  if not found then perform public.deny(); end if;
  s := public.lock_subprocess(l.subprocess_id);
  if not public.has_assignment(s.process_id, array['production_lead']::public.assignment_type[]) then
    perform public.deny();
  end if;
  if s.current_stage = 'production' then raise exception 'This step is already in Production.'; end if;
  if l.status not in ('in_progress', 'changes_required') then
    raise exception 'Set the line to In Progress before sending it to review.';
  end if;
  if not coalesce(p_tested, false) then
    raise exception 'Confirm that the work was tested before sending it to review.';
  end if;
  select d.id into evidence from public.documents d where d.line_id = p_line
    order by d.created_at desc limit 1;
  if evidence is null then raise exception 'Upload at least one file for this line first.'; end if;
  insert into public.testing_records (subprocess_id, submitted_by, result, notes, evidence_document_id, line_id)
    values (s.id, auth.uid(), 'pass', nullif(btrim(coalesce(p_note, '')), ''), evidence, p_line);
  if p_note is not null and length(btrim(p_note)) > 0 then
    insert into public.comments (subprocess_id, line_id, author_id, comment_text)
      values (s.id, p_line, auth.uid(), btrim(p_note));
  end if;
  update public.subprocess_lines set status = 'in_review', updated_at = now(), updated_by = auth.uid()
    where id = p_line;
  perform public.log_activity(auth.uid(), 'line_sent_to_review', 'line', p_line::text,
    jsonb_build_object('status', l.status), jsonb_build_object('status', 'in_review'), s.process_id, s.id,
    jsonb_build_object('title', l.title));
  perform public.line_rollup(s.id, auth.uid());
end;
$$;

create function public.line_review_decision(p_line uuid, p_decision public.review_decision, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.subprocess_lines; s public.subprocesses; others_open int;
begin
  if not public.is_approved_user() then perform public.deny(); end if;
  select * into l from public.subprocess_lines where id = p_line for update;
  if not found then perform public.deny(); end if;
  s := public.lock_subprocess(l.subprocess_id);
  if not public.has_assignment(s.process_id, array['reviewer']::public.assignment_type[])
     or public.is_conflicted_reviewer(s.process_id) then
    perform public.deny();
  end if;
  if l.status <> 'in_review' then raise exception 'Only a line that is in review can be decided.'; end if;
  if p_decision not in ('approved', 'changes_required') then
    raise exception 'Choose Approved or Changes Required.';
  end if;

  if p_decision = 'approved' then
    select count(*) into others_open from public.subprocess_lines
      where subprocess_id = s.id and id <> p_line and status <> 'approved';
    if others_open = 0 and exists (select 1 from public.review_points where subprocess_id = s.id and status <> 'closed') then
      raise exception 'Close all review points before approving the last line.';
    end if;
    update public.subprocess_lines set status = 'approved', updated_at = now(), updated_by = auth.uid()
      where id = p_line;
  else
    if p_note is null or length(btrim(p_note)) = 0 then
      raise exception 'Say what needs to change.';
    end if;
    update public.subprocess_lines set status = 'changes_required', updated_at = now(), updated_by = auth.uid()
      where id = p_line;
  end if;
  if p_note is not null and length(btrim(p_note)) > 0 then
    insert into public.comments (subprocess_id, line_id, author_id, comment_text)
      values (s.id, p_line, auth.uid(), btrim(p_note));
  end if;
  insert into public.approvals (subprocess_id, line_id, approval_type, decision, decided_by, decision_note)
    values (s.id, p_line, 'line_decision', p_decision::text, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''));
  perform public.log_activity(auth.uid(), 'line_decision', 'line', p_line::text,
    jsonb_build_object('status', l.status),
    jsonb_build_object('status', case when p_decision = 'approved' then 'approved' else 'changes_required' end,
                       'decision', p_decision),
    s.process_id, s.id, jsonb_build_object('title', l.title));
  perform public.line_rollup(s.id, auth.uid());
end;
$$;

-- Moves a document onto a line (or off it, with null). Files of a line that is under review or
-- approved stay where they are.
create function public.assign_document_line(p_document uuid, p_line uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.documents; s public.subprocesses; target public.subprocess_lines; cur public.subprocess_lines;
begin
  if not public.is_approved_user() then perform public.deny(); end if;
  select * into d from public.documents where id = p_document for update;
  if not found then perform public.deny(); end if;
  select * into s from public.subprocesses where id = d.subprocess_id;
  if not public.has_assignment(s.process_id,
      array['production_lead', 'team_member', 'supporting_role']::public.assignment_type[]) then
    perform public.deny();
  end if;
  if p_line is not null then
    select * into target from public.subprocess_lines where id = p_line and subprocess_id = s.id;
    if not found then raise exception 'That line does not belong to this step.'; end if;
    if target.status in ('in_review', 'approved') then
      raise exception 'A line that is in review or approved cannot take new files.';
    end if;
  end if;
  if d.line_id is not null then
    select * into cur from public.subprocess_lines where id = d.line_id;
    if cur.status in ('in_review', 'approved') then
      raise exception 'Files of a line that is in review or approved cannot be moved.';
    end if;
  end if;
  update public.documents set line_id = p_line where id = p_document;
  perform public.log_activity(auth.uid(), 'document_moved', 'document', p_document::text,
    jsonb_build_object('line_id', d.line_id), jsonb_build_object('line_id', p_line), s.process_id, s.id,
    jsonb_build_object('filename', d.original_filename));
end;
$$;

-- ---------- existing functions, with line awareness ----------

-- Same function as before with one extra argument: the line a new document belongs to.
drop function public.register_document_version(uuid, uuid, uuid, text, text, int, text, text);
create function public.register_document_version(
  p_sub uuid, p_rp uuid, p_document uuid, p_filename text, p_storage_path text,
  p_size int, p_mime text, p_note text default null, p_line uuid default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.subprocesses; doc uuid := p_document; ver int; vid uuid; dline uuid; lstatus public.line_status;
begin
  if not public.is_approved_user() then perform public.deny(); end if;
  select * into s from public.subprocesses where id = p_sub for update;
  if not found or not public.has_assignment(s.process_id) then perform public.deny(); end if;
  if p_rp is not null and not exists (select 1 from public.review_points where id = p_rp and subprocess_id = p_sub) then
    raise exception 'Review point does not belong to this item.';
  end if;
  if doc is null then
    if p_line is not null and not exists (
        select 1 from public.subprocess_lines where id = p_line and subprocess_id = p_sub) then
      raise exception 'That line does not belong to this step.';
    end if;
    insert into public.documents (subprocess_id, review_point_id, original_filename, uploaded_by, line_id)
      values (p_sub, p_rp, p_filename, auth.uid(), p_line) returning id, line_id into doc, dline;
  else
    select line_id into dline from public.documents where id = doc and subprocess_id = p_sub;
    if not found then perform public.deny(); end if;
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
  if dline is not null and s.current_stage <> 'production' then
    select status into lstatus from public.subprocess_lines where id = dline for update;
    if lstatus = 'approved' then
      update public.subprocess_lines set status = 'in_review', updated_at = now(), updated_by = auth.uid()
        where id = dline;
      perform public.log_activity(auth.uid(), 'line_reopened', 'line', dline::text,
        jsonb_build_object('status', 'approved'), jsonb_build_object('status', 'in_review'),
        s.process_id, p_sub,
        jsonb_build_object('title', (select title from public.subprocess_lines where id = dline)));
      perform public.line_rollup(p_sub, auth.uid());
    end if;
  end if;
  perform public.log_activity(auth.uid(), case when ver = 1 then 'document_uploaded' else 'document_replaced' end,
    'document', doc::text, null, jsonb_build_object('version', ver, 'filename', p_filename),
    s.process_id, p_sub);
  return vid;
end;
$$;

-- The step-level actions below stay as they were for steps without lines. For a step with
-- lines they are replaced by the line actions, except in Production (Project Lead).
create or replace function public.set_status(p_sub uuid, p_status public.workflow_status) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.subprocesses;
begin
  if not public.is_approved_user() then perform public.deny(); end if;
  s := public.lock_subprocess(p_sub);
  if s.current_stage = 'production' then
    if not public.has_role('project_lead') then perform public.deny(); end if;
  elsif not public.has_assignment(s.process_id, array['production_lead']::public.assignment_type[]) then
    perform public.deny();
  elsif public.has_lines(p_sub) then
    raise exception 'This step is managed line by line. Use its lines.';
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

create or replace function public.complete_stage(p_sub uuid) returns void
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
  if s.current_stage <> 'production' and public.has_lines(p_sub) then
    raise exception 'This step is managed line by line. It moves on when every line is approved.';
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

create or replace function public.record_testing(
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
  if public.has_lines(p_sub) then
    raise exception 'This step is managed line by line. Confirm the test when you send a line to review.';
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

create or replace function public.record_review_decision(
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
  if public.has_lines(p_sub) then
    raise exception 'This step is reviewed line by line. Decide each line.';
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

-- Reviewers may raise review points on a step with lines at any stage before Production.
create or replace function public.raise_review_point(p_sub uuid, p_description text, p_owner_person uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.subprocesses; rp uuid;
begin
  if not public.is_approved_user() then perform public.deny(); end if;
  s := public.lock_subprocess(p_sub);
  if not public.has_assignment(s.process_id, array['reviewer']::public.assignment_type[])
     or public.is_conflicted_reviewer(s.process_id) then
    perform public.deny();
  end if;
  if public.has_lines(p_sub) then
    if s.current_stage = 'production' then
      raise exception 'Review points cannot be raised once the step is in Production.';
    end if;
  elsif s.current_stage not in ('testing', 'review') then
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

-- ---------- notifications for line events ----------
-- Same trigger function as 0006 with four new events (line sent to review, reopened, decided).
create or replace function public.notify_from_activity() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  lbl text;
  stage text;
  team uuid[];
  rp public.review_points;
  seq int;
  line_title text;
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
    else
      null;
  end case;
  return new;
end;
$$;

-- ---------- grants ----------

revoke execute on all functions in schema public from public, anon;
revoke execute on function
  public.has_lines(uuid), public.line_initial_status(public.subprocesses),
  public.line_rollup(uuid, uuid), public.notify_from_activity()
  from authenticated;
grant execute on function
  public.can_manage_lines(uuid), public.line_add(uuid, text), public.line_rename(uuid, text),
  public.line_remove(uuid), public.line_set_status(uuid, public.line_status),
  public.line_send_to_review(uuid, boolean, text),
  public.line_review_decision(uuid, public.review_decision, text),
  public.assign_document_line(uuid, uuid),
  public.register_document_version(uuid, uuid, uuid, text, text, int, text, text, uuid)
to authenticated;

-- ---------- 3.5: turn lines on, and file the existing documents under them ----------
-- Only step 3.5 names its pieces of work (EOSB / GOSI / Prepaid / Depreciation). Other steps
-- can get lines from the website at any time.

do $$
declare
  sub public.subprocesses;
  titles text[] := array['EOSB', 'GOSI', 'Prepaid', 'Depreciation'];
  pats text[] := array[
    'eosb|end[ _-]?of[ _-]?service|gratuity|service benefit',
    'gosi|social insurance',
    'prepaid|prepayment|pre-paid',
    'depreciat|fixed asset|(^|[^a-z])fa([^a-z]|$)'];
  i int; moved int := 0; left_over int := 0;
begin
  for sub in select s.* from public.subprocesses s join public.processes p on p.id = s.process_id
             where p.process_code = '3.5' and not exists (select 1 from public.subprocess_lines l where l.subprocess_id = s.id)
  loop
    for i in 1 .. array_length(titles, 1) loop
      insert into public.subprocess_lines (subprocess_id, seq, title, status)
        values (sub.id, i, titles[i], public.line_initial_status(sub));
    end loop;
    -- A document goes to a line when its name (or a version note) points to exactly one line.
    update public.documents d set line_id = m.line_id
    from (
      select d2.id as doc_id, (array_agg(l.id))[1] as line_id
      from public.documents d2
      join public.subprocess_lines l on l.subprocess_id = d2.subprocess_id
      cross join lateral (select titles[l.seq] as t, pats[l.seq] as pat) k
      where d2.subprocess_id = sub.id and d2.line_id is null
        and (lower(d2.original_filename) ~ k.pat
             or exists (select 1 from public.document_versions v where v.document_id = d2.id
                        and lower(coalesce(v.original_filename, '') || ' ' || coalesce(v.version_note, '')) ~ k.pat))
      group by d2.id
      having count(*) = 1
    ) m
    where d.id = m.doc_id;
    get diagnostics i = row_count;
    moved := moved + i;
    select count(*) into i from public.documents where subprocess_id = sub.id and line_id is null;
    left_over := left_over + i;
    perform public.line_rollup(sub.id, null);
  end loop;
  raise notice 'Lines created for 3.5. Documents filed under a line: %. Left for the team to file: %.', moved, left_over;
end $$;
