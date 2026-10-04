import {
  STAGES,
  STATUSES,
  isDone,
  type AssignmentRow,
  type Stage,
  type Status,
  type SubprocessRow,
} from "./domain";

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
    percent: rows.length === 0 ? 0 : Math.round((done / rows.length) * 100),
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
  return group(rows, (r) => [[r.phaseName, r.phaseName]]).sort(
    (a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0),
  );
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
