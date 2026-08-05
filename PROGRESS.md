# HirePilot — Progress

Current wave: A (Master Prompt v2)
Current goal: A3. Then A4, A5, A6, then A7.2-A7.6.
A7.7 shipped and verified 2026-08-05.
A7.1 shipped and verified 2026-08-05 (priority override).
Blocked on: nothing hard. ADMIN_EMAILS would add identities to the A1 audit,
but the audit itself already ran and found zero affected users.

Wave 0 goals map onto v2 as: G0.6 -> A4, G0.7 -> A5, G0.5 -> A6,
H2/H3/H4/H6/H7/H8 -> A3. G0.4 (pricing) -> B3.

## Health (last checked 2026-08-04, Master Prompt v2 §6)

```
[x] Production returns 200, renders above-the-fold content   app 200 · api 200
[x] Hero counters show real integers
      jobs 23,444 · sources 12 · companies 3,308 · directCompanies 153
[x] Source poller ran within 8 hours   lastSyncedAt 2026-08-04T07:30:44Z
[x] Job count non-zero and grew        23,130 -> 23,203 -> 23,444
[x] Signup -> resume upload -> scored feed, no manual step
      FIXED by A2 and re-verified 2026-08-05 on a brand-new production
      account with no manual recalculate: total 500, top score 0.70.
[x] Latest Railway deploy green
[ ] Zero console errors on landing, dashboard, applications, auto-apply
      /applications and /auto-apply verified clean on production (#45).
      Landing and dashboard NOT re-checked this cycle -> A3.
[x] No tracker row carries "applied" without a submission record
      FIXED by A1 and audited across ALL users 2026-08-05:
      applied_false 0, users_affected 0, constraintPresent true
      (read from pg_constraint).
[x] Every enabled ATS adapter has a verified live run on record
      SUPPORTED_ATS = {greenhouse} only; verified end to end.
```

## A1 — DIAGNOSIS (RESOLVED 2026-08-05 - kept for the reasoning; see the
## shipped entry for what the audit actually found)

**The hole is still open in production.** `POST /api/applications`
(backend/routes/applications.js:89) inserts `status = 'applied'` as a string
literal with no `submitted_at`, no `verified_at`, no
`confirmation_captured_at`, and no `employer_confirmation_text`. Any
authenticated user can create a row that reads as a real submission to a real
employer. This is Constraint 7, structurally unenforced.

Evidence I produced myself: during the #45 regression check I called that
endpoint for user 2 and got back `201` with
`submitted_at: null, verified_at: null, confirmation_captured_at: null` and
`status: applied`. That row exists in production now and is a false "applied".
It is mine, not a real user's, but it proves the path is live.

**Do not blanket-convert every evidence-free 'applied' row.** The schema
carries `is_manual` and `submitted_by`, and the status vocabulary has a
separate `submitted` state. A user manually logging an application they sent
themselves is honestly "applied" with no HirePilot submission record. The rows
A1 must correct are the ones written *automatically* without a send. Flattening
that distinction would relabel honest user entries as failures.

**Confirmed rule (D10a) - encode it in the CHECK constraint, not only the
corrective migration.** A migration fixes today's rows; only a constraint stops
the next write path recreating the hole.

    status = 'applied' AND is_manual = false
      => submitted_at IS NOT NULL OR confirmation_captured_at IS NOT NULL

`is_manual = true` rows are honestly applied and must pass untouched.

Watch the ordering: ADD CONSTRAINT ... CHECK fails outright against existing
violating rows, and services/migrations.js only logs a failed statement - so a
constraint placed before the corrective UPDATE would never apply while looking
like it had. Correct the rows first, or add NOT VALID then VALIDATE. Confirm
the constraint exists afterwards rather than inferring it from a clean boot.

