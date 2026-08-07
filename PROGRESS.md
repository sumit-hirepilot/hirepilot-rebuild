# PROGRESS

## Now

**D45 (new standing rule) and feature 2 are both done, deployed and verified.**
`944cd3d`, `5e585df`, `f38df2b`, `d78718a`.

### D45 — a test asserts behaviour, never the claim that describes it

Recorded in the master prompt and DECISIONS.md, and swept. `landingTruth`
required the pricing page to say "never per application" while
`submissionGate` refuses to submit at `remaining <= 0` — green throughout,
defending a sentence the product contradicts.

The sweep found three more of the shape, each with a real defect under it:

| Claim the test pinned | What was actually true | Fix |
|---|---|---|
| "Cancel in one click", routed to Settings → Plans → Cancel | no Cancel control, no cancel path anywhere | **built the control**; clicked on production, Copilot → Free → restored |
| "Runs in your mobile browser — the whole product" | viewport meta was on the landing page **only**; every other page laid out at ~980px on a phone | moved to `_app.js`; verified on 6 pages |
| "Nothing reached the employer" | `apply.js` sets `failed` only where it could not *verify* — a duplicate-application risk | "Not confirmed", honest hint |

`tools/check-claim-tests.js` sweeps for the shape. Its first cut counted the
`read('pages', ...)` call itself as grounding, so every claim test grounded
itself and it reported **green on both defects it was written from**.

### Feature 2 — plain language

Jargon replaced on live surfaces: Jobs Indexed → Jobs we track; Every indexed
job → Every job we have; Unranked → Not scored; synced every 6h → updated every
6 hours; Copy access token → Copy pairing code; Applications Tracked →
Applications you have sent; Interview Pipeline → Interviews.

**ATS is kept** — it is the phrase Indian job seekers search for — but never
stands alone; both sites carry a plain gloss now.

`tools/check-plain-language.js` gates it. Two bugs found while proving it on
known positives: the JSX heuristic spanned code and reported `filter(Boolean)`
as the word "boolean", and the gloss rule was a regex **literal** containing
`${term}`, which never interpolates — it had been inert.

### Both carried audit findings, closed

**The experience facet and the filter disagreed** — facet said 9,709 of 25,431,
filtering by "Mid level" returned 16,129. Cause: **three** copies of one
definition (filter, facet, and `classifyExperience` labelling each card). All
three now derive from `EXPERIENCE_TERMS`. Verified on production: all four
bands match exactly, and the facet reports `experienceOverlapping: true`
because the bands match on the title and do not sum to the index.

Correcting my own audit note: the UI never displayed those counts — experience
is a plain select — so no user saw "38%". The defect was the missing `mid`
bucket.

**Tap targets.** Measured 13–19px at 375; now 44px minimum, verified on
production: `stillUnder28: []` on both `/jobs` and `/dashboard`, all 21
checkboxes at a 44px effective hit height, zero overflow. Took two passes — the
first rule was too narrow, and the checkbox needed a padded label because a
44px checkbox looks broken.

Load test: **200 concurrent 600/600, p95 3,025 / 2,538 ms vs 2,669 ms. No
regression. 1,000 concurrent completed with zero failures for the first time.**
The first pass read 11,931 ms at 200 — slower than 500 — and was re-measured
per the contamination rule rather than reported.

Suites: backend **332**, frontend **245**.

## Next

**Feature 3 — tailor resume with a pasted or selected JD.** Then 4a
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
