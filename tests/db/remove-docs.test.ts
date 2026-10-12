import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { failure, setup, TEST_URL, type Db } from "./harness";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe.skipIf(!TEST_URL)("removing uploaded documents", () => {
  let db: Db;
  const run = (who: string, sql: string, args: unknown[] = []) =>
    db.as(db.users[who], (q) => q.query(sql, args));
  const denied = async (who: string, sql: string, args: unknown[] = []) =>
    expect(await failure(run(who, sql, args)), `${who}: ${sql}`).toMatch(/Not authorized/);
  let n = 0;
  const upload = async (
    who: string,
    sub: string,
    line: string | null = null,
    doc: string | null = null,
  ) => {
    await run(who, "select register_document_version($1,null,$2,'f.docx',$3,1000,$4,null,$5)", [
      sub,
      doc,
      `t/rm-${++n}`,
      DOCX,
      line,
    ]);
    return (await db.admin.query("select id from documents order by created_at desc limit 1"))
      .rows[0].id as string;
  };
  const visible = async (who: string, id: string) =>
    (await run(who, "select 1 from documents where id=$1", [id])).rowCount === 1;

  beforeAll(async () => {
    db = await setup();
  });
  afterAll(async () => db?.close());

  it("lets the uploader, the Production Lead and the administrator remove, nobody else", async () => {
    const sub = await db.sub("1.1", 1);
    const doc = await upload("rijin", sub);
    await denied("fayis", "select remove_document($1)", [doc]); // reviewer
    await denied("rustham", "select remove_document($1)", [doc]); // other team's lead
    await denied("shonD", "select remove_document($1)", [doc]); // Project Lead
    await run("rijin", "select remove_document($1,'wrong file')", [doc]); // the uploader
    expect(await visible("rijin", doc)).toBe(false);
    expect(await visible("pavithra", doc)).toBe(false);
    expect(await visible("jibin", doc)).toBe(true); // the administrator still sees it, to restore
    const log = await db.admin.query(
      "select metadata from activity_logs where action_type='document_removed' and entity_id=$1",
      [doc],
    );
    expect(log.rows[0].metadata.reason).toBe("wrong file");

    const second = await upload("rijin", sub);
    await denied("sajad", "select remove_document($1)", [second]); // supporting role, not the uploader
    await run("pavithra", "select remove_document($1)", [second]); // the Production Lead
    const third = await upload("rijin", sub);
    await run("jibin", "select remove_document($1)", [third]); // the administrator
  });

  it("restores only for the administrator, and blocks new versions on a removed file", async () => {
    const sub = await db.sub("1.1", 2);
    const doc = await upload("rijin", sub);
    await run("rijin", "select remove_document($1)", [doc]);
    expect(await failure(run("rijin", "select remove_document($1)", [doc]))).toBeTruthy();
    expect(await failure(upload("rijin", sub, null, doc))).toMatch(/was removed/);
    await denied("pavithra", "select restore_document($1)", [doc]);
    await run("jibin", "select restore_document($1)", [doc]);
    expect(await visible("rijin", doc)).toBe(true);
  });

  it("keeps the evidence of a line under review or approved in place, except for the administrator", async () => {
    const sub = await db.sub("3.5", 1);
    const line = (
      await db.admin.query(
        "select id from subprocess_lines where subprocess_id=$1 and title='EOSB'",
        [sub],
      )
    ).rows[0].id;
    await run("rustham", "select line_set_status($1,'in_progress')", [line]);
    const doc = await upload("rustham", sub, line);
    await run("rustham", "select line_send_to_review($1,true,null)", [line]);
    expect(await failure(run("rustham", "select remove_document($1)", [doc]))).toMatch(
      /in review or approved/,
    );
    await run("jibin", "select remove_document($1)", [doc]);
  });

  it("does not count a removed file as the evidence a line needs", async () => {
    const sub = await db.sub("3.5", 2);
    const line = (
      await db.admin.query(
        "select id from subprocess_lines where subprocess_id=$1 and title='GOSI'",
        [sub],
      )
    ).rows[0].id;
    await run("rustham", "select line_set_status($1,'in_progress')", [line]);
    const doc = await upload("rustham", sub, line);
    await run("rustham", "select remove_document($1)", [doc]);
    expect(
      await failure(run("rustham", "select line_send_to_review($1,true,null)", [line])),
    ).toMatch(/Upload at least one file/);
  });

  it("blocks removal on a step in Production for everyone but the administrator", async () => {
    const sub = await db.sub("1.1", 3);
    const doc = await upload("rijin", sub);
    await db.admin.query(
      "update subprocesses set current_stage='production', current_status='in_progress', dashboard_status='not_started' where id=$1",
      [sub],
    );
    expect(await failure(run("rijin", "select remove_document($1)", [doc]))).toMatch(
      /Review or Production/,
    );
    await run("jibin", "select remove_document($1)", [doc]);
  });
});
