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
 - Prove the instrument on a known positive before trusting a negative. A
   checker reporting "dead", "unchanged" or "failed" must first be shown to
   report the opposite on a case known to work. D24.
 - A status code never retires a source or a posting. 403/429 mean "cannot
   tell". D25.
 - Sweeps use an ALLOWLIST of known-safe controls; a denylist fails open, and
   the failure mode is an unrecoverable submission. Auto-Pilot off, or a seeded
   account, before any sweep. D26.
 - A green local suite and a green ship gate do not prove a process survives
   production. Land changes that touch many route modules ONE module at a
   time, verified live between each. D44.
 - A claim about the DATABASE is unproven unless it is read back from the
   running database. runMigrations logs a failed statement and continues, so
   regexing migrations.js proves a statement is WRITTEN, never that it RAN -
   green either way. Every claim (tables, indexes, uniqueness, constraints,
   triggers, column defaults) is declared in services/schemaClaims.js and
   reported by GET /api/jobs/db-health. Anything that cannot be read back gets
   an endpoint that reads it back. D36.
 - A rule is not proven by a passing test. It is proven by a test that fails
   when the rule is removed AND by evidence the rule is reachable from a live
   call path. no_deletion was green over zero live executions for as long as it
   existed; can()'s fallback and the `num &&` guard clause were both unreachable
   AND fail-open. D33.
 - A guard is not shipped until an ENDPOINT test proves it fires on real input
   through the real path. A unit test on the function proves the guard works
   and says nothing about whether anything runs it - three shipped that way.
   Asserting the route source contains the call is presence, not function.
   Every guard also gets a case in tools/prove-endpoint-guards-red.js: a test
   that stays green when the call is deleted cannot tell you the guard ran.
   A guard with no live caller is wired or deleted, never left. D32.

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

## UNWIRED GUARDS — CLOSED. Every guard has a live caller and an endpoint test.
Verified on production.

The class: a guard that exists and is not invoked is indistinguishable from no
guard, and the suite is green either way because it tests the function, not the
path. Three had shipped that way - plans.can() with no caller, the
untraceable_claim rule bypassed because POST /api/resume/tailor never called
verifyAdditions, and resumeGuard.verify exported and invoked by nothing.

Census (tools/guard-wiring.js, acorn-parsed, --strict fails CI): 7 guards, 0
unwired. Parsed and not grepped for a reason - two regex cuts of it reported the
very defect it exists to find as WIRED. The first counted `jwt.verify` in
middleware/auth.js as a call to resumeGuard.verify; the second counted the
import statement that names a symbol as a use of it. Both would have handed back
a clean bill of health over a live gap.

FOUND AND FIXED, beyond the three:
 - PUT /api/resume/:id/document saved req.body.doc verbatim. No guard on the
   path at all, and the editor writes through it on every save - the widest
   bypass in the product. Now checked per node, only where the text changed.
 - That node walk does not reach doc.meta, so a job title could be rewritten
   unchecked and would head every export. Now checked; an untraceable header
   reverts, because meta has no pending flag and the only other option is
   publishing it.
 - routes/matches.js imported calculateJobMatch and never called it.

RETIRED rather than left: resumeGuard.verify is no longer exported - it is
verifyAdditions' engine, not a guard of its own. Its no_deletion rule is gone:
verifyAdditions passes an empty current text, so no diff could ever contain a
removal, and the rule had a green test over zero live executions. "Tailoring may
only add" is asserted where it can be observed, on the engine's output.

Untraceable content is held pending, never refused. saveDoc regenerates the flat
text with pending excluded, and that column is what the extension pastes - so
nothing unverified reaches an employer while the user's own typing is never
blocked. The criterion is that nothing unverified is SENT.

PROVED ON PRODUCTION, on the live account: a bullet reading "Managed a team of
25 engineers at Netflix." plus meta.title "Director of Engineering at Netflix"
came back as heldForConfirmation with reasons, pendingCount 1, the header
reverted to "Senior Product Designer", and original_file_text contained neither
- while keeping the real 12% and design-system content. Document then restored.
Tailoring re-checked across 12 live jobs: 0 invented, 0 leaked, refusals
carrying reasons ('Marketing' on job 21229, the exact fabrication that started
this).

CANNOT REGRESS SILENTLY: guardsFireOnTheEndpoint.test.js drives each endpoint
with input the guard must refuse AND the honest counterpart;
tools/prove-endpoint-guards-red.js re-runs it with each guard's call deleted and
requires red - 5/5 confirmed. Both run in ship.sh and CI. Backend floor 218.

NOTE: production submissions are HALTED and I cannot lift it. See BLOCKED.md,
first section. This blocks every tester.

## A7.9 — CLOSED. Pages are slices of one list. Verified on production.

Was: `source_rank <= GREATEST(3, CEIL(page*limit/4))` in SQL, so page and limit
also set the per-source cap. Each page was an OFFSET into a differently capped
list; those lists are not nested at the front, so a row entering as the cap
widened was inserted above rows already shown and the offset stepped past it.

Now: diversity runs once over a fixed 200-row window (services/feedDiversity.js,
no more than 3 of any source per 10 consecutive rows), and a page is a slice.
The window is fixed on purpose - CEIL(limit/4) would have made the canonical
order depend on page size, so 4x10 and 1x40 would again be different lists.
Past the window the feed is plain ranked order, nothing is unreachable, and
ranking.sourceDiversified + sourceDiversityRule state which regime applied.

The slice happens AFTER on-demand scoring and the sort. Diversifying at fetch
time meant the page was a slice of an order that was then rearranged.

PROVED ON PRODUCTION, the same check that found it:
    4 pages of 10 -> 40 ids     1 page of 40 -> 40 ids
    identical order: YES   same set: YES
    unreachable: 0   duplicates: 0   max per source per page: 3

GUARD: feedPaginationCoherence.test.js, on the property not the SQL, on the
pure function AND through GET /api/jobs. Proved red - the old cap approach
fails the same assertion and reproduces the unreachable rows.

## SCHEMA READ-BACK + A7.18 — CLOSED. Verified on production.

DATABASE CLAIMS (new standing rule, applied retroactively). Regexing
migrations.js proves a statement is WRITTEN, never that it RAN - runMigrations
logs a failure and continues, so the test is green either way. The indexes had
the read-back half via db-health; the CHECK constraints did not, and neither did
submission_receipts, its immutability TRIGGER, or its unique index - the three
things standing behind "applied requires a submission record". A trigger that
never got created leaves receipts editable and the source test still passes.
services/schemaClaims.js declares all 8 claims (tables, indexes + uniqueness,
constraints, triggers, and one column default whose ABSENCE is the claim:
applications.applied_at). GET /api/jobs/db-health reports them.
READ BACK FROM PRODUCTION: all 8 present, allSchemaClaimsPresent true.
The reporter is proved on a known negative per kind - which caught a real flaw
in it: the uniqueness check matched "unique" anywhere in the definition, and the
index is NAMED ..._app_unique, so it read a plain index as unique.

A7.18 — select-all on the review queue. Twenty clicks to clear a page is a
queue people stop clearing. Ticks the page, shows a partial selection as
indeterminate rather than rounding it, sends ONE request; the bulk UPDATE is
scoped by user_id AND status='pending_review' in the statement itself, and ids
that did not move are named rather than dropped from the count.
FOUND ON THE WAY, larger than the feature: POST /applications/:id/approve wrote
status='applied'. A draft has no submitted_at/verified_at/confirmation and is
not manual - exactly what applications_applied_requires_submission refuses. The
UPDATE could only ever raise, so the button could only ever 500, while the copy
promised "approve to actually mark them applied". Both approve paths now write
'approved'; the copy says nothing is applied until a receipt returns. D37.
VERIFIED ON PRODUCTION: approve-bulk 400s an empty list, and reports
unchanged:[999999999] for a row the caller does not own.

