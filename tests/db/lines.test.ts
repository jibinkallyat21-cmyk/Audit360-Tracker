import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { failure, setup, TEST_URL, type Db } from "./harness";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe.skipIf(!TEST_URL)("lines: work, review and approve one piece at a time", () => {
  let db: Db;
  const run = (who: string, sql: string, args: unknown[] = []) =>
    db.as(db.users[who], (q) => q.query(sql, args));
  const denied = async (who: string, sql: string, args: unknown[] = []) =>
    expect(await failure(run(who, sql, args)), `${who}: ${sql}`).toMatch(/Not authorized/);
  let sub: string;
  const line = async (title: string, s = sub) =>
    (
      await db.admin.query("select id from subprocess_lines where subprocess_id=$1 and title=$2", [
        s,
        title,
      ])
    ).rows[0].id as string;
  const lineStatus = async (title: string) =>
    (await db.admin.query("select status from subprocess_lines where id=$1", [await line(title)]))
      .rows[0].status;
  const step = async () =>
    (
      await db.admin.query(
        "select current_stage s, current_status st, review_decision d, dashboard_status ds from subprocesses where id=$1",
        [sub],
      )
    ).rows[0];
  const upload = async (title: string, name: string, doc: string | null = null) =>
    (
      await run("rustham", "select register_document_version($1,null,$2,$3,$4,1000,$5,null,$6)", [
        sub,
        doc,
        name,
        `t/${name}-${Math.random()}`,
        DOCX,
        doc ? null : await line(title),
      ])
    ).rows[0];

  beforeAll(async () => {
    db = await setup();
    sub = await db.sub("3.5", 1);
  });
  afterAll(async () => db?.close());

  it("starts 3.5 with its four lines and hands step-level actions over to them", async () => {
    const r = await db.admin.query(
      "select title from subprocess_lines where subprocess_id=$1 order by seq",
      [sub],
    );
    expect(r.rows.map((x) => x.title)).toEqual(["EOSB", "GOSI", "Prepaid", "Depreciation"]);
    expect(await failure(run("rustham", "select set_status($1,'in_progress')", [sub]))).toMatch(
      /managed line by line/,
    );
    expect(await failure(run("rustham", "select complete_stage($1)", [sub]))).toMatch(
      /managed line by line/,
    );
  });

  it("lets only the Production Lead change a line's working status", async () => {
    const eosb = await line("EOSB");
    await denied("shonD", "select line_set_status($1,'in_progress')", [eosb]);
    await denied("syam", "select line_set_status($1,'in_progress')", [eosb]);
    expect(await failure(run("rustham", "select line_set_status($1,'in_review')", [eosb]))).toMatch(
      /cannot be set directly/,
    );
    await run("rustham", "select line_set_status($1,'in_progress')", [eosb]);
    expect(await lineStatus("EOSB")).toBe("in_progress");
    expect(await step()).toMatchObject({ s: "solution_building", st: "in_progress" });
  });

  it("sends one line to review with a file and a test confirmation, and tells the reviewers", async () => {
    const eosb = await line("EOSB");
    expect(
      await failure(run("rustham", "select line_send_to_review($1,true,'ready')", [eosb])),
    ).toMatch(/Upload at least one file/);
    await upload("EOSB", "EOSB-schedule.docx");
    expect(
      await failure(run("rustham", "select line_send_to_review($1,false,null)", [eosb])),
    ).toMatch(/Confirm that the work was tested/);
    await denied("rijin", "select line_send_to_review($1,true,null)", [eosb]);
    await run("rustham", "select line_send_to_review($1,true,'EOSB tied to payroll')", [eosb]);
    expect(await lineStatus("EOSB")).toBe("in_review");
    expect(await lineStatus("GOSI")).toBe("not_started"); // the others are untouched
    expect(await step()).toMatchObject({ s: "review", d: "pending_review" });
    const n = await db.admin.query(
      "select message from notifications where recipient_user_id=$1 and event_type='review_queue' and subprocess_id=$2",
      [db.users.syam, sub],
    );
    expect(n.rows.some((x) => /EOSB/.test(x.message))).toBe(true);
    const t = await db.admin.query(
      "select result, line_id from testing_records where subprocess_id=$1",
      [sub],
    );
    expect(t.rows).toEqual([{ result: "pass", line_id: eosb }]);
  });

  it("lets only a non-conflicted reviewer decide, and asks for a reason on changes", async () => {
    const eosb = await line("EOSB");
    await denied("rustham", "select line_review_decision($1,'approved',null)", [eosb]); // conflicted
    await denied("shonD", "select line_review_decision($1,'approved',null)", [eosb]);
    expect(
      await failure(run("syam", "select line_review_decision($1,'changes_required',null)", [eosb])),
    ).toMatch(/Say what needs to change/);
    await run(
      "syam",
      "select line_review_decision($1,'changes_required','Tie to the payroll register')",
      [eosb],
    );
    expect(await lineStatus("EOSB")).toBe("changes_required");
    expect(await step()).toMatchObject({ s: "solution_building", st: "changes_required" });
    const c = await db.admin.query("select comment_text from comments where line_id=$1", [eosb]);
    expect(c.rows.map((x) => x.comment_text)).toContain("Tie to the payroll register");
    expect(
      await failure(run("syam", "select line_review_decision($1,'approved',null)", [eosb])),
    ).toMatch(/in review/);
  });

  it("approves a line, and a new file on an approved line reopens it for review", async () => {
    const eosb = await line("EOSB");
    await run("rustham", "select line_set_status($1,'in_progress')", [eosb]);
    await run("rustham", "select line_send_to_review($1,true,null)", [eosb]);
    await run("syam", "select line_review_decision($1,'approved','good')", [eosb]);
    expect(await lineStatus("EOSB")).toBe("approved");
    expect((await step()).s).toBe("solution_building"); // the other lines are still open
    const doc = (await db.admin.query("select id from documents where line_id=$1", [eosb])).rows[0]
      .id;
    await upload("EOSB", "EOSB-schedule.docx", doc);
    expect(await lineStatus("EOSB")).toBe("in_review");
    await run("syam", "select line_review_decision($1,'approved',null)", [eosb]);
  });

  it("files documents under lines and keeps files of reviewed lines in place", async () => {
    const gosi = await line("GOSI");
    const { register_document_version: v } = await upload("GOSI", "gosi.docx");
    expect(v).toBeTruthy();
    const doc = (await db.admin.query("select id, line_id from documents where line_id=$1", [gosi]))
      .rows[0];
    const prepaid = await line("Prepaid");
    await run("rustham", "select assign_document_line($1,$2)", [doc.id, prepaid]);
    expect(
      (await db.admin.query("select line_id from documents where id=$1", [doc.id])).rows[0].line_id,
    ).toBe(prepaid);
    await run("rustham", "select assign_document_line($1,null)", [doc.id]);
    await denied("syam", "select assign_document_line($1,$2)", [doc.id, gosi]);
    const eosbDoc = (
      await db.admin.query("select id from documents where line_id=$1", [await line("EOSB")])
    ).rows[0].id;
    expect(
      await failure(run("rustham", "select assign_document_line($1,null)", [eosbDoc])),
    ).toMatch(/cannot be moved/);
  });

  it("reaches Production only when every line is approved, then freezes the lines", async () => {
    for (const t of ["GOSI", "Prepaid", "Depreciation"]) {
      const id = await line(t);
      await run("rustham", "select line_set_status($1,'in_progress')", [id]);
      await upload(t, `${t}.docx`);
      await run("rustham", "select line_send_to_review($1,true,null)", [id]);
      expect((await step()).s).toBe("review");
      await run("syam", "select line_review_decision($1,'approved',null)", [id]);
    }
    expect(await step()).toMatchObject({
      s: "production",
      st: "not_started",
      d: "approved",
      ds: "not_started",
    });
    const a = await db.admin.query(
      "select count(*)::int n from approvals where subprocess_id=$1 and approval_type='production_entry'",
      [sub],
    );
    expect(a.rows[0].n).toBe(1);
    expect(await failure(run("rustham", "select line_add($1,'Zakat')", [sub]))).toMatch(
      /already in Production/,
    );
  });

  it("lets the Production Lead and the administrator manage lines, never anyone else", async () => {
    const other = await db.sub("3.5", 2);
    await denied("syam", "select line_add($1,'Provision')", [other]);
    await denied("shonD", "select line_add($1,'Provision')", [other]);
    const added = (await run("jibin", "select line_add($1,'Provision')", [other])).rows[0].line_add;
    expect(await failure(run("rustham", "select line_add($1,' provision ')", [other]))).toMatch(
      /already has a line/,
    );
    await run("rustham", "select line_rename($1,'Provisions')", [added]);
    await run("rustham", "select line_remove($1)", [added]);
    expect(
      (await db.admin.query("select 1 from subprocess_lines where id=$1", [added])).rowCount,
    ).toBe(0);
  });

  it("turns lines on for any step, keeping the step's progress", async () => {
    const plain = await db.sub("3.2", 1);
    await run("pavithra", "select set_status($1,'in_progress')", [plain]);
    const l = (await run("pavithra", "select line_add($1,'Statutory data')", [plain])).rows[0]
      .line_add;
    expect(
      (await db.admin.query("select status from subprocess_lines where id=$1", [l])).rows[0].status,
    ).toBe("in_progress");
    const l2 = (await run("pavithra", "select line_add($1,'Initial data')", [plain])).rows[0]
      .line_add;
    expect(
      (await db.admin.query("select status from subprocess_lines where id=$1", [l2])).rows[0]
        .status,
    ).toBe("not_started");
    expect(await failure(run("pavithra", "select complete_stage($1)", [plain]))).toMatch(
      /managed line by line/,
    );
  });

  it("keeps line titles visible to the Project Head view but files private", async () => {
    const r = await run("jibin", "select title from subprocess_lines where subprocess_id=$1", [
      sub,
    ]);
    expect(r.rows.length).toBe(4);
    const c = await run("jibin", "select * from comments where line_id is not null");
    expect(c.rows).toEqual([]);
  });

  it("tells a reviewer who joins late about work already waiting, and lets them decide it", async () => {
    const other = await db.sub("3.5", 3);
    const l = (
      await db.admin.query(
        "select id from subprocess_lines where subprocess_id=$1 and title='EOSB'",
        [other],
      )
    ).rows[0].id;
    await run("rustham", "select line_set_status($1,'in_progress')", [l]);
    await run(
      "rustham",
      "select register_document_version($1,null,null,'e.docx','t/late-1',1000,$2,null,$3)",
      [other, DOCX, l],
    );
    await run("rustham", "select line_send_to_review($1,true,null)", [l]);
    const process = await db.process("3.5");
    const jismy = await db.person("Jismy");
    expect((await run("jismy", "select 1 from subprocess_lines where id=$1", [l])).rowCount).toBe(
      0,
    ); // cannot see it yet
    await run("jibin", "select admin_set_assignment($1,$2,'reviewer',true)", [process, jismy]);
    expect((await run("jismy", "select 1 from subprocess_lines where id=$1", [l])).rowCount).toBe(
      1,
    );
    const n = await db.admin.query(
      "select message from notifications where recipient_user_id=$1 and event_type='review_queue' and process_id=$2",
      [db.users.jismy, process],
    );
    expect(n.rows.some((x) => /already waiting for your review/.test(x.message))).toBe(true);
    await run("jismy", "select line_review_decision($1,'approved','late reviewer')", [l]);
    expect(
      (await db.admin.query("select status from subprocess_lines where id=$1", [l])).rows[0].status,
    ).toBe("approved");
  });
});
