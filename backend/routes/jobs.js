const express = require('express');
const { query } = require('../db');
const { verifyToken, attachUserIfPresent } = require('../middleware/auth');
const { aggregateJobs, SOURCES } = require('../services/jobAggregator');
const { fixMojibake } = require('../services/apis/textSanitizer');
const { buildSearchTiering, buildExcludeCondition } = require('../services/jobSearch');
const { extractSkills } = require('../services/resumeParser');
const { checkAts, buildAtsGuide } = require('../services/atsChecker');

// The user's resume text, used for per-job ATS scoring. Prefers the default
// resume, falling back to the most recently updated one - same precedence the
// tailoring flow uses, so a score and a tailored draft never disagree about
// which resume they were based on.
async function getResumeText(userId) {
  const r = await query(
    `SELECT original_file_text FROM resumes
     WHERE user_id = $1 AND original_file_text IS NOT NULL
     ORDER BY is_default DESC, updated_at DESC LIMIT 1`,
    [userId]
  );
  return r.rows[0]?.original_file_text || null;
}

const jobAtsText = (j) => `${j.title || ''} ${j.description || ''} ${j.requirements || ''}`;

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
/*
 * Region grouping for the Location filter.
 *
 * Derived from the free-text location, not from jobs.country: only 4,216 of
 * 18,290 active rows have country populated, so a country-based facet would
 * hide three quarters of the jobs. India is its own bucket rather than being
 * folded into Asia-Pacific because it is the most common case for this user
 * base and gets lost inside a region that large.
 *
 * Ordered most-specific-first: US state abbreviations are checked before the
 * bare-city patterns, and "Remote - US" must classify as North America rather
 * than falling through to the unknown bucket.
 */
const REGION_SQL = `CASE
  WHEN location ~* '(bengaluru|bangalore|mumbai|new delhi|delhi|hyderabad|pune|chennai|gurgaon|gurugram|noida|kolkata|ahmedabad|jaipur|india)' THEN 'india'
  WHEN location ~* '(united states|u\\.s\\.a?\\.?|\\bUSA\\b|remote *- *us|san francisco|new york|seattle|austin|boston|chicago|los angeles|denver|atlanta|portland|san diego|san jose|foster city|palo alto|mountain view|sunnyvale|santa clara|redmond|bellevue|washington|philadelphia|dallas|houston|phoenix|miami|minneapolis|detroit|pittsburgh|nashville|charlotte|raleigh|salt lake|boulder|toronto|vancouver|montreal|ottawa|calgary|canada|, *(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\\b)' THEN 'north_america'
  WHEN location ~* '(london|manchester|edinburgh|dublin|ireland|united kingdom|\\bUK\\b|england|scotland|wales|warszawa|warsaw|krak(o|ó)w|wroc(l|ł)aw|pozna(n|ń)|gda(n|ń)sk|katowice|(l|ł)(o|ó)d(z|ź)|poland|berlin|munich|m(u|ü)nchen|hamburg|frankfurt|cologne|germany|paris|lyon|france|amsterdam|rotterdam|utrecht|netherlands|madrid|barcelona|spain|lisbon|porto|portugal|milan|rome|italy|zurich|geneva|switzerland|vienna|austria|stockholm|sweden|copenhagen|denmark|oslo|norway|helsinki|finland|brussels|belgium|prague|czech|budapest|hungary|bucharest|romania|sofia|bulgaria|athens|greece|tallinn|estonia|riga|latvia|vilnius|lithuania|europe|\\bEMEA\\b)' THEN 'europe'
  WHEN location ~* '(singapore|sydney|melbourne|brisbane|perth|australia|auckland|wellington|new zealand|tokyo|osaka|japan|seoul|korea|beijing|shanghai|shenzhen|china|hong kong|taipei|taiwan|manila|philippines|jakarta|indonesia|bangkok|thailand|kuala lumpur|malaysia|ho chi minh|hanoi|vietnam|\\bAPAC\\b|asia)' THEN 'asia_pacific'
  WHEN location ~* '(s(a|ã)o paulo|rio de janeiro|brazil|brasil|mexico city|mexico|guadalajara|buenos aires|argentina|santiago|chile|bogot(a|á)|colombia|lima|peru|san jos(e|é), *costa rica|costa rica|montevideo|uruguay|panama|\\bLATAM\\b|latin america|south america)' THEN 'latin_america'
  WHEN location ~* '(dubai|abu dhabi|\\bUAE\\b|united arab emirates|riyadh|jeddah|saudi|doha|qatar|kuwait|manama|bahrain|muscat|oman|tel aviv|jerusalem|israel|cairo|egypt|casablanca|morocco|nairobi|kenya|lagos|abuja|nigeria|cape town|johannesburg|south africa|accra|ghana|africa|middle east)' THEN 'mea'
  ELSE 'unspecified'
END`;

