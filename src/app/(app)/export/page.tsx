import { notFound } from "next/navigation";
import { ActionForm } from "@/components/client";
import { EmptyState, PageHero } from "@/components/ui";
import { getCapabilities } from "@/lib/data";
import { getPersona } from "@/lib/demo";
import { demoExportRequests } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";
import { archiveProject, decideExport, requestExport } from "./actions";

interface Req {
  id: string;
  requested_by: string;
  requested_at: string;
  note: string | null;
  status: "requested" | "approved" | "rejected" | "completed";
  decided_at: string | null;
  decision_note: string | null;
  completed_at: string | null;
  file_count: number | null;
  missing_count: number | null;
}

const stamp = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(iso)) + " UTC";
const LABEL = {
  requested: "Waiting for approval",
  approved: "Approved",
  rejected: "Rejected",
  completed: "Completed",
};

export default async function ExportPage() {
  const caps = await getCapabilities();
  const isAdmin = caps.roles.has("system_admin");
  const isHead = caps.roles.has("project_head");
  if (!isAdmin && !isHead) notFound();

  const demo = await getPersona();
  let data: Req[] | null;
  let archive: { setting_value: unknown } | null = null;
  if (demo) {
    data = demoExportRequests();
  } else {
    const supabase = await createClient();
    const [reqs, arch] = await Promise.all([
      supabase
        .from("export_requests")
        .select("*")
        .order("requested_at", { ascending: false })
        .returns<Req[]>(),
      supabase
        .from("project_settings")
        .select("setting_value")
        .eq("setting_key", "archive")
        .maybeSingle(),
    ]);
    data = reqs.data;
    archive = arch.data;
  }
  const requests = data ?? [];
  const open = requests.find((r) => r.status === "requested" || r.status === "approved");
  const lastDone = requests.find((r) => r.status === "completed");
  const arch = archive?.setting_value as
    { archived_at: string; retention_until: string } | undefined;

  return (
    <main className="stack-lg">
      <PageHero eyebrow="Export" title="Export and archive">
        At the end of the project the administrator exports all records and documents. The Project
        Head must approve each export, and each approval allows one export. Archiving is a separate
        step and never deletes anything.
      </PageHero>

      {arch && (
        <section className="panel" role="status">
          <h2>Archived</h2>
          <p>
            Archived on {stamp(arch.archived_at)}. Keep the export archive in an access-controlled
            location until {stamp(arch.retention_until)}. Delete project data only after written
            approval.
          </p>
        </section>
      )}

      {open?.status === "requested" && isHead && (
        <section className="panel">
          <h2>Approval needed</h2>
          <p>
            The administrator requested a full project export on {stamp(open.requested_at)}.
            {open.note ? ` Note: ${open.note}` : ""}
          </p>
          <div className="actions">
            <ActionForm
              action={decideExport}
              fields={{ request: open.id, approve: "true" }}
              label="Approve export"
            >
              <input
                name="note"
                placeholder="Note (optional)"
                aria-label="Approval note"
                maxLength={1000}
              />
            </ActionForm>
            <ActionForm
              action={decideExport}
              fields={{ request: open.id, approve: "false" }}
              label="Reject"
            >
              <input
                name="note"
                placeholder="Reason (optional)"
                aria-label="Rejection reason"
                maxLength={1000}
              />
            </ActionForm>
          </div>
        </section>
      )}

      {isAdmin && (
        <section className="panel">
          <h2>Run an export</h2>
          {!open && (
            <ActionForm action={requestExport} fields={{}} label="Request export approval">
              <input
                name="note"
                placeholder="Note for the Project Head (optional)"
                aria-label="Note"
                maxLength={1000}
              />
            </ActionForm>
          )}
          {open?.status === "requested" && (
            <p>Waiting for the Project Head to approve your request.</p>
          )}
          {open?.status === "approved" && (
            <>
              <p>
                Approved on {open.decided_at ? stamp(open.decided_at) : ""}. The download can be
                used once and includes every document version.
              </p>
              <form method="post" action="/api/export">
                <input type="hidden" name="request" value={open.id} />
                <button type="submit">Download export (ZIP)</button>
              </form>
              <p className="muted">
                Keep the page open until the download finishes. If it fails, the approval stays
                available. Afterwards, verify the checksums with{" "}
                <code>sha256sum -c CHECKSUMS.sha256</code> and check that MANIFEST.csv shows no
                &quot;included = no&quot; rows.
              </p>
            </>
          )}
          {lastDone && !arch && (
            <div className="process-block">
              <h3>Archive the project</h3>
              <p>
                The last export finished on{" "}
                {lastDone.completed_at ? stamp(lastDone.completed_at) : ""} with{" "}
                {lastDone.file_count} document versions
                {lastDone.missing_count
                  ? `, ${lastDone.missing_count} of them missing from storage`
                  : ""}
                .
              </p>
              {lastDone.missing_count ? (
                <p role="alert" className="error">
                  Some files could not be retrieved. Investigate before archiving.
                </p>
              ) : null}
              <ActionForm
                action={archiveProject}
                fields={{ request: lastDone.id }}
                label="Mark project archived"
              >
                <input
                  name="note"
                  placeholder="Note (optional)"
                  aria-label="Archive note"
                  maxLength={1000}
                />
              </ActionForm>
              <p className="muted">
                Only do this after you have downloaded the export and verified it. The retention
                period is one year.
              </p>
            </div>
          )}
        </section>
      )}

      <section className="panel">
        <h2>History</h2>
        {requests.length === 0 ? (
          <EmptyState>No export requests yet.</EmptyState>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Requested</th>
                <th>Status</th>
                <th>Files</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td>{stamp(r.requested_at)}</td>
                  <td>{LABEL[r.status]}</td>
                  <td>
                    {r.file_count === null
                      ? "—"
                      : `${r.file_count}${r.missing_count ? ` (${r.missing_count} missing)` : ""}`}
                  </td>
                  <td>{[r.note, r.decision_note].filter(Boolean).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
