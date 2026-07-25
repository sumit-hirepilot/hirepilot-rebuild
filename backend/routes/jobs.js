const express = require('express');
const { query } = require('../db');
const { verifyToken } = require('../middleware/auth');
const { aggregateJobs, SOURCES } = require('../services/jobAggregator');
const { fixMojibake } = require('../services/apis/textSanitizer');
const { buildSearchTiering, buildExcludeCondition } = require('../services/jobSearch');

const router = express.Router();

let aggregationInFlight = false;

function classifyExperience(title) {
  const t = (title || '').toLowerCase();
  if (/(staff|principal|distinguished)/.test(t)) return 'staff';
  if (/(senior|sr\.?|lead|head of)/.test(t)) return 'senior';
  if (/(junior|jr\.?|entry|intern|graduate)/.test(t)) return 'entry';
  return 'mid';
}

// Defense in depth: repair any mojibake that slipped through ingestion or
// survived the one-time migration (e.g. a batch that partially failed),
// so the API never serves corrupted text regardless of DB state.
function sanitizeJob(job) {
  if (!job) return job;
  return {
    ...job,
    title: fixMojibake(job.title),
    company_name: fixMojibake(job.company_name),
    location: fixMojibake(job.location),
    description: fixMojibake(job.description),
    requirements: fixMojibake(job.requirements),
  };
}

// Manually trigger job aggregation (also runs automatically every 6 hours)
router.post('/refresh', verifyToken, async (req, res) => {
  if (aggregationInFlight) {
    return res.status(409).json({ error: 'A refresh is already in progress' });
  }

  aggregationInFlight = true;
  try {
    const result = await aggregateJobs();
    res.json(result);
  } catch (err) {
    console.error('Manual job refresh error:', err);
    res.status(500).json({ error: 'Failed to refresh jobs' });
  } finally {
    aggregationInFlight = false;
  }
});

const ALL_SOURCES = [
  ...SOURCES.map((s) => s.key),
  'weworkremotely', // intentionally not fetched - see SOURCES.md
];

// Status + health of each live job source: active job count, last successful
// fetch, and recent ingestion run metrics (latency, success rate, errors).
router.get('/sources', async (req, res) => {
  try {
    const [countsResult, runsResult] = await Promise.all([
      query(
        `SELECT source, COUNT(*) as count, MAX(fetched_at) as last_fetched
         FROM jobs WHERE is_active = true GROUP BY source`
      ),
      query(
        `SELECT DISTINCT ON (source) source, started_at, duration_ms, success,
                jobs_fetched, jobs_new, error_message
         FROM source_ingestion_runs
         ORDER BY source, created_at DESC`
      ),
    ]);

    const bySource = {};
    for (const row of countsResult.rows) {
      bySource[row.source] = { count: parseInt(row.count, 10), lastFetched: row.last_fetched };
    }

    const runsBySource = {};
    for (const row of runsResult.rows) {
      runsBySource[row.source] = row;
    }

    // Success rate over the last 20 runs per source
    const successRates = {};
    for (const key of SOURCES.map((s) => s.key)) {
      const recentRuns = await query(
        `SELECT success FROM source_ingestion_runs WHERE source = $1 ORDER BY created_at DESC LIMIT 20`,
        [key]
      );
      const total = recentRuns.rows.length;
      const succeeded = recentRuns.rows.filter((r) => r.success).length;
      successRates[key] = total > 0 ? Math.round((succeeded / total) * 100) : null;
    }

    const sources = ALL_SOURCES.map((key) => {
      const lastRun = runsBySource[key];
      return {
        source: key,
        count: bySource[key]?.count || 0,
        lastFetched: bySource[key]?.lastFetched || null,
        lastRunSuccess: lastRun ? lastRun.success : null,
        lastRunDurationMs: lastRun ? lastRun.duration_ms : null,
        lastRunError: lastRun && !lastRun.success ? lastRun.error_message : null,
        successRatePct: successRates[key] ?? null,
      };
    });

    res.json({ sources });
  } catch (err) {
    console.error('Get sources error:', err);
    res.status(500).json({ error: 'Failed to fetch source status' });
  }
});