const REGION_LABELS = {
  north_america: 'North America',
  europe: 'Europe',
  india: 'India',
  asia_pacific: 'Asia-Pacific',
  latin_america: 'Latin America',
  mea: 'Middle East & Africa',
  unspecified: 'Not specified / Remote',
};

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

// ATS keyword-coverage scores for a page of jobs, against the signed-in
// user's resume. Batched deliberately: the jobs list renders 20 rows, and one
// request beats 20 round trips.
router.post('/ats-batch', verifyToken, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.jobIds) ? req.body.jobIds.slice(0, 50) : [];
    if (!ids.length) return res.json({ scores: {}, hasResume: true });

    const resumeText = await getResumeText(req.user.id);
    // No resume means no honest score to give - say so rather than returning
    // zeros, which would read as "every job is a terrible match".
    if (!resumeText) return res.json({ scores: {}, hasResume: false });

    const jobs = await query(
      'SELECT id, title, description, requirements FROM jobs WHERE id = ANY($1::int[])',
      [ids]
    );

    const scores = {};
    for (const j of jobs.rows) {
      scores[j.id] = checkAts(jobAtsText(j), resumeText).score;
    }
    res.json({ scores, hasResume: true });
  } catch (err) {
    console.error('ATS batch error:', err);
    res.status(500).json({ error: 'Failed to score jobs' });
  }
});

// Full ATS breakdown plus guidance for one job.
router.get('/:id/ats', verifyToken, async (req, res) => {
  try {
    const jobRes = await query(
      'SELECT id, title, description, requirements FROM jobs WHERE id = $1',
      [req.params.id]
    );
    if (!jobRes.rows.length) return res.status(404).json({ error: 'Job not found' });

    const resumeText = await getResumeText(req.user.id);
    if (!resumeText) {
      return res.json({
        hasResume: false,
        message: 'Upload or paste a resume on the Resume page to see how it scores against this posting.',
      });
    }

    const result = checkAts(jobAtsText(jobRes.rows[0]), resumeText);
    res.json({
      hasResume: true,
      ...result,
      // The word lists are trimmed for payload size, so the true totals are
      // sent separately. Without these the client counts the trimmed array and
      // reports e.g. "matched 30 of 269" against a 16% score - 30/269 is 11%,
      // so the figures visibly contradict each other.
      matchedCount: result.matched.length,
      missingCount: result.missing.length,
      matched: result.matched.slice(0, 30),
      missing: result.missing.slice(0, 30),
      guide: buildAtsGuide(result, resumeText),
    });
  } catch (err) {
    console.error('ATS detail error:', err);
    res.status(500).json({ error: 'Failed to score this job' });
  }
});

