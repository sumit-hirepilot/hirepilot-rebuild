# HirePilot — Blocked

Goals that failed five attempts, with full diagnosis. Retried at end of wave.

## Carried in from prior work (not yet counted against the 5-attempt rule)

### #45 — Auto Apply and Applications pages never load their data
`load()` is never entered; no effect fires in those components. Ruled out by
evidence: API base (bundle carries the correct origin), auth token (present),
response shape (endpoints return 200 with correct data when called by hand from
that page's own console), state updates, hydration (fixed the credits-pill
mismatch, stall persisted), and stale build caches. No runtime error is thrown -
the page renders with the error overlay intact and shows none.
Next: instrument at the component boundary, not inside load(), to find whether
the effect is scheduled at all.

### #44 — Checkr submit rejected, two different causes
`8088915` reports "Phone is required" and "Select a country". `8088900` reports
NO validation errors and no empty required fields, so it fails for a different
reason. The phone value survives the runner's exact fill path on all three
boards tested, so the original "blur clears it" hypothesis is disproven.
