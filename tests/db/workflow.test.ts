import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { failure, setup, TEST_URL, type Db } from "./harness";

describe.skipIf(!TEST_URL)("workflow, review and approval gates", () => {
  let db: Db;
  beforeAll(async () => {
    db = await setup();
  });
  afterAll(async () => db?.close());

  const run = (user: string, sql: string, params: unknown[] = []) =>
    db.as(db.users[user], (q) => q.query(sql, params));
  const state = async (sub: string) =>
    (
      await db.admin.query(
        "select current_stage s, current_status st, review_decision d, dashboard_status ds from subprocesses where id=$1",
        [sub],
      )
    ).rows[0];
  const denied = async (user: string, sql: string, params: unknown[]) =>
    expect(await failure(run(user, sql, params))).toMatch(/Not authorized/);

  /** Moves an item forward as its Production Lead, recording a pass at Testing. */
  async function advanceTo(sub: string, target: string) {
    const order = ["process_definition", "solution_building", "testing", "review"];
    while ((await state(sub)).s !== target) {
      const { s } = await state(sub);
      await run("pavithra", "select set_status($1,'in_progress')", [sub]);
      if (s === "testing") await run("rijin", "select record_testing($1,'pass','ok')", [sub]);
      await run("pavithra", "select complete_stage($1)", [sub]);
      if (order.indexOf(s) < 0) throw new Error("cannot advance past review here");
    }
  }

  it("enforces who may change status, and which statuses are settable", async () => {
    const sub = await db.sub("1.1", 1);
    await denied("rijin", "select set_status($1,'in_progress')", [sub]); // team member
    await denied("rustham", "select set_status($1,'in_progress')", [sub]); // other team's lead
    await denied("shonD", "select set_status($1,'in_progress')", [sub]); // Project Lead before Production
    await denied("jibin", "select set_status($1,'in_progress')", [sub]);
    expect(await failure(run("pavithra", "select set_status($1,'completed')", [sub]))).toMatch(
      /cannot be set directly/,
    );
    expect(
      await failure(run("pavithra", "select set_status($1,'changes_required')", [sub])),
    ).toMatch(/cannot be set directly/);
    await run("pavithra", "select set_status($1,'in_progress')", [sub]);
    expect((await state(sub)).st).toBe("in_progress");
    const log = await db.admin.query(
      "select actor_id, previous_value, new_value from activity_logs where action_type='status_changed' and subprocess_id=$1",
      [sub],
    );
    expect(log.rows[0].actor_id).toBe(db.users.pavithra);
    expect(log.rows[0].previous_value.status).toBe("not_started");
    expect(log.rows[0].new_value.status).toBe("in_progress");
  });

  it("does not let anyone skip a stage or complete without starting", async () => {
    const sub = await db.sub("1.1", 3);
    expect(await failure(run("pavithra", "select complete_stage($1)", [sub]))).toMatch(
      /must be In Progress/,
    );
    await denied("rijin", "select complete_stage($1)", [sub]);
    await advanceTo(sub, "solution_building");
    expect((await state(sub)).st).toBe("not_started");
  });

  it("requires a passing test, and a failed test returns work to Solution Building", async () => {
    const sub = await db.sub("1.1", 2);
    await advanceTo(sub, "testing");
    await run("pavithra", "select set_status($1,'in_progress')", [sub]);
    expect(await failure(run("pavithra", "select complete_stage($1)", [sub]))).toMatch(
      /passing test/,
    );
    await denied("sajad", "select record_testing($1,'pass','x')", [sub]);
    await run("rijin", "select record_testing($1,'fail','broken')", [sub]);
    const s = await state(sub);
    expect(s.s).toBe("solution_building");
    expect(s.st).toBe("changes_required");
    // A pass recorded before re-entering Testing does not count for the new attempt.
    await advanceTo(sub, "testing");
    await run("pavithra", "select set_status($1,'in_progress')", [sub]);
    expect(await failure(run("pavithra", "select complete_stage($1)", [sub]))).toMatch(
      /passing test/,
    );
  });

  it("runs the full review loop: changes, review point, owner response, reviewer closure, Production", async () => {
    const sub = await db.sub("1.1", 1);
    const owner = await db.person("Rijin");
    await advanceTo(sub, "review");
    expect((await state(sub)).d).toBe("pending_review");

    // Reviewer cannot ask for changes without a review point; non-reviewers cannot raise one.
    expect(
      await failure(run("fayis", "select record_review_decision($1,'changes_required')", [sub])),
    ).toMatch(/Raise a review point/);
    await denied("rijin", "select raise_review_point($1,'x',$2)", [sub, owner]);
    await denied("syam", "select raise_review_point($1,'x',$2)", [sub, owner]); // reviewer of a different phase
    const rp = (
      await run("fayis", "select raise_review_point($1,'Fix the scoring rule',$2) id", [sub, owner])
    ).rows[0].id;
    await run("fayis", "select record_review_decision($1,'changes_required','see point')", [sub]);
    let s = await state(sub);
    expect([s.s, s.st, s.d]).toEqual(["solution_building", "changes_required", "changes_required"]);

    await advanceTo(sub, "review");

    // The review point is still open: approval and Production are both blocked.
    expect(
      await failure(run("fayis", "select record_review_decision($1,'approved')", [sub])),
    ).toMatch(/Close all review points/);

    // A comment saying "done" does not close it; only owner response + reviewer approval does.
    await run("rijin", "select add_comment($1,'This is done now',null,$2)", [sub, rp]);
    expect(
      (await db.admin.query("select status from review_points where id=$1", [rp])).rows[0].status,
    ).toBe("open");
    expect(await failure(run("rijin", "select update_review_point($1,'submit','')", [rp]))).toMatch(
      /response is required/,
    );
    await denied("pavithra", "select update_review_point($1,'submit','fixed')", [rp]); // not the owner
    await run("rijin", "select update_review_point($1,'submit','Rule updated, see evidence')", [
      rp,
    ]);
    await denied("rijin", "select update_review_point($1,'approve_close')", [rp]); // owner cannot approve self
    await denied("pavithra", "select update_review_point($1,'approve_close')", [rp]); // lead is not the reviewer
    await run("fayis", "select update_review_point($1,'approve_close','good')", [rp]);
    const closed = (
      await db.admin.query("select status, closed_by from review_points where id=$1", [rp])
    ).rows[0];
    expect(closed).toEqual({ status: "closed", closed_by: db.users.fayis });

    await run("fayis", "select record_review_decision($1,'approved','ok')", [sub]);
    await run("pavithra", "select set_status($1,'in_progress')", [sub]);

    // Production entry belongs to the Project Lead only.
    for (const u of ["pavithra", "rijin", "fayis", "jibin", "shonJ", "rustham"]) {
      await denied(u, "select complete_stage($1)", [sub]);
    }
    await run("shonD", "select complete_stage($1)", [sub]);
    s = await state(sub);
    expect([s.s, s.st, s.ds]).toEqual(["production", "not_started", "not_started"]);
    const prod = await db.admin.query(
      "select decided_by from approvals where subprocess_id=$1 and approval_type='production_entry'",
      [sub],
    );
    expect(prod.rows[0].decided_by).toBe(db.users.shonD);
  });

  it("gives the Dashboard Lead build status control only once Production is reached", async () => {
    const inProd = await db.sub("1.1", 1);
    const notYet = await db.sub("1.2", 1);
    await run("jibin", "select set_dashboard_status($1,'under_construction')", [inProd]);
    expect((await state(inProd)).ds).toBe("under_construction");
    expect(
      await failure(run("jibin", "select set_dashboard_status($1,'under_construction')", [notYet])),
    ).toMatch(/applies only in Production/);
    await denied("shonD", "select set_dashboard_status($1,'live_deployed')", [inProd]);
    await denied("pavithra", "select set_dashboard_status($1,'live_deployed')", [inProd]);
    // A person holding only the Dashboard Lead role (no assignments, not an administrator)
    // sees exactly the items that reached Production. Jibin is also the administrator,
    // who sees structure but never records.
    const pid = await db.person("Dhanhaj");
    await db.admin.query("delete from process_assignments where person_id=$1", [pid]);
    const u = (
      await db.admin.query("insert into auth.users (email) values ('d@example.com') returning id")
    ).rows[0].id;
    await db.admin.query(
      "update profiles set approval_state='approved', person_id=$2 where id=$1",
      [u, pid],
    );
    await db.admin.query(
      "insert into person_roles select $1, id from roles where name='dashboard_lead'",
      [pid],
    );
    const seen = await db.as(u, (q) => q.query("select process_code from processes"));
    expect(seen.rows.map((r) => r.process_code)).toEqual(["1.1"]);
    const subs = await db.as(u, (q) => q.query("select current_stage from subprocesses"));
    expect(subs.rows.every((r) => r.current_stage === "production")).toBe(true);
    expect((await db.as(u, (q) => q.query("select count(*) from comments"))).rows[0].count).toBe(
      "0",
    );
    // Production Leads cannot manage Production; the Project Lead can.
    await denied("pavithra", "select set_status($1,'in_progress')", [inProd]);
    await run("shonD", "select set_status($1,'in_progress')", [inProd]);
    await run("shonD", "select complete_stage($1)", [inProd]);
    expect((await state(inProd)).st).toBe("completed");
  });

  it("blocks a reviewer who also worked on the item", async () => {
    const proc = await db.process("2.1");
    const sub = await db.sub("2.1", 1);
    const anna = await db.person("Anna");
    await run("jibin", "select admin_set_assignment($1,$2,'team_member',true)", [
      proc,
      await db.person("Fayis"),
    ]);
    await denied("fayis", "select raise_review_point($1,'x',$2)", [sub, anna]);
    await denied("fayis", "select record_review_decision($1,'approved')", [sub]);
  });

  it("forces re-approval when evidence changes after approval", async () => {
    const sub = await db.sub("1.2", 1);
    await advanceTo(sub, "review");
    await run("fayis", "select record_review_decision($1,'approved')", [sub]);
    await run("pavithra", "select set_status($1,'in_progress')", [sub]);
    await run(
      "rijin",
      "select register_document_version($1,null,null,'a.docx','p/1.docx',1000,'application/vnd.openxmlformats-officedocument.wordprocessingml.document')",
      [sub],
    );
    expect(await failure(run("shonD", "select complete_stage($1)", [sub]))).toMatch(
      /Evidence changed/,
    );
    await run("fayis", "select record_review_decision($1,'approved')", [sub]);
    await run("shonD", "select complete_stage($1)", [sub]);
    expect((await state(sub)).s).toBe("production");
  });
});
