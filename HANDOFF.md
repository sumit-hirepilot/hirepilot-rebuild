# HANDOFF — cross-lane requests

Lane A owns `backend/` and is the only lane that writes migrations. Lane B owns
`frontend/`. Anything a lane needs outside its own tree is requested here
rather than edited.

**Append only.** Add a new `## ` section; never rewrite someone else's. Lane B
maintains its own sections in this file on `lane-b-frontend` — when the two
branches merge, both sets survive because neither edits the other's.

---

## B → A · 1 · An endpoint that lists the jobs a user added by link

**Status:** ✅ ANSWERED by A → B · 1 below.

### The problem, verified on production

Feature 4a stores a linked job with `is_active = false`. That was deliberate
and is still right — 16 shared queries filter `is_active = true`, so one
person's link never enters the index served to everyone else, with no change
to the hot feed path.

The consequence was not thought through: **the owner cannot reach it either.**

Checked on production against the live account:

```
GET /api/jobs?limit=5&source=user_link   200, 0 rows   (is_active=false excludes it)
GET /api/jobs/saved/list                 200, 0 rows   (a link is not a "save")
GET /api/jobs/mine                       500           (no such route)
GET /api/jobs/linked                     500           (no such route)
```

So the flow ends like this: the user pastes a link, sees *"Added: AI
Transformation Owner, Marketing at GitLab — Scored 55%"*, and the job is then
unreachable. It cannot be opened, tailored against, or queued. 4a's brief was
"fetched, parsed, scored, tailored and queued" and it currently stops after
"scored".

This is the same class as the pasted-JD row that `GET /tailored` dropped with
an inner join: **work the product performs and then hides.** A 201 that the
user can never act on is a computed value nothing reads.

### What Lane B needs

An endpoint returning the caller's own linked jobs, with the score already
attached so the list can render without an N+1:

```
GET /api/jobs/linked?limit=&page=
  -> { total, page, limit,
       jobs: [{ id, title, company_name, location, job_url,
                posted_at, postedAtKnown, companyStated,
                source: 'user_link', created_at,
                score: { overall_score, breakdown } | null }] }
```

Notes that matter for honesty, carried from 4a:

- `company_name` may be **null** — a page that did not state one is stored as
  absent, never invented. Lane B renders "Company not stated".
- `posted_at` may be **null** — only a real publication date is ever stored,
  never Greenhouse's `updated_at`. Lane B renders "Publication date
  unavailable" rather than a guess.
- `score` may be **null** when scoring failed; the job is kept regardless.
  Lane B renders "Not scored yet", never 0%.
- Rows must stay `is_active = false` and must remain scoped to
  `added_by_user_id = req.user.id`. This endpoint must not become a second
  door into the shared index.

### What Lane B will do with it

A "Jobs you added" section on `/jobs`, listing them with score, and per row the
same actions an indexed job has — open, tailor, queue. Until this lands, 4a's
success message is the last the user ever sees of the job.

---

## B → A · 2 · Unknown `/api/jobs/<word>` paths return 500, not 404

**Status:** ✅ ANSWERED by A → B · 2 below.

`GET /api/jobs/mine` and `/api/jobs/linked` both return **500**. They are
almost certainly falling into `GET /api/jobs/:id`, where `Number('mine')` is
`NaN` and the query throws.

A 500 says "this server is broken"; the truth is "there is no such job". It
also puts noise in the crash logs that looks like a real fault, which is the
thing the crash logging exists to keep clean.

Requested: `/:id` validates the parameter and returns 400 or 404 for a
non-numeric id, before any query runs.

---

---

## A → B · 1 · `GET /api/jobs/linked` — LANDED

Answers Lane B's request that a job added by link be reachable by its owner.
Live on `lane-a-backend`. 13 tests; every guarantee below proved red before it
was trusted.

```
GET /api/jobs/linked?page=&limit=
Authorization: Bearer <token>

200 {
  total: number,          // all of this user's linked jobs
  page: number,
  limit: number,          // clamped to 100; page offset clamped to 5000
  jobs: [{
    id: number,
    title: string,
    company_name: string | null,
    location: string | null,
    job_url: string,
    posted_at: ISO8601 | null,
    source: 'user_link',
    created_at: ISO8601,
    companyStated: boolean,     // false <=> company_name is null
    postedAtKnown: boolean,     // false <=> posted_at is null
    score: null | { overall_score: string, breakdown: object | null }
  }]
}
```

### The three nulls, and what they mean

Each is a real state, not a value to paper over:

| field | null when | render as |
|---|---|---|
| `company_name` | the page never stated one — 4a stores absence rather than inventing a name | "Company not stated" |
| `posted_at` | no genuine publication date existed. **Never** Greenhouse's `updated_at`, which moves on every edit — that is the himalayas trap | "Publication date unavailable" |
| `score` | scoring failed; the job was kept regardless | "Not scored yet" — **never 0%**, which reads as a terrible match |

`companyStated` and `postedAtKnown` exist so the client never infers absence
from a falsy value. `score` is `null`, never `0`, and a test asserts it.

### What it is not

Scoped to `added_by_user_id = req.user.id`, and every row it returns is still
`is_active = false`. It is not a second door into the shared index — a test
fails if the user filter is removed.

### Why it was needed

4a stored linked jobs `is_active = false`, which correctly keeps one person's
link out of the index served to everyone else and **incorrectly hid it from
its owner**. The flow ended at "Added … Scored 55%" and the job could never be
opened, tailored against or queued. Same class as the pasted-JD row an inner
join dropped: work the product performs and then hides.

---

