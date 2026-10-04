import { notFound } from "next/navigation";
import { Countdown } from "@/components/client";
import { NavLinks } from "@/components/nav";
import { TeamChart } from "@/components/team-chart";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  BuildBadge,
  DecisionBadge,
  EmptyState,
  Meter,
  PageHero,
  Pips,
  StageBadge,
  StageBar,
  StageTrack,
  StatCard,
  StatusBadge,
} from "@/components/ui";
import { WorkflowExplorer } from "@/components/workflow-explorer";
import { BRAND } from "@/lib/brand";
import { STAGES, STATUSES } from "@/lib/domain";
import { sampleDeadlines, sampleRows } from "./sample";

/** Visual check of the design with sample data. Hidden unless ENABLE_STYLEGUIDE=1. */
export default function StyleGuide() {
  if (process.env.ENABLE_STYLEGUIDE !== "1") notFound();
  const { rows, leadByProcess, peopleByProcess } = sampleRows();
  const counts = Object.fromEntries(
    STAGES.map((s) => [s, rows.filter((r) => r.stage === s).length]),
  ) as Record<(typeof STAGES)[number], number>;
  const { soon, later } = sampleDeadlines();
  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">
          <strong>
            {BRAND.company} <em>{BRAND.product}</em>
          </strong>
          <small>{BRAND.tagline}</small>
        </span>
        <NavLinks
          items={[
            { href: "/styleguide", label: "Dashboard" },
            { href: "/workflow", label: "Workflow" },
            { href: "/documents", label: "Documents" },
            { href: "/team", label: "Team" },
          ]}
        />
        <span className="spacer" />
        <ThemeToggle />
        <span className="who">Jibin K K</span>
        <button type="button" className="secondary">
          Sign out
        </button>
      </header>
      <div className="content stack-lg">
        <PageHero eyebrow="Style guide" title="Where the work stands">
          Sample data only. This page is hidden in production.
        </PageHero>

        <div className="stats">
          <StatCard label="Complete" value="34%" hint="26 of 74 items" />
          <StatCard label="Items" value={74} hint="20 processes" />
          <StatCard label="Awaiting review" value={6} />
          <StatCard label="Blocked" value={3} warn />
        </div>

        <div className="grid">
          <Countdown deadline={soon} />
          <Countdown deadline={later} />
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

        <WorkflowExplorer
          rows={rows}
          mineProcessIds={["1.1"]}
          leadByProcess={leadByProcess}
          peopleByProcess={peopleByProcess}
        />

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
    </div>
  );
}
