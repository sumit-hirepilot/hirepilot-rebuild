# PROGRESS

## Now

**D47 recorded and swept, and 4b assessed.** `fb2596f`. No feature code
shipped for 4b — the assessment is the deliverable, and it says do not build.

### D47 — a mock of the thing under test is not a test of it

4a's SSRF suite mocked `jobUrlFetch` and replaced `fetchJobUrl` with a bare
`jest.fn()`. Every private-address case then asserted a refusal produced by a
mock returning `undefined`. Green, and would have stayed green **with the SSRF
guard deleted**.

The fix is not to stop mocking — the seam is needed to inject a canned 403. The
fix is the *default*: delegate to `requireActual`, opt into a canned result per
test.

**Sweep: all 25 suites that mock a module they also use were read.** 23 mock
`../db`, which is what the code *talks to* — correct. `scoreOnDemand` and
`scoreOnRead` mock `matchingEngine` to assert a **route** called it — also
correct. One instance, already fixed. `tools/check-mock-boundaries.js` catches
the exact shape and is gate stage 8.

### 4b — Instahyre: assessed, not integrated

| probe | result |
|---|---|
| `robots.txt` | 200, `User-agent: *`, **no Disallow at all** |
| `sitemap.xml` — the file robots.txt advertises to crawlers | **403** |
| `/search-jobs/` | **403** |
| a job URL from **Railway egress**, via 4a's shipped path | **403** `blocked_by_site` |

Every 403 is a Cloudflare interstitial — "Just a moment…", `noindex,nofollow`,
JS challenge. Named, not guessed.

**A permissive robots.txt is not permission.** The permission *file* says yes
while the server says no on every path — including the one that file points
crawlers at. Where they disagree, the server's behaviour is the answer.

This closes D19's open question too. It said a residential 200 says nothing
about a datacentre IP, and that testing it meant probing their protection from
the server. No special probe was needed: 4a's user path makes exactly one plain
request and returns 403 from Railway.

**The coverage questions cannot be answered, and that is the answer.** Job
count, roles, seniority range, and whether `posted_at` is a publication date or
a re-sync clock are all unmeasurable without defeating the challenge — which
D19 forbids. No number to report, and no honest way to get one.

So the queue's premise, *"Instahyre — the only permissive Indian source"*, is
contradicted by the evidence, and A7.19's "conditional" is resolved to **FAIL**.
Checked rather than assumed: no product surface ever claimed Instahyre, so
nothing needed correcting.

**The need is already served** — 4a routes an Instahyre link to a refusal that
names the board and opens the paste box, reaching an identical tailored resume,
score and queue entry with no ToS exposure.

No load test: no runtime code changed. Suites: backend **381**, frontend
**255**.

## Next

**Feature 4b — Instahyre.** Assess coverage BEFORE integrating: how many jobs,
what roles, and whether `posted_at` is present and genuinely a publication date
rather than an ingest clock — the himalayas trap.

Then the full audit again, then 5, 6, 8, 9, 10, 11, 12, 13, 14, 15 with the
audit after every third feature.

Superseded: **Feature 3 — tailor resume with a pasted or selected JD.** Pasted text is
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
