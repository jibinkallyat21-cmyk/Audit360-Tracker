import { ActionForm, SelectField } from "@/components/client";
import { EmptyState, PageHero } from "@/components/ui";
import { getOrg } from "@/lib/data";
import { requireApprovedViewer } from "@/lib/access";
import { suggestPersons } from "@/lib/matching";
import { getPersona } from "@/lib/demo";
import { demoProfiles } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";
import { approveUser, rejectUser, setUserActive } from "./actions";

interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  person_id: string | null;
  approval_state: "pending" | "approved" | "rejected" | "deactivated";
  is_active: boolean;
  created_at: string;
}

const day = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(iso));

export default async function AdminUsersPage() {
  const me = await requireApprovedViewer();
  const demo = await getPersona();
  const [org, profiles] = await Promise.all([
    getOrg(),
    demo
      ? Promise.resolve({ data: demoProfiles() as Profile[], error: null })
      : (await createClient())
          .from("profiles")
          .select("id, email, full_name, person_id, approval_state, is_active, created_at")
          .order("created_at", { ascending: false })
          .returns<Profile[]>(),
  ]);
  const { data, error } = profiles;
  if (error || !data) throw new Error("Could not load accounts.");
  const linked = new Set(data.map((p) => p.person_id).filter(Boolean));
  const people = org.people.map((p) => ({ ...p, linked: linked.has(p.id) }));
  const nameOf = new Map(org.people.map((p) => [p.id, p.displayName]));
  const pending = data.filter((p) => p.approval_state === "pending");
  const rejected = data.filter((p) => p.approval_state === "rejected");
  const members = data.filter(
    (p) => p.approval_state === "approved" || p.approval_state === "deactivated",
  );
  const options = [
    { value: "", label: "Choose person…" },
    ...org.people.map((p) => ({
      value: p.id,
      label: p.displayName + (linked.has(p.id) ? " (linked)" : ""),
    })),
  ];

  return (
    <main className="stack-lg">
      <PageHero eyebrow="Admin" title="Users" />

      <section className="panel">
        <h2>Waiting for approval ({pending.length})</h2>
        <p className="muted">
          Accounts see no project data until approved. Approving links the account to a person, who
          then inherits that person&apos;s assignments. Suggestions come from the email name; you
          always confirm.
        </p>
        {pending.length === 0 && <EmptyState>No one is waiting.</EmptyState>}
        <ul className="list">
          {pending.map((u) => {
            const m = suggestPersons(u.email, u.full_name, people);
            return (
              <li key={u.id} className="rp">
                <p>
                  <strong>{u.full_name ?? "(no name)"}</strong> · {u.email} ·{" "}
                  <span className="muted">registered {day(u.created_at)}</span>
                </p>
                <p className="muted" role="note">
                  {m.status === "single" && m.suggested && (
                    <>
                      Suggested: {m.suggested.displayName} ({m.candidates[0].confidence} match).
                      Please confirm.
                    </>
                  )}
                  {m.status === "ambiguous" && (
                    <>
                      Needs confirmation. Similar names:{" "}
                      {m.candidates.map((c) => c.person.displayName).join(", ")}.
                    </>
                  )}
                  {m.status === "none" && <>No matching name found. Choose the person manually.</>}
                </p>
                <div className="actions">
                  <ActionForm action={approveUser} fields={{ user: u.id }} label="Approve">
                    <SelectField
                      name="person"
                      label="Person"
                      options={options}
                      value={m.suggested?.id ?? ""}
                      required
                    />
                  </ActionForm>
                  <ActionForm action={rejectUser} fields={{ user: u.id }} label="Reject" />
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="panel">
        <h2>Accounts ({members.length})</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Person</th>
              <th>State</th>
              <th>
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((u) => (
              <tr key={u.id}>
                <td>{u.full_name ?? "—"}</td>
                <td>{u.email}</td>
                <td>{u.person_id ? nameOf.get(u.person_id) : "—"}</td>
                <td>{u.approval_state === "approved" ? "Active" : "Deactivated"}</td>
                <td>
                  {u.id === me.id ? (
                    <span className="muted">You</span>
                  ) : (
                    <ActionForm
                      action={setUserActive}
                      fields={{
                        user: u.id,
                        active: u.approval_state === "approved" ? "false" : "true",
                      }}
                      label={u.approval_state === "approved" ? "Deactivate" : "Reactivate"}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {rejected.length > 0 && (
        <section className="panel">
          <h2>Rejected ({rejected.length})</h2>
          <ul className="list">
            {rejected.map((u) => (
              <li key={u.id}>
                {u.full_name ?? u.email} · <span className="muted">{u.email}</span>
                <ActionForm action={approveUser} fields={{ user: u.id }} label="Approve instead">
                  <SelectField name="person" label="Person" options={options} required />
                </ActionForm>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
