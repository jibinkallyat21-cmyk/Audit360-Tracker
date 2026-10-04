import { notFound } from "next/navigation";
import { StepRecords } from "@/components/step-records";
import { ItemActions } from "@/components/item-actions";
import { BuildBadge, DecisionBadge, PageHero, StageTrack, StatusBadge } from "@/components/ui";
import { toneForLead } from "@/lib/brand";
import { getCapabilities, listAssignments, listSubprocesses } from "@/lib/data";
import { PROCESS_DETAIL_SELECT } from "@/lib/queries";
import { getRecords } from "@/lib/records";
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
  const records = await getRecords(rows.map((r) => r.id));
  const people = assignments.filter((a) => a.processId === rows[0].processId);
  const leadName = people.find((p) => p.type === "production_lead")?.personName;
  const tone = `tone-${toneForLead(leadName)}`;
  const before: string[] = (proc.context as { before_ai_steps?: string[] })?.before_ai_steps ?? [];

  return (
    <main className="stack-lg">
      <PageHero eyebrow={`Phase · ${rows[0].phaseName}`} title={`${code} ${proc.title}`}>
        {proc.description ?? `Source: ${proc.source_reference}`}
      </PageHero>

      <section className={`panel team-card ${tone}`}>
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
          <article key={r.id} className={`panel team-card ${tone}`}>
            <h3>
              Step {r.seq}: {r.title}
            </h3>
            <StageTrack stage={r.stage} />
            <p>
              <StatusBadge status={r.status} /> <DecisionBadge decision={r.reviewDecision} />{" "}
              <BuildBadge status={r.dashboardStatus} />
            </p>
            <ItemActions
              row={r}
              caps={caps}
              documents={records.documents
                .filter((d) => d.subprocess_id === r.id)
                .map((d) => ({ id: d.id, name: d.original_filename }))}
            />
            <StepRecords row={r} caps={caps} records={records} people={assignments} />
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
