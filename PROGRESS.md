# HirePilot — Progress

Current wave: 0
Current goal: #45 (health failure, preempts backlog)

## Next session order (revised)
0. DONE THIS SESSION — kill switch. Lever and Ashby removed from SUPPORTED_ATS.
   They were permitted to submit while never having been run against a live
   form. Re-enable per-adapter only alongside evidence of a verified live run;
   backend/__tests__/supportedAts.test.js makes that edit deliberate.
1. #45 — Auto Apply / Applications never load their data. A health-check failure,
   so it preempts the backlog. It was run behind G0.1-G0.3 last session; that
   was wrong by the loop's own ASSESS rule.
2. G0.6 — Submission audit. See below: this is now an audit of live behaviour,
   not forward planning.
3. G0.7 — Reconcile ALL submission copy, not just the FAQ.
4. G0.5 — Hardcoded figure sweep.
5. G0.4 — Pricing page.
Blocked on: —

## Health (last checked 2026-07-31)

```
[x] Production URL returns 200 and renders above-the-fold content
      app 200 · api 200
[ ] Hero counters show real integers
      FAIL — renders "— active jobs indexed", "— live sources", "— companies"
      and a hanging "connecting to live sources…". "+0" also present on the page.
[?] Source poller ran within the last 8 hours
      13 sources returned, but /api/jobs/sources exposes no last_fetched, so
      freshness is UNVERIFIABLE from outside. Treated as a finding, not a pass.
[x] Job count in DB is non-zero and grew since the last check
      23,130 jobs across 13 sources (himalayas 3,984 · nofluffjobs 2,980 ·
      jobicy 377 · remoteok 324 · hackernews 209 · landingjobs 51 · others)
[ ] Signup → resume upload → scored feed completes end to end
      NOT RUN this cycle — deferred to the G0.1 regression check
[x] Latest Railway deploy is green
[ ] No console errors on the landing page or dashboard
      FAIL — known hydration errors; see the pre-existing defects below
```

### Pre-existing defects carried in from earlier work

- **#45 — Auto Apply and Applications pages never load their data.** `load()` is
  never entered; no effect fires in those components. Ruled out: API base, token,
  response shape, state updates, hydration, stale caches. The Needs You drawer is
  unreachable in the web app as a result.
- **#44 — Checkr submit rejected.** Two Checkr applications fail at submit for two
  *different* reasons; `8088900` shows no validation errors at all.
- Extension drawer, question learning, the additive-resume guard and
  evidence-gated "Applied" all work and are verified.

### Reality check on the pitch

1 application has been verified-submitted end to end. The infrastructure around
it (isolation, evidence gating, question learning) is sound; the loop does not
yet reliably send applications. Wave 4's rejection intelligence needs volume that
does not exist yet — worth knowing before that wave is planned in detail.

## Shipped

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

- H1 — `/api/jobs/sources` returns no `last_fetched`, so poller freshness cannot
  be checked from outside. Needed by the health check itself. Created by ASSESS.

## Rejected

<idea — why it serves no moat>
