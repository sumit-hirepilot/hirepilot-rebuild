# PROGRESS — Lane B (frontend)

Owns `frontend/` only. Requests outside it go to HANDOFF.md.
Branch `lane-b-frontend`, rebased before every push, never force-pushed.

## Now

**D1 blast radius — measured, not estimated. Done.**

### How many pushes had a failing frontend build: five

Every commit in the window was **built**, not reasoned about. The two
boundaries were built too, so the window is closed on both ends:

| commit | subject | `next build` |
|---|---|---|
| `45b123d` | Feature 3 load numbers and PROGRESS | **BUILDS** — window starts after this |
| `e6d1cb7` | Feature 4a: paste any job link | **FAILS** |
| `defbee8` | Feature 4a fix: store the posting URL | **FAILS** |
| `61964cb` | Feature 4a load numbers and PROGRESS | **FAILS** |
| `fb2596f` | D47 (mock boundaries) and 4b | **FAILS** |
| `dd59ba2` | PROGRESS: D47 swept, 4b closed | **FAILS** |
| `d46c991` | AUDIT D1 fix | **BUILDS** — window ends here |

Single cause throughout: `Do not use an <a> element to navigate to /resume/`
in `AddJobByLink.js`, introduced with the file in `e6d1cb7` and fixed in
`d46c991`. Railway served the last good frontend for all five.

### Which features shipped in the window, and what was actually stranded

Only **one commit touched `frontend/` at all**:

```
e6d1cb7   frontend/components/AddJobByLink.js       +141
          frontend/pages/jobs.js                      +8
          frontend/styles/AddJobByLink.module.css    +39
```

- **4a — paste any job link.** Backend deployed and worked; the **entire UI**
  never existed on production. This is the one feature that was verified
  through its API and not through its interface.
- **4b — Instahyre.** An assessment. No frontend, nothing to strand.
- **D47 — mock boundaries.** Tooling and tests. No frontend.

So the unverified surface is exactly 4a's UI, and nothing else.

### Walked in the browser, on production, at 375 with real device signals

`userAgentData.mobile: true`, `maxTouchPoints: 5`, Android UA.

| path | result |
|---|---|
| "+ Add a job by link" opener → panel | opens; "Add job" correctly disabled while empty |
| **success** — a real GitLab Greenhouse posting | **"Added: AI Transformation Owner, Marketing at GitLab — Scored 55%"** |
| refusal — Naukri | names Naukri, explains, offers the paste box |
| handoff link | 44px, correct href, lands on the Tailor tab |
| paste-a-JD after the handoff | tailors, result stays on screen, nothing leaked |
| overflow at 375 | 0 |

Two defects were found while walking it and are already fixed and deployed:
the handoff landed on the wrong tab (D2), and the tailored result was thrown
away by a reload that unmounted the component holding it (D3).

### One thing the walk found that is NOT fixed, because it is not Lane B's

**A job added by link is unreachable the moment the success message clears.**
`is_active = false` keeps it out of everyone else's index — correct — and out
of the owner's too. There is no endpoint listing a user's linked jobs, so 4a
stops at "scored" rather than reaching "tailored and queued".

Same class as the pasted-JD row an inner join hid: work the product performs
and then hides. Raised as **HANDOFF B → A · 1**, with the response shape and
the null-honesty rules Lane B needs. A second, minor request covers
`/api/jobs/mine` returning 500 rather than 404.

## Next

Feature 6 — the apply pipeline UI, against the existing backend
(`/apply/queue`, `approve-bulk`, `skip`, `start`, `pause`, `receipt`,
`evidence`, `runs`, `blockers`, all already shipped). Then feature 5's
coaching display against Lane A's contract in HANDOFF.md, then feature 9.

## Lane note

Two contradictory lane briefs arrived in this session — Lane A (backend only)
and Lane B (frontend only). This session is running as **Lane B**, because
Lane B's first task is the D1 blast radius that was already in flight. Flagged
rather than silently chosen.
