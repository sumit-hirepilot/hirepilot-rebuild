# HirePilot — Decisions

Autonomous decisions taken without asking, per §7. Newest last.

## D1 — G0.1 shipped before this prompt arrived
The backlog's first goal was already complete from the prior session: real
counters, `/api/jobs/stats`, three passing tests. Re-running it would be a
no-op. ASSESS treats it as shipped and selects G0.2.

## D2 — supertest added as a dev dependency (G0.1)
Needed to assert on HTTP status codes, which is the whole point of the "503
rather than a zeroed body" criterion. Test-only; not in the runtime bundle.

## D3 — G0.2: render facts, not screenshots of a seeded demo account
The criterion offered "a real screenshot from a seeded demo account, or removed".
Chose neither literally: screenshots go stale silently and cannot be verified at
runtime, and the panels can show something better than an image - the actual
weights, guard rules and status vocabulary from shipped code.

The scoring panel is the load-bearing case. A score requires a user's own skills
and experience; a logged-out visitor has none, so there is no real number to put
there. Showing the four weights (40/30/20/10, cited to matchingEngine.js) states
how the product works without inventing a result it cannot compute. A test
asserts these weights still equal the engine's, so the page cannot drift into
lying about its own maths.

## D4 — jest added to the frontend workspace
No test runner existed there. Needed for the landing-honesty regression guard.
Test-only.

## D5 — G0.3: the FAQ was understating the product, so the copy moved
"Does HirePilot submit real applications to employers?" answered "Not yet." That
stopped being true: the extension submits in the user's own browser and an
application is only marked applied once the employer's confirmation page is
captured. §7 says copy follows the product; the rule reads the same in both
directions, so the answer was corrected rather than left modestly wrong.
Coverage stated honestly: Greenhouse, Lever, Ashby automated; Workday, Taleo,
iCIMS opened for the user.

## D6 — OG image generated as a real PNG, no dependency
public/ had no image assets. An SVG og:image would satisfy "present" while
rendering nowhere - Facebook, Twitter and Slack all reject it - which is a fake
pass. Wrote a ~40-line PNG encoder using Node's built-in zlib to emit a real
1200x630 card. No dependency added, and verified by reading the file's IHDR back.

## D7 — Lever and Ashby disabled before closing the session
Both were in SUPPORTED_ATS and had never been run against a live form. An
application cannot be unsent; a wrong field mapping or the wrong file attached
puts a user's name on it permanently and they learn about it from a rejection.
Irreversibility outranks severity, so this preempted #45 - a page that will not
load costs minutes.

Disabled rather than deleted: the adapters are probably fine, they are simply
unproven. Re-enable per-adapter alongside evidence of a verified live run.
A test pins the list so re-enabling requires editing it, which is the moment
someone has to produce that evidence.

## D8 — Master Prompt v2 adopted; Wave 0 goals remapped onto Wave A
v2 supersedes v1 and reorders the backlog around trust first. The outstanding
Wave 0 goals were not discarded, they were remapped: G0.6 -> A4, G0.7 -> A5,
G0.5 -> A6, the H2-H8 follow-ups -> A3, G0.4 -> B3. Recorded so a cold start
does not treat the Wave 0 IDs as dropped work.

## D9 — A1 diagnosed but deliberately not started
Past the §3 session budget, and §3 forbids starting a goal that cannot be
verified in-session. A1 is a CHECK constraint + corrective migration + route
change on the `applications` table; a half-applied migration there is the
irreversible class of change §3 singles out. Wrote the full diagnosis and a
concrete before/after verification path instead, so the next session starts at
BUILD rather than re-deriving. Stopping cost one session; shipping an unverified
migration on real users' application records could not be undone.

