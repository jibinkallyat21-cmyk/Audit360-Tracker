import { describe, expect, it } from "vitest";
import { remaining, zonedToUtcIso } from "./countdown";
import type { AssignmentRow, AssignmentType, RoleName, SubprocessRow } from "./domain";
import {
  canComment,
  canRaiseReviewPoint,
  canRecordDecision,
  canReview,
  canUpload,
  reviewPointActions,
  canCompleteStage,
  canRecordTesting,
  canSetDashboardStatus,
  canSetDeadline,
  canSetStatus,
  dashboardKind,
  type Capabilities,
} from "./permissions";
import { byLead, byPhase, rollupProcesses, summarize } from "./progress";

const row = (o: Partial<SubprocessRow>): SubprocessRow => ({
  id: "s",
  seq: 1,
  title: "t",
  stage: "process_definition",
  status: "not_started",
  reviewDecision: null,
  dashboardStatus: null,
  updatedAt: "2030-01-01T00:00:00Z",
  processId: "p1",
  processCode: "1.1",
  processTitle: "P",
  phaseName: "A",
  phaseOrder: 1,
  ...o,
});

const caps = (roles: RoleName[], a: Record<string, AssignmentType[]> = {}): Capabilities => ({
  roles: new Set(roles),
  assignments: new Map(Object.entries(a).map(([k, v]) => [k, new Set(v)])),
});

describe("summarize", () => {
  it("counts stages, statuses and completion only for finished Production items", () => {
    const rows = [
      row({ id: "1", stage: "production", status: "completed" }),
      row({ id: "2", stage: "production", status: "in_progress", dashboardStatus: "not_started" }),
      row({ id: "3", stage: "review", reviewDecision: "pending_review" }),
      row({ id: "4", status: "blocked" }),
    ];
    const s = summarize(rows);
    expect(s.total).toBe(4);
    expect(s.done).toBe(1);
    expect(s.percent).toBe(25);
    expect(s.byStage.production).toBe(2);
    expect(s.byStatus.blocked).toBe(1);
    expect(s.awaitingReview.map((r) => r.id)).toEqual(["3"]);
    expect(s.blocked.map((r) => r.id)).toEqual(["4"]);
  });

  it("handles an empty scope without dividing by zero", () => {
    expect(summarize([]).percent).toBe(0);
  });
});

describe("groupings", () => {
  const rows = [
    row({
      id: "1",
      processId: "p1",
      phaseName: "B",
      phaseOrder: 2,
      stage: "production",
      status: "completed",
    }),
    row({ id: "2", processId: "p2", phaseName: "A", phaseOrder: 1, processCode: "10.1" }),
    row({
      id: "3",
      processId: "p2",
      phaseName: "A",
      phaseOrder: 1,
      processCode: "10.1",
      status: "blocked",
    }),
  ];
  it("orders phases by display order", () => {
    expect(byPhase(rows).map((g) => [g.key, g.percent])).toEqual([
      ["A", 0],
      ["B", 100],
    ]);
  });
  it("groups by Production Lead using only the assignments it is given", () => {
    const a: AssignmentRow[] = [
      { processId: "p1", personId: "x", personName: "Pavithra", type: "production_lead" },
      { processId: "p2", personId: "y", personName: "Rustham", type: "production_lead" },
      { processId: "p2", personId: "z", personName: "Rijin", type: "team_member" },
    ];
    expect(byLead(rows, a).map((g) => [g.label, g.total, g.done])).toEqual([
      ["Pavithra", 1, 1],
      ["Rustham", 2, 0],
    ]);
    expect(byLead(rows, [])).toEqual([]);
  });
  it("rolls a process up to its least advanced stage and sorts codes numerically", () => {
    const r = rollupProcesses([
      ...rows,
      row({ id: "4", processId: "p3", processCode: "2.1", stage: "testing" }),
      row({ id: "5", processId: "p3", processCode: "2.1", stage: "review" }),
    ]);
    expect(r.map((p) => p.code)).toEqual(["1.1", "2.1", "10.1"]);
    expect(r.find((p) => p.code === "2.1")!.stage).toBe("testing");
    expect(r.find((p) => p.code === "10.1")!.blocked).toBe(1);
  });
});

describe("countdown", () => {
  const dl = "2030-01-02T03:04:05Z";
  it("splits the remaining time into days, hours, minutes and seconds", () => {
    const now = Date.parse("2030-01-01T00:00:00Z");
    expect(remaining(dl, now)).toEqual({
      expired: false,
      days: 1,
      hours: 3,
      minutes: 4,
      seconds: 5,
    });
  });
  it("reads expired, never negative, at and after the deadline", () => {
    expect(remaining(dl, Date.parse(dl)).expired).toBe(true);
    expect(remaining(dl, Date.parse(dl) + 99999)).toEqual({
      expired: true,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
    });
  });
  it("converts a wall-clock time in a named timezone to the right instant", () => {
    expect(zonedToUtcIso("2030-06-01T12:00", "Asia/Riyadh")).toBe("2030-06-01T09:00:00.000Z");
    expect(zonedToUtcIso("2030-06-01T12:00", "UTC")).toBe("2030-06-01T12:00:00.000Z");
    expect(zonedToUtcIso("2030-01-15T09:30", "Asia/Kolkata")).toBe("2030-01-15T04:00:00.000Z");
    expect(() => zonedToUtcIso("bad", "UTC")).toThrow();
  });
});

