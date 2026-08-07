# PROGRESS — Lane A (backend)

Owns `backend/` only, and is the only lane that writes migrations. Requests
outside it go to HANDOFF.md. Branch `lane-a-backend`, rebased before every
push, never force-pushed.

## Now

**HANDOFF B → A · 1 and · 2 — both landed.** `155272a`. Contract recorded in
HANDOFF.md as A → B · 1 and · 2.

### A linked job is reachable by the person who added it

Feature 4a stored a linked job `is_active = false`. That keeps one person's
link out of the index served to everyone else — 16 shared queries filter on
it, with no change to the hot feed path — and it is still right. What it also
did, and should not have, was hide the job from its **owner**: nothing listed
these rows, so the flow ended at "Added … Scored 55%" and the job could never
be opened, tailored against or queued.

Same class as the pasted-JD row an inner join dropped: work the product
performs and then hides. A 201 the user can never act on is a computed value
nothing reads.

`GET /api/jobs/linked` returns the caller's own linked jobs with the score
attached, paged and bounded.

**Absence is passed through as absence**, in three places, each with a boolean
beside it so the client never infers it from a falsy value:

| field | null when | why it must not be filled |
|---|---|---|
| `company_name` | the page never stated one | inventing a name is fabricated data on a live surface |
| `posted_at` | no genuine publication date exists | never `updated_at`, which moves on every edit — the himalayas trap |
| `score` | scoring failed, job kept | `0` reads as "a terrible match"; `null` reads as "not scored yet" |

**Not a second door into the shared index**: scoped to `added_by_user_id`, and
every row stays `is_active = false`. A test fails if the user filter is
removed.

### A non-numeric `:id` is a 404, not a 500

`/api/jobs/mine` and `/api/jobs/linked` both returned 500 — no such route, so
they fell into `/:id`, where `WHERE id = 'mine'` makes Postgres throw. A 500
claims the server is broken and writes a fault into the crash log that never
happened, which is exactly the noise the crash logging exists to keep out.

Fixed with `router.param('id', …)` rather than a check inside one handler:
**all four** `/:id` routes on this router had the same hole, so fixing the
instance would have left three.

### Proved red

Four guarantees, each broken deliberately and the suite watched to fail:

| broken | test that caught it |
|---|---|
| user scope removed | "scopes to the caller, so it is not a second door into the index" |
| company guessed instead of null | "a company the page did not state stays null and is flagged" |
| score 0 instead of null | "an unscored job is null, never zero" |
| param guard removed | all five `:id` cases returned 500 again |

Two of my own assertions were wrong first, and both are recorded in the test
file: `.not.toMatch(...)` **throws** on `null`, which failed while the code was
correct — a test error dressed as a defect; and `/linked` was still in the
unknown-path list after it became a real route, so the test had outlived the
thing it described.

Backend suite: **394** (floor was 381). Guard census 11/0 unwired. Write paths,
query bounds and mock boundaries all clean.

### Not deployed yet

`lane-a-backend` is a branch. Nothing here is on production, so there is no
load test to record for it — the standing rule applies at deploy, and this has
not deployed. It will run at steady state once the branch lands on `main`.

### Feature 5 — score coaching (LANDED)

`GET /api/matches/coaching`. Contract in HANDOFF.md as A → B · 3.

**The finding that shaped it.** Skills score is `matched / userSkills.length`
— the share of the USER'S skills a job mentions, not the share of the job's
needs met. So adding a skill raises the score on jobs mentioning it and lowers
it on every job that does not. The obvious coaching — rank the missing skills
by frequency — therefore recommends things that make the average **worse**.

**I was wrong about part of this and the tests caught it.** The first draft
claimed the ranking differed from frequency ranking. Working the algebra out:

```
change in summed skills score = (n·a − M) / (n(n+1))
```

the per-job terms cancel, so it depends only on frequency `a`. **Ranking by
net delta is provably identical to ranking by frequency.** The claim was
false; it is removed rather than defended. What the delta genuinely adds is
the **sign**: a skill helps only when

```
shareOfFeed > helpsAbove   (the user's current mean skills score)
```

`helpsAbove` is now returned so the threshold is checkable against the list.
On a realistic feed every candidate can be negative — the most common gap
still making the average worse — and a frequency-ranked list has no way to
say so.

Every claim traces to job ids from the user's own feed; nothing is suggested
that is not written in a posting they were scored against. Cold start works:
no applications, no outcomes.

**A7.8 caught a real defect in my new query.** `ORDER BY overall_score DESC`
had no unique tiebreaker, so the "top 400" sample was whatever the plan
produced — the same user could get different coaching on two refreshes with
nothing changed. Advice that moves for no reason is advice nobody can act on.
Now `ORDER BY m.overall_score DESC, m.job_id ASC`.

**Two of my tests could not have discriminated** and were replaced after
proving red did nothing: the ordering test (asserting a distinction that does
not exist) and the `biggestGap` test (built so lowest-score and
most-points-available both answered "skills"). The rewritten one puts salary
at 0.1 — the lowest score — while skills at 0.5 carries more points, so only
the right rule passes.

Backend suite **409**.

### D49 — the skills denominator, raised not changed

The formula is **unchanged**. It is on every job card, so moving it silently
would move every number a user has already seen.

Measured on 220 live jobs against the real account: adding a genuine skill
lowers the score every time (SQL −0.019, Accessibility −0.023); of **74**
skills the user lacks exactly **1** would raise her score, and it is
"marketing" for a product designer; deleting six of her eleven real skills
raises her scores, and keeping only "Leadership" is **+166%**. 219 of 220 jobs
sit between 50% and 69% overall — the score barely discriminates.

Three options measured, not argued: keep it; `matched/jobSkills` (mean
0.619 → 0.750, distribution opens up, but every existing score moves); or a
harmonic hybrid, which was **measured and rejected** because it still falls
when a real skill is added.

Recommendation is option B with a denominator floor and an announced re-score.
Full analysis in DECISIONS.md as D49, flagged for the operator in BLOCKED.md.
The decision — whether every existing score may move — is not a technical one.

**Separate defect found while measuring:** `extractSkills` matches "Go" the
language against the English verb, firing on 45 of 220 design jobs (*"Go beyond
execution"*). Tsenta's "Go-Carts" failure in our own dictionary. It inflates
every option's denominator and is filed as its own defect.

## Next

Feature 11
(rejection intelligence), then feature 12 (recruiter email routing). Each API
contract goes into HANDOFF.md the moment it lands, before Lane B needs it.

## Lane note

Both lane briefs arrived in this session. This session is now running as
**Lane A**; the earlier D1 blast-radius work in it was done as Lane B and is
committed on `lane-b-frontend` (`ddd1b23`), which also carries that lane's
HANDOFF.md sections. Neither branch edits the other's sections, so they merge
without conflict.
