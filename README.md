# Tracker & Review

Internal portal for tracking 20 business processes. See `docs/DESIGN.md` for the design and decisions, and `seed/seed.json` for the source-derived seed data.

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in your Supabase project values.
3. Apply `supabase/migrations/*.sql` to your Supabase project (SQL editor, or the Supabase CLI).
4. `npm run dev`

## Checks

`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`

## Status

Phase 1 (foundation and authentication) is done. Sign-in, registration, email confirmation and password reset are in place. Every signed-in user is held on an access-denied page until an administrator approves the account; the approval and role tools arrive in Phase 2.
