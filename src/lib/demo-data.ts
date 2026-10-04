import type { Capabilities } from "./permissions";
import type {
  AssignmentRow,
  AssignmentType,
  RoleName,
  Stage,
  Status,
  SubprocessRow,
} from "./domain";
import type {
  ApprovalRec,
  CommentRec,
  DocumentRec,
  Records,
  ReviewPointRec,
  TestingRec,
} from "./records";
import type { NotificationRow, OrgData } from "./data";
import type { Persona } from "./demo";
import { PERSONAS } from "./demo";

// Made-up data for the prototype demo. Nothing here comes from the database.

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const PHASES = ["Lead and proposal", "Engagement and advance", "Audit execution", "Review"];
const PROCESSES: [string, string, number, string][] = [
  ["1.1", "Lead Scoring & Proposal Generation", 0, "p-pavithra"],
  ["1.2", "Signed Proposal & Basic Documents Collection", 0, "p-pavithra"],
  ["2.1", "Engagement Letter Processing & Confirmation", 1, "p-pavithra"],
  ["3.4", "Sampling, Vouching & External Confirmations", 2, "p-pavithra"],
  ["3.5", "Substantive Procedures & Schedules", 2, "p-rustham"],
  ["3.6", "IFRS Financial Statement Preparation", 2, "p-rustham"],
  ["4.1", "Team Lead / Manager Review & Correction", 3, "p-rustham"],
];
const MIX: [Stage, Status][] = [
  ["production", "completed"],
  ["production", "in_progress"],
  ["review", "in_progress"],
  ["testing", "blocked"],
  ["solution_building", "changes_required"],
  ["process_definition", "not_started"],
  ["solution_building", "in_progress"],
];
const BUILD = ["live_deployed", "under_construction", "not_started"] as const;

const PEOPLE = [
  ["p-aditya", "Aditya"],
  ["p-meera", "Meera"],
  ["p-karthik", "Karthik"],
  ["p-pavithra", "Pavithra"],
  ["p-rustham", "Rustham"],
  ["p-fayis", "Fayis"],
  ["p-ali", "Mohammed Ali"],
  ["p-anna", "Anna"],
  ["p-rijin", "Rijin"],
  ["p-sara", "Sara"],
] as const;
export const demoName = (id: string) => PEOPLE.find((p) => p[0] === id)?.[1] ?? "A team member";

const ALL_ROWS: SubprocessRow[] = PROCESSES.flatMap(([code, title, phase], pi) =>
  [1, 2, 3].map((seq) => {
    const [stage, status] = MIX[(pi + seq * 2) % MIX.length];
    return {
      id: `${code}-${seq}`,
      seq,
      title: `${["Define the steps", "Build the automation", "Check and hand over"][seq - 1]} (${code})`,
      stage,
      status,
      reviewDecision: stage === "review" ? ("pending_review" as const) : null,
      dashboardStatus: stage === "production" ? BUILD[(pi + seq) % BUILD.length] : null,
      updatedAt: hoursAgo(3 + pi * 7 + seq * 2),
      processId: code,
      processCode: code,
      processTitle: title,
      phaseName: PHASES[phase],
      phaseOrder: phase + 1,
    };
  }),
);

const ASSIGNMENTS: AssignmentRow[] = PROCESSES.flatMap(([code, , , lead], pi) => {
  const mk = (id: string, type: AssignmentType): AssignmentRow => ({
    processId: code,
    personId: id,
    personName: demoName(id),
    type,
  });
  return [
    mk(lead, "production_lead"),
    mk(pi % 2 ? "p-rijin" : "p-anna", "team_member"),
    mk("p-fayis", "reviewer"),
    mk("p-ali", "supporting_role"),
  ];
});

const SEES_ALL: RoleName[] = ["project_head", "project_lead", "system_admin", "dashboard_lead"];
const seesAll = (p: Persona) => p.roles.some((r) => SEES_ALL.includes(r));
const visibleProcesses = (p: Persona) =>
  seesAll(p)
    ? new Set(PROCESSES.map((x) => x[0]))
    : new Set(ASSIGNMENTS.filter((a) => a.personId === p.personId).map((a) => a.processId));

