# Runbook: setup, deployment, backup, restore and end of project

This is the operating guide for Tracker & Review. Items marked **[not yet exercised live]** were written and tested as far as possible without a real Supabase project; run them once on the development project and tick them off before launch.

## 1. Architecture in one paragraph

A Next.js app on Vercel talks to one Supabase project: Postgres (all rules live here as row-level security and database functions), Auth (accounts, email confirmation, password reset) and private Storage (Word/Excel files). Users have no direct write access to any table; every change goes through a database function that checks who they are, their role, their assignment, the stage and any required approval, and writes its own history entry.

## 2. One-time setup

Create **two** Supabase projects, one for development and one for production, and never share keys between them.

### 2.1 Database

1. Open the SQL editor (or use the Supabase CLI) and run, in order, every file in `supabase/migrations/` (`0001` to `0008`).
2. Run `supabase/seed.sql` **once**. It loads the 20 processes, 64 subprocesses, 6 phases, 40 people, assignments, teams and role tags. It is generated from `seed/seed.json` by `node scripts/generate-seed.mjs`; do not edit it by hand.
3. Check that the storage bucket `documents` exists and is **private** (Storage page). Migration `0005` creates it.

Migrations that add tables or functions later must repeat the revoke/grant pattern at the end of `0004_rls.sql`, because Supabase grants new objects to the `anon` and `authenticated` roles by default.

### 2.2 Authentication settings (Authentication → Providers / URL configuration / Emails)

| Setting                 | Value                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Email provider          | Enabled, **Confirm email** on                                                                                                  |
| Minimum password length | 10 or more                                                                                                                     |
| Site URL                | the production URL, for example `https://tracker.example.com`                                                                  |
| Redirect URLs           | the production URL and `http://localhost:3000` for development                                                                 |
| SMTP                    | A custom SMTP provider. The built-in sender is heavily rate-limited, which matters when 40 people register and reset passwords |

**Email templates must be edited.** The app confirms links at `/auth/confirm` using a token hash, so the default templates will not work. Set:

- _Confirm signup_:
  `<h2>Confirm your email</h2><p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/">Confirm your email</a></p>`
- _Reset password_:
  `<h2>Reset your password</h2><p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password">Choose a new password</a></p>`

**[not yet exercised live]** Registration, confirmation and password reset have never run against real email. Test all three with a real address before launch.

### 2.3 Vercel

1. Import the GitHub repository into Vercel.
2. Set these environment variables (Production and Preview use the matching Supabase project):

   | Variable                        | Where it is used   | Notes                                                                 |
   | ------------------------------- | ------------------ | --------------------------------------------------------------------- |
   | `NEXT_PUBLIC_SUPABASE_URL`      | browser and server | project URL                                                           |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser and server | safe to expose; access is limited by row-level security               |
   | `NEXT_PUBLIC_SITE_URL`          | server             | the production URL, used in email links                               |
   | `SUPABASE_SERVICE_ROLE_KEY`     | server only        | **never** prefix with `NEXT_PUBLIC_`; bypasses all row-level security |

3. Deploy. Vercel serves HTTPS by default.
4. The export route can run for a while. It declares `maxDuration = 300`; check that your Vercel plan allows it, or the export of 100 files may be cut off. If it is, the approval is not used up and can be retried.

Secrets must never be committed. `.env*` files are ignored by Git; only `.env.example` is tracked.

### 2.4 First administrator

1. Register Jibin K K's account in the app and confirm the email.
2. In the Supabase SQL editor run: `select public.bootstrap_first_admin('jibin-email@example.com');`
   It approves that account, links it to the person "Jibin K K" (who holds the Dashboard Lead and System Administrator roles from the seed) and refuses to run if an administrator already exists.
3. Sign in. The **Admin** menu now appears.

## 3. Running the project

- **New signups**: Admin → Users. Each waiting account shows a suggested person from the email name. Confirm or choose the right person, then approve. Similar names (two people called "Shon") are flagged and never chosen for you.
- **Assignments, roles, teams**: Admin → Assignments / Roles / Teams. Every change is logged.
- **Countdown**: the Dashboard Lead sets the deadline on the Dashboard. Until then it reads "not set yet".
- **People who leave**: Admin → Users → Deactivate. Their history stays.

## 4. Backup

Supabase database backups and file backups are separate, and their availability depends on your plan, so this project does not rely on them alone.

| What     | How                                                                                                                                                                  | How often                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Database | `pg_dump --data-only --no-owner -n public -n auth "<connection string>" > backup-YYYY-MM-DD.sql` (use the direct connection string from Project Settings → Database) | Daily, and before any migration |
| Files    | The project export (section 6) contains every document version with checksums. Run one weekly once the team is uploading                                             | Weekly                          |

Store backups outside Supabase, in an access-controlled location. They contain internal project data and email addresses.

## 5. Restore

Use a new Supabase project (or an empty one).

