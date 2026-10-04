import type { AssignmentType, RoleName, SubprocessRow } from "./domain";

/**
 * What the interface offers a user. This only decides which buttons to show;
 * the database functions make the real decision and reject anything else.
 */
export interface Capabilities {
  roles: ReadonlySet<RoleName>;
  /** Assignment types the user holds, per process id. */
  assignments: ReadonlyMap<string, ReadonlySet<AssignmentType>>;
}

const has = (c: Capabilities, processId: string, type: AssignmentType) =>
  c.assignments.get(processId)?.has(type) ?? false;

export function canSetStatus(c: Capabilities, r: SubprocessRow): boolean {
  if (r.stage === "production") return c.roles.has("project_lead");
  return has(c, r.processId, "production_lead");
}

export function canCompleteStage(c: Capabilities, r: SubprocessRow): boolean {
  if (r.status !== "in_progress") return false;
  if (r.stage === "production") return c.roles.has("project_lead");
  if (r.stage === "review") return c.roles.has("project_lead");
  return has(c, r.processId, "production_lead");
}

export function canRecordTesting(c: Capabilities, r: SubprocessRow): boolean {
  return (
    r.stage === "testing" &&
    (["production_lead", "team_member", "supporting_role"] as const).some((t) =>
      has(c, r.processId, t),
    )
  );
}

export function canSetDashboardStatus(c: Capabilities, r: SubprocessRow): boolean {
  return c.roles.has("dashboard_lead") && r.stage === "production";
}

export const canSetDeadline = (c: Capabilities) => c.roles.has("dashboard_lead");

/** Which dashboard to lead with. A person with several roles gets the broadest one. */
export function dashboardKind(c: Capabilities): "project_lead" | "management" | "lead" | "member" {
  if (c.roles.has("project_lead")) return "project_lead";
  if (c.roles.has("project_head") || c.roles.has("dashboard_lead") || c.roles.has("system_admin"))
    return "management";
  for (const types of c.assignments.values()) if (types.has("production_lead")) return "lead";
  return "member";
}
