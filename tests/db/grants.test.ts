import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, TEST_URL, type Db } from "./harness";

/** The functions clients may call. Anything else must stay unreachable. */
const CLIENT_CALLABLE = [
  // helpers used by row-level security policies
  "current_person_id",
  "is_approved_user",
  "has_role",
  "has_assignment",
  "can_view_records",
  "can_see_process",
  "can_see_subprocess",
  "can_view_subprocess_records",
  "is_conflicted_reviewer",
  // the write API
  "set_status",
  "complete_stage",
  "record_testing",
  "raise_review_point",
  "record_review_decision",
  "update_review_point",
  "add_comment",
  "register_document_version",
  "set_deadline",
  "set_dashboard_status",
  "admin_approve_user",
  "admin_reject_user",
  "admin_set_user_active",
  "admin_set_assignment",
  "admin_set_person_role",
  "admin_set_team_member",
  "log_document_download",
  "actor_names",
  "mark_notification_read",
  "mark_all_notifications_read",
  "request_export",
  "decide_export",
  "record_export_run",
  "archive_project",
].sort();

describe.skipIf(!TEST_URL)(
  "database grants and policies (the safety net for future migrations)",
  () => {
    let db: Db;
    beforeAll(async () => {
      db = await setup();
    });
    afterAll(async () => db?.close());

    it("has row-level security switched on for every table", async () => {
      const r = await db.admin.query(
        "select tablename from pg_tables where schemaname='public' and not rowsecurity",
      );
      expect(r.rows).toEqual([]);
    });

    it("gives the anonymous role nothing, and signed-in users read access only", async () => {
      const anon = await db.admin.query(
        "select table_name, privilege_type from information_schema.role_table_grants where grantee='anon' and table_schema='public'",
      );
      expect(anon.rows).toEqual([]);
      const auth = await db.admin.query(
        "select distinct privilege_type from information_schema.role_table_grants where grantee='authenticated' and table_schema='public'",
      );
      expect(auth.rows.map((r) => r.privilege_type)).toEqual(["SELECT"]);
    });

    it("exposes exactly the intended functions to signed-in users and none to anonymous", async () => {
      const rows = (
        await db.admin.query(`
        select p.proname,
               has_function_privilege('authenticated', p.oid, 'execute') as auth,
               has_function_privilege('anon', p.oid, 'execute') as anon
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'`)
      ).rows;
      expect(rows.filter((r) => r.anon).map((r) => r.proname)).toEqual([]);
      expect(
        [...new Set(rows.filter((r) => r.auth).map((r) => r.proname as string))].sort(),
      ).toEqual(CLIENT_CALLABLE);
    });

    it("keeps the first-administrator function out of every client's reach", async () => {
      const r = await db.admin.query(
        "select has_function_privilege('authenticated','public.bootstrap_first_admin(text,text)','execute') a, has_function_privilege('anon','public.bootstrap_first_admin(text,text)','execute') b",
      );
      expect(r.rows[0]).toEqual({ a: false, b: false });
    });

    it("grants no write access on any table to any client role", async () => {
      const r = await db.admin.query(`
      select c.relname, a.rolname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace, pg_roles a
      where n.nspname = 'public' and c.relkind = 'r' and a.rolname in ('anon','authenticated')
        and (has_table_privilege(a.rolname, c.oid, 'insert') or has_table_privilege(a.rolname, c.oid, 'update')
          or has_table_privilege(a.rolname, c.oid, 'delete') or has_table_privilege(a.rolname, c.oid, 'truncate'))`);
      expect(r.rows).toEqual([]);
    });
  },
);