## D10 — A1 must not blanket-convert every evidence-free "applied" row
The obvious reading of Constraint 7 is "any applied row without a submission
record is false". That is wrong here: the schema carries `is_manual` and
`submitted_by`, and a user manually logging an application they sent themselves
is honestly applied with no HirePilot submission record. Only rows written
*automatically* without a send are false. Flattening the distinction would
relabel honest user entries as failures - itself a Constraint 1 violation.
The fix would have committed the harm it was written to remove.

**D10a — the distinction belongs in the CHECK constraint, not only the
migration.** A migration corrects the rows that exist today; it does nothing
about the next write path. Put the rule in the table constraint so any future
insert is rejected at the database, and treat the route change as defence in
depth rather than the enforcement.

Rule to encode:
    status = 'applied' AND is_manual = false
      => at least one of submitted_at / confirmation_captured_at NOT NULL
`is_manual = true` rows are honest with no evidence and must pass untouched.

**Implementation order matters.** `ALTER TABLE ... ADD CONSTRAINT ... CHECK`
fails outright if any existing row violates it, and migrations/STATEMENTS runs
on boot with each failure only logged - so a constraint added before the
corrective UPDATE would silently never apply and the hole would look closed
while staying open. Either put the corrective UPDATE earlier in STATEMENTS than
the ADD CONSTRAINT, or add it `NOT VALID` and `VALIDATE CONSTRAINT` after.
Verify the constraint actually exists afterwards by querying the catalog:

    SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
     WHERE conrelid = 'applications'::regclass;

Do not infer it from the migration having run, and do not infer it from the
absence of an error in the boot log - the runner cannot produce one.

## D11 — A2 runs before A1 this session
A1 is the gate on anyone seeing a tracker and stays mandatory, but it needs an
all-user audit that needs DB access, and it is a migration on real application
records. A2 needs no migration and fixes what every new tester hits in their
first thirty seconds: signup, resume upload, then an empty feed with no
explanation, because scoring only runs on a manual
POST /api/matches/recalculate. Operator decision, taken with the health data.
A1 immediately after.

## D12 — A3-c instruction truncated; interpretation recorded
The A3-c brief ends mid-sentence at "Find every place in". Per the standing
operating mode (decide, record, continue) I read the goal as its first bullet
states it: sweep BOTH suites for containment assertions a superstring would
satisfy, anchor them, and re-prove each red through the mutation audit with a
superstring mutation specifically.

Scope decision inside that: `expect(x).not.toMatch(...)` is NOT in scope. A
superstring makes a negative assertion more likely to fire, not less - its
failure mode is the opposite one (the false positive, which is what H4 was).
The vulnerable shape is a POSITIVE containment on a source or SQL string where
the target is an identifier: `/HP_EXECUTE/` is satisfied by `HP_EXECUTE_X`,
`toContain(CONSTRAINT)` by `<name>X`. Those are what get anchored.

Assertions on RENDERED user-facing copy (renderState, applicationsScreen) are
also out of scope: there containment is the intent - the sentence legitimately
contains the word - and anchoring would pin wording that is allowed to change.

## D13 — submissions stay in the user's own browser; no remote control
Recorded position, permanent. Applications are submitted in the user's own
browser, in their own signed-in session, user-initiated. The extension is not
remote-controllable from the cloud and must not become so. Remote-driving it
would convert the mechanism into something materially closer to server-side
automation - exactly what Constraint 4 marks `deferred: ToS` and what A5's
Greenhouse finding flagged for counsel. Constraint 4 stays `deferred: ToS`
until counsel answers that flag. See SUBMISSION_AUDIT.md §4.

## D14 — mobile app is filed, not built
Filed as an A7-style backlog item with acceptance criteria (BACKLOG_MOBILE.md).
E2 stays what it is: surfacing store links on the site. Building a mobile app
is not in the current queue and must not be started as a side effect of E2.

