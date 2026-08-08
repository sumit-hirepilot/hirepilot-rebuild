# HirePilot — Blocked

Goals that failed five attempts, with full diagnosis. Retried at end of wave.


## OPERATOR DECISION — the skills-score denominator (D49)

**Not blocked on code. Blocked on a decision only the operator can make**,
because the number is on every job card and in every breakdown a user has
already seen.

Measured on 220 live jobs against the real account:

- Adding a **genuine** skill lowers the match score on every job that does not
  mention it. SQL: −0.019. Wireframing: −0.021. Accessibility: −0.023.
- Of **74** skills this user lacks, exactly **1** would raise her score, and it
  is "marketing" — for a product designer.
- Deleting six of her eleven real skills raises her scores. Keeping only
  "Leadership" and removing the other ten is **+166%**.
- 219 of 220 jobs score between 50% and 69% overall. The score barely
  discriminates.

The full analysis, the three options and their consequences are in DECISIONS.md
as **D49**. The recommendation is option B (`matched/jobRequiredSkills`) with a
denominator floor and a one-pass re-score that is announced in the UI.

**What the operator needs to decide:** whether every existing score may move.
That is the whole cost, and it is not a technical question. Until then the
formula is unchanged and feature 5 keeps reporting the negative results
honestly.

## The app's Railway project is not reachable from this machine — and this is
## now the blocker on diagnosing five outages

CHECKED TWO WAYS, today, rather than assumed:
 - `railway whoami` -> logged in as Sumit uxui (sumituxi@gmail.com).
 - `railway list` and the railway.com dashboard both show exactly two projects:
   hirepilot-site and regintel-ai. One workspace, no others in the switcher.

The app is neither of them. hirepilot-site is the marketing site; the running
API (hirepilot-production-e70d) and web (hirepilot-rebuild-production) services
belong to a project under a DIFFERENT Railway account. So the memory graph, the
container exit codes and the service settings cannot be read or changed from
here, by CLI or by browser.

NEW OBSERVATION, and it may matter more than the memory hypothesis: the
sumituxi account is on a "Limited Trial - 23 days or $4.54 left. Upgrade to
keep your services online." If the account hosting the APP is also on a trial
or out of credit, Railway suspends the service - and suspension fits the
evidence BETTER than an OOM kill does:
 - no crash record, ever, across five outages (a stopped container never
   crashes, so there is nothing to record)
 - the watchdog never fires (it exits a wedged process; it cannot act on a
   container the platform has stopped)
 - recovery ONLY on redeploy, every single time (a deploy restarts the
   container)
 - and it explains why removing a real unbounded memory load changed nothing.
This is a hypothesis, not a finding. It is cheap to check and should be checked
FIRST, before more memory work.

WHAT THE OPERATOR NEEDS TO DO, in this order:
 1. Sign in to the Railway account that owns the HirePilot app project. Check
    the plan and remaining credit on that account first.
 2. Backend service -> Metrics -> memory graph across the outage windows. A
    line that climbs then drops to zero is an OOM; a flat line that simply
    stops is a suspension or a stop.
 3. Deployments -> open a crashed one -> exit code. 137 or OOMKilled confirms
    memory. A stop or suspension will not show 137.
 4. Only if it is memory: Settings -> raise the limit temporarily so RSS can be
    watched climbing instead of the container dying.
 5. Do NOT delete deploy history, logs or metrics. They are the only record of
    the five outages.

## C1 (Naukri) and C2 (Instahyre / Wellfound / Cutshort) — A7.19 assessment,
## measured today. C1 FAILS on permission.

A7.19 requires, before any source is integrated: live, not a duplicate, a
MACHINE-READABLE PERMISSION SIGNAL (a 200 is not permission), not paywalled,
posted_at present per row and genuinely a publication date rather than a
re-sync timestamp, and an employer job board rather than a freelance bidding
marketplace.

