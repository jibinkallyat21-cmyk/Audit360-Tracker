"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { toneForLead } from "@/lib/brand";
import {
  STAGES,
  STAGE_LABEL,
  STATUSES,
  STATUS_LABEL,
  type Stage,
  type Status,
  type SubprocessRow,
} from "@/lib/domain";
import { rollupProcesses } from "@/lib/progress";
import { PhaseCards } from "./phase-cards";
import { EmptyState, Pips, StageBadge, StatusBadge } from "./ui";

type View = "cards" | "flow" | "board" | "list";
const VIEWS: { id: View; label: string }[] = [
  { id: "cards", label: "Overview" },
  { id: "flow", label: "Flow" },
  { id: "board", label: "Board" },
  { id: "list", label: "List" },
];

/**
 * Three views of the same items: the process flow, a stage board and a plain list.
 * Everything here filters rows the server already scoped to this user, so search,
 * counts and the person highlight can never reveal anything outside their access.
 */
export function WorkflowExplorer({
  rows,
  mineProcessIds,
  leadByProcess,
  peopleByProcess,
  teamByProcess = {},
}: {
  rows: SubprocessRow[];
  mineProcessIds: string[];
  leadByProcess: Record<string, string>;
  peopleByProcess: Record<string, string[]>;
  /** Team members per process (without the lead), for the overview cards. */
  teamByProcess?: Record<string, string[]>;
}) {
  const [view, setView] = useState<View>("cards");
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<Stage | "">("");
  const [status, setStatus] = useState<Status | "">("");
  const [phase, setPhase] = useState("");
  const [mine, setMine] = useState(false);
  const [person, setPerson] = useState("");
  const tabsId = useId();

  const mineSet = useMemo(() => new Set(mineProcessIds), [mineProcessIds]);
  const phaseNames = useMemo(
    () =>
      [...new Map(rows.map((r) => [r.phaseName, r.phaseOrder]))]
        .sort((a, b) => a[1] - b[1])
        .map((p) => p[0]),
    [rows],
  );
  const people = useMemo(
    () => [...new Set(Object.values(peopleByProcess).flat())].sort((a, b) => a.localeCompare(b)),
    [peopleByProcess],
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

  const involves = (processId: string) =>
    !person || (peopleByProcess[processId] ?? []).includes(person);
  const tone = (processId: string) => `tone-${toneForLead(leadByProcess[processId])}`;

  const flow = useMemo(() => {
    const order = new Map(rows.map((r) => [r.phaseName, r.phaseOrder]));
    const byPhase = new Map<string, ReturnType<typeof rollupProcesses>>();
    for (const p of rollupProcesses(visible)) {
      byPhase.set(p.phaseName, [...(byPhase.get(p.phaseName) ?? []), p]);
    }
    return [...byPhase.entries()].sort((a, b) => (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0));
  }, [rows, visible]);

  const listGroups = useMemo(() => {
    const byPhase = new Map<string, { order: number; processes: Map<string, SubprocessRow[]> }>();
    for (const r of visible) {
      const g = byPhase.get(r.phaseName) ?? { order: r.phaseOrder, processes: new Map() };
      g.processes.set(r.processCode, [...(g.processes.get(r.processCode) ?? []), r]);
      byPhase.set(r.phaseName, g);
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
        {people.length > 1 && view !== "list" && (
          <label>
            <span>Highlight person</span>
            <select value={person} onChange={(e) => setPerson(e.target.value)}>
              <option value="">Everyone</option>
              {people.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        {mineProcessIds.length > 0 && (
          <label className="check">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
            <span>Only my work</span>
          </label>
        )}
      </form>

      <div>
        <div className="tabs" role="tablist" aria-label="Workflow views">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              id={`${tabsId}-${v.id}`}
              type="button"
              role="tab"
              className="tab"
              aria-selected={view === v.id}
              aria-controls={`${tabsId}-panel`}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <p className="muted" role="status">
          {visible.length} of {rows.length} items
          {person && view !== "list" ? ` · highlighting ${person}` : ""}
        </p>
      </div>

      <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${view}`}>
        {visible.length === 0 && <EmptyState>No items match.</EmptyState>}

        {view === "cards" && visible.length > 0 && (
          <PhaseCards rows={visible} leadByProcess={leadByProcess} teamByProcess={teamByProcess} />
        )}

        {view === "flow" && visible.length > 0 && (
          <div className="flow">
            {flow.map(([name, processes], i) => {
              const leads = [
                ...new Set(processes.map((p) => leadByProcess[p.processId]).filter(Boolean)),
              ];
              return (
                <section key={name} className="flow-phase" aria-label={name}>
                  <div className="flow-head">
                    <span className="eyebrow">Phase {i + 1}</span>
                    <h3>{name}</h3>
                    {leads.length > 0 && <span className="muted">Lead {leads.join(", ")}</span>}
                  </div>
                  {processes.map((p) => {
                    const hit = !!person && involves(p.processId);
                    const dim = !!person && !hit;
                    return (
                      <Link
                        key={p.processId}
                        href={`/processes/${p.code}`}
                        className={`node ${tone(p.processId)}${dim ? " dim" : ""}${hit ? " hit" : ""}`}
                      >
                        <span className="code">{p.code}</span>
                        <span className="t">{p.title}</span>
                        <span className="row">
                          <Pips stage={p.stage} />
                          <span>
                            {p.done}/{p.total} done
                          </span>
                          {p.blocked > 0 && (
                            <span className="badge status-blocked">■ {p.blocked} blocked</span>
                          )}
                        </span>
                      </Link>
                    );
                  })}
                </section>
              );
            })}
          </div>
        )}

        {view === "board" && visible.length > 0 && (
          <div className="board">
            {STAGES.map((st) => {
              const cards = visible.filter((r) => r.stage === st);
              return (
                <section key={st} className="board-col" aria-label={STAGE_LABEL[st]}>
                  <header>
                    <strong>{STAGE_LABEL[st]}</strong>
                    <span>{cards.length}</span>
                  </header>
                  {cards.length === 0 && <p className="empty">Nothing here.</p>}
                  {cards.map((r) => {
                    const hit = !!person && involves(r.processId);
                    const dim = !!person && !hit;
                    return (
                      <Link
                        key={r.id}
                        href={`/processes/${r.processCode}`}
                        className={`board-card ${tone(r.processId)}${dim ? " dim" : ""}${hit ? " hit" : ""}`}
                      >
                        <span className="code">
                          {r.processCode} · step {r.seq}
                        </span>
                        <p>{r.title}</p>
                        <StatusBadge status={r.status} />
                      </Link>
                    );
                  })}
                </section>
              );
            })}
          </div>
        )}

        {view === "list" &&
          listGroups.map(([name, { processes }]) => (
            <section key={name} className="panel" style={{ marginBottom: 18 }}>
              <h2>{name}</h2>
              {[...processes.entries()].map(([code, subs]) => (
                <div key={code} className={`process-block ${tone(subs[0].processId)}`}>
                  <h3>
                    <span className="dot" aria-hidden="true" />
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
    </div>
  );
}
