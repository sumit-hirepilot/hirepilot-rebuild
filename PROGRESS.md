# HirePilot — Progress

Current wave: A (Master Prompt v2 adopted 2026-08-04)
Current goal: A2 - new-user path (scoring must run on resume upload).
Then A1 - false "applied" rows (DIAGNOSED, at BUILD; see D10/D10a).
Blocked on: A1's all-user audit needs DB access - VERIFY it at ASSESS, do not
assume the railway link landed.

Wave 0 goals map onto v2 as: G0.6 -> A4, G0.7 -> A5, G0.5 -> A6,
H2/H3/H4/H6/H7/H8 -> A3. G0.4 (pricing) -> B3.

## Health (last checked 2026-08-04, Master Prompt v2 §6)

```
[x] Production returns 200, renders above-the-fold content   app 200 · api 200
[x] Hero counters show real integers
      jobs 23,444 · sources 12 · companies 3,308 · directCompanies 153
[x] Source poller ran within 8 hours   lastSyncedAt 2026-08-04T07:30:44Z
[x] Job count non-zero and grew        23,130 -> 23,203 -> 23,444
[ ] Signup -> resume upload -> scored feed, no manual step
      FAIL. Upload 201 and apply-parsed 200 both succeed, but /api/matches
      returned total 0 until POST /api/matches/recalculate was called BY HAND.
      A2 names this exact condition a blocker. A new user reaching the feed
      sees zero matches and no reason.
[x] Latest Railway deploy green
[ ] Zero console errors on landing, dashboard, applications, auto-apply
      /applications and /auto-apply verified clean on production (#45).
      Landing and dashboard NOT re-checked this cycle -> A3.
[ ] No tracker row carries "applied" without a submission record
      FAIL. See A1 diagnosis below.
[x] Every enabled ATS adapter has a verified live run on record
      SUPPORTED_ATS = {greenhouse} only; verified end to end.
```

## A1 — DIAGNOSIS (written before any fix; NOT yet started)

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

**Why it was not started this session:** past the §3 session budget. A1 is a
CHECK-constraint + migration + route change on the `applications` table, and
§3 forbids starting a goal that cannot be verified in-session. A half-applied
migration on that table is the irreversible class of change §3 warns about.

**Verification path already available to the next session:** user 2
(`hp45-new-1785827128@example.com`, id 2) holds exactly one false applied row
on job 14150. `GET /api/applications` for that user must stop reporting it as
applied once the migration lands - a concrete before/after with no DB access
needed.


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

## Standing rules
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
