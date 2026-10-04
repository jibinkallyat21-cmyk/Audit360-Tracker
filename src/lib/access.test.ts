import { describe, expect, it } from "vitest";
import { canAccessProject } from "./access";

describe("canAccessProject", () => {
  it("allows only approved and active users", () => {
    expect(canAccessProject({ approvalState: "approved", isActive: true })).toBe(true);
    expect(canAccessProject({ approvalState: "approved", isActive: false })).toBe(false);
    for (const approvalState of ["pending", "rejected", "deactivated"] as const) {
      expect(canAccessProject({ approvalState, isActive: true })).toBe(false);
    }
  });
});
