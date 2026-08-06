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

## A7.4 — CLOSED for generated text. One data correction still open (specified below).

REPRODUCED FIRST, and the filed symptom did not hold where it was filed. The
activity feed already reads as English and names the company:
"Auto-Pilot applied to UX Designer Senior at Valtech", "Submitted Platform
Designer at Scaleai - waiting on the employer's confirmation". That surface was
closed in an earlier pass. So the goal became: where DO keys reach users?

FOUND AND FIXED, as rules rather than call sites:

1. The inbox rendered {m.category} straight from the row - no map at all.
2. Five sites used `SOME_LABELS[key] || key`. That reads as a safe fallback and
   is the opposite: the day the server adds a status, source or category, the
   raw token renders and nothing fails.

   labelFor(key, map) replaces both. Explicit labels still win ("hackernews"
   must not become "Hackernews"); anything unmapped is humanised, so a new key
   reads "Phone screen" rather than "phone_screen". It uses hasOwnProperty, not
   truthiness, so a label deliberately set to "" means show nothing instead of
   printing the token.

   Guarded over the whole pages+components trees: no LABELS[k] || k anywhere,
   and no category/stage interpolated into rendered text.

3. THE ONE THAT MATTERED MOST. The applications page read:
   Your saved answer to "are_you_hispanic_latino" is not one of this form's
   options - an internal profile key quoted back at the user, beside a
   demographic question, which is the worst place in the product for it.

   First attempt preferred conceptLabel. Production showed the same token,
   because the stored concept labels ARE those keys - it printed the same thing
   by a different route, and only checking the rendered page caught it.

   Naming the question was the wrong idea. What the user needs in order to act
   is the ANSWER that did not fit, so they can pick the option matching it -
   which the sibling branch already said. Both messages now agree, and the
   guard asserts ONE message shape for one situation.

   Verified on production: /api/apply/queue and /api/applications no longer
   generate any reason containing a key.

STILL OPEN — the stored copies. PATCH /api/apply/queue/:id/questions runs
prefillAnswers and PERSISTS each reason into applications.screening_answers
(backend/routes/apply.js:760). The page renders text frozen at the time the
extension last scanned that form, so rows written before this fix still show
"are_you_hispanic_latino" on screen. Same shape as A7.2's legacy rows, one
table over. The generator is correct and live; the data is not corrected.

124 backend / 108 frontend, 79/79 guards proven red.

### Next goal — A7.4b, correct the stored screening reasons (executable cold)

- The text lives in applications.screening_answers (JSONB), one `reason` per
  question object, written by PATCH /api/apply/queue/:id/questions.
- Reproduce first: load /applications on production and confirm the raw keys
  are still on screen while /api/apply/queue returns none.
- Prefer RECOMPUTING over string surgery: the row still carries the question
  and the saved answer, so the reason can be regenerated from the same
  prefillAnswers path rather than pattern-matching old sentences. String
  surgery on user data is the fragile option and it cannot be verified.
- Whatever the route, record it in data_corrections BEFORE applying, with ids
  and old values - and CHECK IT APPLIED. A7.2's correction reported 399 rows
  corrected while changing none, because company_name was NOT NULL and
  runMigrations swallowed the constraint violation. Read the result back
  through an endpoint, not the boot log.
- Do not touch the `answer` fields. Only `reason` is wrong; the answers are
  the user's own data and a demographic answer must never be rewritten.
- Verify: /applications on production shows no [a-z]+_[a-z_]+ token, at
  375/768/1440, zero console errors.

Then A7.8 (orderFor helper), A7.10 (interaction coverage - unblocked now that
user-event is installed), A7.18 (select-all), Wave C, then B1-B5.

## A7.5 SWEEP + A7.2 second half — CLOSED. Verified on production.

### The sweep map (all 14 nav destinations, signed in)

Walked via the client router in one pass. Every destination resolves, the
heading matches the nav label, and no route logged a console error.

  /dashboard      Good morning, <user>      loads
  /jobs           Jobs                       loads
  /auto-apply     Auto Apply                 loads, "No adapter yet" (honest)
  /apply-queue    Apply Queue                loads
  /inbox          Inbox                      loads, empty
  /tracker        Tracker                    loads, empty
  /applications   Application pipeline       loads, Failed 2 (the A1-corrected rows)
  /agents         Search Agents              "No search agents yet" (honest)
  /resume-editor  (no h1 - see below)        loads
  /analytics      Analytics                  "No applications yet" (honest)
  /network        Network                    "No connections tracked yet"
  /profile        Profile                    loads
  /settings       Settings                   loads
  /settings?tab=Plans                        loads

