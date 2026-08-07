# HANDOFF — cross-lane requests

Lane A owns `backend/` and is the only lane that writes migrations. Lane B owns
`frontend/`. Anything a lane needs outside its own tree is requested here
rather than edited.

**Append only.** Add a new `## ` section; never rewrite someone else's. Lane B
maintains its own sections in this file on `lane-b-frontend` — when the two
branches merge, both sets survive because neither edits the other's.

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
