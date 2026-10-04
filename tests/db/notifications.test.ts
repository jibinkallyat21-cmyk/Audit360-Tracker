import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { failure, setup, TEST_URL, type Db } from "./harness";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe.skipIf(!TEST_URL)("in-app notifications", () => {
  let db: Db;
  beforeAll(async () => {
    db = await setup();
  });
  afterAll(async () => db?.close());

  const run = (user: string, sql: string, params: unknown[] = []) =>
    db.as(db.users[user], (q) => q.query(sql, params));
  const inbox = async (user: string) =>
    (
      await run(
        user,
        "select event_type, message, is_read, process_id from notifications order by created_at, id",
      )
    ).rows;
  const events = async (user: string) => (await inbox(user)).map((n) => n.event_type);

  it("tells a person when they are assigned, and as what", async () => {
    const proc = await db.process("1.2");
    await run("jibin", "select admin_set_assignment($1,$2,'team_member',true)", [
      proc,
      await db.person("Sajad"),
    ]);
    await run("jibin", "select admin_set_assignment($1,$2,'reviewer',true)", [
      proc,
      await db.person("Syam"),
    ]);
    const s = await inbox("sajad");
    expect(s.map((n) => n.event_type)).toEqual(["assigned"]);
    expect(s[0].message).toBe(
      "You were assigned as team member on 1.2 Signed Proposal & Basic Documents Collection",
    );
    expect(await events("syam")).toEqual(["reviewer_assigned"]);
    // Assigning a person who has no account yet must not fail, and tells no one else.
    await run("jibin", "select admin_set_assignment($1,$2,'team_member',true)", [
      proc,
      await db.person("Allen"),
    ]);
    expect(await events("rustham")).toEqual([]);
  });

  it("follows an item through stages, review, closure and Production", async () => {
    const sub = await db.sub("1.1", 1);
    const owner = await db.person("Rijin");
    await run("pavithra", "select set_status($1,'in_progress')", [sub]);
    await run("pavithra", "select complete_stage($1)", [sub]); // -> solution building
    expect(await events("rijin")).toEqual(["status_changed", "stage_changed"]);
    expect(await events("pavithra")).toEqual([]); // never told about their own actions

    for (const step of ["solution_building", "testing"]) {
      await run("pavithra", "select set_status($1,'in_progress')", [sub]);
      if (step === "testing") await run("rijin", "select record_testing($1,'pass','ok')", [sub]);
      await run("pavithra", "select complete_stage($1)", [sub]);
    }
    // Reviewers hear only when it reaches Review; reviewers of other phases hear nothing.
    expect(await events("fayis")).toEqual(["review_queue"]);
    expect(await events("syam")).toEqual(["reviewer_assigned"]);

    await run("fayis", "select raise_review_point($1,'Fix totals',$2)", [sub, owner]);
    const rp = (await db.admin.query("select id from review_points where subprocess_id=$1", [sub]))
      .rows[0].id;
    await run("fayis", "select record_review_decision($1,'changes_required')", [sub]);
    const r = await events("rijin");
    expect(r).toEqual(expect.arrayContaining(["review_point_assigned", "changes_requested"]));
    expect(await events("fayis")).toEqual(["review_queue"]); // the reviewer is not told about their own decision

    // Rework, back to Review, owner responds.
    for (const step of ["solution_building", "testing"]) {
      await run("pavithra", "select set_status($1,'in_progress')", [sub]);
      if (step === "testing") await run("rijin", "select record_testing($1,'pass','ok')", [sub]);
      await run("pavithra", "select complete_stage($1)", [sub]);
    }
    await run("rijin", "select update_review_point($1,'submit','done')", [rp]);
    expect(await events("fayis")).toEqual(["review_queue", "review_queue", "response_submitted"]);

    await run("fayis", "select update_review_point($1,'approve_close')", [rp]);
    expect(await events("rijin")).toContain("review_point_closed");
    await run("fayis", "select record_review_decision($1,'approved')", [sub]);
    expect(await events("shonD")).toContain("review_approved");

    await run("pavithra", "select set_status($1,'in_progress')", [sub]);
    await run("shonD", "select complete_stage($1)", [sub]);
    expect(await events("jibin")).toEqual(["production_ready"]);
    expect((await inbox("jibin"))[0].message).toBe(
      "1.1 Lead Scoring & Proposal Generation (step 1) reached Production and is ready for the website build",
    );
  });

  it("notifies the right people about a failed test and about documents", async () => {
    const sub = await db.sub("3.4", 1); // lead Pavithra, team includes Rijin; reviewers Syam, Azhar
    for (const step of ["process_definition", "solution_building"]) {
      void step;
      await run("pavithra", "select set_status($1,'in_progress')", [sub]);
      await run("pavithra", "select complete_stage($1)", [sub]);
    }
    await run("pavithra", "select set_status($1,'in_progress')", [sub]);
    await run("rijin", "select record_testing($1,'fail','broken')", [sub]);
    expect(await events("pavithra")).toContain("test_failed"); // the lead hears it
    expect(await events("rijin")).not.toContain("test_failed"); // the person who recorded it does not

    await run("rijin", "select register_document_version($1,null,null,'a.docx','n/1',100,$2)", [
      sub,
      DOCX,
    ]);
    const doc = await db.admin.query(
      "select recipient_user_id r from notifications where event_type='document'",
    );
    // Everyone with an account on the process hears about it (the lead and reviewer Syam;
    // Azhar has no test account); the uploader and other teams do not.
    expect(doc.rows.map((d) => d.r).sort()).toEqual([db.users.pavithra, db.users.syam].sort());
    expect(await events("rustham")).toEqual([]);
    expect((await events("rijin")).filter((e) => e === "document")).toEqual([]);
  });

  it("never shows anyone else's notifications, or any to management", async () => {
    expect(await inbox("shonJ")).toEqual([]);
    expect(await inbox("rustham")).toEqual([]);
    const all = await db.admin.query("select count(*) from notifications");
    const mine = await run("rijin", "select count(*) from notifications");
    expect(Number(mine.rows[0].count)).toBeLessThan(Number(all.rows[0].count));
    for (const sql of [
      "update notifications set is_read = true",
      "delete from notifications",
      "insert into notifications (recipient_user_id, event_type, message) select id, 'x', 'x' from profiles limit 1",
    ]) {
      expect(await failure(run("rijin", sql)), sql).toMatch(/permission denied/);
    }
  });

  it("marks only your own notifications read", async () => {
    const mine = (await inbox("rijin")).length;
    const first = (await run("rijin", "select id from notifications order by created_at limit 1"))
      .rows[0].id;
    await run("rijin", "select mark_notification_read($1)", [first]);
    expect(
      (await run("rijin", "select count(*) from notifications where is_read")).rows[0].count,
    ).toBe("1");
    // Someone else cannot mark it.
    const pavUnread = (
      await run("pavithra", "select count(*) from notifications where not is_read")
    ).rows[0].count;
    await run("pavithra", "select mark_notification_read($1)", [first]);
    expect(
      (await run("pavithra", "select count(*) from notifications where not is_read")).rows[0].count,
    ).toBe(pavUnread);
    await run("rijin", "select mark_all_notifications_read()");
    expect(
      (await run("rijin", "select count(*) from notifications where not is_read")).rows[0].count,
    ).toBe("0");
    expect((await inbox("rijin")).length).toBe(mine);
  });

  it("removes a person's notifications for a process when they lose all access to it", async () => {
    const proc = await db.process("1.2");
    expect((await inbox("sajad")).length).toBe(1);
    await run("jibin", "select admin_set_assignment($1,$2,'team_member',false)", [
      proc,
      await db.person("Sajad"),
    ]);
    expect(await inbox("sajad")).toEqual([]);
    // Syam still holds the reviewer assignment, so keeps theirs.
    await run("jibin", "select admin_set_assignment($1,$2,'team_member',true)", [
      proc,
      await db.person("Syam"),
    ]);
    await run("jibin", "select admin_set_assignment($1,$2,'team_member',false)", [
      proc,
      await db.person("Syam"),
    ]);
    expect((await inbox("syam")).length).toBeGreaterThan(0);
  });

  it("lets only an administrator manage team membership, and logs it", async () => {
    const team = (await db.admin.query("select id from teams where name='Team Pavithra'")).rows[0]
      .id;
    const sajad = await db.person("Sajad");
    expect(
      await failure(run("pavithra", "select admin_set_team_member($1,$2,true)", [team, sajad])),
    ).toMatch(/Not authorized/);
    await run("jibin", "select admin_set_team_member($1,$2,true)", [team, sajad]);
    expect(
      (await run("rijin", "select count(*) from team_members where person_id=$1", [sajad])).rows[0]
        .count,
    ).toBe("1");
    await run("jibin", "select admin_set_team_member($1,$2,false)", [team, sajad]);
    const log = await db.admin.query(
      "select action_type from activity_logs where entity_type='team' order by id",
    );
    expect(log.rows.map((r) => r.action_type)).toEqual([
      "team_member_added",
      "team_member_removed",
    ]);
  });
});
