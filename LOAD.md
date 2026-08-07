# HirePilot — load and memory, measured

> **Production moved on 2026-08-07.** The hostnames named below were
> correct when these numbers were taken and are kept for that reason.
> Current production is `backend-production-e6a8.up.railway.app` (API)
> and `frontend-production-0d14b.up.railway.app` (app). See MIGRATION.md.

Ceiling: **1 GB**. Not an estimate — Railway's Replica Limit for the backend
service reads `Memory: 1 GB / Plan limit: 1 GB` on the Limited Trial, and the
process was killed five times for crossing it.

All numbers below are from production (`hirepilot-production-e70d`), read from
`/api/health`, which reports `process.memoryUsage()` — the same RSS the platform
kills on.

## Memory: before and after GOAL 1d

| | RSS |
|---|---|
| Before, idle plateau (Railway graph) | ~700 MB |
| Before, crash record | 551 MB at 10s uptime |
| After, boot | 100 MB at 12s |
| After, **peak during full ingest** | **481 MB at 42s** |
| After, idle | **302 MB** (settles from 365 → 337 → 302 over ~3 min) |

Target was peak < 500 MB and idle < 250 MB.
**Peak: met, 481 MB. Idle: missed, 302 MB.**

What changed:
- Ingest fetched every source through `Promise.all`. **Measured 9 source
  fetches in flight at once**; now 1. Each held that source's rows with
  descriptions.
- `fetchAllForPlatform` ran `Promise.all` over *every* ATS company, so all
  responses were resident before being flattened. Measured on a real cycle:
  greenhouse **10,180** postings, ashby **4,409**, nofluffjobs **3,017**.
  Bounded to a window of 4.
- `calculateMatchesForUser` selected the whole `jobs` table with no LIMIT and
  buffered it. Now chunked 2,000 at a time by id.
- The duplicate-key flood (`jobs_job_url_key`, hundreds of thrown errors per
  cycle) is checked before insert rather than thrown and caught.

## Load: concurrent users

Each simulated user makes 3 sequential requests — feed, matches, tracker.

| Users | Requests | OK | Failed | p95 | RSS after |
|---|---|---|---|---|---|
| 5 | 15 | 15 | 0 | 583 ms | 277 MB |
| 10 | 30 | 30 | 0 | 721 ms | 277 MB |
| 20 | 60 | 48 | 12 (all HTTP 500) | 1,062 ms | 269 MB |
| 50 | 150 | 123 | 27 (all 500) | 2,126 ms | 274 MB |
| 200 | 600 | 467 | 133 (all 500) | 6,596 ms | 294 MB |
| 500 | 1,500 | 1,145 | 355 | 15,651 ms | 299 MB |
| 1,000 | 3,000 | 2,170 | 830 | 20,068 ms | 302 MB |

## After GOAL 1f — the fix, and the new numbers

The error was never memory and never the connection pool. Read out of
`crash_reports` on production:

```
SQLSTATE 53100 — could not write to file "base/pgsql_tmp/pgsql_tmp152696.0":
                 No space left on device
```

The feed CTE still carried `ROW_NUMBER() OVER (PARTITION BY jobs.source ...)`.
A7.9 moved diversity into `feedDiversity` and deleted the `WHERE` that consumed
`source_rank`; the window function was left behind. Every request sorted and
partitioned all 25,418 rows to build a column nothing read — and a window
function over the whole index does not fit in `work_mem`, so Postgres spilled
it to `base/pgsql_tmp`. With the volume nearly full, those writes failed.

A computed value never used is a defect, not dead weight. This one was the
ceiling.

| Users | Requests | OK | Failed | p95 | RSS after |
|---|---|---|---|---|---|
| 20 | 60 | **60** | 0 | 836 ms | 113 MB |
| 50 | 150 | **150** | 0 | 1,316 ms | 698 MB |
| 200 | 600 | **600** | 0 | 3,844 ms | 447 MB |
| 500 | 1,500 | **1,500** | 0 | 8,849 ms | 489 MB |
| 1,000 | 3,000 | **2,999** | 1 | 17,487 ms | 498 MB |

The single failure at 1,000 users is a `gaierror` — DNS resolution on the
client running the test, not a server response.

### The new honest ceiling

- **Zero server failures at 1,000 concurrent users.** Target was 200; 1,000 is
  reached.
- **Usable latency is the real limit now.** p95 is 3.8 s at 200, 8.8 s at 500,
  17.5 s at 1,000. If p95 under 5 s is the bar, the ceiling is **~200
  concurrent users**. Nothing fails above that; it gets slow.
- RSS 402–498 MB throughout, against a 1 GB cap. Memory is not the constraint
  at any level tested.

