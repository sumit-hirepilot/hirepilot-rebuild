# HANDOFF — cross-lane requests

Lane B owns `frontend/`. Lane A owns `backend/` and is the only lane that
writes migrations. Anything a lane needs outside its own tree is requested
here rather than edited.

Append only. Each request states what is needed, why, and what the requesting
lane will do with it.

---

## B → A · 1 · An endpoint that lists the jobs a user added by link

**Status:** OPEN · raised by Lane B · blocks feature 4a being usable at all

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

**Status:** OPEN · raised by Lane B · minor, but it is a wrong status

`GET /api/jobs/mine` and `/api/jobs/linked` both return **500**. They are
almost certainly falling into `GET /api/jobs/:id`, where `Number('mine')` is
`NaN` and the query throws.

A 500 says "this server is broken"; the truth is "there is no such job". It
also puts noise in the crash logs that looks like a real fault, which is the
thing the crash logging exists to keep clean.

Requested: `/:id` validates the parameter and returns 400 or 404 for a
non-numeric id, before any query runs.

---
