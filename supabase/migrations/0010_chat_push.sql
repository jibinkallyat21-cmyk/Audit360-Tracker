-- Chat (everyone, one person, or the people of one process) and desktop push notifications.
--
-- Who may read a conversation is decided here, in the database:
--   common   every approved, active user
--   direct   only the two people in it (nobody else, not even the administrator)
--   process  only the people assigned to that process
-- Clients can only read; every write goes through the functions below.

create type public.conversation_kind as enum ('common', 'direct', 'process');

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind public.conversation_kind not null,
  process_id uuid references public.processes (id) on delete cascade,
  user_a uuid references public.profiles (id) on delete cascade,
  user_b uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint conversation_shape check (
    (kind = 'common' and process_id is null and user_a is null and user_b is null)
    or (kind = 'process' and process_id is not null and user_a is null and user_b is null)
    or (kind = 'direct' and process_id is null and user_a is not null and user_b is not null
        and user_a < user_b))
);
create unique index conversations_one_common on public.conversations (kind) where kind = 'common';
create unique index conversations_one_per_process on public.conversations (process_id) where kind = 'process';
create unique index conversations_one_per_pair on public.conversations (user_a, user_b) where kind = 'direct';

create table public.chat_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index chat_messages_conversation_idx on public.chat_messages (conversation_id, id);

create table public.chat_reads (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_id bigint not null default 0,
  primary key (conversation_id, user_id)
);

-- Desktop push. Both tables are reachable only by the server (service role) and the functions below.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

create table public.push_keys (
  id int primary key check (id = 1),
  public_key text not null,
  private_key text not null,
  created_at timestamptz not null default now()
);

-- Workflow notifications are pushed once; this marks the ones already sent.
alter table public.notifications add column pushed_at timestamptz;
update public.notifications set pushed_at = now() where pushed_at is null;

alter table public.conversations enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_reads enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_keys enable row level security;

-- Supabase hands new tables to the client roles by default; take that back.
revoke all on table public.conversations, public.chat_messages, public.chat_reads,
  public.push_subscriptions, public.push_keys from anon, authenticated;

