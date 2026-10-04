-- End-of-project export and archive. The administrator requests an export, the Project Head
-- approves it, the administrator runs it once, and archiving is a separate deliberate step.
-- Nothing here deletes project data.

create type public.export_status as enum ('requested', 'approved', 'rejected', 'completed');

create table public.export_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.profiles (id),
  requested_at timestamptz not null default now(),
  note text,
  status public.export_status not null default 'requested',
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text,
  completed_at timestamptz,
  file_count int,
  missing_count int
);
-- At most one open request (requested or approved) at a time.
create unique index one_open_export on public.export_requests ((true))
  where status in ('requested', 'approved');

alter table public.export_requests enable row level security;
revoke all on public.export_requests from anon, authenticated;
create policy export_requests_select on public.export_requests for select to authenticated
  using (public.has_role('system_admin') or public.has_role('project_head'));
grant select on public.export_requests to authenticated;

create function public.request_export(p_note text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare rid uuid;
begin
  if not public.has_role('system_admin') then perform public.deny(); end if;
  if exists (select 1 from public.export_requests where status in ('requested', 'approved')) then
    raise exception 'An export request is already open.';
  end if;
  insert into public.export_requests (requested_by, note) values (auth.uid(), p_note) returning id into rid;
  perform public.log_activity(auth.uid(), 'export_requested', 'export', rid::text, null, null, null, null);
  return rid;
end;
$$;

create function public.decide_export(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.export_requests;
begin
  if not public.has_role('project_head') then perform public.deny(); end if;
  select * into r from public.export_requests where id = p_id for update;
  if not found then perform public.deny(); end if;
  if r.status <> 'requested' then raise exception 'This request has already been decided.'; end if;
  if r.requested_by = auth.uid() then raise exception 'You cannot approve your own request.'; end if;
  update public.export_requests set
    status = case when p_approve then 'approved'::public.export_status else 'rejected'::public.export_status end,
    decided_by = auth.uid(), decided_at = now(), decision_note = p_note
    where id = p_id;
  perform public.log_activity(auth.uid(), case when p_approve then 'export_approved' else 'export_rejected' end,
    'export', p_id::text, jsonb_build_object('status', r.status),
    jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end), null, null);
end;
$$;

-- Called by the export route when the files have been gathered. Single use: an approved request
-- becomes completed, so each approval allows exactly one export.
create function public.record_export_run(p_id uuid, p_files int, p_missing int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.export_requests;
begin
  if not public.has_role('system_admin') then perform public.deny(); end if;
  select * into r from public.export_requests where id = p_id for update;
  if not found then perform public.deny(); end if;
  if r.status <> 'approved' then raise exception 'The Project Head must approve this export first.'; end if;
  update public.export_requests set status = 'completed', completed_at = now(),
    file_count = p_files, missing_count = p_missing where id = p_id;
  perform public.log_activity(auth.uid(), 'export_completed', 'export', p_id::text, null,
    jsonb_build_object('files', p_files, 'missing', p_missing), null, null);
end;
$$;

-- Marks the project archived after a completed export. Records the retention date; never deletes.
create function public.archive_project(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.export_requests; info jsonb;
begin
  if not public.has_role('system_admin') then perform public.deny(); end if;
  select * into r from public.export_requests where id = p_id;
  if not found then perform public.deny(); end if;
  if r.status <> 'completed' then raise exception 'Complete and verify an export before archiving.'; end if;
  if exists (select 1 from public.project_settings where setting_key = 'archive') then
    raise exception 'The project is already archived.';
  end if;
  info := jsonb_build_object('archived_at', now(), 'export_request_id', p_id,
    'retention_until', now() + interval '1 year', 'note', p_note);
  insert into public.project_settings (setting_key, setting_value, updated_by)
    values ('archive', info, auth.uid());
  perform public.log_activity(auth.uid(), 'project_archived', 'project_settings', 'archive', null, info, null, null);
end;
$$;

revoke execute on all functions in schema public from public, anon;
revoke execute on function
  public.profiles_for(uuid, public.assignment_type[]), public.profiles_with_role(text),
  public.notify(uuid[], uuid, text, uuid, uuid, uuid, text), public.notify_from_activity(),
  public.drop_notifications_on_unassign()
  from authenticated;
grant execute on function
  public.request_export(text), public.decide_export(uuid, boolean, text),
  public.record_export_run(uuid, int, int), public.archive_project(uuid, text)
to authenticated;
