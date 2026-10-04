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
} from "@/components/ui";
import { toneForLead } from "@/lib/brand";
import { getCapabilities, getDeadline, listAssignments, listSubprocesses } from "@/lib/data";
import { STAGES, STAGE_LABEL, STATUSES, STATUS_LABEL, type SubprocessRow } from "@/lib/domain";
import { canSetDeadline, dashboardKind } from "@/lib/permissions";
import { byLead, byPhase, rollupProcesses, summarize, type GroupProgress } from "@/lib/progress";

function ItemList({
  rows,
  empty,
  leadOf,
}: {
  rows: SubprocessRow[];
  empty: string;
  leadOf: Map<string, string>;
}) {
  if (rows.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <ul className="list">
      {rows.map((r) => (
        <li key={r.id} className={`tone-${toneForLead(leadOf.get(r.processId))}`}>
          <span className="dot" aria-hidden="true" />
          <Link href={`/processes/${r.processCode}`}>
            <strong className="mono">{r.processCode}</strong> {r.processTitle}
          </Link>
          <span className="muted"> · step {r.seq}</span> <StageBadge stage={r.stage} />{" "}
          <StatusBadge status={r.status} />
        </li>
      ))}
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
            <span>{g.label}</span>
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
  const scope = kind === "member" ? mine : rows;
  const scoped = kind === "member" ? summarize(mine) : s;

  return (
    <main className="stack-lg">
      <Countdown deadline={deadline} />
      {isDashboardLead && (
        <section className="panel">
          <h2>Countdown controls</h2>
          <p className="muted">
            Only the Dashboard Lead can set or change the shared deadline. Every change is logged.
          </p>
          <DeadlineForm current={deadline} />
        </section>
      )}

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
              hint={`${s.done} of ${s.total} items`}
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

      {kind === "member" && (
        <section className="panel">
          <h2>My work</h2>
          <ItemList rows={mine} empty="You have no assigned work yet." leadOf={leadOf} />
        </section>
      )}

      {kind !== "member" && (
        <>
          <section className="panel">
            <h2>{kind === "lead" ? "My teams' pipeline" : "Pipeline"}</h2>
            <StageBar counts={s.byStage} />
            <p className="muted">
              {s.done} of {s.total} items finished in Production.
            </p>
            <Meter percent={s.percent} label="Overall completion" />
          </section>

          <div className="grid">
            <section className="panel">
              <h2>By stage</h2>
              <ul className="counts">
                {STAGES.map((st) => (
                  <li key={st}>
                    <span>{STAGE_LABEL[st]}</span>
                    <strong>{s.byStage[st]}</strong>
                  </li>
                ))}
              </ul>
            </section>
            <section className="panel">
              <h2>By status</h2>
              <ul className="counts">
                {STATUSES.map((st) => (
                  <li key={st}>
                    <span>{STATUS_LABEL[st]}</span>
                    <strong>{s.byStatus[st]}</strong>
                  </li>
                ))}
              </ul>
            </section>
          </div>

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

          <div className="grid">
            <section className="panel">
              <h2>Awaiting review</h2>
              <ItemList
                rows={s.awaitingReview}
                empty="Nothing is waiting for review."
                leadOf={leadOf}
              />
            </section>
            <section className="panel">
              <h2>Blocked</h2>
              <ItemList rows={s.blocked} empty="Nothing is blocked." leadOf={leadOf} />
            </section>
            <section className="panel">
              <h2>Changes required</h2>
              <ItemList
                rows={s.changesRequired}
                empty="No changes are outstanding."
                leadOf={leadOf}
              />
            </section>
          </div>

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
            <ItemList rows={s.recent} empty="No activity yet." leadOf={leadOf} />
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
            <ul className="list">
              {inProduction.map((r) => (
                <li key={r.id}>
                  <Link href={`/processes/${r.processCode}`}>
                    <strong className="mono">{r.processCode}</strong> {r.title}
                  </Link>{" "}
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