## NEXT GOAL — A7.11, executable cold.

himalayas supplies no posted_at for 4,663 rows, 19% of the index. Silently
dropping a fifth of the index out of a recency sort is not an option.
Two acceptable outcomes, in order of preference:
  1. Backfill posted_at from the original posting URL at ingest.
  2. State the exclusion in the UI, on the surface where the sort is chosen.
D25 applies: a status code never retires a source or a posting - a 403/429 on
the posting URL means "cannot tell", not "no date".
Reproduce the 4,663 count on production before changing anything. The count is
already surfaced as ranking.undatedTotal - read it back rather than trusting
this note.
Then A7.13, A7.19 (assessment table first: live, not duplicate, machine-readable
permission signal, not paywalled, posted_at per row, employer board not a
bidding marketplace; India sources rank ahead of any Western remote board),
then Wave C (C1+C1a+C1b, C2-C5), then B1-B5.

STILL BLOCKED, operator: production submissions are HALTED and neither lever
available to me can lift it. Item A's remaining steps (queue an application,
A4 receipt, tracker, 1440 pass, restore the account) are gated on it.
Re-checked at every goal boundary this session.

## INCIDENT — API 502, self-inflicted, during A7.11 measurement.

WHAT HAPPENED. While measuring the date filter on production I paged deep into
the feed to inspect the tail: sort=recent&datePosted=7&limit=100&page=250, and
again at 254. That is OFFSET 24,900 with limit 100 over a CTE that ranks the
whole 25,418-row index, three times in succession. The API stopped responding
immediately afterwards - Railway's edge returning "Application failed to
respond", the container not answering at all, while the frontend stayed up.
It did not recover on its own within six minutes of polling.

The API had been verified healthy after the b8b70c7 deploy and answered many
requests during this same session, so the deploy is not the suspect. The deep
pages are.

WHAT IT SAYS ABOUT THE PRODUCT, not just about me. A user cannot type
page=250, but nothing stops them: `page` is taken from the query string and
used directly, and the feed has no upper bound on page or on limit. A single
request can therefore ask the database to rank and skip the entire index. That
is a denial-of-service surface reachable from a URL bar, and it is the same
class as everything else this week - an input nobody clicked, so nobody found
it.

FIX, next goal: bound page and limit server-side, state the clamp in the
response rather than silently truncating, and add the endpoint test that a
request past the bound is refused or clamped rather than executed. A7.9's
diversity window already bounds the fetch INSIDE the window; past it the code
falls back to plain LIMIT/OFFSET with no ceiling, which is exactly the path
that was hit.

## A7.11 — CLOSED. Verified on production. Next goal: A7.13.

MEASURED FRESH FIRST (the note said 4,663): 5,014 of 25,407 rows, 19.7%, carry
no posted_at - every one himalayas, 100% of that source.

BACKFILL IS CLOSED ON EVIDENCE, not on effort. The adapter already records it:
himalayas' pubDate is a last-synced/bumped timestamp, not an original publish
date, confirmed live against postings whose own page showed a date up to two
months earlier. Using it would fabricate a date. posted_at stays null - D25's
shape one level down, and Constraint 1.

THE ROWS ARE NOT DROPPED, and both surfaces were verified rendering the real
figure on production:
  - recency sort, no window: they order last (NULLS LAST) and the feed says
    "5,014 jobs have no publication date and sort last - show them", one click
    to datePosted=unknown. Clicked on production, not read.
  - a date window: they are excluded and the count is stated.

TWO DEFECTS FOUND BY CLICKING IT (D40):
  1. datePosted=unknown reported all 5,014 as EXCLUDED from the filter that had
     just selected them - the page printed "+5,014 more ... (excluded from this
     filter)" under a list of exactly those jobs. Now 0.
  2. The count was taken through the ranked CTE, which already applies the
     window - so under a real window it could not see the rows it exists to
     report and returned 0. Measured outside the date filter now, asserted on
     the SQL sent, proved red.

## NEXT GOAL — A7.13, then A7.19, then Wave C, then B1-B5.

A7.19 needs the assessment table BEFORE any integration: live, not a duplicate,
machine-readable permission signal (a 200 is not permission), not paywalled,
posted_at present per row, employer board not a bidding marketplace. India
sources rank ahead of any Western remote board.

STILL BLOCKED, operator: production submissions are HALTED; neither lever
available to me can lift it (ADMIN_HALT_SECRET unset; admin is user id 1, the
earliest-registered account). Item A's remaining steps are gated on it.
Re-checked at every goal boundary.

## SECOND OUTAGE — self-inflicted, REVERTED. Read this before re-landing bounds.

WHAT SHIPPED: bc5140d, the request-bounds sweep (services/requestBounds.js,
tools/check-query-bounds.js, bounds applied across jobs/matches/activity/
notifications/inbox/tracker/apply). Full suite green locally, 285 tests, all ten
ship.sh stages passed.

WHAT HAPPENED ON PRODUCTION: intermittent 502s. /api/health returned 200 while
/api/jobs?limit=20&page=1 returned 502 and a 3000-char search returned 200 - the
same endpoint alternating, which is the signature of a process crash-looping and
Railway restarting it, not of a bad response. A 502 means the PROCESS died; an
exception inside the handler would have been a 500.

WHAT I DID: reverted bc5140d (2f3fae1) and confirmed recovery within 20 seconds.
Production is healthy on the pre-bounds code.

WHAT IS UNKNOWN, and must be established before re-landing:
  - The crash was never reproduced locally. 285 tests passed and every route
    module loaded under `node -e require(...)`, so whatever kills the process
    is not on a path any test or a bare require exercises.
  - Prime suspects, in order: (1) something in the jobs.js edit that throws
    OUTSIDE the try/catch - the destructure rename touched the top of the
    handler; (2) boundList/asArray interaction on a shape only production sends;
    (3) an unhandled rejection, which Node exits on by default.
  - The verification loop that first "confirmed" the deploy was a broken
    instrument: it polled for a field present in every build. The real marker
    (empty limit -> 20) only appeared later. Do not reuse it.

HOW TO RE-LAND SAFELY:
  1. Reproduce first: boot the API locally against a copy of production shapes
     and hit /api/jobs?limit=20&page=1. Do not deploy to reproduce.
  2. Add process-level handlers (uncaughtException/unhandledRejection) that LOG
     before exit, so the next crash names itself instead of being inferred.
  3. Re-land in one route at a time, each verified on production before the
     next, rather than seven files in one commit.

The bounds work itself is sound and the sweep findings stand - thirteen
unbounded parameters across five files, and a real defect in the bounds (an
absent parameter is not the number zero). It is the LANDING that failed, not
the design. The reverted code is in bc5140d.

## CARRY-FORWARD 2 — NOT DONE. Self-healing health check.

Still outstanding, and this outage is the second argument for it: the API does
not restart itself on unresponsiveness. Both outages needed a human. Needs a
container healthcheck (Railway healthcheckPath, or HEALTHCHECK in the
Dockerfile) plus the process-level crash logging above, verified by making the
service unresponsive deliberately with submissions halted.