## D15 — no tsconfig checkJs; JSDoc on API shapes instead, deferred
A3-c offered tsconfig with allowJs + checkJs, or a recorded reason not to.
Recorded reason: turning on checkJs across a codebase this size surfaces
hundreds of pre-existing implicit-any and possibly-undefined errors at once.
The only ways through are a blanket ignore list, which makes the typecheck a
rubber stamp, or a large refactor - and §BUILD forbids adjacent refactors.
Either would trade a real guard for a green tick.

What is being done instead, and it is not nothing: the concrete failure
typechecking would have caught here is API request/response shape drift, and
that is already guarded behaviourally - jobsRanking pins the ranking contract,
submissionReceipt pins the receipt shape, scoreOnRead pins the scoring
contract, adapterStatus pins the coverage vocabulary in both directions. Those
catch drift a structural typecheck would not, because they assert on what the
query actually produces.

Revisit if a shape bug reaches production that JSDoc + checkJs would have
caught. Until then this is deliberate, not an omission.

## D16 — the 399 legacy rows stay active; render withholds, ingestion blocks
A7.2 requires an unparsed field to be "repaired or withheld, never rendered
with the placeholder visible". Production carries 399 such rows (all himalayas,
of 25,012 active) plus 24 unparsed locations.

Repair is impossible: there is nothing to recover the employer FROM, and
inventing one is the fabrication the goal exists to prevent.

Withheld at RENDER rather than deactivated in the database. `parsedOr` already
shows "Company not stated" everywhere company_name is rendered, so the
placeholder never reaches a user - the criterion is met. Deactivating the rows
would destroy 399 otherwise-usable postings whose title, location and apply URL
are all intact and clickable, to fix a field the UI already handles honestly.
That trades real user value for a cosmetic database state.

No corrective migration, therefore no data risk. The ingestion gate stops the
count growing; /api/jobs/field-integrity makes it visible if it ever does.

## D17 — himalayas has no posted_at at all; filed as A7.11, not built
A7.3's per-source report: 4,663 of 4,663 himalayas jobs carry no posted_at -
100% of that source, 19% of the whole index. Every other source is at 0%
undated.

The consequence is not cosmetic. A7.7 sorts `posted_at DESC NULLS LAST`, which
is correct for a handful of undated rows and wrong at this scale: under "Newest
first" a fifth of the index sorts last permanently and is effectively
unreachable. The sort is right; the data is the problem.

Not fixed here, and deliberately not a quick default. Filling posted_at with
the fetch time would fabricate freshness, which is what the aggregator's null
exists to prevent - the fix has to recover a real date or admit the gap.
Filed as A7.11 with both options costed. One source, one adapter: tractable.

Also blocks D4 (timing signal) for that 19%, so A7.11 is a wedge prerequisite
rather than tidying.


## D18 — a diversity cap may reorder a page; it may not shrink the total

A7.17's thesis is that filters apply to the index and ranking applies to the
filtered result. The per-source cap sits awkwardly across that line: it deletes
rows, which makes it look like a filter, but its purpose is presentational -
stop one source owning a page.

Resolved by where the count runs. The page query caps; the COUNT does not. The
cap relaxes as you page, so every capped row stays reachable, which makes the
uncapped count the honest answer to "how many jobs match what I asked for" and
makes it stable across pages. Counting inside the cap gave 60 on page 1 and 120
on page 2 - not a rounding difference, a number that means nothing.

The general rule, since this will come up again: anything the user did not ask
for may change the ORDER of a result set or what fits on one page. Only what the
user did ask for may change its SIZE.


## D19 — We Work Remotely stays unfetched; the reason moves out of a code comment

Their v3 JSON API now returns 404, and the aggregator has not run this source
at all - production reports lastRunSuccess null with zero ingestion runs, so it
was never failing, it was never running. The reason existed only as a comment
next to the SOURCES array: the site is behind bot protection and we will not
circumvent it.

Their RSS feed does currently return 200 to a plain unauthenticated request,
carries pubDate on 100/100 items, and robots.txt disallows only account and
admin paths. That is a real signal and it makes the comment's premise partly
stale - but it is not sufficient to re-enable on:

