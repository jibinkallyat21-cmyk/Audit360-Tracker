import { describe, expect, it } from "vitest";
import type { SubprocessRow } from "./domain";
import { PHASE_WEIGHTS, byPhase, processStatus, summarize, weightedPercent } from "./progress";

const row = (over: Partial<SubprocessRow>): SubprocessRow => ({
  id: "x",
  seq: 1,
  title: "t",
  stage: "solution_building",
  status: "not_started",
  reviewDecision: null,
  dashboardStatus: null,
  updatedAt: "2030-01-01T00:00:00Z",
  processId: "p",
  processCode: "1.1",
  processTitle: "P",
  phaseName: "Phase",
  phaseOrder: 1,
  ...over,
});

describe("processStatus", () => {
  it("is completed only when every step is done", () => {
    const done = row({ stage: "production", status: "completed" });
    expect(processStatus([done, done])).toBe("completed");
    expect(processStatus([done, row({})])).toBe("in_progress");
  });
  it("puts the worst news first", () => {
    const blocked = row({ status: "blocked" });
    const changes = row({ status: "changes_required" });
    const review = row({
      stage: "review",
      status: "in_progress",
      reviewDecision: "pending_review",
    });
    expect(processStatus([review, changes, blocked])).toBe("blocked");
    expect(processStatus([review, changes])).toBe("changes_required");
    expect(processStatus([review, row({})])).toBe("awaiting_review");
  });
  it("is not started when nothing has begun", () => {
    expect(processStatus([row({}), row({})])).toBe("not_started");
    expect(processStatus([row({ status: "in_progress" })])).toBe("in_progress");
  });
});

describe("weighted completion", () => {
  const DONE = { stage: "production", status: "completed" } as const;
  const phase = (name: string, total: number, done: number) =>
    Array.from({ length: total }, (_, i) =>
      row({ id: `${name}${i}`, phaseName: name, ...(i < done ? DONE : {}) }),
    );
  const all = (done: Record<string, number>) =>
    Object.keys(PHASE_WEIGHTS).flatMap((n) => phase(n, 4, done[n] ?? 0));

  it("weights add up to 100: Audit execution 55, File management 5, the other four 10 each", () => {
    expect(Object.values(PHASE_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    expect(PHASE_WEIGHTS["Audit execution"]).toBe(55);
    expect(PHASE_WEIGHTS["File management and closure"]).toBe(5);
    expect(PHASE_WEIGHTS["Review"]).toBe(10);
  });
  it("is 0 with nothing done and 100 with everything done", () => {
    expect(weightedPercent(all({}))).toBe(0);
    expect(
      weightedPercent(all(Object.fromEntries(Object.keys(PHASE_WEIGHTS).map((n) => [n, 4])))),
    ).toBe(100);
  });
  it("counts a finished Audit execution as 55 and a finished File management as 5", () => {
    expect(weightedPercent(all({ "Audit execution": 4 }))).toBe(55);
    expect(weightedPercent(all({ "File management and closure": 4 }))).toBe(5);
    expect(weightedPercent(all({ "Lead and proposal": 4, Review: 4 }))).toBe(20);
  });
  it("counts items equally inside a phase", () => {
    expect(weightedPercent(all({ "Audit execution": 2 }))).toBe(28); // 55 x 2/4 = 27.5
  });
  it("scales to the phases a person can see", () => {
    expect(weightedPercent(phase("Audit execution", 4, 2))).toBe(50);
    expect(weightedPercent([...phase("Audit execution", 4, 4), ...phase("Review", 4, 0)])).toBe(85); // 55 of 65
  });
  it("is used by the dashboard summary and shown per phase", () => {
    const rows = all({ "Audit execution": 4 });
    expect(summarize(rows).percent).toBe(55);
    expect(byPhase(rows).find((p) => p.key === "Audit execution")?.weight).toBe(55);
  });
});
