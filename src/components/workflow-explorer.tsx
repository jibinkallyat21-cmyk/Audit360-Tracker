"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  STAGES,
  STAGE_LABEL,
  STATUSES,
  STATUS_LABEL,
  type Stage,
  type Status,
  type SubprocessRow,
} from "@/lib/domain";
import { StageBadge, StatusBadge, EmptyState } from "./ui";

/**
 * Filters only the rows the server already scoped to this user, so search and
 * counts can never reveal anything outside their access.
 */
export function WorkflowExplorer({
  rows,
  mineProcessIds,
}: {
  rows: SubprocessRow[];
  mineProcessIds: string[];
}) {
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<Stage | "">("");
  const [status, setStatus] = useState<Status | "">("");
  const [phase, setPhase] = useState("");
  const [mine, setMine] = useState(false);
  const mineSet = useMemo(() => new Set(mineProcessIds), [mineProcessIds]);
  const phaseNames = useMemo(
    () =>
      [...new Map(rows.map((r) => [r.phaseName, r.phaseOrder]))]
        .sort((a, b) => a[1] - b[1])
        .map((p) => p[0]),
    [rows],
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!stage || r.stage === stage) &&
        (!status || r.status === status) &&
        (!phase || r.phaseName === phase) &&
        (!mine || mineSet.has(r.processId)) &&
        (!needle ||
          `${r.processCode} ${r.processTitle} ${r.title} ${r.phaseName}`
            .toLowerCase()
            .includes(needle)),
    );
  }, [rows, q, stage, status, phase, mine, mineSet]);

  const phases = useMemo(() => {
    const byPhase = new Map<string, { order: number; processes: Map<string, SubprocessRow[]> }>();
    for (const r of visible) {
      const phase = byPhase.get(r.phaseName) ?? { order: r.phaseOrder, processes: new Map() };
      const list = phase.processes.get(r.processCode) ?? [];
      list.push(r);
      phase.processes.set(r.processCode, list);
      byPhase.set(r.phaseName, phase);
    }
    return [...byPhase.entries()].sort((a, b) => a[1].order - b[1].order);
  }, [visible]);

  return (
    <div className="stack-lg">
      <form className="filters" role="search" onSubmit={(e) => e.preventDefault()}>
        <label>
          <span>Search</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Process or step"
          />
        </label>
        <label>
          <span>Stage</span>
          <select value={stage} onChange={(e) => setStage(e.target.value as Stage | "")}>
            <option value="">All stages</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Phase</span>
          <select value={phase} onChange={(e) => setPhase(e.target.value)}>
            <option value="">All phases</option>
            {phaseNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {mineProcessIds.length > 0 && (
          <label className="check">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
            <span>Only my work</span>
          </label>
        )}
        <label>
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as Status | "")}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </form>

      <p className="muted" role="status">
        {visible.length} of {rows.length} items
      </p>

      {phases.length === 0 && <EmptyState>No items match.</EmptyState>}

      {phases.map(([phase, { processes }]) => (
        <section key={phase} className="panel">
          <h2>{phase}</h2>
          {[...processes.entries()].map(([code, subs]) => (
            <div key={code} className="process-block">
              <h3>
                <Link href={`/processes/${code}`}>
                  {code} {subs[0].processTitle}
                </Link>
              </h3>
              <ul className="list">
                {subs.map((r) => (
                  <li key={r.id}>
                    <span className="muted">Step {r.seq}:</span> {r.title}{" "}
                    <StageBadge stage={r.stage} /> <StatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
