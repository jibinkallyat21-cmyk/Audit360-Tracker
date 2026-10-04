import { describe, expect, it } from "vitest";
import { actionLabel, describeChange, safeSearch } from "./activity";

describe("activity helpers", () => {
  it("labels known actions and falls back to readable text", () => {
    expect(actionLabel("status_changed")).toBe("Status changed");
    expect(actionLabel("something_new")).toBe("something new");
  });
  it("describes status and stage changes with old and new values", () => {
    expect(
      describeChange(
        { stage: "testing", status: "in_progress" },
        { stage: "review", status: "not_started" },
      ),
    ).toBe("stage: testing → review; status: in progress → not started");
  });
  it("describes the first deadline as not set before", () => {
    expect(describeChange(null, "2030-01-01T00:00:00Z")).toBe("not set → 2030-01-01T00:00:00Z");
  });
  it("removes filter-breaking characters from search text", () => {
    expect(safeSearch("a,b)(c%*")).toBe("abc");
    expect(safeSearch("  review  ")).toBe("review");
  });
});
