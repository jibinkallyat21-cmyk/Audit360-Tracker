-- Process group chats also include the people who oversee the work: the System Administrator,
-- the Project Lead and the Project Head (alongside the assigned people, as before). Direct
-- chats stay private to the two people in them.

create or replace function public.can_access_conversation(p_conv uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_approved_user() and exists (
    select 1 from public.conversations c
    where c.id = p_conv and (
      c.kind = 'common'
      or (c.kind = 'direct' and auth.uid() in (c.user_a, c.user_b))
      or (c.kind = 'process' and (
            public.has_assignment(c.process_id)
            or public.has_role('system_admin')
            or public.has_role('project_lead')
            or public.has_role('project_head')))))
$$;

-- Oversight roles get the group chat of every process; everyone else, of the processes they are on.
create or replace function public.chat_ensure_groups() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_approved_user() then perform public.deny(); end if;
  insert into public.conversations (kind) values ('common') on conflict do nothing;
  if public.has_role('system_admin') or public.has_role('project_lead') or public.has_role('project_head') then
    insert into public.conversations (kind, process_id)
      select 'process', p.id from public.processes p
    on conflict do nothing;
  else
    insert into public.conversations (kind, process_id)
      select 'process', pa.process_id
      from public.process_assignments pa
      where pa.person_id = public.current_person_id()
      group by pa.process_id
    on conflict do nothing;
  end if;
end;
$$;

revoke execute on function public.can_access_conversation(uuid), public.chat_ensure_groups() from public, anon;
grant execute on function public.can_access_conversation(uuid), public.chat_ensure_groups() to authenticated;
