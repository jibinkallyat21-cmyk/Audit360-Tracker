import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { failure, setup, TEST_URL, type Db } from "./harness";

describe.skipIf(!TEST_URL)("maintenance switch", () => {
  let db: Db;
  const run = (who: string, sql: string, args: unknown[] = []) =>
    db.as(db.users[who], (q) => q.query(sql, args));

  beforeAll(async () => {
    db = await setup();
  });
  afterAll(async () => db?.close());

  it("starts off, and only a System Administrator can read or change it", async () => {
    expect((await run("jibin", "select * from get_maintenance()")).rows).toEqual([]);
    expect((await run("rijin", "select * from get_maintenance()")).rows).toEqual([]);
    expect(await failure(run("rijin", "select admin_set_maintenance(true)"))).toMatch(
      /Not authorized/,
    );
    expect(await failure(run("jibin", "select * from site_settings"))).toMatch(/permission denied/);
  });

  it("is switched on and off by the administrator and the change is logged", async () => {
    await run("jibin", "select admin_set_maintenance(true)");
    expect((await run("jibin", "select * from get_maintenance()")).rows[0].maintenance_on).toBe(
      true,
    );
    await run("jibin", "select admin_set_maintenance(false)");
    const s = await db.admin.query("select maintenance_on from site_settings where id=1");
    expect(s.rows[0].maintenance_on).toBe(false);
    const log = await db.admin.query(
      "select action_type from activity_logs where entity_type='site_settings' order by 1",
    );
    expect(log.rows.map((r) => r.action_type)).toEqual(["maintenance_off", "maintenance_on"]);
  });
});
