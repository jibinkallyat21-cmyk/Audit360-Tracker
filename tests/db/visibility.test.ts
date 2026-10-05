import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { failure, setup, TEST_URL, type Db } from "./harness";

describe.skipIf(!TEST_URL)("visibility and direct access", () => {
  let db: Db;
  beforeAll(async () => {
    db = await setup();
  });
  afterAll(async () => db?.close());

  const codes = async (user: string) =>
    (
      await db.as(db.users[user], (q) => q.query("select process_code from processes order by 1"))
    ).rows.map((r) => r.process_code as string);

  it("loads the seed: 20 processes, 64 subprocesses, 40 people", async () => {
    const r = await db.admin.query(
      "select (select count(*) from processes) p, (select count(*) from subprocesses) s, (select count(*) from people) pe",
    );
    expect(r.rows[0]).toEqual({ p: "20", s: "64", pe: "40" });
  });

  it("shows an unapproved account nothing", async () => {
    expect(await codes("stranger")).toEqual([]);
    const r = await db.as(db.users.stranger, (q) => q.query("select count(*) from people"));
    expect(r.rows[0].count).toBe("0");
  });

  it("denies RPCs to an unapproved account", async () => {
    const sub = await db.sub("1.1");
    const msg = await failure(
      db.as(db.users.stranger, (q) => q.query("select add_comment($1,'hi')", [sub])),
    );
    expect(msg).toMatch(/Not authorized/);
  });

  it("limits a team member to assigned processes", async () => {
    expect(await codes("rijin")).toEqual(["1.1", "1.2", "3.4"]);
  });

  it("keeps Pavithra and Rustham apart", async () => {
    const pav = await codes("pavithra");
    const rus = await codes("rustham");
    expect(pav).toContain("1.1");
    expect(pav).not.toContain("6.1");
    expect(rus).toContain("6.1");
    expect(rus).not.toContain("1.1");
    expect(pav.filter((c) => rus.includes(c))).toEqual([]);
  });

  it("gives the Project Lead every process, and management every title", async () => {
    expect(await codes("shonD")).toHaveLength(20);
    expect(await codes("shonJ")).toHaveLength(20);
  });

  it("blocks guessing an ID: unrelated process and its subprocesses return nothing", async () => {
    const other = await db.process("6.1");
    const sub = await db.sub("6.1");
    await db.as(db.users.rijin, async (q) => {
      expect((await q.query("select 1 from processes where id=$1", [other])).rowCount).toBe(0);
      expect((await q.query("select 1 from subprocesses where id=$1", [sub])).rowCount).toBe(0);
      expect(
        (await q.query("select 1 from process_assignments where process_id=$1", [other])).rowCount,
      ).toBe(0);
    });
  });

  it("blocks cross-team comments, documents and history", async () => {
    const own = await db.sub("1.1");
    const foreign = await db.sub("6.1");
    await db.as(db.users.rijin, (q) => q.query("select add_comment($1,'mine')", [own]));
    await db.as(db.users.rustham, (q) => q.query("select add_comment($1,'theirs')", [foreign]));
    expect(
      await failure(db.as(db.users.rijin, (q) => q.query("select add_comment($1,'x')", [foreign]))),
    ).toMatch(/Not authorized/);
    await db.as(db.users.rijin, async (q) => {
      const c = await q.query("select comment_text from comments");
      expect(c.rows.map((r) => r.comment_text)).toEqual(["mine"]);
      const h = await q.query("select process_id from activity_logs where process_id is not null");
      expect(h.rows.every((r) => r.process_id !== null)).toBe(true);
      expect(h.rows).toHaveLength(1);
    });
  });

  it("lets management see titles but no records", async () => {
    await db.as(db.users.shonJ, async (q) => {
      expect((await q.query("select count(*) from comments")).rows[0].count).toBe("0");
      expect((await q.query("select count(*) from review_points")).rows[0].count).toBe("0");
      expect((await q.query("select count(*) from documents")).rows[0].count).toBe("0");
      expect((await q.query("select count(*) from activity_logs")).rows[0].count).toBe("0");
    });
  });

  it("lets the administrator see structure and accounts, but no records", async () => {
    await db.as(db.users.jibin, async (q) => {
      expect((await q.query("select count(*) from processes")).rows[0].count).toBe("20");
      expect((await q.query("select count(*) from profiles")).rows[0].count).toBe("12");
      expect((await q.query("select count(*) from comments")).rows[0].count).toBe("0");
    });
    // A normal user sees only their own profile.
    await db.as(db.users.rijin, async (q) => {
      expect((await q.query("select count(*) from profiles")).rows[0].count).toBe("1");
    });
  });

  it("denies every direct write from a client", async () => {
    const sub = await db.sub("1.1");
    const attempts = [
      "update subprocesses set current_stage='production', dashboard_status='not_started'",
      "update subprocesses set current_status='completed'",
      "insert into comments (subprocess_id, author_id, comment_text) select id, id, 'x' from profiles limit 1",
      "update profiles set approval_state='approved'",
      "update process_assignments set assignment_type='reviewer'",
      "insert into project_settings values ('project_deadline','\"2030-01-01\"',null,now())",
      "delete from activity_logs",
      "update person_roles set role_id=1",
    ];
    for (const sql of attempts) {
      const msg = await failure(db.as(db.users.rijin, (q) => q.query(sql)));
      expect(msg, sql).toMatch(/permission denied/);
    }
    const after = await db.admin.query("select current_stage from subprocesses where id=$1", [sub]);
    expect(after.rows[0].current_stage).toBe("process_definition");
  });
});
