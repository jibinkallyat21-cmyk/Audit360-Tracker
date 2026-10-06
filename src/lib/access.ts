import { cache } from "react";
import { redirect } from "next/navigation";
import { getPersona } from "./demo";
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

/** Cached per request: the layout, the page and the data helpers all ask who is signed in. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const demo = await getPersona();
  if (demo) {
    return {
      id: demo.slug,
      email: `${demo.slug}@demo.local`,
      fullName: demo.person,
      personId: demo.personId,
      approvalState: "approved",
      isActive: true,
    };
  }
  const supabase = await createClient();
  // getClaims checks the token signature locally instead of calling the auth server each time;
  // the proxy has already refreshed the session, and row-level security still guards every query.
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("email, full_name, person_id, approval_state, is_active")
    .eq("id", userId)
    .single();
  if (!profile) return null;
  // Invited accounts have no name of their own; show the person they are linked to.
  let fullName = profile.full_name;
  if (!fullName && profile.person_id) {
    const { data: person } = await supabase
      .from("people")
      .select("display_name")
      .eq("id", profile.person_id)
      .maybeSingle();
    fullName = person?.display_name ?? null;
  }
  return {
    id: userId,
    email: profile.email,
    fullName,
    personId: profile.person_id,
    approvalState: profile.approval_state as ApprovalState,
    isActive: profile.is_active,
  };
});

/** For pages that need an approved, active user. Everyone else is redirected. */
export async function requireApprovedViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!canAccessProject(viewer)) redirect("/access-denied");
  return viewer;
}