STILL BLOCKED, operator: production submissions are HALTED; neither lever
available to me can lift it. Item A's remaining steps are gated on it.
Re-checked at every goal boundary.

## GOAL 1 — CLOSED. Crash visibility and self-healing. Verified.

CORRECTION TO THE PREVIOUS ENTRY, and it matters: the API went down a THIRD
time, on the reverted code, which does not contain bc5140d. So bc5140d was not
the cause of the second outage, my revert was reasoning from correlation, and
the real cause is STILL UNKNOWN. The previous handoff's ranked suspect list is
therefore worthless - it was ranking suspects inside a change that was not
responsible.

SHIPPED (c1cc33a):
 - installCrashLogging: uncaughtException, unhandledRejection, SIGTERM/SIGINT
   and exit each log a stack or a reason before the process dies. The first two
   terminate Node by default and neither left a line behind, which is exactly
   why three outages were diagnosed from the outside.
 - startWatchdog: probes `SELECT 1` every 30s, 8s timeout, exits non-zero after
   3 consecutive failures so the platform restarts the instance. It forgets
   failures on recovery, so unrelated blips cannot accumulate into a restart
   loop.
 - The probe is a QUERY, not a ping. During outage 2 /api/health answered 200
   while /api/jobs failed; "is Node alive" cannot tell serving from wedged.
 - Env-tunable (WATCHDOG_INTERVAL_MS / TIMEOUT_MS / FAILURES) so it can be
   exercised on demand.

WHY NOT A RAILWAY healthcheckPath: a railway.json at the repo root would apply
to whichever service builds from that root, and the frontend builds from the
same repo. I cannot see the Railway service settings from here, so adding it
risked breaking the frontend deploy to fix the backend. The Docker HEALTHCHECK
that already exists does nothing because Railway ignores Docker health status.
Logged as an operator action in BLOCKED.md.

VERIFIED: the real server booted against an unreachable database, bound its
port, failed the probe twice, logged the reason, exited 1. Production recovered
on the deploy and is serving.

## NEXT GOAL — GOAL 2, re-land the request-bounds sweep. Executable cold.

The reverted work is in bc5140d. It is NOT known to be faulty - the outage it
was blamed for recurred without it. Re-land it anyway one route per commit,
verified live between each, per D44.

Order: matches -> activity -> notifications -> inbox -> tracker -> apply ->
jobs (jobs last, it is the largest edit and the one under load).

Before re-landing, close the checker's known gap: tools/check-query-bounds.js
proved PARTIAL on its known positive - mutating jobs.js to restore the
historical unbounded paging made it report `limit` but not `page`. Find out why
before trusting it. Its limits are written in its own header; keep them there.

Findings that stand: thirteen unbounded parameters across five files
(minScore, keywords, exclude, region, workArrangement, salary, ranked, source,
scope, jobType, apply's exclude/runId, inbox's token), unbounded limits on four
routes, and the ?limit= defect where Number('') is 0 and 0 is finite.

Then: A7.13, A7.19, Wave C, B1-B5.

STILL BLOCKED, operator: submissions HALTED; neither lever available to me can
lift it. Item A's remaining steps gated on it. Re-checked every goal boundary.

## GOAL 1b — CLOSED. Crash reasons outlive the container. Verified.

Logging a stack before dying (c1cc33a) was necessary and not sufficient:
Railway's log retention on a crash-looping service is exactly the condition the
instrumentation exists for, and the logs from the first two outages are already
gone. Reasons now go to crash_reports (event, message, stack, RSS, uptime) and
are read back through /api/jobs/db-health.
Best-effort and time-boxed: a handler that hangs reporting a crash converts a
restart into a wedge. If the database is what died, stderr still has the line.
FOUND BY WRITING THE TEST: the crash handlers did not RETURN the promise from
the write, so nothing could await it - the reason would have raced the exit and
usually lost.
VERIFIED: a real process crashed, exited 1, and the reason was read back after
it was gone. On production, recentCrashes is [] - the table is there and
nothing has crashed since. The next one names itself.

IMPORTANT, still true: THE CAUSE OF ALL THREE OUTAGES IS UNKNOWN. A fourth
outage happened at the start of this session and did NOT self-recover in five
minutes despite the watchdog being deployed - so the process is not reaching
the watchdog, which points at a boot-time failure or the platform having
stopped the container. crash_reports is what will answer it. Read db-health
FIRST at the next outage.

## GOAL 2 — IN PROGRESS. 1 of 7 routes landed.

Landing bc5140d one route per commit, verified on production between each
(D44). bc5140d did NOT cause the second outage; do not treat it as suspect.

DONE: matches (6a55c54). page/limit/minScore bounded, clamp STATED in the
response - bc5140d computed a clamp report there and never returned it, which
is the dead-value defect this sweep exists to remove. Verified on production:
?limit=100000&page=99999&minScore=50 -> page 50, limit 100, minScore 1, each
named in `clamped`; an ordinary request untouched.

REMAINING, in this order, one commit each:
  2. activity      limit (def 8, max 100)
  3. notifications limit (def 20, max 100)
  4. inbox         limit (def 50, max 100) + search (boundText) + token
  5. tracker       search (boundText)
  6. apply         exclude (boundText 300) + runId (boundInt)
  7. jobs          LAST and largest: page/limit via boundPaging, search/company/
                   location/source/scope/jobType via boundText, minScore via
                   boundFloat, keywords/exclude via boundText 300, and
                   region/workArrangement/salary via boundList (bounded on
                   COUNT as well as length - ?region=a a thousand times builds
                   a thousand-branch predicate from one URL).

The reference implementation for every one of these is `git show bc5140d`.
State the clamp in each response; do not repeat the matches mistake of
computing it and dropping it.

tools/check-query-bounds.js is in the tree but NOT in CI or ship.sh yet - six
routes are still unbounded so it fails by design. Add it to both with route 7.
Before trusting it, close its PARTIAL known-positive proof: mutating jobs.js to
restore the historical unbounded paging made it report `limit` but not `page`.
Find out why. Its stated limits live in its own header; keep them there.

Then: A7.13, A7.19, Wave C, B1-B5.

STILL BLOCKED, operator: submissions HALTED, and healthcheckPath on the API
service (both in BLOCKED.md). Item A's remaining steps gated on the halt.

## GOAL 1c — HYPOTHESIS TESTED, ONE CAUSE REMOVED, OUTAGES CONTINUE.

FOUND AND FIXED (a7d06b8): calculateMatchesForUser ran
`SELECT id, title, description, requirements, salary_min, salary_max, location
FROM jobs WHERE is_active = true` with NO LIMIT. node-postgres buffers a result
set completely before returning it, so every call materialised all ~25,400
active rows in one array - including description and requirements, the two
largest columns - and built a second array from them. Reachable from an
ordinary feed read: scoreIfNeverScored calls it on a user's first
/api/matches. Now chunked 2,000 at a time by id, survivors trimmed to the cap
as the scan runs. Proved red.

IT DID NOT STOP THE OUTAGES. The API went down again after that deploy and did
not self-recover in four minutes. So the unbounded scan was A memory problem,
and it is not established to be THE cause. Do not close this.

