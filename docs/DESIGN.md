# Tracker & Review — Design Document (for sign-off)

Status: **Draft v1 — awaiting approval before Phase 1.** Source of truth: the PRD v1.0 plus the decisions below. Seed data is in `seed/seed.json`, extracted from the two supplied source files.

## 1. Decisions confirmed with the project owner

| #   | Topic                    | Decision                                                                                                                                                                                    |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Source data              | Team_Structure.html and the Analytix AI Before/After workbook are the seed sources                                                                                                          |
| 2   | Accounts                 | No Supabase or Vercel account exists yet; setup guide in section 9                                                                                                                          |
| 3   | Signup                   | Open registration with email confirmation, then **admin approval** before any data access                                                                                                   |
| 4   | System Administrator     | Jibin K K only (also Dashboard Lead, no other role)                                                                                                                                         |
| 5   | Stage vs status          | Per subprocess. Completing a stage advances to the next stage as Not Started. Review completes only on an Approved decision                                                                 |
| 6   | Dashboard (build) status | New, separate field. Only Jibin changes it. Applies once a subprocess reaches Production. Values: Not Started, Under Construction, Under Review, Changes Required, Live/Deployed, Completed |
| 7   | Granularity              | Stage and status per subprocess; process progress is rolled up                                                                                                                              |
| 8   | Stage authority          | Production Lead through Review; Project Lead from Production onward                                                                                                                         |
| 9   | Rework                   | Failed test or change request returns the item to Solution Building with status Changes Required                                                                                            |
| 10  | Self-review              | Blocked: a reviewer cannot decide or approve closure on items where they are also a team member or corrective owner                                                                         |
| 11  | Management view          | Project Head sees aggregates plus process titles; no documents, comments or review details unless separately assigned                                                                       |
| 12  | Supporting roles         | Same rights as Team Member, on assigned processes only                                                                                                                                      |
| 13  | Deadline                 | Unset until Jibin sets it                                                                                                                                                                   |
| 14  | 18-point checklist       | Not in scope                                                                                                                                                                                |
| 15  | Export                   | Admin runs it after Project Head approval; archive kept 1 year, deletion needs written approval                                                                                             |
| 16  | Subprocesses             | The numbered AFTER-AI steps of each workbook process                                                                                                                                        |
| 17  | Phase names              | HTML names                                                                                                                                                                                  |
| 18  | Account matching         | Fuzzy match of email local part to seeded first name; ambiguous matches go to the admin to confirm; nothing links without admin approval                                                    |

## 2. Seed data extracted from the source files

- **20 processes** (1.1 to 6.4), **74 subprocesses**, **6 phases**, **40 people**.
- Phases: Lead and proposal (1.1–1.2), Engagement and advance (2.1–2.2), Audit execution (3.1–3.7), Review (4.1–4.2), Reporting and submission (5.1–5.3), File management and closure (6.1–6.4).
- Production Leads: Pavithra (1.1–2.2, 3.1–3.4, 5.1–5.3), Rustham (3.5–3.7, 4.1–4.2, 6.1–6.4). No person is on both leads' teams.
- Reviewers: Fayis (phases 1, 2, 5), Syam and Azhar (phase 3), Jismy (phases 4 and 6).
- Supporting roles per the HTML: Mohammed Ali and Uvais (1.1, 1.2, 2.1, 2.2, 5.1, 5.3); Sajad (2.2, 5.2); Allen and Dhanhaj (5.1).
- The BEFORE-AI steps, AFTER-AI steps and the measurement rows are stored as read-only requirement context, never as statuses.
- The HTML identifies people by first name only. Surnames and emails are not available.

### Source observations to be aware of

- The workbook has 5 phase headers; the HTML has 6 groups (it splits the first workbook phase in two). We follow the HTML.
- Process 4.2 has a single AFTER-AI step, so it has one subprocess. Counts per process range from 1 to 5.
- Subprocess titles are long sentences taken verbatim from the workbook. They can be shortened later by an admin without code changes.
- The `seed.json` parse of the numbered steps should be spot-checked by you before import.