**Outcome.** Shipped 2026-08-05. The live generator turned out to be
agents/[id].js -> POST /api/applications, not merely a latent hole. The
all-user audit found ZERO false rows (the pre-existing corrective UPDATE runs
on every boot and had already cleared them, including the one I created during
the #45 regression check). The constraint now stops them being recreated.


### Pre-existing defects carried in from earlier work

- ~~#45 — Auto Apply and Applications pages never load their data.~~ CLOSED
  2026-08-04. The filed description was wrong in two ways: auto-apply had
  already been fixed and never verified, and the real defect in applications
  was missing render/error floors rather than a fetch that never fired. See
  the diagnosis and shipped entry below.
- **#44 — Checkr submit rejected.** Two Checkr applications fail at submit for two
  *different* reasons; `8088900` shows no validation errors at all.
- Extension drawer, question learning, the additive-resume guard and
  evidence-gated "Applied" all work and are verified.

### Reality check on the pitch

1 application has been verified-submitted end to end. The infrastructure around
it (isolation, evidence gating, question learning) is sound; the loop does not
yet reliably send applications. Wave 4's rejection intelligence needs volume that
does not exist yet — worth knowing before that wave is planned in detail.

## #45 — DIAGNOSIS (written before any fix)

### The filed symptom does not reproduce on production

Both screens were loaded on the production URL with a real token and read via
parsed DOM `innerText`, not regex over HTML:

- `/applications`, user 1 (has history): 8,737 chars. Needs You drawer with
  6 applications / 27 questions, pipeline counts, per-column "No applications",
  2 failed rows carrying real reasons.
- `/auto-apply`, user 1: 6,691 chars, all panels populated.
- `/applications`, user 2 (brand new, seeded this session): 1,932 chars,
  "Nothing is waiting on you.", "0 total applications", empty column states.
- `/auto-apply`, user 2: 3,456 chars, "Nothing clears this bar yet. Lower it,
  or wait for the next ingestion run."

So "never load their data" is STALE as filed. `auto-apply.js` was in fact fixed
in an earlier session — the fix and its reasoning are in the comments at
`pages/auto-apply.js` (mount-only effect; render with defaults instead of
gating on `prefs`). It was never verified and never closed, so it stayed on the
board as an open health failure.

### First hypothesis — tested, WRONG

`if (!user) return null` (applications.js:126) makes SSR emit an empty
`#__next`, so the page shows nothing until the client sets `user`. Proposed as
the whole explanation. Disproved: production runs the same code and renders
fully. The guard is necessary to the failure but not sufficient to cause it.

Probe that settled it: replacing the null branch with a marker div showed the
marker present in the DOM while `window.__COMPONENT_RAN` was never set — and
that line is skipped only when `typeof window === 'undefined'`. So the render
in the DOM was the SERVER's, and the client never executed the component.
(Confirmed the probe could see page globals at all by injecting a `<script>`
tag and reading its value back — same world, so the negative was real.)

### What actually reproduces, and where

Local dev, `/applications`: renders nothing and issues NO request to
`/api/applications` at all — network log is empty of it. Survives a clean
rebuild (`.next` deleted, server restarted, fresh tab), so not a stale cache.

Cause is not page-specific: NO page hydrates cleanly in dev. Every page using
`Layout.js` emits an SSR/client mismatch — server renders `href="/#features"`,
client renders `href="/dashboard"`, because the header keys off a token that
does not exist during SSR. `pages/index.js` adds a second mismatch via
`toLocaleString` (server "Aug 4, 12:12 PM" vs client "4 Aug, 12:12"), a
regression I introduced in G0.1/G0.3. React 18 responds by discarding the
server HTML and re-rendering on the client.

Pages that server-render their content survive that — `/` still shows 3,364
chars. `/applications` does not, because its SSR output is *empty by design*:
there is no server HTML to fall back to, so a disrupted hydration leaves a
permanently blank page.

### The real defect in applications.js — three parts, one theme

None of these is "the page cannot fetch". All three are **missing floors**:
the page has no state to show when something goes wrong, so every failure
renders as either nothing or a confident lie.

1. **No floor under render.** `if (!user) return null` renders literally
   nothing — no shell, no spinner, no empty state, no error. A user sees a
   blank screen and there is nothing on it to diagnose from. This is the
   difference between `/applications` failing visibly and `/auto-apply`
   surviving: auto-apply was already changed to render its shell and fill in
   values as they land.

2. **Effect timing depends on render identity.** Deps are
   `[router, loadApplications]`. `router` changes identity on navigation. This
   is the exact pattern already identified and fixed in `auto-apply.js`, where
   the comment records the consequence: "the page rendered its shell and never
   fetched anything." `applications.js` never got the same fix.

3. **A failed request renders as a confident zero.** `loadApplications` does
   `if (res.ok) { ...setState }` with **no else**, and its `catch` only calls
   `console.error`. On a 401/500 every piece of state keeps its initial value
   and `loading` flips to false — so the page renders "0 total applications"
   and eight "No applications" columns. That is indistinguishable from a
   genuinely empty account. Same class as the fabricated "180+": a number
   presented as fact that was never computed. Constraint 1, not just a missing
   error state.

### Answering the three diagnostic questions asked

- Failing request, bad shape, or crash before the request? **None of those.**
  On production the request succeeds and renders. In the local repro no request
  is issued at all, because the client never runs the component. The bug is
  absent render floors, not a broken fetch.
- All users or only some? **Verified on both seeded states on production and it
  fails for neither.** It fails wherever hydration is disrupted, which is
  user-independent — it is environment- and build-dependent.
- Do empty/error states exist? **Empty yes, error no.** The zero-application
  empty state renders, but carries no next action, and there is no error state
  at all on either screen.

## Shipped

## A7.7 — every list has an explicit, deterministic sort  [shipped + VERIFIED 2026-08-05]
Layer: L1
Changed: backend/routes/jobs.js, matches.js, applications.js, apply.js,
  tracker.js, agents.js, backend/__tests__/jobsRanking.test.js,
  frontend/pages/jobs.js
Evidence (production, signed-in Principal Product Designer account):
  - 24h filter: ranking.sort flips to "recent"; rows strictly descending by
    recency, verified True over the returned set.
  - Best match: score DESC True; 3 equal-score groups all breaking by recency
    DESC with undated last; row ids byte-identical across two reloads
    (determinism, which was the actual complaint).
  - UI states the active order - "Best match first, ties broken by newest" /
    "Newest first, then best match" - so it is never inferred from the data.
  - Clicking Newest first genuinely reorders: 75/undated-first became
    4d/4d/4d/6d/7d with score as the secondary key. orderActuallyChanged True.
Root cause: my own A7.1 tie-break. `ORDER BY overall_score DESC, id` is
  deterministic but orders ties by insertion, which reads as no order at all.
Latent elsewhere, all fixed: Dashboard matches had NO tie-break; Applications,
  Apply Queue, submitted list, Tracker board, Tracker export, Search Agents and
  agent matches all sorted on a timestamp with no unique final key. Postgres
  also defaults DESC to NULLS FIRST, so `ORDER BY posted_at DESC` was leading
  the "newest" list with jobs that have no date.
Learned: `sort` and `ranked` were one field, so choosing "newest" silently
  abandoned the personalised set and dropped every score. Two different
  questions - what order, and which set - must not share a parameter.
Follow-ups: none

## A7.1 — Jobs is the same product as the Dashboard  [shipped + VERIFIED 2026-08-05]
Layer: L1
Changed: backend/middleware/auth.js, backend/routes/jobs.js,
  backend/__tests__/jobsRanking.test.js, frontend/pages/jobs.js,
  frontend/styles/Jobs.module.css
WHY THEY DIVERGED (so it cannot recur):
  /api/jobs took no token. It was unauthenticated, so it could not personalise
  even in principle and fell back to ORDER BY posted_at DESC. The Dashboard
  read /api/matches - authenticated, ORDER BY overall_score DESC. jobs.js
  compounded it by fetching /api/jobs with NO Authorization header while
  sending one to every other call in the same Promise.all. Two ranked products
  for the same user in the same second, because one endpoint never learned who
  was asking.
Evidence (production, real Principal Product Designer account):
  - ranking {mode: score, minScore: 0.4, sourceDiversified: true}, total 500.
  - Top 5 rendered: 75% UX Designer Senior (Valtech), 71% Product Designer
    (Ashby), 71% Staff Product Designer (Greenhouse), 71% UX Designer Senior,
    71% UI/UX Engineer. All design roles. Dashboard's top match was 75% UX
    Designer Senior - the feed's top result now equals it.
  - Score visible on 20/20 rows, strictly descending, at desktop AND 375px.
  - 6 distinct sources on page 1, max 5 from any one. micro1 - which swamped
    every page before - does not appear at all.
  - 375px: no horizontal overflow, controls stack, floor adjustable.
Learned: the first implementation interleaved by source_rank. It stopped
  domination but BROKE score order - the feed read 0.75 0.71 0.67 0.63 0.59
  then jumped back to 0.71 as the next round began. "Score-sorted by default"
  and "no single source may dominate" contradict each other under round-robin.
  Capping each source and THEN ordering by score satisfies both literally.
  Caught only because live verification checked the score SEQUENCE rather than
  just the top row.
  Also: the score rendered as a bare "75" with no unit. A regex looking for a
  score matched 0 of 20 rows while the row text plainly contained it - the
  number was there, the meaning was not.
Follow-ups: A7.3 (dates - "Publication date unavailable" and a 98d-old posting
  under "Today's matches" both observed again during this verification)

## A2 — scoring runs server-side, not per-page  [shipped 2026-08-05]
Layer: L1
Changed: backend/routes/matches.js, backend/routes/resume.js,
  backend/__tests__/scoreOnRead.test.js
Evidence:
  - Root cause was path-dependence, not a missing call: onboarding.js
    recalculates only on its FINAL step (abandon it and you are never scored),
    and resume.js applies parsed skills and never recalculated at all - so the
    Resume page produced a profile and a stale feed.
  - Production, brand-new account a2-verify-...@example.com, no manual
    recalculate at any point: signup -> upload 201 -> apply-parsed
    (skillsAdded 4, scored true) -> GET /api/matches total 500, top 0.70 with
    matched skills Design Systems/Figma/Prototyping/User Research.
  - Before the resume: total 0, scoredOnRead false - a user with no skills is
    not scanned, and is not told a number that was never computed.
  - 6 tests, each verified failing individually against the pre-change files.
    Two of the six pin the new scoredOnRead contract rather than changed
    behaviour; they guard the new path against over-triggering.
Learned: my first ASSESS called this "scoring never runs automatically", from
  an API sequence no real user performs. Reproducing through the actual UI path
  changed the diagnosis. The prompt's own rule - reproduce before diagnosing -
  caught it.
Follow-ups: A2c

## A1 — "applied" is bound to a submission record, in the table  [shipped 2026-08-05]
Layer: L1
Changed: backend/routes/applications.js, backend/services/migrations.js,
  backend/__tests__/appliedRequiresSubmission.test.js
Evidence:
  - The generator was still live: agents/[id].js POSTs /api/applications and
    then shows the job as "applied", while that route inserted status='applied'
    as a literal with no submitted_at, confirmation or employer response.
  - ALL-USER AUDIT RAN on production via GET /api/applications/integrity:
    applied_total 0, applied_false 0, users_affected 0, submitted_total 1.
  - **What that number does and does not prove.** The audit ran AFTER the
    boot-time corrective UPDATE had already executed twice in that session -
    it runs on every deploy, and I deployed twice. So it proves the CURRENT
    state is clean. It does NOT prove no user was ever affected.
    Rows matching exactly that description were observed in production earlier
    the same day, one of them rendering the label "Recorded as applied by an
    earlier build that created tracker rows without submitting to the employer.
    Never sent - re-queue it to apply for real."
    If that corrector silently rewrote real users' rows on some earlier boot,
    those users were never told, and the evidence of who they were is gone -
    the UPDATE overwrites in place and keeps no record of what it touched.
    Treat "0 affected" as "0 affected now", not as "nobody was ever affected".
    See NOTIFY.
  - constraintPresent TRUE, read from pg_constraint - not inferred from a clean
    boot, per the standing rule.
  - D10 honoured: COALESCE(is_manual, FALSE) = TRUE is exempt, so honest manual
    entries are untouched. Manual tracker rows were separately confirmed to use
    status='submitted' with submitted_at set, so the pre-existing corrective
    UPDATE never touched them either.
  - Ordering trap avoided and pinned by test: the corrective UPDATE precedes
    ADD CONSTRAINT, and the constraint's evidence set is a superset of what the
    UPDATE leaves behind - otherwise a survivor would fail the ADD and
    runMigrations would swallow it.
  - 7 tests, each verified failing individually against the pre-change files.
- Suites: backend 22 passed, frontend 18 passed.
Learned: one of the 7 first passed against the broken file because it asserted
  on the query PARAMS while the event name is a literal in the SQL string.
  Checking the wrong argument is its own way to write a test that cannot fail.
Follow-ups: A1-identities (ADMIN_EMAILS)

## #45 — Applications and Auto Apply have a floor in every state  [shipped 2026-08-04]
Moat: M3
Changed: frontend/pages/applications.js, frontend/pages/auto-apply.js,
  frontend/components/NeedsYouDrawer.js, frontend/styles/Applications.module.css,
  frontend/styles/AutoApply.module.css, frontend/jest.config.js,
  frontend/__tests__/applicationsScreen.test.js
Evidence (all on the production URL, asserted on parsed DOM innerText):
  - Three states seeded and verified. user 1 (history): "2 total
    applications", rows render. user 3 (zero): "No applications yet" + a
    "Find jobs to apply to" button. Brand-new with no cached user blob:
    covered by test, renders instead of bouncing to /login.
  - Zero-application state carries a next action and no spinner.
  - Failure FORCED, not read: patched fetch to answer 500, navigated
    client-side. Applications rendered "Could not load your applications -
    the server answered 500." + Try again, with "Application count
    unavailable" and NO "0 total applications" and NO empty state. Auto
    Apply rendered its own banner, class resolved (AutoApply_loadError__ixHbb,
    1px border) so the styles landed too.
  - Zero console errors on both screens on production.
  - 9 new tests; 8 verified failing INDIVIDUALLY against the pre-change file.
    The 9th asserts a correct zero and passes pre-change - kept as state
    coverage and labelled as such in the test rather than counted as proof.
  - Suites executed non-zero: frontend 18 passed, backend 9 passed.
  - Regression end to end on a fresh account: signup 201 -> resume upload 201
    (skills parsed) -> apply-parsed 4 skills / 1 role -> recalculate 500
    matches, top score 0.91 -> tracker write 201 -> read back total 1.
Learned: the filed symptom was stale and the page still had the defect. Both
  were true at once. auto-apply.js had already been fixed in an earlier
  session and never verified, so #45 sat open describing a screen that
  worked; applications.js had never received the same fix, so it still
  carried the failure - it just needed hydration to be disrupted to show it.
  Closing a goal without evidence cost a whole session of re-derivation.
Follow-ups created: H2, H3, H4, H5

## G0.1 — Live counters resolve or degrade honestly  [shipped 2026-08-04]
Moat: M3
Changed: backend/routes/jobs.js, frontend/pages/index.js,
  frontend/styles/Home.module.css, backend/__tests__/jobStats.test.js
Evidence:
  - Real integers <2s: server HTML carries "23,203 active jobs indexed";
    /api/jobs/stats measured at 507ms
  - Board counts real, not +0: zeroed placeholder rows deleted; page shows
    "12 sources indexed"
  - Stated fallback: "connecting to live sources…" replaced with a real count
    plus last-synced time; failure path renders "source count unavailable"
  - Verified on the production URL by fetching it
Learned: the hardcoded "180+" was gated on a boolean and the true figure is 153
  - an 18% overstatement. Assume other hardcoded figures exist (G0.5).
Follow-ups created: H1 resolved by lastSyncedAt

## G0.2 — Remove or replace "Illustrative example"  [shipped 2026-08-04]
Moat: M3
Changed: frontend/pages/index.js, frontend/styles/Home.module.css,
  frontend/__tests__/landingHonesty.test.js
Evidence:
  - No "Illustrative example" label renders; asserted in test
  - All three fabricated constants deleted (MATCH_EXAMPLE 87% Figma role,
    DIFF_EXAMPLE, TRACK_EXAMPLE counts)
  - Panels now show scoring weights, guard rule names and status vocabulary,
    each cited to the file it is read from
  - 5 tests, 3 of which fail against the pre-change file
Learned: a caption does not make an invented number safe - a visitor reads 87%
  before they read "illustrative". Removing the number was the only fix.
Follow-ups created: none

## G0.3 — Footer, meta, and copy hygiene  [shipped 2026-08-04]
Moat: M3
Changed: frontend/components/Layout.js, frontend/pages/index.js,
  frontend/public/og.png, frontend/__tests__/landingHonesty.test.js
Evidence:
  - Copyright computed: footer renders new Date().getFullYear(); test asserts no
    bare four-digit year remains on that line
  - Meta complete: og:title, og:description, og:image, og:url, og:image
    dimensions, twitter:card=summary_large_image, twitter:image - 12 tags
  - og.png is a real 1200x630 PNG, verified by reading its IHDR
  - "NO FAKE AUTO-SUBMIT" section removed from the main scroll; its substance
    moved into two new FAQ entries
  - 4 new tests, all verified failing against the pre-change files
Learned: the FAQ claimed the product cannot submit to employers, which stopped
  being true. Copy that understates is still copy that does not match the
  product. Worth re-reading marketing text whenever a capability lands.
Follow-ups created: none

## Incidents

### Production down twice in one session — Chromium in the API image
**Cause.** PDF export was built as a server-side render through headless
Chromium. Attempt 1: `apk add chromium` on node:18-alpine failed the image
build; Railway had no healthy container and the API was down roughly six
minutes. Attempt 2: Debian slim with apt chromium built, passed a CI image
build, booted, deployed, and reported export available — then the first real
render killed the container and it did not come back.

**Resolution.** Both reverted. PDF export moved to client-side print from the
editor's preview iframe, which is strictly more faithful anyway: it prints the
same DOM the user is looking at, so the output cannot drift from the preview.
resumePdf.js and both /pdf routes were deleted rather than left dormant.

**What it teaches.** A CI step that builds the image was added after the first
outage and did its job — it went green on attempt 2. It was still insufficient:
building and booting an image does not prove a several-hundred-megabyte
subprocess survives inside a small container doing real work. Infra changes go
branch-first with a CI image build AND get flagged before shipping, because a
green build is not a green boot.

**Second defect found in the same work.** The PDF endpoint answered 200 with a
plausible content-type and 879KB of body that was `{"0":37,"1":80,...}` — a
Uint8Array JSON-serialised by res.send, because Puppeteer v23 returns Uint8Array
rather than Buffer. Every download was a corrupt file. Status code, header and
byte count all looked correct. Only opening the file caught it.

## Findings that change the roadmap

### Submission already exists in production, unaudited
The extension submits to employers today, in the user's own signed-in browser,
and marks an application applied only after capturing the employer's
confirmation page. One submission is verified end to end (Scale AI, Greenhouse).

This shipped without the §3 Constraint 4 assessment. Two things follow, and the
second is uncomfortable:

- **G0.6 — audit live submission behaviour.**

  **Platform list, established by reading the code (G0.6 starts from this, not
  from a cold survey):**
  - `SUPPORTED_ATS` in backend/routes/apply.js is exactly
    `{greenhouse, lever, ashby}` — the only three the backend will let the
    extension execute.
  - extension/content/adapters/ holds exactly those three files.
  - Greenhouse: verified end to end on a live form, one confirmed submission.
  - Lever, Ashby: adapters exist, never verified against a live form. They are
    permitted by SUPPORTED_ATS, so they can execute today untested.
  - Workday, Taleo, iCIMS, SmartRecruiters, SuccessFactors: detected by
    detectAts() but excluded from SUPPORTED_ATS. Opened for the user, never
    automated.

  **Mechanism:** browser automation in the user's own signed-in session. No
  credentials are held by HirePilot; the action is user-initiated; the user is
  authenticated as themselves. That is a different posture from server-side
  automation and the terms may read differently for it — some ATS terms prohibit
  automated access regardless of who owns the session, others only prohibit
  unauthorised access. Per-platform, and a legal reading rather than an
  engineering one. G0.6 must NOT conclude this itself.

  **G0.6 has two outputs.** (1) Findable here: the list above, plus what each
  platform's terms actually say. (2) Not findable here: whether that reading is
  correct. Needs counsel, and needs it before Wave 3 scales the capability, not
  after. Where it lands, take the compliant branch per §7 — keep the cleared
  platforms, `deferred: ToS` the rest, reconcile the copy either way.

- **Receipt requirement is only half met — this is a G0.6 finding, not a Wave 3
  feature.** Constraint 4 asks for a receipt of "fields sent, answers given,
  files attached, platform response". What is stored today:
  - Stored and user-reviewable: the employer's confirmation text and reference
    id, submitted_at, verified_at (recordEvidence, surfaced on the application
    detail screen and in /api/apply/submitted).
  - NOT stored as a receipt: what was actually sent. screening_answers holds the
    answers as resolved at fill time, but it is mutated by later discovery runs,
    so it is current state rather than an immutable record of that submission.
    Which file was attached, and the platform's own response beyond the
    confirmation page, are not recorded at all.
  So the "platform response" half exists; the "fields sent / answers given /
  files attached" half does not. A user cannot today reconstruct exactly what
  was submitted on their behalf.

  **This is a Constraint 1 violation, not only a missing feature.** The
  application detail screen renders screening_answers where a user reads "what
  was sent", and later discovery runs rewrite them - so on a submitted
  application the page can show values that never went out. Same class as the
  fabricated "180+", with worse consequences: seeing what left is a user's only
  defence against a bad automated submission.
  - Interim fix SHIPPED this session: submitted applications now carry a notice
    saying these are current profile values, not a copy of what was sent.
  - Real fix, inside G0.6: an immutable submission record - fields, answers,
    file hash, full platform response - frozen at submit time.
- **The mechanism is browser automation, not a public API.** Constraint 4 says
  browser automation against a third party's ATS is `deferred: ToS`. The shipped
  path is exactly that. G0.6 therefore is not only "which platforms may we add"
  but "does what already ships conform to the constraint the project set
  itself". That question needs answering before more submission work, and it may
  conclude that a shipped feature has to change.
- **G0.7 — reconcile all submission copy.** The FAQ was corrected in G0.3; other
  surfaces were not audited. Copy matching product has to be complete.

## NOTIFY

- **Unknown, and now unknowable from the data: users whose tracker rows were
  silently rewritten by the boot-time corrective UPDATE.** That statement has
  been converting `status='applied'` rows with no confirmation into `'failed'`
  on every single boot since it shipped, in place, keeping no record of which
  rows or whose. A1's audit reads 0 because the corrector had already run.
  Anyone affected saw an application they believed was sent turn into a failure
  with an explanatory label, and was never notified that it had happened.
  Operator decision: whether to tell them, and there is no list to tell.
  Preventing a recurrence is done - the constraint stops the rows being created
  - but the historical question is open and cannot be answered from the DB.

## A2c — unknown never renders as zero  [shipped + VERIFIED 2026-08-05]
Layer: L1
Changed: frontend/lib/renderState.js, frontend/pages/jobs.js,
  frontend/pages/auto-apply.js, frontend/components/NotificationBell.js,
  frontend/__tests__/renderState.test.js,
  frontend/__tests__/noFabricatedZero.test.js
Evidence:
  - Production, signed in, sampled every 30ms across a client-side navigation
    so the FIRST PAINT was captured, not just the settled state. Every value
    the counter took: ["Loading results…", "23,958 results"].
    everSaidZeroResults FALSE. Before A2c this rendered "0 results".
  - "Company not stated" renders; the raw "name" placeholder does not.
  - 16 tests (12 primitive + 4 repo-wide guard), each confirmed to fail
    deliberately: two mutations of the primitive, reintroducing useState(0) in
    jobs.js, and removing a real-zero: annotation.
Learned: I called this deploy "not live" on a false negative. The first check
  piped a 42KB minified chunk through a shell variable and grepped the
  variable; the robust check (curl to a file, grep the file) found the strings
  in the SAME build. I broke "verify the artifact, not the proxy" while trying
  to verify an artifact. The poll before that was also the wrong probe - it
  watched SSR HTML for strings that are auth-gated and client-rendered, so it
  could never have matched. Two bad probes in a row on a deploy that had
  already succeeded.
Follow-ups: A2c-ingest, A7.2

## A2c — component inventory (counts, statuses, parsed fields)

Measured, not guessed: every file under pages/ and components/ scanned for
(a) count-like state initialised to 0, (b) `x.y || 0` coercion of a response
field, (c) a literal 0 written to a count, (d) rendering a count at all.

| Component | Was it wrong | State now |
|---|---|---|
| pages/jobs.js | YES - `useState(0)` for total, `data.total \|\| 0`, and `setTotal(0)` in the FAILURE branch. Rendered "0 results" against 23,949 jobs on first paint and after any failed search | FIXED - null-initialised, countText() renders loading / failed / real-zero distinctly; relatedTotal and excludedUnknownDateCount converted too |
| components/NotificationBell.js | PARTLY - `useState(0)` + `unreadCount \|\| 0`; badge is gated on `> 0` so no pixels lied, but the state claimed zero unread before asking | FIXED - null-initialised. The one literal `setUnreadCount(0)` is a REAL zero (everything just marked read) and is annotated `real-zero:` |
| pages/applications.js | YES - fixed earlier in #45: `if (res.ok)` with no else printed "0 total applications" for a failed load | ALREADY CORRECT - countKnown distinguishes null from 0 |
| pages/auto-apply.js | YES - a total load failure rendered defaults ("0 queued to send", "10/day") as the user's settings | ALREADY CORRECT - stated banner; company_name now via parsedOr |
| pages/index.js | YES - fixed in G0.1: hero counters rendered placeholders; /api/jobs/stats returns 503 rather than a zeroed body | ALREADY CORRECT |
| components/NeedsYouDrawer.js | NO - `if (!res.ok)` sets an explicit empty shape, and the empty state is worded, not a bare 0 | CORRECT, unconverted |
| pages/analytics.js, agents.js, agents/[id].js, applications/[id].js, apply-queue.js, resume.js, settings.js, tracker.js, DashboardLayout.js | Render counts but none initialise a count to 0 or coerce with `\|\| 0` (scan clean) | NOT CONVERTED - no instance of the class found; guarded by the repo-wide test |

Parsed fields: `company_name` rendered the literal string `name` (a job whose
company failed to parse at ingestion) on Auto Apply's Next-up panel and in three
places on jobs.js. All four now go through `parsedOr`. The underlying ingestion
bug that stored "name" is NOT fixed - see A2c-ingest.

WEAKENED: the per-component pinning is one repo-wide source guard
(`__tests__/noFabricatedZero.test.js`) plus unit tests on the primitive, not a
rendered test per page. Rendering every page needs each page's full mock
surface; the guard catches the class in any component including ones never
touched, which is how this defect spread. Confirmed to fail deliberately by
reintroducing the bug in jobs.js and by removing the `real-zero:` annotation.

## Standing rules
- **A justification comment is only worth the check behind it.** The
  `// real-zero:` annotation that permits a literal zero puts the burden on the
  writer to say why the zero is measured. That works only while the annotation
  means something. If one ever appears on a zero that is NOT measured, the
  guard is worse than useless - it launders the exact defect it was built to
  catch, and it does so with a comment that reads like diligence. Treat an
  unexplained or copy-pasted `real-zero:` as a defect in its own right.
- **A corrective migration must write an audit row before it mutates.** The
  boot-time UPDATE that repaired false "applied" rows overwrote them in place
  and kept no record, so A1 could prove the current state is clean but could
  never answer who had been affected. That information is gone. Any future
  corrective statement records what it is about to change, first.
- **Presence is not function.** The A7.7 sort control rendered with the right
  label, the right active styling and the right stated order - and did nothing,
  because on that page state alone never refetches and the button called only
  its setter. Every DOM assertion passed. Clicking it and observing the order
  was the only thing that caught it. Assert on the EFFECT of a control, never
  on its existence.
- **A visual change needs a visual or geometric check.** The A7.1 score badge
  overflowed its ring and overlapped the actions on every row while every text
  assertion stayed green - innerText is identical whether an element sits
  inside its container or spills across the one beside it. Check geometry
  (scrollWidth vs clientWidth, bounding boxes) or look at the render.
- **A reload to the same path is not a fresh document.** Measuring after
  `location.href = '/jobs'` while already on /jobs returned the PREVIOUS
  bundle's behaviour and produced a contradictory reading - unranked copy
  beside ranked data. Use location.replace with a cache-busting param when
  verifying a fresh deploy.
- **Assert on the argument that actually carries the value.** A test that
  checked `query.mock.calls[n][1]` (the bound parameters) for an event name
  that is a literal inside the SQL string passed cleanly against the broken
  file. The assertion ran, the suite was green, and nothing was tested.
  This is the THIRD distinct way a test has silently tested nothing here:
  (1) an assertion satisfied by an unrelated earlier occurrence in the file,
  (2) jest exiting with no executed tests and empty output read as a pass,
  (3) this one - right test, wrong argument.
  Confirm every new test fails deliberately at least once before trusting it.
- **A migration runner that logs failures instead of halting turns every failed
  statement into a silent no-op.** `services/migrations.js` wraps each statement
  in try/catch, `console.error`s the failure, and continues - then prints
  "Migrations complete" regardless. A statement that never applied is
  indistinguishable, from the outside, from one that did. Either make the runner
  halt, or verify each statement's effect afterwards. Verify by querying the
  catalog (`pg_constraint`, `information_schema.columns`, `pg_indexes`), never
  by inferring from a clean boot. Same family as the empty jest output and the
  200-with-corrupt-bytes: absence of an error read as evidence of success.
  This uncertainty attaches retroactively to EVERY migration run so far, not
  only to the A1 constraint - see follow-up H9.
- Assert on properties, never on literals. G0.1 watched for "23,1xx" for ten
  minutes while the page already said 23,203.
- Read every grep hit before counting it as evidence. "Illustrative example"
  first matched .next build output; "+0" matched Google Fonts unicode-range.
- Comments that describe a bug are not the bug. Strip them before asserting.
- **Verify against parsed DOM text, never raw markup.** Three false positives in
  three goals, all from treating HTML as a string: the count regex, the
  unicode-range hit, and "© <!-- -->2026<!-- -->" where React splits an
  interpolation with comment markers and a `©\s*\d{4}` pattern cannot match.
  The rule caught all three, but the substrate was wrong each time. Parse, then
  read textContent.
- Present-but-non-functional is a fake pass. An SVG og:image satisfies "og:image
  exists" and renders on no major platform. Generalises well past OG images.
- Prefer a test that binds a claim to its source over a comment asserting it.
  D3's weights test means the landing page cannot drift from the engine's maths;
  a comment saying "keep these in sync" would not.

## Follow-ups

- **A2c-ingest — a job is stored with `company_name` set to the literal string
  "name".** Render is now guarded by `parsedOr`, so users see "Company not
  stated" instead, but the row is still wrong in the database and the ingestion
  path that wrote it is unidentified. Find which source produced it and whether
  other fields are affected.
- ~~A2c — the Jobs feed renders "0 results" before its data lands.** Caught at
  375px on production as a new user: the page showed "Jobs - 0 results" while
  the API held 23,949, then read "23949 results" on reload. A confident zero
  during a wait state is a fabricated number (Constraint 1) and fails A2's
  "every wait state says what is happening". Same class as the "0 total
  applications" removed in #45. THIS IS THE NEXT GOAL.
  WEAKENED: A2 criterion 3 is therefore only partly met - no horizontal
  overflow at 375px and no indefinite spinner were confirmed, but this wait
  state was not fixed.
- **A1-identities** — the integrity endpoint reports counts to any
  authenticated caller and withholds per-user identities unless ADMIN_EMAILS is
  set. It currently reports zero affected users, so there is nothing to
  identify; set the env var only if that count ever becomes non-zero.
- **H9 — audit which migration statements actually took effect.** Every
  statement in `services/migrations.js` has run under a catch-and-continue
  runner, so any that failed did so silently while the boot log still read
  "Migrations complete". Unknown how many, if any, never applied. Needs DB
  access: enumerate expected columns, constraints and indexes from STATEMENTS
  and diff against `information_schema` / `pg_constraint` / `pg_indexes`.
  Do this alongside A1, since A1 is the first goal to depend on a constraint
  actually existing. Created 2026-08-04 by the A1 write-up.
- H1 — `/api/jobs/sources` returns no `last_fetched`, so poller freshness cannot
  be checked from outside. Needed by the health check itself. Created by ASSESS.
- **H2 — SSR/client mismatch in `Layout.js` on every page that uses it.** The
  header renders `href="/#features"` server-side and `href="/dashboard"` on the
  client, because it keys off a token that does not exist during SSR. React 18
  discards the server HTML and re-renders. Found while diagnosing #45; it is
  the reason the local dev server never hydrates cleanly. Not fixed - out of
  #45's scope.
- **H3 — `toLocaleString` hydration mismatch on `pages/index.js`.** Server
  renders "Aug 4, 12:12 PM", client "4 Aug, 12:12". A regression I introduced
  in G0.1/G0.3. Fix by formatting with an explicit locale or formatting
  client-side only.
- **H4 — `page.proof` and `page.proofTitle` are referenced in `auto-apply.js`
  but not defined in `AutoApply.module.css`.** They resolve to `undefined`, so
  that block renders unstyled. Pre-existing, found by a class-resolution check
  added during #45. The same class of defect as the two earlier
  CSS-in-the-wrong-module bugs.
- **H5 — the local dev server cannot be used for browser verification.** No
  page hydrates (see H2). Verification for #45 was done against production,
  which is the substrate the criteria name anyway, but this needs fixing before
  any UI work can be checked locally.

## Rejected

<idea — why it serves no moat>