describe("button visibility mirrors the rules", () => {
  const lead = caps([], { p1: ["production_lead"] });
  const member = caps([], { p1: ["team_member"] });
  const pl = caps(["project_lead"]);
  const dash = caps(["dashboard_lead"]);

  it("lets the Production Lead manage status up to Review, not Production", () => {
    expect(canSetStatus(lead, row({ stage: "testing" }))).toBe(true);
    expect(canSetStatus(lead, row({ stage: "production", dashboardStatus: "not_started" }))).toBe(
      false,
    );
    expect(canSetStatus(member, row({}))).toBe(false);
    expect(canSetStatus(caps([], { p2: ["production_lead"] }), row({}))).toBe(false);
  });
  it("lets the Project Lead own Review completion and Production", () => {
    const inReview = row({ stage: "review", status: "in_progress" });
    expect(canCompleteStage(pl, inReview)).toBe(true);
    expect(canCompleteStage(lead, inReview)).toBe(false);
    expect(canSetStatus(pl, row({ stage: "production", dashboardStatus: "not_started" }))).toBe(
      true,
    );
    expect(canSetStatus(pl, row({ stage: "testing" }))).toBe(false);
  });
  it("requires In Progress before offering completion", () => {
    expect(canCompleteStage(lead, row({ stage: "testing", status: "not_started" }))).toBe(false);
    expect(canCompleteStage(lead, row({ stage: "testing", status: "in_progress" }))).toBe(true);
  });
  it("offers testing results to the team during Testing only", () => {
    expect(canRecordTesting(member, row({ stage: "testing" }))).toBe(true);
    expect(canRecordTesting(member, row({ stage: "review" }))).toBe(false);
    expect(canRecordTesting(pl, row({ stage: "testing" }))).toBe(false);
  });
  it("limits the countdown and build status to the Dashboard Lead", () => {
    expect(canSetDeadline(dash)).toBe(true);
    expect(canSetDeadline(pl)).toBe(false);
    expect(
      canSetDashboardStatus(dash, row({ stage: "production", dashboardStatus: "not_started" })),
    ).toBe(true);
    expect(canSetDashboardStatus(dash, row({ stage: "testing" }))).toBe(false);
    expect(
      canSetDashboardStatus(pl, row({ stage: "production", dashboardStatus: "not_started" })),
    ).toBe(false);
  });
  it("chooses the broadest dashboard for combined roles", () => {
    expect(dashboardKind(pl)).toBe("project_lead");
    expect(dashboardKind(caps(["project_head"]))).toBe("management");
    expect(dashboardKind(lead)).toBe("lead");
    expect(dashboardKind(member)).toBe("member");
  });
});

describe("review permissions mirror the rules", () => {
  const reviewer = caps([], { p1: ["reviewer"] });
  const conflicted = caps([], { p1: ["reviewer", "team_member"] });
  const member = caps([], { p1: ["team_member"] });

  it("stops a reviewer who also worked on the process from reviewing", () => {
    expect(canReview(reviewer, "p1")).toBe(true);
    expect(canReview(conflicted, "p1")).toBe(false);
    expect(canReview(reviewer, "p2")).toBe(false);
  });
  it("offers review points during Testing or Review, and decisions only in Review", () => {
    expect(canRaiseReviewPoint(reviewer, row({ stage: "testing" }))).toBe(true);
    expect(canRaiseReviewPoint(reviewer, row({ stage: "solution_building" }))).toBe(false);
    expect(canRecordDecision(reviewer, row({ stage: "review" }))).toBe(true);
    expect(canRecordDecision(reviewer, row({ stage: "testing" }))).toBe(false);
    expect(canRecordDecision(member, row({ stage: "review" }))).toBe(false);
  });
  it("separates the owner's response from the reviewer's approval", () => {
    const owner = { ...caps([], { p1: ["team_member"] }), personId: "me" };
    const rp = (status: string) => ({ ownerPersonId: "me", status });
    expect(reviewPointActions(owner, "p1", rp("open"))).toEqual({
      start: true,
      submit: true,
      approveClose: false,
      returnBack: false,
    });
    expect(reviewPointActions(owner, "p1", rp("submitted_for_closure")).approveClose).toBe(false);
    expect(reviewPointActions(owner, "p1", rp("closed")).submit).toBe(false);
    const rev = { ...reviewer, personId: "rev" };
    expect(reviewPointActions(rev, "p1", rp("submitted_for_closure"))).toMatchObject({
      approveClose: true,
      returnBack: true,
    });
    expect(reviewPointActions(rev, "p1", rp("open")).approveClose).toBe(false);
    // A reviewer cannot approve a point they own.
    const selfOwned = { ...reviewer, personId: "me" };
    expect(reviewPointActions(selfOwned, "p1", rp("submitted_for_closure")).approveClose).toBe(
      false,
    );
  });
  it("limits uploads to assigned people and comments to them plus the Project Lead", () => {
    expect(canUpload(member, "p1")).toBe(true);
    expect(canUpload(member, "p2")).toBe(false);
    expect(canUpload(caps(["project_lead"]), "p1")).toBe(false);
    expect(canComment(caps(["project_lead"]), "p1")).toBe(true);
    expect(canComment(caps(["project_head"]), "p1")).toBe(false);
  });
});
