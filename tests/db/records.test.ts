import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { failure, setup, TEST_URL, type Db } from "./harness";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe.skipIf(!TEST_URL)("documents, history, countdown and administration", () => {
  let db: Db;
  beforeAll(async () => {
    db = await setup();
  });
  afterAll(async () => db?.close());

  const run = (user: string, sql: string, params: unknown[] = []) =>
    db.as(db.users[user], (q) => q.query(sql, params));
  const denied = async (user: string, sql: string, params: unknown[] = []) =>
    expect(await failure(run(user, sql, params))).toMatch(/Not authorized/);

  it("versions documents instead of overwriting, and labels the current one", async () => {
    const sub = await db.sub("1.1", 1);
    const v1 = await run(
      "rijin",
      "select register_document_version($1,null,null,'plan.docx','a/1',1000,$2) id",
      [sub, DOCX],
    );
    const doc = (
      await db.admin.query("select document_id from document_versions where id=$1", [v1.rows[0].id])
    ).rows[0].document_id;
    await run(
      "rijin",
      "select register_document_version($1,null,$2,'plan.docx','a/2',2000,$3,'rev') id",
      [sub, doc, DOCX],
    );
    const rows = (
      await run(
        "pavithra",
        "select version_number, is_current, storage_path from document_versions order by version_number",
      )
    ).rows;
    expect(rows).toEqual([
      { version_number: 1, is_current: false, storage_path: "a/1" },
      { version_number: 2, is_current: true, storage_path: "a/2" },
    ]);
    // Another team sees none of it, and cannot add versions to it.
    expect((await run("rustham", "select count(*) from document_versions")).rows[0].count).toBe(
      "0",
    );
    await denied("rustham", "select register_document_version($1,null,$2,'x.docx','a/3',10,$3)", [
      sub,
      doc,
      DOCX,
    ]);
    await denied("shonJ", "select register_document_version($1,null,null,'x.docx','a/4',10,$2)", [
      sub,
      DOCX,
    ]);
  });

  it("rejects unsupported types, wrong extensions and files over 2 MB at the database", async () => {
    const sub = await db.sub("1.1", 1);
    const bad = [
      ["a.pdf", "application/pdf", 100],
      ["a.docx", "application/pdf", 100],
      ["a.exe", DOCX, 100],
      ["big.docx", DOCX, 2097153],
      ["zero.docx", DOCX, 0],
    ] as const;
    for (const [name, mime, size] of bad) {
      const msg = await failure(
        run("rijin", "select register_document_version($1,null,null,$2,$3,$4,$5)", [
          sub,
          name,
          "p/" + name,
          size,
          mime,
        ]),
      );
      expect(msg, name).toMatch(/violates check constraint/);
    }
    const ok = await failure(
      run(
        "rijin",
        "select register_document_version($1,null,null,'ok.xlsx','p/ok',2097152,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')",
        [sub],
      ),
    );
    expect(ok).toBeNull();
  });

  it("keeps history append-only for everyone", async () => {
    const attempts = [
      "update activity_logs set action_type='x'",
      "delete from activity_logs",
      "truncate activity_logs",
      "update comments set comment_text='x'",
      "delete from approvals",
    ];
    for (const sql of attempts) {
      expect(await failure(db.admin.query(sql)), sql).toMatch(/append-only/);
      expect(await failure(run("jibin", sql)), sql).toMatch(/permission denied/);
    }
  });

  it("lets only the Dashboard Lead set the countdown, and logs each change", async () => {
    const t1 = "2030-01-01T00:00:00Z";
    const t2 = "2030-02-01T00:00:00Z";
    for (const u of ["shonD", "shonJ", "pavithra", "rijin"])
      await denied(u, "select set_deadline($1)", [t1]);
    await run("jibin", "select set_deadline($1)", [t1]);
    await run("jibin", "select set_deadline($1)", [t2]);
    const v = await run(
      "rijin",
      "select setting_value from project_settings where setting_key='project_deadline'",
    );
    expect(new Date(v.rows[0].setting_value).toISOString()).toBe(new Date(t2).toISOString());
    const log = (
      await db.admin.query(
        "select actor_id, previous_value, new_value from activity_logs where action_type='deadline_set' order by id",
      )
    ).rows;
    expect(log).toHaveLength(2);
    expect(log[0].previous_value).toBeNull();
    expect(new Date(log[1].previous_value).toISOString()).toBe(new Date(t1).toISOString());
    expect(log.every((r) => r.actor_id === db.users.jibin)).toBe(true);
    // System events are not shown to ordinary users.
    expect(
      (await run("rijin", "select count(*) from activity_logs where process_id is null")).rows[0]
        .count,
    ).toBe("0");
    expect(
      Number(
        (await run("jibin", "select count(*) from activity_logs where action_type='deadline_set'"))
          .rows[0].count,
      ),
    ).toBe(2);
  });

  it("administers accounts: approval links a person, access follows, deactivation removes it", async () => {
    const allen = await db.person("Allen");
    const rijin = await db.person("Rijin");
    await denied("rijin", "select admin_approve_user($1,$2)", [db.users.stranger, allen]);
    await denied("shonD", "select admin_approve_user($1,$2)", [db.users.stranger, allen]);
    expect((await run("stranger", "select count(*) from processes")).rows[0].count).toBe("0");

    expect(
      await failure(run("jibin", "select admin_approve_user($1,$2)", [db.users.stranger, rijin])),
    ).toMatch(/already linked/);
    await run("jibin", "select admin_approve_user($1,$2)", [db.users.stranger, allen]);
    const seen = await run("stranger", "select process_code from processes");
    expect(seen.rows.map((r) => r.process_code)).toEqual(["5.1"]); // Allen is only on 5.1

    await run("jibin", "select admin_set_user_active($1,false)", [db.users.stranger]);
    expect((await run("stranger", "select count(*) from processes")).rows[0].count).toBe("0");
    await denied("stranger", "select add_comment($1,'x')", [await db.sub("5.1")]);
    expect(
      await failure(run("jibin", "select admin_set_user_active($1,false)", [db.users.jibin])),
    ).toMatch(/your own access/);
    const log = (
      await db.admin.query(
        "select action_type from activity_logs where entity_type='profile' order by id",
      )
    ).rows.map((r) => r.action_type);
    expect(log).toEqual(
      expect.arrayContaining(["bootstrap_admin", "user_approved", "user_deactivated"]),
    );
  });

  it("gives the administrator no way to act on workflow or records", async () => {
    const sub = await db.sub("1.1", 1);
    await denied("jibin", "select set_status($1,'in_progress')", [sub]);
    await denied("jibin", "select complete_stage($1)", [sub]);
    await denied("jibin", "select add_comment($1,'x')", [sub]);
    await denied("jibin", "select record_review_decision($1,'approved')", [sub]);
    expect((await run("jibin", "select count(*) from document_versions")).rows[0].count).toBe("0");
  });

  it("lets assignments be changed without code, with an audit entry", async () => {
    const proc = await db.process("1.2");
    const sajad = await db.person("Sajad");
    await denied("pavithra", "select admin_set_assignment($1,$2,'team_member',true)", [
      proc,
      sajad,
    ]);
    expect(
      (await run("sajad", "select count(*) from processes where process_code='1.2'")).rows[0].count,
    ).toBe("0");
    await run("jibin", "select admin_set_assignment($1,$2,'team_member',true)", [proc, sajad]);
    expect(
      (await run("sajad", "select count(*) from processes where process_code='1.2'")).rows[0].count,
    ).toBe("1");
    await run("jibin", "select admin_set_assignment($1,$2,'team_member',false)", [proc, sajad]);
    expect(
      (await run("sajad", "select count(*) from processes where process_code='1.2'")).rows[0].count,
    ).toBe("0");
    const n = await db.admin.query(
      "select count(*) from activity_logs where action_type like 'assignment_%' and process_id=$1",
      [proc],
    );
    expect(n.rows[0].count).toBe("2");
  });

  it("logs downloads only for people who may view the document", async () => {
    const sub = await db.sub("1.1", 1);
    const v = await run(
      "rijin",
      "select register_document_version($1,null,null,'d.docx','dl/1',500,$2) id",
      [sub, DOCX],
    );
    const vid = v.rows[0].id;
    await run("pavithra", "select log_document_download($1)", [vid]);
    for (const u of ["rustham", "shonJ", "jibin"])
      await denied(u, "select log_document_download($1)", [vid]);
    const log = await db.admin.query(
      "select actor_id from activity_logs where action_type='document_downloaded' and entity_id=$1",
      [vid],
    );
    expect(log.rows.map((r) => r.actor_id)).toEqual([db.users.pavithra]);
  });

  it("resolves author names without exposing emails", async () => {
    const fresh = (
      await db.admin.query(
        "insert into auth.users (email) values ('fresh@example.com') returning id",
      )
    ).rows[0].id;
    const r = await run("rijin", "select * from actor_names($1)", [[db.users.pavithra, fresh]]);
    expect(r.rows).toEqual([{ profile_id: db.users.pavithra, display_name: "Pavithra" }]);
    // An unapproved account gets nothing back.
    const none = await db.as(fresh, (q) =>
      q.query("select * from actor_names($1)", [[db.users.pavithra]]),
    );
    expect(none.rows).toEqual([]);
    // Emails stay private: other people's profile rows are invisible.
    const hidden = await run("rijin", "select email from profiles where id=$1", [
      db.users.pavithra,
    ]);
    expect(hidden.rows).toEqual([]);
  });
});