| source | robots.txt | permission signal | verdict |
|---|---|---|---|
| Naukri | **403 Access Denied** (Akamai edge) | cannot even READ the permission file | **FAIL — do not integrate** |
| Instahyre | 200, `User-agent: *`, no Disallow | permissive file, but the SERVER 403s every page | **FAIL — resolved by 4b, see below** |
| Wellfound | 200 | Disallows `/_jobs/` and every `?jobId=` / `?jobSlug=` / `?role=` pattern | **FAIL for job pages** |
| Cutshort | 200 | Disallows `/view/j/`, `/vj/`, `/*?job_listing` — the job views themselves | **FAIL for job pages** |

### 4b — the Instahyre "conditional" is resolved: FAIL, do not integrate

A7.19 left this conditional because only `sitemap.xml` had been tested. 4b
tested the pages themselves, and from the egress that matters.

| probe | result |
|---|---|
| `robots.txt` | 200, `User-agent: *`, **no Disallow lines at all** |
| `sitemap.xml` — the file robots.txt itself advertises to crawlers | **403** |
| `/search-jobs/` — the listing page | **403** |
| a job URL, from **Railway egress**, through the shipped 4a path | **403**, `blocked_by_site` |

Every 403 is a Cloudflare interstitial: `<title>Just a moment...</title>`,
`noindex,nofollow`, a JS challenge. The mechanism is named rather than guessed.

**The permissive robots.txt is not permission.** It is the clearest case yet of
the rule A5 wrote for Greenhouse: a status code is not permission, and here
even the permission FILE says yes while the server says no on every path
including the one that file points crawlers at. The server's behaviour is the
answer.

D19's open question is also closed. It said a 200 from a residential IP says
nothing about a datacentre IP, and that testing it would mean probing their
protection from the server. That did not have to be a special probe in the
end: 4a's user path makes exactly one plain request, and it returns 403 from
Railway. Residential and datacentre agree.

**The coverage questions cannot be answered, and that IS the answer.** How many
jobs, which roles, what seniority range, and whether `posted_at` is a real
publication date or a re-sync clock are all unmeasurable without getting past
the challenge — and getting past it is the thing D19 said we would not do. So
there is no number to report, and no honest way to obtain one.

**The need is already met.** 4a routes an Instahyre link to a refusal that
names Instahyre, explains it, and opens the paste box — which produces an
identical tailored resume, score and queue entry. Coverage of Instahyre comes
from the user pasting one job they are looking at, which is not a crawl and
raises no ToS question at all.

Reopening this needs an operator decision, not a code change: an official
Instahyre partner/API programme, or written permission. Same shape as Naukri.

NAUKRI IS THE WEDGE AND IT IS BLOCKED. The site returns 403 to a plain
robots.txt fetch, which is an active edge block on non-browser clients.
Integrating it would mean evading that block. That is the Greenhouse-ToS
discipline exactly: a status code is not permission, and a block is a refusal.
Naukri has no public jobs API. The only compliant routes are a commercial data
agreement with Naukri (Info Edge) or an official partner/API programme —
both operator decisions, neither a code change.

WELLFOUND and CUTSHORT both disallow the job-detail paths specifically. Their
listing pages are not disallowed, but a source that cannot legally fetch the
job page cannot supply a JD, and a JD is what scoring and tailoring need.

INSTAHYRE is the only one of the four with a permissive robots.txt. Its
sitemap 403s, so the next step is to establish whether job pages are reachable
with a declared bot UA and whether posted_at is a real publication date - not
to start writing an adapter.

WHAT THIS MEANS FOR THE FEATURE QUEUE: feature 1 is C1 + C1a + C1b. C1 is
blocked on an operator decision. C1a and C1b (the guided onboarding
interaction layer and momentum/recovery) are NOT blocked and do not depend on
Naukri - they are built against the existing index. Proceed with those.

## Railway healthcheckPath — operator action

The API has gone down three times and never restarted itself. c1cc33a adds a
watchdog that exits the process when it stops serving, which the platform does
restart - that is the part I can do from code.

What I cannot do from here: set a Railway healthcheckPath. Config-as-code lives
in a railway.json at the service root, and the frontend builds from the same
repo root, so adding one risked breaking the frontend deploy to fix the backend
- and I cannot see the service settings to check. The Dockerfile HEALTHCHECK
that already exists does nothing, because Railway ignores Docker health status.

