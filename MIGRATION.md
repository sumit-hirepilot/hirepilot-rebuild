# Migration — to the new Railway account

Target account `sumit.uxai@gmail.com`, workspace `sumituxai-netizen's Projects`.

## What is live on the new account

Project **hirepilot** — `fa9188bd-c17d-4df2-8a40-ddddc379f486`

| service | id | address |
|---|---|---|
| backend | `32762c75-a70c-4309-8fb7-36940fc9157c` | https://backend-production-e6a8.up.railway.app |
| frontend | `00ea921a-24b2-4c0b-ab7a-e4b863811092` | https://frontend-production-0d14b.up.railway.app |
| Postgres | `ff47fd0a-774f-4cb9-8089-5a5f595cb0e2` | TCP proxy `gondola.proxy.rlwy.net:36664` |

Deployed with `railway up` from the local tree, **not** from GitHub — see
"Why not GitHub" below. Backend builds the root `Dockerfile`; frontend builds
`docker/Dockerfile.frontend`. Both selected with `RAILWAY_DOCKERFILE_PATH`.

`docker/Dockerfile.backend` is NOT used and must not be: it is alpine, from the
initial commit, and the root Dockerfile documents at length why both stages are
Debian slim (native bindings, and the PDF export work in 95d0ac7). Building it
would silently revert the base image.

### Verified on the new environment

- `GET /api/health` 200
- signup → token → authenticated request, end to end
- **9 / 9 schema claims** read back from the system catalogues, on a database
  that was dropped to empty and re-migrated from nothing
- the `applications_applied_requires_submission` constraint exercised BOTH
  ways: an `applied` row with no evidence is rejected, one with `submitted_at`
  is accepted (that row was then deleted)
- landing page renders and its live counter matches the database exactly —
  17,388 jobs on both, no hardcoded number
- the client bundle names **only** the new backend; the old hosts are gone
- `og:url` / `og:image` name the new site

### Two defects the migration itself uncovered

Both are recorded in DECISIONS.md as **D50** and in the commit log.

1. `applications_applied_requires_submission` was **never created on a fresh
   database**. The CHECK reads `is_manual`, and `is_manual` was added ~120
   statements later, so the ALTER failed with `column "is_manual" does not
   exist`, was logged, and the run continued. Every environment that has ever
   existed already had the column from an earlier deploy, so it had never
   shown. Fixed, plus a test for the class.

2. The frontend named specific deployments in its own source: `next.config.js`
   defaulted the API origin to `http://localhost:3000` (a production build that
   forgot the variable would ship an app calling the visitor's own machine),
   `pages/index.js` carried a second copy naming a deployed backend, and the
   social tags named a deployed frontend. A production build now fails without
   `NEXT_PUBLIC_API_URL`. Guarded by a test; proved on the real build.

## What has NOT moved: the data

**Nothing from the old database has been copied.** The new database holds only
jobs its own aggregators have fetched since it booted, and one operator account
(`migration-check@hirepilot.local`) used to read `/api/jobs/db-health` — delete
it at cut-over.

It is blocked on one credential, and only one.

The old app lives in Railway project `tranquil-solace`
(`ef1f4b05-b1b4-4a2d-9591-b39781d0a06a`) under a **different Railway account**
— `sumit.designwork@gmail.com`, per RAILWAY_SETUP.md. Its `DATABASE_URL` exists
only in that project's variables. Checked, not assumed:

- `railway whoami` → `sumit.uxai@gmail.com`; `railway list` → this workspace
  only, and `tranquil-solace` is not in it
- the browser session on railway.com is the same account: 0 projects
- no `.env` anywhere in the working tree; the only Postgres URL in shell
  history is `localhost`
- the running API leaks no environment (correctly) — `/api/health` returns
  status, memory and uptime and nothing else

Reaching that account needs its password, which is the one thing I will not
type. So the last step needs **either** of these from the operator:

1. the old `DATABASE_URL` (Railway → tranquil-solace → Postgres → Variables), or
2. the old account signed in, in a browser, so the value can be read from the
   dashboard

### The moment it arrives, this is the whole remaining job

The destination is already reachable from this machine over the TCP proxy, and
`scratchpad/newdb.js` already runs SQL against it.

```
# 1. let the old instance finish anything in flight, then
# 2. copy, oldest-first, preserving ids
pg_dump --no-owner --no-acl --data-only "$OLD_DATABASE_URL" \
  | psql "$NEW_DATABASE_URL"
```

Order of operations that matters:

- **Wipe the new database first** (`DROP SCHEMA public CASCADE`) and let the
  backend re-migrate, or ids collide with the ~17k jobs it has already
  aggregated and the operator account occupying `users.id = 1`.
- **Check the re-score finished on the old instance before dumping.** If it is
  mid-flight the new database lands holding two scoring formulas in one table
  with no way to tell which row is which. `GET /api/matches/rescore-status`
  answers this; the last observed run completed 2,999 rows.
- `pg_dump`/`psql` are not installed on this machine and there is no Homebrew.
  Either install libpq, or do it in Node — `pg` is already in
  `backend/node_modules` and `scratchpad/newdb.js` shows the connection.

### Verify the copy against the inventory captured from the old instance

| | old |
|---|---|
| database size | 179 MB |
| active jobs | 25,681 |
| job_matches | 2,998 |
| tailored resumes | 87 |
| submission receipts | 0 |
| schema claims | 9 / 9 |

## Why not GitHub

Railway's GitHub App is installed on GitHub account **`sumituxai-netizen`**
(installation `151987823`, all repositories). The repo is
`sumit-hirepilot/hirepilot-rebuild` — a **different** GitHub account — so it
never appears in Railway's repo picker, and no amount of refreshing changes
that.

`railway up` sidesteps it entirely and is what the current deployments use. To
restore push-to-deploy, one of:

- install the Railway App on the `sumit-hirepilot` GitHub account, or
- push the repo to a `sumituxai-netizen` remote, which the App already covers

## Cut-over items still open

- **The extension points at the old backend.** `extension/background.js` has
  `apiBase: 'https://hirepilot-production-e70d.up.railway.app'` and
  `manifest.json` grants host permission only for the old frontend. An
  installed extension will keep submitting against the old environment until it
  is rebuilt and re-published. This is a deliberate cut-over decision, not a
  defect — changing it strands users of the currently-live old deploy.
- **Backend User-Agent strings** advertise the old domain, including the
  `+https://…/about-bot` contact URL that `jobUrlFetch.js` sends to third-party
  servers. After cut-over that is a bot identifying itself with a dead address.
- **`NEXT_PUBLIC_SITE_URL` is not set on the old deploy**, so pushing this
  branch there would drop its social tags until it is. That is why nothing has
  been pushed to GitHub.
- Delete `migration-check@hirepilot.local` from the new database.
- The new account is a **Limited Trial, 30 days / $5.00**. The old account's
  trial exhaustion is BLOCKED.md's best explanation for five outages; this one
  will hit the same wall.
