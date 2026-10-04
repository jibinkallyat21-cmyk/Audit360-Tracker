import type { Stage, Status, SubprocessRow } from "@/lib/domain";

const PHASES = ["Lead and proposal", "Engagement and advance", "Audit execution", "Review"];
const PROCESSES: [string, string, number, string][] = [
  ["1.1", "Lead Scoring & Proposal Generation", 0, "Pavithra"],
  ["1.2", "Signed Proposal & Basic Documents Collection", 0, "Pavithra"],
  ["2.1", "Engagement Letter (EL) Processing & Confirmation", 1, "Pavithra"],
  ["3.4", "Sampling, Vouching & External Confirmations", 2, "Pavithra"],
  [
    "3.5",
    "Substantive Procedures & KSA Schedules (EOSB / GOSI / Prepaid / Depreciation)",
    2,
    "Rustham",
  ],
  ["3.6", "IFRS FS Preparation (Uploading to Draftworx / 1Audit)", 2, "Rustham"],
  ["4.1", "Team Lead / Manager Review & Correction", 3, "Rustham"],
];
const MIX: [Stage, Status][] = [
  ["production", "completed"],
  ["production", "in_progress"],
  ["review", "in_progress"],
  ["testing", "blocked"],
  ["solution_building", "changes_required"],
  ["process_definition", "not_started"],
];

/** Sample items for the style guide only. Never used by the real pages. */
export function sampleRows(): {
  rows: SubprocessRow[];
  leadByProcess: Record<string, string>;
  peopleByProcess: Record<string, string[]>;
} {
  const rows: SubprocessRow[] = [];
  const leadByProcess: Record<string, string> = {};
  const peopleByProcess: Record<string, string[]> = {};
  PROCESSES.forEach(([code, title, phase, lead], pi) => {
    leadByProcess[code] = lead;
    peopleByProcess[code] = [lead, pi % 2 ? "Rijin" : "Anna", "Fayis"];
    for (let seq = 1; seq <= 3; seq++) {
      const [stage, status] = MIX[(pi + seq * 2) % MIX.length];
      rows.push({
        id: `${code}-${seq}`,
        seq,
        title: `Sample step ${seq} for ${title.split(" ")[0]} ${title.split(" ")[1] ?? ""}`,
        stage,
        status,
        reviewDecision: stage === "review" ? "pending_review" : null,
        dashboardStatus: stage === "production" ? "not_started" : null,
        updatedAt: "2030-01-01T00:00:00Z",
        processId: code,
        processCode: code,
        processTitle: title,
        phaseName: PHASES[phase],
        phaseOrder: phase + 1,
      });
    }
  });
  return { rows, leadByProcess, peopleByProcess };
}

const DAY = 86_400_000;

/** One deadline inside the "urgent" last week and one comfortably far away. */
export function sampleDeadlines() {
  const now = Date.now();
  return {
    soon: new Date(now + 4 * DAY + 5 * 3_600_000).toISOString(),
    later: new Date(now + 40 * DAY).toISOString(),
  };
}
