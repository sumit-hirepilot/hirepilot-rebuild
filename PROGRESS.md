# HirePilot — Progress

## STANDING ORDER — permanent, overrides anything that says otherwise

A fresh session reads this file and continues WITHOUT being re-briefed.

No questions. No reports. No progress summaries. No check-ins. No approval
requests. Full authority to decide anything that comes up. When something is
ambiguous, choose the reading that creates no legal or data risk, write one
line in DECISIONS.md, keep going. Never surface it.

**Not finished until every queue item is closed, green and live.**

QUEUE, in order, no pausing between items:
A3-c, A4, A5, A6, A7.2-A7.6, A7.8-A7.10, then B1-B5.
(A3-c partially done, A4/A5/A6 CLOSED — see status below.)

- **B1 Engineering** — every route and endpoint end to end. Auth, error paths,
  empty and loading states, rate limits, N+1 queries, unhandled rejections,
  secrets in client bundles, anything that 500s.
- **B2 Functional correctness** — click every control on every screen, assert
  the state change AND the network call. Auto-apply, tracker, search agents,
  resume tailoring, exports, settings. A control that renders but does nothing
  has already reached production twice.
- **B3 UI/UX** — every page at 375 / 768 / 1440. Overflow, contrast, focus
  order, tap targets, empty and error states, skeletons, keyboard traps.
  Measure the property that carries the value.
- **B4 Product coherence** — does the app deliver what the site promises? Five
  tracker stages including ghosted, India-first coverage, rejection
  intelligence, live stats from the real API. Any promise the product does not
  keep is either built or removed from the site.
- **B5 Marketing site rebuild** per the design brief in the repo: light mode,
  instrumentation metaphor, palette derived from the five tracker stages, live
  product surfaces rendered in HTML not screenshots, decay-bar signature
  element, live-stats block fixed. Static HTML, no framework, Railway deploy
  preserved.

SELF-DIRECTION: question yourself, answer yourself, proceed. After each goal
pick the next from the queue and start it in the same breath. When the queue
empties, audit your own work against DONE, generate any goals still needed, and
work those. **An empty queue is not done. DONE is done.**

STANDING RULES, always: prove red before trusting green; presence is not
function, click it; a visual change needs a visual check on the property that
carries the value; exit 0 is not evidence of work; containment is not
existence; fix the class not the instance, the guard is the deliverable;
nothing is done until verified locally AND on production.

CONTEXT HANDOFF: context will run out before the queue does. That is the only
thing that may stop you and it is not a reason to ask anything. After every
goal rewrite this file to hold: the goal just closed and how it was verified,
the next goal fully specified and executable cold, and anything required to
continue without re-deriving. When context runs low, stop at a goal boundary
with this file current and nothing in flight.

DONE = every queue item closed; full suite green in CI; build green with lint
enforced; every page verified locally and on production at 375/768/1440 with
zero console errors; no BLOCKED.md entry without an owning goal; app and
marketing site both live and functional.

---

## Status

Wave A CLOSED. A7.2, A7.3, A7.4, A7.12 CLOSED. A7.15 DIAGNOSED (no fix).
A7.11 FILED (D17). C1a/C1b FILED into Wave C.
Suites: frontend 63, backend 64. Guard audit 37/37. CI green.

## A7.15 — FINDING (diagnosis complete, no fix applied)

**posted_at is NOT ingest time. The foundation is sound.**
`posted_equals_ingest` is near-zero on every source: 26/9,972 greenhouse,
9/4,542 ashby, 15/3,153 nofluffjobs, 0 on jobindex/jobicy/lever/remoteok/
workingnomads/landingjobs/remotive. Those are genuine coincidences. **A7.13,
A7.11 and D4 are NOT built on sand.**

**The poller is healthy:** ~1,873 rows added in 24h.

**The real cause of "9 jobs in 24 hours":**
```
24h ranked (signed-in default)  →   9
24h unranked (whole index)      → 616    (excludedUnknownDate 4,685 = himalayas)
7d → 42 ranked   |   30d → 149 ranked
```
The index genuinely holds 616 jobs posted in 24h. The user sees 9 because the
time filter runs INSIDE the personalised set - `job_matches` is capped at
`MATCH_STORE_LIMIT = 500`. There is no freshness problem. There is a scoping
problem. This also fully explains A7.13: `figma + 24h` was 11 keyword hits
intersected with a 500-row window.

## A7.17 — CLOSED, one ranking path. Verified local + production.