- A 200 from a residential IP says nothing about a datacentre IP. Railway
  egress is exactly what bot protection challenges, so the local result does
  not predict the production one. Testing that means probing their protection
  from the server, which is the thing we said we would not do.
- Whether a public feed is fetchable is a technical question; whether we should
  fetch this one is a risk question, and the standing order resolves ambiguity
  toward no legal or data risk.

So: unchanged. What changes is that the product no longer misrepresents it. A
deliberate non-fetch renders as "not connected" with the reason in the tooltip,
not as "0 jobs" under a heading that says Live - and not with the red dot that
means something broke, because nothing did.

Revisit only with a positive signal, not the absence of a negative one: WWR
publishing a supported API, or explicit permission. Not "the feed responded".


## D20 — an index earns its place by appearing in a plan

Four indexes went onto jobs and job_matches on the reasoning that A7.17 had
made the index the universe. EXPLAIN ANALYZE on production disagreed:

    unfiltered feed  42.19ms  2 seq scans  indexes used: none
    24h filtered      1.47ms  1 seq scan   uses idx_jobs_active_posted

The unfiltered feed reads essentially every active row, so a sequential scan is
the correct plan and no index can improve it. The selective path is the one
A7.17 actually unlocked, and there the index is worth 28x. The other three were
speculation - jobs(source) cannot help a window that already sorts the full
scan, and both job_matches indexes lose to a hash join over a table the match
store caps at 500 rows.

Kept one, dropped three, including from databases that already created them.
This database has filled its volume once and taken production down with it, so
an index no plan names is not neutral, it is cost with no return.

The general rule: an index is justified by a plan that names it, not by an
argument about what the query looks like. /api/jobs/db-health prints the plan,
so the justification is checkable rather than remembered.

The wider lesson is about the instrument. Wall-clock p95 from curl could not
resolve this - p50 was 0.391s before and 0.405s after, and p95 moved in both
directions across runs, because round-trip and serialising twenty descriptions
dominate a 42ms query. Measuring the right quantity mattered more than
measuring carefully.


## D21 — suggest the filter it is reasonable to relax, not the one that recovers most

The empty-state diagnosis first ranked filters by how many results dropping
each one recovers. Production said, for figma + Past 24 hours:

    drop the keyword    -> 579
    drop the date       -> 11
    drop the 40% floor  -> 0

Largest recovery names the keyword. That is arithmetically correct and useless:
the user typed figma on purpose, and the advice reduces to "stop looking for
the job you want". The useful answer is the date - 11 figma roles exist outside
the window, and the user's intent survives.

So candidates carry a relax order: 1 for refinements the user is likely
indifferent to (score floor, date window), 2 for deliberate choices (facets,
location, employment type), 3 for the intent itself (the search term, the
company). Size only breaks ties inside a tier.

Found by running the feature against real data rather than the fixture written
for it - the fixture agreed with the wrong rule because its largest recovery
was also its first candidate.


## D22 — himalayas keeps its null posted_at; the product stops hiding the cost

A7.11 offered two routes: backfill the date from the original posting, or state
the exclusion in the UI. The first is closed on evidence.

Their pubDate is not a publish date. Fetched live, eight unrelated companies
came back with timestamps inside an 11-minute window on the day of the fetch -
it is their ingest clock, and the job's own page shows a "Posted on" date up to
two months earlier. Filling posted_at from it would fabricate freshness, which
is the exact thing the null exists to prevent, and D4's timing signal would
then be built on invented data.

The original posting page returns 403 to a plain server request. Getting past
that is circumventing bot protection - the line D19 already drew for We Work
Remotely, and it does not move because a different source is behind it.

