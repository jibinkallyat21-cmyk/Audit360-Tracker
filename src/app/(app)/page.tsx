import Link from "next/link";
import { Countdown } from "@/components/client";
import { DeadlineForm } from "@/components/deadline-form";
import { ItemActions } from "@/components/item-actions";
import { BuildBadge, EmptyState, Meter, StageBadge, StatusBadge } from "@/components/ui";
import { getCapabilities, getDeadline, listAssignments, listSubprocesses } from "@/lib/data";
import { STAGES, STAGE_LABEL, STATUSES, STATUS_LABEL, type SubprocessRow } from "@/lib/domain";
import { canSetDeadline, dashboardKind } from "@/lib/permissions";
import { byLead, byPhase, rollupProcesses, summarize, type GroupProgress } from "@/lib/progress";

function ItemList({ rows, empty }: { rows: SubprocessRow[]; empty: string }) {
  if (rows.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <ul className="list">
      {rows.map((r) => (
        <li key={r.id}>
          <Link href={`/processes/${r.processCode}`}>
            <strong>{r.processCode}</strong> {r.processTitle}
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
            <span className="muted">
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

  return (
    <main className="stack-lg">
      <h1>Dashboard</h1>

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

      {kind === "member" && (
        <section className="panel">
          <h2>My work</h2>
          <ItemList rows={mine} empty="You have no assigned work yet." />
        </section>
      )}

      {kind !== "member" && (
        <>
          <section className="panel">
            <h2>{kind === "lead" ? "My teams' progress" : "Overall progress"}</h2>
            <p className="big">{s.percent}%</p>
            <p className="muted">
              {s.done} of {s.total} items finished in Production
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
              <ItemList rows={s.awaitingReview} empty="Nothing is waiting for review." />
            </section>
            <section className="panel">
              <h2>Blocked</h2>
              <ItemList rows={s.blocked} empty="Nothing is blocked." />
            </section>
            <section className="panel">
              <h2>Changes required</h2>
              <ItemList rows={s.changesRequired} empty="No changes are outstanding." />
            </section>
          </div>

          {kind === "management" && (
            <section className="panel">
              <h2>Processes</h2>
              <p className="muted">
                Titles and progress only. Documents, comments and review details are not shown here.
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Process</th>
                    <th>Phase</th>
                    <th>Furthest back</th>
                    <th>Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {rollupProcesses(rows).map((p) => (
                    <tr key={p.processId}>
                      <td>
                        <strong>{p.code}</strong> {p.title}
                      </td>
                      <td>{p.phaseName}</td>
                      <td>
                        <StageBadge stage={p.stage} />
                        {p.blocked > 0 && <span className="muted"> · {p.blocked} blocked</span>}
                      </td>
                      <td>
                        {p.done}/{p.total}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section className="panel">
            <h2>Recently updated</h2>
            <ItemList rows={s.recent} empty="No activity yet." />
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
                    <strong>{r.processCode}</strong> {r.title}
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
