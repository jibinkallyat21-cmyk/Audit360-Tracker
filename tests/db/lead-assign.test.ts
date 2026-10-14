import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { failure, setup, TEST_URL, type Db } from "./harness";

describe.skipIf(!TEST_URL)("Production Lead manages the people on their process", () => {
  let db: Db;
  const run = (who: string, sql: string, args: unknown[] = []) =>
    db.as(db.users[who], (q) => q.query(sql, args));
  let process: string;
  let anna: string;
  const mine = async (person: string) =>
    (
      await db.admin.query(
        "select assignment_type t from process_assignments where process_id=$1 and person_id=$2",
        [process, person],
      )
    ).rows.map((r) => r.t);

  beforeAll(async () => {
    db = await setup();
    process = await db.process("3.5");
    anna = await db.person("Anna");
    await db.admin.query("delete from process_assignments where process_id=$1 and person_id=$2", [
      process,
      anna,
    ]);
  });
  afterAll(async () => db?.close());

  it("lets the lead add and remove team members and supporting roles, and tells the new person", async () => {
    await run("rustham", "select lead_set_assignment($1,$2,'team_member',true)", [process, anna]);
    expect(await mine(anna)).toEqual(["team_member"]);
    expect((await run("anna", "select 1 from processes where id=$1", [process])).rowCount).toBe(1);
    const n = await db.admin.query(
      "select message from notifications where recipient_user_id=$1 and process_id=$2",
      [db.users.anna, process],
    );
    expect(n.rows.some((x) => /assigned as team member/.test(x.message))).toBe(true);
    expect(
      await failure(
        run("rustham", "select lead_set_assignment($1,$2,'team_member',true)", [process, anna]),
      ),
    ).toMatch(/already on this process/);
    await run("rustham", "select lead_set_assignment($1,$2,'team_member',false)", [process, anna]);
    expect(await mine(anna)).toEqual([]);
    await run("rustham", "select lead_set_assignment($1,$2,'supporting_role',true)", [
      process,
      anna,
    ]);
    expect(await mine(anna)).toEqual(["supporting_role"]);
  });

  it("refuses everyone who is not the process's Production Lead", async () => {
    const sajad = await db.person("Sajad");
    for (const who of ["syam", "shonD", "jibin", "pavithra", "rijin"]) {
      expect(
        await failure(
          run(who, "select lead_set_assignment($1,$2,'team_member',true)", [process, sajad]),
        ),
        who,
      ).toMatch(/Not authorized/);
    }
  });

  it("limits the lead to team members and supporting roles, and keeps reviewers apart from workers", async () => {
    const sajad = await db.person("Sajad");
    for (const t of ["reviewer", "production_lead"]) {
      expect(
        await failure(
          run("rustham", `select lead_set_assignment($1,$2,'${t}',true)`, [process, sajad]),
        ),
      ).toMatch(/team members and supporting roles only/);
    }
    const syam = await db.person("Syam"); // a reviewer on 3.5
    expect(
      await failure(
        run("rustham", "select lead_set_assignment($1,$2,'team_member',true)", [process, syam]),
      ),
    ).toMatch(/already has another role/);
  });

  it("will not remove someone who still owns an open review point", async () => {
    const sub = await db.sub("3.5", 1);
    await db.admin.query(
      "update subprocesses set current_stage='testing', current_status='in_progress' where id=$1",
      [sub],
    );
    await run("syam", "select raise_review_point($1,'fix it',$2)", [sub, anna]);
    expect(
      await failure(
        run("rustham", "select lead_set_assignment($1,$2,'supporting_role',false)", [
          process,
          anna,
        ]),
      ),
    ).toMatch(/open review points/);
  });
});