## A → B · 2 · Non-numeric `/api/jobs/:id` is now 404 — LANDED

`/api/jobs/mine` and `/api/jobs/linked` both returned **500**: there was no
such route, so they fell into `/:id`, and `WHERE id = 'mine'` makes Postgres
throw `invalid input syntax for type integer`. A 500 claims the server is
broken when the truth is there is no such job, and writes a fault into the
crash log that never happened.

Fixed with `router.param('id', …)` on the jobs router rather than inside one
handler, because **all four** `/:id` routes had the same hole. A non-numeric or
out-of-range id now returns 404 **before any query runs**.

`/api/jobs/linked` is a real route now, so it returns data rather than 404.

---

## A → B · 3 · `GET /api/matches/coaching` — LANDED (feature 5)

"What would move you from 62% to 80%", computed from this user's own feed with
the same arithmetic the score uses. Cold start is the normal case: no
applications, no outcomes, no history needed.

```
GET /api/matches/coaching
Authorization: Bearer <token>

200 (nothing to say yet) {
  ready: false,
  reason: 'no_scored_jobs' | 'no_skills_recorded',
  detail: string          // render this, it explains what to do
}

200 (ready) {
  ready: true,
  jobsConsidered: number,     // bounded to 400, the user's best matches
  skillsRecorded: number,
  meanScore: number,          // 0..1
  components: [{ id, label, score, weight, pointsAvailable }],
  biggestGap: 'skills'|'experience'|'location'|'salary',
  helpsAbove: number,         // the threshold — see below
  candidates: [{
    skill, appearsInJobs, shareOfFeed,
    meanScoreBefore, meanScoreAfter,
    netDelta,                 // OFTEN NEGATIVE. Render the sign.
    jobsHelped, jobsHurt,
    evidence: [{ jobId, title, company }]
  }],
  negativeCandidates: number,
  howThisWorks: string
}
```

### The one thing that will surprise you

`netDelta` is frequently **negative**, including for the top candidate.

Skills score is `matched / userSkills.length` — the share of the USER'S skills
a job mentions. Adding a skill raises the score on jobs that mention it and
**lowers it on every job that does not**. Working it through, the change is
`(n*a − M) / (n(n+1))`, so a missing skill only helps when

```
shareOfFeed  >  helpsAbove          (the user's current mean skills score)
```

Below that line the most common gap in the feed still makes the average worse.

**Do not render `netDelta` as a positive uplift.** A green "+" on a negative
number would be the exact failure this endpoint exists to prevent. Show the
sign, show `jobsHelped` vs `jobsHurt`, and use `howThisWorks` verbatim — it is
written for a reader and explains why a common skill can hurt.

### Also worth knowing

- **Ranking by `netDelta` coincides exactly with ranking by frequency** — the
  algebra above shows the per-job terms cancel. The value adds the sign and
  the magnitude, not a different order. Claiming a different order would be
  false and an earlier draft of this did.
- `evidence` carries real job ids from this user's feed. Every claim is
  openable; nothing is suggested that is not written in a posting they were
  scored against.
- `components[].pointsAvailable` is `(1 − score) × weight`. `biggestGap` uses
  that, not the lowest sub-score — a 0.1 salary is worth 0.09 points while a
  0.5 skills is worth 0.20, and sending someone to fix salary would be wrong.

---

## A → B · 4 · D49 landed — the score changed, and the UI must say so

**This is a request, and it is the one thing D49 is not complete without.**

`skillsScore` changed from `matched / userSkills.length` to
`matched / max(jobRequiredSkills, 4)`. Every score in the index moves:

| | before | after |
|---|---|---|
| mean overall | 0.619 | **0.746** |
| range | 0.583 – 0.801 | 0.569 – 0.910 |
| distribution | 180 of 220 jobs in the 60–69% band | spread across 50–99% |

A user who saw 62% yesterday and 75% today, with no explanation, is looking at
a label that disagrees with the data behind it. That is the exact defect this
decision was taken to remove, so shipping the formula without the notice
re-introduces it one level up.

### What Lane B needs to build

**1. A notice, while the re-score is running and shortly after.**

```
GET /api/matches/rescore-status        (Lane A will expose this - say if you want it sooner)
200 { total, done, remaining, complete }
```

Suggested wording, adjust to fit the voice — the substance is what matters:

> **We changed how match scores are calculated.** A job's score is now the
> share of what *it* asks for that you already have. Before, it was the share
> of *your* skills the job happened to mention — which meant adding a real
> skill could lower your scores. Most scores have gone up. Nothing about your
> profile or applications changed.

**2. Coaching copy changes.** `GET /api/matches/coaching` changed shape:

- `helpsAbove` is **gone**, renamed `meanSkillsScore`. It is no longer a
  threshold — under the new formula every candidate helps — so do not render
  it as one.
- `netDelta` is now **always ≥ 0** and `jobsHurt` is always 0. The previous
  warning about negative uplift no longer applies and should be removed.
- `howThisWorks` is rewritten; use it verbatim.
- The order genuinely differs from frequency now: a skill in postings that ask
  for few other things is worth more. Worth saying, because a user comparing
  the list to "most common" will otherwise think it is wrong.

**3. Job cards showing 100% on skills.** 8 of 220 (3.6%) now do. That is a
real full match against what the posting asks for — but it is 100% of what we
could *extract*, not a guarantee. Please word it so it does not read as
"perfect candidate".

### Not blocking you

The formula and re-score are on `lane-a-backend` and not yet deployed. Nothing
moves for a real user until that branch lands on `main`, so there is time to
ship the notice with it rather than after.
