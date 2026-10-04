import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findMissingFiles } from "../../src/lib/restore-check";
import { databaseUrl, emptyDatabase, setup, TEST_URL, type Db } from "./harness";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const hasPg =
  spawnSync("pg_dump", ["--version"]).status === 0 && spawnSync("psql", ["--version"]).status === 0;

/**
 * Rehearses the documented backup and restore: dump the data, load it into a fresh project that
 * already has the schema, and prove the restored records, history and file references match.
 */
describe.skipIf(!TEST_URL || !hasPg)("backup and restore drill", () => {
  let db: Db;
  let target: Awaited<ReturnType<typeof emptyDatabase>>;
  let dump: string;

  const run = (user: string, sql: string, params: unknown[] = []) =>
    db.as(db.users[user], (q) => q.query(sql, params));
  const TABLES = [
    "phases",
    "processes",
    "subprocesses",
    "people",
    "roles",
    "person_roles",
    "teams",
    "team_members",
    "process_assignments",
    "testing_records",
    "review_points",
    "comments",
    "approvals",
    "documents",
    "document_versions",
    "activity_logs",
    "project_settings",
    "profiles",
    "notifications",
    "export_requests",
  ];
  const fingerprint = async (
    c: { query: (s: string) => Promise<{ rows: { h: string }[] }> },
    t: string,
  ) =>
    (
      await c.query(
        `select count(*) || ':' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '') h from ${t} x`,
      )
    ).rows[0].h;

  beforeAll(async () => {
    db = await setup();
    // Some real activity to carry across.
    const sub = await db.sub("1.1", 1);
    await run("pavithra", "select set_status($1,'in_progress')", [sub]);
    await run("rijin", "select add_comment($1,'before the backup')", [sub]);
    await run("rijin", "select register_document_version($1,null,null,'a.docx','drill/1',500,$2)", [
      sub,
      DOCX,
    ]);
    await run("jibin", "select set_deadline('2031-01-01T00:00:00Z')");
    target = await emptyDatabase();
    const r = spawnSync(
      "pg_dump",
      ["--data-only", "--no-owner", "-n", "public", "-n", "auth", databaseUrl(db)],
      {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    expect(r.status, r.stderr).toBe(0);
    dump = r.stdout;
  });
  afterAll(async () => {
    await target?.drop();
    await db?.close();
  });

  it("restores every table exactly, using the documented replica-mode load", async () => {
    // session_replication_role = replica keeps triggers from re-creating notifications or history.
    const load = spawnSync(
      "psql",
      [
        target.url,
        "-v",
        "ON_ERROR_STOP=1",
        "--single-transaction",
        "-c",
        "set session_replication_role = replica",
        "-f",
        "-",
      ],
      { input: dump, encoding: "utf8" },
    );
    expect(load.status, load.stderr).toBe(0);
    for (const t of TABLES) {
      expect(await fingerprint(target.client, "public." + t), t).toBe(
        await fingerprint(db.admin, "public." + t),
      );
    }
  });

  it("keeps history append-only and numbering continuous after the restore", async () => {
    const max = (await target.client.query("select max(id) m from activity_logs")).rows[0].m;
    await target.client.query(
      "select public.log_activity(null,'drill','x','x',null,null,null,null)",
    );
    const next = (await target.client.query("select max(id) m from activity_logs")).rows[0].m;
    expect(Number(next)).toBe(Number(max) + 1);
    await expect(target.client.query("update activity_logs set action_type='x'")).rejects.toThrow(
      /append-only/,
    );
  });

  it("enforces the same access rules on the restored data", async () => {
    const as = async (user: string, sql: string) => {
      await target.client.query("begin");
      await target.client.query("set local role authenticated");
      await target.client.query("select set_config('request.jwt.claim.sub', $1, true)", [
        db.users[user],
      ]);
      try {
        return (await target.client.query(sql)).rows;
      } finally {
        await target.client.query("rollback");
      }
    };
    expect(
      (await as("rijin", "select process_code from processes order by 1")).map(
        (r) => r.process_code,
      ),
    ).toEqual(["1.1", "1.2", "3.4"]);
    expect((await as("rustham", "select count(*) c from comments"))[0].c).toBe("0");
    expect((await as("rijin", "select count(*) c from comments"))[0].c).toBe("1");
    const deadline = (
      await as(
        "shonJ",
        "select setting_value v from project_settings where setting_key='project_deadline'",
      )
    )[0].v;
    expect(new Date(deadline).toISOString()).toBe("2031-01-01T00:00:00.000Z");
  });

  it("finds a stored version whose file did not survive", async () => {
    const versions = (await target.client.query("select id, storage_path from document_versions"))
      .rows;
    expect(versions.length).toBeGreaterThan(0);
    expect(await findMissingFiles(versions, async () => true)).toEqual([]);
    const lost = await findMissingFiles(versions, async (p) => p !== "drill/1");
    expect(lost.map((v) => v.storage_path)).toEqual(["drill/1"]);
  });
});
