# Acceptance checklist (PRD section 19)

**Automated** means a test in this repository checks it against a real Postgres database (and, where noted, through PostgREST, the API layer Supabase uses). **Live check** means it needs the real Supabase project, real email or a browser, and is not covered by the automated tests. Run the whole automated suite with the commands in the README.

## 19.1 Authentication and access

| Criterion                                                        | Status                                              | Where                                                                                                                                                                                       |
| ---------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Users can log in and log out                                     | Live check                                          | needs Supabase Auth                                                                                                                                                                         |
| Registration and activation follow the approved internal process | Automated for the rules, live check for the screens | `tests/db/records.test.ts` (approval links a person, access follows, deactivation removes it); `tests/db/visibility.test.ts` (an unapproved account sees nothing and its calls are refused) |
| Password recovery works                                          | Live check                                          | needs real email and the template change in the runbook                                                                                                                                     |
| Inactive users cannot access protected data                      | Automated                                           | `records.test.ts` (deactivated account sees nothing, calls denied)                                                                                                                          |
| Roles and assignments determine process visibility               | Automated                                           | `visibility.test.ts` (team member sees 3 processes; Pavithra and Rustham are kept apart; Project Lead and management see all titles)                                                        |
| Unauthorized direct URL and API access is denied                 | Automated                                           | `visibility.test.ts` (guessing IDs returns nothing); `rest.test.ts` (same through the API; direct writes refused; no token returns nothing)                                                 |

## 19.2 Seed data and workflow

| Criterion                                              | Status                                              | Where                                                                                          |
| ------------------------------------------------------ | --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| All 20 processes are loaded                            | Automated                                           | `visibility.test.ts` (20 processes, 64 subprocesses, 40 people)                                |
| Subprocess descriptions are loaded from the source     | Automated for counts; **please review** the wording | `seed/seed.json` was extracted from the workbook; spot-check it                                |
| Existing team, lead and reviewer assignments preserved | Automated                                           | the seed is generated from the supplied HTML; `rest.test.ts` checks both teams have 13 members |
| Users see stage and status of permitted records        | Automated                                           | `rest.test.ts`, `visibility.test.ts`                                                           |
| Workflow transitions follow the sequence               | Automated                                           | `workflow.test.ts` (no skipping, In Progress required, test required, review required)         |
| Team Members cannot perform lead-only transitions      | Automated                                           | `workflow.test.ts`                                                                             |
| Production Leads control stages through Review         | Automated                                           | `workflow.test.ts`                                                                             |
| Project Lead controls post-Review stages               | Automated                                           | `workflow.test.ts`                                                                             |
| No unauthorized status or approval override            | Automated                                           | `workflow.test.ts`, `records.test.ts` (the administrator cannot act on workflow or records)    |

## 19.3 Documents

| Criterion                                          | Status                                                            | Where                                                                                                               |
| -------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Word and Excel files within 2 MB can be uploaded   | Automated for validation and registration; live check for Storage | `src/lib/files.test.ts`, `records.test.ts`                                                                          |
| Unsupported types and oversized files are rejected | Automated                                                         | `files.test.ts` (extension, type, signature, macros, size); `records.test.ts` (the database also rejects them)      |
| Unauthorized users cannot view or download files   | Automated for the rules; live check for the route                 | `records.test.ts`, `rest.test.ts` (other teams see no documents or versions); download logging denied for outsiders |
| Replacing a file creates a new version             | Automated                                                         | `records.test.ts`                                                                                                   |
| Previous versions remain available                 | Automated                                                         | `records.test.ts`, `rest.test.ts`                                                                                   |
| Superseded evidence is identifiable                | Automated for the flag; the label is in the UI                    | `records.test.ts` (is_current), `workflow.test.ts` (new evidence forces re-approval)                                |

## 19.4 Review and audit history

| Criterion                                                  | Status    | Where                                                                                                                                              |
| ---------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Comments and review points are stored separately           | Automated | schema; `workflow.test.ts`                                                                                                                         |
| Review points have owners and tracked responses            | Automated | `workflow.test.ts`                                                                                                                                 |
| Closure requires an authorized human approval              | Automated | `workflow.test.ts` (a comment does not close a point; owner cannot approve own; only the reviewer can)                                             |
| Testing results and review decisions are traceable         | Automated | `workflow.test.ts`, `rest.test.ts`                                                                                                                 |
| Status changes record old value, new value, actor and time | Automated | `workflow.test.ts`                                                                                                                                 |
| Ordinary users cannot rewrite history                      | Automated | `records.test.ts` (history, comments and approvals are append-only, even for a superuser); `tests/db/restore.test.ts` (still true after a restore) |

## 19.5 Dashboard and notifications

| Criterion                                       | Status                        | Where                                                                                           |
| ----------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------- |
| Countdown visible to every signed-in user       | Live check                    | needs a browser                                                                                 |
| Countdown shows days, hours, minutes, seconds   | Automated for the calculation | `src/lib/phase3.test.ts` (including expired, never negative)                                    |
| Only the Dashboard Lead can modify the deadline | Automated                     | `records.test.ts`                                                                               |
| Deadline changes are logged                     | Automated                     | `records.test.ts` (previous value, new value, user, time)                                       |
| In-app notifications for the configured events  | Automated                     | `tests/db/notifications.test.ts` (comment mentions are not built)                               |
| No notifications about restricted processes     | Automated                     | `notifications.test.ts` (outsiders and management receive none; cleared when access is removed) |
| No email-notification dependency                | By design                     | email is used only for sign-up confirmation and password reset                                  |

## 19.6 Export and hosting

| Criterion                                                         | Status                                                                    | Where                                                                                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Deployed to cloud hosting                                         | Live check                                                                | follow the runbook                                                                                                          |
| Accessible when the owner's computer is off                       | By design, live check                                                     | cloud hosting; no local dependency                                                                                          |
| Authorized users can export records and documents                 | Automated for the archive and approval rules; live check for the download | `src/lib/export/export.test.ts`, `tests/db/export.test.ts`, `rest.test.ts` (every export column reads from the real schema) |
| Export includes version and activity history                      | Automated                                                                 | `export.test.ts` (all versions, manifest, checksums, status history, countdown history)                                     |
| Export and archive operations are logged                          | Automated                                                                 | `tests/db/export.test.ts`                                                                                                   |
| Can be tested with about 40 accounts and the expected file volume | Live check                                                                | seed has 40 people; load the 100-file volume on the development project                                                     |

## Section 6.5 permission testing

| Attempt through                                | Status                                                                              | Where                                                                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Direct URLs                                    | Automated for the data; the page returns "not found" for both missing and forbidden | `visibility.test.ts`, `rest.test.ts`                                                                                            |
| Search results                                 | Automated                                                                           | search runs only over rows the database already allowed; `rest.test.ts` checks the history search returns nothing for outsiders |
| API requests                                   | Automated                                                                           | `rest.test.ts`                                                                                                                  |
| Document download links and file-version links | Automated for the access rule                                                       | `records.test.ts`, `rest.test.ts` (no document or version rows for outsiders)                                                   |
| Export functions                               | Automated                                                                           | `export.test.ts`, `rest.test.ts`                                                                                                |
| Backups and restore                            | Automated locally                                                                   | `tests/db/restore.test.ts`; repeat on Supabase before launch                                                                    |
