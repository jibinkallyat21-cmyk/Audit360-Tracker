import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { failure, setup, TEST_URL, type Db } from "./harness";

describe.skipIf(!TEST_URL)("export and archive approval flow", () => {
  let db: Db;
  let req: string;
  beforeAll(async () => {
    db = await setup();
  });
  afterAll(async () => db?.close());

  const run = (user: string, sql: string, params: unknown[] = []) =>
    db.as(db.users[user], (q) => q.query(sql, params));
  const denied = async (user: string, sql: string, params: unknown[] = []) =>
    expect(await failure(run(user, sql, params))).toMatch(/Not authorized/);

  it("lets only the administrator request an export", async () => {
    for (const u of ["shonJ", "shonD", "pavithra", "rijin"])
      await denied(u, "select request_export('x')");
    req = (await run("jibin", "select request_export('final export') id")).rows[0].id;
    expect(await failure(run("jibin", "select request_export()"))).toMatch(/already open/);
  });

  it("keeps requests private to the administrator and Project Head", async () => {
    expect((await run("jibin", "select count(*) from export_requests")).rows[0].count).toBe("1");
    expect((await run("shonJ", "select count(*) from export_requests")).rows[0].count).toBe("1");
    for (const u of ["shonD", "pavithra", "rijin"]) {
      expect((await run(u, "select count(*) from export_requests")).rows[0].count).toBe("0");
    }
  });

  it("blocks running or archiving before the Project Head approves", async () => {
    expect(await failure(run("jibin", "select record_export_run($1,3,0)", [req]))).toMatch(
      /must approve/,
    );
    expect(await failure(run("jibin", "select archive_project($1)", [req]))).toMatch(
      /Complete and verify/,
    );
  });

  it("lets only the Project Head decide, and not on their own request", async () => {
    for (const u of ["jibin", "shonD", "pavithra"])
      await denied(u, "select decide_export($1,true)", [req]);
    await run("shonJ", "select decide_export($1,true,'ok')", [req]);
    expect(await failure(run("shonJ", "select decide_export($1,false)", [req]))).toMatch(
      /already been decided/,
    );
    const row = (
      await db.admin.query("select status, decided_by from export_requests where id=$1", [req])
    ).rows[0];
    expect(row).toEqual({ status: "approved", decided_by: db.users.shonJ });
  });

  it("allows exactly one run per approval, and only by the administrator", async () => {
    await denied("shonJ", "select record_export_run($1,3,0)", [req]);
    await denied("shonD", "select record_export_run($1,3,0)", [req]);
    await run("jibin", "select record_export_run($1,12,1)", [req]);
    const row = (
      await db.admin.query(
        "select status, file_count, missing_count from export_requests where id=$1",
        [req],
      )
    ).rows[0];
    expect(row).toEqual({ status: "completed", file_count: 12, missing_count: 1 });
    expect(await failure(run("jibin", "select record_export_run($1,12,1)", [req]))).toMatch(
      /must approve/,
    );
  });

  it("archives once, after a completed export, recording retention and deleting nothing", async () => {
    await denied("shonJ", "select archive_project($1)", [req]);
    const before = (
      await db.admin.query(
        "select (select count(*) from processes) p, (select count(*) from activity_logs) a",
      )
    ).rows[0];
    await run("jibin", "select archive_project($1,'handover')", [req]);
    expect(await failure(run("jibin", "select archive_project($1)", [req]))).toMatch(
      /already archived/,
    );
    const s = (
      await db.admin.query(
        "select setting_value v from project_settings where setting_key='archive'",
      )
    ).rows[0].v;
    expect(s.export_request_id).toBe(req);
    const years =
      (new Date(s.retention_until).getTime() - new Date(s.archived_at).getTime()) / 86400000;
    expect(Math.round(years)).toBe(365);
    const after = (
      await db.admin.query(
        "select (select count(*) from processes) p, (select count(*) from activity_logs) a",
      )
    ).rows[0];
    expect(after.p).toBe(before.p); // nothing deleted
    expect(Number(after.a)).toBeGreaterThan(Number(before.a)); // and the archive was logged
  });

  it("records every step in the history", async () => {
    const log = await db.admin.query(
      "select action_type from activity_logs where entity_type in ('export','project_settings') order by id",
    );
    expect(log.rows.map((r) => r.action_type)).toEqual([
      "export_requested",
      "export_approved",
      "export_completed",
      "project_archived",
    ]);
  });

  it("rejects a request without opening the way to export", async () => {
    // Archive blocks nothing else; a fresh request after completion can be rejected and cannot run.
    const r2 = (await run("jibin", "select request_export() id")).rows[0].id;
    await run("shonJ", "select decide_export($1,false,'not now')", [r2]);
    expect(await failure(run("jibin", "select record_export_run($1,1,0)", [r2]))).toMatch(
      /must approve/,
    );
    expect(await failure(run("jibin", "update export_requests set status='approved'"))).toMatch(
      /permission denied/,
    );
  });
});
