/*
 * Storing a job the user linked, without putting it in anyone else's index.
 *
 * `is_active = false` is the mechanism, and it is deliberate rather than
 * convenient: 16 separate queries in routes/jobs.js filter `is_active = true`,
 * so the feed, both counts and all five facets exclude these rows already,
 * with no change to the hot path and no chance of missing one. The by-id
 * lookups that scoring, tailoring and queueing use do NOT filter it, which is
 * exactly the reachability this needs.
 *
 * So: one person's pasted link is usable by that person and invisible to
 * everyone else. That is the A7.19 line - coverage from the user rather than
 * from crawling - made structural instead of promised.
 *
 * Nothing here is invented. A company the page did not state is stored as
 * NULL, and posted_at is only ever a real publication date from the source.
 */

const crypto = require('crypto');

/** Rate limit: this is a person pasting links, never a crawler. */
const MAX_LINKS_PER_HOUR = 20;

/**
 * A stable id for a URL, so the same link pasted twice is the same row.
 *
 * `jobs.job_url` is UNIQUE, so a second paste of the same URL would otherwise
 * be a duplicate-key error - the exact flood the aggregator had to stop
 * throwing hundreds of times per cycle.
 */
const externalIdFor = (url) => `link_${crypto.createHash('sha1').update(String(url)).digest('hex').slice(0, 24)}`;

/**
 * How many links this user has added in the last hour.
 *
 * Counted from the rows themselves rather than an in-memory counter, because
 * the process restarts on every deploy and a limit that resets on deploy is
 * not a limit.
 */
async function linksInLastHour(query, userId) {
  const r = await query(
    `SELECT COUNT(*)::int AS n FROM jobs
      WHERE added_by_user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
    [userId]
  );
  return r.rows[0]?.n || 0;
}

/**
 * Insert, or return the row that already exists for this URL.
 *
 * ON CONFLICT rather than a pre-check plus insert: two tabs pasting the same
 * link at once would race a check, and the unique index is the only thing that
 * actually decides.
 *
 * Ownership is NOT reassigned on conflict. If someone else linked it first,
 * the row keeps their id - `added_by_user_id` records who first linked it, and
 * claiming otherwise would be a small lie in a column nobody would check.
 */
async function upsertLinkedJob(query, userId, job, url) {
  const r = await query(
    `INSERT INTO jobs
       (source, external_id, title, company_name, job_url, description,
        location, posted_at, is_active, added_by_user_id, fetched_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9, CURRENT_TIMESTAMP)
     ON CONFLICT (job_url) DO UPDATE
        SET title       = EXCLUDED.title,
            description = EXCLUDED.description,
            location    = COALESCE(EXCLUDED.location, jobs.location),
            company_name = COALESCE(EXCLUDED.company_name, jobs.company_name),
            posted_at   = COALESCE(EXCLUDED.posted_at, jobs.posted_at),
            fetched_at  = CURRENT_TIMESTAMP
     RETURNING id, title, company_name, location, posted_at, job_url, added_by_user_id, is_active`,
    [
      'user_link',
      externalIdFor(url),
      String(job.title).slice(0, 255),
      job.company ? String(job.company).slice(0, 255) : null,
      String(url).slice(0, 1024),
      job.description || null,
      job.location ? String(job.location).slice(0, 255) : null,
      job.postedAt || null,
      userId,
    ]
  );
  return r.rows[0];
}

module.exports = { upsertLinkedJob, linksInLastHour, externalIdFor, MAX_LINKS_PER_HOUR };