create function public.can_access_conversation(p_conv uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_approved_user() and exists (
    select 1 from public.conversations c
    where c.id = p_conv and (
      c.kind = 'common'
      or (c.kind = 'direct' and auth.uid() in (c.user_a, c.user_b))
      or (c.kind = 'process' and public.has_assignment(c.process_id))))
$$;

create policy conversations_select on public.conversations for select to authenticated
  using (public.can_access_conversation(id));
create policy chat_messages_select on public.chat_messages for select to authenticated
  using (public.can_access_conversation(conversation_id));
create policy chat_reads_select on public.chat_reads for select to authenticated
  using (user_id = auth.uid());
grant select on public.conversations, public.chat_messages, public.chat_reads to authenticated;

-- ---------- functions clients may call ----------

-- People you can message: names only, never emails.
create function public.chat_people() returns table (profile_id uuid, display_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select pr.id, pe.display_name
  from public.profiles pr join public.people pe on pe.id = pr.person_id
  where public.is_approved_user() and pr.approval_state = 'approved' and pr.is_active
    and pr.id <> auth.uid()
  order by pe.display_name
$$;

-- Makes sure the everyone-chat and the group chat of every process you are assigned to exist.
create function public.chat_ensure_groups() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_approved_user() then perform public.deny(); end if;
  insert into public.conversations (kind) values ('common') on conflict do nothing;
  insert into public.conversations (kind, process_id)
    select 'process', pa.process_id
    from public.process_assignments pa
    where pa.person_id = public.current_person_id()
    group by pa.process_id
  on conflict do nothing;
end;
$$;

create function public.chat_open_direct(p_other uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare a uuid; b uuid; cid uuid;
begin
  if not public.is_approved_user() then perform public.deny(); end if;
  if p_other is null or p_other = auth.uid() then raise exception 'Choose someone else.'; end if;
  if not exists (select 1 from public.profiles
      where id = p_other and approval_state = 'approved' and is_active) then
    raise exception 'That person is not available.';
  end if;
  a := least(auth.uid(), p_other);
  b := greatest(auth.uid(), p_other);
  insert into public.conversations (kind, user_a, user_b) values ('direct', a, b) on conflict do nothing;
  select id into cid from public.conversations where kind = 'direct' and user_a = a and user_b = b;
  return cid;
end;
$$;

create function public.chat_send(p_conv uuid, p_body text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare mid bigint;
begin
  if not public.can_access_conversation(p_conv) then perform public.deny(); end if;
  if p_body is null or char_length(btrim(p_body)) = 0 then raise exception 'Write a message.'; end if;
  insert into public.chat_messages (conversation_id, sender_id, body)
    values (p_conv, auth.uid(), btrim(p_body)) returning id into mid;
  insert into public.chat_reads (conversation_id, user_id, last_read_id) values (p_conv, auth.uid(), mid)
    on conflict (conversation_id, user_id) do update set last_read_id = excluded.last_read_id;
  return mid;
end;
$$;

create function public.chat_mark_read(p_conv uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare latest bigint;
begin
  if not public.can_access_conversation(p_conv) then perform public.deny(); end if;
  select coalesce(max(id), 0) into latest from public.chat_messages where conversation_id = p_conv;
  insert into public.chat_reads (conversation_id, user_id, last_read_id) values (p_conv, auth.uid(), latest)
    on conflict (conversation_id, user_id)
    do update set last_read_id = greatest(public.chat_reads.last_read_id, excluded.last_read_id);
end;
$$;

-- Your conversations with the latest message and the unread count.
create function public.chat_overview() returns table (
  conversation_id uuid, kind public.conversation_kind, process_code text, process_title text,
  other_user uuid, other_name text, last_body text, last_at timestamptz, last_sender uuid,
  unread bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id, c.kind, p.process_code, p.title,
         o.other_id, o.other_name,
         lm.body, lm.created_at, lm.sender_id,
         (select count(*) from public.chat_messages m
           where m.conversation_id = c.id
             and m.id > coalesce((select r.last_read_id from public.chat_reads r
                                  where r.conversation_id = c.id and r.user_id = auth.uid()), 0)
             and m.sender_id is distinct from auth.uid())
  from public.conversations c
  left join public.processes p on p.id = c.process_id
  left join lateral (
    select pr.id as other_id, pe.display_name as other_name
    from public.profiles pr left join public.people pe on pe.id = pr.person_id
    where c.kind = 'direct'
      and pr.id = case when c.user_a = auth.uid() then c.user_b else c.user_a end) o on true
  left join lateral (
    select m.body, m.created_at, m.sender_id from public.chat_messages m
    where m.conversation_id = c.id order by m.id desc limit 1) lm on true
  where public.can_access_conversation(c.id)
$$;

create function public.chat_unread_total() returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(unread), 0)::bigint from public.chat_overview()
$$;

create function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_approved_user() then perform public.deny(); end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 2000 then
    raise exception 'Invalid subscription.';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
    values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth;
end;
$$;

create function public.push_unsubscribe(p_endpoint text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end;
$$;

revoke execute on function
  public.can_access_conversation(uuid), public.chat_people(), public.chat_ensure_groups(),
  public.chat_open_direct(uuid), public.chat_send(uuid, text), public.chat_mark_read(uuid),
  public.chat_overview(), public.chat_unread_total(),
  public.push_subscribe(text, text, text), public.push_unsubscribe(text)
  from public, anon;
grant execute on function
  public.can_access_conversation(uuid), public.chat_people(), public.chat_ensure_groups(),
  public.chat_open_direct(uuid), public.chat_send(uuid, text), public.chat_mark_read(uuid),
  public.chat_overview(), public.chat_unread_total(),
  public.push_subscribe(text, text, text), public.push_unsubscribe(text)
  to authenticated;