Nothing dead or mislabelled among the nav items themselves. Two dead CONTROLS
were found inside /jobs and are closed above. Remaining, filed not fixed:
/resume-editor renders no h1 (nav says "Resume", page has no heading element).

### A7.2 second half — 181 fabricated employers, live and applyable

The sweep found it: the resume editor's "Tailor to a job" list read
"UI/UX Engineer — name". 181 himalayas rows carried the literal string `name`
as company_name. field-integrity had been counting them (bad_company: 181) the
whole time with nothing acting on the count.

The parser is correct and NOT_PARSED already rejects the token - these predate
the guard. The A7.2 comment had predicted exactly how they would surface: "the
render guard protects surfaces that route through it, and there is no guarantee
every future surface will."

THREE ATTEMPTS, each of which taught something:

1. Wrote a correction with its own CREATE TABLE data_corrections. A7.12 had
   already created that table with different columns, so CREATE TABLE IF NOT
   EXISTS is a silent no-op and every INSERT then fails into runMigrations'
   swallowed error path. Caught by a guard, not production.

2. Shipped it. field-integrity still said 181. The metric could not see its own
   correction: bad_company used COALESCE(company_name,'') against a token list
   that contains the empty string, so a nulled row counts exactly like a
   fabricated one. Split into bad_company (a lie is stored) and absent_company
   (nothing is stored).

3. Shipped that. The audit row said 399 rows corrected at 00:04:55, while
   bad_company was 181 and absent_company 0 - both cannot be true. company_name
   was VARCHAR(255) NOT NULL, so SET company_name = NULL raised a constraint
   violation that runMigrations logged and swallowed. RECORDED BUT NEVER
   APPLIED - precisely what the audit row exists to expose.

   Without the audit the obvious reading was "the aggregator re-writes them
   every cycle", which is the wrong cause - the live feed has zero bad company
   names across 200 rows - and would have sent the fix into the aggregator.
   That is the whole value of a corrector that keeps a record.

   NOT NULL was also WHY the fabricated value existed: "we do not know this
   employer" had no representation. Dropped. It opens nothing - notAJobReason
   refuses an unparsed company at ingest, stricter than the column ever was.

PRODUCTION, after: bad_company 181 -> 0, absent_company 181, badCompanyBySource
empty, correctionApplied recorded. The resume editor now reads "UI/UX Engineer
— Company not stated".

RENDER, fixed as a class: a sweep of every page found 14 raw
{x.company_name} interpolations across applications, apply-queue, dashboard,
network, resume, tracker and resume-editor. All routed through parsedOr, and
the guard is now the rule over the whole pages directory.

One process note worth keeping: the first read of the fixed page showed the
company missing rather than "Company not stated", because the tab predated the
deploy and client-side routing never fetched the new chunk. Same trap as the
retained console buffer. A hard navigation is part of the check.

116 backend / 94 frontend, 72/72 guards proven red.

### Next goal — A7.4, activity feed reads as English (executable cold)

Raw event keys like `application_submitted` are rendered to users. Map every
event type to a sentence. Every line names the company. Vocabulary already
exists in backend/routes (activity_log writes) - enumerate the distinct
event types from the DB first, then map, so no type is missed.
Then A7.8 (orderFor helper), A7.10 (interaction coverage - now unblocked,
user-event is installed), A7.18 (select-all), Wave C, then B1-B5.

## A7.11 / A7.9 / A7.5(partial) — CLOSED. Verified on production.

Each one was found by verifying the previous one, which is why they land
together.

### A7.11 — 4,685 undated jobs are stated and reachable

Reproduced: himalayas reports posted_null 4685 of 4685 - every row it supplies,
18.9% of the index. BOTH routes in the goal were tested rather than assumed:

- Backfill from pubDate: closed. Fetched live, eight unrelated companies came
  back inside an 11-minute window on the day of the fetch. It is their ingest
  clock. Filling posted_at from it fabricates freshness, which is precisely
  what the null exists to prevent, and D4 would then rest on invented data.
- Backfill from the posting page: closed. It returns 403 to a plain server
  request, and getting past that is circumventing bot protection - the line
  D19 drew for We Work Remotely, which does not move for a different source.

So the second option in full. A7.7's NULLS LAST is correct and was silently
costing a fifth of the product under "Newest first". ranking.undatedTotal is
reported whenever the sort is by recency (null under score - nothing is buried
by date). The page states the count with the reason, and the notice IS the
control: one click applies datePosted=unknown, a filter on a known state rather
than a time window. D22.

PRODUCTION: sort=recent -> undatedTotal 4685 of 24,886. sort=score -> null.
datePosted=unknown -> exactly 4,685, all himalayas, all posted_at null. Click
through gives 4,569 at a 70% floor with 20/20 rows reading "Publication date
unavailable".

