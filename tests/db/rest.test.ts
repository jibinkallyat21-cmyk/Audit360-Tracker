import { spawn, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgrestClient } from "@supabase/postgrest-js";
import {
  NOTIFICATIONS_SELECT,
  PEOPLE_SELECT,
  ROLE_TAGS_SELECT,
  TEAMS_SELECT,
  ACTIVITY_SELECT,
  APPROVALS_SELECT,
  COMMENTS_SELECT,
  DOCUMENTS_SELECT,
  REVIEW_POINTS_SELECT,
  TESTING_SELECT,
  ASSIGNMENT_SELECT,
  PERSON_ROLES_SELECT,
  PROCESS_DETAIL_SELECT,
  SUBPROCESS_SELECT,
} from "../../src/lib/queries";
import { TABLES } from "../../src/lib/export/build";
import { setup, TEST_URL, type Db } from "./harness";

interface SubRow {
  current_stage: string;
  processes: { process_code: string; phases: { name: string; display_order: number } };
}
const BIN = process.env.POSTGREST_BIN;
const SECRET = "test-secret-test-secret-test-secret-123";
const PORT = 3999;

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
function jwt(sub: string, role = "authenticated") {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ role, sub, exp: Math.floor(Date.now() / 1000) + 600 });
  const sig = createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

