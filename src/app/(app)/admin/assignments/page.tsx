import { ActionForm, SelectField } from "@/components/client";
import { EmptyState, PageHero } from "@/components/ui";
import { getOrg, listAssignments, listSubprocesses } from "@/lib/data";
import type { AssignmentType } from "@/lib/domain";
import { setAssignment } from "../actions";

const TYPES: [AssignmentType, string][] = [
  ["production_lead", "Production Lead"],
  ["team_member", "Team member"],
  ["reviewer", "Reviewer"],
  ["supporting_role", "Supporting role"],
];

export default async function AssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ process?: string }>;
}) {
  const { process: code } = await searchParams;
  const [rows, assignments, org] = await Promise.all([
    listSubprocesses(),
    listAssignments(),
    getOrg(),
  ]);
  const processes = [...new Map(rows.map((r) => [r.processCode, r])).values()];
  const chosen = processes.find((p) => p.processCode === code) ?? processes[0];
  const here = chosen ? assignments.filter((a) => a.processId === chosen.processId) : [];

  return (
    <main className="stack-lg">
      <PageHero eyebrow="Admin" title="Assignments">
        Changes take effect immediately and are logged. Removing someone&apos;s last assignment on a
        process also clears their notifications for it. A process can have only one Production Lead;
        remove the current one before adding another.
      </PageHero>
      <form method="get" className="filters">
        <label>
          <span>Process</span>
          <select name="process" defaultValue={chosen?.processCode}>
            {processes.map((p) => (
              <option key={p.processId} value={p.processCode}>
                {p.processCode} {p.processTitle}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Show</button>
      </form>

      {chosen && (
        <>
          <section className="panel">
            <h2>
              {chosen.processCode} {chosen.processTitle}
            </h2>
            {TYPES.map(([type, label]) => {
              const list = here.filter((a) => a.type === type);
              return (
                <div key={type} className="process-block">
                  <h3>{label}</h3>
                  {list.length === 0 ? (
                    <EmptyState>None.</EmptyState>
                  ) : (
                    <ul className="row-list">
                      {list.map((a) => (
                        <li key={a.personId}>
                          {a.personName}
                          <ActionForm
                            action={setAssignment}
                            fields={{
                              process: chosen.processId,
                              person: a.personId,
                              type,
                              assigned: "false",
                            }}
                            label="Remove"
                            quiet
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </section>
          <section className="panel">
            <h2>Add an assignment</h2>
            <ActionForm
              action={setAssignment}
              fields={{ process: chosen.processId, assigned: "true" }}
              label="Add"
            >
              <SelectField
                name="person"
                label="Person"
                required
                options={[
                  { value: "", label: "Choose person…" },
                  ...org.people.map((p) => ({ value: p.id, label: p.displayName })),
                ]}
              />
              <SelectField
                name="type"
                label="Assignment type"
                options={TYPES.map(([v, l]) => ({ value: v, label: l }))}
              />
            </ActionForm>
          </section>
        </>
      )}
    </main>
  );
}
