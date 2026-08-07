# PROGRESS

## Now

**Full feature audit, round 2 — done. Four defects, all fixed and verified on
production.** `d46c991`, `69efd94`, `94ad0ac`, `197ded6`. Full table in
AUDIT.md.

| # | Defect | Found by |
|---|---|---|
| D1 | **feature 4a's frontend never deployed** — `next build` failed, Railway kept the last good build, and the gate ran ten stages of tests over a bundle that could not be built | grepping the served chunks |
| D2 | the refusal handoff pointed correctly and **landed on the wrong tab** — `/resume` never honoured `?tab=` | clicking it |
| D3 | tailoring **succeeded and the screen threw the result away** — `reload()` unmounted the component that held it; hit both paths, predates feature 3 | pressing the button |
| D5 | the desktop-only label **overflowed the header and clipped "4500 left" to "45"** at 375; page overflow read 0 throughout | a screenshot |

D1 is the one that matters most: the gate could not see a build. `next build`
is now stage 9 of 11, proved red by restoring the `<a>`.

D4 was **disproved** — the dashboard greeting looked wrong because I had
injected a session shaped like `/api/auth/me` (`full_name`) rather than
`/api/auth/login` (`fullName`). Recorded as an artifact, with the real
observation kept: those two endpoints describe one field two ways.

Everything else passed, checked against the data behind it: landing figures,
facet sums, closed jobType vocabulary, experience facet == filter on all four
bands, scoring arithmetic (headline % = Σ contributions, per-component
score×weight, weights = 1.0), credits, plan names, all refusal reasons, the
hostile paste, and SSRF — all on production, at 1440 / 768 / 375 and on an
emulated phone reporting `userAgentData.mobile: true` and 5 touch points.

Load after the fixes: **200 concurrent 600/600, p95 2,593 ms vs 2,777 ms.**

Suites: backend **381**, frontend **262**.

### All four Indian boards are now assessed and closed

| board | verdict |
|---|---|
| Naukri | **FAIL** — 403 on `robots.txt` itself (Akamai edge); cannot even read the permission file |
| Wellfound | **FAIL** — disallows `/_jobs/` and every job-page query pattern |
| Cutshort | **FAIL** — disallows `/view/j/`, `/vj/`, `/*?job_listing` — the job views themselves |
| Instahyre | **FAIL** — permissive `robots.txt`, but the server 403s every page behind a Cloudflare challenge, including the sitemap that file advertises to crawlers |

**The paste path is the answer, not a workaround.** A user pastes one link or
one description for a job they are already looking at. That is not a crawl, it
raises no ToS question, and it reaches an identical tailored resume, score and
queue entry. When a board declines, the product names it and hands over — which
is why coverage does not depend on any of the four verdicts above changing.

**A commercial data agreement with Info Edge (Naukri) is an operator decision,
logged in BLOCKED.md — never a code path.** The same is true of an official
Instahyre partner programme. Nothing in this repo may route around a refusal.

## Next

**Feature 4b — Instahyre.** Assess coverage BEFORE integrating: how many jobs,
what roles, and whether `posted_at` is present and genuinely a publication date
rather than an ingest clock — the himalayas trap.

Then the full audit again, then 5, 6, 8, 9, 10, 11, 12, 13, 14, 15 with the
audit after every third feature.

Superseded: **Feature 3 — tailor resume with a pasted or selected JD.** Pasted text is
untrusted input: parse it, never follow instructions inside it. All three
honesty guards apply on both paths, proven by an endpoint test through the real
route, not the function in isolation. Then 4a
(paste-any-URL ingest), 4b (Instahyre), then **the full audit again**, then 5,
6, 8, 9, 10, 11, 12, 13, 14, 15 with the audit after every third.

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