Six ranking implementations existed; three inside GET /api/jobs alone. Collapsed
the three to one query. The other three (matches.js dashboard, agents.js,
apply.js) serve different questions and now share the same shape - filed as the
remaining half of A7.17 only if they drift; they are not duplicate feeds.

The defect underneath: the ranked branch INNER JOINed job_matches, so the
universe was MATCH_STORE_LIMIT (500) BEFORE any filter ran. "Past 24 hours"
meant "of your top 500 matches, which are recent". Now a LEFT JOIN - score is a
SORT KEY, not a membership test - so an unscored row ranks last instead of
being deleted.

MEASURED ON PRODUCTION, before -> after:
  24h ranked            9 -> 617     (acceptance: same order of magnitude as unranked)
  24h unranked        616 -> 617     (the two now agree; they are one query)
  figma + minScore=0.9  11 -> 7      (the floor was reported null and did nothing on
                                      the keyword path; it now applies on every path)
  total across pages   60/120 -> 24808/24808  (see below)
  Jobs page, 375/768/1440: no console errors, no horizontal overflow, 617 at all three.
  "Past 24 hours" + "Best match" now returns 67%, 63%, 63%, 59%... descending,
  ties by newest. Before: 9 rows.

TWO THINGS THE MEASUREMENT FOUND THAT THE TESTS DID NOT:

1. My own regression. Moving the COUNT inside the CTE put it inside the
   per-source diversity cap, which scales with the page - so total read 60 on
   page 1 and 120 on page 2. The cap is a per-page presentation device and
   every capped row is reachable by paging, so the count now runs uncapped and
   only the page query caps. Guarded twice: the count SQL must not contain
   `source_rank <=` while the page SQL must, and `page` must not be able to
   reach the count query at all.

2. A state that could not exist before. Because a date filter used to run
   inside the 500-row store, every row it could return was already scored.
   Searching the whole index surfaces jobs newer than the last scoring run:
   "Past 24 hours" is now 617 rows with 11 of 20 unscored on page 1. The card
   already omits the ring rather than printing a fabricated 0%, so no
   Constraint 1 breach - but a page of scoreless cards with no explanation
   reads as a bug. The API reports unscoredInPage and the page now says so.
   Verified against the DOM: 9 rings + 11 unscored = the 20 it claims.

83 backend tests (floor 64 -> 83), 41/41 guards proven red. Three A7.1/A7.7
assertions rewrote from SQL literals to properties - same lesson as A7.12: an
assertion pinned to a literal blocks the refactor instead of protecting the
behaviour.

Note for whoever picks this up: the LEFT JOIN property was UNGUARDED when the
collapse first went green. Reverting it to INNER left every test passing. That
is the exact shape of the thing this project keeps finding - the load-bearing
property is the one nobody wrote a test for, because it was never a decision,
it was just how the code happened to be.

## SUPERSEDED — the A7.17 plan, kept for the reasoning
## Next goal — A7.17, ONE ranking path (executable cold)

Supersedes A7.13's fix, A7.16, and the tiering-branch defect.

**Principle: filters apply to the INDEX; ranking applies to the FILTERED
result. The 500-row match store is a fast path for the UNFILTERED feed only,
never the universe a filter runs inside.**

### The six ranking implementations that exist today (counted, not estimated)

| # | Location | ORDER BY | Used by |
|---|---|---|---|
| 1 | `jobs.js:719` | `match_tier ASC, posted_at DESC NULLS LAST, id DESC` | keyword / scope / datePosted (the tiering branch) |
| 2 | `jobs.js:812` | `${orderBySql}` + per-source cap | ranked feed (signed-in default) |
| 3 | `jobs.js:825` | `posted_at DESC NULLS LAST, id DESC` | unranked browse (`ranked=0`) |
| 4 | `matches.js:111` | `jm.overall_score DESC, j.posted_at DESC NULLS LAST, jm.id DESC` | dashboard |
| 5 | `agents.js:178` | `jm.overall_score DESC NULLS LAST, am.matched_at DESC NULLS LAST, am.id DESC` | search agents |
| 6 | `apply.js:291` | `overall_score DESC` | auto-apply candidate selection |

### The fix