WHAT THE EVIDENCE ACTUALLY SUPPORTS:
 - One crash record exists, from the deploy window: signal:SIGTERM, rss_mb 551,
   uptime_seconds 10. 551 MB at ten seconds is the only hard number anyone has.
 - No uncaughtException or unhandledRejection has EVER been recorded, across
   five outages. Either the process is killed from outside (OOM kill leaves no
   record - it never runs another instruction) or it dies before the handlers
   are installed.
 - The watchdog has never fired either. It exits a WEDGED process; it cannot
   survive being killed, and it cannot help if the crash is at boot.
 - Recovery has only ever come from a redeploy - a fresh container.
 All three of those are consistent with an external kill, most likely memory.

INSTRUMENT WARNING, learned the hard way twice this session: Railway's 502 body
is JSON. Parsing it as an API response yields nulls that read like "the field is
missing" or "there are no records". Check the HTTP status BEFORE interpreting
any body. I misread "0 crash records" from a 502 body and had to correct it.

NEXT, in order:
 1. OPERATOR: read the Railway memory graph and container exit codes for the
    outage windows. 137/OOMKilled confirms or kills the hypothesis in one look.
    Temporarily raise the backend memory limit so RSS can be watched climbing
    instead of the container being killed. I cannot reach any of this - the
    Railway project is not under the logged-in account. BLOCKED.md.
 2. Look for the OTHER unbounded loads. The match scan was found by reading for
    `FROM jobs` with no LIMIT; sweep every service the same way, including the
    aggregator's ingest path, which handles far more rows than a feed read.
 3. Only then continue GOAL 2 (6 of 7 routes remain, jobs last).

## GOAL 2 — 1 of 7. Unchanged this session. See the previous entry for the
route order, parameters, and `git show bc5140d` as the reference.

## GOAL 0 — frontend red run: NOT REPRODUCED. Recorded, not closed.

The ship gate refused a commit with "frontend: 205 passed, 2 failed". Re-run
ten times since - three through the gate's own run-suite command, six with the
exact `npx jest --ci` parallel form, one --runInBand - all 207/207. I have no
record of WHICH two failed, so this is unexplained rather than fixed.

Most likely cause, stated as a hypothesis: at that moment a stray `node
index.js` from the watchdog verification was still running against an
unreachable database, competing for CPU. The frontend suite uses
@testing-library waitFor with a 1s default, and two timing-sensitive tests
timing out under contention fits. It is not proven.

WHAT TO DO IF IT RECURS: capture the failing test NAMES before re-running -
that is what is missing here. run-suite.js writes a JSON summary to a temp file
(--outputFile); read it on failure instead of only the counts.

## GOAL 1g — VOLUME. Measured, retention added, NOT fully closed.

MEASURED from the running database (db-health now reports storage):
  database total          176 MB
  jobs                    161 MB total - 19 tbl + 14 idx, so ~128 MB is TOAST
                          (description + requirements held out of line)
                          28,033 live rows, dead fell 4,803 -> 2,553
  source_ingestion_runs   6,157 rows, NO retention at all
  work_mem                4 MB  <- why a window function over 25k rows spilled

DONE: 30-day retention for source_ingestion_runs and for crash_reports memory
samples; the newest 200 crash rows are kept whatever their age, because the
reason a process died six weeks ago is still the only record of it. Retention
failure never stops ingest.

HONEST STATUS: retention pruned ZERO rows so far - nothing is older than 30
days yet. It is preventive, not curative. The database is still 176 MB. That is
correct and worth stating plainly: the 53100 was caused by the temp-file SPILL,
not by steady-state data, and the spill is gone (1f).

NOT ESTABLISHED: the volume's total size and free space. Postgres cannot see
it, and the Railway canvas shows a warning on postgres-volume without a figure
I could read. Prior note says 500 MB. So "176 MB used of ~500 MB" is an
inference, not a measurement. Getting the real number needs the Railway volume
page - operator, BLOCKED.md.

## GOAL 1j — partially done.

DONE, and it explains two sessions of confusion: the gate now names failures,
and the first named one was
  adminGrant.test.js :: refuses a normal signed-in user - timeout 5000 ms
It passes 3/3 alone, fails only under full-suite parallelism. Jest's default 5s
is a tight budget for a supertest round trip with workers competing for CPU;
nothing in that request touches a real network or database. testTimeout is now
20s on BOTH suites - global, not per test, because the two frontend failures
were never identified and any test could be next. Three clean runs each side.

STILL TO DO in 1j: CI assertion that peak RSS during ingest stays under 500 MB;
a 50-concurrent smoke load test in CI; a disk free-space threshold alert.

