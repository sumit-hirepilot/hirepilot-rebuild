# HirePilot — Blocked

Goals that failed five attempts, with full diagnosis. Retried at end of wave.

## Carried in from prior work (not yet counted against the 5-attempt rule)

### #44 — Checkr submit rejected, two different causes
`8088915` reports "Phone is required" and "Select a country". `8088900` reports
NO validation errors and no empty required fields, so it fails for a different
reason. The phone value survives the runner's exact fill path on all three
boards tested, so the original "blur clears it" hypothesis is disproven.

## Environment gotcha — the API token does not survive a session boundary
Verifying production behaviour needs a bearer token, and the scratchpad copy is
gone on a cold start. ASSESS will hit this. Re-obtain with:

    curl -s -X POST -H 'Content-Type: application/json' \
      -d '{"email":"sumituxui@gmail.com","password":"1_Railway"}' \
      https://hirepilot-production-e70d.up.railway.app/api/auth/login

Also: run jest from inside backend/ or frontend/. `npx --prefix backend jest`
silently produces no output rather than failing, which reads as a passing test
suite if you only grep the result.

## No DB access to HirePilot from this machine — blocks A1's all-user audit
`railway whoami` authenticates as sumituxi@gmail.com, but `railway list` shows
only `regintel-ai`. HirePilot is not in this account's project list, so there is
no `railway run` / `railway connect` path to its Postgres, and there is no
`backend/.env` with a `DATABASE_URL`. `psql` is not installed.

A1 needs "audit every tracker row ... **all users**, not one account", which
cannot be done through the per-user API.

Unblock with either:
  - `railway link` the HirePilot project into this account/team, then
    `railway run node -e "..."` against the backend service; or
  - set `DATABASE_URL` in the environment for a one-off audit script.

What does NOT need it: the structural fix (CHECK constraint + route change +
test) and the corrective migration are all writable and testable without DB
access, and the migration runs server-side on deploy where DATABASE_URL exists.
Only the *reporting* of which real users are affected is blocked.

Partial verification available meanwhile: user 2 (id 2,
hp45-new-1785827128@example.com) holds exactly one false applied row, on job
14150, created via POST /api/applications during the #45 regression check. It is
observable through `GET /api/applications` with that user's token.
