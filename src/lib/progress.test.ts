import { describe, expect, it } from "vitest";
import type { SubprocessRow } from "./domain";
import { processStatus } from "./progress";

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
