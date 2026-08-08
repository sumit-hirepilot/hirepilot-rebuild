# HirePilot — project state

Written 2026-08-08 at the end of a long session, as a handover. Nothing here is
rounded up. Where something is unverified it says so, and where something is
half-done it says half-done.

**Live:** frontend `https://frontend-production-0d14b.up.railway.app`,
API `https://backend-production-e6a8.up.railway.app`.
**Code:** local `main` at `ccf768f`, clean tree, **32 commits ahead of
`origin/main` and never pushed**. Production runs from `railway up` out of the
working tree, not from GitHub. Losing this working copy loses the code.

---

## 1. STATE

### Verified working — checked on production, by using it

| Feature | How it was verified |
|---|---|
| Signup / login / JWT auth | Real signup returned a token; that token authenticated `/api/jobs/db-health`. |
| Job ingestion, 12 sources | A real boot ingested 17.5k jobs; per-source counts read off the log (remoteok 100, nofluffjobs 3,000, greenhouse 10,220, ashby 4,441, …). |
| Résumé upload + parse | The operator's real PDF: 10 skills, 6 roles extracted, letter-spaced headings and all. |
| Match scoring (D49 formula) | Re-scored 2,999 rows on the old production; mean 0.619 → 0.746. |
| Tailoring + the three honesty guards | Tailored against real Greenhouse postings; blocked skills land in `needsConfirmation`, not the document. |
| Company résumé versions (feature 8) | Saved against Adyen, replaced on second save, refused a pasted-JD with `company_unknown` — all on production. |
| Bulk answer paste (feature 9) | Pasted a 4-pair block in the real UI: 3 understood, the demographic question refused with its reason on screen. |
| Batch queue reporting (feature 6) | `preparationFailed` now rendered; busy state in the deployed bundle. |
| Apply pipeline up to submission | Queue → prepare → approve → start, against a real job. |
| Submission end to end | **WEAKENED — see below.** Against a controlled target, not a real employer. |
| Receipt frozen + immutable | Written, then `UPDATE` and `DELETE` both rejected by the trigger. |
| Kill switch | 429 halted / 200 resumed; 403 on wrong secret and on absent secret. |
| Lever + Ashby stay disabled | `automationSupported: false` for both; Greenhouse `true`. |
| No application reaches "applied" without evidence | 422, row `failed`, no `applied_at`, no receipt. |
| 9/9 schema claims | Read back from system catalogues on a database dropped to empty and re-migrated. |
| CORS allowlist | App origin gets the header; `https://evil.test` does not. |
| Memory budget | Boot peak 187–227 MB (limit 500), idle 120–194 MB (limit 300). |
| 1,000 concurrent | 3,000 requests, 3,000 ok, **zero failures**. |

Suites: **backend 576**, **frontend 307**. Ship gate stages 1–9 pass.

### Verified but WEAKENED

**Auto Apply end to end.** Proved against a controlled target
(`/ats-sandbox/greenhouse`) that replaces only the employer's form. The shipped
Greenhouse adapter, field resolver and runner all execute; the résumé arrives
byte-exact (sha256 matched); no demographic answer is sent.

What it does **not** prove, and cannot: that Greenhouse's **live markup still
matches the adapter's selectors**. The target is built to those selectors, so
it can never catch drift. MV3 service-worker orchestration, CAPTCHAs, login
walls and consent gates are also not exercised. Full delta in
`SUBMISSION_PROOF.md`.

### Built but NOT verified on production

- **Features 10–15 do not exist.** Salary/notice-period filters for India,
  rejection intelligence, recruiter email routing, extension improvements,
  referral finder, interview prep — none started.
- **Older features** (Inbox, Tracker, Networking, Analytics, Agents, Cover
  Letters, ATS Checker) exist in code and have tests, but I did not click
  through them on this production. They are *probably* fine and are *not*
  verified here.
- **The Chrome extension has never been loaded into a browser this session.**
  Its defaults were repointed at the new URLs and the code is unchanged
  otherwise, but nothing confirms it still connects.