export const demoRows = (p: Persona) => {
  const ok = visibleProcesses(p);
  return ALL_ROWS.filter((r) => ok.has(r.processId));
};
export const demoAssignments = (p: Persona) => {
  const ok = visibleProcesses(p);
  return ASSIGNMENTS.filter((a) => ok.has(a.processId));
};
export const demoCapabilities = (p: Persona): Capabilities => {
  const assignments = new Map<string, Set<AssignmentType>>();
  for (const a of ASSIGNMENTS.filter((x) => x.personId === p.personId)) {
    const set = assignments.get(a.processId) ?? new Set<AssignmentType>();
    set.add(a.type);
    assignments.set(a.processId, set);
  }
  return { personId: p.personId, roles: new Set(p.roles), assignments };
};
export const demoDeadline = () => new Date(Date.now() + 26 * 86_400_000).toISOString();

export const demoOrg = (): OrgData => ({
  people: PEOPLE.map(([id, name]) => ({ id, displayName: name, firstName: name.split(" ")[0] })),
  roleTags: new Map(PERSONAS.map((p) => [p.personId, new Set<RoleName>(p.roles)])),
  teams: [
    {
      id: "t1",
      name: "Team Pavithra",
      leadPersonId: "p-pavithra",
      memberIds: ["p-anna", "p-sara"],
    },
    { id: "t2", name: "Team Rustham", leadPersonId: "p-rustham", memberIds: ["p-rijin"] },
  ],
});

export const demoNotifications = (p: Persona): NotificationRow[] => {
  const rows = demoRows(p);
  const pick = (stage: Stage) => rows.find((r) => r.stage === stage);
  const items: [string, string, SubprocessRow | undefined, boolean, number][] = [
    ["review_requested", "A step is ready for review", pick("review"), false, 2],
    [
      "status_changed",
      "A step was marked Blocked",
      rows.find((r) => r.status === "blocked"),
      false,
      9,
    ],
    ["production_completed", "A step reached Production", pick("production"), true, 30],
    ["comment_added", "A new comment was added", pick("solution_building"), true, 52],
  ];
  return items
    .filter(([, , r]) => r)
    .map(([type, msg, r, read, h], i) => ({
      id: `n${i}`,
      eventType: type,
      message: `${msg}: ${r!.processCode} ${r!.processTitle}, step ${r!.seq}.`,
      isRead: read,
      createdAt: hoursAgo(h),
      processCode: r!.processCode,
    }));
};

export const demoRecords = (p: Persona, subIds: string[]): Records => {
  const ok = new Set(subIds);
  const rows = demoRows(p).filter((r) => ok.has(r.id));
  const rec: Records = {
    comments: [],
    reviewPoints: [],
    documents: [],
    testing: [],
    approvals: [],
    names: new Map(PEOPLE.map(([id, n]) => [id, n])),
  };
  for (const r of rows) {
    const lead = PROCESSES.find((x) => x[0] === r.processId)![3];
    if (r.seq === 1) {
      rec.documents.push({
        id: `${r.id}-doc`,
        subprocess_id: r.id,
        review_point_id: null,
        original_filename: `Process-notes-${r.processCode}.docx`,
        created_at: hoursAgo(80),
        document_versions: [
          {
            id: `${r.id}-v1`,
            version_number: 1,
            original_filename: `Process-notes-${r.processCode}.docx`,
            file_size: 48_200,
            version_note: "First draft",
            uploaded_by: "p-anna",
            uploaded_at: hoursAgo(80),
            is_current: false,
          },
          {
            id: `${r.id}-v2`,
            version_number: 2,
            original_filename: `Process-notes-${r.processCode}.docx`,
            file_size: 51_900,
            version_note: "Updated after review",
            uploaded_by: lead,
            uploaded_at: hoursAgo(20),
            is_current: true,
          },
        ],
      } satisfies DocumentRec);
    }
    if (r.seq === 2) {
      rec.comments.push({
        id: `${r.id}-c1`,
        subprocess_id: r.id,
        review_point_id: null,
        parent_comment_id: null,
        author_id: lead,
        comment_text: "Sample comment: the first run looks good, checking edge cases next.",
        created_at: hoursAgo(12),
      } satisfies CommentRec);
    }
    if (r.stage === "testing" || r.stage === "review" || r.stage === "production") {
      rec.testing.push({
        id: `${r.id}-t1`,
        subprocess_id: r.id,
        submitted_by: "p-anna",
        result: "pass",
        notes: "All sample cases passed.",
        evidence_document_id: null,
        created_at: hoursAgo(40),
      } satisfies TestingRec);
    }
    if (r.stage === "review") {
      rec.reviewPoints.push({
        id: `${r.id}-rp1`,
        subprocess_id: r.id,
        raised_by: "p-fayis",
        assigned_to_person_id: lead,
        description: "Sample review point: please explain how exceptions are handled.",
        status: "open",
        resolution_note: null,
        submitted_at: null,
        closed_by: null,
        closed_at: null,
        created_at: hoursAgo(6),
        owner: { display_name: demoName(lead) },
      } satisfies ReviewPointRec);
    }
    if (r.stage === "production") {
      rec.approvals.push({
        id: `${r.id}-a1`,
        subprocess_id: r.id,
        review_point_id: null,
        approval_type: "production_entry",
        decision: "approved",
        decided_by: "p-karthik",
        decision_note: "Ready for the website build.",
        decided_at: hoursAgo(10),
      } satisfies ApprovalRec);
    }
  }
  return rec;
};

