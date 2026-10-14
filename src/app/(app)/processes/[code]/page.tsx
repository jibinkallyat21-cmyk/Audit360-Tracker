import { notFound } from "next/navigation";
import { StepRecords } from "@/components/step-records";
import { StepLines, lineSummary } from "@/components/step-lines";
import { ItemActions } from "@/components/item-actions";
import { BuildBadge, DecisionBadge, FlowBadge, PageHero, StageTrack } from "@/components/ui";
import { toneForLead } from "@/lib/brand";
import { leadSetAssignment } from "@/app/(app)/actions";
import { ActionForm, SelectField } from "@/components/client";
import { getCapabilities, getOrg, listAssignments, listSubprocesses } from "@/lib/data";
import { PROCESS_DETAIL_SELECT } from "@/lib/queries";
import { getRecords } from "@/lib/records";
import { getPersona } from "@/lib/demo";
import { demoProcess } from "@/lib/demo-data";
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

  const demo = await getPersona();
  const { data: proc } = demo
    ? { data: demoProcess(code) }
    : await (
        await createClient()
      )
        .from("processes")
        .select(PROCESS_DETAIL_SELECT)
        .eq("id", rows[0].processId)
        .single();
  if (!proc) notFound();
  const records = await getRecords(rows.map((r) => r.id));
  const people = assignments.filter((a) => a.processId === rows[0].processId);
  // The process's Production Lead can add and remove team members and supporting roles.
  const isLead = caps.assignments.get(rows[0].processId)?.has("production_lead") ?? false;
  const org = isLead ? await getOrg() : null;
  const taken = new Set(people.map((p) => p.personId));
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
            const list = people.filter((p) => p.type === type);
            const editable = isLead && (type === "team_member" || type === "supporting_role");
            if (list.length === 0 && !editable) return null;
            return (
              <div key={type}>
                <dt>{label}</dt>
                <dd>
                  {editable ? (
                    <ul className="row-list">
                      {list.map((p) => (
                        <li key={p.personId}>
                          {p.personName}
                          <ActionForm
                            action={leadSetAssignment}
                            fields={{
                              process: rows[0].processId,
                              person: p.personId,
                              type,
                              assigned: "false",
                            }}
                            label="Remove"
                            quiet
                          />
                        </li>
                      ))}
                      {list.length === 0 && <li className="muted">None yet.</li>}
                    </ul>
                  ) : (
                    list.map((p) => p.personName).join(", ")
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
        {isLead && org && (
          <div className="stack">
            <h3>Add someone to this process</h3>
            <p className="muted">
              They join the whole process (all its steps) straight away and are notified. Reviewers
              and leads are set by the administrator.
            </p>
            <ActionForm
              action={leadSetAssignment}
              fields={{ process: rows[0].processId, assigned: "true" }}
              label="Add"
            >
              <SelectField
                name="person"
                label="Person"
                required
                options={[
                  { value: "", label: "Choose person…" },
                  ...org.people
                    .filter((p) => !taken.has(p.id))
                    .map((p) => ({ value: p.id, label: p.displayName })),
                ]}
              />
              <SelectField
                name="type"
                label="As"
                options={[
                  { value: "team_member", label: "Team member" },
                  { value: "supporting_role", label: "Supporting role" },
                ]}
              />
            </ActionForm>
          </div>
        )}
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
              <FlowBadge row={r} />{" "}
              {r.reviewDecision === "approved" && <DecisionBadge decision={r.reviewDecision} />}{" "}
              <BuildBadge status={r.dashboardStatus} />
            </p>
            {r.lines && r.lines.length > 0 && <p className="muted">{lineSummary(r.lines)}</p>}
            <ItemActions
              row={r}
              caps={caps}
              documents={records.documents
                .filter((d) => d.subprocess_id === r.id)
                .map((d) => ({ id: d.id, name: d.original_filename }))}
            />
            <StepLines row={r} caps={caps} records={records} />
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
