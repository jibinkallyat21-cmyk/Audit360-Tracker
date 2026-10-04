"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DASHBOARD_STATUSES } from "@/lib/domain";
import { zonedToUtcIso } from "@/lib/countdown";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "../actions";

/** Turns a database rejection into a short message without exposing internals. */
function friendly(message: string | undefined): string {
  if (!message) return "Something went wrong.";
  if (/Not authorized/i.test(message)) return "You are not allowed to do that.";
  // Workflow rules are written as plain sentences in the database functions.
  if (/^[A-Z][^{}()]{3,160}$/.test(message)) return message;
  return "The change could not be saved.";
}

async function rpc(name: string, args: Record<string, unknown>): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(name, args);
  if (error) return { error: friendly(error.message) };
  revalidatePath("/", "layout");
  return { message: "Saved." };
}

const id = z.string().uuid();

export async function setStatus(_: FormState, form: FormData): Promise<FormState> {
  const p = z
    .object({ sub: id, status: z.enum(["not_started", "in_progress", "blocked"]) })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Choose a valid status." };
  return rpc("set_status", { p_sub: p.data.sub, p_status: p.data.status });
}

export async function completeStage(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ sub: id }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Invalid item." };
  return rpc("complete_stage", { p_sub: p.data.sub });
}

export async function recordTesting(_: FormState, form: FormData): Promise<FormState> {
  const p = z
    .object({
      sub: id,
      result: z.enum(["pass", "fail"]),
      notes: z.string().trim().max(2000).optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Choose pass or fail." };
  return rpc("record_testing", {
    p_sub: p.data.sub,
    p_result: p.data.result,
    p_notes: p.data.notes || null,
    p_evidence_document: null,
  });
}

export async function setDashboardStatus(_: FormState, form: FormData): Promise<FormState> {
  const p = z
    .object({ sub: id, status: z.enum(DASHBOARD_STATUSES) })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Choose a valid build status." };
  return rpc("set_dashboard_status", { p_sub: p.data.sub, p_status: p.data.status });
}

export async function setDeadline(_: FormState, form: FormData): Promise<FormState> {
  const p = z
    .object({ when: z.string().min(1), zone: z.string().min(1) })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Enter a date and time." };
  let iso: string;
  try {
    iso = zonedToUtcIso(p.data.when, p.data.zone);
  } catch {
    return { error: "Enter a valid date, time and timezone." };
  }
  return rpc("set_deadline", { p_deadline: iso });
}
