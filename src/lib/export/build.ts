import { createHash } from "node:crypto";
import { Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { sanitizeFilename } from "@/lib/files";
import { toCsv } from "./csv";

type Row = Record<string, unknown>;

/** Every table in the archive, with explicit columns so empty tables still get a header. */
export const TABLES: { name: string; columns: string[] }[] = [
  { name: "phases", columns: ["id", "name", "display_order"] },
  {
    name: "processes",
    columns: [
      "id",
      "process_code",
      "title",
      "description",
      "phase_id",
      "source_reference",
      "context",
      "created_at",
      "updated_at",
    ],
  },
  {
    name: "subprocesses",
    columns: [
      "id",
      "process_id",
      "seq",
      "title",
      "current_stage",
      "current_status",
      "review_decision",
      "dashboard_status",
      "stage_entered_at",
      "evidence_changed_at",
      "created_at",
      "updated_at",
      "updated_by",
    ],
  },
  { name: "people", columns: ["id", "display_name", "first_name", "created_at"] },
  { name: "roles", columns: ["id", "name", "description"] },
  { name: "person_roles", columns: ["person_id", "role_id"] },
  { name: "teams", columns: ["id", "name", "production_lead_person_id"] },
  { name: "team_members", columns: ["team_id", "person_id"] },
  {
    name: "process_assignments",
    columns: ["id", "process_id", "person_id", "assignment_type", "assigned_by", "assigned_at"],
  },
  {
    name: "testing_records",
    columns: [
      "id",
      "subprocess_id",
      "submitted_by",
      "result",
      "notes",
      "evidence_document_id",
      "created_at",
    ],
  },
  {
    name: "review_points",
    columns: [
      "id",
      "subprocess_id",
      "raised_by",
      "assigned_to_person_id",
      "description",
      "status",
      "resolution_note",
      "submitted_at",
      "closed_by",
      "closed_at",
      "created_at",
      "updated_at",
    ],
  },
  {
    name: "comments",
    columns: [
      "id",
      "subprocess_id",
      "review_point_id",
      "parent_comment_id",
      "author_id",
      "comment_text",
      "created_at",
    ],
  },
  {
    name: "approvals",
    columns: [
      "id",
      "subprocess_id",
      "review_point_id",
      "approval_type",
      "decision",
      "decided_by",
      "decision_note",
      "decided_at",
    ],
  },
  {
    name: "documents",
    columns: [
      "id",
      "subprocess_id",
      "review_point_id",
      "original_filename",
      "uploaded_by",
      "created_at",
    ],
  },
  {
    name: "document_versions",
    columns: [
      "id",
      "document_id",
      "version_number",
      "original_filename",
      "storage_path",
      "file_size",
      "mime_type",
      "version_note",
      "uploaded_by",
      "uploaded_at",
      "is_current",
    ],
  },
  {
    name: "activity_logs",
    columns: [
      "id",
      "actor_id",
      "action_type",
      "entity_type",
      "entity_id",
      "previous_value",
      "new_value",
      "process_id",
      "subprocess_id",
      "metadata",
      "created_at",
    ],
  },
  {
    name: "project_settings",
    columns: ["setting_key", "setting_value", "updated_by", "updated_at"],
  },
  {
    name: "export_requests",
    columns: [
      "id",
      "requested_by",
      "requested_at",
      "note",
      "status",
      "decided_by",
      "decided_at",
      "decision_note",
      "completed_at",
      "file_count",
      "missing_count",
    ],
  },
  {
    name: "profiles",
    columns: ["id", "email", "full_name", "person_id", "approval_state", "is_active", "created_at"],
  },
];

export interface ExportSource {
  requestId: string;
  generatedAt: Date;
  fetchTable(name: string): Promise<Row[]>;
  /** Returns the file bytes, or null when the stored file cannot be found. */
  downloadFile(storagePath: string): Promise<Uint8Array | null>;
  /** Called once all files are gathered, before the manifest is written. */
  onGathered(files: number, missing: number): Promise<void>;
}

export const sha256 = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");

export type ManifestRow = {
  path: string;
  kind: "data" | "document";
  process_code: string;
  subprocess_id: string;
  step: string;
  document_id: string;
  version_number: string;
  original_filename: string;
  storage_path: string;
  version_status: string;
  bytes: string;
  sha256: string;
  included: "yes" | "no";
};
export const MANIFEST_COLUMNS = [
  "path",
  "kind",
  "process_code",
  "subprocess_id",
  "step",
  "document_id",
  "version_number",
  "original_filename",
  "storage_path",
  "version_status",
  "bytes",
  "sha256",
  "included",
] as const;

export function readmeText(opts: {
  requestId: string;
  generatedAt: Date;
  tables: number;
  files: number;
  missing: number;
}): string {
  return `TRACKER & REVIEW - PROJECT EXPORT
Generated: ${opts.generatedAt.toISOString()}
Export request: ${opts.requestId}

CONTENTS
  README.txt           This file.
  MANIFEST.csv         Every file in this archive: where it came from (process, step, document,
                       version), its size and its SHA-256 checksum.
  CHECKSUMS.sha256     Checksums in the standard format. Verify with:  sha256sum -c CHECKSUMS.sha256
  data/                ${opts.tables} CSV tables (UTF-8, comma separated, opens in Excel).
  documents/<process>/step-<n>/   Every uploaded file, including superseded versions.
                       File names are <document id>_v<version>_<original name>.

DATA FILES
  Raw tables use database ids; people.csv, process_assignments.csv and process tables link them.
  Readable summaries:
    assignments_readable.csv     Who is assigned to which process, by name and role.
    status_stage_history.csv     Every status, stage, review-decision and build-status change,
                                 with the previous and new value, who and when.
    countdown_history.csv        The project deadline and every change to it.
  activity_logs.csv is the complete append-only history.

DOCUMENTS
  ${opts.files} document versions are listed in the manifest; ${opts.missing} could not be retrieved
  from storage.${opts.missing > 0 ? " Those rows are marked included=no. They were NOT silently dropped; investigate before decommissioning." : ""}
  Versions marked "superseded" were replaced by a later version and are kept for traceability.

NOTES
  - Text cells that begin with = + - or @ are prefixed with a single quote so spreadsheet programs do
    not run them as formulas. The database holds the original text.
  - In-app notifications are not included; they are informational copies of events that appear in
    activity_logs.csv.
  - The export's own completion is recorded in the live system after this snapshot was taken.
  - Retention: keep this archive in an access-controlled location for the approved retention period
    (one year). Delete only after written approval.
`;
}

const rowsOf = (r: Row[], key: string) => new Map(r.map((x) => [String(x[key]), x]));

/** Builds the archive. Files are added as they are read, so memory stays low. */
export async function writeExport(
  source: ExportSource,
  add: (path: string, data: Uint8Array, compress: boolean) => void,
) {
  const manifest: ManifestRow[] = [];
  const checksums: string[] = [];
  const enc = new TextEncoder();
  const addData = (path: string, text: string) => {
    const bytes = enc.encode(text);
    add(path, bytes, true);
    manifest.push({
      path,
      kind: "data",
      process_code: "",
      subprocess_id: "",
      step: "",
      document_id: "",
      version_number: "",
      original_filename: "",
      storage_path: "",
      version_status: "",
      bytes: String(bytes.length),
      sha256: sha256(bytes),
      included: "yes",
    });
    checksums.push(`${sha256(bytes)}  ${path}`);
  };

  const t: Record<string, Row[]> = {};
  for (const table of TABLES) {
    t[table.name] = await source.fetchTable(table.name);
    addData(`data/${table.name}.csv`, toCsv(table.columns, t[table.name]));
  }

  // Readable summaries.
  const processes = rowsOf(t.processes, "id");
  const people = rowsOf(t.people, "id");
  const subs = rowsOf(t.subprocesses, "id");
  const profiles = rowsOf(t.profiles, "id");
  const personName = (id: unknown) => String(people.get(String(id))?.display_name ?? "");
  const actorName = (id: unknown) =>
    personName(profiles.get(String(id))?.person_id) ||
    String(profiles.get(String(id))?.full_name ?? "");

  addData(
    "data/assignments_readable.csv",
    toCsv(
      ["process_code", "process_title", "person", "assignment_type"],
      t.process_assignments.map((a) => ({
        process_code: processes.get(String(a.process_id))?.process_code,
        process_title: processes.get(String(a.process_id))?.title,
        person: personName(a.person_id),
        assignment_type: a.assignment_type,
      })),
    ),
  );
  const HISTORY = [
    "status_changed",
    "stage_changed",
    "production_completed",
    "review_decision",
    "dashboard_status_changed",
  ];
  addData(
    "data/status_stage_history.csv",
    toCsv(
      ["when", "who", "process_code", "step", "action", "previous", "new"],
      t.activity_logs
        .filter((l) => HISTORY.includes(String(l.action_type)))
        .map((l) => ({
          when: l.created_at,
          who: actorName(l.actor_id),
          process_code: processes.get(String(l.process_id))?.process_code,
          step: subs.get(String(l.subprocess_id))?.seq,
          action: l.action_type,
          previous: l.previous_value,
          new: l.new_value,
        })),
    ),
  );
  addData(
    "data/countdown_history.csv",
    toCsv(
      ["when", "who", "previous_deadline", "new_deadline"],
      t.activity_logs
        .filter((l) => l.action_type === "deadline_set")
        .map((l) => ({
          when: l.created_at,
          who: actorName(l.actor_id),
          previous_deadline: l.previous_value,
          new_deadline: l.new_value,
        })),
    ),
  );

  // Documents: every version, current and superseded.
  const docs = rowsOf(t.documents, "id");
  let files = 0;
  let missing = 0;
  for (const v of t.document_versions) {
    const doc = docs.get(String(v.document_id));
    const sub = subs.get(String(doc?.subprocess_id));
    const code = String(processes.get(String(sub?.process_id))?.process_code ?? "unknown");
    const name = sanitizeFilename(String(v.original_filename));
    const path = `documents/${code}/step-${sub?.seq ?? "x"}/${String(v.document_id).slice(0, 8)}_v${v.version_number}_${name}`;
    const bytes = await source.downloadFile(String(v.storage_path));
    files++;
    const base = {
      path,
      kind: "document" as const,
      process_code: code,
      subprocess_id: String(doc?.subprocess_id ?? ""),
      step: String(sub?.seq ?? ""),
      document_id: String(v.document_id),
      version_number: String(v.version_number),
      original_filename: String(v.original_filename),
      storage_path: String(v.storage_path),
      version_status: v.is_current ? "current" : "superseded",
    };
    if (!bytes) {
      missing++;
      manifest.push({ ...base, bytes: "", sha256: "", included: "no" });
      continue;
    }
    add(path, bytes, false);
    const hash = sha256(bytes);
    manifest.push({ ...base, bytes: String(bytes.length), sha256: hash, included: "yes" });
    checksums.push(`${hash}  ${path}`);
  }

  await source.onGathered(files, missing);

  const manifestCsv = toCsv(MANIFEST_COLUMNS, manifest);
  add("MANIFEST.csv", enc.encode(manifestCsv), true);
  checksums.push(`${sha256(manifestCsv)}  MANIFEST.csv`);
  add("CHECKSUMS.sha256", enc.encode(checksums.join("\n") + "\n"), true);
  add(
    "README.txt",
    enc.encode(
      readmeText({
        requestId: source.requestId,
        generatedAt: source.generatedAt,
        tables: TABLES.length + 3,
        files,
        missing,
      }),
    ),
    true,
  );
  return { files, missing };
}

/** Streams the archive as a ZIP. Office files are stored as-is; CSV text is compressed. */
export function createExportStream(source: ExportSource): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const zip = new Zip((err, chunk, final) => {
        if (err) return controller.error(err);
        controller.enqueue(chunk);
        if (final) controller.close();
      });
      try {
        await writeExport(source, (path, data, compress) => {
          const entry = compress ? new ZipDeflate(path, { level: 6 }) : new ZipPassThrough(path);
          zip.add(entry);
          entry.push(data, true);
        });
        zip.end();
      } catch (e) {
        controller.error(e);
      }
    },
  });
}