So: state it. 4,685 rows (18.9% of the index, every row himalayas supplies)
have no publication date. A7.7's NULLS LAST is correct and was silently costing
a fifth of the product under "Newest first". The count is now reported and
shown, with the reason, and `datePosted=unknown` reaches them in one click.

Revisit if himalayas exposes a real publication date field. Not by parsing a
page that is telling us not to.


## D23 — WEAKENED: mobile is described, not linked

A7.25 asks for the mobile app to be surfaced on the site. There is no mobile
app. BACKLOG_MOBILE.md says so explicitly and names the consequence: surfacing
store links for one "would be a claim the product cannot keep".

The full-strength version of "surface the app" is a link to an app. Since that
link would be a lie, the closest full-strength version is to state the truth
plainly on the landing page - HirePilot runs in a mobile browser, the whole
product, nothing to install; submitting uses the Chrome extension, which is
desktop-only. A guard asserts no page links an App Store or Google Play URL, so
this cannot be quietly "fixed" later by adding a dead link.

WEAKENED: mobile surfaced as a capability statement rather than an app link.
Reversible the day an app exists, and the guard is what makes that day visible.


## D24 — prove the instrument on a known positive before trusting a negative

Standing rule, promoted from three separate incidents in one session:

  - A7.20's p95 "regression" (40s timeouts on the default feed) was the service
    restarting mid-deploy. Re-measured warm, p50 was unchanged.
  - A7.5's button sweep reported 84 dead controls. 83 were a detector that
    compared innerText length and the URL, which cannot see a drawer open or a
    page of twenty similar-length rows change.
  - The posting-link checker failed 8 of 20 URLs, all of them live - including
    a "404" that renders a real careers page in a browser.

In each case the tool reported absence and the absence was its own. So: a
checker that reports "dead", "unchanged", "failed" or "missing" must first be
shown to report the OPPOSITE on a case already known to work. Until it has
passed that, its negative result is not evidence of anything.

This is the mirror of "prove red before trusting green". Green needs a failing
case to prove the test can fail; a negative needs a passing case to prove the
instrument can see.

## D25 — a status code never retires a source or a posting

Hard constraint, not a caution.

himalayas, jobicy and remotive all answer a scripted client with 403 - a
bot-verification interstitial with the URL intact. doubling.io answers a
generic user agent with 404 and a browser with a real careers page. A naive
HTTP health check would read those as dead and deactivate over 5,200 live jobs
across three sources.

Therefore, for any source-health or link-health feature:

  - 403, 429 and any challenge response mean "cannot tell". Never "dead".
  - Only 404 or 410, confirmed from a real browser context, and seen on two
    separate days, may retire a posting.
  - Retiring sets is_active = false with a data_corrections record. Never a
    delete.
  - No source is ever auto-disabled on status code alone. Disabling a source is
    an operator decision, and D19's standard applies to re-enabling one.

## D26 — sweeps use an allowlist, because a denylist fails open

The A7.5 sweep excluded dangerous controls by pattern. Patterns are a denylist,
and a denylist fails open: the first pass did not yet exclude "save", so "Save
and continue this application" was clicked on the operator's live account.
Nothing was submitted - the product's own rule that an unanswered question
parks an application is what held - but the failure mode of a miss here is an
unrecoverable submission to a real employer.

So the rule inverts. On any account holding real data, a control is clicked
only if it is explicitly on a known-safe list. Anything unrecognised is
recorded as not-exercised, which is an honest gap rather than a silent risk.

Additionally, before any sweep: Auto-Pilot off server-side, or run against a
seeded account. The operator's account holds 6 approved applications queued
with Auto-Pilot on, which is exactly the state where a stray click costs
something that cannot be taken back.


## D27 — the tester-cohort submission configuration

