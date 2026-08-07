const { query } = require('../db');
const { mem } = require('./memlog');
const { isParsed, notAJobReason } = require('./parsedField');
const remoteOKClient = require('./apis/remoteok');
const motiveClient = require('./apis/remotive');
const himalayasClient = require('./apis/himalayas');
const hackernewsClient = require('./apis/hackernews');
const nofluffjobsClient = require('./apis/nofluffjobs');
const landingjobsClient = require('./apis/landingjobs');
const workingnomadsClient = require('./apis/workingnomads');
const jobicyClient = require('./apis/jobicy');
const jobindexClient = require('./apis/jobindex');
const atsClient = require('./apis/ats');

// Each entry is a real, verified integration - either an official public
// API, an explicitly-published embeddable job board feed (Greenhouse/
// Lever/Ashby), or a public RSS feed. See SOURCES.md for the full research
// pass across every requested provider, including which ones were excluded
// and why (ToS-prohibited scraping, partner-only APIs, or no public API
// found). Adding a new source is just appending an entry here.
const SOURCES = [
  { key: 'remoteok', fetchJobs: remoteOKClient.fetchJobs },
  { key: 'remotive', fetchJobs: motiveClient.fetchJobs },
  { key: 'himalayas', fetchJobs: himalayasClient.fetchJobs },
  { key: 'hackernews', fetchJobs: hackernewsClient.fetchJobs },
  // streams: its catalogue endpoint is 160MB in one response; paged now.
  { key: 'nofluffjobs', fetchJobs: nofluffjobsClient.fetchJobs, streams: true },
  { key: 'landingjobs', fetchJobs: landingjobsClient.fetchJobs },
  { key: 'workingnomads', fetchJobs: workingnomadsClient.fetchJobs },
  { key: 'jobicy', fetchJobs: jobicyClient.fetchJobs },
  { key: 'jobindex', fetchJobs: jobindexClient.fetchJobs },
  /*
   * `streams: true` - these three return their catalogue in windows rather
   * than as one array. Greenhouse alone is 10,179 postings with descriptions;
   * holding them all before writing was the boot peak (377MB against a 500MB
   * budget), and it grows with the source rather than with usage.
   */
  { key: 'greenhouse', fetchJobs: atsClient.fetchGreenhouseJobs, streams: true },
  { key: 'lever', fetchJobs: atsClient.fetchLeverJobs, streams: true },
  { key: 'ashby', fetchJobs: atsClient.fetchAshbyJobs, streams: true },
  // Note: We Work Remotely is intentionally not fetched - their site is
  // behind Cloudflare bot protection and cannot be accessed server-side
  // without circumventing it, which we won't do.
];

// Job descriptions are by far the largest column and dominate database size:
// a full aggregation is ~17k postings, and at full length that alone was
// enough to fill the entire volume and crash-loop Postgres. Keyword matching
// and search only need the substantive body text, not the boilerplate tail
// (EEO statements, benefits blurb, application instructions), so descriptions
// are capped. Raising this materially raises storage use - size it against
// the actual volume, not optimistically.
const MAX_DESCRIPTION_CHARS = parseInt(process.env.MAX_DESCRIPTION_CHARS || '4000', 10);

// Zero is treated as absent: a published salary of 0 means undisclosed, and
// storing it would render as "$0" and fall into the "Under $50K" band.
// Trims to a column's width instead of letting the insert fail. Used for the
// narrow VARCHAR columns where a source can legitimately send something longer.
const capLen = (v, n) => {
  if (v === null || v === undefined) return null;
  const t = String(v);
  return t.length > n ? t.slice(0, n) : t;
};

const toIntOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
};

const capText = (text) => {
  if (typeof text !== 'string') return text;
  if (text.length <= MAX_DESCRIPTION_CHARS) return text;
  return `${text.slice(0, MAX_DESCRIPTION_CHARS)}…`;
};

