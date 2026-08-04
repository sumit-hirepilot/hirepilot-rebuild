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