### A7.9 — sort, minScore and ranked never survived the URL

Found while verifying A7.11: /jobs?sort=recent produced the score-ranked feed.
The page wrote most filters to the query string and read most back, but these
three by neither - so a shared link showed the recipient a different list, and
the A7.1 score floor reset to 0.4 on every reload with the slider still sitting
where the user left it.

Guarded as ONE RULE, not three assertions: every key the query-builder assigns
must appear in the restore path, derived from the source. The defect is the
asymmetry, so the next control added gets caught.

PRODUCTION: /jobs?sort=recent&minScore=0.7 restores both - "Newest first, then
best match · Only show matches above 70%".

### A7.5 (partial) — the Experience and Date posted filters did nothing

Found while verifying A7.9, on the main browse surface. Selecting "Past 7 days"
left the count at 4,569 with every row still undated - impossible for a
seven-day window. "Senior" did nothing either. Both called setState and
stopped.

The four multi-select facets worked because each separately remembered to call
setPage, syncUrl and loadJobs. Four right by repetition and two wrong is one
missing function, not six buggy controls. applyFilter now owns that path,
including setPage(1) - filtering from page 3 without it makes "Next" ask for
page 4 of a result set the user has seen none of.

Both selects also had no accessible name; the first <option> reads as a label
by sight and is nothing to a screen reader. Same defect as A7.6's checkboxes.

PRODUCTION: 24,897 -> 3,492 on "Past 7 days" -> 891 adding "Senior", URL
?experience=senior&datePosted=7d, no console errors, 375/768/1440 no overflow.

### What still remains in A7.5

This closed the two dead controls found by testing. The FULL sweep in the goal
- every nav item and button on every page, at three widths, mapped to
PROGRESS.md - is NOT done. That is the next goal.

105 backend / 93 frontend, 65/65 guards proven red.

## A7.13 — CLOSED. The empty state names a cause and stops contradicting itself.

Reproduced on production first: keywords=figma + Past 24 hours rendered "No
jobs match these filters" in the count line while a Datadog role sat on screen
below it under "Related jobs". Two defects in one view.

VERIFIED ON PRODUCTION, same URL, after:
  count line : "No exact matches · 1 related"
  empty state: "No exact matches. Past 24 hours is what emptied this - 11 jobs
                match without it. Related jobs are below."
  375 / 768 / 1440, no overflow, no console errors.

The count line quoted `total` (exact matches) while the related list came from
a different field, so the page denied the card underneath it. It now says which
number it is quoting.

The cause is measured, never guessed. GET /api/jobs returns emptyReason: every
active filter, the real COUNT recovered by dropping it, and which one to relax.
Null when total > 0, present always. One query per filter, only on an empty
result.

TO MAKE THAT POSSIBLE filters became DECLARATIVE. They were opaque SQL
fragments appended to a string, so none could be removed individually, and the
alternative was a second set of filter definitions written for the diagnosis -
exactly how A7.17's three ranking paths drifted until they disagreed. Each
filter is now one entry owning both the label the user reads and the SQL the
query runs; compose({skip}) rebuilds the WHERE without one, params included,
because Postgres binds by position. Behaviour-neutral: all 93 pre-existing
backend tests passed unchanged against the refactor.

THE PART PRODUCTION CORRECTED. The first version ranked by largest recovery.
Real numbers: dropping the keyword recovers 580, the date 11, the floor 0. So
it told a user who searched "figma" that their search term was the problem -
true, and useless. Filters now carry a relax order (refinement < choice <
intent) and size only breaks ties within a tier. D21. The fixture had agreed
with the wrong rule because its largest recovery was also its first candidate;
it now makes the keyword the biggest by 25 vs 3 and still expects the date.

Two guards were themselves weak and were fixed: jobsRanking's floor test
matched a source literal the refactor renamed, and is now asserted on emitted
SQL.

100 backend / 78 frontend, 55/55 guards proven red.

## A7.17 perf clause — CLOSED. One index, chosen by the planner.

The spec said: measure p95 before and after, and if it degrades add indexes on
posted_at and overall_score, never reinstate the cap.

p95 from curl could not answer it. 0.391s before, 0.405s after on p50, with p95
moving in both directions across runs - round-trip and serialising twenty
descriptions dominate a 42ms query. So the measurement moved server-side:
EXPLAIN ANALYZE via GET /api/jobs/db-health (authenticated).

    unfiltered feed  42.19ms  2 seq scans  indexes used: none
    24h filtered      1.47ms  1 seq scan   uses idx_jobs_active_posted

Four indexes went in on reasoning; three came out on evidence. The unfiltered
feed reads essentially every active row, so a seq scan is the right plan. The
selective path is the one A7.17 unlocked and there the index is worth 28x.
Dropped from production too, verified: retiredStillPresent [], allPresent true,
filtered path 1.13ms and naming the index.

