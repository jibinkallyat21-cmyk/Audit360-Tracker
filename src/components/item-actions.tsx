import { completeStage, recordTesting, setDashboardStatus, setStatus } from "@/app/(app)/actions";
import {
  DASHBOARD_STATUSES,
  DASHBOARD_STATUS_LABEL,
  STAGE_LABEL,
  type SubprocessRow,
} from "@/lib/domain";
import {
  canCompleteStage,
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
  if (parts.length === 0) return null;
  return <div className="actions">{parts}</div>;
}
