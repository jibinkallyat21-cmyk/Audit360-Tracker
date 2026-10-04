import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type ApprovalState = "pending" | "approved" | "rejected" | "deactivated";

export interface Viewer {
  id: string;
  email: string;
  fullName: string | null;
  personId: string | null;
  approvalState: ApprovalState;
  isActive: boolean;
}

/** Whether a profile may see protected project data. Mirrors the database gate. */
export function canAccessProject(v: Pick<Viewer, "approvalState" | "isActive">) {
  return v.approvalState === "approved" && v.isActive;
}

export async function getViewer(): Promise<Viewer | null> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("email, full_name, person_id, approval_state, is_active")
    .eq("id", auth.user.id)
    .single();
  if (!profile) return null;
  return {
    id: auth.user.id,
    email: profile.email,
    fullName: profile.full_name,
    personId: profile.person_id,
    approvalState: profile.approval_state as ApprovalState,
    isActive: profile.is_active,
  };
}

/** For pages that need an approved, active user. Everyone else is redirected. */
export async function requireApprovedViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!canAccessProject(viewer)) redirect("/access-denied");
  return viewer;
}
