import Link from "next/link";
import { Countdown } from "@/components/client";
import { DeadlineForm } from "@/components/deadline-form";
import { ItemActions } from "@/components/item-actions";
import {
  BuildBadge,
  EmptyState,
  Meter,
  StageBadge,
  StageBar,
  StatCard,
  StatusBadge,
  FlowBadge,
} from "@/components/ui";
import { toneForLead } from "@/lib/brand";
import { getCapabilities, getDeadline, listAssignments, listSubprocesses } from "@/lib/data";
import { STAGE_LABEL, STATUSES, type SubprocessRow } from "@/lib/domain";
import { canSetDeadline, dashboardKind } from "@/lib/permissions";
import { buildQueue } from "@/lib/queue";
import { byLead, byPhase, rollupProcesses, summarize, type GroupProgress } from "@/lib/progress";

const LIMIT = 5;

function ItemList({
  rows,
  empty,
  leadOf,
  limit = LIMIT,
  youAre,
}: {
  rows: SubprocessRow[];
  empty: string;
  leadOf: Map<string, string>;
  limit?: number;
  /** Your role on a process, shown beside each item ("You: Reviewer"). */
  youAre?: (processId: string) => string;
}) {
  if (rows.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <ul className="items">
      {rows.slice(0, limit).map((r) => (
        <li key={r.id} className={`tone-${toneForLead(leadOf.get(r.processId))}`}>
          <Link href={`/processes/${r.processCode}`} className="item-main">
            <span className="dot" aria-hidden="true" />
            <strong className="mono">{r.processCode}</strong>
            <span className="item-title">{r.processTitle}</span>
          </Link>
          <span className="item-meta">
            <span className="muted">
              Step {r.seq} · {STAGE_LABEL[r.stage]}
              {youAre?.(r.processId) ? ` · You: ${youAre(r.processId)}` : ""}
            </span>
            <FlowBadge row={r} />
          </span>
        </li>
      ))}
      {rows.length > limit && (
        <li className="more">
          <Link href="/workflow">+{rows.length - limit} more in Workflow</Link>
        </li>
      )}
    </ul>
  );
}

function Progress({ items }: { items: GroupProgress[] }) {
  if (items.length === 0) return <EmptyState>Nothing to show yet.</EmptyState>;
  return (
    <ul className="bars">
      {items.map((g) => (
        <li key={g.key}>
          <div>
            <span>
              {g.label}
              {g.weight ? <span className="muted"> · counts {g.weight}% of the total</span> : null}
            </span>
            <span className="num">
              {g.done}/{g.total} · {g.percent}%
            </span>
          </div>
          <Meter percent={g.percent} label={`${g.label} progress`} />
        </li>
      ))}
    </ul>
  );
}

