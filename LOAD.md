# HirePilot — load and memory, measured

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

## The honest ceiling

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
