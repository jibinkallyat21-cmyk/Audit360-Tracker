# Tracker & Review

Internal portal for tracking 20 business processes. See `docs/DESIGN.md` for the design and decisions, and `seed/seed.json` for the source-derived seed data.

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in your Supabase project values.
3. Apply `supabase/migrations/*.sql` to your Supabase project (SQL editor, or the Supabase CLI).
4. `npm run dev`

## Checks

`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`

## Database tests

The permission and workflow rules are tested against a real Postgres (not mocks). Point `TEST_DATABASE_URL` at any Postgres 15+ server you can create databases on; each test file creates and drops its own throwaway database:

```
TEST_DATABASE_URL="postgres://postgres@localhost:5432/postgres" npm test
```

Without it the database tests are skipped. The seed (`supabase/seed.sql`) is generated from `seed/seed.json` with `node scripts/generate-seed.mjs`.

## Status

- Phase 1 (foundation and authentication): done.
- Phase 2 (schema, row-level security, workflow functions, seed): done and covered by database tests. The admin screens that call the approval and assignment functions arrive in Phase 5; until then, the first administrator is created with `bootstrap_first_admin` (see `docs/DESIGN.md` section 12).
