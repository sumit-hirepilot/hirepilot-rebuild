# PROGRESS

## Now

**Feature 4a is done, deployed and verified.** `e6d1cb7`, `defbee8`.

### Paste any job link, from any board

Crawling boards is a ToS question this product will not answer, so the user
brings the link: one person, one URL, one page they are already looking at.

| Board | How it is read |
|---|---|
| Greenhouse, Lever, Ashby | their **own public posting APIs** — no HTML, no scraping, no ToS question |
| LinkedIn, Naukri, Instahyre, Indeed, Wellfound | one plain request; a refusal is an **answer** |
| anything else | JSON-LD `JobPosting`, then Open Graph, labelled weak |

**Why it works on every board honestly:** not because every board can be
fetched — several cannot — but because when one declines, the product names it,
says why, and opens the paste box, which produces the identical result. D19's
line does not move because a different board is behind it.

Verified on production: Greenhouse → 201 with the real posting URL; Naukri →
422 `blocked_by_site`, board named, `canPaste: true`, and the full sentence.

**SSRF was the real risk.** A URL from a request tells this server to open a
socket to an address the user picked; on Railway `169.254.169.254` hands out
the platform's credentials. Refused by ADDRESS after DNS, re-checked on every
redirect, decimal and IPv4-mapped spellings covered. All three refused on
production.

**A linked job is not in anyone else's index** — written `is_active=false`, so
all 16 shared queries exclude it with no change to the hot path, while by-id
lookups still reach it for scoring and queueing. A link to a job already in the
index matches that row instead of duplicating it.

### Five things caught by the standing rules, not by luck

| | |
|---|---|
| the route called a `calculateMatchForJob` that does not exist, behind a `typeof` guard — scoring would have stayed null and looked deliberate | read the module's exports instead of trusting the name I wrote |
| the SSRF tests **mocked the thing the refusal lives in**, so they proved nothing | defaulted the mock to the real implementation |
| `/false, $9\|is_active/` matched the COLUMN LIST — passed with the row written active | proved red; tightened to the VALUES clause |
| `not.toContain('…T00:00:00Z')` passed against `…T00:00:00.000Z` | proved red; made position- and format-independent |
| **`job_url` stored the API endpoint**, so "Original posting" pointed at raw JSON and a job already indexed made a second row | fetched a real Adyen posting on production and read the row back |

The guard census then flagged `fetchWithGuards` and `refusal` as unwired. It
was right — it counts only cross-file callers. Both are unexported now and the
redirect test drives them through `fetchJobUrl`, the entry the route calls.

### Carry closed — the bounds sweep is no longer a known-red

All **18** unbounded params are bounded: 12 in `jobs.js` (including the inline
paging clamp, replaced by `boundPaging` after verifying identical semantics), 2
in `apply.js`, 3 in `inbox.js`. `check-query-bounds.js` is now **stage 4 of the
ship gate**, so it cannot drift red again.

Load: **200 concurrent 600/600, p95 2,777 ms vs 2,488 ms** — +12%, inside the
bar, zero failures. The feed's params were rebound in this change, so that is
the price of the sweep rather than noise.

Suites: backend **381**, frontend **255**.

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
