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

### Close-out step 2 — the refusing half is PROVEN; the submitting half is blocked

**Blocked, and not worked around.** The admin token supplied is **expired** —
`exp 2026-08-06T20:05:31Z`, now 2026-08-07T14:56Z. Diagnosed two ways rather
than assumed: it returns **401 "Invalid or expired token"** on `/api/auth/me`
while the walkthrough token returns 200 on the same endpoint, so the JWT is
rejected before any admin check and `/admin/halt` 403s because `req.user` is
never populated.

Three routes to a credential were tried and all are closed to me:

| route | result |
|---|---|
| Railway CLI | logged in as `sumituxi@gmail.com`; sees only `hirepilot-site` and `regintel-ai` |
| Railway dashboard in the browser | logged out, showing the login page |
| App login as `sumituxui@gmail.com` | needs a password |

The halt is a safety control and the standing rule is never to add a second
door into one, so this stops here rather than routing around it.

**What was proven without lifting it** — every one of these REFUSES rather than
submits, so none needs the halt down. All observed on production:

| control | evidence |
|---|---|
| kill switch halts a start | `POST /queue/:id/start` → **429** `{"reason":"halted"}` |
| the flag reads as set | `GET /admin/halt` → `{"halted":true}` |
| Lever not cleared to submit | queued a live Lever job → `automationSupported: false` |
| Ashby not cleared to submit | queued a live Ashby job → `automationSupported: false` |
| Greenhouse is the only cleared adapter | queued a live Greenhouse job → `automationSupported: true` |
| tier gate | Free → `autoApplyIncluded: false`; Copilot → `true` |
| applied requires a submission record | `/apply/submitted` → 0 rows, and nothing reached `applied` |

Verified through the live queue endpoint, not by reading `SUPPORTED_ATS` — the
constraint is about what the apply path will *drive*, and Lever/Ashby jobs are
still ingested from their public APIs, which is a different thing and allowed.

**Walkthrough account restored**: tier back to Copilot, and the three queue
rows the test created (162–164) skipped. Queue is empty, 0 submitted.

**Still blocked on a working credential**: the live submission proof itself —
candidate selection → tailoring with the three guards → queue → submit →
confirmation captured → receipt → tracker, with a screenshot per stage. Also
the 5/day cap refusing a sixth, which needs five real submissions first.

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