const normalizeJob = (job, source) => {
  // posted_at must reflect the source's genuine original-publish date, never
  // the moment we happened to fetch it - a source with no trustworthy date
  // field (or a malformed one) should leave this null, not silently fall
  // back to "now", which fabricates a fake "just posted" freshness signal.
  const rawDate = job.posted_at || job.postedAt;
  const parsedDate = rawDate ? new Date(rawDate) : null;
  const postedAt = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null;

  return {
    source,
    external_id: capLen(job.external_id || job.id || job.jobId, 255),
    title: capLen(job.title || job.jobTitle, 255),
    company_name: capLen(job.company || job.companyName, 255),
    company_url: job.company_url || job.companyUrl,
    job_url: job.url || job.job_url || job.jobUrl,
    // Canonical ATS form URL where the source provides one; the extension's
    // content script only runs on the ATS domains, not company careers sites.
    apply_url: job.apply_url || null,
    description: capText(job.description || job.jobDescription),
    requirements: capText(job.requirements || ''),
    // salary_min/max are INTEGER columns, but some sources publish decimals
    // (an hourly "22.5"), which Postgres rejects outright - those jobs were
    // being dropped with "invalid input syntax for type integer". Rounded here
    // rather than widening the column, since sub-unit precision on a salary
    // band is noise.
    salary_min: toIntOrNull(job.salary_min ?? job.salaryMin),
    salary_max: toIntOrNull(job.salary_max ?? job.salaryMax),
    // Every narrow VARCHAR is capped to its column width. Sources legitimately
    // send longer values - a location listing ten countries, a verbose
    // job_type - and Postgres rejects the entire row rather than truncating,
    // so the posting was being dropped with "value too long for type character
    // varying". Widths mirror schema.sql.
    currency: capLen(job.currency || 'USD', 10),
    job_type: capLen(job.job_type || job.jobType || 'full-time', 50),
    work_arrangement: capLen(job.work_arrangement || job.workArrangement || 'remote', 50),
    location: capLen(job.location || job.city || '', 255),
    country: capLen(job.country || '', 100),
    posted_at: postedAt,
  };
};

const normalizeForDedup = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Cross-source duplicate detection: the same real posting often appears on
// multiple boards (e.g. a company's Greenhouse listing also syndicated to
// Himalayas). There's no shared external ID across sources, so match on
// normalized title + company posted within a few days of each other, and
// merge into the earliest-seen canonical row rather than creating a copy.
const findCrossSourceDuplicate = async (title, companyName, postedAt) => {
  const result = await query(
    `SELECT id FROM jobs
     WHERE is_active = true
       AND lower(regexp_replace(title, '[^a-zA-Z0-9]+', ' ', 'g')) = $1
       AND lower(regexp_replace(company_name, '[^a-zA-Z0-9]+', ' ', 'g')) = $2
       AND posted_at BETWEEN $3::timestamp - INTERVAL '3 days' AND $3::timestamp + INTERVAL '3 days'
     LIMIT 1`,
    [normalizeForDedup(title), normalizeForDedup(companyName), postedAt]
  );
  return result.rows[0]?.id || null;
};

/*
 * Field list for the update paths. $15 is apply_url, so callers must bind their
 * own predicate at $16 or later.
 *
 * This bit me: apply_url was added as $15 while the caller still used
 * `WHERE id = $15`, so the same placeholder was an integer in one position and a
 * varchar in the other. Postgres rejected it with "COALESCE types integer and
 * character varying cannot be matched" and EVERY job store failed - silently,
 * because storeJob's errors are logged per job rather than thrown. The explicit
 * cast below also pins the type when the value is null.
 */
const UPDATE_FIELDS_PARAM_COUNT = 15;
const UPDATE_FIELDS_SQL = `title = $1, company_name = $2, company_url = $3, job_url = $4,
   description = $5, requirements = $6, salary_min = $7, salary_max = $8, currency = $9,
   job_type = $10, work_arrangement = $11, location = $12, country = $13, posted_at = $14,
   apply_url = COALESCE($15::varchar, jobs.apply_url),
   fetched_at = CURRENT_TIMESTAMP, is_active = true, updated_at = CURRENT_TIMESTAMP`;