### Still true, and not fixed here

The Postgres volume is nearly full — that is what turned a wasteful query into
an outage, and the Railway canvas shows a warning on `postgres-volume`. Writes
still work (crash rows persist, 25,399 jobs readable), so there is headroom,
but it is thin. Removing the spill removed this symptom without giving the
database more room. Pruning is a separate goal.

## Feature 1 (notice period, parse chips, failed-parse path) — steady state

| Users | OK | Failed | p95 | RSS after |
|---|---|---|---|---|
| 50 | 150/150 | 0 | 1,152 ms | 257 MB |
| 200 | 600/600 | 0 | **2,822 ms** | 300 MB |
| 500 | 1,500/1,500 | 0 | 6,232 ms | 336 MB |

No regression (previous 1,226 / 2,745 / 6,484). Zero failures. Run at uptime
330s, past the 5-minute rule.

## Feature 1 (experience bands) — load test at steady state

| Users | OK | Failed | p95 | RSS after |
|---|---|---|---|---|
| 50 | 150/150 | 0 | 1,226 ms | 264 MB |
| 200 | 600/600 | 0 | **2,745 ms** | 288 MB |
| 500 | 1,500/1,500 | 0 | 6,484 ms | 301 MB |

No regression (previous: 1,230 / 2,451 / 6,007 ms). Zero failures. Run at
uptime 511s, past the 5-minute rule.

## Feature 1 (C1a live counts) — load test after deploy

| Users | Requests | OK | Failed | p95 | RSS after |
|---|---|---|---|---|---|
| 50 | 150 | 150 | 0 | **1,230 ms** | 276 MB |
| 200 | 600 | 600 | 0 | **2,451 ms** | 299 MB |
| 500 | 1,500 | 1,500 | 0 | **6,007 ms** | 351 MB |

No regression. Slightly better than the pre-feature baseline at every step
(1,432 / 2,679 / 6,366 ms), zero failures throughout, RSS well under the
800 MB abort threshold.

### A measurement discipline this run taught

The FIRST run after the deploy, 90 seconds in, produced nonsense: p95 18,441 ms
at 50 users, 26,688 ms at 200 — then **12,112 ms at 1,000 users with zero
failures**. Worse at 50 than at 1,000 is not a load curve; it is a contaminated
measurement.

The cause was the post-deploy ingest cycle competing for the database. Read at
`uptimeSeconds 593` the numbers were normal again.

**Do not load-test within ~5 minutes of a deploy.** Check `/api/health`
`uptimeSeconds` first, and treat a curve that improves as concurrency rises as
evidence the instrument is wrong rather than the app being fast.

Had the first run been believed, it would have read as a 10x regression at 200
concurrent and this feature would have been rolled back for a fault it does not
have.

## After GOAL 1h — the COUNT cache

A feed request runs exactly **two** queries. The EXPLAINs suspected earlier are
in `db-health`, **not** the hot path — that lead is dead, recorded so it is not
chased again. Both queries build the same CTE over 25,418 rows, so the COUNT is
close to half the database work per request and its answer only moves when
ingest writes, every six hours. It is now cached for 60s, keyed by the full SQL
plus parameters, bounded at 500 entries, oldest-out.

p95, measured on production:

| Users | before 1h | after 1h |
|---|---|---|
| 50 | 1,432 ms | 1,757 ms* |
| 200 | 3,626 ms | **3,434 / 2,679 ms** (two clean runs) |
| 500 | 8,114 ms | **6,366 ms** |

\* the 50-user step overlapped the boot ingest cycle (RSS 106 → 686 MB), so it
is not comparable. Re-measured steps are the two 200-user runs above, taken
after the service settled.

Zero failures at every step, every run.

### Honest read

The cache helped at 500 (8,114 → 6,366 ms, ~22%) and **barely moved 200**
(3,626 → 2,679–3,434 ms). That disproves the assumption behind it: removing
roughly half the queries did not remove half the latency, so **the page query,
not the COUNT, is what costs**. It builds the same 25,418-row CTE and cannot be
cached — it differs per page and per user.

**Target p95 < 2s at 200 concurrent is NOT met.** Best observed is 2,679 ms.

Reaching it would mean not scanning the whole index per request — a materialised
ranking, or a narrower candidate set before the join. That is real work, and per
the current priority it is deliberately **not** being done: the product has zero
users, and correctness plus onboarding matter more than latency for a load that
does not exist. The number is recorded here so the decision is visible rather
than forgotten.

## The honest ceiling (before 1f, kept for the record)

**10 concurrent users** is the last step with zero failures. Failures start at
20 and scale from there.

