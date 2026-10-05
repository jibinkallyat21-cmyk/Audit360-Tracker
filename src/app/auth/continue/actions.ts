"use server";

import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const TYPES: EmailOtpType[] = [
  "invite",
  "recovery",
  "email",
  "signup",
  "magiclink",
  "email_change",
];

/** Uses the link: only runs when the person presses the button, never on a mere page fetch. */
export async function confirmLink(form: FormData) {
  const tokenHash = String(form.get("token_hash") ?? "");
  const type = String(form.get("type") ?? "") as EmailOtpType;
  const next = String(form.get("next") ?? "/");
  // Only same-site relative paths are allowed as the post-login target.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (!tokenHash || !TYPES.includes(type)) redirect("/login?error=link");

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) {
    const back = new URLSearchParams({ token_hash: tokenHash, type, next: safeNext, error: "1" });
    redirect(`/auth/continue?${back}`);
  }
  redirect(safeNext);
}
