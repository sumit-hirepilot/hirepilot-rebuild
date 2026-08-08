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
