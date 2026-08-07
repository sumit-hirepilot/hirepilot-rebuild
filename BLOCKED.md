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

## LIVE PRODUCTION STATE — SUBMISSIONS ARE HALTED, and I cannot lift it

Confirmed on production today, not assumed: POST /api/apply/queue/<id>/start
returns 429 `{"reason":"halted"}`. The gate runs before the row is touched, so
the probe used an id that cannot exist and could not have submitted anything.

**Nothing can submit for any account until this is lifted.** It was set
deliberately, to walk a fresh account through signup without letting it apply
to a real employer. Lifting it needs a lever I do not have:

* `ADMIN_HALT_SECRET` is still unset on the API service (see below), so the
  `x-admin-secret` lever does not exist.
* The admin-account lever needs users.is_admin, seeded to the LOWEST user id.
  That is not the walkthrough account (id 5), and I do not have the id-1
  account's password.

What the operator should do, either one:

1. Sign in as the earliest-registered account and
   `POST /api/apply/admin/halt` with `{"halted": false}`.
2. Set `ADMIN_HALT_SECRET` on the API service, then the same call with an
   `x-admin-secret` header. This is worth doing anyway - it is the lever that
   works when the account system is the thing that is wrong.

Deliberately NOT fixed from here: the honest fix is an operator credential, and
any new way to switch a safety halt back on from code would be a second door
into the kill switch. A halt that is hard to lift is the correct failure
direction; the defect is that it has only one usable lever, which is exactly
what item 2 above fixes.

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
      -d '{"email":"sumituxui@gmail.com","password":"1_Railway"}' \
      https://hirepilot-production-e70d.up.railway.app/api/auth/login

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

## A5 — needs counsel before ANY further submission work (2026-08-05)
The one enabled adapter is Greenhouse. The My Greenhouse User Agreement
(fetched directly 2026-08-05) restricts using "automated means, including
spiders, robots, crawlers, or similar means or processes to access or use the
Services", and it binds job seekers - the party HirePilot acts for.

Not concluded here, deliberately. The determining questions are legal, not
engineering: whether that agreement reaches an employer's embedded
job-boards.greenhouse.io form where the candidate may have no My Greenhouse
account; and whether user-initiated automation inside the user's own
authenticated session, stopping at every login, CAPTCHA and consent, is what
the clause means.

§3's default table, read literally, says browser automation against a third
party's ATS is `deferred: ToS` - which points at disabling Greenhouse, i.e. the
product's core. That is the operator's call with advice, not an engineering
pass's.

Holding pattern in force: nothing new ships against any ATS; Lever and Ashby
stay disabled; Lever/Ashby terms unresearched and must be read before either is
re-enabled. Full findings in SUBMISSION_AUDIT.md.


## ADMIN_HALT_SECRET cannot be set from this machine — operator action

The kill switch has three levers. Two of them need an environment variable on
the API service (ADMIN_HALT_SECRET, or SUBMISSIONS_HALTED=1), and the app's
Railway project is not under the account this machine is logged into - `railway
list` shows only hirepilot-site and regintel-ai.

Owning goal: Item 0. Not stalling on it - the admin-account lever works today
and is proven on production, so the switch is usable.

What the operator should do: set ADMIN_HALT_SECRET on the API service. That
restores a lever that works even if the login system is the thing that has
failed, which is the scenario the account-based lever cannot cover.
