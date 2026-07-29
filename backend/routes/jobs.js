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
// Canonical job_type values. Sources spell the same thing several ways
// ("full-time", "fulltime", "Full Time", "full_time"), which fragmented the
// facet and made the exact-match filter silently miss thousands of rows -
// selecting "Full-time" matched 12,473 of the 16,789 jobs that actually are
// full-time. Normalising at query time keeps already-stored rows correct
// without a migration.
const JOB_TYPE_SQL = `CASE
    WHEN lower(regexp_replace(COALESCE(job_type,''), '[^a-z]', '', 'gi')) IN ('fulltime') THEN 'full-time'
    WHEN lower(regexp_replace(COALESCE(job_type,''), '[^a-z]', '', 'gi')) IN ('parttime') THEN 'part-time'
    WHEN lower(regexp_replace(COALESCE(job_type,''), '[^a-z]', '', 'gi')) IN ('contract','contractor','b2b') THEN 'contract'
    WHEN lower(regexp_replace(COALESCE(job_type,''), '[^a-z]', '', 'gi')) IN ('internship','intern') THEN 'internship'
    WHEN COALESCE(job_type,'') = '' THEN 'unspecified'
    ELSE lower(job_type)
  END`;

// Approximate FX to USD so salaries from mixed-currency sources can be
// compared and bucketed. These are static reference rates, not live: they are
// good enough to sort a job into a broad band, and every surface that uses
// them labels the figure "approx". They are deliberately NOT used to display a
// precise converted salary, which would imply accuracy this doesn't have.
const USD_RATES = {
  USD: 1, EUR: 1.08, GBP: 1.27, CHF: 1.12, CAD: 0.73, AUD: 0.66,
  PLN: 0.25, CZK: 0.043, HUF: 0.0028, SEK: 0.095, NOK: 0.093, DKK: 0.145,
  INR: 0.012, BRL: 0.18, MXN: 0.05, ZAR: 0.055, SGD: 0.74, JPY: 0.0064,
};
const USD_CASE = `CASE COALESCE(NULLIF(currency,''),'USD') ${
  Object.entries(USD_RATES).map(([c, r]) => `WHEN '${c}' THEN ${r}`).join(' ')
} ELSE NULL END`;
// Period normalisation is per SOURCE, not per magnitude. NoFluffJobs quotes
// monthly pay in every currency it carries (PLN ~20.7k, HUF ~1.17m, EUR ~4.2k,
// USD ~4.9k, CZK ~85k per month); every other source quotes annual figures
// (Himalayas USD ~97.6k, Jobicy ~133k, Landing.jobs EUR ~49k per year).
//
// An earlier version guessed "monthly" from a low converted value, which
// failed exactly where it mattered: 20,671 PLN/month converts to ~$5.2k,
// comfortably above any sane threshold, so ~2,400 Polish jobs were read as
// $5k-a-year and swept into the lowest band.
const MONTHLY_SOURCES = ['nofluffjobs'];
const SALARY_USD = `(salary_min * ${USD_CASE} * CASE WHEN source IN (${
  MONTHLY_SOURCES.map((s) => `'${s}'`).join(', ')
}) THEN 12 ELSE 1 END)`;

const SALARY_BANDS = [
  { value: 'lt50', label: 'Under $50K', min: null, max: 50000 },
  { value: '50-100', label: '$50K – $100K', min: 50000, max: 100000 },
  { value: '100-150', label: '$100K – $150K', min: 100000, max: 150000 },
  { value: '150-200', label: '$150K – $200K', min: 150000, max: 200000 },
  { value: 'gt200', label: '$200K+', min: 200000, max: null },
];

const bandCondition = (band) => {
  const b = SALARY_BANDS.find((x) => x.value === band);
  if (!b) return null;
  const parts = ['salary_min IS NOT NULL', `${USD_CASE} IS NOT NULL`];
  if (b.min !== null) parts.push(`${SALARY_USD} >= ${b.min}`);
  if (b.max !== null) parts.push(`${SALARY_USD} < ${b.max}`);
  return `(${parts.join(' AND ')})`;
};

