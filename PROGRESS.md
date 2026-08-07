# PROGRESS

## Now

**D45 — a test asserts behaviour, never the claim that describes it.** New
standing rule, recorded in the master prompt and DECISIONS.md, and swept.
`944cd3d`.

The rule came from the audit: `landingTruth` required the pricing page to say
"never per application" while `submissionGate` refuses to submit at
`remaining <= 0`. Green throughout, defending a sentence the product
contradicts — the correction would have read as a regression.

The sweep found three more of the same shape, and each had a real defect under
it:

| Claim the test pinned | What was actually true | Fix |
|---|---|---|
| "Cancel in one click", routed to Settings → Plans → Cancel | no Cancel control, no cancel path anywhere | **built the control** — cancelling is returning to Free, which `/api/plans/select` already did |
| "Runs in your mobile browser — the whole product" | `<meta name="viewport">` was on the landing page **only**; every other page laid out at the ~980px fallback on a real phone | moved to `_app.js` |
| "Nothing reached the employer" on a failed application | `apply.js` sets `failed` only where it *could not verify* — the form may have gone through | "Not confirmed", with an honest hint |

The mobile one is the sharpest: the 375px audit pass could not see it, because
resizing sets a true viewport width so the media queries ran and every page
looked correct. Only a real mobile browser reads that tag. The instrument could
not see the defect it was pointed at.

The "nothing reached the employer" wording was also a duplicate-application
risk: it told people to retry something that may already have been submitted.

`tools/check-claim-tests.js` sweeps for the shape; REVIEWED records each judged
block **with its reason**. Its first cut counted "calls something with a string"
as grounding, which matched the `read('pages', ...)` call that fetches the copy
— so every claim test grounded itself and it reported **green on both defects it
was written from**. Caught only by proving it on a known positive, the same way
the guard-wiring census went wrong twice.

Verified on production: viewport present on all six pages checked, Cancel
control renders at 44px and **was clicked** — Copilot → Free, 600 credits,
"No payment was taken" — then the tier restored.

Load test at uptime 352s: **200 concurrent 600/600, p95 2,669 ms vs 2,767 ms.
No regression, zero failures.** Peak RSS 338 MB.

Suites: backend **327**, frontend **245**.

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
