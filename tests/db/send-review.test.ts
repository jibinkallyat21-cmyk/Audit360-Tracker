import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { failure, setup, TEST_URL, type Db } from "./harness";

describe.skipIf(!TEST_URL)("send to review, and the Project Lead override", () => {
  let db: Db;
  const run = (who: string, sql: string, args: unknown[] = []) =>
    db.as(db.users[who], (q) => q.query(sql, args));
  const denied = async (who: string, sql: string, args: unknown[] = []) =>
    expect(await failure(run(who, sql, args)), `${who}`).toMatch(/Not authorized/);
  const state = async (sub: string) =>
    (
      await db.admin.query(
        "select current_stage s, current_status st, review_decision d from subprocesses where id=$1",
        [sub],
      )
    ).rows[0];

  beforeAll(async () => {
    db = await setup();
  });
  afterAll(async () => db?.close());

  it("sends a step to review from the very first stage in one go, and tells the reviewers", async () => {
    const sub = await db.sub("1.1", 1);
    await denied("rijin", "select send_to_review($1,true,null)", [sub]);
    await denied("rustham", "select send_to_review($1,true,null)", [sub]);
    expect(await failure(run("pavithra", "select send_to_review($1,false,null)", [sub]))).toMatch(
      /Confirm that the work was tested/,
    );
    await run("pavithra", "select send_to_review($1,true,'ready for you')", [sub]);
    expect(await state(sub)).toMatchObject({ s: "review", st: "in_progress", d: "pending_review" });
    const n = await db.admin.query(
      "select message from notifications where recipient_user_id=$1 and subprocess_id=$2 and event_type='review_queue'",
      [db.users.fayis, sub],
    );
    expect(n.rows.length).toBe(1);
    expect(
      (await db.admin.query("select result from testing_records where subprocess_id=$1", [sub]))
        .rows,
    ).toEqual([{ result: "pass" }]);
    expect(await failure(run("pavithra", "select send_to_review($1,true,null)", [sub]))).toMatch(
      /already in review/,
    );
    // the reviewer can now work on it
    await run("fayis", "select raise_review_point($1,'check',$2)", [sub, await db.person("Rijin")]);
  });

  it("will not send a blocked step, nor one managed by lines", async () => {
    const blocked = await db.sub("1.1", 2);
    await run("pavithra", "select set_status($1,'blocked')", [blocked]);
    expect(
      await failure(run("pavithra", "select send_to_review($1,true,null)", [blocked])),
    ).toMatch(/Blocked/);
    const lined = await db.sub("3.5", 1);
    expect(await failure(run("rustham", "select send_to_review($1,true,null)", [lined]))).toMatch(
      /line by line/,
    );
  });

  it("lets only the Project Lead override a step into review, with a reason", async () => {
    const sub = await db.sub("1.1", 2); // blocked, still pushed
    await denied("pavithra", "select override_step_to_review($1,'x')", [sub]);
    await denied("jibin", "select override_step_to_review($1,'x')", [sub]);
    expect(await failure(run("shonD", "select override_step_to_review($1,'  ')", [sub]))).toMatch(
      /Give a reason/,
    );
    await run("shonD", "select override_step_to_review($1,'deadline')", [sub]);
    expect(await state(sub)).toMatchObject({ s: "review", d: "pending_review" });
    const c = await db.admin.query("select comment_text from comments where subprocess_id=$1", [
      sub,
    ]);
    expect(c.rows[0].comment_text).toMatch(/Project Lead: deadline/);
    const n = await db.admin.query(
      "select 1 from notifications where recipient_user_id=$1 and subprocess_id=$2 and event_type='review_queue'",
      [db.users.fayis, sub],
    );
    expect(n.rowCount).toBe(1);
  });

  it("lets the Project Lead push a line to review without the lead's steps", async () => {
    const sub = await db.sub("3.5", 3);
    const line = (
      await db.admin.query(
        "select id from subprocess_lines where subprocess_id=$1 and title='GOSI'",
        [sub],
      )
    ).rows[0].id;
    await denied("rustham", "select override_line_to_review($1,'x')", [line]);
    await run("shonD", "select override_line_to_review($1,'client waiting')", [line]);
    expect(
      (await db.admin.query("select status from subprocess_lines where id=$1", [line])).rows[0]
        .status,
    ).toBe("in_review");
    expect((await state(sub)).s).toBe("review");
    // the reviewer can decide it
    await run("syam", "select line_review_decision($1,'approved',null)", [line]);
    expect(
      await failure(run("shonD", "select override_line_to_review($1,'again')", [line])),
    ).toMatch(/already approved/);
  });
});