const updateFieldsParams = (jobData) => [
  jobData.title, jobData.company_name, jobData.company_url, jobData.job_url,
  jobData.description, jobData.requirements, jobData.salary_min, jobData.salary_max,
  jobData.currency, jobData.job_type, jobData.work_arrangement, jobData.location,
  jobData.country, jobData.posted_at, jobData.apply_url,
];

const storeJob = async (jobData) => {
  // Exact (source, external_id) match: this is the common re-fetch case, so
  // it's handled directly rather than falling through to the cross-source
  // duplicate check below - that query matches on title/company/date with
  // no id exclusion, so a same-job re-fetch would otherwise find itself and
  // take the duplicate-merge branch (fetched_at only, no field refresh).
  // An earlier version of this fast path only bumped fetched_at/is_active
  // here too, which is exactly why stale metadata (e.g. a wrong company_name
  // or posted_at) never corrected itself on later re-fetches even after the
  // upstream source parser was fixed - now every re-fetch fully refreshes.
  const existing = await query(
    'SELECT id FROM jobs WHERE source = $1 AND external_id = $2',
    [jobData.source, jobData.external_id]
  );
  if (existing.rows.length > 0) {
    await query(
      `UPDATE jobs SET ${UPDATE_FIELDS_SQL} WHERE id = $${UPDATE_FIELDS_PARAM_COUNT + 1}`,
      [...updateFieldsParams(jobData), existing.rows[0].id]
    );
    return { id: existing.rows[0].id, isNew: false, isDuplicateMerge: false };
  }

  /*
   * GOAL 1d — the duplicate-key flood.
   *
   * The INSERT below carries ON CONFLICT (source, external_id), which does not
   * cover jobs_job_url_key. A posting that arrives under a new external_id but
   * the same URL - which hackernews does constantly - therefore threw
   * "duplicate key value violates unique constraint jobs_job_url_key", once
   * per row, every single ingest cycle. Hundreds of thrown-and-caught errors
   * per run: wasted work, wasted allocation, and enough noise to bury a real
   * error in the logs.
   *
   * Checked before inserting rather than caught after, because the throw is
   * the expensive part.
   */
  const byUrl = jobData.job_url
    ? await query('SELECT id FROM jobs WHERE job_url = $1 LIMIT 1', [jobData.job_url])
    : { rows: [] };
  if (byUrl.rows.length > 0) {
    await query(
      `UPDATE jobs SET ${UPDATE_FIELDS_SQL} WHERE id = $${UPDATE_FIELDS_PARAM_COUNT + 1}`,
      [...updateFieldsParams(jobData), byUrl.rows[0].id]
    );
    return { id: byUrl.rows[0].id, isNew: false, isDuplicateMerge: false };
  }

  const duplicateId = await findCrossSourceDuplicate(jobData.title, jobData.company_name, jobData.posted_at);
  if (duplicateId) {
    await query(
      'UPDATE jobs SET fetched_at = CURRENT_TIMESTAMP, is_active = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [duplicateId]
    );
    return { id: duplicateId, isNew: false, isDuplicateMerge: true };
  }

  const result = await query(
    `INSERT INTO jobs (
      source, external_id, title, company_name, company_url, job_url,
      description, requirements, salary_min, salary_max, currency,
      job_type, work_arrangement, location, country, posted_at, apply_url
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    ON CONFLICT (source, external_id) DO UPDATE
    SET title = EXCLUDED.title, company_name = EXCLUDED.company_name,
        company_url = EXCLUDED.company_url, job_url = EXCLUDED.job_url,
        description = EXCLUDED.description, requirements = EXCLUDED.requirements,
        salary_min = EXCLUDED.salary_min, salary_max = EXCLUDED.salary_max,
        currency = EXCLUDED.currency, job_type = EXCLUDED.job_type,
        work_arrangement = EXCLUDED.work_arrangement, location = EXCLUDED.location,
        country = EXCLUDED.country, posted_at = EXCLUDED.posted_at,
        apply_url = COALESCE(EXCLUDED.apply_url, jobs.apply_url),
        fetched_at = CURRENT_TIMESTAMP, is_active = true, updated_at = CURRENT_TIMESTAMP
    RETURNING id`,
    [
      jobData.source, jobData.external_id, jobData.title, jobData.company_name,
      jobData.company_url, jobData.job_url, jobData.description, jobData.requirements,
      jobData.salary_min, jobData.salary_max, jobData.currency,
      jobData.job_type, jobData.work_arrangement, jobData.location, jobData.country,
      jobData.posted_at, jobData.apply_url,
    ]
  );

  return { id: result.rows[0].id, isNew: true, isDuplicateMerge: false };
};

