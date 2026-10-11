import {
  addLine,
  decideLine,
  removeLine,
  renameLine,
  sendLineToReview,
  setLineStatus,
} from "@/app/(app)/actions";
import { LINE_STATUS_LABEL, type LineRow, type SubprocessRow } from "@/lib/domain";
import { canDecideLines, canManageLines, canWorkLines, type Capabilities } from "@/lib/permissions";
import type { Records } from "@/lib/records";
import { ActionForm, SelectField } from "./client";

const WORKING = [
  { value: "not_started", label: "Not Started" },
  { value: "in_progress", label: "In Progress" },
  { value: "blocked", label: "Blocked" },
];

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(iso)) + " UTC";

/** "2 of 4 approved · 1 in review" */
export function lineSummary(lines: LineRow[]): string {
  const n = (s: LineRow["status"]) => lines.filter((l) => l.status === s).length;
  const parts = [`${n("approved")} of ${lines.length} approved`];
  if (n("in_review")) parts.push(`${n("in_review")} in review`);
  if (n("changes_required")) parts.push(`${n("changes_required")} need changes`);
  if (n("blocked")) parts.push(`${n("blocked")} blocked`);
  return parts.join(" · ");
}

/**
 * The lines of one step. Each line is worked on, sent to review and approved on its own, so a
 * finished piece does not wait for the others. Buttons appear only when allowed; the database
 * checks every action again.
 */
export function StepLines({
  row,
  caps,
  records,
}: {
  row: SubprocessRow;
  caps: Capabilities;
  records: Records;
}) {
  const lines = row.lines ?? [];
  const manage = canManageLines(caps, row);
  const work = canWorkLines(caps, row);
  const decide = canDecideLines(caps, row);
  if (lines.length === 0 && !manage) return null;

  const docs = records.documents.filter((d) => d.subprocess_id === row.id);
  const comments = records.comments.filter((c) => c.subprocess_id === row.id && c.line_id);

  return (
    <section className="lines" aria-label="Lines">
      <h4>Lines{lines.length > 0 && <span className="muted"> · {lineSummary(lines)}</span>}</h4>

      {lines.length === 0 ? (
        <details>
          <summary>Split this step into lines</summary>
          <p className="muted">
            Use lines when this step bundles several pieces of work (for example EOSB, GOSI, Prepaid
            and Depreciation). Each line then goes to review and is approved on its own, and the
            step moves to Production when every line is approved. The step&apos;s current progress
            carries over to the first line.
          </p>
          <ActionForm action={addLine} fields={{ sub: row.id }} label="Add first line">
            <input
              name="title"
              required
              maxLength={120}
              placeholder="Line name"
              aria-label="Line name"
            />
          </ActionForm>
        </details>
      ) : (
        <>
          <ul className="list">
            {lines.map((l) => {
              const mine = docs.filter((d) => d.line_id === l.id);
              const notes = comments.filter((c) => c.line_id === l.id);
              const canSend =
                work && (l.status === "in_progress" || l.status === "changes_required");
              return (
                <li key={l.id} className="rp line">
                  <p>
                    <strong>{l.title}</strong>{" "}
                    <span className={`badge line-${l.status}`}>{LINE_STATUS_LABEL[l.status]}</span>
                    {mine.length > 0 && (
                      <span className="muted">
                        {" "}
                        · {mine.length} file{mine.length === 1 ? "" : "s"}:{" "}
                        {mine.map((d) => d.original_filename).join(", ")}
                      </span>
                    )}
                  </p>
                  {notes.slice(-2).map((c) => (
                    <p key={c.id} className="meta">
                      <strong>{records.names.get(c.author_id) ?? "A team member"}</strong> ·{" "}
                      {when(c.created_at)}: <span className="pre">{c.comment_text}</span>
                    </p>
                  ))}
                  <div className="actions">
                    {work && l.status !== "in_review" && l.status !== "approved" && (
                      <ActionForm
                        action={setLineStatus}
                        fields={{ line: l.id }}
                        label="Update status"
                      >
                        <SelectField
                          name="status"
                          label="New status"
                          options={WORKING}
                          value={l.status === "changes_required" ? "in_progress" : l.status}
                        />
                      </ActionForm>
                    )}
                    {canSend &&
                      (mine.length === 0 ? (
                        <p className="muted">Upload a file for this line to send it to review.</p>
                      ) : (
                        <ActionForm
                          action={sendLineToReview}
                          fields={{ line: l.id }}
                          label="Send to review"
                          className="stack"
                        >
                          <label className="check">
                            <input type="checkbox" name="tested" required /> I tested this line and
                            it passed
                          </label>
                          <input
                            name="note"
                            maxLength={2000}
                            placeholder="Note for the reviewer (optional)"
                            aria-label="Note for the reviewer"
                          />
                        </ActionForm>
                      ))}
                    {decide && l.status === "in_review" && (
                      <>
                        <ActionForm
                          action={decideLine}
                          fields={{ line: l.id, decision: "approved" }}
                          label="Approve"
                        >
                          <input
                            name="note"
                            maxLength={2000}
                            placeholder="Note (optional)"
                            aria-label="Approval note"
                          />
                        </ActionForm>
                        <ActionForm
                          action={decideLine}
                          fields={{ line: l.id, decision: "changes_required" }}
                          label="Request changes"
                          quiet
                        >
                          <input
                            name="note"
                            required
                            maxLength={2000}
                            placeholder="What needs to change"
                            aria-label="What needs to change"
                          />
                        </ActionForm>
                      </>
                    )}
                  </div>
                  {manage && (
                    <details>
                      <summary>Rename or remove</summary>
                      <div className="actions">
                        <ActionForm action={renameLine} fields={{ line: l.id }} label="Rename">
                          <input
                            name="title"
                            required
                            maxLength={120}
                            defaultValue={l.title}
                            aria-label="Line name"
                          />
                        </ActionForm>
                        {l.status !== "in_review" && l.status !== "approved" && (
                          <ActionForm
                            action={removeLine}
                            fields={{ line: l.id }}
                            label="Remove line"
                            quiet
                          />
                        )}
                      </div>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
          {manage && (
            <ActionForm action={addLine} fields={{ sub: row.id }} label="Add line">
              <input
                name="title"
                required
                maxLength={120}
                placeholder="New line name"
                aria-label="New line name"
              />
            </ActionForm>
          )}
          {work && (
            <p className="muted">
              Send each line to review as soon as it is ready. The reviewers see it straight away,
              and the step moves to Production when every line is approved.
            </p>
          )}
        </>
      )}
    </section>
  );
}
