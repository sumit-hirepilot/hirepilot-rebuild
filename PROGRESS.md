# PROGRESS

## Now

**Both lanes merged to main and deployed. D49 is live with its notice and the
index is re-scored.** `4291a74`.

### Close-out step 1 — done

`lane-a-backend` then `lane-b-frontend`, rebased. One conflict, `HANDOFF.md`,
resolved by keeping **both** lanes' sections since neither edits the other's.

**HANDOFF A → B · 4 shipped in the same deploy as the formula**, which was the
condition. `ScoreChangeNotice` states what changed, why, and that nothing about
the user's profile or applications moved.

**Re-score on production, complete:**

| | |
|---|---|
| rows | **2,999**, all updated, `remaining: 0` |
| moved up | **1,252** |
| moved down | **399** |
| unchanged (< 0.0001) | 1,348 |
| mean delta | **+0.036** (weighted across both passes) |

More scores moved *down* than the sample predicted — 399 of them. That is real
and expected: a user whose skills are broad relative to what postings ask for
scored well under the old denominator and less well under one that measures
coverage of the posting.

Load at steady state: **200 concurrent 600/600, p95 2,656 ms**, zero failures.

The new build gate earned its place immediately — it rejected the notice's
first cut for `toLocaleString()` with no locale (A3/H3: host locale differs
between server and browser, hydration fails). Jest would not have caught it.

Suites: backend **422**, frontend **264**.

### Close-out step 2 — BLOCKED, and not worked around

The admin token in the order is the literal placeholder `PASTE_TOKEN_HERE`.
Verified rather than assumed: `POST /api/apply/admin/halt` returns **403
Forbidden**, and the halt reads `{"halted":true}`.

Proving Auto Apply end to end requires lifting that halt, and the halt is a
safety control — the standing rule is never to add a second door into one. So
this is stopped at the token, not routed around.

**Everything else in step 2 is unblocked and not yet started**: the 5/day cap,
the kill switch, the tier gate, Lever/Ashby staying disabled, and
applied-requires-a-submission-record can all be exercised without lifting the
halt, because each of them *refuses* rather than submits.

### Close-out steps 3 and 4 — not started

Features 6, 8, 9, 10, 11, 12, 13, 14, 15 and the final audit are untouched.
Stated plainly rather than partially attempted: nothing is in flight.

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
