# HirePilot — Progress

Current wave: 0
Current goal: G0.1 — Live counters resolve or degrade honestly
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

## Standing rules
- Assert on properties, never on literals. G0.1 watched for "23,1xx" for ten
  minutes while the page already said 23,203.
- Read every grep hit before counting it as evidence. "Illustrative example"
  first matched .next build output; "+0" matched Google Fonts unicode-range.
- Comments that describe a bug are not the bug. Strip them before asserting.

## Follow-ups

- H1 — `/api/jobs/sources` returns no `last_fetched`, so poller freshness cannot
  be checked from outside. Needed by the health check itself. Created by ASSESS.

## Rejected

<idea — why it serves no moat>