What the operator should do: set healthcheckPath to /api/health on the API
service, and a restart policy of ON_FAILURE. Belt and braces with the watchdog,
and it covers the case where the process is alive but never reaches the
watchdog at all.

## RESOLVED 2026-08-07 — the submission halt is liftable again

Superseded by the account move. The halt could not be lifted because the admin
token had expired (`exp 2026-08-06T20:05:31Z`) and `ADMIN_HALT_SECRET` lived in
a Railway project this machine cannot reach.

On the new production the secret is ours, the lever is proved in both
directions, and the flag currently reads `halted: false`.

## Carried in from prior work (not yet counted against the 5-attempt rule)

### #44 — Checkr submit rejected, two different causes
`8088915` reports "Phone is required" and "Select a country". `8088900` reports
NO validation errors and no empty required fields, so it fails for a different
reason. The phone value survives the runner's exact fill path on all three
boards tested, so the original "blur clears it" hypothesis is disproven.

## Environment gotcha — never run `next build` while `next dev` is live
They share `frontend/.next`. A production build overwrites the dev server's
chunks and every route then 500s with
`Cannot find module './chunks/vendor-chunks/next.js'` - which looks exactly
like the page being broken. Cost a wrong diagnosis during A3. Stop the dev
server, or build, but not both at once.

## Environment gotcha — the API token does not survive a session boundary
Verifying production behaviour needs a bearer token, and the scratchpad copy is
gone on a cold start. ASSESS will hit this. Re-obtain with:

    curl -s -X POST -H 'Content-Type: application/json' \
      -d "{\"email\":\"$HP_EMAIL\",\"password\":\"$HP_PASSWORD\"}" \
      https://backend-production-e6a8.up.railway.app/api/auth/login

The password used to be written out in full on this line. A working credential
in a tracked file is a credential in the history of every clone, and this file
is the one place that says secrets do not belong in the repo. Export the two
variables in the shell instead.

Also: run jest from inside backend/ or frontend/. `npx --prefix backend jest`
silently produces no output rather than failing, which reads as a passing test
suite if you only grep the result.

## RESOLVED 2026-08-05 — A1's all-user audit ran without local DB access
Root cause of the block: the Railway CLI is authenticated as sumituxi@gmail.com,
which has ONE workspace, no teams, and one project (regintel-ai). HirePilot is
not in that account at all - confirmed against the Railway GraphQL API, not just
`railway list`. So `railway link` was never going to reach it, and the app
account is a different address (sumituxui@gmail.com).

Solved by routing the audit through the deployed backend, which already holds
DATABASE_URL: GET /api/applications/integrity. Aggregates are safe for any
authenticated caller; identities are gated on ADMIN_EMAILS.

The one thing still needing a human, and ONLY if the count ever goes non-zero:
    set ADMIN_EMAILS=sumituxui@gmail.com on the API service
It currently reports users_affected 0, so there is nobody to identify.

## A5 — WEAKENED 2026-08-07 by operator decision, still open for the live run

The Greenhouse User Agreement restricts using automated means to access the
Services, and it binds job seekers - the party HirePilot acts for. Whether that
reaches an employer's embedded job-boards.greenhouse.io form, and whether
user-initiated automation inside the user's own authenticated session is what
the clause means, remain legal questions.

**Operator decision:** prove the pipeline against a controlled target instead of
a real employer, and record the delta. Done - SUBMISSION_PROOF.md.

What that leaves open, and it is the only thing:

- **selector drift on the live boards.** The target is built to the adapter's
  own selectors, so it can never catch the adapter going stale against real
  Greenhouse markup. Only a run against a live board closes this.

Holding pattern otherwise unchanged: Lever and Ashby stay disabled and their
terms remain unread. `ATS_SANDBOX_ENABLED` gates the controlled target; unset,
it is not driveable and reports automationSupported false.

## RESOLVED 2026-08-07 — ADMIN_HALT_SECRET, by moving accounts

It could not be set on the old project because that project belongs to another
Railway account. On the new one it was set when the backend service was
created, so the operator's lever exists again.

