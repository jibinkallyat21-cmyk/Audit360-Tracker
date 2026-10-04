import { WorkflowExplorer } from "@/components/workflow-explorer";
import { getCapabilities, listSubprocesses } from "@/lib/data";

export default async function WorkflowPage() {
  const [rows, caps] = await Promise.all([listSubprocesses(), getCapabilities()]);
  return (
    <main className="stack-lg">
      <h1>Workflow</h1>
      <p className="muted">
        Phase → Process → Step, with the current stage and status. You see only your permitted
        scope.
      </p>
      <WorkflowExplorer rows={rows} mineProcessIds={[...caps.assignments.keys()]} />
    </main>
  );
}
