import { TeamChart, type PersonProcess } from "@/components/team-chart";
import { getCapabilities, getOrg, listAssignments, listSubprocesses } from "@/lib/data";

export default async function TeamPage() {
  const [org, assignments, rows, caps] = await Promise.all([
    getOrg(),
    listAssignments(),
    listSubprocesses(),
    getCapabilities(),
  ]);
  const titles = new Map(
    rows.map((r) => [r.processId, { code: r.processCode, title: r.processTitle }]),
  );
  // Assignments arrive already limited by access rules, so this only lists visible processes.
  const byPerson: Record<string, PersonProcess[]> = {};
  for (const a of assignments) {
    const proc = titles.get(a.processId);
    if (!proc) continue;
    const list = (byPerson[a.personId] ??= []);
    const existing = list.find((p) => p.code === proc.code);
    if (existing) existing.types.push(a.type);
    else list.push({ code: proc.code, title: proc.title, types: [a.type] });
  }
  for (const list of Object.values(byPerson)) {
    list.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  }
  const fullView = ["project_lead", "project_head", "system_admin"].some((r) =>
    caps.roles.has(r as "project_lead"),
  );

  return (
    <main className="stack-lg">
      <h1>Team structure</h1>
      <p className="muted">Select a person to see their role and the processes they work on.</p>
      <TeamChart
        people={org.people.map((p) => ({
          id: p.id,
          name: p.displayName,
          tags: [...(org.roleTags.get(p.id) ?? [])],
        }))}
        teams={org.teams.map((t) => ({
          id: t.id,
          name: t.name,
          leadId: t.leadPersonId,
          memberIds: t.memberIds,
        }))}
        processesByPerson={byPerson}
        fullView={fullView}
      />
    </main>
  );
}
