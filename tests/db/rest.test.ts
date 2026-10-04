import { spawn, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgrestClient } from "@supabase/postgrest-js";
import {
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

  it("serves nothing without a valid user token", async () => {
    const anon = new PostgrestClient(`http://127.0.0.1:${PORT}`);
    const r = await anon.from("subprocesses").select("id");
    expect(r.error).not.toBeNull();
  });
});
