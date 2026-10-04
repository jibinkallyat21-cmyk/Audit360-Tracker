"use server";

import { z } from "zod";
import { rpc } from "@/lib/rpc";
import type { FormState } from "../../actions";

const id = z.string().uuid();
const note = z.string().trim().max(1000).optional();

export async function requestExport(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ note }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "The note is too long." };
  return rpc("request_export", { p_note: p.data.note || null });
}

export async function decideExport(_: FormState, form: FormData): Promise<FormState> {
  const p = z
    .object({ request: id, approve: z.enum(["true", "false"]), note })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Invalid request." };
  return rpc("decide_export", {
    p_id: p.data.request,
    p_approve: p.data.approve === "true",
    p_note: p.data.note || null,
  });
}

export async function archiveProject(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ request: id, note }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Invalid request." };
  return rpc("archive_project", { p_id: p.data.request, p_note: p.data.note || null });
}
