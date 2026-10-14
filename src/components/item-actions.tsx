import {
  completeStage,
  overrideStepToReview,
  recordTesting,
  sendToReview,
  setDashboardStatus,
  setStatus,
} from "@/app/(app)/actions";
import {
  DASHBOARD_STATUSES,
  DASHBOARD_STATUS_LABEL,
  STAGE_LABEL,
  type SubprocessRow,
} from "@/lib/domain";
import {
  canCompleteStage,
  canOverrideStep,
  canSendToReview,
  canRecordTesting,
  canSetDashboardStatus,
  canSetStatus,
  type Capabilities,
} from "@/lib/permissions";
import { ActionForm, SelectField } from "./client";

const SETTABLE = [
  { value: "not_started", label: "Not Started" },
  { value: "in_progress", label: "In Progress" },
  { value: "blocked", label: "Blocked" },
];

/** Tells a Production Lead how to move a step on. */
function nextStepHint(caps: Capabilities, row: SubprocessRow): string | null {
  if (canSendToReview(caps, row)) {
    return "When the work is ready, press “Send to review”. You do not need to complete each stage first.";
  }
  if (!canSetStatus(caps, row) || row.stage === "production" || canCompleteStage(caps, row)) {
    return null;
  }
  if (row.stage === "review") {
    return "This step is with the reviewers. The Project Lead moves it to Production once it is approved.";
  }
  if (row.status === "blocked") return "Clear the Blocked status, then send it to review.";
  return null;
}

/**
 * Shows only the actions this user can take. This is a convenience: the database
 * functions re-check every request and reject anything not permitted.
 */
export function ItemActions({
  row,
  caps,
  documents = [],
}: {
  row: SubprocessRow;
  caps: Capabilities;
  documents?: { id: string; name: string }[];
}) {
  const sub = { sub: row.id };
  const parts = [
    canSendToReview(caps, row) && (
      <ActionForm
        key="send"
        action={sendToReview}
        fields={sub}
        label="Send to review"
        className="stack"
      >
        <label className="check">
          <input type="checkbox" name="tested" required /> I tested this and it passed
        </label>
        <input
          name="note"
          maxLength={2000}
          placeholder="Note for the reviewer (optional)"
          aria-label="Note for the reviewer"
        />
      </ActionForm>
    ),
    canOverrideStep(caps, row) && (
      <details key="override">
        <summary>Project Lead: send to review without the team</summary>
        <ActionForm action={overrideStepToReview} fields={sub} label="Send to review" quiet>
          <input
            name="reason"
            required
            maxLength={500}
            placeholder="Reason"
            aria-label="Reason for sending it to review"
          />
        </ActionForm>
      </details>
    ),
    canSetStatus(caps, row) && (
      <ActionForm key="status" action={setStatus} fields={sub} label="Update status">
        <SelectField
          name="status"
          label="New status"
          options={SETTABLE}
          value={
            row.status === "completed"
              ? "in_progress"
              : SETTABLE.some((o) => o.value === row.status)
                ? row.status
                : "in_progress"
          }
        />
      </ActionForm>
    ),
    canRecordTesting(caps, row) && (
      <ActionForm key="test" action={recordTesting} fields={sub} label="Record test result">
        <SelectField
          name="result"
          label="Test result"
          options={[
            { value: "pass", label: "Pass" },
            { value: "fail", label: "Fail" },
          ]}
        />
        {documents.length > 0 && (
          <SelectField
            name="evidence"
            label="Evidence document"
            options={[
              { value: "", label: "No evidence" },
              ...documents.map((d) => ({ value: d.id, label: d.name })),
            ]}
          />
        )}
        <input
          name="notes"
          placeholder="Notes (optional)"
          aria-label="Test notes"
          maxLength={2000}
        />
      </ActionForm>
    ),
    canCompleteStage(caps, row) && (
      <ActionForm
        key="complete"
        action={completeStage}
        fields={sub}
        label={
          row.stage === "review"
            ? "Move to Production"
            : row.stage === "production"
              ? "Mark Production complete"
              : `Complete ${STAGE_LABEL[row.stage]}`
        }
      />
    ),
    canSetDashboardStatus(caps, row) && (
      <ActionForm key="build" action={setDashboardStatus} fields={sub} label="Update build status">
        <SelectField
          name="status"
          label="Build status"
          value={row.dashboardStatus ?? "not_started"}
          options={DASHBOARD_STATUSES.map((s) => ({ value: s, label: DASHBOARD_STATUS_LABEL[s] }))}
        />
      </ActionForm>
    ),
  ].filter(Boolean);
  const hint = nextStepHint(caps, row);
  if (parts.length === 0 && !hint) return null;
  return (
    <>
      {parts.length > 0 && <div className="actions">{parts}</div>}
      {hint && <p className="muted">{hint}</p>}
    </>
  );
}
