# PROGRESS

## Now

**D46 and feature 3 are both done, deployed and verified.** `e6bd0a4`,
`5f10baa`, `f53c180`.

### D46 — resize proves CSS, not mobile rendering

Recorded in the master prompt and DECISIONS.md. The sweep found a second
instance of the same blindness, worse than the first: **nothing in the frontend
detected a phone at all**, so Chrome for Android and every iOS browser were
offered "Download Extension" and walked through installing it. Neither can.

`lib/extensionCapable.js` decides from what a device reports and errs toward
**capable**. It relabels rather than hides — dropping the button would remove
the only place the desktop-only requirement is stated.

Verified on production against real signals, not a width: emulated Pixel 8
(`mobile: true`, 5 touch points) gets "Applying needs a desktop" and a
"Desktop only" modal with no install steps; desktop Mac (`mobile: false`, 0
touch points) is unchanged. Viewport tag confirmed in the **served HTML** of
five pages.

### Feature 3 — tailor from a pasted JD

`POST /api/resume/tailor` takes `jobId` **or** `jobText`. Both converge before
anything is generated, so there is one guarded pipeline rather than two.

The paste is untrusted: bounded at 20k, control/zero-width/bidi characters
stripped, `instructionLike` recorded but **never acted on**. The defence is
architectural and stated as such — the engine is templated, so there is no
model to instruct.

All three honesty guards, on both paths, proven through the real route:
untraceable_claim, invented_number, and **no removal — now a runtime guard**
(`findRemovedLines`, 422) rather than a promise resting on a test.

Three things caught before or just after shipping, each by a standing rule:

| | |
|---|---|
| `tailored_resumes.job_id` was **NOT NULL** — the paste path was a guaranteed 500 | read the constraint before shipping the write |
| **my own guard-3 tests were vacuous** — they passed while the guard never ran, because with no surviving skill the engine returns the input unchanged | mutated the engine to drop a line and watched them stay green |
| the pasted row was written, accepted by the new CHECK, returned 201 — and **hidden**, because `GET /tailored` inner-joined `jobs` | read the row back from production instead of trusting the 201 |

Verified on production: hostile paste → 201 with none of Kubernetes, "15
years", "team of 40" or "resume writer" in the output, and Kubernetes surfaced
as a question. Too-short → 400. Both inputs → 400. `tailored_resumes_source_ck`
present in `db-health`, read back from the running database.

Load: **200 concurrent 600/600, p95 2,488 ms vs 2,631 ms. No regression.**

Suites: backend **348**, frontend **255**.

## Next

**Feature 3 — tailor resume with a pasted or selected JD.** Pasted text is
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
