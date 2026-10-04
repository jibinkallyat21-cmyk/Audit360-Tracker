# Tracker & Review

Internal portal for tracking 20 business processes. See `docs/DESIGN.md` for the design and decisions, and `seed/seed.json` for the source-derived seed data.

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in your Supabase project values.
3. Apply `supabase/migrations/*.sql` to your Supabase project (SQL editor, or the Supabase CLI).
4. `npm run dev`

## Design check

To see the design with sample data: `ENABLE_STYLEGUIDE=1 npm run build && ENABLE_STYLEGUIDE=1 npm start`, then open `/styleguide` (or run `node scripts/screenshot-styleguide.mjs <folder>` with the server on port 3120).

## Documents

- `docs/DESIGN.md`: design and decisions.
- `docs/RUNBOOK.md`: setup, deployment, backup, restore, end of project.
- `docs/ACCEPTANCE.md`: each acceptance criterion and how it is verified.

## Checks

`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`

## Database tests

The permission and workflow rules are tested against a real Postgres (not mocks). Point `TEST_DATABASE_URL` at any Postgres 15+ server you can create databases on; each test file creates and drops its own throwaway database:

```
TEST_DATABASE_URL="postgres://postgres@localhost:5432/postgres" npm test
```

Without it the database tests are skipped. To also run the page queries through PostgREST (the API layer Supabase uses), download a PostgREST binary and set `POSTGREST_BIN` to its path. The seed (`supabase/seed.sql`) is generated from `seed/seed.json` with `node scripts/generate-seed.mjs`.

## Status

- Phase 1 (foundation and authentication): done.
- Phase 6 (export and archive with Project Head approval, backup and restore drill, acceptance checklist, runbook, CI): done. See `docs/RUNBOOK.md` and `docs/ACCEPTANCE.md`. Not yet exercised against a live Supabase project: sign-in and email, Storage uploads and downloads, and the file-restore scripts.
- Phase 5 (notifications, administration, team structure, filters): done. The admin screens (Users, Roles, Assignments, Teams) are visible only to System Administrators. The initial process import is the generated seed (`supabase/seed.sql`), not a screen. Export and archive arrive in Phase 6.
- Phase 4 (documents, review points, comments, testing records, approvals, activity history): done. Uploads are validated on the server (size, extension, declared type, file signature, macros) and stored in a private bucket; downloads go through an authenticated route that issues a link valid for one minute. The upload and download routes need a real Supabase project with the `SUPABASE_SERVICE_ROLE_KEY` set, so they have not been run end to end yet.
- Phase 3 (dashboard, workflow explorer, process pages, stage/status controls, countdown): done.
- Phase 2 (schema, row-level security, workflow functions, seed): done and covered by database tests. The admin screens that call the approval and assignment functions arrive in Phase 5; until then, the first administrator is created with `bootstrap_first_admin` (see `docs/DESIGN.md` section 12).
