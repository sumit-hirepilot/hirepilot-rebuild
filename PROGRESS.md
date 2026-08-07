# PROGRESS

New Railway account is production. Old account abandoned by operator decision.

- **App** https://frontend-production-0d14b.up.railway.app
- **API** https://backend-production-e6a8.up.railway.app

Suites: **backend 461**, **frontend 267**. Gate stages 1–9 pass.

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

**Memory, production** (`/api/health`):

| | measured | budget | |
|---|---|---|---|
| steady state, 90 samples over 12 min | **207–208 MB** (heap 72 MB) | under 300 MB | pass |
| peak seen at ~22s uptime after a deploy | **687 MB** (heap 458 MB) | under 500 MB | **FAIL** |

Steady state is comfortably inside budget and has come down as the corpus
settled. The peak is a single early-boot spike and is **not yet characterised**:
the aggregator already runs one source at a time (GOAL 1d), so the obvious
cause is ruled out, and a 458 MB heap that early points somewhere else. It
needs a sampled boot to locate, which is the next task and gates the feature
queue.

## Auto Apply — proven end to end, WEAKENED

Full stage-by-stage evidence in SUBMISSION_PROOF.md. Every stage on production
against the operator's own resume, against a controlled target that replaces
only the employer's form. Two defects found by running it, both invisible to a
green suite:

- **the submission receipt had never once been written** — the freeze query read
  `a.resume_id` and `a.ats`, columns of the table it inserts INTO, which have
  never existed on `applications`. It threw on every submission ever made and
  the catch downgraded it to a soft reason field while the endpoint answered
  200. The old production's 0 receipts had been read as "nobody has submitted".
- the controlled target 500'd on the real bracket-named payload — my own new
  code, found by running it rather than by tests written from the same wrong
  assumption.

The delta is recorded, not glossed: a target built to the adapter's own
selectors can never catch selector drift on live Greenhouse, and MV3
orchestration is not exercised. A5 stays open for that run alone.

## Blocked — operator dependency

**A5 — WEAKENED by operator decision; one thing still open.** The pipeline is
proved against a controlled target. What remains uncovered is **selector drift
on the live Greenhouse boards**: a target built to the adapter's selectors
cannot catch the adapter going stale. Only a run against a live board closes
it, and that is the run the Greenhouse User Agreement question gates.

Lever and Ashby stay disabled and their terms remain unread.

## Next

1. Characterise and fix the early-boot memory peak, before any feature work.
2. Features 6, 8, 9, 10, 11, 12, 13, 14, 15, audit after every third.
3. Load test 50/200/500/1000 at steady state, after each feature.
4. Final audit at 375/768/1440 and on an emulated phone.

Seeded account `autoapply-proof@hirepilot.local` and the operator account
`migration-check@hirepilot.local` both still exist on production and should be
removed at cut-over.