D20 records the rule: an index earns its place by appearing in a plan.

Deliberately not added: pg_trgm GIN for the ILIKE keyword search, the slowest
path at ~1.3s. A trigram index over description at 24,800 rows is a large
object and this volume has filled once already. Sized against real headroom
before it goes anywhere near production. Open, owned by B1.

## A7.6 — CLOSED, but not the defect it was filed as.

Filed as "checkboxes with no bulk action". Stale: the bulk pipeline landed, and
driving it on production gives "1 job selected" -> "Prepare 1 application" ->
Clear -> 0 checked. Closed by clicking it.

The real defect, found only by clicking: the checkbox had NO accessible name -
no id, no label element, no aria-label, no title. Twenty rows announced as
"checkbox, unchecked" with nothing to distinguish them. Fully usable by sight,
unusable otherwise. Name now built from the same title and company the row
shows, through the same parsedOr, so spoken and visible cannot drift.
Production: 20 labelled, e.g. "Select Product Designer at Sierra".

THE FINDING THAT MATTERS MORE THAN THE FIX: @testing-library/user-event was
never installed. There was no way to write a test that clicks anything. That is
the mechanical answer to "thirty-four green frontend tests that don't click
anything is a false floor" - it was not an oversight of discipline, the tool
was absent. Installed. jobsBulkSelect.test.js drives real clicks, and uses
getByRole with a name, which is the assistive-technology view: a control with
no name cannot be found by the test either, so the two defects guard each other.

This unblocks A7.10 (interaction coverage) - that goal was previously
unbuildable and nobody had said so.

FILED, NOT BUILT — A7.18, select-all. A full page is twenty clicks. It is a
feature sitting next to an apply pipeline, not a defect, so it gets its own
goal rather than being slipped in here.

74 frontend / 88 backend, 48/48 guards proven red.

## A7.14 — CLOSED, a source that is not running is not a source with no jobs.

The panel showed "We Work Remotely (0 · Publication date unavailable)" under a
heading reading "⚡ Live sources". Four separate untruths in one line, and the
diagnosis came from production before any code moved: weworkremotely reports
lastRunSuccess null with ZERO ingestion runs. It was never failing. It was
never running. Their v3 API also 404s now, but that is downstream of a decision
already taken - the aggregator deliberately does not fetch this board.

Fixed:
- "Live sources" -> "Sources". One member of the row was not live.
- "(0 · ...)" -> "(not connected)". Nothing counted it, so there is no number
  to print. Same class as A2c: an unmeasured thing rendering as a measured zero.
- "Publication date unavailable" was A7.3's vocabulary for a JOB's missing
  publish date, printed about a SOURCE's last fetch. Split relativeTime (the
  arithmetic, returns null) from timeAgo / fetchedAgo (the vocabulary). One
  calculation, two words for null, so they cannot drift.
- The dot keyed off `count > 0`, wrong in BOTH directions: a source that died
  overnight still has yesterday's rows and read as active, a wired source that
  matched nothing read as dead. Status is derived once server-side now -
  not_connected / never_run / failing / live.
- Then the dot was red for not_connected, which is the same defect one level
  down: red is a call to action and a deliberate non-fetch needs none. Neutral
  for not_connected and never_run; red reserved for failing.
- N+1 in the same endpoint: success rates ran `await query()` inside a loop
  over every source. 13 sequential round trips, growing per source added.
  Measured against production /api/jobs/sources did not return inside 180s.
  One windowed query: 180s+ -> 0.33s.

VERIFIED ON PRODUCTION: dot rgb(156,163,175) neutral vs rgb(4,120,87) live,
read off backgroundColor (the property that carries the value, per the rule
that cost us a session); tooltip carries the reason; "Publication date
unavailable" now appears ONLY on job cards that genuinely lack a posted_at.
375 / 768 / 1440, no horizontal overflow, no console errors.

NOT DONE, deliberately: WWR's RSS feed returns 200 locally with pubDate on
100/100 items, and robots.txt disallows only account paths. Not sufficient to
re-enable - a 200 from a residential IP says nothing about Railway's egress,
and finding out means probing their bot protection from the server, which is
the thing the original decision refused. D19 records the terms for revisiting:
a positive signal (a supported API, or permission), not the absence of a
negative one.

88 backend / 70 frontend, 45/45 guards proven red.

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

Then: A7.5 (full sweep), A7.4, A7.8, A7.10, A7.18, Wave C, then B1-B5.
(A7.17, A7.13, A7.11, A7.14, A7.6, A7.9 CLOSED and verified on production.
A7.5 partially closed - the two dead controls; the full sweep is still open.)

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

