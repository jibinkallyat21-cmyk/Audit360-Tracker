"use server";

import { redirect } from "next/navigation";
import { DEMO_PERSONAS, demoEmail, demoEnabled } from "@/lib/demo";
import { z } from "zod";
import { siteUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export interface FormState {
  error?: string;
  message?: string;
}

const email = z.string().trim().toLowerCase().email("Enter a valid email address.");
const password = z.string().min(10, "Use at least 10 characters.").max(72);

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const parsed = z
    .object({ email, password: z.string().min(1, "Enter your password.") })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  // One message for every failure so accounts cannot be enumerated.
  if (error) return { error: "Incorrect email or password, or the email is not confirmed." };
  redirect("/");
}

/** One-click demo sign-in. Refuses unless demo mode is switched on for this deployment. */
export async function demoLogin(formData: FormData) {
  const slug = String(formData.get("persona") ?? "");
  if (!demoEnabled() || !DEMO_PERSONAS.some((p) => p.slug === slug)) redirect("/login");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: demoEmail(slug),
    password: process.env.DEMO_PASSWORD!,
  });
  if (error) redirect("/login?error=demo");
  redirect("/");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function register(_: FormState, form: FormData): Promise<FormState> {
  const parsed = z
    .object({ fullName: z.string().trim().min(2, "Enter your name.").max(100), email, password })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${siteUrl()}/auth/confirm?next=/`,
    },
  });
  if (error)
    return { error: "Could not create the account. Try again or contact the administrator." };
  return {
    message:
      "Check your email to confirm your address. After that, an administrator must approve your account before you can see any project data.",
  };
}

export async function requestPasswordReset(_: FormState, form: FormData): Promise<FormState> {
  const parsed = z.object({ email }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${siteUrl()}/auth/confirm?next=/reset-password`,
  });
  return { message: "If that email has an account, a reset link is on its way." };
}

export async function resetPassword(_: FormState, form: FormData): Promise<FormState> {
  const parsed = z.object({ password }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: "Could not update the password. Request a new reset link." };
  redirect("/");
}
