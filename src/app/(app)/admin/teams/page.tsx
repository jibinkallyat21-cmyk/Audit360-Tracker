import { ActionForm, SelectField } from "@/components/client";
import { EmptyState, PageHero } from "@/components/ui";
import { getOrg } from "@/lib/data";
import { setTeamMember } from "../actions";

export default async function TeamsPage() {
  const org = await getOrg();
  const name = new Map(org.people.map((p) => [p.id, p.displayName]));
  return (
    <main className="stack-lg">
      <PageHero eyebrow="Admin" title="Teams">
        Team membership feeds the team structure page. Who works on which process is set under
        Assignments.
      </PageHero>
      {org.teams.length === 0 && <EmptyState>No teams.</EmptyState>}
      {org.teams.map((t) => (
        <section key={t.id} className="panel">
          <h2>{t.name}</h2>
          <p className="muted">Production Lead: {name.get(t.leadPersonId)}</p>
          <ul className="list">
            {t.memberIds
              .map((id) => [id, name.get(id) ?? ""] as const)
              .sort((a, b) => a[1].localeCompare(b[1]))
              .map(([id, n]) => (
                <li key={id}>
                  {n}
                  <ActionForm
                    action={setTeamMember}
                    fields={{ team: t.id, person: id, member: "false" }}
                    label="Remove"
                  />
                </li>
              ))}
          </ul>
          <ActionForm
            action={setTeamMember}
            fields={{ team: t.id, member: "true" }}
            label="Add member"
          >
            <SelectField
              name="person"
              label="Person"
              required
              options={[
                { value: "", label: "Choose person…" },
                ...org.people
                  .filter((p) => !t.memberIds.includes(p.id))
                  .map((p) => ({ value: p.id, label: p.displayName })),
              ]}
            />
          </ActionForm>
        </section>
      ))}
    </main>
  );
}