---

## 2. BROKEN

### Known broken

Nothing is currently throwing on production. The health endpoint is green, the
suites pass and the gate passes. That is not the same as "nothing is broken" —
see *not verified* above.

### Fixed this session, listed because each was live for a long time

| Defect | Error | File |
|---|---|---|
| Submission receipt never written, on any environment | `column a.resume_id does not exist` | `backend/routes/apply.js` (freeze query) |
| `applications_applied_requires_submission` missing on a fresh DB | `column "is_manual" does not exist` | `backend/services/migrations.js` (statement order) |
| Tailoring wrote skills the user never claimed ("Marketing", "UI Design") | no error — silent | `backend/services/resumeGuard.js` |
| CORS allowlist shipped empty | no error — every browser call refused, curl fine | `backend/middleware/cors.js` + missing `FRONTEND_URL` |
| nofluffjobs 160 MB response took the process to 694 MB | no error — budget breach | `backend/services/apis/nofluffjobs.js` |
| nofluffjobs paging fix cut the source 3,054 → 20 jobs | no error — one log line | same file |
| 500s at 1,000 concurrent | `timeout exceeded when trying to connect` (pg-pool) | `backend/db.js`, pool was `max: 15` |
| Mobile header clipped the Auto-Pilot toggle off-screen | no error — `scrollWidth` read 375 | `frontend/styles/Dashboard.module.css` |
| `apply-parsed` reported "Profile updated" for a zero-row no-op | no error | `backend/routes/resume.js` |
| `preparationFailed` returned by API, read by nothing | no error | `frontend/pages/jobs.js` |
| `needsConfirmation` discarded by the Tailor tab | no error | `frontend/pages/resume.js` |

**The pattern in that table is the important part: nine of eleven produced no
error at all.**

### Operator dependencies (not code failures)

- **A5** — driving automation against a real employer's Greenhouse board. The
  My Greenhouse agreement restricts automated access and binds job seekers.
  Weakened by operator decision; the live-board run is still open.
- **Naukri / Instahyre / Wellfound / Cutshort** — cannot be integrated
  compliantly. Details in `BLOCKED.md`.
- **Old production** (`hirepilot-production-e70d…`) is on a Railway account
  this machine cannot reach. Its data was never migrated — closed by decision.

---

## 3. ARCHITECTURE

### Stack

- **Backend** Node 18 (Debian slim) + Express, `pg` against PostgreSQL 18.
- **Frontend** Next.js (pages router), CSS Modules, no UI framework.
- **Extension** Chrome MV3, unpacked, not in the Web Store.
- **Host** Railway, project `hirepilot`, one environment (`production`), three
  services: `backend`, `frontend`, `Postgres`.
- **Tests** Jest both sides. No E2E framework; verification is done by driving
  production.

### Folders

```
backend/
  index.js            boot: listen first, then migrations, then scheduler
  db.js               pg Pool. POOL_MAX=40 - sized against max_connections=100
  schema.sql          base tables, applied on every boot (idempotent)
  routes/             16 routers, all mounted under /api/*
  services/           39 modules; the business logic lives here, not in routes
  services/apis/      one client per job source, all via httpSource
  __tests__/          ~60 suites
frontend/
  pages/              route-per-file; dashboard pages need a token in localStorage
  components/         DashboardLayout owns the header and nav
  lib/apiBase.js      THE API origin. One place.
  styles/*.module.css
extension/
  background.js       MV3 service worker; apiBase + appBase defaults
  content/adapters/   greenhouse.js (enabled), lever.js, ashby.js (disabled)
tools/                the ship gate: 14 static checks + loadtest.py
```

### Key files and their job

