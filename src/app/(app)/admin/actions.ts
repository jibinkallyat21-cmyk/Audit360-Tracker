"use server";

import { z } from "zod";
import { rpc } from "@/lib/rpc";
import type { FormState } from "../../actions";

const id = z.string().uuid();

export async function approveUser(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ user: id, person: id }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Choose the person this account belongs to." };
  return rpc("admin_approve_user", { p_user: p.data.user, p_person: p.data.person });
}

export async function rejectUser(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ user: id }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Invalid account." };
  return rpc("admin_reject_user", { p_user: p.data.user });
}

export async function setUserActive(_: FormState, form: FormData): Promise<FormState> {
  const p = z
    .object({ user: id, active: z.enum(["true", "false"]) })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Invalid request." };
  return rpc("admin_set_user_active", { p_user: p.data.user, p_active: p.data.active === "true" });
}

export async function setPersonRole(_: FormState, form: FormData): Promise<FormState> {
  const p = z
    .object({
      person: id,
      role: z.enum(["project_lead", "dashboard_lead", "project_head", "system_admin"]),
      granted: z.enum(["true", "false"]),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Choose a person and a role." };
  return rpc("admin_set_person_role", {
    p_person: p.data.person,
    p_role: p.data.role,
    p_granted: p.data.granted === "true",
  });
}

export async function setAssignment(_: FormState, form: FormData): Promise<FormState> {
  const p = z
    .object({
      process: id,
      person: id,
      type: z.enum(["production_lead", "team_member", "reviewer", "supporting_role"]),
      assigned: z.enum(["true", "false"]),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Choose a person and an assignment type." };
  return rpc("admin_set_assignment", {
    p_process: p.data.process,
    p_person: p.data.person,
    p_type: p.data.type,
    p_assigned: p.data.assigned === "true",
  });
}

export async function setTeamMember(_: FormState, form: FormData): Promise<FormState> {
  const p = z
    .object({ team: id, person: id, member: z.enum(["true", "false"]) })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Choose a person." };
  return rpc("admin_set_team_member", {
    p_team: p.data.team,
    p_person: p.data.person,
    p_member: p.data.member === "true",
  });
}
