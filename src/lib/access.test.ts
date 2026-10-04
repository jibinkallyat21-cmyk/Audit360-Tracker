import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
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
