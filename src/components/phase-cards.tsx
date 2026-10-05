"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { toneForLead } from "@/lib/brand";
import type { SubprocessRow } from "@/lib/domain";
import { PROCESS_STATUS_LABEL, processStatus, type ProcessStatus } from "@/lib/progress";
import { Meter, StageBadge } from "./ui";

const SYMBOL: Record<ProcessStatus, string> = {
  completed: "✓",
  blocked: "■",
  changes_required: "▲",
  awaiting_review: "◆",
  in_progress: "◐",
  not_started: "○",
};
const ORDER: ProcessStatus[] = [
  "completed",
  "in_progress",
  "awaiting_review",
  "changes_required",
  "blocked",
  "not_started",
];

function Pill({ status, count }: { status: ProcessStatus; count?: number }) {
  return (
    <span className={`pill pill-${status}`}>
      <span aria-hidden="true">{SYMBOL[status]}</span> {PROCESS_STATUS_LABEL[status]}
      {count !== undefined && ` · ${count}`}
    </span>
  );
}

interface Proc {
  processId: string;
  code: string;
  title: string;
  rows: SubprocessRow[];
  status: ProcessStatus;
}
interface Phase {
  name: string;
  order: number;
  procs: Proc[];
}

const countBy = (procs: Proc[]) => {
  const c = new Map<ProcessStatus, number>();
  for (const p of procs) c.set(p.status, (c.get(p.status) ?? 0) + 1);
  return ORDER.filter((s) => c.has(s)).map((s) => [s, c.get(s)!] as const);
};

/**
 * Phase overview, and inside a phase one card per process (lead, team, status, summary).
 * Works on rows the server already scoped to this user.
 */
export function PhaseCards({
  rows,
  leadByProcess,
  teamByProcess,
}: {
  rows: SubprocessRow[];
  leadByProcess: Record<string, string>;
  teamByProcess: Record<string, string[]>;
}) {
  const [open, setOpen] = useState<string | null>(null);

  const phases = useMemo<Phase[]>(() => {
    const byPhase = new Map<string, Phase>();
    const byProc = new Map<string, Proc>();
    for (const r of rows) {
      const phase = byPhase.get(r.phaseName) ?? {
        name: r.phaseName,
        order: r.phaseOrder,
        procs: [],
      };
      let proc = byProc.get(r.processId);
      if (!proc) {
        proc = {
          processId: r.processId,
          code: r.processCode,
          title: r.processTitle,
          rows: [],
          status: "not_started",
        };
        byProc.set(r.processId, proc);
        phase.procs.push(proc);
      }
      proc.rows.push(r);
      byPhase.set(r.phaseName, phase);
    }
    for (const p of byProc.values()) {
      p.rows.sort((a, b) => a.seq - b.seq);
      p.status = processStatus(p.rows);
    }
    for (const ph of byPhase.values()) {
      ph.procs.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    }
    return [...byPhase.values()].sort((a, b) => a.order - b.order);
  }, [rows]);

  const current = open ? phases.find((p) => p.name === open) : undefined;

  if (current) {
    return (
      <section className="stack-lg" aria-label={current.name}>
        <header className="phase-head">
          <button type="button" className="secondary" onClick={() => setOpen(null)}>
            ← Back to overview
          </button>
          <span className="phase-icon" aria-hidden="true">
            {current.order}
          </span>
          <div className="phase-title">
            <h2>{current.name}</h2>
            <p className="muted">
              {current.procs.length} {current.procs.length === 1 ? "process" : "processes"} · select
              one to open
            </p>
          </div>
          <div className="phase-chips">
            {countBy(current.procs).map(([s, n]) => (
              <Pill key={s} status={s} count={n} />
            ))}
          </div>
        </header>

        <ul className="proc-cards">
          {current.procs.map((p) => {
            const lead = leadByProcess[p.processId];
            const team = teamByProcess[p.processId] ?? [];
            const stage = furthestBack(p.rows);
            return (
              <li key={p.processId} className={`proc-card tone-${toneForLead(lead)}`}>
                <div className="proc-main">
                  <h3>
                    <span className="mono">{p.code}</span> {p.title} <StageBadge stage={stage} />
                  </h3>
                  {lead && (
                    <p className="proc-owner">
                      <strong>Lead:</strong> {lead}
                    </p>
                  )}
                  <p className="proc-meta">
                    {team.length > 0 && <span>Team: {team.join(", ")}</span>}
                    <span className="tag">
                      {p.rows.length} {p.rows.length === 1 ? "step" : "steps"}
                    </span>
                    <Pill status={p.status} />
                  </p>
                  <p className="proc-desc">{p.rows.map((r) => r.title).join(" · ")}</p>
                </div>
                <Link href={`/processes/${p.code}`} className="button">
                  View details →
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  return (
    <ul className="phase-grid">
      {phases.map((ph) => {
        const steps = ph.procs.flatMap((p) => p.rows);
        const done = steps.filter(
          (r) => r.stage === "production" && r.status === "completed",
        ).length;
        const percent = steps.length === 0 ? 0 : Math.round((done / steps.length) * 100);
        return (
          <li key={ph.name}>
            <button type="button" className="phase-card" onClick={() => setOpen(ph.name)}>
              <span className="eyebrow">Phase {ph.order}</span>
              <strong>{ph.name}</strong>
              <span className="muted">
                {ph.procs.length} {ph.procs.length === 1 ? "process" : "processes"} · {steps.length}{" "}
                {steps.length === 1 ? "step" : "steps"}
              </span>
              <Meter percent={percent} label={`${ph.name} progress`} />
              <span className="phase-chips">
                {countBy(ph.procs).map(([s, n]) => (
                  <Pill key={s} status={s} count={n} />
                ))}
              </span>
              <span className="phase-open">Open →</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function furthestBack(rows: SubprocessRow[]) {
  const order = ["process_definition", "solution_building", "testing", "review", "production"];
  return rows.reduce(
    (a, r) => (order.indexOf(r.stage) < order.indexOf(a) ? r.stage : a),
    rows[0].stage,
  );
}
