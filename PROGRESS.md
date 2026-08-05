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

Wave A CLOSED (A1-A6 + A3-a/b/c). A7.2, A7.3, A7.4 CLOSED.
Suites: frontend 63, backend 55. Guard audit 34/34. CI floors match.
A7.11 FILED, not built (see DECISIONS D17).

## Just closed — A7.4 [shipped + VERIFIED 2026-08-05]

`default: return row.event_type` put raw keys on screen; SIX types reached it,
including `application_queued` which A1 introduced and never mapped - a defect
added by a fix. Lines also named the role but not the employer.

One `where()` helper is now the only place a job is named (reads row OR
metadata, since background events often carry only metadata). The default
branch returns a sentence. `activityVocabulary.test.js` scans routes/ and
services/ for activity_log inserts and binds the formatter to the events the
backend ACTUALLY writes.

Verified: 6 tests, 3 assertions proven red, CI green.

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

