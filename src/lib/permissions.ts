import type { AssignmentType, RoleName, SubprocessRow } from "./domain";

/**
 * What the interface offers a user. This only decides which buttons to show;
 * the database functions make the real decision and reject anything else.
 */
export interface Capabilities {
  /** The viewer's linked person, used to recognise review points they own. */
  personId?: string | null;
  /** The viewer's account id, used to recognise files they uploaded. */
  userId?: string | null;
  roles: ReadonlySet<RoleName>;
  /** Assignment types the user holds, per process id. */
  assignments: ReadonlyMap<string, ReadonlySet<AssignmentType>>;
}

const has = (c: Capabilities, processId: string, type: AssignmentType) =>
  c.assignments.get(processId)?.has(type) ?? false;

/** A step with lines is worked, reviewed and approved line by line until it reaches Production. */
export const usesLines = (r: SubprocessRow) =>
  (r.lines?.length ?? 0) > 0 && r.stage !== "production";

export function canSetStatus(c: Capabilities, r: SubprocessRow): boolean {
  if (usesLines(r)) return false;
  if (r.stage === "production") return c.roles.has("project_lead");
  return has(c, r.processId, "production_lead");
}

export function canCompleteStage(c: Capabilities, r: SubprocessRow): boolean {
  if (usesLines(r)) return false;
  if (r.status !== "in_progress") return false;
  if (r.stage === "production") return c.roles.has("project_lead");
  if (r.stage === "review") return c.roles.has("project_lead");
  return has(c, r.processId, "production_lead");
}

export function canRecordTesting(c: Capabilities, r: SubprocessRow): boolean {
  return (
    !usesLines(r) &&
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
  canReview(c, r.processId) &&
  ((r.lines?.length ?? 0) > 0
    ? r.stage !== "production"
    : r.stage === "testing" || r.stage === "review");

export const canRecordDecision = (c: Capabilities, r: SubprocessRow) =>
  !usesLines(r) && canReview(c, r.processId) && r.stage === "review";

/** Add, rename and remove lines: the step's Production Lead or the System Administrator. */
export const canManageLines = (c: Capabilities, r: SubprocessRow) =>
  r.stage !== "production" &&
  (has(c, r.processId, "production_lead") || c.roles.has("system_admin"));

/** Set a line's working status and send it to review: the step's Production Lead. */
export const canWorkLines = (c: Capabilities, r: SubprocessRow) =>
  r.stage !== "production" && has(c, r.processId, "production_lead");

/** Approve or ask for changes on a line in review. */
export const canDecideLines = (c: Capabilities, r: SubprocessRow) =>
  r.stage !== "production" && canReview(c, r.processId);

/** Move a file between lines: the people who do the work. */
export const canMoveDocuments = (c: Capabilities, processId: string) =>
  (["production_lead", "team_member", "supporting_role"] as const).some((t) =>
    has(c, processId, t),
  );

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

/**
 * Remove a document: its uploader, the process's Production Lead or the System Administrator.
 * Only the administrator may remove evidence that is under review or approved.
 */
export function canRemoveDocument(
  c: Capabilities,
  row: SubprocessRow,
  doc: { uploaded_by?: string; line_id?: string | null; removed_at?: string | null },
): boolean {
  if (doc.removed_at) return false;
  if (c.roles.has("system_admin")) return true;
  const lead = has(c, row.processId, "production_lead");
  const own = !!c.userId && doc.uploaded_by === c.userId && c.assignments.has(row.processId);
  if (!lead && !own) return false;
  const line = doc.line_id ? row.lines?.find((l) => l.id === doc.line_id) : undefined;
  if (line) return line.status !== "in_review" && line.status !== "approved";
  if ((row.lines?.length ?? 0) === 0 && (row.stage === "review" || row.stage === "production")) {
    return false;
  }
  return true;
}