/** Runs the exact queries the pages use through PostgREST, the API layer Supabase uses. */
describe.skipIf(!TEST_URL || !BIN)("page queries through PostgREST", () => {
  let db: Db;
  let server: ChildProcess;
  const client = (user: string) =>
    new PostgrestClient(`http://127.0.0.1:${PORT}`, {
      headers: { Authorization: `Bearer ${jwt(db.users[user])}` },
    });

  beforeAll(async () => {
    db = await setup();
    await db.admin.query(`do $$ begin
      if not exists (select 1 from pg_roles where rolname='authenticator') then
        create role authenticator noinherit login; end if; end $$`);
    await db.admin.query("grant anon, authenticated, service_role to authenticator");
    const uri = new URL(TEST_URL!);
    uri.pathname = "/" + (db.admin as unknown as { database: string }).database;
    server = spawn(BIN!, [], {
      env: {
        ...process.env,
        PGRST_DB_URI: uri.toString().replace("postgres://postgres@", "postgres://authenticator@"),
        PGRST_DB_SCHEMAS: "public",
        PGRST_DB_ANON_ROLE: "anon",
        PGRST_JWT_SECRET: SECRET,
        PGRST_SERVER_PORT: String(PORT),
      },
      stdio: "ignore",
    });
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) return;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error("PostgREST did not start");
  });
  afterAll(async () => {
    server?.kill();
    await db?.close();
  });

  it("returns subprocess rows in the shape the app maps, scoped to the user", async () => {
    const { data, error } = await client("rijin").from("subprocesses").select(SUBPROCESS_SELECT);
    expect(error).toBeNull();
    const rows = data as unknown as SubRow[];
    const codes = new Set(rows.map((r) => r.processes.process_code));
    expect([...codes].sort()).toEqual(["1.1", "1.2", "3.4"]);
    const first = rows[0];
    expect(first.processes.phases.name).toEqual(expect.any(String));
    expect(first.processes.phases.display_order).toEqual(expect.any(Number));
    expect(first.current_stage).toBe("process_definition");
  });

  it("returns assignments, roles, settings and the process detail", async () => {
    const a = await client("rijin").from("process_assignments").select(ASSIGNMENT_SELECT);
    expect(a.error).toBeNull();
    expect(
      (a.data as unknown as { people: { display_name: string } }[])[0].people.display_name,
    ).toEqual(expect.any(String));

    const me = await db.person("Jibin K K");
    const r = await client("jibin")
      .from("person_roles")
      .select(PERSON_ROLES_SELECT)
      .eq("person_id", me);
    expect(
      (r.data as unknown as { roles: { name: string } }[]).map((x) => x.roles.name).sort(),
    ).toEqual(["dashboard_lead", "system_admin"]);

    const s = await client("rijin")
      .from("project_settings")
      .select("setting_value")
      .eq("setting_key", "project_deadline")
      .maybeSingle();
    expect(s.error).toBeNull();
    expect(s.data).toBeNull();

    const own = await db.process("1.1");
    const d = await client("rijin")
      .from("processes")
      .select(PROCESS_DETAIL_SELECT)
      .eq("id", own)
      .single();
    expect(d.data?.title).toBe("Lead Scoring & Proposal Generation");
    expect(
      (d.data?.context as { before_ai_steps: string[] }).before_ai_steps.length,
    ).toBeGreaterThan(0);
  });

  it("returns nothing for another team's process, even by exact ID", async () => {
    const foreign = await db.process("6.1");
    const d = await client("rijin")
      .from("processes")
      .select(PROCESS_DETAIL_SELECT)
      .eq("id", foreign)
      .single();
    expect(d.data).toBeNull();
    const s = await client("rijin").from("subprocesses").select("id").eq("process_id", foreign);
    expect(s.data).toEqual([]);
  });

  it("runs the workflow functions over the API and relays the database's rejections", async () => {
    const sub = await db.sub("1.1", 1);
    const denied = await client("rijin").rpc("set_status", { p_sub: sub, p_status: "in_progress" });
    expect(denied.error?.message).toMatch(/Not authorized/);
    const ok = await client("pavithra").rpc("set_status", { p_sub: sub, p_status: "in_progress" });
    expect(ok.error).toBeNull();
    const rule = await client("pavithra").rpc("set_status", { p_sub: sub, p_status: "completed" });
    expect(rule.error?.message).toMatch(/cannot be set directly/);
    const direct = await client("rijin")
      .from("subprocesses")
      .update({ current_stage: "production" })
      .eq("id", sub);
    expect(direct.error?.message).toMatch(/permission denied/);
  });

  it("returns records with their joins, scoped to people on the process", async () => {
    const sub = await db.sub("1.2", 2);
    const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const ok = async (p: PromiseLike<{ error: { message: string } | null }>) =>
      expect((await p).error).toBeNull();
    const pav = client("pavithra");
    const rij = client("rijin");
    await ok(pav.rpc("set_status", { p_sub: sub, p_status: "in_progress" }));
    await ok(pav.rpc("complete_stage", { p_sub: sub }));
    await ok(pav.rpc("set_status", { p_sub: sub, p_status: "in_progress" }));
    await ok(pav.rpc("complete_stage", { p_sub: sub }));
    const up = (path: string, doc: string | null) =>
      rij.rpc("register_document_version", {
        p_sub: sub,
        p_rp: null,
        p_document: doc,
        p_filename: "plan.docx",
        p_storage_path: path,
        p_size: 100,
        p_mime: DOCX,
        p_note: null,
      });
    await ok(up("rest/1", null));
    const docId = (await rij.from("documents").select("id").eq("subprocess_id", sub).single()).data!
      .id;
    await ok(up("rest/2", docId));
    await ok(
      rij.rpc("record_testing", {
        p_sub: sub,
        p_result: "pass",
        p_notes: "fine",
        p_evidence_document: docId,
      }),
    );
    await ok(rij.rpc("add_comment", { p_sub: sub, p_text: "hello", p_parent: null, p_rp: null }));
    await ok(
      client("fayis").rpc("raise_review_point", {
        p_sub: sub,
        p_description: "Check totals",
        p_owner_person: await db.person("Rijin"),
      }),
    );

    const docs = await rij.from("documents").select(DOCUMENTS_SELECT).eq("subprocess_id", sub);
    const versions = (
      docs.data as unknown as {
        document_versions: { version_number: number; is_current: boolean }[];
      }[]
    )[0].document_versions;
    expect(docs.error).toBeNull();
    expect(versions.map((v) => [v.version_number, v.is_current]).sort()).toEqual([
      [1, false],
      [2, true],
    ]);

    const rps = await rij
      .from("review_points")
      .select(REVIEW_POINTS_SELECT)
      .eq("subprocess_id", sub);
    expect(rps.error).toBeNull();
    expect(
      (rps.data as unknown as { owner: { display_name: string } }[])[0].owner.display_name,
    ).toBe("Rijin");
    for (const [table, select] of [
      ["comments", COMMENTS_SELECT],
      ["testing_records", TESTING_SELECT],
      ["approvals", APPROVALS_SELECT],
    ] as const) {
      const r = await rij
        .from(table as string)
        .select(select as string)
        .eq("subprocess_id", sub);
      expect(r.error, table).toBeNull();
    }
    const tests = await rij.from("testing_records").select(TESTING_SELECT).eq("subprocess_id", sub);
    expect(tests.data).toHaveLength(1);

    const log = await rij
      .from("activity_logs")
      .select(ACTIVITY_SELECT)
      .or("action_type.ilike.%document%,entity_type.ilike.%document%")
      .order("id", { ascending: false })
      .range(0, 10);
    expect(log.error).toBeNull();
    expect(
      (log.data as unknown as { action_type: string }[]).map((l) => l.action_type).sort(),
    ).toEqual(["document_replaced", "document_uploaded"]);

    const names = await rij.rpc("actor_names", { p_ids: [db.users.pavithra, db.users.fayis] });
    expect((names.data as { display_name: string }[]).map((n) => n.display_name).sort()).toEqual([
      "Fayis",
      "Pavithra",
    ]);

    // Someone on another team gets nothing from any of it.
    const other = client("rustham");
    for (const [table, select] of [
      ["documents", DOCUMENTS_SELECT],
      ["review_points", REVIEW_POINTS_SELECT],
      ["comments", COMMENTS_SELECT],
      ["testing_records", TESTING_SELECT],
      ["approvals", APPROVALS_SELECT],
      ["activity_logs", ACTIVITY_SELECT],
    ] as const) {
      const r = await other
        .from(table as string)
        .select(select as string)
        .eq("subprocess_id", sub);
      expect(r.data ?? [], table).toEqual([]);
    }
    const hiddenVersions = await other.from("document_versions").select("id");
    expect(hiddenVersions.data).toEqual([]);
  });

  it("serves notifications, the team structure and the admin account list", async () => {
    const rij = client("rijin");
    // Rijin was notified of the document upload earlier in this file's flow.
    const proc = await db.process("1.1");
    await client("jibin").rpc("admin_set_assignment", {
      p_process: proc,
      p_person: await db.person("Rijin"),
      p_type: "reviewer",
      p_assigned: true,
    });
    const n = await rij
      .from("notifications")
      .select(NOTIFICATIONS_SELECT)
      .order("created_at", { ascending: false });
    expect(n.error).toBeNull();
    const first = (
      n.data as unknown as {
        id: string;
        is_read: boolean;
        processes: { process_code: string } | null;
      }[]
    )[0];
    expect(first.processes?.process_code).toBe("1.1");
    const mark = await rij.rpc("mark_notification_read", { p_id: first.id });
    expect(mark.error).toBeNull();
    const after = await rij.from("notifications").select("is_read").eq("id", first.id).single();
    expect(after.data?.is_read).toBe(true);
    const count = await rij
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("is_read", false);
    expect(count.error).toBeNull();

    const people = await rij.from("people").select(PEOPLE_SELECT);
    expect(people.data).toHaveLength(40);
    const tags = await rij.from("person_roles").select(ROLE_TAGS_SELECT);
    expect(tags.error).toBeNull();
    const teams = await rij.from("teams").select(TEAMS_SELECT);
    const t = teams.data as unknown as { name: string; team_members: { person_id: string }[] }[];
    expect(t.map((x) => [x.name, x.team_members.length]).sort()).toEqual([
      ["Team Pavithra", 13],
      ["Team Rustham", 13],
    ]);

    const cols = "id, email, full_name, person_id, approval_state, is_active, created_at";
    const asAdmin = await client("jibin").from("profiles").select(cols);
    expect((asAdmin.data ?? []).length).toBeGreaterThan(5);
    const asUser = await rij.from("profiles").select(cols);
    expect((asUser.data ?? []).map((p) => p.id)).toEqual([db.users.rijin]);
  });

  it("reads every export table with the exact columns the export lists, as the service role", async () => {
    const service = new PostgrestClient(`http://127.0.0.1:${PORT}`, {
      headers: {
        Authorization: `Bearer ${jwt("00000000-0000-0000-0000-000000000000", "service_role")}`,
      },
    });
    for (const t of TABLES) {
      const r = await service
        .from(t.name)
        .select(t.columns.join(","))
        .order(t.columns[0])
        .range(0, 999);
      expect(r.error, t.name).toBeNull();
    }
    const people = await service.from("people").select("id");
    expect(people.data).toHaveLength(40);
    // The service role sees records that ordinary users cannot, which is why the export route
    // checks the administrator role and an approved request first.
    const notes = await service.from("activity_logs").select("id", { count: "exact", head: true });
    expect(notes.count).toBeGreaterThan(0);
  });

  it("keeps export requests out of reach of ordinary users over the API", async () => {
    const r = await client("rijin").from("export_requests").select("id");
    expect(r.data ?? []).toEqual([]);
    const rpc = await client("rijin").rpc("request_export", { p_note: null });
    expect(rpc.error?.message).toMatch(/Not authorized/);
    const direct = await client("jibin")
      .from("export_requests")
      .insert({ requested_by: db.users.jibin });
    expect(direct.error?.message).toMatch(/permission denied/);
  });

  it("serves nothing without a valid user token", async () => {
    const anon = new PostgrestClient(`http://127.0.0.1:${PORT}`);
    const r = await anon.from("subprocesses").select("id");
    expect(r.error).not.toBeNull();
  });
});
