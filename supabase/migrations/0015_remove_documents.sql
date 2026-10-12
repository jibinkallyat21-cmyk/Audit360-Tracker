-- Removing uploaded documents. A removed document is hidden from everyone except the System
-- Administrator (who can restore it); the file and its history are kept for the record, so
-- nothing is lost by a mistaken click and the audit trail stays complete.
--
-- Who may remove: the person who uploaded it, the process's Production Lead, or the System
-- Administrator. Everyone but the administrator is blocked once the file is evidence under
-- review: a line that is in review or approved, or a step (without lines) in Review or Production.

alter table public.documents
  add column removed_at timestamptz,
  add column removed_by uuid references public.profiles (id) on delete set null;

drop policy documents_select on public.documents;
create policy documents_select on public.documents for select to authenticated
  using ((public.can_view_subprocess_records(subprocess_id) and removed_at is null)
         or public.has_role('system_admin'));

drop policy document_versions_select on public.document_versions;
create policy document_versions_select on public.document_versions for select to authenticated
  using (exists (select 1 from public.documents d
                 where d.id = document_id
                   and ((public.can_view_subprocess_records(d.subprocess_id) and d.removed_at is null)
                        or public.has_role('system_admin'))));

create function public.remove_document(p_document uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.documents; s public.subprocesses; l public.subprocess_lines; admin boolean;
begin
  if not public.is_approved_user() then perform public.deny(); end if;
  select * into d from public.documents where id = p_document for update;
  if not found then perform public.deny(); end if;
  select * into s from public.subprocesses where id = d.subprocess_id;
  admin := public.has_role('system_admin');
  if not (admin
          or (d.uploaded_by = auth.uid() and public.has_assignment(s.process_id))
          or public.has_assignment(s.process_id, array['production_lead']::public.assignment_type[])) then
    perform public.deny();
  end if;
  if d.removed_at is not null then raise exception 'This document is already removed.'; end if;
  if not admin then
    if d.line_id is not null then
      select * into l from public.subprocess_lines where id = d.line_id;
      if l.status in ('in_review', 'approved') then
        raise exception 'Files of a line that is in review or approved cannot be removed.';
      end if;
    elsif not public.has_lines(s.id) and s.current_stage in ('review', 'production') then
      raise exception 'Files cannot be removed once the step is in Review or Production.';
    end if;
  end if;
  update public.documents set removed_at = now(), removed_by = auth.uid() where id = p_document;
  perform public.log_activity(auth.uid(), 'document_removed', 'document', p_document::text,
    null, jsonb_build_object('filename', d.original_filename), s.process_id, s.id,
    jsonb_build_object('reason', nullif(btrim(coalesce(p_reason, '')), '')));
end;
$$;

create function public.restore_document(p_document uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.documents; s public.subprocesses;
begin
  if not public.has_role('system_admin') then perform public.deny(); end if;
  select * into d from public.documents where id = p_document for update;
  if not found then perform public.deny(); end if;
  if d.removed_at is null then raise exception 'This document is not removed.'; end if;
  select * into s from public.subprocesses where id = d.subprocess_id;
  update public.documents set removed_at = null, removed_by = null where id = p_document;
  perform public.log_activity(auth.uid(), 'document_restored', 'document', p_document::text,
    null, jsonb_build_object('filename', d.original_filename), s.process_id, s.id);
end;
$$;

-- No new versions on a removed document.
create function public.block_version_on_removed() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.documents where id = new.document_id and removed_at is not null) then
    raise exception 'This document was removed. Upload the file as a new document.';
  end if;
  return new;
end;
$$;
create trigger document_versions_not_on_removed before insert on public.document_versions
  for each row execute function public.block_version_on_removed();

-- A removed file does not count as the evidence a line needs to go to review.
create or replace function public.line_send_to_review(p_line uuid, p_tested boolean, p_note text default null)
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
  select d.id into evidence from public.documents d where d.line_id = p_line and d.removed_at is null
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

revoke execute on all functions in schema public from public, anon;
revoke execute on function public.block_version_on_removed() from authenticated;
grant execute on function public.remove_document(uuid, text), public.restore_document(uuid) to authenticated;