## REMAINING, in order

 1h  LATENCY. p95 3,844 ms at 200 concurrent, 8,849 at 500, 17,487 at 1,000.
     Nothing fails; it becomes unusable. Target p95 < 2s at 200. MEASURE FIRST -
     the EXPLAINs in feedPlan and the extra COUNTs are candidates, the pool is
     NOT (proved innocent in 1f). Count queries per /api/jobs request before
     changing anything.
 1i  SWEEP THE THREE CLASSES, each with a CI check:
     - computed values never used (3 found so far: bc5140d's clamp report,
       plans.can()'s fallback, the ROW_NUMBER that was the feed ceiling)
     - unbounded loads (calculateMatchesForUser 25,400 rows; 12-source
       concurrent ingest; fetchAllForPlatform over every ATS company,
       greenhouse alone 10,180)
     - swallowed errors (the feed's "Failed to fetch jobs" hid a disk-full
       error through five outages)
 1j  remainder above.
 2   bounds sweep, 6 of 7 routes, jobs last, one commit each.
 Then A7.13, A7.19, Wave C, B1-B5.

## work_mem — RAISED 4 MB -> 32 MB. Verified on production.

MEASURED FIRST, from pg_stat_database: **3,120 temp files, 13,326 MB spilled**
to disk over this database's life, with work_mem at 4096 kB. That spill is what
failed with 53100 when the volume ran out of room.

Raised via ALTER DATABASE (no reload, no superuser, idempotent, reversible with
RESET; degrades to a NOTICE if the role lacks privilege). Read back from the
running database: work_mem = 32768kB.

32 MB chosen against measured headroom, not by feel: the Postgres service
reports effective_cache_size 5,242,888 kB and shared_buffers 163,848 kB - it is
a different container from the 1 GB app, with gigabytes free.

## GOAL 1h — LATENCY. Measured. One candidate disproved, one identified,
## NOT shipped.

MEASURED, and it corrected my own hypothesis: a feed request runs exactly
**2 queries** - the COUNT and the page. The EXPLAINs I suspected are in
db-health, NOT the hot path. That candidate is dead; do not chase it again.

Latency after the window-function removal and the work_mem raise:
  50 users   p95 1,432 ms
  200 users  p95 3,626 ms   (was 3,844 - work_mem barely moved it, because
                             the spill was already gone with the window fn)
  500 users  p95 8,114 ms
Zero failures at every step. Target is p95 < 2s at 200: NOT met.

THE REAL CANDIDATE, identified and deliberately NOT shipped: both queries build
the same CTE over all 25,418 rows, so the COUNT is close to half the database
work of every feed request - and it answers a question whose answer only changes
when ingest writes, every six hours.

I built a 60-second TTL cache for it, keyed by exact SQL + params, bounded at
500 entries. It broke four tests that index into query.mock.calls by position,
because a cached COUNT shifts the page query's index - a real test-isolation
problem, not a cosmetic one, and it also needs proof that no filter or user's
score floor can ever read another's total. I reverted it rather than ship a
stale-total risk on a live surface at the end of a context window.

TO FINISH IT: reinstate the cache (it is in this session's history), add a
reset hook the tests can call between cases, change those four tests to find
their query by CONTENT rather than by index, and prove on production that a
filtered request and an unfiltered one never share a cache entry. Then measure
p95 at 200 again.

Other lever if that is not enough: the COUNT LEFT JOINs job_matches, and a LEFT
JOIN cannot change a row count unless the score floor is active. Counting
without the join when there is no floor should be checked with EXPLAIN first.

## GOAL 1h — CLOSED as far as it is worth taking. Numbers in LOAD.md.

The COUNT cache landed with its isolation problem fixed first: twelve assertions
across two files read query.mock.calls by ordinal position, assuming the COUNT
runs first. They select by CONTENT now. Safety proved by making each input
differ in turn - two users, a different search, date window, score floor, source
filter each force a fresh COUNT; the page number, which cannot change a total,
does not.

RESULT, and it disproves the assumption behind the change: p95 at 200 went
3,626 -> 2,679-3,434 ms, and at 500 went 8,114 -> 6,366 ms. Removing half the
queries did NOT remove half the latency, so the PAGE query is what costs, not
the COUNT. It builds the same 25,418-row CTE and cannot be cached - it differs
per page and per user.

Target p95 < 2s at 200 is NOT met; best observed 2,679 ms. Reaching it needs a
materialised ranking or a narrower candidate set before the join. Deliberately
NOT done: the product has zero users, and the standing priority is correctness
and Wave C over latency for a load that does not exist. Recorded so the decision
is visible rather than forgotten.

DEAD LEADS, do not chase again: the EXPLAINs (they are in db-health, not the hot
path); the connection pool (proved innocent in 1f); work_mem (raised to 32 MB,
barely moved latency because the spill was already gone with the window
function).

## REMAINING, in order

 1i  SWEEP THE THREE CLASSES, each with a CI check. Not started.
     - computed values never used (5 found: bc5140d's clamp report,
       plans.can()'s fallback, the ROW_NUMBER window function, source_rank,
       the A7.9 leftover)
     - unbounded loads (calculateMatchesForUser 25,400 rows; the twelve-source
       concurrent ingest; fetchAllForPlatform over every ATS company,
       greenhouse alone 10,180)
     - swallowed errors ("Failed to fetch jobs" hid a disk-full error through
       five outages)
 1j  remainder: CI assertion that peak RSS during ingest stays under 500 MB; a
     50-concurrent smoke load test in CI; volume free space in db-health IF
     Postgres can see it - it cannot see the volume, so that half stays an
     operator dependency rather than an inferred number.
 2   bounds sweep, 6 of 7 routes, jobs last, one commit each.
 Then A7.13, A7.19, Wave C, B1-B5.

## UI — "two Locations" fixed. Verified on production. Two things still owed.

REPRODUCED FIRST, on production, before any diagnosis: the jobs filter row
carried a free-text Location input AND a facet panel labelled Location. One
matched the raw location string, the other bucketed it into continents. A user
cannot choose between two controls with the same name, and setting both narrows
twice for reasons nothing on screen explains.

The panel is a REGION filter - the query field is `region`, the code comment
above it says region, and its hint has always read "Grouped by region". Only
the label disagreed. Renamed. VERIFIED ON PRODUCTION: the page now reads
Region x1 with one Location placeholder, no duplicate.

ALSO CHECKED, and NOT broken - do not re-chase:
 - /api/notifications CORS errors in the console are HISTORICAL, from the API
   downtime during deploys. Railway's 502 page carries no CORS headers, so a
   browser reports downtime as a CORS failure. Preflight returns 204 with
   access-control-allow-origin, the GET returns 200 from inside the page, and
   the console tool replays its buffer across reloads. Check the network, not
   the console buffer.
 - Layout at 375 and at desktop: no overflow, filters stack, page usable.

OWED, and deliberately not faked:
 1. A render-level guard that no two filter controls share an accessible name.
    The test I wrote rendered an EMPTY BODY - the jobs page needs more of its
    environment mocked than I built - and a test that does not render the page
    asserts nothing while looking like protection. It was deleted rather than
    shipped.
 2. THE FRONTEND FLAKE IS NOT FIXED. Raising testTimeout to 20s and
    asyncUtilTimeout to 10s REDUCED it, and did not eliminate it. Observed in
    one sitting: 7 failed, then 3 failed, then 0 (the ship gate passed at
    207/207 between two red local runs). Every failing test passes 3/3 in
    isolation - filterControlsApply, undatedReachable, selectAllPendingReview.
    So it is CPU contention between parallel workers rendering whole pages,
    not a timeout budget, and my previous entry claiming it fixed was wrong.
    Next step: run the frontend suite with --runInBand in CI, or -w 2, and
    measure whether the flake disappears. That is a one-line experiment and it
    has not been done.

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

## ITEM 5 — DEMO PASS. Findings, ranked. Production, read-only.

Ranked by what a first-time tester would call broken. All four are FIXED and
shipped; the remaining two are stated as gaps, not hidden.

1. TWO SCREENS FAILED SILENTLY ON A DROPPED CONNECTION.  [FIXED]
   /jobs kept the previous list with nothing said - stale results read as
   current. /dashboard showed an empty page, which reads as "you have nothing"
   rather than "we could not ask". Both now say so. /applications was already
   correct and is the model the other two now follow.

2. THE PLAIN-WORD RENAME STOPPED AT THE NAV.  [FIXED]
   "Ready to send" opened a page titled "Apply Queue"; "Saved searches" opened
   "Search Agents". Two names for one place is worse than not renaming at all.
   Headings and tab titles now match their labels, guarded across all pages.

3. AN UNHANDLED REJECTION EVERY 60 SECONDS ON A FLAKY NETWORK.  [FIXED]
   NotificationBell.load() was try/finally with no catch, called unawaited from
   an effect and on an interval. Invisible to a user; exactly the noise that
   buries a real error in a crash reporter.

4. THE RECEIPT HAD NO UI AT ALL.  [FIXED, item 0]
   Fields, answers, file hash and platform response existed server-side since
   A4 and nothing displayed them.

WHAT THE DEMO PASS CONFIRMED GOOD
   - No horizontal overflow on any screen at 375 / 768 / 1440.
   - No raw snake_case key on any screen.
   - Empty states are honest and specific ("No search agents yet. Create one to
     have HirePilot keep scanning").
   - Score bands render with the number ("Good match · 71%").
   - Pricing toggles INR/USD and the checkout stub says nothing was charged.

GAPS IN THIS PASS, stated rather than implied
   - Screenshots were not captured per screen; the pass was structural
     (overflow, jargon, raw keys, error copy) read from the live DOM.
   - The fresh-account walkthrough was not run: creating an account on
     production makes a real user row, and the sweep allowlist plus Auto-Pilot
     being ON made that the wrong risk to take at the end of the window. The
     granted-credits path WAS verified end to end via the admin grant.
   - The exhausted-limit path is verified by unit test and by code inspection
     of the gate, not by burning 4,500 real credits.

## TESTER RUN — items 0-4 closed. Item 5 (demo pass) is the remainder.

### Item 1 — interaction coverage. No dead control; the tool was the finding.
Two sweeps, instrument proved first each time. The field-name scan was
validated on nine keys known to be sent before any absence was believed; all
four candidates were false positives (sourceBreakdown and activity confirmed
live). The dynamic allowlist sweep flagged controls on six screens and every
one was alive when checked by hand - its signature sliced innerText at 6,000
characters, which is how A7.5 produced 83 false findings. Now hashes the whole
page and counts open dialogs.

### Item 2 — plain language. D28.
Score bands ("Strong match · 78%", unscored stays null rather than "Long
shot"), nav renamed with destinations unchanged, status words that answer "is
it on me?" - submitted became "Waiting for the company". The pipeline columns
existed TWICE with hand-typed labels; the second list is now derived and the
guard is what found the drift.
PRODUCTION: nav plain, bands rendering, no jargon left.

### Item 3 — empty states name a cause AND give one action.
The contradiction was already fixed under A7.13. What was missing was the fix:
one button that removes exactly the filter named ("Show jobs from any date
(11)"), through the shared applyFilter. It offers nothing when the cause is the
search term (D21), when relaxing would still return nothing, or when no single
filter is responsible.

### Item 4 — credits and tiers were counted, not enforced.
spend() is called once and correctly, behind the evidence check, so a failed or
stalled application costs nothing. But it is a LEDGER: it never blocks, because
by then the application has reached the employer. Nothing checked the allowance
BEFORE the work, so a user at 0 remaining could submit indefinitely. Now
checked in the submission gate, fail-closed.
plans.can(userId,'autoApply') was written and called from NOWHERE - the
operator's own account is "starter" with autoApplyIncluded false while
Auto-Pilot runs. Now checked where the capability runs.
Granting shipped with enforcing, because enforcing alone would have switched
auto-apply off for the whole cohort.
PRODUCTION: unknown tier refused with 400; operator granted power, 4500
credits, autoApplyIncluded true.

### Two process failures, recorded
1. I pushed a commit with the frontend suite RED - unchained commands, the
   98e72c8 lesson repeating. What shipped was `const MATCH_EXAMPLE = { score: 1
   }` in the landing page, left by an audit run the 10-minute timeout killed
   mid-case. Inert, but a fabricated example figure in the file whose guard
   bans exactly that. Removed in the next commit.
2. That same killed run left `if (false) {` in routes/plans.js, disabling the
   tier check. The audit now journals the original to disk BEFORE mutating and
   replays any journal at startup - proved by simulating an interrupted run.
   A guard script that can corrupt what it guards is worse than no guard.

### Item 5 — DEMO PASS, remaining. Executable cold.
- Production, READ-ONLY, cloud browser. Do NOT submit any application.
- Every screen at 375 / 768 / 1440, on a fresh account AND a granted-credits
  account. Screenshot each.
- Include a forced API failure and an exhausted limit.
- Report anything a first-time user would call broken, ranked.
- The sweep allowlist in tools/ui-sweep.js is what may be clicked; anything
  else is looked at, not touched. Auto-Pilot is ON and the daily cap is 5.

## ITEM 0 — CLOSED. Auto-Pilot on, constrained. Verified on production.

Real applications go to real employers under testers' names, so every claim
below was proved end to end rather than reasoned about.

KILL SWITCH — flag name: `submissions_halted`, row in `system_flags`.
  Three levers: POST /api/apply/admin/halt with x-admin-secret
  (ADMIN_HALT_SECRET), the same endpoint from the admin account
  (users.is_admin, seeded to the lowest user id), or SUBMISSIONS_HALTED=1.
  Fails CLOSED - unreadable flag halts submission, an admin lookup that errors
  denies the caller.
  PROVED ON PRODUCTION: halted via the admin account, then POST
  /queue/<approved id>/start returned 429 "Submission is paused for all
  accounts." Resumed afterwards; the same call now returns 409, the ordinary
  not-approved answer.
  NOTE: ADMIN_HALT_SECRET is NOT set - the app's Railway project is not under
  the logged-in account (BLOCKED.md). The admin-account lever is what works
  today and it is proven.

DAILY CAP — 5 per user per day, at the one transition to 'submitting'. Counts
  'submitting' as well as 'submitted' so parallel starts cannot all pass at
  once. auto_apply_limit_per_day is user-settable and the operator account sat
  at 50; the write path and the runner now clamp to the ceiling.

A7.8 TIE-BREAK — PROVED, with submission halted first.
  Bulk prepare twice, identical inputs, minScore 0.6, MAX_BULK 50 so the limit
  genuinely cuts:
      run 1  queued 48, skipped 1 already-existing
      run 2  queued  0, skipped exactly the same 49 job ids
  Non-deterministic ordering would have selected different jobs at the limit
  boundary and created new rows. It created none. The 48 test rows were then
  skipped and the account is back to its exact prior state: 6 needs_user,
  6 approved.

A4 RECEIPT — was NOT rendering. The endpoint has existed since A4 carrying
  fields sent, answers given, resume SHA-256 and the platform response, and
  nothing displayed it. Built and shipped: on every application card, four
  distinct states (record / none-recorded-with-the-server's-reason / display
  failure / absent value), and a display failure is never presented as a
  missing record.

TAILORING GUARDS — ran against a real resume, and one was badly broken.
  All three fire on what they exist to stop. But honest tailoring was ALSO
  blocked: normalise keeps `.` and `%` because they matter inside a token
  (12%, node.js, c++) and left them on the END of ordinary words, so the corpus
  held "12%." and "teams." while an addition offered "12%" or "redesign.".
  The guard called the user's OWN figure an invented number. A guard that
  blocks everything is as useless as one that blocks nothing - it would have
  meant tailoring never worked for testers, or someone routing around it.
  Fixed, pinned in both directions.

ADAPTERS — Greenhouse only. Lever and Ashby stay out of SUPPORTED_ATS; neither
  has run against a live form. Pinned by a test.

Full configuration recorded as D27.

185 backend / 166 frontend, 114/114 guards proven red.

## A7.9 — REPRODUCED, designed, NOT SHIPPED. Next goal, executable cold.

The URL round-trip half of A7.9 is closed (recorded below). This is the other
half - a parameter carrying two meanings - and it is a real pagination defect.

REPRODUCTION, on production:
    40 rows fetched as limit=40&page=1        -> 40 ids
    40 rows fetched as limit=10, pages 1..4   -> 40 ids
    identical order: NO.  same set: NO.
    6 jobs appear in the single page of 40 and in none of the four pages of 10.

CAUSE. The diversity cap is
    source_rank <= GREATEST(3, CEIL((page * limit) / 4))
so `page` and `limit` are not only pagination - they also set how many rows
each source may contribute. At limit=10 the cap is 3 per source on page 1, 5 on
page 2, 8 on page 3. Each page is therefore sliced with OFFSET out of a
DIFFERENT capped list, and the lists are not nested at the front: a row that
enters when the cap widens is inserted ABOVE rows the user has already been
shown, so the offset skips past it. Rows can be missed entirely, and the same
row can appear on two pages.

A7.1 introduced the growing cap so deep paging could eventually reach
everything. It does - but it broke pagination coherence to get there, and
nothing said so.

THE FIX, designed and not yet built:

  The cap must not depend on `page`, because pages must be slices of ONE list.
  Do the diversity in application code over a stable order:

  1. Fetch the UNCAPPED ranked list, LIMIT page*limit (bounded; reject or clamp
     absurd page numbers, and state the clamp).
  2. Walk it in order, filling pages of `limit` and enforcing a per-page source
     quota of CEIL(limit / 4); a row whose source is over quota for the page
     being filled defers to the next page rather than being dropped.
  3. Return page P from that partition.

  This is a pure function of (ranked order, page, limit), so pagination is
  coherent by construction: no row is skipped, none repeats, and no source owns
  a page - which is what A7.1 actually asked for.

  ranking.sourceDiversified stays; add the per-page quota to it so the UI can
  state the rule rather than implying it.

  Guard it on the property, not the SQL: for a fixed filter, the concatenation
  of pages 1..N at limit L must equal page 1 at limit N*L, as a set AND in
  order. That single assertion fails on today's behaviour and passes on the
  design above. Then re-verify on production with the same 40-vs-4x10 check
  used to find it.

  Deliberately NOT shipped at the end of a long session: it rewrites paging on
  the hottest endpoint in the product, and a half-verified version of it is
  worse than the defect. Everything needed to build it cold is above.

## A7.8 — CLOSED. One declaration for the order that decides what gets applied to.

A7.7 fixed non-deterministic ordering for the browsable feed. Two queries kept
the defect, and on these the consequence is not cosmetic:

  apply.js         "apply to all matching" -> ORDER BY overall_score DESC
                   LIMIT MAX_BULK
  autoApplyEngine  Auto-Pilot's candidates -> ORDER BY jm.overall_score DESC
                   LIMIT 50

Both cut a ranked list at a limit, and the score is a weighted sum of four
coarse components, so ties are common. Which jobs fell inside the limit was
whatever the plan produced - two identical requests could queue two different
sets of employers, with no explanation available for why one was chosen. On the
feed that reads as a strange order; here the product applies to a different
company.

CANDIDATE_ORDER in backend/services/jobOrder.js declares it once (score, then
job_id as the unique final key) and both callers render it, aliased where
needed. Four more LIMIT-ed queries in the same files also ended without a
unique key - resume selection, last run, question variations, skills - and were
given one rather than argued to be probably fine.

Not verified by triggering a bulk prepare, deliberately: that queues real
applications. Verified that the deployed feed returns byte-identical ordering
across repeated calls, and by the guards.

THREE OF MY OWN INSTRUMENTS FAILED IN THIS GOAL, each caught by the mutation
audit refusing to call a guard proven:
  - A grep using [^`\n] in POSIX ERE - which excludes the literal letter "n" -
    reported no offenders while one existed.
  - "takes the order from the shared declaration" matched the helper name
    anywhere in the file, so an unused import satisfied it.
  - The unique-key pattern listed column names and rejected concept_id, because
    \bid\b does not match inside an underscored word.
That is D24 three more times in one goal. The audit is what caught all three.

161 backend / 161 frontend, 108/108 guards proven red.

## A7.21 — CLOSED. Link and anchor audit, signed in and out, three widths.

29 route/width combinations audited on production. Instrument proved on a known
positive before any negative was believed, per D24.

  INSTRUMENT PROOFS
    - Collector: confirmed it sees a link known to be present (/signup).
    - rel detector: planted an <a target="_blank"> with no rel; the detector
      reported exactly one missing. Without that, "all links are safe" would
      have been indistinguishable from a scan that reads no links at all.
    - Status checker: /definitely-not-a-page returns 404, so a 200 elsewhere
      means something.

  RESULT — nothing to fix.
    - Internal routes: 23 of 23 return 200, including /login and /signup
      signed out and /settings?tab=Plans.
    - Dead anchors: none. The only in-page anchor is /#pipeline, and it
      resolves. (The one dead anchor this goal was filed for, /#features, was
      fixed under A7.25.)
    - External links: every one carries rel="noreferrer". 20 on /jobs alone.
    - Breakpoint parity: identical href sets at 375 / 768 / 1440 on every
      shared route. Nothing is reachable at one width only.
    - Signed-out hamburger at 375: reveals /#pipeline and /login, which is
      exactly what the 1440 nav shows. Nothing is trapped inside it.
    - "Original posting" links: 20 sampled across all 12 sources, none dead.
      8 of 20 non-200 to a scripted client, all of them live in a browser -
      that finding is D25 and it is why no link-health feature may retire a row
      on a status code.

  GUARD ADDED. The audit is a snapshot; the guard is the deliverable. No
  target="_blank" anywhere in pages/ or components/ without rel noopener or
  noreferrer, plus a sentinel proving the scan can still see the links it
  checks - a repo-wide floor alone cannot fail when one file loses its links.

## A7.5 — CLOSED. Nav map plus every button, driven on production.

The nav half was already mapped (all 14 routes below). This closes the button
half: every button on all 13 signed-in routes, clicked, at 375 / 768 / 1440.

  clicked and observed .. 77
  skipped as unsafe ..... 43  (apply / submit / send / approve / delete /
                               discard / retry / prepare / run / pay / save)
  dead controls found ... 1

THE ONE REAL DEFECT. /network "Find contacts": type a company, click, one
request goes out, nothing renders, no error. POST /api/network/suggest returns
{ company, areIdentifiedPeople, searches, note } and the page read
`data.suggestions`. Both halves worked and disagreed about one field name -
present, functional, blank. Guarded as the contract: the field the page reads
must be one the endpoint sends, checked against the route source.
PRODUCTION after: three LinkedIn search links, rel="noreferrer", with the
"searches to run, not people HirePilot identified" sentence intact.

THE INSTRUMENT WAS THE STORY. The first pass flagged 84 controls as doing
nothing, because it compared innerText length and the URL - which cannot see a
drawer open, or a page of twenty similar-length rows change. Re-probed with a
detector watching the DOM and counting fetches, all of them were alive: View
Details opens a drawer and fetches twice, pagination re-renders, Auto-Pilot
toggles and posts, Export CSV requests a file without touching the DOM, and the
grid/list toggle switches when clicked from the other state. 84 findings, 83 of
them mine. Measure with something that can see the change.

TWO PROCESS ERRORS, recorded rather than tidied away:
  - I clicked "Save and continue this application" on production before the
    exclusion list covered save/update/create. Nothing was submitted -
    applications remain applied: 0 with no submitted_at, queue unchanged at 6
    needs_user and 6 approved. The product's own rule (an unanswered question
    keeps an application parked) is what held. List tightened.
  - The deploy check grepped the bundle for "searches", which the OLD bundle
    also contained in unrelated copy ("searches to run against LinkedIn"). It
    reported DEPLOYED against the old chunk and the fix looked broken on
    production. Re-checked against the minified form of the actual change
    (`searches||[]`). An assertion satisfied by an unrelated match, in the
    deploy check this time.

153 backend / 130 frontend, 99/99 guards proven red.

### Next goal — A7.21, link and anchor audit (executable cold)

- Every <a>, every navigating button, every anchor target, signed IN and signed
  OUT, at 375 / 768 / 1440. Record label, target, HTTP status, and whether the
  destination matches the label.
- Fix: dead anchors, 404s, unexpected external navigation, buttons that
  navigate nowhere, external links missing rel="noopener"/"noreferrer", and any
  link reachable at only one breakpoint (the hamburger hides the nav under
  768 - check what is inside it, not just that it opens).
- Sample 20 "Original posting" links across sources and confirm each resolves
  live. Those are the links that take a user to an employer; a 404 there is the
  product sending someone to a job that no longer exists.
- Already known good: footer links (/pricing /privacy /terms /refund-policy
  /contact all 200), the single in-page anchor /#pipeline, and the LinkedIn
  search links on /network (rel="noreferrer", verified on production).

Then A7.10, A7.18, A7.19, Wave C, B1-B5.

## A7.25 — CLOSED. Landing truth, pricing, legal pages, footer. Verified on production.

All six claims reproduced against the live page before anything moved. One did
not hold as filed and is recorded here rather than quietly "fixed": the anchor
defect is real, but it is in components/Layout.js, not the landing page, and
the label is "Features" on the SITE-WIDE header - the landing page itself had
no nav links at all.

  1. ANCHOR — Layout rendered <Link href="/#features">Features</Link>; the only
     id on the landing page is "pipeline". The single nav link on the site
     scrolled nowhere. Now "/#pipeline", labelled "How it works" so the label
     names the destination ("Four honest stages") instead of being a second
     name for one place. Guarded as a rule: every in-page anchor the layout
     renders must match an id the landing page defines.
  2. TWO PRODUCTS — <title> "Job Search on Autopilot" vs og:title "job search
     with the numbers shown". Reconciled onto numbers-shown, the one the
     product keeps. PRODUCTION: title === og:title === twitter:title.
  3. HERO — "actually on autopilot" sat on the same page as "in your review
     queue waiting for your approval". The product parks drafts on purpose, so
     the sentence moved. PRODUCTION: phrase absent.
  4. PRICING — /pricing built. INR primary, USD toggle (clicked on production:
     ₹0/₹399/₹899 -> $0/$5/$11). Free / Pilot / Copilot. Scoring and its
     four-weight breakdown free at EVERY tier - charging for the explanation
     would make the free tier the black box this product argues against.
     Nothing metered per application. Cancel-in-one-click stated where the
     money is asked for. Checkout stub clicked on production: "Checkout is not
     live yet. Nothing has been charged and no payment details were collected."
     No receipt, no order number, no thank-you - a confirmation for a payment
     that did not happen is a fabricated record.
  5. FOOTER — /privacy, /terms, /refund-policy, /contact, all 200, all real
     prose describing what this product does. Where something is not built
     (payments) they say so rather than reserving an unused right.
  6. MOBILE — no app exists. WEAKENED (D23): stated as a capability rather than
     linked, with a guard asserting no page links an App Store or Play URL, so
     a dead link cannot appear later.

PRODUCTION: / /pricing /privacy /terms /refund-policy /contact all 200, no
horizontal overflow at 375 / 768 / 1440, zero console errors.

Two guards initially failed on their own explanatory comments - one tripped on
the phrase it exists to ban, the other on the word "receipt" inside a comment
forbidding receipts. They strip comments now: a guard that reads prose is
testing the wrong text. Same lesson as the pg_indexes guard in A7.17.

153 backend / 126 frontend, 97/97 guards proven red.

### Next goal — A7.5, full CTA and flow sweep (executable cold)

The nav-destination map for all 14 signed-in routes is already recorded below
under "A7.5 SWEEP". What remains is the BUTTON half: every button on every
page, signed in, at 375/768/1440 - where it goes, whether the destination
matches the label, whether the content is consistent with where the user came
from. Two dead controls were already found and fixed this way (Experience and
Date posted). Use applyFilter as the model: a control that only calls setState
is the defect signature.

Then A7.21 (link and anchor audit, signed in and out, plus 20 "Original
posting" links sampled across sources), A7.10, A7.18, A7.19, Wave C, B1-B5.

## A7.20 — CLOSED. Every job a user sees carries a score. Verified on production.

Cause confirmed by measurement, not assumed: A7.17 made the index the universe,
correctly, but scoring runs periodically, so a job ingested since the last
sweep has no score for this user - and "past 24 hours" selects exactly those
rows.

  BEFORE (production)            AFTER
  default feed   0 of 20         0 of 20
  24h filter    20 of 20         0 of 20
  keyword        0 of 20         0 of 20
  keyword + 24h  2 of 4          0 of 4

The page is scored on the way out: after the filters choose the rows, before
the order is decided, for the twenty rows on the page and not the 24,800 behind
them. Persisted, so once per user per job. Deliberately NOT filtered by
MATCH_THRESHOLD - a row the user is looking at needs a score whatever it is,
and dropping the weak ones would re-score them on every page view while still
leaving them blank on screen.

ORDER. Rows arrive from SQL ordered by a score they do not yet have, so the
page is re-sorted once the scores exist - otherwise the newest job, by
definition the least likely to have been scored, ranks below every stale one
under "Newest first". That needs a comparator agreeing exactly with the SQL
ORDER BY, and writing the order twice is how A7.17's ranking paths drifted.
backend/services/jobOrder.js declares it once and renders both. That also
closes A7.8's shared-helper concern for this list.

WITHHELD, NOT BLANK. A row that still cannot be scored is dropped from a ranked
view and counted in ranking.withheldUnscored - a user who reached the list by
matching must not be handed a row nothing matched. Constraint 1.

EVICTION. calculateMatchesForUser deletes everything outside its top-500, which
would have wiped on-demand scores within the hour. job_matches.on_demand marks
them, the sweep skips them, and they carry their own bound (2,000 per user,
newest kept) because the volume has been filled once already.

p95 MEASURED, warm, before -> after:
  default p50 0.413 -> 0.406 | 24h p50 0.354 -> 0.349 | keyword p50 1.345 -> 1.329
Unchanged. The first reading after deploy showed 40s timeouts on the default
feed; that was the service restarting, and re-measuring warm is the difference
between a finding and a false alarm.

ACCEPTANCE, on production, at 375 / 768 / 1440, no horizontal overflow, and
zero console errors on a FRESH document:
  /dashboard  5 rows, 5 scores | /jobs 20/20 | /jobs?datePosted=24h 20/20
  /jobs?keywords=designer 20/20 | keywords+24h 4/4
  unscoredInPage 0 and withheldUnscored 0 on every one.

Also fixed here: the dashboard printed "75" with no unit, contradicting the
rule jobs.js states explicitly - a bare number is not a score, the % carries
the meaning. Guarded across every page.

A NOTE ON THE CONSOLE CHECK. The first read showed a wall of CORS failures
against /api/notifications, /api/profile, /api/matches. They were deploy-window
artifacts held in an old tab's buffer: cors() is wide open, every preflight
returns 204 with access-control-allow-origin, and a fresh document logs
nothing. A retained buffer reads as a live error - check on a new document.

153 backend / 109 frontend, 91/91 guards proven red.

## A7.4b — CLOSED. The stored screening reasons, corrected.

PATCH /api/apply/queue/:id/questions persists each reason into
applications.screening_answers, so A7.4's generator fix did not change rows
already written. Reproduced: GET /api/apply/blockers returned 8 affected
questions across 6 applications.

Regenerated, not patched: the stored question carries `suggestion` - the saved
answer the corrected sentence names - so the new reason is built by the
generator's own function, now the single definition of that sentence. Only
`reason` is written; answers are the user's own data and a demographic answer
must never be rewritten by a migration. Idempotent, anchored, and it declines
to guess when there is no saved answer to name.

Recorded in data_corrections before applying AND the applied rowCount returned,
because A7.2 reported 399 rows corrected while changing none.

PRODUCTION: field-integrity staleScreeningReasons {applications: 0,
questions: 0}; /api/apply/blockers carries no key; the page now reads
Your saved answer ("Decline To Self Identify") is not one of this form's
options - which is also the more useful sentence, since it names the thing the
user has to act on.

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

Then: A7.25 (landing truth + pricing + footer), A7.5 (full sweep), A7.21 (link audit),
A7.10, A7.18, A7.19, Wave C, then B1-B5.
(A7.20, A7.4b, A7.4, A7.17, A7.13, A7.11, A7.14, A7.6, A7.9 CLOSED; A7.8 closed for the jobs list.)
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

