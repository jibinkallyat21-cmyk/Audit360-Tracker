-- Site-wide switches an administrator can change from the website.
-- Today: maintenance mode. The table is readable only by the server (service role); clients
-- change it through admin_set_maintenance, which only a System Administrator may call.

create table public.site_settings (
  id int primary key check (id = 1),
  maintenance_on boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
-- No row means "off"; the first switch creates it (keeps restore-into-a-fresh-database clean).

alter table public.site_settings enable row level security;
revoke all on table public.site_settings from anon, authenticated;

create function public.admin_set_maintenance(p_on boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare before boolean;
begin
  if not public.has_role('system_admin') then perform public.deny(); end if;
  select maintenance_on into before from public.site_settings where id = 1 for update;
  insert into public.site_settings (id, maintenance_on, updated_at, updated_by)
    values (1, p_on, now(), auth.uid())
  on conflict (id) do update
    set maintenance_on = excluded.maintenance_on, updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;
  perform public.log_activity(auth.uid(),
    case when p_on then 'maintenance_on' else 'maintenance_off' end,
    'site_settings', '1', jsonb_build_object('maintenance_on', coalesce(before, false)),
    jsonb_build_object('maintenance_on', p_on), null, null);
end;
$$;

-- Administrators read the current state (and who changed it) through this function.
create function public.get_maintenance() returns table (maintenance_on boolean, updated_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.maintenance_on, s.updated_at from public.site_settings s
  where s.id = 1 and public.has_role('system_admin')
$$;

revoke execute on function public.admin_set_maintenance(boolean), public.get_maintenance() from public, anon;
grant execute on function public.admin_set_maintenance(boolean), public.get_maintenance() to authenticated;
