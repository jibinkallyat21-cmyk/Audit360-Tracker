import { describe, expect, it } from "vitest";
import type { SubprocessRow } from "./domain";
import type { Capabilities } from "./permissions";
import { buildQueue, queueCount } from "./queue";

const row = (o: Partial<SubprocessRow> & { id: string }): SubprocessRow => ({
  seq: 1,
  title: "t",
  stage: "solution_building",
  status: "not_started",
  reviewDecision: null,
  dashboardStatus: null,
  updatedAt: "2026-01-10T00:00:00Z",
  processId: "p1",
  processCode: "3.5",
  processTitle: "Substantive",
  phaseName: "Audit execution",
  phaseOrder: 3,
  ...o,
});
const caps = (types: string[], roles: string[] = []): Capabilities => ({
  roles: new Set(roles) as Capabilities["roles"],
  assignments: new Map([["p1", new Set(types)]]) as Capabilities["assignments"],
});
const now = new Date("2026-01-20T00:00:00Z");

describe("buildQueue", () => {
  const lines = (a: string, b: string) => [
    { id: "l1", seq: 1, title: "EOSB", status: a as never, updatedAt: "2026-01-12T00:00:00Z" },
    { id: "l2", seq: 2, title: "GOSI", status: b as never, updatedAt: "2026-01-11T00:00:00Z" },
  ];

  it("shows a reviewer the lines in review, oldest first, and nothing else", () => {
    const q = buildQueue(
      [row({ id: "s1", lines: lines("in_review", "in_review") })],
      caps(["reviewer"]),
      now,
    );
    expect(q.map((s) => s.key)).toEqual(["review"]);
    expect(q[0].items.map((i) => i.line)).toEqual(["GOSI", "EOSB"]);
  });

  it("does not show a conflicted reviewer their own work", () => {
    const q = buildQueue(
      [row({ id: "s1", lines: lines("in_review", "not_started") })],
      caps(["reviewer", "team_member"]),
      now,
    );
    expect(q).toEqual([]);
  });

  it("shows a Production Lead returned, blocked and quiet items", () => {
    const q = buildQueue(
      [
        row({ id: "s1", lines: lines("changes_required", "blocked") }),
        row({ id: "s2", processId: "p1", status: "in_progress" }),
      ],
      caps(["production_lead"]),
      now,
    );
    expect(q.map((s) => s.key)).toEqual(["returned", "blocked", "quiet"]);
    expect(queueCount(q)).toBe(2);
  });

  it("works for steps without lines", () => {
    const q = buildQueue(
      [row({ id: "s1", stage: "review", status: "in_progress", reviewDecision: "pending_review" })],
      caps(["reviewer"]),
      now,
    );
    expect(q[0].items[0].line).toBeUndefined();
    expect(q[0].key).toBe("review");
  });

  it("tells the Project Lead which approved steps are ready for Production", () => {
    const q = buildQueue(
      [row({ id: "s1", stage: "review", reviewDecision: "approved" })],
      caps([], ["project_lead"]),
      now,
    );
    expect(q.map((s) => s.key)).toEqual(["production"]);
  });
});
