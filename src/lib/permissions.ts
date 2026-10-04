import type { AssignmentType, RoleName, SubprocessRow } from "./domain";

/**
 * What the interface offers a user. This only decides which buttons to show;
 * the database functions make the real decision and reject anything else.
 */
export interface Capabilities {
  /** The viewer's linked person, used to recognise review points they own. */
  personId?: string | null;
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

/** A reviewer must not also have worked on the process (mirrors is_conflicted_reviewer). */
export function canReview(c: Capabilities, processId: string): boolean {
  return (
    has(c, processId, "reviewer") &&
    !(["production_lead", "team_member", "supporting_role"] as const).some((t) =>
      has(c, processId, t),
    )
  );
}

export const canRaiseReviewPoint = (c: Capabilities, r: SubprocessRow) =>
  canReview(c, r.processId) && (r.stage === "testing" || r.stage === "review");

export const canRecordDecision = (c: Capabilities, r: SubprocessRow) =>
  canReview(c, r.processId) && r.stage === "review";

export const canUpload = (c: Capabilities, processId: string) => c.assignments.has(processId);

export const canComment = (c: Capabilities, processId: string) =>
  c.roles.has("project_lead") || c.assignments.has(processId);

export interface ReviewPointActions {
  start: boolean;
  submit: boolean;
  approveClose: boolean;
  returnBack: boolean;
}

export function reviewPointActions(
  c: Capabilities,
  processId: string,
  rp: { ownerPersonId: string; status: string },
): ReviewPointActions {
  const isOwner = !!c.personId && c.personId === rp.ownerPersonId;
  const reviewer = canReview(c, processId) && !isOwner;
  return {
    start: isOwner && (rp.status === "open" || rp.status === "changes_required"),
    submit: isOwner && ["open", "in_progress", "changes_required"].includes(rp.status),
    approveClose: reviewer && rp.status === "submitted_for_closure",
    returnBack: reviewer && rp.status === "submitted_for_closure",
  };
}