const storeJobsFromSource = async (rawJobs, source, results) => {
  const sourceStats = { fetched: rawJobs.length, new: 0, updated: 0, merged: 0 };

  for (const job of rawJobs) {
    const normalized = normalizeJob(job, source);

    if (!normalized.external_id || !normalized.job_url) {
      continue; // skip malformed entries rather than failing the whole batch
    }

    /*
     * A7.2 — a field that did not parse must not be stored.
     *
     * The old gate tested truthiness only, so the literal string 'name' passed
     * it: himalayas wrote company_name = 'name' on roughly a fifth of its
     * ~4,900 rows, and a job card rendered `name - Philippines` as an employer.
     * A2c stopped users seeing it; this stops it being written.
     *
     * Withheld, not repaired: there is nothing to repair it FROM. A row whose
     * employer is unknown is not a job posting a user can act on, and inventing
     * one would be the very fabrication this guards against. Counted so the
     * drop is visible - a silent skip is how the first one went unnoticed.
     */
    /*
     * A7.2 + A7.12 — withhold anything that is not a job posting.
     *
     * A7.2 caught fields that did not parse. A7.12 caught the worse case: a
     * candidate's own bio indexed as a job with a working Apply button, and
     * four siblings resolving to the one enabled ATS adapter. Applying to a
     * person is a real submission that cannot be taken back, so this refuses
     * the row entirely rather than storing it for a render guard to hide.
     */
    const rejection = notAJobReason(normalized);
    if (rejection) {
      sourceStats.notAJob = sourceStats.notAJob || {};
      sourceStats.notAJob[rejection] = (sourceStats.notAJob[rejection] || 0) + 1;
      continue;
    }

    try {
      const stored = await storeJob(normalized);
      results.total++;
      if (stored.isNew) {
        results.new++;
        sourceStats.new++;
      } else if (stored.isDuplicateMerge) {
        results.merged++;
        sourceStats.merged++;
      } else {
        results.updated++;
        sourceStats.updated++;
      }
    } catch (err) {
      console.error(`Error storing job ${normalized.external_id} from ${source}:`, err.message);
    }
  }

  return sourceStats;
};