| File | Job |
|---|---|
| `backend/services/migrations.js` | Every schema change, as an ordered idempotent statement list. Runs at boot, logs a failed statement and continues. |
| `backend/services/schemaClaims.js` | Nine claims about the database, each read back from a system catalogue, served by `/api/jobs/db-health`. This is how you know a migration RAN, not just that it is written. |
| `backend/services/resumeGuard.js` | The honesty guard. Nothing enters a résumé unless it traces to the user's own material. Skills trace as a whole phrase; prose word by word. |
| `backend/services/matchingEngine.js` | Scoring. Weights skills .40 / experience .30 / location .20 / salary .10. Skills = `matched / max(jobSkills, 4)` (D49). |
| `backend/routes/apply.js` | The submission pipeline, the ATS whitelist, the kill switch, and the receipt freeze. |
| `backend/services/apis/httpSource.js` | Every source fetch, size-bounded at 40 MB (D55). |
| `backend/services/ingestYield.js` | Per-source yield vs the median of its last five runs (D54). |
| `backend/services/memlog.js` | RSS at named boot/ingest phases. This is what located the 694 MB spike. |
| `frontend/lib/apiBase.js` | The API origin. A production build with no `NEXT_PUBLIC_API_URL` FAILS rather than guessing. |
| `tools/ship.sh` | The only supported way to push. 11 stages, push physically unreachable unless all pass. |

### Data model (the parts that carry guarantees)

- `jobs` — the shared index. `is_active=false` keeps a user's linked job out of
  everyone else's feed.
- `job_matches` — scores, stamped `scored_formula` so a re-score is resumable.
- `applications` — the queue and its state machine. Two CHECK constraints stop
  `status='applied'` without evidence.
- `submission_receipts` — a frozen copy of what was sent, taken at submit time.
  An `UPDATE`/`DELETE` trigger makes it append-only. **This is the record behind
  "applied means the employer confirmed it".**
- `company_resume_versions` — feature 8; a reference to a `tailored_resumes`
  row, never a copy of the text (the 500 MB volume filled once already).
- `screening_answers` — the answer bank. Never holds a demographic answer.

### Auth

JWT in `localStorage`, sent as `Authorization: Bearer`. No cookies, so no CSRF
surface; that is also why CORS is defence-in-depth rather than an incident fix.
`verifyToken` is applied router-wide, not per-route.

### Why the major decisions were made

- **Scoring denominator is the POSTING's requirement count** (D49). The old
  `matched / userSkills.length` meant adding a real skill *lowered* your score
  on every job that did not mention it. Measured: of 74 missing skills exactly
  one helped. The product rewarded telling it less about yourself.
- **Only verified ATS adapters may submit.** An application cannot be unsent.
  Lever and Ashby were in the whitelist having never run against a live form.
- **Receipts are append-only.** `screening_answers` on the application row is
  *current* state and gets rewritten; a screen rendering it as "what was sent"
  asserts something it cannot know.
- **Sources stream, they do not accumulate.** Cost scales with the source, not
  with usage, so it only ever gets worse.
- **Absence is passed through as absence.** `company_name`, `posted_at` and
  `score` are `null` with a boolean beside them, never guessed. Inventing an
  employer is fabricated data on a live surface.

---

## 4. DEAD ENDS

The most useful section. Everything here was tried and did not work — do not
re-run these.

### Infrastructure and access

1. **Migrating the old database.** Its `DATABASE_URL` lives only in a Railway
   project under `sumit.designwork@gmail.com`. Checked four ways: `railway
   whoami` and `railway list` (wrong account), `railway link -p <old-project-id>`
   (refused outright), the browser session (one account, no switcher), and the
   filesystem (no `.env` anywhere, only `localhost` in shell history). The
   running API correctly leaks no environment. **Closed by operator decision.**
2. **Railway GitHub App.** Installed on GitHub user `sumituxai-netizen`; the repo
   belongs to `sumit-hirepilot`. The repo will never appear in Railway's picker
   no matter how many times you press Refresh. `railway up` from the working
   tree is what is actually deploying.
3. **Scraping the old API to recover data.** `/api/jobs` is public and would
   yield the job corpus, but paging is capped at 5,000 rows and the corpus is
   the *replaceable* half — the profile, résumés and applications need auth.
   Rejected: hundreds of requests at a trial-tier instance to recover what the
   new instance re-aggregates anyway.