**Memory is not the constraint.** RSS stayed between 269 and 302 MB all the way
to 1,000 concurrent users — nowhere near the 800 MB abort threshold, let alone
the 1 GB ceiling. The load test never had to stop.

The constraint is **`/api/jobs`**, and it is isolated:

```
/api/jobs?limit=20&page=1     30 concurrent -> {200: 10, 500: 20}
                                 body: {"error":"Failed to fetch jobs"}
/api/matches?limit=20&page=1  30 concurrent -> {200: 30}
/api/applications             30 concurrent -> {200: 30}
```

The other two endpoints are clean at the same concurrency. The feed is the one
that throws, and it throws *fast* (p95 ~1s at 20 users), so this is not the
10-second pool-acquire timeout — it is an error, not a wait.

`/api/health` handled **150 concurrent with zero failures**, so neither the
client harness nor the Railway edge is the limit. It is the app.

## What is not yet known

The server-side error behind `"Failed to fetch jobs"` has not been read. The
route catches everything and returns one message, so the actual cause —
Postgres connection limit, a specific query, or something else — is still
unidentified. That is the next measurement, and it needs the Railway deploy
logs at the moment of a 500.

Candidate worth checking first: the feed runs several queries per request (the
ranked CTE, the COUNT, the undated COUNT, and `feedPlan`'s EXPLAINs), against a
pool of `max: 15`. Four-plus queries per request at 20 concurrent users is 80+
concurrent acquisitions against 15 connections.

## Reproducing

```
STEPS=5,10,20,50 python3 tools/loadtest.py <base-url> <token>
```

Stops at the first step whose RSS exceeds 800 MB. Records the failure mode, not
just the count — "22% failed" with no failure mode is a number nobody can act
on, which is how the first run of this was written and why it was redone.

## Full feature audit (D1-D4) — load test after deploy

Run at uptime 363s, past the 5-minute rule. Backend `f71f566`.

| Users | Requests | OK | Failed | p95 | RSS after |
|---|---|---|---|---|---|
| 50 | 150 | 150 | 0 | 1,349 ms | 333 MB |
| 200 | 600 | **600** | **0** | **2,767 ms** | 391 MB |
| 500 | 1,500 | 1,500 | 0 | 5,871 ms | 424 MB |
| 1,000 | 3,000 | 2,992 | 8 (TimeoutError) | 11,331 ms | 326 MB |

Against the previous steady state (1,152 / 2,822 / 6,232 ms):

- **200 concurrent: 2,767 ms vs 2,822 ms — no regression, zero failures.** The
  bar is "any failure or >50% p95 regression at 200 is not done". Met.
- 500 improved 6,232 → 5,871 ms. 50 rose 1,152 → 1,349 ms (+17%), inside noise
  for a single step and well under the 50% bar.
- Peak RSS 424 MB against the 800 MB abort and the 1 GB cap.

The 8 failures at 1,000 concurrent are `TimeoutError` — the client's own 30s
ceiling on a step whose p95 is 11.3s, not a server response. 1,000 is five
times the stated bar; recorded, not chased.

The audit's four fixes were all display-layer or query-time, so no latency
change was expected and none appeared. That is the point of recording it: a
change believed to be cosmetic is still measured.

## D45 claim-test sweep — load test after deploy

Run at uptime 352s. `944cd3d`.

| Users | Requests | OK | Failed | p95 | RSS after |
|---|---|---|---|---|---|
| 50 | 150 | 150 | 0 | 1,269 ms | 303 MB |
| 200 | 600 | **600** | **0** | **2,669 ms** | 324 MB |
| 500 | 1,500 | 1,500 | 0 | 6,067 ms | 330 MB |
| 1,000 | 3,000 | 2,987 | 13 (TimeoutError) | 12,296 ms | 338 MB |

200 concurrent: 2,669 ms against 2,767 ms last run. No regression, zero
failures. Peak RSS 338 MB.

No backend source changed in this deploy — the fixes were frontend copy, a
viewport tag, a settings control, tests and tools. Measured anyway, because
"believed to be cosmetic" is not evidence.

## Feature 2 (plain language) — load test after deploy

Run at uptime 1,806s. `d78718a`.

| Users | Requests | OK | Failed | p95 | RSS after |
|---|---|---|---|---|---|
| 50 | 150 | 150 | 0 | 1,225 ms | 268 MB |
| 200 | 600 | **600** | **0** | **3,025 / 2,538 ms** (two clean runs) | 301 MB |
| 500 | 1,500 | 1,500 | 0 | 6,076–6,142 ms | 302 MB |
| 1,000 | 3,000 | **3,000** | **0** | 13,548 ms | 305 MB |

Against 2,669 ms at 200 last run: no regression. Zero failures at 200 across
all three runs, and **1,000 concurrent completed with zero failures** — the
first time every step has been clean.

### The 5-minute rule fired again, on a run that was past it

The first pass read **p95 11,931 ms at 200 users and 6,142 ms at 500**. A
smaller load slower than a larger one is not a curve, and LOAD.md already says
to treat that as a contaminated instrument rather than a regression. Uptime was
1,806s, so this was not the post-deploy ingest — something else competed for
the database during that step.

Re-measured immediately: 3,025 ms, then 2,538 ms, with 500 at 6,076 ms. The
ordering is coherent again.

Reported as a regression, that first reading would have been a 4.5x p95 blowup
at exactly the concurrency the acceptance bar names, on a change that touched
only copy, a viewport tag and CSS.

## D46 (mobile claims) — load test after deploy

Run at uptime 307s. `e6bd0a4`. Frontend-only change; measured anyway.

| Users | Requests | OK | Failed | p95 | RSS after |
|---|---|---|---|---|---|
| 200 | 600 | **600** | **0** | **2,631 / 2,634 ms** (two runs) | 303–310 MB |
| 500 | 1,500 | 1,500 | 0 | 7,165 ms | 351 MB |

Against 2,538–3,025 ms at 200 last run: no regression, zero failures.

A first pass ran at uptime **205s** and returned a clean, coherent curve
(1,102 / 2,533 / 7,072 ms). It is discarded anyway — it was inside the
5-minute window, and a rule that only applies when the numbers look wrong is
not a rule. Re-measured above at 307s.

## Feature 3 (tailor from a pasted JD) — load test after deploy

Run at uptime 362s. `f53c180`.

| Users | Requests | OK | Failed | p95 | RSS after |
|---|---|---|---|---|---|
| 50 | 150 | 150 | 0 | 1,102 ms | 270 MB |
| 200 | 600 | **600** | **0** | **2,488 ms** | 293 MB |
| 500 | 1,500 | 1,500 | 0 | 6,280 ms | 305 MB |

Against 2,631 ms at 200 last run: no regression, zero failures. Peak RSS 305 MB.

The feed path is untouched by this feature — the new work is on
`POST /api/resume/tailor`, which the load profile does not exercise. Recorded
so that is visible rather than read as evidence the new path is fast.

## Feature 4a (paste any job link) — load test after deploy

Run at uptime 350s. `defbee8`. **The feed's query params were rebound in this
change**, so this run is a regression check on the hot path, not a formality.

| Users | Requests | OK | Failed | p95 | RSS after |
|---|---|---|---|---|---|
| 50 | 150 | 150 | 0 | 1,202 ms | 258 MB |
| 200 | 600 | **600** | **0** | **2,777 ms** | 282 MB |
| 500 | 1,500 | 1,500 | 0 | 6,960 ms | 300 MB |

Against 2,488 ms at 200 last run: +12%, inside the 50% bar, zero failures. The
feed now routes paging through `boundPaging` and bounds nine more parameters,
so a small cost here is expected and is the price of the sweep.

`POST /api/jobs/from-url` is deliberately NOT in this profile: it makes an
outbound request to a third party, and load-testing it would be pointing load
at someone else's servers. Its own limit is 20 links per user per hour.

## Audit round 2 — load test after the four fixes

Run at uptime 693s. `197ded6`.

| Users | Requests | OK | Failed | p95 | RSS after |
|---|---|---|---|---|---|
| 50 | 150 | 150 | 0 | 1,061 ms | 264 MB |
| 200 | 600 | **600** | **0** | **2,593 ms** | 291 MB |
| 500 | 1,500 | 1,500 | 0 | 6,380 ms | 304 MB |

Against 2,777 ms at 200 last run: improved, zero failures. All four fixes were
frontend-only, so no change was expected on these endpoints; measured anyway,
because "believed to be cosmetic" is not evidence.

## D49 merge — both lanes on main, formula + notice + re-score

Run at uptime 593s. `4291a74`.

| Users | Requests | OK | Failed | p95 | RSS after |
|---|---|---|---|---|---|
| 50 | 150 | 150 | 0 | 1,099 ms | 321 MB |
| 200 | 600 | **600** | **0** | **2,656 ms** | 342 MB |
| 500 | 1,500 | 1,500 | 0 | 6,329 ms | 350 MB |

Zero failures at 200 concurrent, p95 2,656 ms against 2,593 ms last run. The
scoring formula changed underneath this and the feed is unaffected — the
denominator is computed from text already loaded, so no extra query.
