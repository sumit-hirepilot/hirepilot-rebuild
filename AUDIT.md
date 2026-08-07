# Full feature audit — production, before feature 2

Run against `hirepilot-rebuild-production` and `hirepilot-production-e70d` as a
signed-in user, at 1440 / 768 / 375. The brief was the defect class feature 1
surfaced: **the label disagreeing with the data** — three instances that
session, all found by looking, none by a test, every suite green throughout.

Four defects found. All four fixed, verified on production, and each given a
check that fails the ship gate. Commits `f3e4b74`, `f71f566`.

## Pass / fail

| Surface | Result | Evidence |
|---|---|---|
| Landing page | **FAIL — D1** | named a guard rule that no longer exists |
| Pricing | **FAIL — D2, D3** | plan vocabulary and metering both contradicted the code |
| Jobs feed — employment type chip | **FAIL — D4** | raw source tokens published as categories |
| Landing page — live numbers | PASS | jobs 25,232 / sources 12 / directCompanies 153 all match `/api/jobs/stats` |
| Jobs feed — scoring | PASS | every headline % equals the sum of its four weighted contributions |
| Jobs feed — sort | PASS | "best match, ties broken by newest" holds; undated last |
| Jobs feed — result count | PASS | "25,232 results" matches `/api/jobs` total |
| Credits pill | PASS | 4500 matches `/api/plans/credits`; spent only on confirmation |
| Facet counts | PASS | jobType, workArrangement, region each sum to exactly the feed total |
| Dashboard, Applications, Apply queue, Tracker, Resume, Inbox, Network, Analytics, Settings | PASS | headings, controls, no raw tokens, no overflow |
| Privacy, Terms, Refund policy | PASS | HTTP 200, real content, correct headings |
| Signup, Login | PASS | HTTP 200, correct headings |
| Responsive 375 / 768 | PASS | zero horizontal overflow on every page measured |

## The four defects

**D1 — the landing page named a guard rule that had been removed.**
It listed `no_deletion` among "the checks every proposed edit must pass", under
a heading reading "these **three** checks", when `resumeGuard.js` has two rules
and no `no_deletion` — it was retired earlier as unreachable. The page was
advertising a mechanism the product no longer has, on the section that sells
its honesty. The count is now derived from the array, never typed.

**D2 — the plan a user is on was not a plan the pricing page sells.**
Backend named the tiers Starter / Pro / Power. `/pricing` sold Free / Pilot /
Copilot. No overlap at all. The credits pill told a live account it was "on
Power", a plan the page has never offered, and new signups default to
`plan_tier 'starter'` — also never offered. Display names now match. The
`plan_tier` ids are untouched, so no live row and no gate test moves.

**D3 — the pricing page denied a limit the product enforces.**
It said applications "are not metered on any plan" in four places, while
`routes/plans.js` meters 600 / 1500 / 4500 a month and
`services/submissionGate.js` refuses to submit at `remaining <= 0` — with the
header pill counting it down on every authenticated page.

The allowance stayed. It is the backstop on runaway Auto Apply, and weakening a
safety control to make a sentence true is the wrong direction. The sentences
changed, and the page now states the real allowance per plan. What was
genuinely true and is kept: a credit is spent only on a submission an employer
**confirms**, never on an attempt that stalled or was retried.

**A test was pinning D3 in place.** `landingTruth.test.js` asserted the page
*must* say "never per application". It was green the entire time, defending a
false claim — fixing the page would have read as breaking the suite. This is
worse than an uncovered defect: coverage pointed the wrong way. It now asserts
the honest property.

**D4 — the employment-type chip published raw source vocabulary.**
The facet CASE ended in `ELSE lower(job_type)`, a straight passthrough, so the
category list was whatever any source happened to write. A user opening the
chip was offered `Clt(14)` — Brazil's CLT labour regime, capitalised and shown
to an Indian job seeker as a kind of employment — plus `Hybrid(13)` and
`Remote(2)`, which are workplace arrangements, not employment types. The
Workplace facet beside it has no Hybrid option, so those 13 roles were filed
under the wrong question entirely.

The ELSE is now a closed bucket. Verified on production: 14 categories became
8, `leaked: []`, and the arithmetic reconciles exactly — `clt:14` folded into
full-time (24,430 → 24,444), freelance + fixed-term into contract (647 → 653),
hybrid + remote into unspecified (15), sum still exactly 25,431. No rows lost.

## What the audit says about instruments

Every one of the four was found by reading a live surface against the data
behind it. None was reachable from code alone, and both suites were green
before, during and after. Three of the four are now caught by a gate check:

- `tools/check-landing-claims.js` — quoted identifiers must still exist
- `tools/check-plan-names.js` — one plan vocabulary, and the metering claim
  checked against the **gate**, not against prose
- `backend/__tests__/facetVocabularyIsClosed.test.js` — closed vocabulary

Each was proved red on the real defect, restored exactly as it shipped, before
being trusted green.

### Three false positives, recorded so they are not re-found

- **snake_case token scan.** Flagged four tokens on the landing page; three
  were deliberate — the page prints the real identifier beside plain English,
  which is its whole "no black box" device. Only `no_deletion` was real.
- **`/NaN/` inside a case-insensitive alternation** matched "**nan**" in
  "Black Fi**nan**cial Consult", reporting an error on a clean feed twice. The
  case-sensitive check was right both times.
- **Stale console errors.** `/api/notifications` showed repeated CORS
  preflight failures. Reproduced live: preflight returns 204 with
  `access-control-allow-origin: *`, and the endpoint returns 200 with a real
  body. The log was cumulative from a restart window. Nearly filed as a defect
  from a log instead of a reproduction.

### One wrong inference, disproved before it was reported

The facet counts summed to 25,431 against a feed total of 25,232 — apparently
199 rows that do not exist. They were read minutes apart, across an ingest.
Re-read together, both are 25,431 and reconcile exactly. Comparing two numbers
taken at different times is not a discrepancy.

## Not fixed here

- Tap targets under 28 px at 375: checkboxes (13–16 px) and the "Original
  posting" link (19 px). Usability, not correctness; not a label-vs-data fail.
- The `experience` facet covers 9,709 of 25,431 jobs (38%). It is inferred only
  where detectable and does not claim otherwise, but the coverage is worth
  stating on the surface rather than leaving to be discovered.