### Memory

4. **"The ingest is concurrent."** GOAL 1d had already made sources sequential.
   Dead lead.
5. **"It's the search-agent scan."** That query *is* unbounded and was fixed,
   but it cannot have caused the observed spike: the environment has **zero
   active agents**. Dead lead.
6. **"The container is being replaced under load."** RSS dropping 246 → 143 MB
   between load steps looked exactly like a restart. Uptime spanned the whole
   window and the log holds one `Starting Container`, from boot. It was V8
   releasing after the burst. Dead lead.
7. **Bounding nofluffjobs by refusing the big response.** Would have removed the
   source entirely (160 MB is its normal size). Paging was the answer.
8. **Paging nofluffjobs on `offset=`.** The API ignores it — every request
   returns the identical first page. This shipped, read the same 200 postings
   forty times, and cut the source from 3,054 jobs to 20 **while every memory
   number improved**. `page=` works; `limit=` is the count of *unique jobs*, not
   rows.

### Load

9. **"It's trial-tier variance."** It was `max: 15` on the connection pool
   against a database allowing 100. Every failure was one message:
   `timeout exceeded when trying to connect`.
10. **Load-testing without a valid token.** Two of three paths 401 and the
    failures get counted as timeouts instead of 500s. This is why the cause
    looked unknowable for three runs. **An unauthenticated load test measures
    something else.**
11. **Raising the pool acquire timeout to clear the bar.** Rejected: it turns a
    fast honest 500 into every user waiting 20 s, and makes the number look met
    without adding capacity.

### Guards that did not guard

12. **A guard in `frontend/lib/apiBase.js` for a missing API URL.** Unreachable
    — `next.config.js` fills the variable in via its `env` block, so it is never
    empty by the time that module reads it. The check has to be in the config.
13. **`check-failure-fields-are-read.js`, first three versions.** Passed while
    the defect was reverted, three times: the corpus included `__tests__` (a test
    naming a field counted as reading it), then comments in the frontend (my own
    comment counted), then comments in the routes (prose matched `dropped:` and
    it *invented* a finding). Only the fourth version caught the real defect.
14. **`check-swallowed-writes.js` alone.** Would not have caught the receipt
    defect, because that catch *did* surface its failure into a field — that
    nobody asserted. Hence the second pass.
15. **The header fix, first attempt.** Two of three rules silently did nothing:
    a media query adds no specificity, and `.extensionCta` / `.creditsPill` are
    defined *later* in the sheet. Overrides must come after the rules they
    override.
16. **D55's own size guard.** `Buffer.byteLength(JSON.stringify(data))` to
    measure a response allocates a second copy of it. Cost 112 MB of peak the
    day it shipped — a guard against memory growth that caused memory growth.

### Test mistakes worth not repeating

17. **A colour assertion matching `/red/i` over a character window** — fired on
    "tailo**red**" in a comment.
18. **Mocking `axios` after the clients moved to `httpSource`** — two suites
    broke, correctly. Mock what the code talks to.
19. **Expecting the wrong median** twice, and blaming the code both times. The
    median of `[3040, 3048, 3054, 3055, 3061]` is 3054.
20. **A fixture using `id: 0`**, which the code correctly drops as falsy.

---

## 5. NEXT

**The single smallest thing that moves this forward: push the 32 local commits
somewhere they survive this machine.**

Production is running code that exists in exactly one place — this working
tree. `origin/main` is 32 commits behind and Railway is not connected to it.
A disk failure loses every fix in section 2.

Concretely, either:

- install the Railway GitHub App on the `sumit-hirepilot` account and
  `git push`, which also restores push-to-deploy; **or**
- `git push` to the existing remote purely as a backup, accepting that it will
  not redeploy anything.

Do this before feature 10. Everything else in the queue is additive; this is
the only item that is currently a single point of failure.

