# PROGRESS

New Railway account is production. Old account abandoned by operator decision.

- **App** https://frontend-production-0d14b.up.railway.app
- **API** https://backend-production-e6a8.up.railway.app

Suites: **backend 441**, **frontend 267**. Gate stages 1–9 pass.

## Now

### Migration closed, and everything repointed

The data migration is closed in BLOCKED.md as an operator decision, not a
blocker. Nothing was copied from the old database and nothing was deleted from
the old project.

Twelve places still named the old deployment. None of them renders an error
when wrong — the extension simply submits somewhere else, the marketing site
simply quotes a different database's number. All repointed: extension default
API base and host permissions, both backend User-Agent contact URLs, the
load-test target, every "Open the app" button on the marketing site, its `.env`,
and its live-stat fallback.

`tools/check-stale-origins.js` sweeps both trees and is stage 5 of the gate. It
immediately found two more I had missed, including the extension popup's
placeholder advertising a hostname that has **never existed and answers 502** —
the field's own worked example connected the extension to nothing.

Two structural fixes rather than string replacements:

- the extension derived the app URL by asking whether `apiBase` **contained** a
  particular deployment's hostname. Right on that one deployment, a wrong guess
  everywhere else. `appBase` is stored beside `apiBase` now.
- the two User-Agent strings each had their own copy of the address, so both
  went stale independently. One module.

Also removed a working password written out in full in BLOCKED.md.

### D50 — a constraint that only existed because the column happened to be there

The new database came up **8 of 9** schema claims. Missing:
`applications_applied_requires_submission`, the constraint behind "applied
status requires a submission record".

The CHECK reads `is_manual`; `is_manual` was added ~120 statements later. Every
environment that ever existed already had the column from an earlier deploy, so
the ALTER succeeded there and failed only on a database built from scratch —
logged, and the run continued. Nothing that reads `migrations.js` could have
found it: the statement is written correctly, it just ran too early.

Fixed, guarded by a test that walks STATEMENTS in order, proved red. Then
proved on a real database: schema dropped to empty, re-migrated, **9/9**, and
the constraint exercised **both** ways — an `applied` row with no evidence
rejected, one with `submitted_at` accepted.

### D51 — a skill has to trace as a claim, not as a bag of words

Tailoring the operator's real resume against real Greenhouse postings wrote two
skills into it that he has never claimed: **Marketing** (`stem()` strips `-ing`,
so it matched "market positioning") and **UI Design** (assembled from "UX/UI
redesign" and "design" in two unrelated roles).

"Marketing" is the literal example in the tailor route's own comment describing
what the guard exists to stop. It had regressed all the way back while every
test stayed green — the tests checked that an obviously invented skill was
rejected, never one whose *words* were present but whose *claim* was not.

Skills now trace as a whole phrase; prose is unchanged. My first attempt reused
`stem()` and still passed the fabrication — both sides collapsed to "market".
Full analysis in DECISIONS.md.

Proved on production against the same two postings: `addedSkills: []`, both
skills moved to `needsConfirmation`, `containsMarketing: false`.

### The submission halt is operable again

`ADMIN_HALT_SECRET` is ours on this account. Exercised on the running service:
wrong secret 403, absent secret 403, correct secret halts and reads back
`true`, resumes and reads back `false`. Left resumed.

## Measured

**Memory, production, across a full ingest** (`/api/health`, 20s sampling):

| | measured | budget | |
|---|---|---|---|
| steady state | **277 MB** | under 300 MB | pass |
| peak during initial ingest | **687 MB** | under 500 MB | **FAIL** |

The peak is the first aggregation cycle after a deploy, at ~22s uptime, across
12 sources. It falls back to 277 MB and stays there. This is the next thing to
fix and it gates the feature queue, per the standing budget.

## Blocked — operator dependency

**A5 — counsel before any further submission work.** Unchanged and still the
reason Auto Apply is not proven end to end. The Greenhouse User Agreement
restricts automated access and binds job seekers, the party HirePilot acts for.
Proving the submitting half means putting a real application into a real
employer's ATS under the operator's own name, by automation, and that is the
question A5 defers to counsel rather than to an engineering pass.

What is proven without it, on the new production:

| stage | state |
|---|---|
| candidate selection, real feed | proven |
| resume upload + parse, real PDF | proven — 10 skills, 6 roles |
| tailoring honesty guards | **proven, and one was failing** — D51 |
| kill switch halts and resumes | proven both ways, plus both refusals |
| Lever and Ashby disabled | unchanged |
| nothing reaches applied without a submission record | proven at the database — D50 |
| queue, submit, confirm, receipt, tracker | **not proven — A5** |

## Next

1. The 687 MB ingest peak, before any feature work.
2. Features 6, 8, 9, 10, 11, 12, 13, 14, 15, audit after every third.
3. Load test 50/200/500/1000 at steady state.
4. Final audit at 375/768/1440 and on an emulated phone.

Seeded account `autoapply-proof@hirepilot.local` and the operator account
`migration-check@hirepilot.local` both still exist on production and should be
removed at cut-over.
