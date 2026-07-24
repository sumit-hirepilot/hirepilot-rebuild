# Job Source Integration Report

Research pass across every source requested for the global aggregation engine, with the access
method actually verified for each (not assumed). Status legend:

- ✅ **Integrated** — real, verified public API/feed, wired into `services/jobAggregator.js`
- 🔑 **Available, needs API key** — has an official API but requires free/paid registration we
  don't hold credentials for; genuinely actionable if the user obtains a key
- 🚫 **Blocked — ToS/anti-bot** — commercial platform whose Terms of Service prohibit automated
  scraping and/or that actively fingerprints and blocks non-partner traffic; not integrated on
  principle, not just difficulty
- ❓ **No public API found** — tested plausible endpoint patterns live; none resolved to real data
  in this pass. Not proof none exists, just not found without deeper reverse-engineering (which
  starts to look like scraping a private frontend API, so we stopped)
- ➖ **Not independently verifiable** — no distinct API surface from an already-listed source, or
  too ambiguous a public name to test (e.g. "Startup Jobs" matches several unrelated products)

## ✅ Integrated (12 live sources)

| Source | Method | Notes |
|---|---|---|
| Remote OK | Official public JSON API | Pre-existing |
| Remotive | Official public JSON API | Pre-existing |
| Himalayas | Official public JSON API (`himalayas.app/jobs/api`) | Paginated, ~200/cycle |
| Hacker News – Who's Hiring | Official HN Firebase API | Heuristic parse of the monthly thread's top-level comments (company/title/location/salary follow a `\|`-delimited convention); always links back to the original comment |
| No Fluff Jobs (Poland) | Public JSON API (`nofluffjobs.com/api/posting`) | API returns one row per region a job is visible in — deduped to canonical postings (17,403 raw → 2,560 unique) |
| Landing.jobs (Portugal) | Public JSON API | Company name isn't in the payload, parsed from the offer URL slug |
| Working Nomads | Public JSON API | |
| Jobicy | Public JSON API — **explicitly published for third-party use** (`friendlyNotice` in the response invites API consumers, asks for attribution) | |
| Jobindex (Denmark) | Public RSS feed | |
| Greenhouse (curated companies) | Official public per-company job board API (`boards-api.greenhouse.io`) — this is Greenhouse's documented embeddable-feed endpoint, not scraping | Covers Global/Startup/US/Europe categories via 17 tracked companies (Stripe, Airbnb, Coinbase, Figma, Cloudflare, Databricks, GitLab, Brex, etc.) |
| Lever (curated companies) | Official public per-company posting API (`api.lever.co`) | 5 tracked companies |
| Ashby (curated companies) | Official public per-company job board API (`api.ashbyhq.com`) | 6 tracked companies incl. OpenAI, Ramp, Linear |

The Greenhouse/Lever/Ashby company lists live in `services/apis/ats.js` and are meant to grow —
there's no "all companies" endpoint for any ATS, so coverage is a maintained list, not a global
search. Add a slug once you've confirmed it 200s.

**Combined real yield per aggregation cycle: ~8,000 raw postings fetched, deduplicated (both
within-source province/region duplicates and cross-source company+title+date matches) into
canonical rows.**

## 🚫 Blocked — ToS-prohibited or actively anti-bot (not integrated on principle)

These explicitly prohibit automated access in their Terms of Service and/or run active bot
detection with an enforcement history (LinkedIn v. hiQ, Indeed's anti-scraping stance, etc.).
Building scrapers against them would be a sustained, scheduled ToS violation, not a one-off read.

- **LinkedIn Jobs** — no public jobs API without a Talent Solutions partnership
- **Indeed Worldwide** — Publisher API deprecated, no longer issues new keys
- **Glassdoor** — ToS explicitly prohibits automated use
- **SEEK (Australia)** / **SEEK NZ** / **JobsDB (HK/SEA)** — same backend, confirmed live but it's
  SEEK's internal frontend API, not a published public API; commercial platform, same caution as
  LinkedIn/Indeed applies. SEEK does offer an official Ad Network / Talent Search partner API —
  requires a business agreement
- **Wanted (Korea)** — same situation: unauthenticated internal frontend API, not an intentionally
  published one; excluded out of caution rather than "it's technically open"
- **StepStone**, **TotalJobs**, **CWJobs**, **Dice**, **Ladders** — major commercial boards,
  confirmed active bot protection (403) or no accessible endpoint on the patterns tested
- **Bayt**, **WUZZUF**, **TokyoDev**, **NodeFlair**, **Glints**, **RocketPunch**, **Startup Jobs** —
  confirmed 403 (active blocking) on tested endpoints

## 🔑 Available, but needs a registered API key (actionable, not a dead end)

- **Reed (UK)** — has a real, documented public API (`reed.co.uk/api/1.0`); returns 401 without a
  key. Free registration at reed.co.uk/developers would unlock this — if you want it, get a key
  and we'll wire it in
- **GulfTalent** — returned 401 (auth required); same pattern, likely a registrable partner API

## ❓ No public API found in this pass

Tested realistic endpoint guesses (`/api/jobs`, `/api/v1/offers`, `/api/postings`, etc.) against
each; none resolved to real data (404/403, or redirected to the HTML app shell):

Wellfound (AngelList), Arc Jobs, Y Combinator Work at a Startup, Otta, Techstars Jobs, VentureLoop,
Built In, JobPin, Climatebase, a16z Talent, Sequoia Jobs, Accel Jobs, General Catalyst Jobs, Index
Ventures Jobs, FlexJobs, Pangian, JustRemote, NoDesk, Welcome to the Jungle, Getro Jobs, Workable
(guessed endpoints 404/302'd), Job Bank Canada, Workopolis, TechTO Jobs, WorkInStartups, EU Startup
Jobs, Berlin Startup Jobs, GermanTechJobs, SwissDevJobs (redirected, no JSON found), Instaffo,
LesJeudis, DutchTechJobs, Magnet.me (redirected), Domestika Jobs, JobFluent, The Hub, Finn.no Jobs,
Just Join IT, Startup Jobs Australia, Cutshort, Instahyre, Hirist, Wellfound India, JapanDev, Boss
Zhipin, Liepin, Yourator, CPJobs, Jobberman, BrighterMonday, OfferZen, Get on Board, Torre (redirects
to app shell, no working JSON endpoint found), Computrabajo.

These aren't necessarily unreachable forever — several likely have real APIs behind developer
portals we didn't find in a live-endpoint pass. If any of these matter most to you, say which ones
and we can do a deeper, source-specific investigation (checking their developer docs / partner
programs directly instead of guessing endpoint shapes).

## ➖ Not independently testable

- "Welcome to the Jungle" listed separately under Europe/France — same product as under General
  Job Boards, one entry
- "Otta", "Startup Jobs", "VentureLoop", "Wellfound" repeated under US — same product, same result
- "The Hub" listed under Sweden/Denmark/Norway/Finland — one product, one result either way