---

## 6. STEP-1 VERIFICATION 2026-08-08 (autonomous session) — the seven unverified surfaces

Method: authenticated API calls against the new production
(`backend-production-e6a8`) as a real seeded user
(`autonomy-verify-2026-08-08@hirepilot.local`, user 3: real resume text,
11 skills, 6 roles, 500 scored matches). Every verdict names the observation.

### Verified working, with the observation

| Surface | Evidence |
|---|---|
| **Networking** | `/suggest` → 3 LinkedIn searches, `areIdentifiedPeople:false`; contact created (id 1) and listed; `/outreach` → 3 drafts + lookup counter 1/15; draft saved (id 1), listed, marked sent with timestamp. Full loop exercised. |
| **Agents** | preview `{"estimate":258}`; agent created (`auto_apply:false`); run → `jobsScanned:284, newMatches:284`; matches ranked 0.91 down with scores attached; list shows `match_count:284, applied_count:0`. |
| **Cover Letters** | Generated against job 17518 (Staff Web Designer @ Harvey): honest mail-merge from real profile skills, persisted (id 7), listed. No invented employers/dates. |
| **Inbox — read paths** | GET → messages [], counts {}, proxy address generated; `/otp/latest` → `{"otp":null}`. Correct empty states. |
| **Tracker — read paths** | Board renders 5 empty columns; export.csv correct quoted header; sweep-ghosted `{moved:0}`; stage-move on missing row → 404. |
| **Analytics — mechanics** | 14-day series filled, totals all real zeros for an account with zero applications. Shape correct. |
| **ATS Checker — mechanics** | Real JD (4,001 chars) vs real resume → score 15, matched/missing lists, 3-item structured guide. Responds correctly. |

### BROKEN, with symptom and files

1. **Tracker manual add + CSV import — 500 on production.**
   `POST /api/tracker/manual` → `{"error":"Could not add that application"}`;
   Railway log: `null value in column "external_id" of relation "jobs"
   violates not-null constraint`. `jobs.external_id` is NOT NULL in
   schema.sql; the old database predated the constraint so this worked there —
   the D50 family. Both INSERT INTO jobs sites in `backend/routes/tracker.js`
   supply no `external_id`. Same fix must also set `is_active=false`
   (mirroring `userLinkedJob.js`): today's inserts would drop personal tracker
   entries into the shared feed as active jobs.
