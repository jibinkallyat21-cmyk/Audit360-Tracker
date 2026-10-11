import Link from "next/link";
import { EmptyState, PageHero } from "@/components/ui";
import { listSubprocesses } from "@/lib/data";
import { resolveNames } from "@/lib/records";
import { getPersona } from "@/lib/demo";
import { demoDocuments } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";
import { DOCUMENTS_SELECT, withoutLineId } from "@/lib/queries";
import type { DocumentRec } from "@/lib/records";

/** A file download, not a page, so it is a plain link. */
const ZIP_URL = "/api/documents/zip";

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(iso)) + " UTC";

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const q = ((await searchParams).q ?? "").trim().toLowerCase().slice(0, 80);
  const rows = await listSubprocesses();
  const persona = await getPersona();
  let docs: DocumentRec[];
  if (persona) {
    docs = demoDocuments(persona);
  } else {
    const supabase = await createClient();
    const load = (select: string) =>
      supabase
        .from("documents")
        .select(select)
        .order("created_at", { ascending: false })
        .returns<DocumentRec[]>();
    let res = await load(DOCUMENTS_SELECT);
    // Database without the lines migration yet: the same list without the line column.
    if (res.error) res = await load(withoutLineId(DOCUMENTS_SELECT));
    if (res.error) throw new Error("Could not load documents.");
    docs = res.data ?? [];
  }
  const names = await resolveNames(
    docs.flatMap((d) => d.document_versions.map((v) => v.uploaded_by)),
  );
  const where = new Map(rows.map((r) => [r.id, r]));
  const shown = docs.filter((d) => {
    const r = where.get(d.subprocess_id);
    return (
      !q ||
      `${d.original_filename} ${r?.processCode ?? ""} ${r?.processTitle ?? ""}`
        .toLowerCase()
        .includes(q)
    );
  });

  return (
    <main className="stack-lg">
      <PageHero eyebrow="Documents" title="Document centre">
        Word and Excel files for the processes you can access. Older versions stay available and are
        labelled Superseded.
      </PageHero>
      <form method="get" className="filters" role="search">
        <label>
          <span>Search</span>
          <input type="search" name="q" defaultValue={q} placeholder="File name or process" />
        </label>
        <button type="submit">Search</button>
      </form>
      {docs.length > 0 && (
        <p>
          <a href={ZIP_URL} className="button">
            Download all current files (ZIP)
          </a>{" "}
          <span className="muted">
            {docs.length} {docs.length === 1 ? "document" : "documents"}, grouped by process and
            step, with a manifest.
          </span>
        </p>
      )}
      {shown.length === 0 && <EmptyState>No documents found.</EmptyState>}
      <ul className="list">
        {shown.map((d) => {
          const r = where.get(d.subprocess_id);
          return (
            <li key={d.id} className="panel">
              <h2>{d.original_filename}</h2>
              {r && (
                <p className="muted">
                  <Link href={`/processes/${r.processCode}`}>
                    {r.processCode} {r.processTitle}
                  </Link>{" "}
                  · step {r.seq}
                </p>
              )}
              <ul className="versions">
                {[...d.document_versions]
                  .sort((a, b) => b.version_number - a.version_number)
                  .map((v) => (
                    <li key={v.id}>
                      <a href={`/api/documents/${v.id}`}>Version {v.version_number}</a>{" "}
                      <span className={v.is_current ? "badge current" : "badge superseded"}>
                        {v.is_current ? "Current" : "Superseded"}
                      </span>{" "}
                      <span className="muted">
                        {names.get(v.uploaded_by) ?? "A team member"} · {when(v.uploaded_at)}
                        {v.version_note ? ` · ${v.version_note}` : ""}
                      </span>
                    </li>
                  ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