export const demoDocuments = (p: Persona): DocumentRec[] =>
  demoRecords(
    p,
    demoRows(p).map((r) => r.id),
  ).documents;

export const demoProcess = (code: string) => {
  const x = PROCESSES.find((y) => y[0] === code);
  return x
    ? {
        title: x[1],
        description: "Sample process for the prototype demo.",
        source_reference: "Demo",
        context: {
          before_ai_steps: [
            "A team member collects the inputs by hand.",
            "The data is copied into a spreadsheet and checked line by line.",
            "A manager reviews the result and sends corrections back by email.",
          ],
        },
      }
    : null;
};

export const demoActivity = (p: Persona) => {
  const rows = demoRows(p);
  const kinds: [string, unknown, unknown, string][] = [
    ["status_changed", "not_started", "in_progress", "p-anna"],
    ["stage_changed", "solution_building", "testing", "p-pavithra"],
    ["testing_recorded", null, "pass", "p-anna"],
    ["review_point_raised", null, "open", "p-fayis"],
    ["document_uploaded", null, "Process-notes.docx", "p-anna"],
    ["comment_added", null, "comment", "p-rustham"],
  ];
  return rows.slice(0, 18).map((r, i) => {
    const [action, prev, next, actor] = kinds[i % kinds.length];
    return {
      id: 1000 - i,
      actor_id: actor,
      action_type: action,
      entity_type: "subprocess",
      previous_value: prev,
      new_value: next,
      process_id: r.processId,
      created_at: hoursAgo(1 + i * 5),
    };
  });
};

export const demoProfiles = () => [
  {
    id: "u1",
    email: "sara.k@example.com",
    full_name: "Sara K",
    person_id: null,
    approval_state: "pending" as const,
    is_active: true,
    created_at: hoursAgo(5),
  },
  {
    id: "u2",
    email: "rijin@example.com",
    full_name: "Rijin",
    person_id: null,
    approval_state: "pending" as const,
    is_active: true,
    created_at: hoursAgo(30),
  },
  ...PERSONAS.map((x, i) => ({
    id: `m${i}`,
    email: `${x.person.toLowerCase().replace(/\s+/g, ".")}@example.com`,
    full_name: x.person,
    person_id: x.personId,
    approval_state: "approved" as const,
    is_active: true,
    created_at: hoursAgo(300 + i),
  })),
];

export const demoExportRequests = () => [
  {
    id: "x1",
    requested_by: "p-aditya",
    requested_at: hoursAgo(72),
    note: "Sample request",
    status: "completed" as const,
    decided_at: hoursAgo(60),
    decision_note: null,
    completed_at: hoursAgo(58),
    file_count: 12,
    missing_count: 0,
  },
];
