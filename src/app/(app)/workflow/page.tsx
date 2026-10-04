import { WorkflowExplorer } from "@/components/workflow-explorer";
import { listSubprocesses } from "@/lib/data";

export default async function WorkflowPage() {
  const rows = await listSubprocesses();
  return (
    <main className="stack-lg">
      <h1>Workflow</h1>
      <p className="muted">
        Phase → Process → Step, with the current stage and status. You see only your permitted
        scope.
      </p>
      <WorkflowExplorer rows={rows} />
    </main>
  );
}
