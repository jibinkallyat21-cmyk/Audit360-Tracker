-- Row Level Security and grants. Clients can only SELECT; every write goes through a function.
-- NOTE: Supabase grants new tables to anon/authenticated by default. Any later migration that
-- adds a table or function must repeat the revoke/grant pattern below.

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;

-- Functions clients may call (helpers are needed by policies; the rest are the write API).
grant execute on function
  public.current_person_id(), public.is_approved_user(), public.has_role(text),
  public.has_assignment(uuid, public.assignment_type[]), public.can_view_records(uuid),
  public.can_see_process(uuid), public.can_see_subprocess(uuid),
  public.can_view_subprocess_records(uuid), public.is_conflicted_reviewer(uuid),
  public.set_status(uuid, public.workflow_status), public.complete_stage(uuid),
  public.record_testing(uuid, public.test_result, text, uuid),
  public.raise_review_point(uuid, text, uuid),
  public.record_review_decision(uuid, public.review_decision, text),
  public.update_review_point(uuid, text, text),
  public.add_comment(uuid, text, uuid, uuid),
  public.register_document_version(uuid, uuid, uuid, text, text, int, text, text),
  public.set_deadline(timestamptz), public.set_dashboard_status(uuid, public.dashboard_status),
  public.admin_approve_user(uuid, uuid), public.admin_reject_user(uuid),
  public.admin_set_user_active(uuid, boolean),
  public.admin_set_assignment(uuid, uuid, public.assignment_type, boolean),
  public.admin_set_person_role(uuid, text, boolean)
to authenticated;

-- Org structure is visible to every approved user (it is the team chart).
create policy people_select on public.people for select to authenticated using (public.is_approved_user());
create policy roles_select on public.roles for select to authenticated using (public.is_approved_user());
create policy person_roles_select on public.person_roles for select to authenticated using (public.is_approved_user());
create policy teams_select on public.teams for select to authenticated using (public.is_approved_user());
create policy team_members_select on public.team_members for select to authenticated using (public.is_approved_user());
create policy phases_select on public.phases for select to authenticated using (public.is_approved_user());
create policy settings_select on public.project_settings for select to authenticated using (public.is_approved_user());

create policy profiles_select_admin on public.profiles for select to authenticated
  using (public.has_role('system_admin'));

-- Structure: title/stage/status. Records tables below are stricter.
create policy processes_select on public.processes for select to authenticated
  using (public.can_see_process(id));
create policy subprocesses_select on public.subprocesses for select to authenticated
  using (public.can_see_subprocess(id));
create policy assignments_select on public.process_assignments for select to authenticated
  using (public.can_see_process(process_id));

-- Records: assigned people and the Project Lead only. Management, admin and Dashboard Lead excluded.
create policy testing_select on public.testing_records for select to authenticated
  using (public.can_view_subprocess_records(subprocess_id));
create policy review_points_select on public.review_points for select to authenticated
  using (public.can_view_subprocess_records(subprocess_id));
create policy comments_select on public.comments for select to authenticated
  using (public.can_view_subprocess_records(subprocess_id));
create policy documents_select on public.documents for select to authenticated
  using (public.can_view_subprocess_records(subprocess_id));
create policy document_versions_select on public.document_versions for select to authenticated
  using (exists (select 1 from public.documents d
                 where d.id = document_id and public.can_view_subprocess_records(d.subprocess_id)));
create policy approvals_select on public.approvals for select to authenticated
  using (public.can_view_subprocess_records(subprocess_id));

create policy notifications_select on public.notifications for select to authenticated
  using (recipient_user_id = auth.uid() and public.is_approved_user());

-- History: process events follow record access; system events go to admin and Dashboard Lead.
create policy activity_select on public.activity_logs for select to authenticated using (
  case when process_id is not null then public.can_view_records(process_id)
       else public.has_role('system_admin') or public.has_role('dashboard_lead') end);

grant select on
  public.people, public.roles, public.person_roles, public.teams, public.team_members, public.phases,
  public.project_settings, public.processes, public.subprocesses, public.process_assignments,
  public.testing_records, public.review_points, public.comments, public.documents,
  public.document_versions, public.approvals, public.notifications, public.activity_logs
to authenticated;
-- profiles: own row for everyone, all rows for administrators (policies above and in 0001).
grant select on public.profiles to authenticated;