Auto-Pilot stays ON and fully autonomous for 20-30 real testers. Real
applications reach real employers under testers' names. The full configuration,
so it can be audited rather than remembered:

  Adapters ....... Greenhouse only. Lever and Ashby stay commented out of
                   SUPPORTED_ATS; neither has run against a live form. Pinned.
  Daily cap ...... 5 per user per day, server-side, at the one transition to
                   'submitting'. Counts 'submitting' as well as 'submitted',
                   so parallel starts cannot all pass the check at once.
                   auto_apply_limit_per_day is user-settable and the operator
                   account sat at 50; the write path and the runner now clamp.
  Kill switch .... system_flags.submissions_halted, effective on the next
                   request, no deploy and no restart.
  Levers ......... (1) POST /api/apply/admin/halt with x-admin-secret, needs
                   ADMIN_HALT_SECRET in the environment.
                   (2) The same endpoint from the admin account (users.is_admin,
                   seeded to the lowest user id, which predates every tester).
                   (3) SUBMISSIONS_HALTED=1 in the environment.
  Fail mode ...... CLOSED. Unreadable flag halts submission; an admin lookup
                   that errors denies the caller.

WHY TWO LEVERS. ADMIN_HALT_SECRET could not be set from this machine - the
app's Railway project is not under the logged-in account, which lists only
hirepilot-site and regintel-ai. A kill switch nobody can pull is not a kill
switch, so the owner's account is a second, environment-free lever. The secret
path stays for when the login system is what has failed.

Granting is_admin to the lowest user id is a deliberate privilege decision:
the operator's own account, predating every tester, and no other account gains
anything.


## D28 — the plain-word set

Target user: one to fifteen years in, in India, self-taught through senior. The
product's internal vocabulary was on every screen and none of it is parseable
on first read. Destinations are unchanged; only the words are.

  Nav
    Auto Apply     -> Apply for me        says who does the work
    Apply Queue    -> Ready to send       says what state these are in
    Tracker        -> My applications     says whose they are
    Applications   -> Progress            the pipeline view, not the list
    Search Agents  -> Saved searches      a search that keeps running
    Analytics      -> How it is going     a question, not a discipline
    Network        -> People
  Unchanged, already plain: Dashboard, Jobs, Inbox, Resume, Profile, Settings.

  Score  A word before the number, never instead of it. "78%" is a
         measurement; "Strong match · 78%" is a judgement with its evidence
         attached. Bands: Strong 75+, Good 60+, Worth a try 45+, Long shot
         below. An UNSCORED job returns null, not "Long shot" - calling it a
         long shot would invent a judgement, the same defect as rendering a
         missing count as 0.

  Status Every line answers "what is happening, and is it on me?", because
         that is the only question a person has about an application.
         submitted/applied  -> "Waiting for the company"  (the user knows they
                               applied; what they want to know is whether
                               anyone has looked)
         approved           -> "Ready to send"
         needs_user         -> "Needs an answer from you"
         pending_review     -> "Waiting for you to check"
         failed             -> "Did not send" + "Nothing reached the employer"
         rejected           -> "No this time"

One definition each, in lib/scoreBands.js and lib/statusWords.js. Writing the
pipeline columns out a second time is exactly how the board and the status
dropdown came to disagree, which the guard caught.

D29 — The tailoring guard runs on every path that writes to a resume, not
      just the one it was built for.
      /api/resume/tailor called buildTailoredText and wrote the result out
      without ever calling verifyAdditions, while the document editor beside it
      did. That gap put "Additional relevant skills for this role: Marketing"
      into a real resume with no marketing in it. The rule is not "the guard
      exists" but "no writer bypasses it", so the check belongs at every write.
      A refused skill becomes needsConfirmation with a reason, never a silent
      addition and never a silent drop - consent is the missing step, not
      strictness. Rebuilt from the allowed set rather than filtered out of the
      finished text, so the sentence introducing the skills cannot outlive them.

