# PROGRESS

## Now

**Full feature audit — DONE.** Four defects found, all fixed, all verified on
production, each given a ship-gate check proved red on the real defect first.
Written up in AUDIT.md. Commits `f3e4b74`, `f71f566`.

The class was the one feature 1 surfaced: **the label disagreeing with the
data**. All four were found by reading a live surface against what produced it.
None was reachable from a code read, and both suites were green throughout —
and in one case a test was actively *pinning the false claim in place*.

| # | Defect | State |
|---|---|---|
| D1 | landing page named `no_deletion`, a guard rule removed as unreachable, under a heading reading "these three checks" when there are two | fixed, count now derived |
| D2 | backend tiers Starter/Pro/Power vs `/pricing` Free/Pilot/Copilot — no overlap; the pill said "on Power", a plan never sold | fixed, ids untouched |
| D3 | `/pricing` said applications "are not metered on any plan" in four places while `submissionGate` refuses to submit at `remaining <= 0` | fixed, allowance kept |
| D4 | employment-type chip published raw source tokens — `Clt`, `Hybrid`, `Remote` — via `ELSE lower(job_type)` | fixed, vocabulary closed |

D3's test, `landingTruth`, asserted the page *must* say "never per
application" — green the whole time, defending the lie. Fixing the page would
have looked like breaking the suite. Coverage pointing the wrong way is worse
than no coverage.

Load test after deploy, at uptime 363s: **200 concurrent 600/600, p95 2,767 ms
vs 2,822 ms baseline — no regression, zero failures.** Peak RSS 424 MB against
the 800 MB abort. Full numbers in LOAD.md.

Suites: backend **327**, frontend **244**.

## Next

**Feature 2 — plain language across the app.** The queue after it: 3, 4a, 4b,
5, 6, 8, 9, 10, 11, 12, 13, 14, 15, with the full audit repeated after every
third feature.

Two findings from this audit belong to feature 2 and carry forward:

- The `experience` facet covers 9,709 of 25,431 jobs (38%). It is inferred only
  where detectable and does not overstate, but a filter that silently omits 62%
  of the index should say so on the surface.
- Tap targets under 28 px at 375: checkboxes at 13–16 px, "Original posting" at
  19 px.

## Carried, not started

- GOAL 1i's three sweeps with CI checks
- GOAL 1j's remainder — the RSS-under-500 MB CI assertion and the 50-concurrent
  smoke test
- GOAL 2's bounds sweep — 6 of 7 routes, jobs last
- The test flake: four hypotheses disproved, 3 occurrences in hundreds of runs.
  Not being investigated per instruction; full failure output is now captured
  to a temp file when it recurs.

## Standing

Submission halt is still on: `429 {"error":"Submission is paused for all
accounts.","reason":"halted"}`. Re-checked at the start of this goal.

Operator dependencies unchanged, in BLOCKED.md — lifting the submission halt,
`healthcheckPath` on the backend service, the Postgres volume size from the
Railway canvas, Google OAuth for feature 12, Greenhouse ToS counsel, the B1
batch-approval gate, payment credentials.