// Facet counts for the filter panels. Every count here is a real COUNT(*)
// over live rows - no estimates - so a filter never advertises results it
// cannot deliver.
router.get('/facets', async (req, res) => {
  try {
    const [workArrangement, jobType, salary, experience, region] = await Promise.all([
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
      query(`SELECT ${REGION_SQL} AS value, COUNT(*)::int AS count
             FROM jobs WHERE is_active = true GROUP BY 1 ORDER BY count DESC`),
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
      region: region.rows.map((r) => ({
        value: r.value,
        label: REGION_LABELS[r.value] || r.value,
        count: r.count,
      })),
    });
  } catch (err) {
    console.error('Get facets error:', err);
    res.status(500).json({ error: 'Failed to fetch filter facets' });
  }
});

/*
 * Landing-page counters, as real integers.
 *
 * The hero rendered "—" for all three and a hardcoded "180+" for companies
 * watched. One was a placeholder nobody could read a number out of; the other
 * was a figure invented to look impressive, gated on a boolean so it appeared
 * whenever ANY direct-ATS source existed. Both are the same failure - a surface
 * a visitor reads as live, showing something that is not.
 *
 * Every field here is a COUNT(*) against the same rows the feed serves.
 * last_synced_at also answers the health check's poller-freshness question,
 * which /sources could not.
 */
/*
 * A7.2 — how many indexed jobs carry a field that never parsed.
 *
 * Reported rather than assumed: the render guard hides these from users, which
 * is exactly why the count has to be visible somewhere or the data rots
 * unnoticed. Aggregates only, no PII.
 */
