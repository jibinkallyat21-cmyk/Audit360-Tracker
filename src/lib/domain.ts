export const STAGES = [
  "process_definition",
  "solution_building",
  "testing",
  "review",
  "production",
] as const;
export type Stage = (typeof STAGES)[number];

export const STATUSES = [
  "not_started",
  "in_progress",
  "blocked",
  "changes_required",
  "completed",
] as const;
export type Status = (typeof STATUSES)[number];

export const DASHBOARD_STATUSES = [
  "not_started",
  "under_construction",
  "under_review",
  "changes_required",
  "live_deployed",
  "completed",
] as const;
export type DashboardStatus = (typeof DASHBOARD_STATUSES)[number];

export type ReviewDecision = "pending_review" | "changes_required" | "approved";
export type AssignmentType = "production_lead" | "team_member" | "reviewer" | "supporting_role";
export type RoleName =
  | "project_lead"
  | "dashboard_lead"
  | "project_head"
  | "system_admin"
  | "team_member"
  | "production_lead"
  | "reviewer"
  | "supporting_role";

export const STAGE_LABEL: Record<Stage, string> = {
  process_definition: "Process Definition",
  solution_building: "Solution Building",
  testing: "Testing",
  review: "Review",
  production: "Production",
};

export const STATUS_LABEL: Record<Status, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  blocked: "Blocked",
  changes_required: "Changes Required",
  completed: "Completed",
};

export const STATUS_SYMBOL: Record<Status, string> = {
  not_started: "○",
  in_progress: "◐",
  blocked: "■",
  changes_required: "▲",
  completed: "✓",
};

export const DASHBOARD_STATUS_LABEL: Record<DashboardStatus, string> = {
  not_started: "Not Started",
  under_construction: "Under Construction",
  under_review: "Under Review",
  changes_required: "Changes Required",
  live_deployed: "Live / Deployed",
  completed: "Completed",
};

export const REVIEW_DECISION_LABEL: Record<ReviewDecision, string> = {
  pending_review: "Pending Review",
  changes_required: "Changes Required",
  approved: "Approved",
};

/** A row as the tracker screens use it (already filtered by the database to what the viewer may see). */
export interface SubprocessRow {
  id: string;
  seq: number;
  title: string;
  stage: Stage;
  status: Status;
  reviewDecision: ReviewDecision | null;
  dashboardStatus: DashboardStatus | null;
  updatedAt: string;
  processId: string;
  processCode: string;
  processTitle: string;
  phaseName: string;
  phaseOrder: number;
}

export interface AssignmentRow {
  processId: string;
  personId: string;
  personName: string;
  type: AssignmentType;
}

/** Done means it reached Production and was completed there. */
export const isDone = (r: Pick<SubprocessRow, "stage" | "status">) =>
  r.stage === "production" && r.status === "completed";