The ranked branch (#2) does `INNER JOIN job_matches`, which caps the universe
at 500 BEFORE filters run. Change to `LEFT JOIN`, so the whole index is the
universe and score is a SORT KEY rather than a membership test:
`ORDER BY overall_score DESC NULLS LAST, posted_at DESC NULLS LAST, id DESC`.
A 24h filter then returns 616, with the ~9 scored rows first and the rest
after - "best match first, then the rest", which is what a user expects.

`minScore` under a LEFT JOIN must be `(overall_score >= $x OR overall_score IS
NULL)`, otherwise the floor silently deletes every unscored row. And per the
goal: **minScore must apply on the keyword path too, or the control is
removed** - today `figma + minScore=0.4` returns the same 11 as `figma` alone
and `ranking.minScore` comes back null. That is the A7.1 dead-control class.

Then collapse #1 into #2 (the tiering branch exists only to handle keyword
relevance - fold `match_tier` in as a sort key), and route #4/#5/#6 through the
same helper.

### Deterministic response shape — pin it FIRST

`ranking` was ABSENT on two `datePosted=24h` probes and PRESENT on a retry with
identical params. That non-determinism nearly caused a misdiagnosis of A7.15.
Write that test before touching the queries: identical params, N calls,
identical response SHAPE every time, `ranking` always present.

### Acceptance
- 24h ranked returns the same order of magnitude as 24h unranked (616, not 9).
  Measure before AND after; the numbers above are the "before".
- minScore applies on every path including keyword search, or the control goes.
- Per-assertion red-green, non-zero count, cases added to
  `frontend/scripts/prove-guards-red.js`.
- Verified locally AND on production.

Then: A7.14, A7.5, A7.6, A7.8-A7.10, then B1-B5.

## Next goal — A7.13, search returns nothing against a live index (cold)

Reported: search "figma" + Past 24 hours + 40% floor returned "No jobs match
these filters" against ~24,800 indexed jobs, with one related job.

- Establish WHICH of the three constraints empties the result: the keyword, the
  24h window, or the 40% score floor. Do not guess - vary one at a time against
  `/api/jobs` and record the counts.
- If it is the filters rather than a broken search, the UI must say WHICH filter
  caused the empty result, not just report zero.

Start from this, do not re-derive:
- A7.11/D17: himalayas supplies NO posted_at for 4,663 rows (19% of the index).
  A 24h window excludes every one of them by construction. Check this first -
  it is the most likely single cause and it is already documented.
- `ranking` in the `/api/jobs` response already reports `{mode, sort, minScore,
  sourceDiversified}` - extend that pattern rather than inventing a new shape.
- The empty state lives in `frontend/pages/jobs.js`; `countText` in
  `lib/renderState.js` already distinguishes loading / failed / real-zero, so a
  "which filter" message belongs alongside it, not as a new component.
- Then A7.14 (We Work Remotely at 0 jobs; the A7.3 unified date string never
  reached the source panel), A7.5, A7.6, A7.8-A7.10, then B1-B5.

## Next goal — A7.5, full CTA and flow sweep (executable cold)

From the master prompt:
- Walk every nav item and button, signed in, desktop AND mobile.
- For each: where it goes, whether the destination matches the label, whether
  the content is consistent with where the user came from.
- Full map to PROGRESS.md. Fix every mismatch.
- Report any CTA that is dead, mislabelled, or lands somewhere unrelated.

Start from this, do not re-derive:
- **Presence is not function - CLICK it.** A7.1's sort control rendered
  perfectly and did nothing because on that page state alone never refetches;
  every DOM assertion passed. That is the defect class this goal hunts.
- Nav lives in `frontend/components/DashboardLayout.js`; the marketing header
  is `frontend/components/Layout.js`.
- 14 `<a href>` internal links were converted to `<Link>` in A3. Any NEW `<a>`
  to an internal route fails lint (`no-html-link-for-pages`), so that class is
  already guarded - do not re-sweep it.
- A7.6 (jobs checkboxes with no bulk action) is a KNOWN dead control; it is its
  own goal, so note it and leave it.
- Verify locally AND on production. Use a fresh browser tab: a reload to the
  same path is not a fresh document, and a retained console buffer reads as a
  live error.
- Then: A7.6, A7.8-A7.10, then B1-B5.

## Next goal — A7.3, dates (executable cold)

- "date unavailable" and "Publication date unavailable" are ONE state with two
  strings. Unify.
- Report what fraction of indexed jobs lack a publication date, PER SOURCE.
  D4 (timing signal) is impossible without it, so this is a wedge blocker.
- "Today's matches" currently includes a 98-day-old posting: either the label
  or the query is wrong. Decide which and fix that one.

Start from this, do not re-derive:
- `GET /api/jobs/field-integrity` (added in A7.2, `backend/routes/jobs.js`) is
  the established pattern for a per-source count from production without local
  DB access. Extend it with a `posted_at IS NULL` breakdown rather than writing
  a new endpoint.