1. Apply migrations `0001` to `0008` (not the seed; the data comes from the backup).
2. Load the data in replica mode so triggers do not re-create notifications or history:

   ```
   psql "<new connection string>" -v ON_ERROR_STOP=1 --single-transaction \
     -c "set session_replication_role = replica" -f backup-YYYY-MM-DD.sql
   ```

3. Restore files: extract the latest export ZIP, then run
   `node scripts/restore-files.mjs <extracted-folder>` with the new project's URL and service-role key. **[not yet exercised live]**
4. Check that every record still has its file:
   `node scripts/verify-files.mjs` (exit code 1 lists missing files). **[not yet exercised live]**
5. Sign in as a few different roles and confirm each sees only what they should (the checks in `docs/ACCEPTANCE.md`).

### Restore drill (done locally)

`tests/db/restore.test.ts` rehearses steps 1, 2 and 5 against a local Postgres 16: it dumps a populated database, loads it into a fresh one built from the migrations using the replica-mode load above, and checks that every table is identical, history stays append-only with continuous numbering, and the same access rules hold on the restored data. It does **not** exercise Supabase Storage or Supabase's own backup tooling. Repeat the drill on the development Supabase project before launch.

## 6. End of project: export, approval, archive

1. **Request** (administrator): Export → _Request export approval_.
2. **Approve** (Project Head): Export → _Approve export_. The administrator cannot approve their own request. Each approval allows exactly one export.
3. **Download** (administrator): Export → _Download export (ZIP)_. Keep the page open. If the download fails, the approval is still available.
4. **Verify**: unzip and run `sha256sum -c CHECKSUMS.sha256`. Open `MANIFEST.csv` and make sure no row says `included = no`. The README inside the ZIP explains the structure.
5. **Archive** (administrator): Export → _Mark project archived_. This records the date and a one-year retention date. It deletes nothing.
6. Keep the ZIP in an access-controlled location for one year. Delete project data only after written approval; the application has no delete function.

The export reads everything with the service role so that it is complete. That is why it is limited to the administrator, needs an approved request, and is logged at every step.

## 7. Security checklist before launch

- [ ] Production and development use different Supabase projects and keys.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is set only in Vercel server environment variables.
- [ ] The `documents` bucket is private; no policies exist on `storage.objects` for clients.
- [ ] Email confirmation is on; custom SMTP and templates are set and tested.
- [ ] `select * from pg_policies where schemaname='public'` shows a policy on every table that clients may read, and no table grants INSERT/UPDATE/DELETE to `anon` or `authenticated` (the tests check this).
- [ ] The first administrator was created with `bootstrap_first_admin`, and the Supabase dashboard login is restricted to the people who need it. Database access outside the app can bypass the append-only history; keep it limited.
- [ ] A restore drill and an export have been completed on the development project.
- [ ] Current free-tier limits (database size, storage, project pausing after inactivity, auth email rate, backups) have been checked for the plan in use.

## 8. Known limits and risks

- **Supabase free tier** may pause an inactive project and has limited backups. The daily dump and weekly export above cover this.
- **Legacy `.doc` and `.xls`** files are checked by file signature only. Macros cannot be reliably detected in them, and no malware scanner is available on the free tier. `.docx` and `.xlsx` files that contain macros are rejected. If this risk matters, allow only `.docx` and `.xlsx`.
- **Export size and time**: about 100 files of at most 2 MB is comfortable. A very large version history on a plan with a short function time limit may need the export run from a larger plan or in two steps.
- **Administrator access to the database or Supabase dashboard** is outside the application's controls.
- **Not run live**: auth emails, Supabase Storage uploads and downloads, and the file-restore scripts. They need a real project; see the marked items above.

## 9. Prototype demo (optional)

Set `ENABLE_DEMO=1` in Vercel and the login page gains a "Try the demo" box: one button per role. It shows made-up data (`src/lib/demo-data.ts`), reads nothing from Supabase, creates no accounts and refuses every change. Remove `ENABLE_DEMO` for real use.

## 10. Inviting people (Admin → Invite)

Paste employee emails, confirm the person for each, and send. The app creates the account, links and approves it, and Supabase emails a link to set a password. Needs `SUPABASE_SERVICE_ROLE_KEY` in Vercel, and the Supabase **Invite user** email template set to:
`<h2>You have been invited</h2><p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/reset-password">Accept the invite and choose your password</a></p>`
With "Don't email" selected, the page shows each invite link and a CSV (Email, Name, InviteLink) for an Outlook mail merge. Links expire after Supabase's "Email OTP expiration" (Authentication → Providers → Email); set it to the maximum (86400 seconds = 24 hours) before sending. For an account that exists but was never used, link mode makes a fresh link. Raise Supabase's custom-SMTP rate limit (Authentication → Rate Limits) or invite in batches of about 25.

## 11. Maintenance mode

`src/lib/maintenance.ts`. While on, everyone except the emails in `MAINTENANCE_ALLOWED_EMAILS` (default: the project administrator) sees an "Under maintenance" page (HTTP 503); the administrator signs in at `/login` and works as usual. Set `MAINTENANCE_MODE=0` in Vercel to turn it off, or `1` to turn it on; with no value the default in that file applies (currently on).
