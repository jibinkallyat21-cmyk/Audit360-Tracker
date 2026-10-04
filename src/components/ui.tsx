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

/** Page title band with the grid background and red/blue glow. */
export function PageHero({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="hero">
      {eyebrow && <span className="eyebrow">{eyebrow}</span>}
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </header>
  );
}

/** A big number with a small uppercase label, as on the team-structure page. */
export function StatCard({
  label,
  value,
  hint,
  warn,
}: {
  label: string;
  value: string | number;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div className={warn ? "stat warn" : "stat"}>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

/** Items per stage as one bar, with the counts written out underneath (never colour alone). */
export function StageBar({ counts }: { counts: Record<Stage, number> }) {
  const total = STAGES.reduce((n, s) => n + counts[s], 0);
  return (
    <div>
      <div
        className="stagebar"
        role="img"
        aria-label={`Items by stage: ${STAGES.map((s) => `${STAGE_LABEL[s]} ${counts[s]}`).join(", ")}`}
      >
        {STAGES.map((s) => (
          <span
            key={s}
            style={{ flexGrow: total === 0 ? 1 : Math.max(counts[s], 0.0001), flexBasis: 0 }}
          />
        ))}
      </div>
      <ul className="legend">
        {STAGES.map((s) => (
          <li key={s}>
            <i aria-hidden="true" />
            {STAGE_LABEL[s]} <b>{counts[s]}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Five small bars showing how far an item has come; the current stage is red. */
export function Pips({ stage }: { stage: Stage }) {
  const at = STAGES.indexOf(stage);
  return (
    <span className="pips" role="img" aria-label={`Stage ${at + 1} of 5: ${STAGE_LABEL[stage]}`}>
      {STAGES.map((s, i) => (
        <i key={s} className={i === at ? "now" : i < at ? "on" : ""} />
      ))}
    </span>
  );
}
