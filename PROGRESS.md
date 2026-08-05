# HirePilot — Progress

Repo lives at `~/dev/hirepilot-rebuild`. It was moved out of `~/Documents`
because macOS TCC revoked access mid-session and blocked every tool. Do not
move it back. Pre-A4 history is in HISTORY.md; this file is the cold-start
handoff only.

Current wave: A (Master Prompt v2)
**Current goal: A6 — Hardcoded figure sweep.** Then A7.2-A7.6 → A7.8-A7.10.
Blocked on: nothing engineering. But see NEEDS COUNSEL below - it gates any
further submission work, not the current goal.

## NEEDS COUNSEL (from A5, 2026-08-05) — read before touching submission
The one enabled adapter is Greenhouse. Its candidate-facing agreement
restricts "automated means, including spiders, robots, crawlers" and binds job
seekers, the party HirePilot acts for. Full findings and the exact questions
counsel must answer are in SUBMISSION_AUDIT.md; the holding pattern is in
BLOCKED.md. Nothing new ships against any ATS until answered. Do NOT conclude
this in an engineering pass, in either direction.

---

## Just finished — A5, submission audit [shipped + VERIFIED 2026-08-05]

Layer L1. Added `SUBMISSION_AUDIT.md`; changed `frontend/pages/index.js`,
`frontend/__tests__/adapterStatus.test.js`, `BLOCKED.md`.

**Verified.** Frontend 56, backend 42, build compiles, CI green.
The copy guard was proven red in BOTH directions - it fails if the landing
claim names a disabled adapter, and fails if it omits an enabled one.

**What it found.**
- Mechanism established from code: browser automation in the user's own
  signed-in session, content scripts limited to the three ATS hosts, clicks the
  employer's real submit button, holds no credentials, hard-stops on login /
  MFA / CAPTCHA, never ticks consent or answers EEO.
- MATERIAL: Greenhouse's My Greenhouse User Agreement restricts automated
  means and binds job seekers. Fetched directly, not from a search summary.
  Left unconcluded on purpose - see NEEDS COUNSEL above.
- Landing FAQ overstated coverage as "Greenhouse, Lever and Ashby" while
  SUPPORTED_ATS was greenhouse alone. Fixed and bound by test.
- Lever/Ashby terms NOT researched - recorded as unresearched, not implied
  checked. Both stay disabled.
- A5-a logged: `host_permissions` is `<all_urls>` while content scripts match
  only three hosts. Nothing uses the extra scope; narrow it.

---

## Next goal — A6, Hardcoded figure sweep (executable cold)

From the master prompt:
- Every user-facing surface: counts, percentages, `+`/`k`/`M` suffixes, time
  claims, status colours.
- Each hit becomes a real query or is deleted.
- **Read every matched line** - a grep hit is not a finding. This project has
  produced false positives from font metadata, minified bundles, build output,
  and its own comments describing a bug.

**Start from this, do not re-derive it:**
- `frontend/__tests__/landingHonesty.test.js` already guards the landing page
  against `+`/`k` suffixed counts, display percentages, and mock constants. It
  is proven red. A6 extends that discipline to every OTHER surface.
- `frontend/__tests__/noFabricatedZero.test.js` guards counts repo-wide
  (useState(0), `|| 0` coercion, literal 0 writes needing a `real-zero:` note).
- `frontend/lib/renderState.js` is the primitive: `countText`, `parsedOr`,
  `stateOf`. Anything showing a number should route through it.
- Precedent: "180+" shipped gated on a boolean while the truth was 153 - an 18%
  overstatement. Assume more exist.
- Status colours are in scope: A3 found every coverage dot rendering the same
  colour claim and Lever/Ashby green while disabled.

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