## 3. Architecture

Next.js (App Router, TypeScript) on Vercel, with Supabase for Postgres, Auth and private Storage. No other infrastructure.

- **Authorization is enforced in Postgres.** Every table has RLS. All writes that change workflow state go through `SECURITY DEFINER` functions (RPC) that check the actor, active role, assignment, current stage, requested transition and required approvals, then write the change and its audit row in one transaction. Direct `UPDATE` on status columns is revoked from the `authenticated` role.
- **Server checks in Next.js** wrap the same RPCs. Hidden buttons are cosmetic only.
- **Files** live in a private bucket. Downloads go through a route that checks access, then issues a signed URL valid for about 60 seconds. There are no permanent public URLs.
- **Service-role key** is used only in server code for admin tasks and exports, never shipped to the browser.
- **Migrations** are version-controlled SQL under `supabase/migrations`.

## 4. Roles and permission matrix

A user may hold several roles. Rights = union of role rights, each scoped by process assignment.

| Role                          | Sees                                                 | Can do                                                                                                                         |
| ----------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Team Member / Supporting role | Assigned subprocesses and their records              | Update own work, upload evidence, comment, respond to review points. No stage transitions                                      |
| Production Lead               | Processes of their own team only                     | Transition stages and status up to and including Review; assign corrective owners; coordinate                                  |
| Reviewer                      | Processes assigned for review                        | Record Pending Review / Changes Required / Approved; raise review points; approve closure (never on items they worked on)      |
| Project Lead                  | All processes (read)                                 | Move an Approved item into Production and manage post-Review status. No override of review decisions, history or approvals     |
| Dashboard Lead                | Dashboard; processes only once they reach Production | Set, change and reset the countdown; set Dashboard (build) status. No approvals                                                |
| Project Head / Management     | Aggregate dashboard with process titles              | Read-only metrics. No documents, comments or review details                                                                    |
| System Administrator          | Users, roles, teams, assignments, config             | Approve signups, link accounts to people, manage assignments, run approved exports. No automatic approval or workflow override |

Archive deletion and the final export require Project Head approval, recorded in the audit log.

## 5. Workflow and status rules

- Stages: Process Definition → Solution Building → Testing → Review → Production. No skipping.
- Status: Not Started, In Progress, Blocked, Changes Required, Completed.
- Review decision (separate field): Pending Review, Changes Required, Approved.
- Transition rules (enforced in RPC):
  1. Completing a stage requires an authorized actor and sets the next stage to Not Started.
  2. Testing can complete only with a recorded testing result. A failed result sends the item back to Solution Building with status Changes Required.
  3. Review can complete only with an Approved decision by an assigned reviewer who is not on the item's team.
  4. Entering Production requires the Approved decision and the Project Lead as actor.
  5. A change request creates or links a review point, assigns an owner and sends the item back to Solution Building.
  6. Review-point closure requires: owner submits a response, then a designated reviewer approves. A comment alone never closes a point.
- Dashboard (build) status is a separate column, writable only by the Dashboard Lead and only when the stage is Production.
- A document change that supersedes evidence marks earlier approvals on that item as "evidence changed" for the reviewer.

## 6. Data model

All PRD tables are kept, with these additions or clarifications:

- `processes`: becomes the process level (20 rows). New table `subprocesses` (74 rows): `id, process_id, seq, title, current_stage, current_status, review_decision, dashboard_status, updated_by, updated_at`.
- `phases`: 6 rows with `display_order`.
- `people` (the 40 seeded names, first name plus display name) and `profiles.person_id`. This lets assignments exist before anyone registers; approval links the account to a person.
- `profiles.approval_state`: pending, approved, rejected, deactivated. RLS denies all project data unless `approved` and `is_active`.
- `process_assignments` references `person_id`, not `user_id`, with types Production Lead, Team Member, Reviewer, Supporting Role. Assignments apply at process level and are inherited by its subprocesses.
- `testing_records`, `review_points`, `comments`, `documents`, `document_versions`, `approvals`, `notifications`, `activity_logs`, `project_settings` as in PRD section 15, each referencing `subprocess_id` where relevant.
- `activity_logs`: `INSERT` only. `UPDATE` and `DELETE` are revoked and blocked by a trigger.
- The countdown deadline is a `timestamptz` in `project_settings`, changed only through an RPC that checks the Dashboard Lead role and logs old and new values.