const recordIngestionRun = async (run) => {
  try {
    await query(
      `INSERT INTO source_ingestion_runs
       (source, started_at, finished_at, duration_ms, jobs_fetched, jobs_new, jobs_updated, success, retried, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        run.source, run.startedAt, run.finishedAt, run.durationMs,
        run.jobsFetched, run.jobsNew, run.jobsUpdated, run.success, run.retried, run.errorMessage || null,
      ]
    );
  } catch (err) {
    console.error('Failed to record ingestion run:', err.message);
  }
};

// Fetches + stores one source, retrying once immediately on failure before
// giving up for this cycle (it'll also be retried naturally on the next
// scheduled cycle regardless).
const runSource = async ({ key, fetchJobs, streams }, results, attempt = 1) => {
  const startedAt = new Date();
  try {
    /*
     * A streaming source writes each window as it arrives and never holds the
     * whole catalogue. Stats are summed across batches so the log line and the
     * ingestion record say the same thing they always did.
     */
    let stats;
    if (streams) {
      stats = { fetched: 0, new: 0, updated: 0, merged: 0 };
      await fetchJobs(async (batch) => {
        const s = await storeJobsFromSource(batch, key, results);
        stats.fetched += s.fetched;
        stats.new += s.new;
        stats.updated += s.updated;
        stats.merged += s.merged;
        for (const [k, v] of Object.entries(s.notAJob || {})) {
          stats.notAJob = stats.notAJob || {};
          stats.notAJob[k] = (stats.notAJob[k] || 0) + v;
        }
      });
    } else {
      const rawJobs = await fetchJobs();
      stats = await storeJobsFromSource(rawJobs, key, results);
    }
    const finishedAt = new Date();
    await recordIngestionRun({
      source: key,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      jobsFetched: stats.fetched,
      jobsNew: stats.new,
      jobsUpdated: stats.updated + stats.merged,
      success: true,
      retried: attempt > 1,
    });
    console.log(`${key}: ${stats.fetched} fetched, ${stats.new} new, ${stats.merged} merged as duplicates, ${stats.updated} refreshed`);
  } catch (err) {
    console.error(`${key} error (attempt ${attempt}):`, err.message);
    if (attempt === 1) {
      await runSource({ key, fetchJobs }, results, 2);
      return;
    }
    const finishedAt = new Date();
    await recordIngestionRun({
      source: key,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      jobsFetched: 0,
      jobsNew: 0,
      jobsUpdated: 0,
      success: false,
      retried: true,
      errorMessage: err.message,
    });
    results.errors.push({ source: key, error: err.message });
  }
};

const aggregateJobs = async () => {
  console.log('Starting job aggregation across', SOURCES.length, 'sources...');
  const results = { total: 0, new: 0, updated: 0, merged: 0, errors: [] };

  // Sources run independently and in parallel - one failing (even after its
  // retry) never blocks or delays the others.
  /*
   * GOAL 1d — ONE SOURCE AT A TIME. This was Promise.all over all twelve.
   *
   * Every source's fetch resolves to an array of its rows WITH descriptions,
   * and Promise.all held all twelve of those arrays alive simultaneously -
   * himalayas alone pulls 200 postings across 10 pages. The container ceiling
   * is 1 GB (Railway trial plan limit, confirmed in the dashboard), the
   * service idles near 700 MB, and the deploy logs at every death show
   * remoteok, himalayas and jobicy fetching at the same moment. Concurrency
   * here bought nothing - ingest runs on a timer, nobody waits for it - and
   * cost the peak that kills the process.
   *
   * Sequential means at most ONE source's rows are resident at a time, and the
   * previous array is unreachable before the next fetch begins.
   */
  mem('aggregate:start', { sources: SOURCES.length });
  for (const source of SOURCES) {
    await runSource(source, results);
    // Per source, because "one source at a time" is only a bound if each one
    // is actually released before the next begins.
    mem(`aggregate:after ${source.key || source.name || 'source'}`, { total: results.total });
  }

  // Mark jobs as inactive if not updated in last 7 days
  try {
    await query(
      "UPDATE jobs SET is_active = false WHERE fetched_at < CURRENT_TIMESTAMP - INTERVAL '7 days'",
      []
    );
  } catch (err) {
    console.error('Error marking stale jobs as inactive:', err);
  }

  mem('aggregate:before prune');
  await pruneStaleJobs(results);
  await pruneOperationalLogs(results);
  mem('aggregate:after prune');

  console.log('Aggregation complete:', results);
  return results;
};

// Retention. Previously jobs were only ever flagged is_active = false and
// never removed, so the table grew without bound on every 6-hourly cycle -
// which is what eventually filled the database volume to 100% and crash-
// looped Postgres (it could no longer write WAL). Job rows are a refetchable
// cache, so anything long-stale and not referenced by real user data is
// safe to drop.
//
// Rows referenced by a user's own records are always kept, regardless of
// age: those FKs are ON DELETE CASCADE, so deleting such a job would
// silently destroy the user's application history along with it.
const PRUNE_AFTER_DAYS = parseInt(process.env.JOB_RETENTION_DAYS || '21', 10);

/*
 * GOAL 1g — retention for the tables that only ever grow.
 *
 * jobs has had a 21-day policy since the volume filled once before. Nothing
 * else did. Measured on production: source_ingestion_runs held 6,140 rows and
 * gains one per source per cycle - twelve sources, four cycles a day, forever.
 * crash_reports is worse and it is mine: the watchdog writes a memory sample
 * every five minutes, which is ~288 rows a day added by the very thing built
 * to diagnose a full disk.
 *
 * A full volume stops WRITES - no ingest, no application records, no crash
 * reports - silently. A diagnostic table that fills the disk it exists to
 * watch would be the purest form of this whole week's lesson.
 *
 * Crash rows are kept longer than samples, and the most recent are kept
 * whatever their age: the reason a process died six weeks ago is still the
 * only record of it.
 */
const LOG_RETENTION_DAYS = parseInt(process.env.LOG_RETENTION_DAYS || '30', 10);
const CRASH_KEEP_RECENT = parseInt(process.env.CRASH_KEEP_RECENT || '200', 10);

const pruneOperationalLogs = async (results) => {
  try {
    const runs = await query(
      `DELETE FROM source_ingestion_runs
        WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '${LOG_RETENTION_DAYS} days'`
    );

    // Memory samples are a trend and age out. Crashes are evidence: the newest
    // CRASH_KEEP_RECENT survive regardless of age.
    const samples = await query(
      `DELETE FROM crash_reports
        WHERE event = 'memory'
          AND occurred_at < CURRENT_TIMESTAMP - INTERVAL '${LOG_RETENTION_DAYS} days'`
    );
    const crashes = await query(
      `DELETE FROM crash_reports
        WHERE event <> 'memory'
          AND id NOT IN (
            SELECT id FROM crash_reports WHERE event <> 'memory'
             ORDER BY occurred_at DESC LIMIT ${CRASH_KEEP_RECENT}
          )
          AND occurred_at < CURRENT_TIMESTAMP - INTERVAL '${LOG_RETENTION_DAYS} days'`
    );

    const pruned = (runs.rowCount || 0) + (samples.rowCount || 0) + (crashes.rowCount || 0);
    if (pruned) console.log(`Retention: pruned ${pruned} operational log rows`);
    if (results) results.logRowsPruned = pruned;
  } catch (err) {
    // Retention failing must never stop ingest - it is housekeeping, not the job.
    console.error('Operational log retention failed:', err.message);
  }
};

const pruneStaleJobs = async (results) => {
  try {
    const res = await query(
      `DELETE FROM jobs j
        WHERE j.is_active = false
          AND j.fetched_at < CURRENT_TIMESTAMP - INTERVAL '${PRUNE_AFTER_DAYS} days'
          AND NOT EXISTS (SELECT 1 FROM applications     x WHERE x.job_id = j.id)
          AND NOT EXISTS (SELECT 1 FROM tailored_resumes x WHERE x.job_id = j.id)
          AND NOT EXISTS (SELECT 1 FROM cover_letters    x WHERE x.job_id = j.id)
          AND NOT EXISTS (SELECT 1 FROM saved_jobs       x WHERE x.job_id = j.id)
          AND NOT EXISTS (SELECT 1 FROM agent_matches    x WHERE x.job_id = j.id)
          AND NOT EXISTS (SELECT 1 FROM referrals        x WHERE x.job_id = j.id)`
    );
    results.pruned = res.rowCount;
    if (res.rowCount) console.log(`Pruned ${res.rowCount} stale unreferenced jobs`);
  } catch (err) {
    console.error('Error pruning stale jobs:', err.message);
  }
};

module.exports = {
  aggregateJobs,
  SOURCES,
};