// Get all active jobs with pagination and filters
const JOB_COLUMNS = `id, source, title, company_name, company_url, job_url, location, work_arrangement,
              salary_min, salary_max, job_type, posted_at, created_at`;

router.get('/', async (req, res) => {
  try {
    const {
      page = 1, limit = 20, search, source, location, experience, includeRelated,
      scope, datePosted, jobType, company,
    } = req.query;
    const offset = (page - 1) * limit;

    // Multiple keyword "chips" - accepts repeated ?keywords=X&keywords=Y, or
    // falls back to the single ?search= param for backward compatibility
    // (search agents and other internal callers still use `search`).
    const rawKeywords = req.query.keywords;
    const keywords = rawKeywords
      ? (Array.isArray(rawKeywords) ? rawKeywords : [rawKeywords])
      : (search ? [search] : []);

    const rawExclude = req.query.exclude;
    const excludeTerms = rawExclude ? (Array.isArray(rawExclude) ? rawExclude : [rawExclude]) : [];

    const params = [];
    let filterClause = 'is_active = true';

    if (source) {
      params.push(source);
      filterClause += ` AND source = $${params.length}`;
    }

    if (location) {
      params.push(`%${location}%`);
      filterClause += ` AND location ILIKE $${params.length}`;
    }

    if (company) {
      params.push(`%${company}%`);
      filterClause += ` AND company_name ILIKE $${params.length}`;
    }

    if (jobType) {
      params.push(jobType);
      filterClause += ` AND job_type = $${params.length}`;
    }

    if (datePosted) {
      const intervalMap = { '24h': '1 day', '3d': '3 days', '7d': '7 days', '30d': '30 days' };
      const interval = intervalMap[datePosted];
      if (interval) filterClause += ` AND posted_at >= CURRENT_TIMESTAMP - INTERVAL '${interval}'`;
    }

    if (experience === 'senior') {
      filterClause += ` AND title ~* '(senior|sr\\.?|lead|head of)'`;
    } else if (experience === 'staff') {
      filterClause += ` AND title ~* '(staff|principal|distinguished)'`;
    } else if (experience === 'entry') {
      filterClause += ` AND title ~* '(junior|jr\\.?|entry|intern|graduate)'`;
    } else if (experience === 'mid') {
      filterClause += ` AND title !~* '(senior|sr\\.?|lead|head of|staff|principal|distinguished|junior|jr\\.?|entry|intern|graduate)'`;
    }

    const excludeCondition = buildExcludeCondition(excludeTerms, params);
    if (excludeCondition) filterClause += ` AND ${excludeCondition}`;

    let jobs = [];
    let total = 0;
    let relatedJobs = [];
    let relatedTotal = 0;
    let noExactMatches = false;

    if (keywords.some((k) => k && k.trim())) {
      // Rank exact title matches (tier 1) above title-word matches (tier 2)
      // above broad title-or-description matches (tier 3, "related" -
      // excluded from the default result set entirely unless requested).
      //
      // Every query below shares the same `params` array (filter params +
      // all tiering params) and always computes match_tier via the same CTE,
      // even the ones that only filter on it - Postgres requires every bound
      // parameter to actually appear in the query, so a COUNT query that
      // dropped the tier-3-only params while still receiving the full array
      // would error. Routing everything through one CTE keeps every query
      // referencing every param, consistently.
      const tiering = buildSearchTiering(keywords, params, { scope });
      const wantRelated = includeRelated === 'true';

      const scoredCte = `WITH scored AS (
        SELECT ${JOB_COLUMNS}, ${tiering.tierCaseExpr} as match_tier
        FROM jobs WHERE ${filterClause}
      )`;
      const tierFilter = wantRelated ? 'match_tier <= 3' : 'match_tier <= 2';

      const countResult = await query(
        `${scoredCte} SELECT COUNT(*) as count FROM scored WHERE ${tierFilter}`,
        params
      );
      total = parseInt(countResult.rows[0].count, 10);

      const result = await query(
        `${scoredCte} SELECT * FROM scored WHERE ${tierFilter}
         ORDER BY match_tier ASC, posted_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );
      jobs = result.rows;

      if (!wantRelated && total === 0) {
        noExactMatches = true;
        const relatedCountResult = await query(
          `${scoredCte} SELECT COUNT(*) as count FROM scored WHERE match_tier = 3`,
          params
        );
        relatedTotal = parseInt(relatedCountResult.rows[0].count, 10);

        const relatedResult = await query(
          `${scoredCte} SELECT * FROM scored WHERE match_tier = 3
           ORDER BY posted_at DESC
           LIMIT $${params.length + 1}`,
          [...params, limit]
        );
        relatedJobs = relatedResult.rows;
      }
    } else {
      const countResult = await query(`SELECT COUNT(*) as count FROM jobs WHERE ${filterClause}`, params);
      total = parseInt(countResult.rows[0].count, 10);

      const result = await query(
        `SELECT ${JOB_COLUMNS}
         FROM jobs WHERE ${filterClause}
         ORDER BY posted_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );
      jobs = result.rows;
    }

    const decorate = (list) => list.map((j) => ({ ...sanitizeJob(j), experienceLevel: classifyExperience(j.title) }));

    res.json({
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      jobs: decorate(jobs),
      noExactMatches,
      relatedJobs: decorate(relatedJobs),
      relatedTotal,
    });
  } catch (err) {
    console.error('Get jobs error:', err);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

// --- Saved Jobs ---

router.get('/saved/list', verifyToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT sj.id as saved_id, sj.created_at as saved_at,
              j.id, j.source, j.title, j.company_name, j.company_url, j.job_url,
              j.location, j.work_arrangement, j.salary_min, j.salary_max, j.job_type, j.posted_at
       FROM saved_jobs sj
       JOIN jobs j ON sj.job_id = j.id
       WHERE sj.user_id = $1
       ORDER BY sj.created_at DESC`,
      [req.user.id]
    );
    res.json({ jobs: result.rows.map((j) => ({ ...sanitizeJob(j), experienceLevel: classifyExperience(j.title) })) });
  } catch (err) {
    console.error('List saved jobs error:', err);
    res.status(500).json({ error: 'Failed to fetch saved jobs' });
  }
});

router.post('/:id/save', verifyToken, async (req, res) => {
  try {
    const jobResult = await query('SELECT id, title, company_name FROM jobs WHERE id = $1', [req.params.id]);
    if (!jobResult.rows.length) return res.status(404).json({ error: 'Job not found' });
    const job = jobResult.rows[0];

    const inserted = await query(
      `INSERT INTO saved_jobs (user_id, job_id) VALUES ($1, $2)
       ON CONFLICT (user_id, job_id) DO NOTHING RETURNING id`,
      [req.user.id, req.params.id]
    );

    if (inserted.rows.length) {
      await query(
        `INSERT INTO activity_log (user_id, event_type, job_id, metadata)
         VALUES ($1, 'job_saved', $2, $3)`,
        [req.user.id, req.params.id, JSON.stringify({ job_title: job.title, company_name: job.company_name })]
      );
    }

    res.status(201).json({ message: 'Job saved' });
  } catch (err) {
    console.error('Save job error:', err);
    res.status(500).json({ error: 'Failed to save job' });
  }
});

router.delete('/:id/save', verifyToken, async (req, res) => {
  try {
    await query('DELETE FROM saved_jobs WHERE user_id = $1 AND job_id = $2', [req.user.id, req.params.id]);
    res.json({ message: 'Job unsaved' });
  } catch (err) {
    console.error('Unsave job error:', err);
    res.status(500).json({ error: 'Failed to unsave job' });
  }
});

// Get specific job
router.get('/:id', async (req, res) => {
  try {
    const result = await query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({ ...sanitizeJob(result.rows[0]), experienceLevel: classifyExperience(result.rows[0].title) });
  } catch (err) {
    console.error('Get job error:', err);
    res.status(500).json({ error: 'Failed to fetch job' });
  }
});

module.exports = router;
