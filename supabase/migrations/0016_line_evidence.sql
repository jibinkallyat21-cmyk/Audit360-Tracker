-- Evidence per line. One file can support several lines (for example a workbook with an EOSB tab
-- and a GOSI tab): when a line is sent to review the lead chooses which of the step's files are
-- its evidence, whichever line they were filed under. The reviewer sees exactly those files, and
-- a new version of one of them sends an approved line back to review.

create table public.line_evidence (
  line_id uuid not null references public.subprocess_lines (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (line_id, document_id)
);
create index line_evidence_document_idx on public.line_evidence (document_id);
alter table public.line_evidence enable row level security;
revoke all on table public.line_evidence from anon, authenticated;
create policy line_evidence_select on public.line_evidence for select to authenticated using (
  exists (select 1 from public.subprocess_lines l
          where l.id = line_id
            and (public.can_view_subprocess_records(l.subprocess_id) or public.has_role('system_admin'))));
grant select on public.line_evidence to authenticated;

-- Lines already sent under the old rule keep the files filed under them as their evidence.
insert into public.line_evidence (line_id, document_id)
  select l.id, d.id from public.subprocess_lines l
  join public.documents d on d.line_id = l.id and d.removed_at is null
  where l.status in ('in_review', 'approved');

drop function public.line_send_to_review(uuid, boolean, text);
create function public.line_send_to_review(
  p_line uuid, p_tested boolean, p_note text default null, p_documents uuid[] default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.subprocess_lines; s public.subprocesses; evidence uuid[];
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
  if p_documents is null or cardinality(p_documents) = 0 then
    evidence := array(select d.id from public.documents d
                      where d.line_id = p_line and d.removed_at is null order by d.created_at);
  else
    evidence := p_documents;
    if exists (select 1 from unnest(evidence) e(id)
               where not exists (select 1 from public.documents d
                                 where d.id = e.id and d.subprocess_id = s.id and d.removed_at is null)) then
      raise exception 'Choose files that belong to this step.';
    end if;
  end if;
  if cardinality(evidence) = 0 then
    raise exception 'Upload at least one file for this step, then choose it as evidence for this line.';
  end if;
  delete from public.line_evidence where line_id = p_line;
  insert into public.line_evidence (line_id, document_id)
    select p_line, e from unnest(evidence) e on conflict do nothing;
  insert into public.testing_records (subprocess_id, submitted_by, result, notes, evidence_document_id, line_id)
    values (s.id, auth.uid(), 'pass', nullif(btrim(coalesce(p_note, '')), ''), evidence[1], p_line);
  if p_note is not null and length(btrim(p_note)) > 0 then
    insert into public.comments (subprocess_id, line_id, author_id, comment_text)
      values (s.id, p_line, auth.uid(), btrim(p_note));
  end if;
  update public.subprocess_lines set status = 'in_review', updated_at = now(), updated_by = auth.uid()
    where id = p_line;
  perform public.log_activity(auth.uid(), 'line_sent_to_review', 'line', p_line::text,
    jsonb_build_object('status', l.status), jsonb_build_object('status', 'in_review'), s.process_id, s.id,
    jsonb_build_object('title', l.title, 'files', cardinality(evidence)));
  perform public.line_rollup(s.id, auth.uid());
end;
$$;

create or replace function public.register_document_version(
  p_sub uuid, p_rp uuid, p_document uuid, p_filename text, p_storage_path text,
  p_size int, p_mime text, p_note text default null, p_line uuid default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.subprocesses; doc uuid := p_document; ver int; vid uuid; dline uuid; lstatus public.line_status; lid uuid; reopened boolean := false;
begin
  if not public.is_approved_user() then perform public.deny(); end if;
  select * into s from public.subprocesses where id = p_sub for update;
  if not found or not public.has_assignment(s.process_id) then perform public.deny(); end if;
  if p_rp is not null and not exists (select 1 from public.review_points where id = p_rp and subprocess_id = p_sub) then
    raise exception 'Review point does not belong to this item.';
  end if;
  if doc is null then
    if p_line is not null and not exists (
        select 1 from public.subprocess_lines where id = p_line and subprocess_id = p_sub) then
      raise exception 'That line does not belong to this step.';
    end if;
    insert into public.documents (subprocess_id, review_point_id, original_filename, uploaded_by, line_id)
      values (p_sub, p_rp, p_filename, auth.uid(), p_line) returning id, line_id into doc, dline;
  else
    select line_id into dline from public.documents where id = doc and subprocess_id = p_sub;
    if not found then perform public.deny(); end if;
  end if;
  select coalesce(max(version_number), 0) + 1 into ver from public.document_versions where document_id = doc;
  update public.document_versions set is_current = false where document_id = doc and is_current;
  insert into public.document_versions
    (document_id, version_number, original_filename, storage_path, file_size, mime_type, version_note, uploaded_by)
    values (doc, ver, p_filename, p_storage_path, p_size, p_mime, p_note, auth.uid()) returning id into vid;
  -- New evidence after an approval forces the reviewer to approve again.
  if s.review_decision = 'approved' and s.current_stage <> 'production' then
    update public.subprocesses set evidence_changed_at = now() where id = p_sub;
  end if;
  -- New evidence on a file that an approved line relies on (filed under it, or chosen as its
  -- evidence) sends that line back to review.
  if s.current_stage <> 'production' then
    for lid in
      select x from (select dline as x
                     union select le.line_id from public.line_evidence le where le.document_id = doc) q
      where x is not null
    loop
      select status into lstatus from public.subprocess_lines where id = lid for update;
      if lstatus = 'approved' then
        update public.subprocess_lines set status = 'in_review', updated_at = now(), updated_by = auth.uid()
          where id = lid;
        perform public.log_activity(auth.uid(), 'line_reopened', 'line', lid::text,
          jsonb_build_object('status', 'approved'), jsonb_build_object('status', 'in_review'),
          s.process_id, p_sub,
          jsonb_build_object('title', (select title from public.subprocess_lines where id = lid)));
        reopened := true;
      end if;
    end loop;
    if reopened then perform public.line_rollup(p_sub, auth.uid()); end if;
  end if;
  perform public.log_activity(auth.uid(), case when ver = 1 then 'document_uploaded' else 'document_replaced' end,
    'document', doc::text, null, jsonb_build_object('version', ver, 'filename', p_filename),
    s.process_id, p_sub);
  return vid;
end;
$$;

create or replace function public.remove_document(p_document uuid, p_reason text default null) returns void
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
    if exists (select 1 from public.line_evidence le join public.subprocess_lines l2 on l2.id = le.line_id
               where le.document_id = p_document and l2.status in ('in_review', 'approved')) then
      raise exception 'This file is the evidence for a line that is in review or approved, so it cannot be removed.';
    end if;
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

revoke execute on all functions in schema public from public, anon;
grant execute on function public.line_send_to_review(uuid, boolean, text, uuid[]) to authenticated;
