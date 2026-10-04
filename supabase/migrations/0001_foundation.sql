-- Foundation: seeded people, account profiles and the approval gate.
-- Full role/assignment/workflow schema follows in Phase 2.

create type public.approval_state as enum ('pending', 'approved', 'rejected', 'deactivated');

create table public.people (
  id uuid primary key default gen_random_uuid(),
  display_name text not null unique,
  first_name text not null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  person_id uuid references public.people (id),
  approval_state public.approval_state not null default 'pending',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.people enable row level security;
alter table public.profiles enable row level security;

-- People: no policy yet, so nobody reads them directly (Phase 2 adds scoped policies).
-- Profiles: a user may read only their own row.
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());

-- No client writes at all. Approval, linking and deactivation go through
-- admin-only functions added in Phase 2, so users cannot approve themselves.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
revoke all on public.people from anon, authenticated;

-- Every new auth user gets a pending profile with no access.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