Proved on the running service in both directions, and both refusals: wrong
secret 403, absent secret 403, correct secret halts and reads back `true`,
correct secret resumes and reads back `false`. A switch flipped one way is not
a switch that works.

The value lives only in Railway's variable store for the `backend` service. Not
in this repo, not in a progress file, not in a commit.

## CLOSED 2026-08-07 — the migration, by operator decision

The new Railway account IS production now. The old database was never copied
and will not be: the operator abandoned the data migration rather than supply
the one credential it needed (`DATABASE_URL` for project `tranquil-solace`,
under a different Railway account).

That is a decision, not a blocker, so this stops being a BLOCKED entry. What
follows from it:

- The new database starts from its own aggregation. ~17k jobs and climbing from
  the same 12 sources; the corpus converges on a fresher equivalent of the old
  one rather than a copy of it.
- No user account, application, tailored resume or receipt carries over. There
  were 87 tailored resumes and 0 receipts on the old instance.
- The old project is untouched. Nothing was deleted there, and nothing needs to
  be.
- Every config, the Chrome extension, the marketing site and every tool now
  point at the new backend. MIGRATION.md records what moved and what did not.


## RESOLVED 2026-08-08 — 1,000 concurrent, zero failures (was: needs more than one replica)

The load bar is 1,000 concurrent with zero failures. At 1,000 the service now
returns 1–10 client timeouts per run (never a 5xx); 50, 200 and 500 are all
clean. Full evidence and the ruled-out causes are in LOAD.md.

Memory is not the constraint: idle 125–145 MB against a 300 MB budget, peak
220 MB against 500 MB.

Every request is served; the slowest cross the client's 20–30 s timeout while
queued behind 3,000 requests on **one** replica of a Limited Trial. All three
paths in the mix answer in ~0.35 s when idle, so this is queueing, not query
cost.

**What the operator decides:** whether to run more than one replica, which is a
plan and cost question. `railway scale <region>=N` is the mechanism.

**Updated once the cause was isolated.** The failures are not vague timeouts:
all 55 are `timeout exceeded when trying to connect` from pg-pool, one distinct
message in the whole log. The pool was `max: 15` against a database allowing
100; raising it to 40 halved the wall time (46.8s -> 21.6s) and removed the
client timeouts. What is left is arithmetic - ~40 database slots at ~0.3s a
request is ~133 req/s, and 3,000 requests need ~22s to drain, so the tail waits
past the 10s acquire bound.

The acquire bound is deliberately NOT being raised to clear the bar: that would
make every user wait 20s instead of failing fast, and would make the number
look met without adding capacity.

**RESOLVED.** Raising the pool from 15 to 40 - against a database that allows
100 - took the failures to zero at 1,000 concurrent: 3,000 requests, 3,000 ok,
idle 189MB, peak 227MB. No replica was added. The failing runs stay recorded in
LOAD.md as they happened; the passing run is appended, not substituted.

A second replica is still the lever if throughput must rise further, and the
pool was sized so two of them fit under max_connections.

Work continues meanwhile — this does not block the feature queue.

## OPERATOR DECISION 2026-08-08 — the 1,000-concurrent bar needs a second replica or an accepted tolerance

Rule 10's "1,000 concurrent with zero failures" did not hold on two runs this
session: exactly 71 × 500 both times, one distinct error (`timeout exceeded
when trying to connect`, pg-pool). Full numbers and the analysis in LOAD.md.

Not a regression: idle path times equal the recorded pass's arithmetic, the
failing route is unmodified, and 500 concurrent is clean. The service performs
at exactly its documented ~133 req/s; whether the 3,000-request burst's tail
crosses the 10 s acquire bound depends on client arrival shape.

What only the operator can decide:
 1. `railway scale` to a second replica (cost; pool already sized so two fit
    under max_connections=100), or
 2. accept that the one-replica bar is "500 clean, 1,000 best-effort" and
    restate rule 10, or
 3. commission real capacity work on the feed query (the only lever that adds
    capacity without cost).
Raising the acquire timeout stays rejected for the recorded reason.

