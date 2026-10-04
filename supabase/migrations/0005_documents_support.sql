-- Private document bucket, download logging and author-name lookup.

-- Bucket is private. storage.objects keeps RLS on with no client policies, so only the
-- server (service role) can read or write files, after its own permission checks.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('documents', 'documents', false, 2097152, array[
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
    on conflict (id) do update set public = false, file_size_limit = 2097152;
  end if;
end $$;

-- Records that a user downloaded a version. Fails unless they may view its records.
create function public.log_document_download(p_version uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.document_versions; d public.documents; s public.subprocesses;
begin
  if not public.is_approved_user() then perform public.deny(); end if;
  select * into v from public.document_versions where id = p_version;
  if not found then perform public.deny(); end if;
  select * into d from public.documents where id = v.document_id;
  select * into s from public.subprocesses where id = d.subprocess_id;
  if not public.can_view_records(s.process_id) then perform public.deny(); end if;
  perform public.log_activity(auth.uid(), 'document_downloaded', 'document_version', p_version::text,
    null, jsonb_build_object('version', v.version_number, 'filename', v.original_filename),
    s.process_id, s.id);
end;
$$;

-- Display names only (never emails) for account ids seen in records. Names are not secret:
-- the team chart is visible to every approved user.
create function public.actor_names(p_ids uuid[]) returns table (profile_id uuid, display_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select pr.id, pe.display_name
  from public.profiles pr join public.people pe on pe.id = pr.person_id
  where public.is_approved_user() and pr.id = any (p_ids)
$$;

revoke execute on function public.log_document_download(uuid), public.actor_names(uuid[])
  from public, anon;
grant execute on function public.log_document_download(uuid), public.actor_names(uuid[]) to authenticated;
