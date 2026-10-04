import { cache } from "react";
import type { Capabilities } from "./permissions";
import type {
  AssignmentRow,
  AssignmentType,
  DashboardStatus,
  ReviewDecision,
  RoleName,
  Stage,
  Status,
  SubprocessRow,
} from "./domain";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedViewer } from "./access";
import { ASSIGNMENT_SELECT, PERSON_ROLES_SELECT, SUBPROCESS_SELECT } from "./queries";

// Every query below runs as the signed-in user, so row-level security decides what comes back.

interface RawSub {
  id: string;
  seq: number;
  title: string;
  current_stage: Stage;
  current_status: Status;
  review_decision: ReviewDecision | null;
  dashboard_status: DashboardStatus | null;
  updated_at: string;
  processes: {
    id: string;
    process_code: string;
    title: string;
    phases: { name: string; display_order: number };
  };
}

export const listSubprocesses = cache(async (): Promise<SubprocessRow[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("subprocesses")
    .select(SUBPROCESS_SELECT)
    .returns<RawSub[]>();
  if (error) throw new Error("Could not load items.");
  return data
    .map((r) => ({
      id: r.id,
      seq: r.seq,
      title: r.title,
      stage: r.current_stage,
      status: r.current_status,
      reviewDecision: r.review_decision,
      dashboardStatus: r.dashboard_status,
      updatedAt: r.updated_at,
      processId: r.processes.id,
      processCode: r.processes.process_code,
      processTitle: r.processes.title,
      phaseName: r.processes.phases.name,
      phaseOrder: r.processes.phases.display_order,
    }))
    .sort(
      (a, b) =>
        a.processCode.localeCompare(b.processCode, undefined, { numeric: true }) || a.seq - b.seq,
    );
});

export const listAssignments = cache(async (): Promise<AssignmentRow[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("process_assignments")
    .select(ASSIGNMENT_SELECT)
    .returns<
      {
        process_id: string;
        person_id: string;
        assignment_type: AssignmentType;
        people: { display_name: string };
      }[]
    >();
  if (error) throw new Error("Could not load assignments.");
  return data.map((a) => ({
    processId: a.process_id,
    personId: a.person_id,
    personName: a.people.display_name,
    type: a.assignment_type,
  }));
});

export const getCapabilities = cache(async (): Promise<Capabilities> => {
  const viewer = await requireApprovedViewer();
  const supabase = await createClient();
  const roles = new Set<RoleName>();
  if (viewer.personId) {
    const { data } = await supabase
      .from("person_roles")
      .select(PERSON_ROLES_SELECT)
      .eq("person_id", viewer.personId)
      .returns<{ roles: { name: RoleName } }[]>();
    data?.forEach((r) => roles.add(r.roles.name));
  }
  const mine = (await listAssignments()).filter((a) => a.personId === viewer.personId);
  const assignments = new Map<string, Set<AssignmentType>>();
  for (const a of mine) {
    const set = assignments.get(a.processId) ?? new Set<AssignmentType>();
    set.add(a.type);
    assignments.set(a.processId, set);
  }
  return { roles, assignments };
});

export const getDeadline = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("project_settings")
    .select("setting_value")
    .eq("setting_key", "project_deadline")
    .maybeSingle();
  return typeof data?.setting_value === "string" ? data.setting_value : null;
});
