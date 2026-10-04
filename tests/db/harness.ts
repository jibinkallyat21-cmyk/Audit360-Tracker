import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const root = new URL("../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");

export const TEST_URL = process.env.TEST_DATABASE_URL;

export interface Db {
  /** Run as a superuser (setup/inspection only). */
  admin: Client;
  /** Run as a signed-in user, the same way Supabase does (role authenticated + JWT sub). */
  as<T>(userId: string, fn: (q: Client) => Promise<T>): Promise<T>;
  users: Record<string, string>;
  person(name: string): Promise<string>;
  process(code: string): Promise<string>;
  sub(code: string, seq?: number): Promise<string>;
  close(): Promise<void>;
}

const PERSONAS: Record<string, string> = {
  jibin: "Jibin K K",
  shonD: "Shon Domnic",
  shonJ: "Shon J Iype",
  pavithra: "Pavithra",
  rustham: "Rustham",
  rijin: "Rijin",
  fayis: "Fayis",
  syam: "Syam",
  jismy: "Jismy",
  sajad: "Sajad",
  anna: "Anna",
};

/** Creates a throwaway database with every migration and the real seed applied. */
export async function setup(): Promise<Db> {
  const base = new URL(TEST_URL!);
  const name = "tracker_test_" + randomUUID().replace(/-/g, "").slice(0, 10);
  const root_ = new Client({ connectionString: TEST_URL });
  await root_.connect();
  await root_.query(`create database ${name}`);
  await root_.end();

  base.pathname = "/" + name;
  const admin = new Client({ connectionString: base.toString() });
  await admin.connect();
  const files = [
    "tests/db/stub-auth.sql",
    "supabase/migrations/0001_foundation.sql",
    "supabase/migrations/0002_schema.sql",
    "supabase/migrations/0003_functions.sql",
    "supabase/migrations/0004_rls.sql",
    "supabase/seed.sql",
  ];
  for (const f of files) await admin.query(read(f));

  const users: Record<string, string> = {};
  for (const key of [...Object.keys(PERSONAS), "stranger"]) {
    const { rows } = await admin.query(
      "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
      [`${key}@example.com`, JSON.stringify({ full_name: key })],
    );
    users[key] = rows[0].id;
  }

  await admin.query("select public.bootstrap_first_admin($1)", ["jibin@example.com"]);
  for (const [key, display] of Object.entries(PERSONAS)) {
    if (key === "jibin") continue;
    const { rows } = await admin.query("select id from people where display_name = $1", [display]);
    await admin.query("update profiles set approval_state='approved', person_id=$2 where id=$1", [
      users[key],
      rows[0].id,
    ]);
  }

  const db: Db = {
    admin,
    users,
    async as(userId, fn) {
      const c = new Client({ connectionString: base.toString() });
      await c.connect();
      try {
        await c.query("begin");
        await c.query("set local role authenticated");
        await c.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
        const result = await fn(c);
        await c.query("commit");
        return result;
      } catch (e) {
        await c.query("rollback").catch(() => {});
        throw e;
      } finally {
        await c.end();
      }
    },
    async person(n) {
      return (await admin.query("select id from people where display_name=$1", [n])).rows[0].id;
    },
    async process(code) {
      return (await admin.query("select id from processes where process_code=$1", [code])).rows[0]
        .id;
    },
    async sub(code, seq = 1) {
      return (
        await admin.query(
          "select s.id from subprocesses s join processes p on p.id=s.process_id where p.process_code=$1 and s.seq=$2",
          [code, seq],
        )
      ).rows[0].id;
    },
    async close() {
      await admin.end();
      const c = new Client({ connectionString: TEST_URL });
      await c.connect();
      await c.query(`drop database ${name} with (force)`);
      await c.end();
    },
  };
  return db;
}

/** Runs a statement as a user and returns the error message (or null). */
export async function failure(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
