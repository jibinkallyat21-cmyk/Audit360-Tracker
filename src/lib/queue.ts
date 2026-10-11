import type { LineRow, SubprocessRow } from "./domain";
import { canReview, type Capabilities } from "./permissions";

export interface QueueItem {
  key: string;
  code: string;
  processTitle: string;
  step: number;
  /** Set when the item is one line of a step. */
  line?: string;
  /** When it started waiting (ISO), oldest first. */
  since: string;
}

export interface QueueSection {
  key: "review" | "returned" | "production" | "blocked" | "quiet";
  title: string;
  hint: string;
  items: QueueItem[];
}

/** A step or line with no activity for this many days counts as quiet. */
export const QUIET_DAYS = 5;

const item = (r: SubprocessRow, since: string, l?: LineRow): QueueItem => ({
  key: l ? `${r.id}:${l.id}` : r.id,
  code: r.processCode,
  processTitle: r.processTitle,
  step: r.seq,
  line: l?.title,
  since,
});

const oldestFirst = (a: QueueItem, b: QueueItem) => a.since.localeCompare(b.since);

/**
 * What needs this person now, from the steps and lines they can see and their role on each.
 * Reviewers see what waits for their decision; Production Leads see what came back, what is
 * blocked and what has gone quiet; the Project Lead sees approved steps ready for Production.
 */
export function buildQueue(
  rows: SubprocessRow[],
  caps: Capabilities,
  now = new Date(),
): QueueSection[] {
  const review: QueueItem[] = [];
  const returned: QueueItem[] = [];
  const production: QueueItem[] = [];
  const blocked: QueueItem[] = [];
  const quiet: QueueItem[] = [];
  const quietBefore = new Date(now.getTime() - QUIET_DAYS * 86_400_000).toISOString();

  for (const r of rows) {
    const types = caps.assignments.get(r.processId);
    const lead = types?.has("production_lead") ?? false;
    const lines = r.lines ?? [];
    const reviewer = canReview(caps, r.processId);

    if (lines.length > 0 && r.stage !== "production") {
      for (const l of lines) {
        const since = l.updatedAt ?? r.updatedAt;
        if (l.status === "in_review" && reviewer) review.push(item(r, since, l));
        if (lead && l.status === "changes_required") returned.push(item(r, since, l));
        if (lead && l.status === "blocked") blocked.push(item(r, since, l));
        if (lead && l.status === "in_progress" && since < quietBefore)
          quiet.push(item(r, since, l));
      }
    } else {
      if (r.stage === "review" && r.reviewDecision === "pending_review" && reviewer) {
        review.push(item(r, r.updatedAt));
      }
      if (lead && r.status === "changes_required") returned.push(item(r, r.updatedAt));
      if (lead && r.status === "blocked" && r.stage !== "production")
        blocked.push(item(r, r.updatedAt));
      if (
        lead &&
        r.status === "in_progress" &&
        r.stage !== "production" &&
        r.updatedAt < quietBefore
      ) {
        quiet.push(item(r, r.updatedAt));
      }
    }
    if (
      caps.roles.has("project_lead") &&
      r.stage === "review" &&
      r.reviewDecision === "approved" &&
      lines.length === 0
    ) {
      production.push(item(r, r.updatedAt));
    }
  }

  const sections: QueueSection[] = [
    {
      key: "review",
      title: "Waiting for your review",
      hint: "Oldest first. Open the process to approve or ask for changes.",
      items: review.sort(oldestFirst),
    },
    {
      key: "returned",
      title: "Sent back to you",
      hint: "A reviewer asked for changes. Fix it, then send it to review again.",
      items: returned.sort(oldestFirst),
    },
    {
      key: "production",
      title: "Approved, ready for Production",
      hint: "Reviewers approved these. Move them to Production.",
      items: production.sort(oldestFirst),
    },
    {
      key: "blocked",
      title: "Blocked",
      hint: "Marked Blocked. Clear the blocker or say what is needed.",
      items: blocked.sort(oldestFirst),
    },
    {
      key: "quiet",
      title: `No activity for ${QUIET_DAYS}+ days`,
      hint: "In progress but nothing has changed. Update the status or send it on.",
      items: quiet.sort(oldestFirst),
    },
  ];
  return sections.filter((s) => s.items.length > 0);
}

/** Items that need action now (everything except quiet reminders). */
export const queueCount = (sections: QueueSection[]) =>
  sections.filter((s) => s.key !== "quiet").reduce((n, s) => n + s.items.length, 0);