D30 — A guard script that can corrupt what it guards is worse than no guard,
      so the audit is guarded in three places, not one.
      1. The audit records every case file before mutating and exits non-zero if
         any file does not come back, or if its journal survives. Catches the
         normal failure.
      2. tools/check-no-mutation-artifacts.js runs in CI, where a hard kill on
         the developer's machine cannot skip it. Catches what 1 misses.
      3. tools/ship.sh puts the gate and the push in ONE invocation. Two
         separate commands is how a red suite reached main twice; a gate that
         passed five minutes ago is not a gate.
      The marker list is not the mechanism, only the cheap part of it - it is
      necessarily incomplete, which is why layers 1 and 3 do not depend on it.
      Proved: the marker list gained a case only after a ternary pinned to a
      literal condition got past every other layer and silently disabled the
      dashboard's plan check.

D31 — A capability the plan refuses is never described as running.
      Enforcing the autoApply tier gate in the engine without teaching the
      preference path left the dashboard reading "Auto-Pilot Active" on a plan
      that would refuse every submission. The preference now 403s an enable the
      plan cannot honour, and the plan's answer travels with the profile as
      autoApplyIncluded so no surface has to infer it. Enforcement and the words
      describing it ship together or the product lies.

D32 — A guard that exists and is not invoked is indistinguishable from no
      guard, and the suite passes either way because it tests the function
      rather than the path.
      Three shipped like that: plans.can() with no caller at all, the
      untraceable_claim rule bypassed because POST /api/resume/tailor never
      called verifyAdditions, and resumeGuard.verify exported and invoked by
      nothing. Every one had green tests.
      Four things now hold the class shut:
      1. tools/guard-wiring.js enumerates every exported function that can
         refuse and reports who calls it, parsed rather than grepped. Two
         regex cuts of it reported the very defect it exists to find as WIRED -
         one counted jwt.verify as a call to resumeGuard.verify, the other
         counted an import statement as a use. --strict fails CI on any guard
         with no live caller.
      2. Every guard has a test that exercises the ENDPOINT with input it must
         refuse, plus the honest counterpart, because a guard that refuses
         everything passes every negative test.
      3. tools/prove-endpoint-guards-red.js re-runs that suite with each
         guard's CALL removed and requires it to go red. A test that survives
         the deletion proves only that the route replies.
      4. Both run in ship.sh and in CI.
      Found on the way, all three fixed: PUT /api/resume/:id/document saved
      req.body.doc verbatim with no guard on the path - the widest bypass in
      the product, since the editor writes through it on every save; that
      route's node walk never covered doc.meta, so a job title could be
      rewritten unchecked; and routes/matches.js imported calculateJobMatch
      and never called it.
      Untraceable content on the document path is marked pending, not refused.
      saveDoc regenerates the flat text with pending excluded, so nothing
      unverified can reach an employer while the user's own typing is never
      blocked. The criterion is that nothing unverified is SENT. meta has no
      pending flag, so an untraceable header reverts instead - the only other
      option there is publishing it.
      Two rules were retired rather than left: resumeGuard.verify is no longer
      exported (it is verifyAdditions' engine, not a guard of its own), and its
      no_deletion rule is gone - verifyAdditions passes an empty current text,
      so no diff could ever contain a removal and the rule had a green test
      over zero live executions. "Tailoring may only add" is asserted where it
      is observable, on the engine's output.

D33 — A rule is not proven by a passing test. It is proven by a test that
      fails when the rule is removed AND by evidence the rule is reachable
      from a live call path.
      Precedent: resumeGuard's no_deletion rule was structurally incapable of
      firing - verifyAdditions passes an empty current text, so no diff could
      ever contain a removal. Green test, zero live executions, for as long as
      it existed. Not a broken instrument: a wired guard with a dead rule.
      Swept every wired guard's branches for the same shape. Two more found,
      and both failed OPEN, which is why unreachable is not merely untidy:
        - plans.can() ended `return true` for any capability other than
          autoApply. No live caller passes anything else, so it never ran - but
          the first can(id, 'exportPdf') added without a TIERS entry would have
          granted it to every account while reading like an enforced gate. Now
          refuses and logs.
        - resumeGuard's `if (num && !corpus.numbers.has(num))` could not have a
          false `num`: reaching it means a digit matched, and neither the
          replace nor trimToken can remove every digit. Verified over every
          token the live path can produce from a 3-character alphabet - 2835
          digit-bearing tokens, zero empties. Had it ever been false it would
          have skipped the invented-number check, the one rule here that exists
          because a fabricated metric is the worst thing this product could
          write. Condition removed.
      CHECK constraints were the same story one layer down. Both application
      constraints were asserted by regexing migrations.js for the constraint
      text, which proves the statement is WRITTEN and cannot prove it RAN -
      runMigrations logs a failed statement and continues, so an ADD CONSTRAINT
      that threw is indistinguishable from one that worked, and the test is
      green either way. The indexes already had the second half: declared in a
      test, then read back from pg_indexes through /api/jobs/db-health. The
      constraints now get it too - db-health reports pg_constraint with each
      predicate, and the reporter is itself proved on a known negative.

D34 — A caller whose target is gone is the same defect as a rule nothing can
      reach, pointed the other way.
      "Download PDF" on the resume page called GET
      /api/resume/tailored/:id/pdf. That route was deleted in 5dddb82, which
      deliberately replaced server-side rendering with printing from the
      editor - but the two buttons calling it were never touched. They have
      returned 404 from that commit onward. Reproduced on production before
      changing anything. Nothing caught it because no suite on either side of
      the wire sees both: the backend suite does not know the frontend exists,
      and the frontend suite mocks fetch.
      tools/check-frontend-endpoints.js resolves what the backend mounts and
      serves, flattens path parameters, and fails on any /api call with no
      route behind it. Proved on the known positive by restoring the historical
      call. Its first cut resolved zero mounts - because app.use names a
      variable rather than an inline require - and reported all 90 calls as
      broken; it now refuses to report anything if it resolves no mounts at
      all, because a checker that flags everything is as useless as one that
      flags nothing and considerably more convincing.
      The buttons now download the tailored TEXT, which is what the product
      actually holds for that row, under that name. Not re-pointed at the
      editor: the editor prints the user's resume document and this is a
      tailored variant of it, so that would download something other than what
      the button says.

D35 — Pagination is a partition of ONE list, so nothing that varies per request
      may decide what is in that list.
      The diversity cap was `source_rank <= GREATEST(3, CEIL(page*limit/4))`,
      which gave page and limit a second job: deciding how many rows each
      source could contribute. Every page was an OFFSET into a differently
      capped list, and those lists are not nested at the front - a row entering
      as the cap widened was inserted ABOVE rows already shown, so the offset
      stepped past it. Six jobs on production were in a single page of 40 and
      in none of the four pages of 10.
      Diversity now runs once over a FIXED window and a page is a slice of it.
      The obvious quota - CEIL(limit/4) - was rejected on purpose: it would
      have made the canonical order depend on the caller's page size, so four
      pages of 10 and one page of 40 would again be different lists, each
      internally coherent and jointly wrong. The property only holds if the
      sequence does not know what the limit is.
      Past the window the feed is plain ranked order, so no row becomes
      unreachable, and ranking.sourceDiversified states which regime produced
      the page rather than leaving the client to infer it.
      Guarded on the property - pages 1..N at limit L equal page 1 at limit
      N*L, set and order - on the pure function AND through GET /api/jobs,
      because a property proved on a function says nothing about whether the
      route calls it. The slice happens AFTER on-demand scoring and the sort:
      diversifying before them meant the page was a slice of an order that was
      then rearranged underneath it.
      VERIFIED ON PRODUCTION with the check that found it: 40 ids each way,
      identical order, same set, 0 unreachable, 0 duplicates, and still no more
      than 3 of any source in a page of 10.
