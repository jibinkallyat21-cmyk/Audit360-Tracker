import { getPersona } from "@/lib/demo";
import { demoName, demoRecords } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";
import {
  APPROVALS_SELECT,
  COMMENTS_SELECT,
  DOCUMENTS_SELECT,
  REVIEW_POINTS_SELECT,
  TESTING_SELECT,
} from "./queries";

export interface CommentRec {
  id: string;
  subprocess_id: string;
  review_point_id: string | null;
  parent_comment_id: string | null;
  author_id: string;
  comment_text: string;
  created_at: string;
}
export interface ReviewPointRec {
  id: string;
  subprocess_id: string;
  raised_by: string;
  assigned_to_person_id: string;
  description: string;
  status: "open" | "in_progress" | "submitted_for_closure" | "changes_required" | "closed";
  resolution_note: string | null;
  submitted_at: string | null;
  closed_by: string | null;
  closed_at: string | null;
  created_at: string;
  owner: { display_name: string };
}
export interface VersionRec {
  id: string;
  version_number: number;
  original_filename: string;
  file_size: number;
  version_note: string | null;
  uploaded_by: string;
  uploaded_at: string;
  is_current: boolean;
}
export interface DocumentRec {
  id: string;
  subprocess_id: string;
  review_point_id: string | null;
  original_filename: string;
  created_at: string;
  document_versions: VersionRec[];
}
export interface TestingRec {
  id: string;
  subprocess_id: string;
  submitted_by: string;
  result: "pass" | "fail";
  notes: string | null;
  evidence_document_id: string | null;
  created_at: string;
}
export interface ApprovalRec {
  id: string;
  subprocess_id: string;
  review_point_id: string | null;
  approval_type: "review_decision" | "review_point_closure" | "production_entry";
  decision: string;
  decided_by: string;
  decision_note: string | null;
  decided_at: string;
}

export interface Records {
  comments: CommentRec[];
  reviewPoints: ReviewPointRec[];
  documents: DocumentRec[];
  testing: TestingRec[];
  approvals: ApprovalRec[];
  names: Map<string, string>;
}

/** Resolves account ids to display names (never emails). */
export async function resolveNames(
  ids: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (unique.length === 0) return names;
  if (await getPersona()) {
    unique.forEach((id) => names.set(id, demoName(id)));
    return names;
  }
  const supabase = await createClient();
  const { data } = await supabase.rpc("actor_names", { p_ids: unique });
  (data as { profile_id: string; display_name: string }[] | null)?.forEach((r) =>
    names.set(r.profile_id, r.display_name),
  );
  return names;
}

/** Everything attached to the given steps, as the signed-in user may see it. */
export async function getRecords(subIds: string[]): Promise<Records> {
  const empty: Records = {
    comments: [],
    reviewPoints: [],
    documents: [],
    testing: [],
    approvals: [],
    names: new Map(),
  };
  if (subIds.length === 0) return empty;
  const persona = await getPersona();
  if (persona) return demoRecords(persona, subIds);
  const supabase = await createClient();
  const [c, r, d, t, a] = await Promise.all([
    supabase
      .from("comments")
      .select(COMMENTS_SELECT)
      .in("subprocess_id", subIds)
      .order("created_at")
      .returns<CommentRec[]>(),
    supabase
      .from("review_points")
      .select(REVIEW_POINTS_SELECT)
      .in("subprocess_id", subIds)
      .order("created_at")
      .returns<ReviewPointRec[]>(),
    supabase
      .from("documents")
      .select(DOCUMENTS_SELECT)
      .in("subprocess_id", subIds)
      .order("created_at")
      .returns<DocumentRec[]>(),
    supabase
      .from("testing_records")
      .select(TESTING_SELECT)
      .in("subprocess_id", subIds)
      .order("created_at")
      .returns<TestingRec[]>(),
    supabase
      .from("approvals")
      .select(APPROVALS_SELECT)
      .in("subprocess_id", subIds)
      .order("decided_at")
      .returns<ApprovalRec[]>(),
  ]);
  if (c.error || r.error || d.error || t.error || a.error)
    throw new Error("Could not load records.");
  const rec: Records = {
    comments: c.data,
    reviewPoints: r.data,
    documents: d.data,
    testing: t.data,
    approvals: a.data,
    names: new Map(),
  };
  rec.names = await resolveNames([
    ...c.data.map((x) => x.author_id),
    ...r.data.flatMap((x) => [x.raised_by, x.closed_by]),
    ...d.data.flatMap((x) => x.document_versions.map((v) => v.uploaded_by)),
    ...t.data.map((x) => x.submitted_by),
    ...a.data.map((x) => x.decided_by),
  ]);
  return rec;
}
