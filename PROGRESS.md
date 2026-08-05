# HirePilot — Progress

Repo lives at `~/dev/hirepilot-rebuild`. It was moved out of `~/Documents`
because macOS TCC revoked access mid-session and blocked every tool. Do not
move it back. Pre-A4 history is in HISTORY.md; this file is the cold-start
handoff only.

Current wave: A (Master Prompt v2)
**Wave A is COMPLETE (A1-A6).** Current goal: A7.2 — no parse failure
reaches the UI. Then A7.3-A7.6 → A7.8-A7.10 → Wave B.
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

## Just finished — A6, hardcoded figure sweep [shipped + VERIFIED 2026-08-05]

Layer L1. Changed `frontend/__tests__/noFabricatedZero.test.js`,
`frontend/components/NotificationBell.js`, `frontend/scripts/prove-guards-red.js`.

**Verified.** Frontend 60, backend 42, CI green, guard audit 26/26.
Four new assertions, each proven red individually.

**Nothing fabricated was found in the product.** Every hit was read, not
counted: `"$25K"` is inside a comment describing an already-fixed bug;
"every 6 hours" matches `cron.schedule('0 */6 * * *')`; the credits pill is
fetched and gated on presence; tier figures 600/1500/4500 are server-side in
`plans.js` and ARE the enforced limits.

**The real gap was coverage, not content.** `landingHonesty` guarded index.js
only - the page that shipped "180+" while the truth was 153 - and nothing
guarded the other twenty-odd surfaces. The three checks now run repo-wide.

`'9+'` in the notification badge is DERIVED from a real count, so it is
permitted with a `derived-figure:` note (mirroring `real-zero:`). The marker is
load-bearing: removing it turns the guard red, and the audit carries that case.

---

## Next goal — A7.2, no parse failure reaches the UI (executable cold)

From the master prompt:
- A job row rendered company as literally "name". Any row whose company, title
  or location failed to parse is repaired or withheld, never rendered with the
  placeholder visible. Constraint 1.
- Audit how many indexed jobs carry unparsed fields; report the count.
- **A2c covered the RENDER side; this covers INGESTION.**

**Start from this, do not re-derive it:**
- `frontend/lib/renderState.js` exports `isParsed` / `parsedOr`. Render sites in
  `jobs.js` and `auto-apply.js` already route through it, so users currently see
  "Company not stated" rather than "name". The DATABASE row is still wrong.
- The placeholder list lives in `renderState.js` as `NOT_PARSED` - reuse it
  server-side rather than writing a second list that can drift.
- Unknown and needing a real query: which source wrote `company_name = 'name'`,
  how many rows are affected, and whether title/location are affected too.
  `GET /api/applications/integrity` is the established pattern for reporting a
  count from production without local DB access - extend it or add a sibling.
- Ingestion lives in `backend/services/apis/`; the poller runs every 6 hours.
- Do NOT delete rows. Additive/corrective only, and per the standing rule any
  corrective migration writes an audit row BEFORE it mutates.

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