## 7. Account matching

On registration the email local part is normalized (lowercase, separators removed) and compared to seeded first names by prefix and edit distance.

- One close match: suggested to the admin with a confidence note.
- Several close matches: flagged "needs confirmation" and the admin chooses.
- No match: the admin picks manually or rejects.
- The admin always approves before the account sees anything.

## 8. Delivery plan

Follows PRD section 20, six phases, each reviewed before the next:

1. Foundation: Next.js, linting, migrations, auth, protected shell.
2. Schema, RLS, seed import, permission tests.
3. Dashboard, workflow explorer, transitions, countdown.
4. Documents, versions, comments, review points, testing, audit view.
5. Notifications, administration, team structure page, account matching.
6. Export and archive, security tests, deployment, runbook.

Automated tests cover role permissions (including guessed IDs and direct URLs), workflow transitions, file validation and review approvals.

## 9. Setup you will need to do

1. Create a Supabase project (separate dev and prod projects recommended). Provide the project URL and anon key; the service-role key goes only in Vercel environment variables.
2. Create a Vercel account and connect this GitHub repository.
3. Configure an SMTP provider in Supabase. The built-in mail sender is heavily rate-limited, which matters for 40 signups.
4. Check current free-tier limits (database size, storage, project pausing after inactivity, backup options) before launch.
5. Decide the initial deadline later; Jibin sets it in the app.

## 10. Risks and limits

- Supabase free tier may pause projects after inactivity and has limited backups. The scheduled full export doubles as the backup.
- `.doc` and `.xls` legacy formats are validated by file signature only and may contain macros. No malware scanner is available on the free tier, so files stay inaccessible until server-side validation passes.
- Administrator access to the database or cloud provider can bypass application-level append-only controls; this is an infrastructure risk to restrict.
- Subprocess titles come from free text in the workbook and may need light editing after import.

## 11. Open items for sign-off

- Confirm the extracted subprocess lists in `seed/seed.json` are correct.
- Confirm the permission matrix in section 4, especially that Jibin sees a process only once it reaches Production.
- Confirm the Supabase and Vercel setup steps in section 9.

## 12. Phase 2 implementation notes (changes from the plan above)

- **Administrator visibility.** The System Administrator can read process structure (title, stage, status, assignments) so assignments can be managed, but never records (comments, documents, review points, testing, history of a process). Because Jibin is both Dashboard Lead and administrator, he sees the structure of every process. The Dashboard Lead role on its own sees only items in Production; this is tested with a separate user.
- **Entering Production.** Completing the Review stage is the move into Production, so only the Project Lead can do it. The Production Lead manages status during Review (for example setting it In Progress to signal readiness) but cannot complete Review. The Project Lead can complete a stage only when the status is In Progress, which the Production Lead sets.
- **Roles.** Global roles (Project Head, Project Lead, Dashboard Lead, System Administrator) attach to the seeded person, not the account, so they apply as soon as an account is linked to that person. Production Lead, Team Member, Reviewer and Supporting Role come from process assignments.
- **Re-approval.** If a document version is added after a review approval, the item cannot enter Production until a reviewer approves again.
- **Writes.** Clients have SELECT only. Every change goes through a database function that checks the actor, role, assignment, stage and approvals, and writes its audit entry in the same transaction.
- **First administrator.** The owner runs `select public.bootstrap_first_admin('<email>')` once in the Supabase SQL editor after registering. It refuses to run if an administrator already exists.
