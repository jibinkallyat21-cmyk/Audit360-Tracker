import Link from "next/link";
import { EmptyState, PageHero } from "@/components/ui";
import { listSubprocesses } from "@/lib/data";
import { resolveNames } from "@/lib/records";
import { getPersona } from "@/lib/demo";
import { demoDocuments } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";
import { DOCUMENTS_SELECT } from "@/lib/queries";
import type { DocumentRec } from "@/lib/records";

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
    const { data } = await (
      await createClient()
    )
      .from("documents")
      .select(DOCUMENTS_SELECT)
      .order("created_at", { ascending: false })
      .returns<DocumentRec[]>();
    docs = data ?? [];
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
