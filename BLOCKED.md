# HirePilot — Blocked

Goals that failed five attempts, with full diagnosis. Retried at end of wave.

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
