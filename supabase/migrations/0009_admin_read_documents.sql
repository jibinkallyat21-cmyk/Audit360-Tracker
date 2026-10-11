-- The System Administrator may read and download documents (read-only), so the files the
-- teams upload can be collected and used. Nothing else changes for the administrator:
-- comments, review points, testing results, approvals and process history stay with the
-- assigned people and the Project Lead, and the administrator still cannot upload.
-- No new function is exposed to clients: the policies reuse the existing helpers.

drop policy documents_select on public.documents;
create policy documents_select on public.documents for select to authenticated
  using (public.can_view_subprocess_records(subprocess_id) or public.has_role('system_admin'));

drop policy document_versions_select on public.document_versions;
create policy document_versions_select on public.document_versions for select to authenticated
  using (exists (select 1 from public.documents d
                 where d.id = document_id
                   and (public.can_view_subprocess_records(d.subprocess_id)
                        or public.has_role('system_admin'))));

-- Downloads stay logged. Same function as before, with the administrator allowed.
create or replace function public.log_document_download(p_version uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.document_versions; d public.documents; s public.subprocesses;
begin
  if not public.is_approved_user() then perform public.deny(); end if;
  select * into v from public.document_versions where id = p_version;
  if not found then perform public.deny(); end if;
  select * into d from public.documents where id = v.document_id;
  select * into s from public.subprocesses where id = d.subprocess_id;
  if not (public.can_view_records(s.process_id) or public.has_role('system_admin')) then
    perform public.deny();
  end if;
  perform public.log_activity(auth.uid(), 'document_downloaded', 'document_version', p_version::text,
    null, jsonb_build_object('version', v.version_number, 'filename', v.original_filename),
    s.process_id, s.id);
end;
$$;