## Feature 12 — the live mail wire is operator work; the routing logic is not

Recruiter-email routing shipped 2026-08-08: evidence-only matching (unique or
nothing), a review state for everything else, user-confirmed linking that then
advances the stage. All of it is exercisable only through POST
/api/inbox/inbound, which answers 503 until the operator provides:

 1. `INBOUND_MAIL_SECRET` on the backend service, and
 2. a mail provider (or Gmail OAuth app) actually posting inbound mail there —
    `INBOUND_MAIL_DOMAIN` plus MX/forwarding for it, or
    `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` + consent screen for
    the E1 Gmail read-only variant, which no code can conjure.

Until then the inbox states plainly that forwarding is not connected (shipped
in step 2), and the routing behaviour is pinned by 8 unit tests through the
real route including the meta.com-vs-Metabase case the old matcher got wrong.

## OPERATOR — one click left on the branch move: the GitHub default branch

The brief said `production` (formerly `backup/pre-reset-2026-08-08`) was made
the GitHub default. Checked against the remote, not assumed: `git ls-remote
--symref origin HEAD` still answers `refs/heads/main`, and no `production`
branch existed until this session created one. The rename did not happen (or
happened somewhere else).

Done from here over the git protocol: `production` created at `0a43987` (the
exact backup-branch tip), local trunk retargeted, ship.sh stage 11 refuses
any branch not tracking origin/production, and this machine's pre-push hook
refuses refs/heads/main outright — both refusals proven by firing them.

What only the operator can do (gh CLI is unauthenticated here, and repo
settings are not reachable over git):
 1. GitHub → sumit-hirepilot/hirepilot-rebuild → Settings → General →
    Default branch → switch to `production`.
 2. Optionally delete `backup/pre-reset-2026-08-08` (now a duplicate pointer
    to the same commit) — left in place from here, deleting refs is not an
    autonomous call.
Until 1 happens, fresh clones and PRs default to the frozen archive.

## RESOLVED 2026-08-08 — the 1,000-concurrent bar, by operator decision

Option 2 taken: "500 clean enforced, 1,000 measured and informational". No
second replica, acquire timeout unchanged. Encoded in CLAUDE.md rule 10 with
the reasoning, in LOAD.md, and in tools/loadtest.py itself, which now exits
non-zero only when a step at or under 500 users has failures. The 1,000 step
keeps running on every budget check so the trend stays visible.

## OPERATOR — inbox mail wire: exact setup, everything else is done

The code side is finished and proven against simulated Mailgun, Postmark and
SendGrid payloads (multipart, urlencoded and JSON all parse; provider retries
dedupe; unknown recipients answer 200 so the webhook never gets disabled;
the secret compares in constant time). What only you can do:

1. **Pick a domain** for proxy addresses (the code defaults to
   `hirepilot-mail.com`, which we do NOT own — if you buy a different one,
   also set `INBOUND_MAIL_DOMAIN=<your-domain>` on the **backend** service so
   minted addresses use it).
2. **Point the domain at a provider** (any of the three below), i.e. add the
   MX records the provider tells you to add for inbound mail.
3. **Set the shared secret** on the **backend** Railway service:
   `INBOUND_MAIL_SECRET=<long random string>` (e.g. `openssl rand -hex 32`).
   The moment it is set, GET /api/inbox flips `inboundConfigured:true` and
   the UI stops saying forwarding is not connected. No deploy needed beyond
   the variable change (Railway restarts the service).
4. **Configure the provider's inbound route** to POST every message to:
   `https://backend-production-e6a8.up.railway.app/api/inbox/inbound?token=<the same secret>`
   - Mailgun: Receiving → Routes → catch-all `.*@<domain>` → "forward" to the
     URL above (Mailgun cannot set custom headers; the `?token=` form exists
     for exactly this).
   - Postmark: Server → Inbound → webhook URL as above (JSON payloads —
     handled).
   - SendGrid: Settings → Inbound Parse → add host + URL as above.
5. **Send one real mail** to any user's proxy address (shown on /inbox) and
   confirm it appears there. Nothing else needs touching.
