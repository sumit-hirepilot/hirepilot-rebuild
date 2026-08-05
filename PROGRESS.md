# HirePilot — Progress

Repo lives at `~/dev/hirepilot-rebuild`. It was moved out of `~/Documents`
because macOS TCC revoked access mid-session and blocked every tool. Do not
move it back. Pre-A4 history is in HISTORY.md; this file is the cold-start
handoff only.

Current wave: A (Master Prompt v2)
**Current goal: A5 — Submission audit.** Then A6 → A7.2-A7.6 → A7.8-A7.10.
Blocked on: nothing.

---

## Just finished — A4, submission receipt, immutable [shipped + VERIFIED 2026-08-05]

Layer L1. Changed: `backend/services/migrations.js`, `backend/routes/apply.js`,
`backend/routes/applications.js`, `backend/__tests__/submissionReceipt.test.js`,
`frontend/pages/applications/[id].js`, `frontend/styles/ApplicationDetail.module.css`.

**Why it mattered.** `screening_answers` on the application row is CURRENT
state - later discovery runs rewrite it. A screen rendering it as "what was
sent" asserts something it cannot know. Filed as a Constraint 1 violation, not
a missing feature: seeing what left is a user's only defence against a bad
automated submission made under their name.

**How it was verified.**
- Production `GET /api/applications/integrity` returns `receipts:
  {table_present: true, immutable_trigger: true, one_per_application: true}`,
  read from `pg_trigger` / `pg_tables` / `pg_indexes`. NOT inferred from a clean
  deploy - `runMigrations` logs a failed `CREATE TRIGGER` and carries on.
- Production `GET /api/apply/queue/1/receipt` returns 404 with the stated reason
  "the current profile values are not a record of what was sent" - absence is a
  fact, never a fallback to live values.
- 8 tests, each verified failing individually against the pre-change files.
- CI green, every step confirmed executed.

**Design points a future session must not undo.**
- Immutability is a TRIGGER (`trg_submission_receipts_immutable`, BEFORE UPDATE
  OR DELETE, RAISE EXCEPTION). A rule living only in app code is one careless
  UPDATE from being false.
- `ON CONFLICT (application_id) DO NOTHING` + unique index: a re-submit must
  never overwrite the first receipt's account of what went out.
- Resume identified by sha256 of the bytes actually attached, hashed in Node.
  Deliberately NOT pgcrypto `digest()` - a missing extension must not be the
  reason a submission has no receipt.
- A receipt failure never un-verifies a real submission; reported, never thrown.

**Known gap, stated rather than hidden.** The receipt freezes what the SERVER
knows at submit time: `screening_answers` as of that moment, the resume bytes,
the platform response. It does NOT capture the literal field-by-field payload
the extension typed into the employer's form. Closing that needs an extension
change to post its filled payload to `/queue/:id/evidence`. Until then the
receipt is honest about being a server-side copy, not a keystroke record.

---

## Next goal — A5, Submission audit (executable cold)

- Which platforms does the extension submit to, by what mechanism, under whose
  session.
- What each platform's terms actually say. **Record findings; do NOT conclude
  the legal question** - that needs counsel. Take the compliant branch meanwhile.
- Reconcile every submission claim on the site with what the product does.

**Start from this, do not re-derive it:**
- `SUPPORTED_ATS` in `backend/routes/apply.js` is `{greenhouse}` only. Lever and
  Ashby are commented out (D7) - they could submit while never having been run
  against a live form. Do NOT re-enable either.
- `extension/content/adapters/` holds exactly greenhouse, lever, ashby.
- Greenhouse: verified end to end, one confirmed submission (Scale AI).
- Workday, Taleo, iCIMS, SmartRecruiters, SuccessFactors: detected by
  `detectAts()`, excluded from `SUPPORTED_ATS`. Opened for the user, never
  automated.
- Mechanism: browser automation in the user's own signed-in session; no
  credentials held by HirePilot. Constraint 4 calls browser automation against a
  third party's ATS `deferred: ToS` - so A5 must also answer whether what
  ALREADY ships conforms to the constraint the project set itself.
- `frontend/pages/auto-apply.js` COVERAGE rows carry `atsKey` and are bound to
  `SUPPORTED_ATS` by `frontend/__tests__/adapterStatus.test.js` in both
  directions. Any copy change must keep that test green.

---

## What a fresh session must know

**Environment**
- The shell resets cwd between calls - `cd` every time. `cd X && pwd` can print
  success while `getcwd` fails; do not read that as working.
- Never run `next build` while `next dev` is live: they share `frontend/.next`
  and the production build corrupts the dev server's chunks, which looks exactly
  like a broken page.
- `frontend/.env.local` points at the production API. Token:
  `curl -s -X POST -H 'Content-Type: application/json' -d '{"email":"sumituxui@gmail.com","password":"1_Railway"}' https://hirepilot-production-e70d.up.railway.app/api/auth/login`

**What gates on push**
- `.github/workflows/tests.yml`: backend jest, frontend lint, frontend jest, the
  guard audit, tree-clean check. `docker-build.yml` builds and boots the API
  image. There is still NO typecheck - plain JS, no tsconfig.
- `frontend/scripts/prove-guards-red.js` mutates one file, runs one guard,
  requires RED, reverts in a `finally`. It INSTALLS any suite whose jest is
  missing and throws if still missing - never skips, because skipping narrows
  the audit and reports a smaller denominator as success. `npm run test:guards`
  from `frontend/`. Currently 22/22.

**Suite sizes, so a drop is visible:** frontend 53, backend 42.

**Verification rules learned the hard way (all in the master prompt)**
- Prove red before trusting green - committed test or ad-hoc measurement.
- Presence is not function. Click it.
- A visual change needs a visual check, on the property carrying the value.
- Exit 0 is not evidence of work. Assert a positive count of what ran.
- Containment is not existence. Anchor assertions.
- An instrument gets a known-good AND a known-bad reading before it is trusted.

**Open follow-ups:** A7.8 (shared `orderFor()` helper - eight ORDER BY sites
were fixed individually, the ninth will reintroduce it), A7.9 (parameters
carrying two meanings - check whether a filter change silently switches the
ranking source), A7.10 (the frontend suite tests render, not behaviour: only 1
of 53 drives an interaction), #44 (Checkr submit rejected, two distinct causes).

**NOTIFY - unresolved and unknowable from the data.** The boot-time corrective
UPDATE that repaired false "applied" rows overwrote them in place and kept no
record of which rows or whose. A1's audit reads 0 affected because the corrector
had already run. Treat "0 affected" as "0 affected now", never as "nobody was
ever affected". Any future corrective migration writes an audit row BEFORE it
mutates.
