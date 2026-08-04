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
