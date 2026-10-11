import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { failure, setup, TEST_URL, type Db } from "./harness";

describe.skipIf(!TEST_URL)("chat: everyone, one person, or the people of one process", () => {
  let db: Db;
  const run = (who: string, sql: string, args: unknown[] = []) =>
    db.as(db.users[who], (q) => q.query(sql, args));
  const denied = async (who: string, sql: string, args: unknown[] = []) =>
    expect(await failure(run(who, sql, args)), `${who}: ${sql}`).toMatch(
      /Not authorized|permission denied|row-level security/,
    );
  const messages = async (who: string, conv: string) =>
    (
      await run(who, "select body from chat_messages where conversation_id=$1 order by id", [conv])
    ).rows.map((r) => r.body);

  beforeAll(async () => {
    db = await setup();
    for (const u of ["rijin", "pavithra", "fayis", "rustham", "jibin", "shonD", "shonJ"]) {
      await run(u, "select chat_ensure_groups()");
    }
  });
  afterAll(async () => db?.close());

  const convOf = async (who: string, kind: string, code?: string) =>
    (
      await run(
        who,
        "select conversation_id from chat_overview() where kind=$1 and ($2::text is null or process_code=$2)",
        [kind, code ?? null],
      )
    ).rows[0]?.conversation_id as string | undefined;

  it("gives everyone approved the common chat, and nobody else", async () => {
    const common = await convOf("rijin", "common");
    expect(common).toBeTruthy();
    await run("rijin", "select chat_send($1,'hello all')", [common]);
    for (const u of ["pavithra", "jibin", "shonJ", "rustham"]) {
      expect(await messages(u, common!), u).toEqual(["hello all"]);
    }
    // A pending account sees nothing and cannot post.
    expect((await run("stranger", "select count(*) from chat_messages")).rows[0].count).toBe("0");
    await denied("stranger", "select chat_send($1,'x')", [common]);
    await denied("stranger", "select chat_ensure_groups()");
  });

  it("keeps a direct message between its two people, even from the administrator", async () => {
    const opened = await run("rijin", "select chat_open_direct($1) id", [db.users.pavithra]);
    const conv = opened.rows[0].id;
    // The same two people always get the same conversation, whoever opens it.
    expect(
      (await run("pavithra", "select chat_open_direct($1) id", [db.users.rijin])).rows[0].id,
    ).toBe(conv);
    await run("rijin", "select chat_send($1,'just for you')", [conv]);
    expect(await messages("pavithra", conv)).toEqual(["just for you"]);
    for (const u of ["jibin", "shonD", "shonJ", "fayis", "rustham"]) {
      expect(await messages(u, conv), u).toEqual([]);
      await denied(u, "select chat_send($1,'x')", [conv]);
      await denied(u, "select chat_mark_read($1)", [conv]);
    }
    const seen = await run("jibin", "select count(*) from conversations where kind='direct'");
    expect(seen.rows[0].count).toBe("0");
    // You cannot message yourself, or someone who is not an active member.
    expect(await failure(run("rijin", "select chat_open_direct($1)", [db.users.rijin]))).toMatch(
      /someone else/,
    );
    expect(await failure(run("rijin", "select chat_open_direct($1)", [db.users.stranger]))).toMatch(
      /not available/,
    );
  });

  it("limits a process chat to the people assigned to that process", async () => {
    const conv = await convOf("pavithra", "process", "1.1");
    expect(conv).toBeTruthy();
    await run("pavithra", "select chat_send($1,'team of 1.1 only')", [conv]);
    for (const u of ["rijin", "fayis"]) {
      expect(await messages(u, conv!), u).toEqual(["team of 1.1 only"]);
    }
    // Not assigned: the Project Lead, the Project Head, the administrator, another lead.
    for (const u of ["shonD", "shonJ", "jibin", "rustham"]) {
      expect(await messages(u, conv!), u).toEqual([]);
      await denied(u, "select chat_send($1,'x')", [conv]);
    }
    expect(await convOf("rustham", "process", "1.1")).toBeUndefined();
  });

  it("counts unread messages per conversation and clears them when read", async () => {
    const common = (await convOf("rijin", "common"))!;
    await run("pavithra", "select chat_send($1,'one more')", [common]);
    const before = await run("rijin", "select chat_unread_total() n");
    expect(Number(before.rows[0].n)).toBeGreaterThan(0);
    await run("rijin", "select chat_mark_read($1)", [common]);
    const unread = (conv: string) =>
      run("rijin", "select unread from chat_overview() where conversation_id=$1", [conv]);
    expect((await unread(common)).rows[0].unread).toBe("0");
    // Your own messages never count as unread for you.
    await run("rijin", "select chat_send($1,'mine')", [common]);
    expect((await unread(common)).rows[0].unread).toBe("0");
  });

  it("rejects empty and over-long messages, and every direct write", async () => {
    const common = (await convOf("rijin", "common"))!;
    expect(await failure(run("rijin", "select chat_send($1,'   ')", [common]))).toMatch(
      /Write a message/,
    );
    expect(
      await failure(run("rijin", "select chat_send($1,$2)", [common, "x".repeat(4001)])),
    ).toMatch(/check constraint/);
    await denied(
      "rijin",
      "insert into chat_messages (conversation_id, sender_id, body) values ($1,$2,'x')",
      [common, db.users.rijin],
    );
    await denied("rijin", "update chat_messages set body='edited'");
    await denied("rijin", "delete from chat_messages");
    await denied("rijin", "insert into conversations (kind) values ('common')");
  });

  it("lists only names, never emails, for the person picker", async () => {
    const rows = (await run("rijin", "select * from chat_people()")).rows;
    expect(rows.length).toBeGreaterThan(3);
    expect(Object.keys(rows[0]).sort()).toEqual(["display_name", "profile_id"]);
    expect(rows.every((r) => r.profile_id !== db.users.rijin)).toBe(true);
  });

  it("keeps push subscriptions and keys out of clients' reach", async () => {
    await run("rijin", "select push_subscribe('https://push.example/abc','p256','auth')");
    await denied("rijin", "select * from push_subscriptions");
    await denied("rijin", "select * from push_keys");
    expect(
      await failure(run("rijin", "select push_subscribe('http://push.example/abc','p','a')")),
    ).toMatch(/Invalid subscription/);
    // A subscription can only be removed by its owner.
    await run("pavithra", "select push_unsubscribe('https://push.example/abc')");
    expect((await db.admin.query("select count(*) from push_subscriptions")).rows[0].count).toBe(
      "1",
    );
    await run("rijin", "select push_unsubscribe('https://push.example/abc')");
    expect((await db.admin.query("select count(*) from push_subscriptions")).rows[0].count).toBe(
      "0",
    );
  });
});
