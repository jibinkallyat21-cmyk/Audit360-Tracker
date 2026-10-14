"use server";

import { z } from "zod";
import { DASHBOARD_STATUSES } from "@/lib/domain";
import { zonedToUtcIso } from "@/lib/countdown";
import { rpc } from "@/lib/rpc";
import type { FormState } from "../actions";

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

export async function markNotificationRead(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ id }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Invalid notification." };
  return rpc("mark_notification_read", { p_id: p.data.id });
}

export async function markAllNotificationsRead(): Promise<FormState> {
  return rpc("mark_all_notifications_read", {});
}

// ---------- lines ----------

const lineTitle = z.string().trim().min(1, "Give the line a name.").max(120);

export async function addLine(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ sub: id, title: lineTitle }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  return rpc("line_add", { p_sub: p.data.sub, p_title: p.data.title });
}

export async function renameLine(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ line: id, title: lineTitle }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  return rpc("line_rename", { p_line: p.data.line, p_title: p.data.title });
}

export async function removeLine(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ line: id }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Invalid line." };
  return rpc("line_remove", { p_line: p.data.line });
}

export async function setLineStatus(_: FormState, form: FormData): Promise<FormState> {
  const p = z
    .object({ line: id, status: z.enum(["not_started", "in_progress", "blocked"]) })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Choose a valid status." };
  return rpc("line_set_status", { p_line: p.data.line, p_status: p.data.status });
}

export async function sendLineToReview(_: FormState, form: FormData): Promise<FormState> {
  const p = z
    .object({
      line: id,
      tested: z.string().optional(),
      note: z.string().trim().max(2000).optional(),
      docs: z.array(id).max(50),
    })
    .safeParse({ ...Object.fromEntries(form), docs: form.getAll("docs") });
  if (!p.success) return { error: "Invalid request." };
  return rpc("line_send_to_review", {
    p_line: p.data.line,
    p_tested: p.data.tested === "on" || p.data.tested === "true",
    p_note: p.data.note || null,
    p_documents: p.data.docs.length > 0 ? p.data.docs : null,
  });
}

export async function decideLine(_: FormState, form: FormData): Promise<FormState> {
  const p = z
    .object({
      line: id,
      decision: z.enum(["approved", "changes_required"]),
      note: z.string().trim().max(2000).optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Choose a decision." };
  return rpc("line_review_decision", {
    p_line: p.data.line,
    p_decision: p.data.decision,
    p_note: p.data.note || null,
  });
}

export async function moveDocument(_: FormState, form: FormData): Promise<FormState> {
  const p = z
    .object({ doc: id, line: z.string().uuid().optional().or(z.literal("")) })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Choose a line." };
  return rpc("assign_document_line", { p_document: p.data.doc, p_line: p.data.line || null });
}

export async function removeDocument(_: FormState, form: FormData): Promise<FormState> {
  const p = z
    .object({ doc: id, reason: z.string().trim().max(500).optional() })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Invalid document." };
  return rpc("remove_document", { p_document: p.data.doc, p_reason: p.data.reason || null });
}

export async function restoreDocument(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ doc: id }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Invalid document." };
  return rpc("restore_document", { p_document: p.data.doc });
}

export async function leadSetAssignment(_: FormState, form: FormData): Promise<FormState> {
  const p = z
    .object({
      process: id,
      person: z.string().uuid("Choose a person."),
      type: z.enum(["team_member", "supporting_role"]),
      assigned: z.enum(["true", "false"]),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  return rpc("lead_set_assignment", {
    p_process: p.data.process,
    p_person: p.data.person,
    p_type: p.data.type,
    p_assigned: p.data.assigned === "true",
  });
}