router.get('/field-integrity', async (req, res) => {
  try {
    const placeholders = ['', '-', '--', 'n/a', 'na', 'none', 'null', 'undefined',
      'unknown', 'name', 'title', 'company', 'company_name', 'location', 'nan'];
    const { rows } = await query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE LOWER(TRIM(COALESCE(company_name,''))) = ANY($1))::int AS bad_company,
              COUNT(*) FILTER (WHERE LOWER(TRIM(COALESCE(title,''))) = ANY($1))::int        AS bad_title,
              COUNT(*) FILTER (WHERE LOWER(TRIM(COALESCE(location,''))) = ANY($1))::int     AS bad_location
         FROM jobs WHERE is_active = true`,
      [placeholders]
    );
    const { rows: bySource } = await query(
      `SELECT source, COUNT(*)::int AS bad
         FROM jobs
        WHERE is_active = true
          AND LOWER(TRIM(COALESCE(company_name,''))) = ANY($1)
        GROUP BY source ORDER BY bad DESC`,
      [placeholders]
    );
    res.json({ ...rows[0], badCompanyBySource: bySource });
  } catch (err) {
    console.error('Field integrity error:', err);
    res.status(500).json({ error: 'Failed to run the field integrity check' });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const [totals, direct, synced] = await Promise.all([
      query(`SELECT COUNT(*)::int AS jobs,
                    COUNT(DISTINCT source)::int AS sources,
                    COUNT(DISTINCT company_name)::int AS companies
               FROM jobs WHERE is_active = TRUE`),
      // "Watched directly" means the company's OWN board is polled through its
      // ATS's public API - not a job that happens to be listed on an aggregator.
      query(`SELECT COUNT(DISTINCT company_name)::int AS n
               FROM jobs
              WHERE is_active = TRUE AND source = ANY($1::text[])`,
      [['greenhouse', 'lever', 'ashby']]),
      query('SELECT MAX(fetched_at) AS last FROM jobs'),
    ]);

    res.set('Cache-Control', 'public, max-age=120');
    res.json({
      jobs: totals.rows[0].jobs,
      sources: totals.rows[0].sources,
      companies: totals.rows[0].companies,
      directCompanies: direct.rows[0].n,
      lastSyncedAt: synced.rows[0].last || null,
    });
  } catch (err) {
    console.error('GET /jobs/stats failed:', err.message);
    // 503 rather than a zeroed body: a caller must be able to tell "no data
    // right now" from "genuinely zero jobs", because the page renders those
    // two states differently.
    res.status(503).json({ error: 'Stats unavailable' });
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
const JOB_COLUMNS = `id, source, title, company_name, company_url, job_url, apply_url, location, work_arrangement,
              salary_min, salary_max, job_type, posted_at, created_at`;

router.get('/', attachUserIfPresent, async (req, res) => {
  try {
    const {
      page = 1, limit = 20, search, source, location, experience, includeRelated,
      scope, datePosted, jobType, company,
    } = req.query;
    const offset = (page - 1) * limit;

    /*
     * A7.1 — score ranking is the DEFAULT for a signed-in user.
     *
     * `sort=recent` is the explicit opt-out into unranked chronological
     * browse. Making that the default is what broke the promise: the
     * differentiator is the score, so the place people browse has to show it.
     * Anonymous callers cannot be scored, so they keep the chronological feed.
     */
    const userId = req.user?.id || null;
    /*
     * A7.7 — the sort is stated, never implied.
     *
     * A time filter IS a recency request, so it flips the default. Ordering
     * by score while the user has asked for "last 24 hours" gives them a list
     * whose order they cannot explain from what is on screen.
     */
    const sortDefault = datePosted ? 'recent' : (userId ? 'score' : 'recent');
    const sort = req.query.sort === 'recent' || req.query.sort === 'score'
      ? req.query.sort
      : sortDefault;
    const minScore = Number(req.query.minScore ?? 0.4);

    /*
     * `sort` and `ranked` are different questions, and conflating them lost the
     * scores whenever a user chose "newest": ordering by recency does not mean
     * abandoning the personalised set. `ranked=0` is the explicit escape hatch
     * into browsing everything indexed, unscored.
     */
    const rankByScore = Boolean(userId)
      && req.query.ranked !== '0'
      && Number.isFinite(minScore);
    let ranking = { mode: 'all', sort: 'recent', minScore: null, sourceDiversified: false };

    /*
     * NULLS LAST on every recency key: Postgres puts NULLs FIRST on DESC, so
     * `ORDER BY posted_at DESC` led the "newest" list with jobs that have no
     * date at all. `id DESC` is the unique final key - without it rows sharing
     * a score and a timestamp come back in whatever order the plan happens to
     * produce, which is what made equal-score rows look randomly shuffled.
     */
    const orderBySql = sort === 'recent'
      ? 'posted_at DESC NULLS LAST, overall_score DESC, id DESC'
      : 'overall_score DESC, posted_at DESC NULLS LAST, id DESC';

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

    // Region: matched against the derived expression rather than a column,
    // because location is free text and jobs.country is mostly empty.
    const regions = asArray(req.query.region);
    if (regions.length) {
      const ph = regions.map((r) => { params.push(r); return `$${params.length}`; });
      filterClause += ` AND ${REGION_SQL} IN (${ph.join(', ')})`;
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
         ORDER BY match_tier ASC, posted_at DESC NULLS LAST, id DESC
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
    } else if (rankByScore) {
      /*
       * A7.1 — the browsable feed is the SAME product as the Dashboard.
       *
       * This branch exists because the two diverged: the Dashboard read
       * /api/matches (authenticated, ORDER BY overall_score DESC) while this
       * route was unauthenticated and ordered by posted_at, so "View all jobs"
       * took a Principal Product Designer from 71-75% UX roles to a
       * chronological dump containing a Hindi Voice Coach and an in-home nurse
       * practitioner. Same user, same second, two unrelated products.
       *
       * Ranking, in order:
       *   1. per-source interleave, so no single source can own a page. micro1
       *      alone swamped every page of results; taking the best from each
       *      source in turn keeps one prolific scraper from burying the rest.
       *   2. score within that interleave.
       *
       * INNER JOIN, not LEFT: a floor of 0 still means "jobs scored against
       * this user's profile". Unscored rows are not silently ranked last, they
       * are a different question - answered by the explicit unranked browse.
       */
      const scoreParams = [...params, userId, minScore];
      const userIdx = scoreParams.length - 1;
      const scoreIdx = scoreParams.length;

      // The jobs table stays unaliased so the shared filterClause - which
      // references bare column names - resolves unchanged. job_matches carries
      // none of those names, so nothing is ambiguous.
      const rankedCte = `
        WITH ranked AS (
          SELECT ${JOB_COLUMNS.split(',').map((c) => `jobs.${c.trim()}`).join(', ')},
                 jm.overall_score,
                 jm.skills_match_score, jm.experience_match_score,
                 jm.location_match_score, jm.salary_match_score,
                 ROW_NUMBER() OVER (
                   PARTITION BY jobs.source ORDER BY jm.overall_score DESC, jobs.id
                 ) AS source_rank
            FROM jobs
            JOIN job_matches jm ON jm.job_id = jobs.id AND jm.user_id = $${userIdx}
           WHERE ${filterClause}${dateFilterSql}
             AND jm.overall_score >= $${scoreIdx}
        )`;

      const countResult = await query(`${rankedCte} SELECT COUNT(*) as count FROM ranked`, scoreParams);
      total = parseInt(countResult.rows[0].count, 10);

      /*
       * Diversity as a CAP, not a round-robin.
       *
       * Interleaving by source_rank did prevent domination, but it broke score
       * order: the list read 0.75 0.71 0.67 0.63 0.59, then jumped back up to
       * 0.71 when the next round began. "Score-sorted by default" and "no
       * single source may dominate" then contradict each other.
       *
       * Capping each source's contribution and THEN ordering by score honours
       * both literally. The cap scales with depth so pagination still works -
       * a source may hold at most a quarter of everything requested so far,
       * rather than a fixed number that would starve later pages.
       */
      const result = await query(
        `${rankedCte}
         SELECT * FROM ranked
          WHERE source_rank <= GREATEST(3, CEIL(($${scoreIdx + 3}::numeric * $${scoreIdx + 1}) / 4))
          ORDER BY ${orderBySql}
          LIMIT $${scoreIdx + 1} OFFSET $${scoreIdx + 2}`,
        [...scoreParams, limit, offset, page]
      );
      jobs = result.rows;
      ranking = { mode: 'ranked', sort, minScore, sourceDiversified: true };
    } else {
      const countResult = await query(`SELECT COUNT(*) as count FROM jobs WHERE ${filterClause}${dateFilterSql}`, params);
      total = parseInt(countResult.rows[0].count, 10);

      const result = await query(
        `SELECT ${JOB_COLUMNS}
         FROM jobs WHERE ${filterClause}${dateFilterSql}
         ORDER BY posted_at DESC NULLS LAST, id DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );
      jobs = result.rows;
      ranking = { mode: 'all', sort: 'recent', minScore: null, sourceDiversified: false };

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
      // A7.1 — state how this list was ranked. The floor must never be silent:
      // a user seeing 300 results instead of 23,958 is entitled to know a
      // filter is doing that, and to move it.
      ranking,
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
              j.id, j.source, j.title, j.company_name, j.company_url, j.job_url, j.apply_url,
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

    const job = result.rows[0];
    // Skills are matched out of the posting's own text against the same
    // dictionary used for resume parsing, so every chip shown is a term the
    // employer actually wrote. Nothing is inferred from the job title or
    // guessed from the role family.
    const jobText = `${job.title || ''} ${job.description || ''} ${job.requirements || ''}`;
    res.json({
      ...sanitizeJob(job),
      experienceLevel: classifyExperience(job.title),
      contactEmails: extractContactEmails(job.description),
      skills: extractSkills(jobText),
      isMonthlySalary: MONTHLY_SOURCES.includes(job.source),
    });
  } catch (err) {
    console.error('Get job error:', err);
    res.status(500).json({ error: 'Failed to fetch job' });
  }
});

module.exports = router;
