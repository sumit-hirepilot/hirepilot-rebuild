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

<append RECORD entries here, newest last>

## Follow-ups

- H1 — `/api/jobs/sources` returns no `last_fetched`, so poller freshness cannot
  be checked from outside. Needed by the health check itself. Created by ASSESS.

## Rejected

<idea — why it serves no moat>