2. **Progress board card moves — guaranteed constraint 500.**
   `frontend/pages/applications.js:213` calls
   `PUT /api/applications/:id/status`, which writes raw `status`
   (`phone_screen`, `technical_interview`, …). Both CHECK constraints are
   present on the live DB (read back from db-health):
   `applications_applied_at_requires_submitted` means ANY status other than
   `submitted` on a row with `applied_at` set is rejected — every manual and
   every auto-pilot row. And a draft with no `applied_at` CAN move to
   `phone_screen`, after which `backend/routes/analytics.js` counts it as a
   "response" for an application never sent. Status is an evidence claim;
   conversation progress is `tracker_stage` (tracker.js's own header says so).
   The route, the kanban GET, `/stats` and analytics all still read the old
   status vocabulary.
3. **Inbox inbound mail is unconfigured, and the API hides that.**
   `POST /api/inbox/inbound` → 503 (`INBOUND_MAIL_SECRET` unset). Yet
   GET /api/inbox mints and returns a proxy address
   (`hp-…@hirepilot-mail.com`) with no signal it is dead — mail sent there
   vanishes. The API must report `inboundConfigured:false` so the UI can say
   so. Setting up the mail domain/provider/secret is operator-only.
4. **ATS checker counts stopwords as keywords.** 253 "meaningful terms" from
   one JD included `why, how, gets, done, what, who, we'd, http`; the guide
   then advises adding them. STOPWORDS/BOILERPLATE sets are far too small,
   deflating every score and polluting the advice.

### BLOCKED-NEEDS-HUMAN

- **Inbox end-to-end delivery**: needs a real inbound-mail domain, a
  provider posting to `/api/inbox/inbound`, and `INBOUND_MAIL_SECRET` +
  `INBOUND_MAIL_DOMAIN` on the backend service. Code-side honesty fix is in
  scope; the mail infrastructure is not.
- **Render-side judgement of all seven pages** (layout, hydration, visual
  states) — server-side contracts verified above; the browser render was not
  judged in this pass.

## 7. STEP-2 FIXES — all four step-1 BROKEN findings, shipped and verified live 2026-08-08

| Fix | Live evidence (new production, observed) |
|---|---|
| Tracker manual add + import | `POST /tracker/manual` 201 (id 9, no URL; id 10 with URL); import 201; board shows 3; shared-feed search for the entries: 0 rows (no leak); `jobs.job_url` nullable claim read back from the live catalogue (10/10 schema claims). |
| Progress board | Kanban buckets by stage — the 3 submitted rows RENDER (before: nowhere); legacy `phone_screen` translates to stage `interviewing` with status untouched; draft move → 409 with reason; browser pass: stage columns render, moved row in "They replied — interviewing", zero console errors. |
| Inbox honesty | API reports `inboundConfigured:false`; page renders "Recruiter-mail forwarding is not connected yet…" with no dead proxy address and no delivery promise. |
| ATS checker | Same real JD: 253 → 179 keywords, zero junk terms in matched+missing (checked against the observed junk set). |
| Analytics/stats | `interviews:1`, `responses:1`, `responseRate:25`, `offers:0` after one stage move — derived from tracker_stage; `hired` gone from both payloads; Offers tile renders live. |

Suites at ship: backend 626, frontend 311, gate 11/11, deployed with
`railway up` (backend + frontend), new bundles verified by fetching the served
chunks and finding the new markers in the bytes.

Budgets (rule 10): idle RSS 184/300 ✓ · boot peak 243/500 ✓ · per-source
ingest counts unchanged (greenhouse ~10.2k, ashby ~4.4k, `errors: []`) ✓ ·
**1,000-concurrent ✗ — 71×500 twice; no capacity regression; operator lever;
see LOAD.md + BLOCKED.md.** 500 concurrent clean.

Follow-up filed, not fixed here: the dashboard labels `total_applications`
(which includes drafts) as applications sent; and `GET /api/applications`'s
`total` counts every row while the page renders a subset.

### Incident 2026-08-08 — feature 10's first deploy degraded the feed under load

The joiner-snippet CASE ran inside the full-scan feed CTE: two description
regexes × ~18k rows × every request. Single requests looked fine (~0.4 s);
under 50 concurrent the API returned 500s and walls went 2.6 s → 28.6 s. Live
roughly 30 minutes, caught by the rule-10 load run, fixed by moving the
snippet to an id-bounded per-page query and caching the two new facet counts.
Regression pinned by test (the ranked CTE must never carry the snippet).
Lesson recorded: a per-row expression added to a full-scan CTE is a cost on
EVERY request, and single-request probes cannot see it - only the
concurrency budget could, which is the reason it runs on every deploy.

## 8. FEATURE 10 — India salary and notice-period filters  [shipped + VERIFIED live 2026-08-08]

- **Salary in lakhs.** `?salaryInr=` bands (Under ₹10L / 10–25 / 25–50 / ₹50L+)
  through the same conversion chain as the USD bands. Live facet counts:
  137 / 322 / 991 / 2,005. Undisclosed pay is never swept into a band.
- **Immediate joiner, in the employer's own words.** Jobs carry no
  notice-period field and inventing one would be fabricated data; the filter
  matches only explicit asks and every matching row carries the posting's own
  sentence (`joinerNote`). Live: 10 matching jobs; browser-verified end to
  end — chip → "10 results" → "Training Lead - Biology @ Khanacademy,
  Vijayawada · Asks for a quick start: 'Immediate Start'". Zero console
  errors on a fresh tab.
- Suites: backend 633, frontend 314. Gate 11/11 twice (the second after the
  bounds checker caught an unbounded `joiner` param — the guard worked).
- **Incident during this feature** (section 7 above): the first deploy ran
  the snippet regex over every row of the feed CTE; caught by the rule-10
  load run, fixed to an id-bounded per-page query, and the post-fix budget
  run passed 3,000/3,000 at 1,000 concurrent — the load bar is currently MET.

**Ingest note (rule 10, "unchanged or explained"):** greenhouse fell
~10.2k → 9,275 this cycle. Explained: the Discord board's response crossed
the 40 MB bound and httpSource refused it (log: "greenhouse: response
exceeded 40MB… needs paging, not a bigger buffer"). Follow-up filed: page
the Greenhouse boards fetch per D55's own instruction; until then Discord's
~900 postings are absent and the sources panel reports it honestly.

## 9. FEATURE 11 — rejection intelligence  [shipped + VERIFIED live 2026-08-08]

`GET /api/analytics/rejections` + a patterns section on Analytics. Conversion
by source, seniority band (shared definition, moved to
services/experienceBands so a service never requires a route file), and
match-score band — over recorded outcomes only (interviewing/offer = reply,
both rejection paths, ghosted separate, pending visible).

The 15-application floor, verified live in BOTH directions on production:
- 3 sent → `sufficient:false, sentTotal:3, needed:15`, every grouping null;
  the page renders the honest floor sentence.
- After a 12-row CSV import (exercising the fixed tracker import at volume):
  `sufficient:true`, source `manual` n=15 rate **27%** (4 replied / 3 no /
  1 quiet / 7 waiting rendered on the page), and every thin group (senior
  n=6, staff n=6, mid n=3) withholds its rate as "not enough data (n)" —
  null, never a fabricated 0%.
- Score bands say in the payload AND on the page that they use today's
  calculation — score-at-apply was never instrumented (D1 debt, restated).

Tests: 7 service (fabricated-zero mutation proven to bite), 2 route, 2 page;
the one-definition experience guard was found VACUOUS after the move (its
slice marker vanished) — rewritten to sweep both files and mutation-proven.
Suites: backend 642, frontend 316. Gate 11/11.

## 10. FEATURE 12 — recruiter email routing  [shipped 2026-08-08; live wire is operator work]

The matcher links a message to an application only on UNIQUE evidence — the
normalised company name equals the sender's org token, or the job's own URLs
live on the sender's registrable domain (two-label public suffixes handled).
Anything else waits in a review state; the user says which application the
mail is about, and only that confirmation runs the stage rule (which is now
the same on-board rule the tracker uses, manual rows included). The old
matcher linked on substring containment — mail from meta.com filed under
Metabase, stage moved on the wrong application — and that exact case is
pinned red-proven in the suite.

Verified live within what the environment allows: GET /api/inbox reports
`needsReview:0` and `inboundConfigured:false`; POST /:id/link exists and
scopes (404 for a foreign message); /inbound answers its honest 503 until the
operator connects mail (BLOCKED.md — secret + provider or Gmail OAuth
credentials; no code can conjure them). Routing behaviour itself is pinned by
8 route-level tests plus 2 page tests (review banner + link call).
Suites: backend 650, frontend 318. Gate 11/11.

## 11. FEATURE 13 — extension: one-click capture from any posting  [shipped + VERIFIED 2026-08-08]

`HP_CAPTURE_TAB` in the background worker: active tab's URL → the SAME
`POST /api/jobs/from-url` the paste box uses (server owns fetch, extraction,
refusal wording, rate limit), popup renders exactly what the server said —
the added job with its score / "not scored yet" (never 0%), "already in your
list", or the refusal in the server's own words with a link to the app's
paste box. Non-web tabs and signed-out states refuse locally without a
server call.

Verified: 4 tests drive the REAL background.js through a stubbed chrome
(the extension cannot be loaded into a browser here); the served
hirepilot-extension.zip was fetched from production and its bytes carry
HP_CAPTURE_TAB + the popup wiring; and the exact server call was probed live
in both directions — a real Greenhouse posting captured and scored 0.91 with
its breakdown, and a real Ashby posting refused with the server's own
sentence ("larger than 2 MB"), which is the sentence the popup shows.

Also closed: `extension/test/` had existed for months with NO runner
executing it — a suite that never runs reads as safety. It is a jest suite
under the backend runner now (cases unchanged, 16 of them, all green).
Suites: backend 670, frontend 318. Gate 11/11.

Follow-up filed: from-url refuses Ashby postings whose public page exceeds
2 MB even though the Ashby API path could serve them — the Harvey posting
that produced the refusal is the repro.

## 12. FEATURE 14 — referral finder  [shipped + VERIFIED live 2026-08-08]

`GET /api/network/referral-path/:jobId` + a "Find a referral" section in the
job drawer. Three honest ingredients only: the user's OWN tracked contacts at
that company (matched by exact normalised equality — "Adyen B.V." is the
user's judgement, not the code's substring), the addresses the posting itself
publishes (extractContactEmails moved to services/referralPath, one
definition, jobs.js imports it), and the three LinkedIn searches. Unstated
company → no searches, with the reason. `areIdentifiedPeople:false` travels
in every payload.

Live: real Adyen job 3867 → the account's real tracked contact surfaced,
3 LinkedIn search URLs built, no invented person anywhere. 8 backend tests
(service + route) and 2 drawer tests, red-proven. Suites: backend 678,
frontend 320. Gate 11/11.

## 13. FEATURE 15 — interview prep  [shipped + VERIFIED live 2026-08-08]

`GET /api/applications/:id/interview-prep` + a prep panel on interviewing
cards. No LLM is configured, so nothing invents a "likely question": every
item is a skill the posting itself names, quoted in the posting's own
sentence, marked strength or gap against the user's recorded skills. Thin
JDs say "nothing honest to prepare from"; drafts 409 (no interview exists).

Live, all three directions: real Chime Product Designer row →
`sufficientJd:true`, strengths Figma / Design Systems / Prototyping with the
posting's own bullet quoted ("Deep expertise with Figma and modern
prototyping tools…"); manual jobless row → the honest insufficient state;
draft → 409. Gap computation mutation-proven. Frontend bundle serving the
panel confirmed from the served bytes.
Suites: backend 685, frontend 321. Gate 11/11.

Found while verifying: the tracker's reuse-lookup missed on "Chime
Financial, Inc" vs the stored "Chime", so a duplicate jobless manual row was
created (row 25) — matching is exact-equality by design, but from-url's
response had shown a different company string for the same employer.
Follow-up filed: company display strings differ between the from-url
response and the stored row; worth one canonical reading.

---

## 14. SESSION CLOSE 2026-08-08 (autonomous run) — queue state

Every queue item closed. Step 1 verified seven surfaces server-side against
the new production as a real seeded user; step 2 fixed all four BROKEN
findings and deployed them; features 10–15 all shipped, each with tests
proved red first, its own commits, the 11-stage gate, deploys via
`railway up`, and live verification recorded per feature above.

Final state: suites backend 685 / frontend 321, all green. Final budgets:
idle 129/300 MB, boot peak 205/500 MB, 1,000 concurrent 3,000/3,000 ok,
per-source ingest counts unchanged since the explained greenhouse-discord
drop. Branch `backup/pre-reset-2026-08-08` carries everything; origin/main
untouched by instruction.

Still operator-only (BLOCKED.md): inbound-mail secret + provider (or Gmail
OAuth credentials) to put feature 12's wire live; the A5 live-board
Greenhouse run; Naukri/Instahyre partnerships; the D49 formula re-score is
running (announced in the UI); the second-replica / load-bar policy decision.
The verification account `autonomy-verify-2026-08-08@hirepilot.local`
(user 3) holds the session's test rows and is labelled as such — left in
place as the evidence behind this document.
