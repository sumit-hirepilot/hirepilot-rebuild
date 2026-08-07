# PROGRESS — Lane A (backend)

Owns `backend/` only, and is the only lane that writes migrations. Requests
outside it go to HANDOFF.md. Branch `lane-a-backend`, rebased before every
push, never force-pushed.

## Now

**HANDOFF B → A · 1 and · 2 — both landed.** `155272a`. Contract recorded in
HANDOFF.md as A → B · 1 and · 2.

### A linked job is reachable by the person who added it

Feature 4a stored a linked job `is_active = false`. That keeps one person's
link out of the index served to everyone else — 16 shared queries filter on
it, with no change to the hot feed path — and it is still right. What it also
did, and should not have, was hide the job from its **owner**: nothing listed
these rows, so the flow ended at "Added … Scored 55%" and the job could never
be opened, tailored against or queued.

Same class as the pasted-JD row an inner join dropped: work the product
performs and then hides. A 201 the user can never act on is a computed value
nothing reads.

`GET /api/jobs/linked` returns the caller's own linked jobs with the score
attached, paged and bounded.

**Absence is passed through as absence**, in three places, each with a boolean
beside it so the client never infers it from a falsy value:

| field | null when | why it must not be filled |
|---|---|---|
| `company_name` | the page never stated one | inventing a name is fabricated data on a live surface |
| `posted_at` | no genuine publication date exists | never `updated_at`, which moves on every edit — the himalayas trap |
| `score` | scoring failed, job kept | `0` reads as "a terrible match"; `null` reads as "not scored yet" |

**Not a second door into the shared index**: scoped to `added_by_user_id`, and
every row stays `is_active = false`. A test fails if the user filter is
removed.

### A non-numeric `:id` is a 404, not a 500

`/api/jobs/mine` and `/api/jobs/linked` both returned 500 — no such route, so
they fell into `/:id`, where `WHERE id = 'mine'` makes Postgres throw. A 500
claims the server is broken and writes a fault into the crash log that never
happened, which is exactly the noise the crash logging exists to keep out.

Fixed with `router.param('id', …)` rather than a check inside one handler:
**all four** `/:id` routes on this router had the same hole, so fixing the
instance would have left three.

### Proved red

Four guarantees, each broken deliberately and the suite watched to fail:

| broken | test that caught it |
|---|---|
| user scope removed | "scopes to the caller, so it is not a second door into the index" |
| company guessed instead of null | "a company the page did not state stays null and is flagged" |
| score 0 instead of null | "an unscored job is null, never zero" |
| param guard removed | all five `:id` cases returned 500 again |

Two of my own assertions were wrong first, and both are recorded in the test
file: `.not.toMatch(...)` **throws** on `null`, which failed while the code was
correct — a test error dressed as a defect; and `/linked` was still in the
unknown-path list after it became a real route, so the test had outlived the
thing it described.

Backend suite: **394** (floor was 381). Guard census 11/0 unwired. Write paths,
query bounds and mock boundaries all clean.

### Not deployed yet

`lane-a-backend` is a branch. Nothing here is on production, so there is no
load test to record for it — the standing rule applies at deploy, and this has
not deployed. It will run at steady state once the branch lands on `main`.

## Next

Feature 5 — score coaching: the scoring math and endpoint. Then feature 11
(rejection intelligence), then feature 12 (recruiter email routing). Each API
contract goes into HANDOFF.md the moment it lands, before Lane B needs it.

## Lane note

Both lane briefs arrived in this session. This session is now running as
**Lane A**; the earlier D1 blast-radius work in it was done as Lane B and is
committed on `lane-b-frontend` (`ddd1b23`), which also carries that lane's
HANDOFF.md sections. Neither branch edits the other's sections, so they merge
without conflict.
