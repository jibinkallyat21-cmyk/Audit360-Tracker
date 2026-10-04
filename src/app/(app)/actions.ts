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
      evidence: z.string().uuid().optional().or(z.literal("")),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Choose pass or fail." };
  return rpc("record_testing", {
    p_sub: p.data.sub,
    p_result: p.data.result,
    p_notes: p.data.notes || null,
    p_evidence_document: p.data.evidence || null,
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

const optionalId = z.string().uuid().optional().or(z.literal(""));

export async function addComment(_: FormState, form: FormData): Promise<FormState> {
  const p = z
    .object({
      sub: id,
      text: z.string().trim().min(1, "Write a comment.").max(4000),
      parent: optionalId,
      rp: optionalId,
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  return rpc("add_comment", {
    p_sub: p.data.sub,
    p_text: p.data.text,
    p_parent: p.data.parent || null,
    p_rp: p.data.rp || null,
  });
}

export async function raiseReviewPoint(_: FormState, form: FormData): Promise<FormState> {
  const p = z
    .object({
      sub: id,
      description: z.string().trim().min(1, "Describe the review point.").max(4000),
      owner: z.string().uuid("Choose the corrective owner."),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  return rpc("raise_review_point", {
    p_sub: p.data.sub,
    p_description: p.data.description,
    p_owner_person: p.data.owner,
  });
}

export async function recordReviewDecision(_: FormState, form: FormData): Promise<FormState> {
  const p = z
    .object({
      sub: id,
      decision: z.enum(["approved", "changes_required"]),
      note: z.string().trim().max(2000).optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Choose a decision." };
  return rpc("record_review_decision", {
    p_sub: p.data.sub,
    p_decision: p.data.decision,
    p_note: p.data.note || null,
  });
}

export async function updateReviewPoint(_: FormState, form: FormData): Promise<FormState> {
  const p = z
    .object({
      rp: id,
      action: z.enum(["start", "submit", "approve_close", "return"]),
      note: z.string().trim().max(4000).optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Invalid request." };
  return rpc("update_review_point", {
    p_rp: p.data.rp,
    p_action: p.data.action,
    p_note: p.data.note || null,
  });
}
