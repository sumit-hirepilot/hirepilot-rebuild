# HirePilot — working agreement

Read `PROJECT.md` first for state and dead ends. This file is how to work here.

---

## Stack

- **Backend** Node 18 (Debian slim, not alpine — native bindings), Express, `pg`
  against PostgreSQL 18. Entry `backend/index.js`.
- **Frontend** Next.js, pages router, CSS Modules. No UI framework, no Tailwind.
- **Extension** Chrome MV3, unpacked. `extension/`.
- **Host** Railway: project `hirepilot`, one environment, services `backend`,
  `frontend`, `Postgres`. Deploys go out with `railway up` from the working
  tree — **not** from GitHub.
- **Tests** Jest both sides. Verification of anything user-facing is done by
  driving production, not by reading code.

Build images: backend uses the **root `Dockerfile`**; frontend uses
`docker/Dockerfile.frontend`. `docker/Dockerfile.backend` is stale alpine from
the initial commit — using it silently reverts the base image and breaks PDF
export.

---

## Conventions

**Comments explain WHY, and name the defect they prevent.** The codebase reads
like a logbook on purpose. If a line exists because something broke, say what
broke. A comment that only restates the code is noise.

**Business logic lives in `backend/services/`, not in routes.** Routes validate,
call a service, and shape the response.

**Absence is passed through as absence.** `null` plus a boolean beside it
(`companyStated`, `postedAtKnown`), never a guess and never `0`. Inventing a
company name or a date is fabricated data on a live surface.

**Every value read from a request is bounded**, through
`backend/services/requestBounds.js`. Clamp, do not refuse; and state the clamp
in the response — a silently shortened page is indistinguishable from a short
result set.

**Every source fetch goes through `services/apis/httpSource.js`**, which bounds
the response size.

**One value, one place.** The API origin is `frontend/lib/apiBase.js`. The
public app URL is `backend/services/publicUrl.js`. Duplicated constants drift,
and the copy that drifts is the one nobody is looking at.

**Failures the server reports must be rendered.** If an endpoint returns
`preparationFailed`, `needsConfirmation`, `refused` or `frozen: false`, the UI
shows it with its reason. This has shipped broken three times.

**Tests assert behaviour, not text.** A test that asserts a claim exists will
pin that claim in place after the behaviour changes.

**Prove a test red before trusting it green.** Break the thing deliberately and
watch the test fail. Several guards here passed while the defect was reverted.

---

## Hard rules

1. **Never change the database schema without asking.** Migrations are additive
   and idempotent, appended to the ordered list in
   `backend/services/migrations.js`. A CHECK constraint must come *after* every
   column it references — getting that wrong left a constraint missing on every
   fresh database and nobody noticed for months. After any schema change, read
   the claims back from `/api/jobs/db-health`; a migration that is *written* is
   not a migration that *ran*.

2. **Never refactor files outside the current task.** Tidying an unrelated file
   makes a diff nobody can review and hides the one change that matters.

3. **Always commit after a working change.** Small commits, message says what
   broke and why the fix is the fix. `tools/ship.sh` is the only supported way
   to push: 11 stages, and the push is unreachable unless every one passes in
   the same shell invocation.

4. **Never weaken a guard to make a test pass.** If a guard fires, it is either
   right or it is a defect in the guard — decide which, out loud, and say so.
   `supportedAts.test.js` failing means an unverified adapter is about to be
   allowed to submit on someone's behalf.

5. **Never auto-answer demographic or EEO questions**, and never store an answer
   to one. The guarantee is that there is nothing to fill from.

6. **Never invent résumé content.** Every claim must trace to the user's own
   material. A withheld skill becomes a question, never a silent drop.

7. **"Applied" requires a submission record.** Two database constraints and an
   append-only receipt enforce it. Do not add a code path that sets the status
   directly.

8. **Lever and Ashby stay disabled.** They enter `SUPPORTED_ATS` only after a
   verified live run, in the same commit as the evidence.

9. **The trunk is `production`. `origin/main` is a frozen archive — never
   push it.** main is wired to a Railway account nobody can reach and its
   deploy config is broken (no FRONTEND_URL); a push there could redeploy the
   old production in a broken state. Enforced twice over: ship.sh's stage 11
   refuses unless the current branch tracks `origin/production`, and this
   machine's pre-push hook refuses `refs/heads/main` outright. Do not remove
   either. (The GitHub *default branch* setting still points at main and only
   the operator can flip it — see BLOCKED.md.)

10. **Budgets, every deploy:** idle RSS under 300 MB, boot peak under 500 MB,
    **500 concurrent with zero failures (enforced), 1,000 measured and
    reported (informational)**, and **per-source ingest counts unchanged or
    explained**. Never load-test within five minutes of a deploy, and never
    with an expired token.

    Why the bar is 500, decided by the operator 2026-08-08: the 1,000 step
    sits exactly on the one-replica capacity edge, and whether the burst's
    tail crosses the 10 s pool-acquire bound is arrival-shape dependent —
    the same code recorded 0 and 71 failures on different mornings (LOAD.md).
    A bar that flips on client arrival shape gates nothing. 500 has been
    clean under every shape observed and is far beyond current traffic. No
    second replica (cost), and the acquire timeout stays put — raising it
    would fake the number. `tools/loadtest.py` encodes the verdict: it exits
    non-zero iff any step at or under 500 has failures, and labels larger
    steps informational. A 1,000-step failure is a trend to watch, not a
    deploy blocker.

11. **When optimising a resource, assert the work still happens.** Less work is
    less memory — every optimisation has a degenerate solution that scores
    perfectly and does nothing. Count the output, not just the resource.

12. **Log the real error before proposing a cause**, and record dead leads. Three
    wrong hypotheses in this project were each expensive to re-run.
