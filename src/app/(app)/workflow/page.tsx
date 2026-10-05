import { PageHero } from "@/components/ui";
import { WorkflowExplorer } from "@/components/workflow-explorer";
import { getCapabilities, listAssignments, listSubprocesses } from "@/lib/data";

export default async function WorkflowPage() {
  const [rows, assignments, caps] = await Promise.all([
    listSubprocesses(),
    listAssignments(),
    getCapabilities(),
  ]);
  // Both maps come from assignments the database already limited to what this user may see.
  const leadByProcess: Record<string, string> = {};
  const teamByProcess: Record<string, string[]> = {};
  for (const a of assignments) {
    if (a.type === "production_lead") leadByProcess[a.processId] = a.personName;
    if (a.type === "team_member") (teamByProcess[a.processId] ??= []).push(a.personName);
  }
  return (
    <main className="stack-lg">
      <PageHero eyebrow="Workflow" title="Process flow">
        Phases, and the processes inside them, with the current status. You see only your permitted
        scope.
      </PageHero>
      <WorkflowExplorer
        rows={rows}
        mineProcessIds={[...caps.assignments.keys()]}
        leadByProcess={leadByProcess}
        teamByProcess={teamByProcess}
      />
    </main>
  );
}
