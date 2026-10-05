import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Countdown } from "@/components/client";
import { TeamChart } from "@/components/team-chart";
import {
  BuildBadge,
  DecisionBadge,
  EmptyState,
  Meter,
  Pips,
  StageBadge,
  StageBar,
  StageTrack,
  StatCard,
  StatusBadge,
} from "@/components/ui";
import { WorkflowExplorer } from "@/components/workflow-explorer";
import { STAGES, STATUSES } from "@/lib/domain";
import { sampleDeadlines, sampleRows } from "./sample";

/** Visual check of the design with sample data. Hidden unless ENABLE_STYLEGUIDE=1. */
export default function StyleGuide() {
  if (process.env.ENABLE_STYLEGUIDE !== "1") notFound();
  const { rows, leadByProcess } = sampleRows();
  const counts = Object.fromEntries(
    STAGES.map((s) => [s, rows.filter((r) => r.stage === s).length]),
  ) as Record<(typeof STAGES)[number], number>;
  const { soon, later } = sampleDeadlines();
  return (
    <AppShell
      items={[
        { href: "/styleguide", label: "Dashboard" },
        { href: "/workflow", label: "Workflow" },
        { href: "/documents", label: "Documents" },
        { href: "/team", label: "Team" },
      ]}
      unread={3}
      userLabel="Jibin K K"
    >
      <div className="stack-lg">
        <div className="grid">
          <Countdown deadline={soon} />
          <Countdown deadline={later} />
        </div>

        <div className="stats">
          <StatCard label="Complete" value="34%" hint="26 of 74 items" />
          <StatCard label="Items" value={74} hint="20 processes" />
          <StatCard label="Awaiting review" value={6} />
          <StatCard label="Blocked" value={3} warn />
        </div>

        <section className="panel">
          <h2>Pipeline</h2>
          <StageBar counts={counts} />
          <Meter percent={34} label="Overall completion" />
        </section>

        <section className="panel">
          <h2>Badges, stages and buttons</h2>
          <p>
            {STATUSES.map((s) => (
              <span key={s}>
                <StatusBadge status={s} />{" "}
              </span>
            ))}
            <DecisionBadge decision="approved" /> <BuildBadge status="under_construction" />{" "}
            <StageBadge stage="testing" /> <Pips stage="review" />
          </p>
          <StageTrack stage="testing" />
          <div className="inline-form">
            <button type="button">Primary action</button>
            <button type="button" className="secondary">
              Secondary
            </button>
            <input placeholder="Text input" aria-label="Sample input" />
            <select aria-label="Sample select">
              <option>Select</option>
            </select>
          </div>
          <EmptyState>An empty state looks like this.</EmptyState>
        </section>

        <WorkflowExplorer rows={rows} mineProcessIds={["1.1"]} leadByProcess={leadByProcess} />

        <TeamChart
          people={[
            { id: "h", name: "Shon J Iype", tags: ["project_head"] },
            { id: "l", name: "Shon Domnic", tags: ["project_lead"] },
            { id: "d", name: "Jibin K K", tags: ["dashboard_lead", "system_admin"] },
            { id: "p", name: "Pavithra", tags: ["production_lead"] },
            { id: "r", name: "Rustham", tags: ["production_lead"] },
            { id: "a", name: "Rijin", tags: [] },
            { id: "b", name: "Anna", tags: [] },
            { id: "c", name: "Ajay", tags: [] },
            { id: "f", name: "Fayis", tags: ["reviewer"] },
            { id: "j", name: "Jismy", tags: ["reviewer"] },
          ]}
          teams={[
            { id: "t1", name: "Team Pavithra", leadId: "p", memberIds: ["a", "b"] },
            { id: "t2", name: "Team Rustham", leadId: "r", memberIds: ["c"] },
          ]}
          processesByPerson={{
            p: [
              {
                code: "1.1",
                title: "Lead Scoring & Proposal Generation",
                types: ["production_lead"],
              },
            ],
          }}
          fullView
        />
      </div>
    </AppShell>
  );
}
