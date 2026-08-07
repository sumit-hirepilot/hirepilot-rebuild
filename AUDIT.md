# Full feature audit — round 2, before feature 5

Run on production as a signed-in user at 1440 / 768 / 375, plus an **emulated
phone reporting real device signals** (`userAgentData.mobile: true`,
`maxTouchPoints: 5`, Android UA) — because resize proves CSS, not mobile
rendering (D46).

**Four defects. All four fixed and verified on production.** One suspected
defect was disproved and is recorded as such.

## Pass / fail

| Surface | Result |
|---|---|
| **Add a job by link (4a) — the whole frontend** | **FAIL — D1** |
| **Refusal handoff → paste box** | **FAIL — D2** |
| **Tailor from a pasted JD — the result** | **FAIL — D3** |
| **Header at 375** | **FAIL — D5** |
| Landing numbers vs `/api/jobs/stats` | PASS — jobs 25,429, sources 12, directCompanies 153, all match |
| Facet sums vs feed total | PASS — workArrangement, jobType, region each sum to exactly 25,429 |
| jobType vocabulary | PASS — closed, `leaked: []` |
| Experience facet vs filter | PASS — all four bands match exactly; `experienceOverlapping: true` |
| Scoring arithmetic | PASS — headline % = Σ contributions, per-component score×weight exact, weights = 1.0, descending |
| Credits pill vs `/api/plans/credits` | PASS — Copilot, 4500/4500 |
| Plan names | PASS — Free / Pilot / Copilot on both sides |
| Refusal reasons (Naukri, Instahyre, LinkedIn) | PASS — each specific, board named, `canPaste: true` |
| Hostile paste through the real route | PASS — Kubernetes / 15 years / "resume writer" all absent; Kubernetes surfaced as a question |
| SSRF (metadata, loopback, `file://`) | PASS — refused on production |
| Dashboard, Applications, Ready to send, Tracker, Inbox, Network, How it is going, Saved searches, Profile, Settings | PASS — correct headings, 0 overflow, 0 errors, 0 raw tokens |
| Landing, Pricing, Privacy, Terms, Refund policy, Login, Signup | PASS — 200, viewport present, correct h1 |
| 768 | PASS — 0 overflow on every page checked |
| 375 + real device signals | PASS after D5 — 0 overflow, 0 controls under 28px, CTA reads "Desktop only" |

## The four defects

**D1 — feature 4a's frontend never deployed, and the gate could not see it.**
"Add a job by link" was absent from `/jobs`. The component was in the repo and
mounted; it was in **no served chunk**. `next build` was failing on an ESLint
error (`<a>` for internal navigation), Railway kept serving the last good
build, and the backend deployed fine — so `/api/jobs/from-url` worked, which is
exactly what I had verified when shipping 4a. I tested the API and never opened
the page.

The worse half is the class: **the ship gate ran ten stages of tests and a push
that could not build passed every one.** Jest does not build. `next build` is
now stage 9 of 11.

**D2 — the refusal handoff pointed correctly and landed on the wrong tab.**
`/resume?tab=Tailor%20for%20a%20Job` was right; `/resume` never honoured
`?tab=`. The click opened Resume Manager with no paste box — so the one path
that always works when a board declines was unreachable from the place that
offers it. Found by **clicking** it, not by reading the href.

**D3 — tailoring succeeded and the screen threw the result away.**
Paste a JD, press Tailor resume: 201, row written — then the mode reset to
"Pick a job we have" and nothing was shown. `reload()` called `loadData`, which
set `loading=true`, which swaps the tab body for a spinner, which unmounted the
component and destroyed the result stored one line earlier. It hit **both**
tailoring paths and predates feature 3.

**D5 — the desktop-only label overflowed the header and clipped the credits.**
At 375 the header was 530px inside a 375px viewport and "4500 left" was cut to
"45". **Page-level overflow read 0 the whole time** — the header clips
internally rather than scrolling the page — so the measurement I had been
trusting could not see it. The screenshot could. Introduced by D46's relabel.

## Disproved

**The dashboard greeting showed an email prefix instead of a name.** It did —
because *I* had injected a session shaped like `/api/auth/me` (`full_name`)
rather than like `/api/auth/login` (`fullName`). With a login-shaped user the
greeting reads "Good afternoon, Asha". My artifact, not a defect.

Worth recording anyway: `/api/auth/login` returns `fullName` and
`/api/auth/me` returns `full_name` — two endpoints describing one field two
ways. No user-visible defect today; it is the shape that produces one later.

## What this round says about instruments

Each defect needed a different instrument, and each was invisible to the others:

| defect | what found it | what could not |
|---|---|---|
| D1 | grepping the served bundle | tests, the gate, the API |
| D2 | clicking the link | the href, which was correct |
| D3 | pressing the button | the endpoint, which returned 201 |
| D5 | a screenshot | `scrollWidth - clientWidth`, which read 0 |

Two of my own assertions were wrong and were caught by proving red: one bounded
by `[^}]*` that stopped inside `{ quiet: true }` and failed identically before
and after the fix, and one reading `textContent` where CSS `display:none` meant
the text was never visible.


---

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
