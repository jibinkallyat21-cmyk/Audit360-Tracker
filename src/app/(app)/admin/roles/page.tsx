import { ActionForm, SelectField } from "@/components/client";
import { EmptyState, PageHero } from "@/components/ui";
import { requireApprovedViewer } from "@/lib/access";
import { getOrg } from "@/lib/data";
import type { RoleName } from "@/lib/domain";
import { setPersonRole } from "../actions";

const GLOBAL: [RoleName, string][] = [
  ["project_head", "Project Head"],
  ["project_lead", "Project Lead"],
  ["dashboard_lead", "Dashboard Lead"],
  ["system_admin", "System Administrator"],
];

export default async function RolesPage() {
  const [me, org] = await Promise.all([requireApprovedViewer(), getOrg()]);
  const holders = org.people.flatMap((p) =>
    GLOBAL.filter(([r]) => org.roleTags.get(p.id)?.has(r)).map(([r, label]) => ({
      person: p,
      role: r,
      label,
    })),
  );
  return (
    <main className="stack-lg">
      <PageHero eyebrow="Admin" title="Roles">
        These roles belong to a person, so they apply as soon as that person&apos;s account is
        approved. Production Lead, Team Member, Reviewer and Supporting roles come from process
        assignments. Every change is logged.
      </PageHero>
      <section className="panel">
        <h2>Current holders</h2>
        {holders.length === 0 && <EmptyState>No roles assigned.</EmptyState>}
        <ul className="list">
          {holders.map(({ person, role, label }) => (
            <li key={person.id + role}>
              <strong>{label}</strong>: {person.displayName}
              {role === "system_admin" && me.personId === person.id ? (
                <span className="muted"> (you; cannot be removed by yourself)</span>
              ) : (
                <ActionForm
                  action={setPersonRole}
                  fields={{ person: person.id, role, granted: "false" }}
                  label="Remove"
                />
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="panel">
        <h2>Grant a role</h2>
        {GLOBAL.length > 0 && (
          <ActionForm action={setPersonRole} fields={{ granted: "true" }} label="Grant role">
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
              name="role"
              label="Role"
              options={GLOBAL.map(([v, l]) => ({ value: v, label: l }))}
            />
          </ActionForm>
        )}
      </section>
    </main>
  );
}
