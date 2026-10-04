-- Phase 2 schema: org structure, process hierarchy, workflow records, audit log.
-- Stage/status live on subprocesses; process progress is rolled up from them.

create type public.workflow_stage as enum
  ('process_definition', 'solution_building', 'testing', 'review', 'production');
create type public.workflow_status as enum
  ('not_started', 'in_progress', 'blocked', 'changes_required', 'completed');
create type public.review_decision as enum ('pending_review', 'changes_required', 'approved');
create type public.dashboard_status as enum
  ('not_started', 'under_construction', 'under_review', 'changes_required', 'live_deployed', 'completed');
create type public.assignment_type as enum
  ('production_lead', 'team_member', 'reviewer', 'supporting_role');
create type public.review_point_status as enum
  ('open', 'in_progress', 'submitted_for_closure', 'changes_required', 'closed');
create type public.test_result as enum ('pass', 'fail');
create type public.approval_type as enum ('review_decision', 'review_point_closure', 'production_entry');

-- A person can be linked to at most one account.
create unique index profiles_person_unique on public.profiles (person_id) where person_id is not null;

-- Global (non process-scoped) roles. Scoped roles come from process_assignments.
create table public.roles (
  id smallint generated always as identity primary key,
  name text not null unique,
  description text
);
create table public.person_roles (
  person_id uuid not null references public.people (id) on delete cascade,
  role_id smallint not null references public.roles (id),
  primary key (person_id, role_id)
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  production_lead_person_id uuid not null references public.people (id)
);
create table public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  person_id uuid not null references public.people (id),
  primary key (team_id, person_id)
);

create table public.phases (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  display_order int not null unique
);

create table public.processes (
  id uuid primary key default gen_random_uuid(),
  process_code text not null unique,
  title text not null,
  description text,
  phase_id uuid not null references public.phases (id),
  source_reference text,
  -- Read-only requirement context from the workbook (Before/After AI text). Never a status.
  context jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subprocesses (
  id uuid primary key default gen_random_uuid(),
  process_id uuid not null references public.processes (id) on delete cascade,
  seq int not null,
  title text not null,
  current_stage public.workflow_stage not null default 'process_definition',
  current_status public.workflow_status not null default 'not_started',
  review_decision public.review_decision,
  dashboard_status public.dashboard_status,
  stage_entered_at timestamptz not null default now(),
  evidence_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  unique (process_id, seq),
  -- Dashboard status exists only once an item has reached Production.
  check ((dashboard_status is null) = (current_stage <> 'production'))
);

create table public.process_assignments (
  id uuid primary key default gen_random_uuid(),
  process_id uuid not null references public.processes (id) on delete cascade,
  person_id uuid not null references public.people (id),
  assignment_type public.assignment_type not null,
  assigned_by uuid references public.profiles (id),
  assigned_at timestamptz not null default now(),
  unique (process_id, person_id, assignment_type)
);
create unique index one_production_lead_per_process
  on public.process_assignments (process_id) where assignment_type = 'production_lead';

create table public.testing_records (
  id uuid primary key default gen_random_uuid(),
  subprocess_id uuid not null references public.subprocesses (id) on delete cascade,
  submitted_by uuid not null references public.profiles (id),
  result public.test_result not null,
  notes text,
  evidence_document_id uuid,
  created_at timestamptz not null default now()
);

create table public.review_points (
  id uuid primary key default gen_random_uuid(),
  subprocess_id uuid not null references public.subprocesses (id) on delete cascade,
  raised_by uuid not null references public.profiles (id),
  assigned_to_person_id uuid not null references public.people (id),
  description text not null check (length(btrim(description)) > 0),
  status public.review_point_status not null default 'open',
  resolution_note text,
  submitted_at timestamptz,
  closed_by uuid references public.profiles (id),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'closed') = (closed_by is not null and closed_at is not null))
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  subprocess_id uuid not null references public.subprocesses (id) on delete cascade,
  review_point_id uuid references public.review_points (id),
  parent_comment_id uuid references public.comments (id),
  author_id uuid not null references public.profiles (id),
  comment_text text not null check (length(btrim(comment_text)) > 0),
  created_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  subprocess_id uuid not null references public.subprocesses (id) on delete cascade,
  review_point_id uuid references public.review_points (id),
  original_filename text not null,
  uploaded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  version_number int not null,
  original_filename text not null,
  storage_path text not null unique,
  file_size int not null check (file_size > 0 and file_size <= 2097152),
  mime_type text not null check (mime_type in (
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
  version_note text,
  uploaded_by uuid not null references public.profiles (id),
  uploaded_at timestamptz not null default now(),
  is_current boolean not null default true,
  unique (document_id, version_number),
  check (lower(original_filename) ~ '\.(doc|docx|xls|xlsx)$')
);
create unique index one_current_version on public.document_versions (document_id) where is_current;

alter table public.testing_records
  add constraint testing_evidence_fk foreign key (evidence_document_id) references public.documents (id);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  subprocess_id uuid not null references public.subprocesses (id) on delete cascade,
  review_point_id uuid references public.review_points (id),
  approval_type public.approval_type not null,
  decision text not null,
  decided_by uuid not null references public.profiles (id),
  decision_note text,
  decided_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.profiles (id) on delete cascade,
  event_type text not null,
  subprocess_id uuid references public.subprocesses (id) on delete cascade,
  review_point_id uuid references public.review_points (id) on delete cascade,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table public.activity_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id),
  action_type text not null,
  entity_type text not null,
  entity_id text,
  previous_value jsonb,
  new_value jsonb,
  process_id uuid,
  subprocess_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_logs_process_idx on public.activity_logs (process_id, created_at desc);

-- Append-only: block rewrites for everyone, including privileged application roles.
-- Statement-level so the guard holds even when a statement matches no rows.
create function public.block_history_changes() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end;
$$;
create trigger activity_logs_append_only before update or delete or truncate on public.activity_logs
  for each statement execute function public.block_history_changes();
-- Comments and approvals are history too: no rewrites.
create trigger comments_append_only before update or delete or truncate on public.comments
  for each statement execute function public.block_history_changes();
create trigger approvals_append_only before update or delete or truncate on public.approvals
  for each statement execute function public.block_history_changes();

create table public.project_settings (
  setting_key text primary key,
  setting_value jsonb not null,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

create index subprocesses_process_idx on public.subprocesses (process_id);
create index assignments_person_idx on public.process_assignments (person_id);
