import {
  addComment,
  raiseReviewPoint,
  recordReviewDecision,
  updateReviewPoint,
} from "@/app/(app)/actions";
import type { AssignmentRow, SubprocessRow } from "@/lib/domain";
import {
  canComment,
  canRaiseReviewPoint,
  canRecordDecision,
  canUpload,
  reviewPointActions,
  type Capabilities,
} from "@/lib/permissions";
import type { CommentRec, Records, ReviewPointRec } from "@/lib/records";
import { ActionForm } from "./client";
import { UploadForm } from "./upload-form";
import { EmptyState } from "./ui";

const RP_LABEL: Record<ReviewPointRec["status"], string> = {
  open: "Open",
  in_progress: "In Progress",
  submitted_for_closure: "Submitted for Closure",
  changes_required: "Changes Required",
  closed: "Closed",
};

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(iso)) + " UTC";
const kb = (n: number) =>
  n < 1024 * 100 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`;

function CommentThread({
  comments,
  parent,
  names,
  reply,
  sub,
  rp,
}: {
  comments: CommentRec[];
  parent: string | null;
  names: Map<string, string>;
  reply: boolean;
  sub: string;
  rp: string | null;
}) {
  const items = comments.filter((c) => c.parent_comment_id === parent);
  if (items.length === 0) return null;
  return (
    <ul className="thread">
      {items.map((c) => (
        <li key={c.id}>
          <p className="meta">
            <strong>{names.get(c.author_id) ?? "A team member"}</strong> · {when(c.created_at)}
          </p>
          <p className="pre">{c.comment_text}</p>
          {reply && (
            <details>
              <summary>Reply</summary>
              <ActionForm
                action={addComment}
                fields={{ sub, parent: c.id, rp: rp ?? "" }}
                label="Post reply"
              >
                <input name="text" required maxLength={4000} aria-label="Reply" />
              </ActionForm>
            </details>
          )}
          <CommentThread
            comments={comments}
            parent={c.id}
            names={names}
            reply={reply}
            sub={sub}
            rp={rp}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * Documents, testing, review points, comments and approvals for one step.
 * Buttons appear only when allowed; the database enforces every rule regardless.
 */
export function StepRecords({
  row,
  caps,
  records,
  people,
}: {
  row: SubprocessRow;
  caps: Capabilities;
  records: Records;
  people: AssignmentRow[];
}) {
  const names = records.names;
  const mine = <T extends { subprocess_id: string }>(xs: T[]) =>
    xs.filter((x) => x.subprocess_id === row.id);
  const docs = mine(records.documents);
  const tests = mine(records.testing);
  const points = mine(records.reviewPoints);
  const comments = mine(records.comments);
  const approvals = mine(records.approvals);
  const general = comments.filter((c) => !c.review_point_id);
  const docName = new Map(docs.map((d) => [d.id, d.original_filename]));
  const owners = [
    ...new Map(
      people
        .filter((p) => p.processId === row.processId && p.type !== "reviewer")
        .map((p) => [p.personId, p.personName]),
    ),
  ];
  const openPoints = points.filter((p) => p.status !== "closed");
  const commenting = canComment(caps, row.processId);
  const uploading = canUpload(caps, row.processId);
  const raising = canRaiseReviewPoint(caps, row);
  const deciding = canRecordDecision(caps, row);

  return (
    <div className="records">
      <details open={docs.length > 0 || uploading}>
        <summary>Documents ({docs.length})</summary>
        {docs.length === 0 ? (
          <EmptyState>No documents yet.</EmptyState>
        ) : (
          <ul className="list">
            {docs.map((d) => (
              <li key={d.id}>
                <strong>{d.original_filename}</strong>
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
                          {kb(v.file_size)} · {names.get(v.uploaded_by) ?? "A team member"} ·{" "}
                          {when(v.uploaded_at)}
                          {v.version_note ? ` · ${v.version_note}` : ""}
                        </span>
                      </li>
                    ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {uploading && (
          <UploadForm
            subId={row.id}
            documents={docs.map((d) => ({ id: d.id, name: d.original_filename }))}
            reviewPoints={openPoints.map((p) => ({ id: p.id, label: p.description.slice(0, 60) }))}
          />
        )}
      </details>

      <details open={tests.length > 0}>
        <summary>Testing ({tests.length})</summary>
        {tests.length === 0 ? (
          <EmptyState>No test results recorded.</EmptyState>
        ) : (
          <ul className="list">
            {tests.map((t) => (
              <li key={t.id}>
                <span className={`badge test-${t.result}`}>
                  {t.result === "pass" ? "✓ Pass" : "✕ Fail"}
                </span>{" "}
                <span className="muted">
                  {names.get(t.submitted_by) ?? "A team member"} · {when(t.created_at)}
                </span>
                {t.notes && <p className="pre">{t.notes}</p>}
                {t.evidence_document_id && docName.get(t.evidence_document_id) && (
                  <p className="muted">Evidence: {docName.get(t.evidence_document_id)}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </details>

      <details open={points.length > 0 || raising || deciding}>
        <summary>
          Review points ({openPoints.length} open of {points.length})
        </summary>
        {points.length === 0 && <EmptyState>No review points.</EmptyState>}
        <ul className="list">
          {points.map((p) => {
            const act = reviewPointActions(caps, row.processId, {
              ownerPersonId: p.assigned_to_person_id,
              status: p.status,
            });
            const rpComments = comments.filter((c) => c.review_point_id === p.id);
            return (
              <li key={p.id} className="rp">
                <p>
                  <span className={`badge rp-${p.status}`}>{RP_LABEL[p.status]}</span>{" "}
                  <strong>{p.description}</strong>
                </p>
                <p className="meta">
                  Raised by {names.get(p.raised_by) ?? "a reviewer"} · {when(p.created_at)} · Owner:{" "}
                  {p.owner.display_name}
                </p>
                {p.resolution_note && (
                  <p className="pre">
                    <em>Owner&apos;s response:</em> {p.resolution_note}
                  </p>
                )}
                {p.status === "closed" && p.closed_by && p.closed_at && (
                  <p className="meta">
                    Closure approved by {names.get(p.closed_by) ?? "a reviewer"} ·{" "}
                    {when(p.closed_at)}
                  </p>
                )}
                <div className="actions">
                  {act.start && (
                    <ActionForm
                      action={updateReviewPoint}
                      fields={{ rp: p.id, action: "start" }}
                      label="Start work"
                    />
                  )}
                  {act.submit && (
                    <ActionForm
                      action={updateReviewPoint}
                      fields={{ rp: p.id, action: "submit" }}
                      label="Submit response for closure"
                    >
                      <input
                        name="note"
                        required
                        maxLength={4000}
                        placeholder="What was done"
                        aria-label="Response"
                      />
                    </ActionForm>
                  )}
                  {act.approveClose && (
                    <ActionForm
                      action={updateReviewPoint}
                      fields={{ rp: p.id, action: "approve_close" }}
                      label="Approve closure"
                    >
                      <input
                        name="note"
                        maxLength={4000}
                        placeholder="Note (optional)"
                        aria-label="Approval note"
                      />
                    </ActionForm>
                  )}
                  {act.returnBack && (
                    <ActionForm
                      action={updateReviewPoint}
                      fields={{ rp: p.id, action: "return" }}
                      label="Return for changes"
                      quiet
                    >
                      <input
                        name="note"
                        required
                        maxLength={4000}
                        placeholder="Reason"
                        aria-label="Reason"
                      />
                    </ActionForm>
                  )}
                </div>
                <CommentThread
                  comments={rpComments}
                  parent={null}
                  names={names}
                  reply={commenting}
                  sub={row.id}
                  rp={p.id}
                />
              </li>
            );
          })}
        </ul>
        {raising && (
          <ActionForm
            action={raiseReviewPoint}
            fields={{ sub: row.id }}
            label="Raise review point"
            className="stack"
          >
            <label className="field">
              <span>Review point</span>
              <textarea name="description" required maxLength={4000} rows={2} />
            </label>
            <label className="field">
              <span>Corrective owner</span>
              <select name="owner" required defaultValue="">
                <option value="" disabled>
                  Choose…
                </option>
                {owners.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </ActionForm>
        )}
        {deciding && (
          <div className="actions">
            <ActionForm
              action={recordReviewDecision}
              fields={{ sub: row.id, decision: "approved" }}
              label="Approve"
            >
              <input
                name="note"
                maxLength={2000}
                placeholder="Note (optional)"
                aria-label="Decision note"
              />
            </ActionForm>
            <ActionForm
              action={recordReviewDecision}
              fields={{ sub: row.id, decision: "changes_required" }}
              label="Request changes"
              quiet
            >
              <input
                name="note"
                maxLength={2000}
                placeholder="Note (optional)"
                aria-label="Change request note"
              />
            </ActionForm>
            <p className="muted">
              Requesting changes needs an open review point. Approving needs every review point
              closed.
            </p>
          </div>
        )}
      </details>

      <details open={general.length > 0 || commenting}>
        <summary>Comments ({general.length})</summary>
        {general.length === 0 && <EmptyState>No comments yet.</EmptyState>}
        <CommentThread
          comments={general}
          parent={null}
          names={names}
          reply={commenting}
          sub={row.id}
          rp={null}
        />
        {commenting && (
          <ActionForm
            action={addComment}
            fields={{ sub: row.id }}
            label="Post comment"
            className="stack"
          >
            <textarea
              name="text"
              required
              maxLength={4000}
              rows={2}
              aria-label="Comment"
              placeholder="Write a comment"
            />
          </ActionForm>
        )}
      </details>

      <details>
        <summary>Approvals ({approvals.length})</summary>
        {approvals.length === 0 ? (
          <EmptyState>No approvals recorded.</EmptyState>
        ) : (
          <ul className="list">
            {approvals.map((a) => (
              <li key={a.id}>
                <strong>{a.approval_type.replace(/_/g, " ")}</strong>:{" "}
                {a.decision.replace(/_/g, " ")}{" "}
                <span className="muted">
                  by {names.get(a.decided_by) ?? "a team member"} · {when(a.decided_at)}
                </span>
                {a.decision_note && <p className="pre">{a.decision_note}</p>}
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}
