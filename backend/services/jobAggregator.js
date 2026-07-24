const { query } = require('../db');
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
  { key: 'nofluffjobs', fetchJobs: nofluffjobsClient.fetchJobs },
  { key: 'landingjobs', fetchJobs: landingjobsClient.fetchJobs },
  { key: 'workingnomads', fetchJobs: workingnomadsClient.fetchJobs },
  { key: 'jobicy', fetchJobs: jobicyClient.fetchJobs },
  { key: 'jobindex', fetchJobs: jobindexClient.fetchJobs },
  { key: 'greenhouse', fetchJobs: atsClient.fetchGreenhouseJobs },
  { key: 'lever', fetchJobs: atsClient.fetchLeverJobs },
  { key: 'ashby', fetchJobs: atsClient.fetchAshbyJobs },
  // Note: We Work Remotely is intentionally not fetched - their site is
  // behind Cloudflare bot protection and cannot be accessed server-side
  // without circumventing it, which we won't do.
];

const normalizeJob = (job, source) => {
  const rawDate = job.posted_at || job.postedAt;
  const parsedDate = rawDate ? new Date(rawDate) : new Date();
  const postedAt = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;

  return {
    source,
    external_id: job.external_id || job.id || job.jobId,
    title: job.title || job.jobTitle,
    company_name: job.company || job.companyName,
    company_url: job.company_url || job.companyUrl,
    job_url: job.url || job.job_url || job.jobUrl,
    description: job.description || job.jobDescription,
    requirements: job.requirements || '',
    salary_min: job.salary_min || job.salaryMin || null,
    salary_max: job.salary_max || job.salaryMax || null,
    currency: job.currency || 'USD',
    job_type: job.job_type || job.jobType || 'full-time',
    work_arrangement: job.work_arrangement || job.workArrangement || 'remote',
    location: job.location || job.city || '',
    country: job.country || '',
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

const storeJob = async (jobData) => {
  const existing = await query(
    'SELECT id FROM jobs WHERE source = $1 AND external_id = $2',
    [jobData.source, jobData.external_id]
  );

  if (existing.rows.length > 0) {
    // Update only fetched_at, never reset posted_at (CRITICAL for staleness bug fix)
    await query(
      'UPDATE jobs SET fetched_at = CURRENT_TIMESTAMP, is_active = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [existing.rows[0].id]
    );
    return { id: existing.rows[0].id, isNew: false, isDuplicateMerge: false };
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
      job_type, work_arrangement, location, country, posted_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    ON CONFLICT (source, external_id) DO UPDATE
    SET fetched_at = CURRENT_TIMESTAMP, is_active = true, updated_at = CURRENT_TIMESTAMP
    RETURNING id`,
    [
      jobData.source, jobData.external_id, jobData.title, jobData.company_name,
      jobData.company_url, jobData.job_url, jobData.description, jobData.requirements,
      jobData.salary_min, jobData.salary_max, jobData.currency,
      jobData.job_type, jobData.work_arrangement, jobData.location, jobData.country,
      jobData.posted_at,
    ]
  );

  return { id: result.rows[0].id, isNew: true, isDuplicateMerge: false };
};

const storeJobsFromSource = async (rawJobs, source, results) => {
  const sourceStats = { fetched: rawJobs.length, new: 0, updated: 0, merged: 0 };

  for (const job of rawJobs) {
    const normalized = normalizeJob(job, source);

    if (!normalized.external_id || !normalized.title || !normalized.company_name || !normalized.job_url) {
      continue; // skip malformed entries rather than failing the whole batch
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
const runSource = async ({ key, fetchJobs }, results, attempt = 1) => {
  const startedAt = new Date();
  try {
    const rawJobs = await fetchJobs();
    const stats = await storeJobsFromSource(rawJobs, key, results);
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
  await Promise.all(SOURCES.map((source) => runSource(source, results)));

  // Mark jobs as inactive if not updated in last 7 days
  try {
    await query(
      "UPDATE jobs SET is_active = false WHERE fetched_at < CURRENT_TIMESTAMP - INTERVAL '7 days'",
      []
    );
  } catch (err) {
    console.error('Error marking stale jobs as inactive:', err);
  }

  console.log('Aggregation complete:', results);
  return results;
};

module.exports = {
  aggregateJobs,
  SOURCES,
};
