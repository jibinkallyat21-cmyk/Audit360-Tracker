import {
  DASHBOARD_STATUS_LABEL,
  REVIEW_DECISION_LABEL,
  STAGES,
  STAGE_LABEL,
  STATUS_LABEL,
  STATUS_SYMBOL,
  type DashboardStatus,
  type ReviewDecision,
  type Stage,
  type Status,
} from "@/lib/domain";

/** Status shown as symbol + text + colour, so colour is never the only signal. */
export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`badge status-${status}`}>
      <span aria-hidden="true">{STATUS_SYMBOL[status]}</span> {STATUS_LABEL[status]}
    </span>
  );
}

export function StageBadge({ stage }: { stage: Stage }) {
  return <span className="badge stage">{STAGE_LABEL[stage]}</span>;
}

export function DecisionBadge({ decision }: { decision: ReviewDecision | null }) {
  if (!decision) return null;
  return (
    <span className={`badge decision-${decision}`}>Review: {REVIEW_DECISION_LABEL[decision]}</span>
  );
}

export function BuildBadge({ status }: { status: DashboardStatus | null }) {
  if (!status) return null;
  return <span className="badge build">Build: {DASHBOARD_STATUS_LABEL[status]}</span>;
}

/** Completed, current and remaining stages, in order. */
export function StageTrack({ stage }: { stage: Stage }) {
  const at = STAGES.indexOf(stage);
  return (
    <ol className="track" aria-label="Workflow stages">
      {STAGES.map((s, i) => {
        const state = i < at ? "done" : i === at ? "current" : "todo";
        return (
          <li
            key={s}
            className={`track-${state}`}
            aria-current={state === "current" ? "step" : undefined}
          >
            <span aria-hidden="true">
              {state === "done" ? "✓" : state === "current" ? "●" : "○"}
            </span>{" "}
            {STAGE_LABEL[s]}
            <span className="sr-only">
              {" "}
              ({state === "done" ? "completed" : state === "current" ? "current" : "remaining"})
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function Meter({ percent, label }: { percent: number; label: string }) {
  return (
    <div
      className="meter"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div style={{ width: `${percent}%` }} />
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="empty">{children}</p>;
}