// Pull contact addresses that the employer actually published in the posting
// text. These are real, verifiable, and already public in the job ad.
//
// Deliberately NOT guessed: no first.last@company.com construction, no
// pattern inference. A guessed address either bounces - leaving someone
// believing they contacted a hiring manager when they did not - or reaches a
// real person who has nothing to do with the role. Only addresses genuinely
// present in the source text are returned.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Addresses that are published but are not application contacts.
const EMAIL_NOISE = /(noreply|no-reply|donotreply|privacy|legal|abuse|security|unsubscribe|support@(wordpress|wixpress))/i;

function extractContactEmails(description) {
  if (!description) return [];
  const found = String(description).match(EMAIL_RE) || [];
  const seen = new Set();
  return found
    .map((e) => e.replace(/[.,;:)\]]+$/, '').toLowerCase())
    .filter((e) => {
      if (EMAIL_NOISE.test(e) || seen.has(e)) return false;
      seen.add(e);
      return true;
    })
    .slice(0, 3);
}

// Facet counts for the filter panels. Every count here is a real COUNT(*)
// over live rows - no estimates - so a filter never advertises results it
// cannot deliver.
router.get('/facets', async (req, res) => {
  try {
    const [workArrangement, jobType, salary, experience] = await Promise.all([
      query(`SELECT COALESCE(NULLIF(work_arrangement,''),'unknown') AS value, COUNT(*)::int AS count
             FROM jobs WHERE is_active = true GROUP BY 1 ORDER BY count DESC`),
      query(`SELECT ${JOB_TYPE_SQL} AS value, COUNT(*)::int AS count
             FROM jobs WHERE is_active = true GROUP BY 1 ORDER BY count DESC`),
      query(`SELECT
               ${SALARY_BANDS.map((b) => `COUNT(*) FILTER (WHERE ${bandCondition(b.value)})::int AS "${b.value}"`).join(',\n               ')},
               COUNT(*) FILTER (WHERE salary_min IS NULL)::int AS not_listed
             FROM jobs WHERE is_active = true`),
      query(`SELECT
               COUNT(*) FILTER (WHERE title ~* '(junior|jr\\.?|entry|intern|graduate)')::int AS entry,
               COUNT(*) FILTER (WHERE title ~* '(senior|sr\\.?|lead|head of)')::int AS senior,
               COUNT(*) FILTER (WHERE title ~* '(staff|principal|distinguished)')::int AS staff
             FROM jobs WHERE is_active = true`),
    ]);

    const exp = experience.rows[0];
    res.json({
      workArrangement: workArrangement.rows,
      jobType: jobType.rows,
      // Bands are USD-equivalent via static reference rates - the frontend
      // labels them "approx" for that reason.
      salary: [
        ...SALARY_BANDS.map((b) => ({ value: b.value, label: b.label, count: salary.rows[0][b.value] })),
        { value: 'not_listed', label: 'No salary published', count: salary.rows[0].not_listed },
      ],
      experience: [
        { value: 'entry', count: exp.entry },
        { value: 'senior', count: exp.senior },
        { value: 'staff', count: exp.staff },
      ],
    });
  } catch (err) {
    console.error('Get facets error:', err);
    res.status(500).json({ error: 'Failed to fetch filter facets' });
  }
});

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

    // Multi-select facets. Each accepts repeated params
    // (?jobType=full-time&jobType=contract) and OR's within a facet while
    // AND'ing across facets, which is the behaviour a checkbox filter panel
    // implies. Single values still work, so existing callers are unaffected.
    const asArray = (v) => (v === undefined ? [] : (Array.isArray(v) ? v : [v])).filter(Boolean);

    const jobTypes = asArray(jobType);
    if (jobTypes.length) {
      // Compare against the normalised expression, not the raw column - the
      // raw values are fragmented across several spellings per type.
      const ph = jobTypes.map((t) => { params.push(t); return `$${params.length}`; });
      filterClause += ` AND ${JOB_TYPE_SQL} IN (${ph.join(', ')})`;
    }

    const workArrangements = asArray(req.query.workArrangement);
    if (workArrangements.length) {
      const ph = workArrangements.map((w) => { params.push(w); return `$${params.length}`; });
      filterClause += ` AND COALESCE(NULLIF(work_arrangement,''),'unknown') IN (${ph.join(', ')})`;
    }

    // Salary bands are USD-equivalent (mixed source currencies converted with
    // static reference rates). Multiple bands OR together.
    const salaryBands = asArray(req.query.salary);
    if (salaryBands.length) {
      const conds = salaryBands
        .map((b) => (b === 'not_listed' ? 'salary_min IS NULL' : bandCondition(b)))
        .filter(Boolean);
      if (conds.length) filterClause += ` AND (${conds.join(' OR ')})`;
    }

    // Kept separate from filterClause (rather than appended inline) so it
    // can be applied at the same point results are read while still
    // allowing a companion query for jobs with an unknown posted_at -
    // `posted_at >= ...` is neither true nor false against NULL, so those
    // jobs are silently dropped by this filter (correctly - we can't claim
    // an unknown-date job falls in the window), but the count of how many
    // were excluded for that reason needs to be surfaced, not silent.
    let dateFilterSql = '';
    if (datePosted) {
      const intervalMap = { '24h': '1 day', '3d': '3 days', '7d': '7 days', '30d': '30 days' };
      const interval = intervalMap[datePosted];
      if (interval) dateFilterSql = ` AND posted_at >= CURRENT_TIMESTAMP - INTERVAL '${interval}'`;
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
    let excludedUnknownDateCount = 0;

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
        `${scoredCte} SELECT COUNT(*) as count FROM scored WHERE ${tierFilter}${dateFilterSql}`,
        params
      );
      total = parseInt(countResult.rows[0].count, 10);

      const result = await query(
        `${scoredCte} SELECT * FROM scored WHERE ${tierFilter}${dateFilterSql}
         ORDER BY match_tier ASC, posted_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );
      jobs = result.rows;

      if (datePosted) {
        const unknownDateResult = await query(
          `${scoredCte} SELECT COUNT(*) as count FROM scored WHERE ${tierFilter} AND posted_at IS NULL`,
          params
        );
        excludedUnknownDateCount = parseInt(unknownDateResult.rows[0].count, 10);
      }

      if (!wantRelated && total === 0) {
        noExactMatches = true;
        const relatedCountResult = await query(
          `${scoredCte} SELECT COUNT(*) as count FROM scored WHERE match_tier = 3${dateFilterSql}`,
          params
        );
        relatedTotal = parseInt(relatedCountResult.rows[0].count, 10);

        const relatedResult = await query(
          `${scoredCte} SELECT * FROM scored WHERE match_tier = 3${dateFilterSql}
           ORDER BY posted_at DESC
           LIMIT $${params.length + 1}`,
          [...params, limit]
        );
        relatedJobs = relatedResult.rows;
      }
    } else {
      const countResult = await query(`SELECT COUNT(*) as count FROM jobs WHERE ${filterClause}${dateFilterSql}`, params);
      total = parseInt(countResult.rows[0].count, 10);

      const result = await query(
        `SELECT ${JOB_COLUMNS}
         FROM jobs WHERE ${filterClause}${dateFilterSql}
         ORDER BY posted_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );
      jobs = result.rows;

      if (datePosted) {
        const unknownDateResult = await query(
          `SELECT COUNT(*) as count FROM jobs WHERE ${filterClause} AND posted_at IS NULL`,
          params
        );
        excludedUnknownDateCount = parseInt(unknownDateResult.rows[0].count, 10);
      }
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
      excludedUnknownDateCount,
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

    res.json({
      ...sanitizeJob(result.rows[0]),
      experienceLevel: classifyExperience(result.rows[0].title),
      contactEmails: extractContactEmails(result.rows[0].description),
    });
  } catch (err) {
    console.error('Get job error:', err);
    res.status(500).json({ error: 'Failed to fetch job' });
  }
});

module.exports = router;
