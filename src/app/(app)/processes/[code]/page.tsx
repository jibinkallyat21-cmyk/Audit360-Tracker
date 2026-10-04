import { notFound } from "next/navigation";
import { ItemActions } from "@/components/item-actions";
import { BuildBadge, DecisionBadge, StageTrack, StatusBadge } from "@/components/ui";
import { getCapabilities, listAssignments, listSubprocesses } from "@/lib/data";
import { PROCESS_DETAIL_SELECT } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import type { AssignmentType } from "@/lib/domain";

const GROUPS: [AssignmentType, string][] = [
  ["production_lead", "Production Lead"],
  ["team_member", "Team"],
  ["reviewer", "Reviewers"],
  ["supporting_role", "Supporting roles"],
];

export default async function ProcessPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [all, assignments, caps] = await Promise.all([
    listSubprocesses(),
    listAssignments(),
    getCapabilities(),
  ]);
  // Missing and forbidden look identical, so process codes cannot be probed.
  const rows = all.filter((r) => r.processCode === code);
  if (rows.length === 0) notFound();

  const supabase = await createClient();
  const { data: proc } = await supabase
    .from("processes")
    .select(PROCESS_DETAIL_SELECT)
    .eq("id", rows[0].processId)
    .single();
  if (!proc) notFound();
  const people = assignments.filter((a) => a.processId === rows[0].processId);
  const before: string[] = (proc.context as { before_ai_steps?: string[] })?.before_ai_steps ?? [];

  return (
    <main className="stack-lg">
      <div>
        <p className="muted">{rows[0].phaseName}</p>
        <h1>
          {code} {proc.title}
        </h1>
        {proc.description && <p>{proc.description}</p>}
        <p className="muted">Source: {proc.source_reference}</p>
      </div>

      <section className="panel">
        <h2>People</h2>
        <dl className="people">
          {GROUPS.map(([type, label]) => {
            const names = people.filter((p) => p.type === type).map((p) => p.personName);
            return names.length === 0 ? null : (
              <div key={type}>
                <dt>{label}</dt>
                <dd>{names.join(", ")}</dd>
              </div>
            );
          })}
        </dl>
      </section>

      <section className="stack-lg">
        <h2>Steps</h2>
        {rows.map((r) => (
          <article key={r.id} className="panel">
            <h3>
              Step {r.seq}: {r.title}
            </h3>
            <StageTrack stage={r.stage} />
            <p>
              <StatusBadge status={r.status} /> <DecisionBadge decision={r.reviewDecision} />{" "}
              <BuildBadge status={r.dashboardStatus} />
            </p>
            <ItemActions row={r} caps={caps} />
          </article>
        ))}
      </section>

      {before.length > 0 && (
        <details className="panel">
          <summary>Requirement context: current process before AI</summary>
          <ol>
            {before.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ol>
          <p className="muted">Reference only. This is not a status.</p>
        </details>
      )}
    </main>
  );
}