export default async function DashboardPage() {
  const [rows, assignments, caps, deadline] = await Promise.all([
    listSubprocesses(),
    listAssignments(),
    getCapabilities(),
    getDeadline(),
  ]);
  const kind = dashboardKind(caps);
  const s = summarize(rows);
  const isDashboardLead = canSetDeadline(caps);
  const inProduction = rows.filter((r) => r.stage === "production");
  const mine = rows.filter((r) => caps.assignments.has(r.processId));
  const leadOf = new Map(
    assignments.filter((a) => a.type === "production_lead").map((a) => [a.processId, a.personName]),
  );
  const needs = buildQueue(rows, caps);
  const ROLE: Record<string, string> = {
    production_lead: "Production Lead",
    team_member: "Team",
    reviewer: "Reviewer",
    supporting_role: "Supporting",
  };
  const youAre = (processId: string) =>
    [...(caps.assignments.get(processId) ?? [])].map((t) => ROLE[t] ?? t).join(", ");
  const scope = kind === "member" ? mine : rows;
  const scoped = kind === "member" ? summarize(mine) : s;

  return (
    <main className="stack-lg">
      <div className="stack">
        <Countdown deadline={deadline} />
        {isDashboardLead && (
          <details className="panel deadline-panel">
            <summary>Change the deadline</summary>
            <p className="muted">
              Only the Dashboard Lead can set the shared deadline. Every change is logged.
            </p>
            <DeadlineForm current={deadline} />
          </details>
        )}
      </div>

      <div className="stats">
        {kind === "member" ? (
          <>
            <StatCard label="My items" value={scope.length} />
            <StatCard label="In progress" value={scoped.byStatus.in_progress} />
            <StatCard label="Awaiting review" value={scoped.awaitingReview.length} />
            <StatCard
              label="Blocked"
              value={scoped.byStatus.blocked}
              warn={scoped.byStatus.blocked > 0}
            />
          </>
        ) : (
          <>
            <StatCard
              label="Complete"
              value={`${s.percent}%`}
              hint={`${s.done} of ${s.total} items · weighted by phase`}
            />
            <StatCard
              label="Items"
              value={s.total}
              hint={`${rollupProcesses(rows).length} processes`}
            />
            <StatCard label="Awaiting review" value={s.awaitingReview.length} />
            <StatCard label="Blocked" value={s.byStatus.blocked} warn={s.byStatus.blocked > 0} />
          </>
        )}
      </div>

      {needs.length > 0 && (
        <section className="panel">
          <h2>Needs you</h2>
          <div className="attention">
            {needs.map((n) => (
              <div key={n.key}>
                <h3>
                  {n.title} ({n.items.length})
                </h3>
                <ul className="items">
                  {n.items.slice(0, LIMIT).map((i) => (
                    <li key={i.key}>
                      <Link href={`/processes/${i.code}`} className="item-main">
                        <span className="dot" aria-hidden="true" />
                        <strong className="mono">{i.code}</strong>
                        <span className="item-title">
                          {i.processTitle} · step {i.step}
                          {i.line ? ` · ${i.line}` : ""}
                        </span>
                      </Link>
                    </li>
                  ))}
                  {n.items.length > LIMIT && (
                    <li className="more">
                      <Link href="/queue">+{n.items.length - LIMIT} more in My queue</Link>
                    </li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {kind === "member" && (
        <section className="panel">
          <h2>My work</h2>
          <ItemList
            rows={mine}
            empty="You have no assigned work yet."
            leadOf={leadOf}
            limit={50}
            youAre={youAre}
          />
        </section>
      )}

      {kind !== "member" && (
        <>
          <section className="panel">
            <h2>{kind === "lead" ? "My teams' pipeline" : "Pipeline"}</h2>
            <StageBar counts={s.byStage} />
            <p className="muted">
              {s.done} of {s.total} items finished in Production. Overall completion is weighted by
              phase: Audit execution 55%, File management and closure 5%, every other phase 10%.
            </p>
            <Meter percent={s.percent} label="Overall completion" />
            <ul className="chips" aria-label="Items by status">
              {STATUSES.map((st) => (
                <li key={st}>
                  <StatusBadge status={st} /> <strong>{s.byStatus[st]}</strong>
                </li>
              ))}
            </ul>
          </section>

          <div className="grid">
            <section className="panel">
              <h2>Progress by phase</h2>
              <Progress items={byPhase(rows)} />
            </section>
            <section className="panel">
              <h2>Progress by Production Lead</h2>
              <Progress items={byLead(rows, assignments)} />
            </section>
          </div>

          <section className="panel">
            <h2>Needs attention</h2>
            <div className="attention">
              <div>
                <h3>Awaiting review ({s.awaitingReview.length})</h3>
                <ItemList
                  rows={s.awaitingReview}
                  empty="Nothing is waiting for review."
                  leadOf={leadOf}
                />
              </div>
              <div>
                <h3>Blocked ({s.blocked.length})</h3>
                <ItemList rows={s.blocked} empty="Nothing is blocked." leadOf={leadOf} />
              </div>
              <div>
                <h3>Changes required ({s.changesRequired.length})</h3>
                <ItemList
                  rows={s.changesRequired}
                  empty="No changes are outstanding."
                  leadOf={leadOf}
                />
              </div>
            </div>
          </section>

          {kind === "management" && (
            <section className="panel">
              <h2>Processes</h2>
              <p className="muted">
                Titles and progress only. Documents, comments and review details are not shown here.
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Process</th>
                      <th>Phase</th>
                      <th>Furthest back</th>
                      <th>Done</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rollupProcesses(rows).map((p) => (
                      <tr key={p.processId}>
                        <td>
                          <strong className="mono">{p.code}</strong> {p.title}
                        </td>
                        <td>{p.phaseName}</td>
                        <td>
                          <StageBadge stage={p.stage} />
                          {p.blocked > 0 && <span className="muted"> · {p.blocked} blocked</span>}
                        </td>
                        <td className="mono">
                          {p.done}/{p.total}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="panel">
            <h2>Recently updated</h2>
            <ItemList rows={s.recent} empty="No activity yet." leadOf={leadOf} limit={6} />
          </section>
        </>
      )}

      {isDashboardLead && (
        <section className="panel">
          <h2>Production build status</h2>
          <p className="muted">Items that reached Production, handed over for the website build.</p>
          {inProduction.length === 0 ? (
            <EmptyState>No item has reached Production yet.</EmptyState>
          ) : (
            <ul className="row-list">
              {inProduction.map((r) => (
                <li key={r.id} className="build-row">
                  <Link href={`/processes/${r.processCode}`} className="build-name">
                    <strong className="mono">{r.processCode}</strong> {r.title}
                  </Link>
                  <BuildBadge status={r.dashboardStatus} />
                  <ItemActions row={r} caps={caps} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
