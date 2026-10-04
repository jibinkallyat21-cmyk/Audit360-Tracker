import { spawn, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgrestClient } from "@supabase/postgrest-js";
import {
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
import { setup, TEST_URL, type Db } from "./harness";

interface SubRow {
  current_stage: string;
  processes: { process_code: string; phases: { name: string; display_order: number } };
}
const BIN = process.env.POSTGREST_BIN;
const SECRET = "test-secret-test-secret-test-secret-123";
const PORT = 3999;

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
function jwt(sub: string) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ role: "authenticated", sub, exp: Math.floor(Date.now() / 1000) + 600 });
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
    await db.admin.query("grant anon, authenticated to authenticator");
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

  it("serves nothing without a valid user token", async () => {
    const anon = new PostgrestClient(`http://127.0.0.1:${PORT}`);
    const r = await anon.from("subprocesses").select("id");
    expect(r.error).not.toBeNull();
  });
});
