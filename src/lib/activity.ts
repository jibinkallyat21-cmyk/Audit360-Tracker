const LABELS: Record<string, string> = {
  status_changed: "Status changed",
  stage_changed: "Stage changed",
  production_completed: "Production completed",
  testing_recorded: "Test result recorded",
  review_decision: "Review decision",
  review_point_raised: "Review point raised",
  review_point_start: "Review point started",
  review_point_submit: "Review point response submitted",
  review_point_approve_close: "Review point closure approved",
  review_point_return: "Review point returned",
  comment_added: "Comment added",
  document_uploaded: "Document uploaded",
  document_replaced: "Document version added",
  document_downloaded: "Document downloaded",
  deadline_set: "Deadline set",
  dashboard_status_changed: "Build status changed",
  user_approved: "User approved",
  user_rejected: "User rejected",
  user_activated: "User activated",
  user_deactivated: "User deactivated",
  assignment_added: "Assignment added",
  assignment_removed: "Assignment removed",
  role_granted: "Role granted",
  role_revoked: "Role revoked",
  bootstrap_admin: "First administrator set",
};

export const actionLabel = (a: string) => LABELS[a] ?? a.replace(/_/g, " ");

const pretty = (v: unknown): string =>
  typeof v === "string" ? v.replace(/_/g, " ") : v === null || v === undefined ? "none" : String(v);

/** A short "from → to" description of a logged change. */
export function describeChange(previous: unknown, next: unknown): string {
  const isObj = (x: unknown): x is Record<string, unknown> =>
    typeof x === "object" && x !== null && !Array.isArray(x);
  if (isObj(previous) || isObj(next)) {
    const p = isObj(previous) ? previous : {};
    const n = isObj(next) ? next : {};
    return [...new Set([...Object.keys(p), ...Object.keys(n)])]
      .map((k) => `${k.replace(/_/g, " ")}: ${pretty(p[k])} → ${pretty(n[k])}`)
      .join("; ");
  }
  if (previous === null && next === null) return "";
  if (typeof next === "string" && /^\d{4}-\d{2}-\d{2}T/.test(next)) {
    return `${previous ? pretty(previous) : "not set"} → ${next}`;
  }
  return `${pretty(previous)} → ${pretty(next)}`;
}

/** Strips characters that would change the meaning of a PostgREST filter. */
export const safeSearch = (q: string) =>
  q
    .replace(/[^A-Za-z0-9 _.-]/g, "")
    .trim()
    .slice(0, 60);
