import {
  STAGES,
  STATUSES,
  isDone,
  type AssignmentRow,
  type Stage,
  type Status,
  type SubprocessRow,
} from "./domain";

/**
 * How much each phase counts towards overall completion, in percent (they add up to 100).
 * Inside a phase every item counts the same. Any other phase name counts 10, the standard share.
 */
export const PHASE_WEIGHTS: Record<string, number> = {
  "Lead and proposal": 10,
  "Engagement and advance": 10,
  "Audit execution": 55,
  Review: 10,
  "Reporting and submission": 10,
  "File management and closure": 5,
};

export const phaseWeight = (name: string) => PHASE_WEIGHTS[name] ?? 10;

/**
 * Overall completion, weighted by phase: each phase's finished share (done / total) times its
 * weight. When only some phases are visible (a team member sees their own processes), the weights
 * of the phases shown are scaled to add up to 100, so the figure still reads as "of what you see".
 */
export function weightedPercent(rows: SubprocessRow[]): number {
  const phases = new Map<string, { done: number; total: number }>();
  for (const r of rows) {
    const p = phases.get(r.phaseName) ?? { done: 0, total: 0 };
    p.total++;
    if (isDone(r)) p.done++;
    phases.set(r.phaseName, p);
  }
  let earned = 0;
  let possible = 0;
  for (const [name, p] of phases) {
    const w = phaseWeight(name);
    earned += w * (p.done / p.total);
    possible += w;
  }
  return possible === 0 ? 0 : Math.round((earned / possible) * 100);
}

export interface Summary {
  total: number;
  done: number;
  percent: number;
  byStage: Record<Stage, number>;
  byStatus: Record<Status, number>;
  blocked: SubprocessRow[];
  awaitingReview: SubprocessRow[];
  changesRequired: SubprocessRow[];
  recent: SubprocessRow[];
}

const zero = <K extends string>(keys: readonly K[]) =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

export function summarize(rows: SubprocessRow[]): Summary {
  const byStage = zero(STAGES);
  const byStatus = zero(STATUSES);
  let done = 0;
  for (const r of rows) {
    byStage[r.stage]++;
    byStatus[r.status]++;
    if (isDone(r)) done++;
  }
  const recent = [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8);
  return {
    total: rows.length,
    done,
    percent: weightedPercent(rows),
    byStage,
    byStatus,
    blocked: rows.filter((r) => r.status === "blocked"),
    awaitingReview: rows.filter(
      (r) => r.stage === "review" && r.reviewDecision === "pending_review",
    ),
    changesRequired: rows.filter((r) => r.status === "changes_required"),
    recent,
  };
}

export interface GroupProgress {
  key: string;
  label: string;
  total: number;
  done: number;
  percent: number;
  /** Share of the overall figure this group stands for (phases only), in percent. */
  weight?: number;
}

function group(
  rows: SubprocessRow[],
  keyOf: (r: SubprocessRow) => [string, string][],
): GroupProgress[] {
  const map = new Map<string, GroupProgress>();
  for (const r of rows) {
    for (const [key, label] of keyOf(r)) {
      const g = map.get(key) ?? { key, label, total: 0, done: 0, percent: 0 };
      g.total++;
      if (isDone(r)) g.done++;
      map.set(key, g);
    }
  }
  return [...map.values()].map((g) => ({ ...g, percent: Math.round((g.done / g.total) * 100) }));
}

export function byPhase(rows: SubprocessRow[]): GroupProgress[] {
  const order = new Map(rows.map((r) => [r.phaseName, r.phaseOrder]));
  return group(rows, (r) => [[r.phaseName, r.phaseName]])
    .map((g) => ({ ...g, weight: phaseWeight(g.key) }))
    .sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
}

/** Progress per Production Lead, from the processes' lead assignments visible to the viewer. */
export function byLead(rows: SubprocessRow[], assignments: AssignmentRow[]): GroupProgress[] {
  const leadOf = new Map(
    assignments.filter((a) => a.type === "production_lead").map((a) => [a.processId, a.personName]),
  );
  return group(rows, (r) => {
    const lead = leadOf.get(r.processId);
    return lead ? [[lead, lead]] : [];
  }).sort((a, b) => a.label.localeCompare(b.label));
}

export interface ProcessRollup {
  processId: string;
  code: string;
  title: string;
  phaseName: string;
  total: number;
  done: number;
  percent: number;
  /** The least advanced stage among its subprocesses (what is holding the process back). */
  stage: Stage;
  blocked: number;
}

export function rollupProcesses(rows: SubprocessRow[]): ProcessRollup[] {
  const map = new Map<string, ProcessRollup>();
  for (const r of rows) {
    const p = map.get(r.processId) ?? {
      processId: r.processId,
      code: r.processCode,
      title: r.processTitle,
      phaseName: r.phaseName,
      total: 0,
      done: 0,
      percent: 0,
      stage: r.stage,
      blocked: 0,
    };
    p.total++;
    if (isDone(r)) p.done++;
    if (r.status === "blocked") p.blocked++;
    if (STAGES.indexOf(r.stage) < STAGES.indexOf(p.stage)) p.stage = r.stage;
    map.set(r.processId, p);
  }
  return [...map.values()]
    .map((p) => ({ ...p, percent: Math.round((p.done / p.total) * 100) }))
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

export type ProcessStatus =
  "completed" | "blocked" | "changes_required" | "awaiting_review" | "in_progress" | "not_started";

export const PROCESS_STATUS_LABEL: Record<ProcessStatus, string> = {
  completed: "Completed",
  blocked: "Blocked",
  changes_required: "Changes Required",
  awaiting_review: "Awaiting Review",
  in_progress: "In Progress",
  not_started: "Not Started",
};

/** One status for a whole process, worst news first. Completed only when every step is done. */
export function processStatus(rows: SubprocessRow[]): ProcessStatus {
  if (rows.length > 0 && rows.every(isDone)) return "completed";
  if (rows.some((r) => r.status === "blocked")) return "blocked";
  if (rows.some((r) => r.status === "changes_required")) return "changes_required";
  if (rows.some((r) => r.stage === "review" && r.reviewDecision === "pending_review")) {
    return "awaiting_review";
  }
  if (rows.some((r) => r.status === "in_progress" || r.status === "completed")) {
    return "in_progress";
  }
  return "not_started";
}