- `jobAggregator.js` deliberately leaves `posted_at` NULL when a source has no
  trustworthy date - it must NOT fall back to "now", which would fabricate
  freshness. Do not "fix" that by defaulting it.
- Sorting already handles NULLs: `posted_at DESC NULLS LAST, id DESC` (A7.7).
  Undated jobs sort last by design.
- `frontend/lib/format.js` owns date formatting with an explicit locale AND
  time zone. Any new date string goes through it or the H3 lint fires.
- Then: A7.4 activity feed copy, A7.5 CTA sweep, A7.6 jobs checkboxes,
  A7.8-A7.10, then B1-B5.

## Next goal — A7.2, no parse failure reaches the UI (executable cold)

- A job row rendered company as literally "name". Any row whose company, title
  or location failed to parse is repaired or withheld, never rendered with the
  placeholder visible. Constraint 1.
- Audit how many indexed jobs carry unparsed fields; report the count.
- **A2c covered the RENDER side; this covers INGESTION.** Users currently see
  "Company not stated"; the DATABASE row is still wrong.

Start from this, do not re-derive:
- `frontend/lib/renderState.js` exports `isParsed`/`parsedOr` and owns the
  `NOT_PARSED` placeholder list. Reuse it server-side rather than writing a
  second list that can drift.
- Unknown, needs a real query: which source wrote `company_name = 'name'`, how
  many rows, whether title/location are affected too.
  `GET /api/applications/integrity` is the established pattern for reporting a
  count from production without local DB access - extend it or add a sibling.
- Ingestion lives in `backend/services/apis/`; poller runs every 6 hours.
- Do NOT delete rows. Additive/corrective only, and any corrective migration
  writes an audit row BEFORE it mutates.
- After A7.2: A7.3 dates, A7.4 activity feed copy, A7.5 CTA sweep, A7.6 jobs
  checkboxes, then A7.8-A7.10, then B1-B5.

## Next goal — A7.2, no parse failure reaches the UI (executable cold)

From the master prompt:
- A job row rendered company as literally "name". Any row whose company, title
  or location failed to parse is repaired or withheld, never rendered with the
  placeholder visible. Constraint 1.
- Audit how many indexed jobs carry unparsed fields; report the count.
- **A2c covered the RENDER side; this covers INGESTION.**

**Start from this, do not re-derive it:**
- `frontend/lib/renderState.js` exports `isParsed` / `parsedOr`. Render sites in
  `jobs.js` and `auto-apply.js` already route through it, so users currently see
  "Company not stated" rather than "name". The DATABASE row is still wrong.
- The placeholder list lives in `renderState.js` as `NOT_PARSED` - reuse it
  server-side rather than writing a second list that can drift.
- Unknown and needing a real query: which source wrote `company_name = 'name'`,
  how many rows are affected, and whether title/location are affected too.
  `GET /api/applications/integrity` is the established pattern for reporting a
  count from production without local DB access - extend it or add a sibling.
- Ingestion lives in `backend/services/apis/`; the poller runs every 6 hours.
- Do NOT delete rows. Additive/corrective only, and per the standing rule any
  corrective migration writes an audit row BEFORE it mutates.

## Next goal — A6, Hardcoded figure sweep (executable cold)

From the master prompt:
- Every user-facing surface: counts, percentages, `+`/`k`/`M` suffixes, time
  claims, status colours.
- Each hit becomes a real query or is deleted.
- **Read every matched line** - a grep hit is not a finding. This project has
  produced false positives from font metadata, minified bundles, build output,
  and its own comments describing a bug.

**Start from this, do not re-derive it:**
- `frontend/__tests__/landingHonesty.test.js` already guards the landing page
  against `+`/`k` suffixed counts, display percentages, and mock constants. It
  is proven red. A6 extends that discipline to every OTHER surface.
- `frontend/__tests__/noFabricatedZero.test.js` guards counts repo-wide
  (useState(0), `|| 0` coercion, literal 0 writes needing a `real-zero:` note).
- `frontend/lib/renderState.js` is the primitive: `countText`, `parsedOr`,
  `stateOf`. Anything showing a number should route through it.
- Precedent: "180+" shipped gated on a boolean while the truth was 153 - an 18%
  overstatement. Assume more exist.
- Status colours are in scope: A3 found every coverage dot rendering the same
  colour claim and Lever/Ashby green while disabled.

