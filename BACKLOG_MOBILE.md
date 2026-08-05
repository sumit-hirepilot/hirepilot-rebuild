# Backlog — mobile app (FILED, NOT BUILT)

Scoped A7-style so it can be picked up cold. **Do not start this from the
current queue.** E2 in the master prompt stays link-surfacing only; it does not
imply an app exists.

## M1 — Mobile app, first cut · L1
Rationale: §0 of the master prompt names "Next.js web app + mobile app", and
nothing mobile has been built. E2 would surface store links to an app that does
not exist, which is a Constraint 1 problem (a claim the product cannot keep).
Either this gets built or E2's copy states plainly that mobile is web-only.

Acceptance criteria — all must pass with self-produced evidence:
- [ ] Decide and record the approach in DECISIONS.md before any code: native,
      React Native, or installable PWA. A PWA needs no store presence and no
      second codebase; that is the low-risk reading unless a store listing is
      itself the goal.
- [ ] Signup -> resume upload -> scored feed works end to end on a real phone
      viewport, verified live on production, not only in a simulator.
- [ ] The tracker and Needs You drawer are usable at 375px with no horizontal
      overflow and tap targets >= 44px.
- [ ] **The extension cannot run on mobile.** Any screen implying auto-apply
      works there must say it does not, per D13 and Constraint 1. This is the
      criterion most likely to be quietly skipped.
- [ ] Zero console errors on every screen shipped.
- [ ] Store links on the site appear only once something exists behind them.

Blocked by: nothing technical. Gated on the A5 counsel answer only insofar as
the app must not imply submission capability it does not have.
