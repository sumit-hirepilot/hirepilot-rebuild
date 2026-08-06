const express = require('express');
const { query } = require('../db');
const { verifyToken, attachUserIfPresent } = require('../middleware/auth');
const { aggregateJobs, SOURCES } = require('../services/jobAggregator');
const { fixMojibake } = require('../services/apis/textSanitizer');
const { buildSearchTiering, buildExcludeCondition } = require('../services/jobSearch');
const { orderBySql, orderFor } = require('../services/jobOrder');
const {
  pageOf, BLOCK: DIVERSITY_BLOCK, QUOTA: DIVERSITY_QUOTA,
} = require('../services/feedDiversity');
const { readBack: readSchemaClaims, readStorage } = require('../services/schemaClaims');

/*
 * A7.9 — how many ranked rows the diversity pass reorders.
 *
 * Fixed on purpose. A window that grew with the page would give each page a
 * different canonical order, which is the defect this replaced. 200 rows is 20
 * pages at the default size; past it the feed continues in plain ranked order
 * so nothing becomes unreachable, and the response says which regime applied.
 */
const DIVERSITY_WINDOW = 200;
const { scoreJobsForUser } = require('../services/matchingEngine');
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

const FETCHED_SOURCES = new Set(SOURCES.map((s) => s.key));

/*
 * A7.14 - derived once, here, from whether a fetcher is wired and what the
 * last run did. It was previously inferred in JSX from `count > 0`, which gets
 * both directions wrong: a source that died last night still has rows and read
 * as live, and a wired source that legitimately matched nothing read as dead.
 *
 *   not_connected - no fetcher wired. A deliberate decision, not an outage.
 *   never_run     - wired, but nothing has run yet.
 *   failing       - the last run errored, whatever rows may be left over.
 *   live          - the last run succeeded.
 */
function sourceStatus(key, lastRun) {
  if (!FETCHED_SOURCES.has(key)) return 'not_connected';
  if (!lastRun) return 'never_run';
  return lastRun.success ? 'live' : 'failing';
}

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
/*
 * A7.15 — index freshness, per source.
 *
 * Measured: 9 jobs index-wide in a 24h window against ~24,800 indexed. Three
 * questions, and the third is the dangerous one:
 *   - how many rows arrive per window (created_at)
 *   - what posted_at actually HOLDS
 *   - whether the poller adds new rows or re-touches seen ones
 *
 * `postedEqualsIngest` is the tell. If posted_at tracks created_at, the field
 * is our ingest time wearing the employer's label, and every time filter in
 * the product measures the wrong thing. Compared with a 2-minute tolerance
 * because ingest writes both within the same cycle.
 */
router.get('/freshness', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT source,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS added_24h,
              COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int   AS added_7d,
              COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::int  AS added_30d,
              COUNT(*) FILTER (WHERE posted_at IS NULL)::int                        AS posted_null,
              COUNT(*) FILTER (WHERE posted_at IS NOT NULL
                                 AND ABS(EXTRACT(EPOCH FROM (posted_at - created_at))) < 120)::int
                AS posted_equals_ingest,
              COUNT(*) FILTER (WHERE posted_at > NOW() - INTERVAL '24 hours')::int  AS posted_24h,
              MIN(posted_at) AS posted_min,
              MAX(posted_at) AS posted_max,
              MAX(created_at) AS last_ingest
         FROM jobs
        WHERE is_active = true
        GROUP BY source
        ORDER BY total DESC`
    );
    res.json({ generatedAt: new Date().toISOString(), bySource: rows });
  } catch (err) {
    console.error('Freshness check error:', err);
    res.status(500).json({ error: 'Failed to run the freshness check' });
  }
});

router.get('/field-integrity', async (req, res) => {
  try {
    const placeholders = ['', '-', '--', 'n/a', 'na', 'none', 'null', 'undefined',
      'unknown', 'name', 'title', 'company', 'company_name', 'location', 'nan'];
    const { rows } = await query(
      `SELECT COUNT(*)::int AS total,
              /*
               * A7.2 — a fabricated value and a missing one are different
               * states, and only one of them is a lie. "name" claims an
               * employer that does not exist; NULL claims nothing.
               *
               * These were one number, folded together by COALESCE(...,'')
               * against a list containing the empty string. After the
               * correction nulled 181 rows the count did not move, so the
               * instrument could not distinguish corrected from uncorrected.
               */
              COUNT(*) FILTER (
                WHERE company_name IS NOT NULL
                  AND LOWER(TRIM(company_name)) = ANY($1)
              )::int AS bad_company,
              COUNT(*) FILTER (WHERE company_name IS NULL OR TRIM(company_name) = '')::int AS absent_company,
              COUNT(*) FILTER (WHERE LOWER(TRIM(COALESCE(title,''))) = ANY($1))::int        AS bad_title,
              COUNT(*) FILTER (WHERE LOWER(TRIM(COALESCE(location,''))) = ANY($1))::int     AS bad_location
         FROM jobs WHERE is_active = true`,
      [placeholders]
    );
    const { rows: bySource } = await query(
      `SELECT source, COUNT(*)::int AS bad
         FROM jobs
        WHERE is_active = true
          AND company_name IS NOT NULL
          AND LOWER(TRIM(company_name)) = ANY($1)
        GROUP BY source ORDER BY bad DESC`,
      [placeholders]
    );
    /*
     * A7.3 — publication-date coverage per source. D4 (the timing signal) is
     * impossible without a trustworthy posted_at, so knowing WHICH sources
     * supply one is a wedge prerequisite, not a curiosity.
     */
    const { rows: dates } = await query(
      `SELECT source,
              COUNT(*)::int                                    AS total,
              COUNT(*) FILTER (WHERE posted_at IS NULL)::int    AS undated
         FROM jobs WHERE is_active = true
        GROUP BY source ORDER BY undated DESC`
    );
    const undatedTotal = dates.reduce((n, r) => n + r.undated, 0);
    const grandTotal = dates.reduce((n, r) => n + r.total, 0);

    /*
     * A7.12 — non-job rows by source. A bio indexed as a job reached the feed
     * with a working Apply Now; this is how many of that class exist and
     * where they came from.
     */
    const { rows: nonJob } = await query(
      `SELECT source,
              COUNT(*) FILTER (WHERE is_active = true)::int  AS still_live,
              COUNT(*) FILTER (WHERE is_active = false)::int AS withheld
         FROM jobs
        WHERE LENGTH(COALESCE(company_name, '')) > 80
           OR company_name ~* '^(hi[!,. ]|hey |i am |i''m |my name is )'
           OR title ~* '^(hi[!,. ]|hey |i am |i''m |my name is )'
           OR COALESCE(apply_url, job_url, '') ~* 'linkedin\\.com/in/'
        GROUP BY source ORDER BY still_live DESC, withheld DESC`
    );

    /*
     * A7.2 — read the correction back rather than trusting that it ran.
     * runMigrations logs a failed statement and prints "Migrations complete",
     * so a correction that never applied is indistinguishable from one that
     * did. Containment is not existence.
     */
    /*
     * A7.4b — how many stored screening reasons still quote an internal key.
     * The generator is fixed; these are the frozen copies in
     * applications.screening_answers. Reading the count from outside is the
     * only way to tell a correction that applied from one that was merely
     * recorded - A7.2 reported 399 rows while changing none.
     */
    const { rows: staleReasons } = await query(
      `SELECT COUNT(*)::int AS applications,
              COALESCE(SUM(hits), 0)::int AS questions
         FROM (
           SELECT a.id,
                  COUNT(*) FILTER (
                    WHERE q->>'reason' ~ '^Your saved answer to "[^"]*" is not one of this form''s options\\.$'
                  ) AS hits
             FROM applications a,
                  LATERAL jsonb_array_elements(COALESCE(a.screening_answers->'questions', '[]'::jsonb)) q
            GROUP BY a.id
         ) per_app
        WHERE hits > 0`
    );

    const { rows: corrections } = await query(
      `SELECT correction, row_count, applied_at
         FROM data_corrections
        WHERE correction = 'a7.2-null-unparsed-company'
        ORDER BY applied_at DESC LIMIT 1`
    );

    res.json({
      ...rows[0],
      badCompanyBySource: bySource,
      correctionApplied: corrections[0] || null,
      staleScreeningReasons: staleReasons[0] || { applications: 0, questions: 0 },
      nonJobRows: nonJob,
      dateCoverage: {
        undated: undatedTotal,
        total: grandTotal,
        // Stated as a fraction the caller can check, not a pre-rounded percent.
        bySource: dates,
      },
    });
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

/*
 * A7.17 - measuring the ranked feed with curl could not resolve whether the
 * indexes were used: p50 was identical before and after (0.391s -> 0.405s) and
 * p95 moved in both directions across runs, because network round-trip and
 * serialising twenty descriptions dominate the query itself. An instrument
 * that cannot see the thing it is pointed at is not evidence either way.
 *
 * This asks the database directly. It also answers the question that actually
 * matters on a volume that has filled once already: an unused index is pure
 * cost, so if the plan does not name it, it should not exist.
 */
async function feedPlan(userId, { dateFilter = false } = {}) {
  try {
    const where = dateFilter
      ? "WHERE is_active = true AND posted_at >= NOW() - INTERVAL '24 hours'"
      : 'WHERE is_active = true';
    const result = await query(
      `EXPLAIN (ANALYZE, FORMAT JSON)
       /*
       * GOAL 1f — no ROW_NUMBER() OVER (PARTITION BY jobs.source ...) here any
       * more, and removing it is the fix.
       *
       * A7.9 moved source diversity out of SQL into feedDiversity and removed
       * the WHERE that consumed source_rank. The window function itself was
       * left behind, so every feed request sorted and partitioned all 25,418
       * rows to compute a column nothing read - a computed value never used,
       * which is a defect rather than dead weight.
       *
       * It is also what took the endpoint down. A window function over the
       * whole index does not fit in work_mem, so Postgres spilled it to
       * base/pgsql_tmp, and with the volume full those writes failed:
       * SQLSTATE 53100, "No space left on device", on 21 of 30 concurrent
       * requests. Read out of crash_reports on production rather than guessed -
       * the route used to swallow it behind "Failed to fetch jobs".
       */
      WITH ranked AS (
         SELECT jobs.id, jobs.source, jobs.posted_at, jm.overall_score,
                ROW_NUMBER() OVER (
                  PARTITION BY jobs.source
                  ORDER BY jm.overall_score DESC NULLS LAST, jobs.posted_at DESC NULLS LAST, jobs.id
                ) AS source_rank
           FROM jobs
           LEFT JOIN job_matches jm ON jm.job_id = jobs.id AND jm.user_id = $1
          ${where}
       )
       SELECT * FROM ranked WHERE source_rank <= 5
        ORDER BY overall_score DESC NULLS LAST, posted_at DESC NULLS LAST, id DESC
        LIMIT 20`,
      [userId]
    );
    const plan = result.rows[0]['QUERY PLAN'][0];
    const text = JSON.stringify(plan);
    return {
      executionMs: plan['Execution Time'],
      planningMs: plan['Planning Time'],
      // Named rather than dumped: the full plan is large and the only question
      // is whether each index earns the disk it occupies.
      indexesUsed: (text.match(/"Index Name":"([^"]+)"/g) || [])
        .map((m) => m.split('"')[3]),
      seqScans: (text.match(/"Node Type":"Seq Scan"/g) || []).length,
    };
  } catch (err) {
    // A diagnostic must never be the reason the diagnostic endpoint 500s.
    return { error: err.message };
  }
}

/*
 * A7.17 - runMigrations logs a failed statement and carries on, then prints
 * "Migrations complete", so a CREATE INDEX that failed looks exactly like one
 * that worked. Declaring an index proves intent; this reads pg_indexes and
 * proves existence. Same reason A1's constraint guard reads pg_constraint:
 * containment is not existence.
 */
router.get('/db-health', verifyToken, async (req, res) => {
  try {
    const wanted = ['idx_jobs_active_posted'];
    // Dropped after EXPLAIN named none of them. Reported so a database that
    // predates the drop is visibly carrying dead weight rather than silently.
    const retired = ['idx_jobs_source', 'idx_job_matches_user_job', 'idx_job_matches_user_score'];
    const result = await query(
      `SELECT indexname, tablename FROM pg_indexes
        WHERE schemaname = 'public' AND tablename IN ('jobs', 'job_matches')`
    );
    const present = new Set(result.rows.map((r) => r.indexname));

    /*
     * Dead branches — the CHECK constraints, read from the running database.
     *
     * Both were asserted only by regexing migrations.js for the constraint
     * text. That proves the statement is WRITTEN, which is not the question:
     * runMigrations logs a failed statement and continues, so an ADD
     * CONSTRAINT that failed and one that worked produce identical output, and
     * the test is green either way. The same reasoning already applies to the
     * indexes above, which is why they are read from pg_indexes rather than
     * trusted - the constraints simply never got the same treatment.
     *
     * A constraint that is not in the table is not enforcing anything, however
     * carefully its predicate is written.
     */
    const wantedConstraints = [
      'applications_applied_at_requires_submitted',
      'applications_applied_requires_submission',
    ];
    const cons = await query(
      `SELECT conname, pg_get_constraintdef(oid) AS def
         FROM pg_constraint
        WHERE conrelid = 'applications'::regclass AND contype = 'c'`
    );
    const byName = new Map(cons.rows.map((r) => [r.conname, r.def]));
    const schemaClaims = await readSchemaClaims(query);
    let storage = null;
    try { storage = await readStorage(query); } catch (err) { storage = { error: err.message }; }
    let recentCrashes = [];
    try {
      const c = await query(
        `SELECT event, message, rss_mb, uptime_seconds, occurred_at
           FROM crash_reports ORDER BY occurred_at DESC LIMIT 10`
      );
      recentCrashes = c.rows;
    } catch (err) {
      // The table may predate this deploy. Saying so beats a 500 on a
      // diagnostics endpoint whose whole job is being readable in a bad moment.
      recentCrashes = [{ event: 'unavailable', message: err.message }];
    }

    res.json({
      indexes: result.rows,
      expected: wanted.map((name) => ({ name, present: present.has(name) })),
      allPresent: wanted.every((name) => present.has(name)),
      retiredStillPresent: retired.filter((name) => present.has(name)),
      /*
       * Every remaining claim this codebase makes about the database, read
       * back from the running one: tables, triggers, unique indexes, and a
       * column default whose ABSENCE is the claim. Asserting these from
       * migrations.js proves the statement is written, never that it ran.
       */
      /*
       * Crash reasons that outlived the processes that wrote them. This is the
       * only place the cause of an outage can be read after the container is
       * gone, which is the condition every outage here has ended in.
       */
      recentCrashes,
      // GOAL 1g — a full volume stops writes, silently. Read from the running
      // database rather than inferred from the Railway canvas warning.
      storage,
      schemaClaims,
      allSchemaClaimsPresent: schemaClaims.every((c) => c.present),
      constraints: cons.rows,
      expectedConstraints: wantedConstraints.map((name) => ({
        name, present: byName.has(name), def: byName.get(name) || null,
      })),
      allConstraintsPresent: wantedConstraints.every((name) => byName.has(name)),
      plan: await feedPlan(req.user.id),
      planFiltered: await feedPlan(req.user.id, { dateFilter: true }),
    });
  } catch (err) {
    console.error('db-health error:', err);
    res.status(500).json({ error: 'Failed to read index state' });
  }
});

router.get('/sources', async (req, res) => {
  try {
    const [countsResult, runsResult, ratesResult] = await Promise.all([
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
      /*
       * One query, not one per source. This was `await query(...)` inside a
       * for-loop over every source - 13 sequential round trips before the
       * panel could render, growing with each source added, and measured
       * against production it did not return inside 180s.
       */
      query(
        `SELECT source,
                ROUND(100.0 * SUM(CASE WHEN success THEN 1 ELSE 0 END) / COUNT(*))::int AS pct
           FROM (
             SELECT source, success,
                    ROW_NUMBER() OVER (PARTITION BY source ORDER BY created_at DESC) AS rn
               FROM source_ingestion_runs
           ) recent
          WHERE rn <= 20
          GROUP BY source`
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

    const successRates = {};
    for (const row of ratesResult.rows) {
      successRates[row.source] = row.pct === null || row.pct === undefined ? null : Number(row.pct);
    }

    const sources = ALL_SOURCES.map((key) => {
      const lastRun = runsBySource[key];
      return {
        source: key,
        count: bySource[key]?.count || 0,
        lastFetched: bySource[key]?.lastFetched || null,
        status: sourceStatus(key, lastRun),
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

/*
 * A7.13 — how readily each filter should be given up.
 *
 * 1 is a refinement the user is likely indifferent to, 2 is a deliberate
 * choice, 3 is the intent itself. Suggesting someone drop their search term
 * because it recovers the most results is arithmetically correct and useless.
 */
const RELAX_ORDER = {
  minScore: 1,
  datePosted: 1,
  salary: 2,
  workArrangement: 2,
  jobType: 2,
  experience: 2,
  region: 2,
  location: 2,
  exclude: 2,
  source: 2,
  company: 3,
  keywords: 3,
};

// Get all active jobs with pagination and filters
const JOB_COLUMNS = `id, source, title, company_name, company_url, job_url, apply_url, location, work_arrangement,
              salary_min, salary_max, job_type, posted_at, created_at`;

/*
 * GOAL 1h — the feed COUNT, cached briefly.
 *
 * Measured: a feed request runs exactly TWO queries, and both build the same
 * CTE over all 25,418 rows. So the COUNT is close to half the database work of
 * every feed request - and it answers a question whose answer only moves when
 * ingest writes, every six hours.
 *
 * The key is the full SQL plus its parameters, which is what makes this safe:
 * the SQL text carries the filter clause, the tier expression, the date window
 * and whether a score floor is applied, and the parameters carry the user id,
 * the floor value and every filter argument. Two callers can only share an
 * entry when both would have run character-for-character the same query with
 * the same arguments - in which case they would have got the same number.
 *
 * Bounded and oldest-out: an unbounded map keyed by user-supplied filters is a
 * memory leak with extra steps, and this codebase has already been killed once
 * by an unbounded collection.
 *
 * 60 seconds. A stale total is a wrong number on a live surface, so the window
 * is the smallest that still removes the duplicate work.
 */
const COUNT_TTL_MS = Number(process.env.FEED_COUNT_TTL_MS) || 60000;
const COUNT_CACHE_MAX = 500;
const countCache = new Map();

/** Tests need a clean slate between cases; nothing in the app calls this. */
function resetFeedCountCache() {
  countCache.clear();
}

async function cachedCount(sql, params) {
  const key = `${sql}|${JSON.stringify(params)}`;
  const hit = countCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < COUNT_TTL_MS) return hit.value;

  const r = await query(sql, params);
  const value = parseInt(r.rows[0]?.count ?? 0, 10);

  if (countCache.size >= COUNT_CACHE_MAX) {
    // Map preserves insertion order, so the first key is the oldest write.
    countCache.delete(countCache.keys().next().value);
  }
  countCache.set(key, { at: now, value });
  return value;
}

router.get('/', attachUserIfPresent, async (req, res) => {
  try {
    const {
      page: rawPage = 1, limit: rawLimit = 20, search, source, location, experience, includeRelated,
      scope, datePosted, jobType, company,
    } = req.query;

    /*
     * Bounded, because these came straight off the query string and were used
     * as-is. `page=250&limit=100` is OFFSET 24,900 over a CTE that ranks the
     * whole index; three of those in succession took the production API down
     * hard enough that it did not recover on its own. A user cannot type that
     * by accident, but nothing stopped them typing it, which made a
     * denial-of-service reachable from the URL bar. Same class as the rest of
     * this week: an input nobody clicked, so nobody found it.
     *
     * Clamped rather than refused, and STATED rather than silently truncated -
     * a page that quietly hands back different rows than were asked for is the
     * A7.9 defect again. Rows past the bound are still reachable by filtering
     * or sorting, and `total` still counts them honestly.
     */
    const MAX_LIMIT = 100;
    const MAX_OFFSET = 5000;

    const requestedLimit = Math.floor(Number(rawLimit));
    const limit = Math.min(Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 20), MAX_LIMIT);

    const requestedPage = Math.floor(Number(rawPage));
    const maxPage = Math.max(1, Math.floor(MAX_OFFSET / limit));
    const page = Math.min(Math.max(1, Number.isFinite(requestedPage) ? requestedPage : 1), maxPage);

    const paging = {
      page,
      limit,
      maxPage,
      requestedPage: Number.isFinite(requestedPage) ? requestedPage : 1,
      clamped: Number.isFinite(requestedPage) ? requestedPage > maxPage : false,
      limitClamped: Number.isFinite(requestedLimit) ? requestedLimit > MAX_LIMIT : false,
    };

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
     * A7.17 — the per-source cap is a property of the UNFILTERED feed.
     * Applied to a filtered result it silently drops rows the user explicitly
     * asked for, which is the same category error as running a filter inside
     * the 500-row match store.
     */
    let hasIndexFilter = false;

    /*
     * A7.7's NULLS LAST + unique-final-key reasoning now lives in the single
     * ranking path below, where match_tier joins it as the leading key. Two
     * definitions of "the order" was how the branches drifted apart.
     */

    // Multiple keyword "chips" - accepts repeated ?keywords=X&keywords=Y, or
    // falls back to the single ?search= param for backward compatibility
    // (search agents and other internal callers still use `search`).
    const rawKeywords = req.query.keywords;
    const keywords = rawKeywords
      ? (Array.isArray(rawKeywords) ? rawKeywords : [rawKeywords])
      : (search ? [search] : []);

    const rawExclude = req.query.exclude;
    const excludeTerms = rawExclude ? (Array.isArray(rawExclude) ? rawExclude : [rawExclude]) : [];

    /*
     * A7.13 — every filter is DECLARED, not concatenated onto a string.
     *
     * The empty state has to name which filter emptied the result, and the
     * only honest way to know is to count with that one removed. Filters
     * appended as opaque SQL fragments cannot be removed individually, so the
     * alternative was a second set of filter definitions written just for the
     * diagnosis - which is exactly how A7.17's three ranking paths drifted
     * apart until they disagreed. One definition each: the label the user
     * reads and the SQL the query runs come from the same entry.
     *
     * `indexFilter` marks the ones that narrow the index (and so suppress the
     * diversity cap). Experience and exclude deliberately do not - they refine
     * a set rather than target one, which is the behaviour that shipped.
     */
    const filterSpecs = [];
    const addFilter = (key, label, build, indexFilter = true) =>
      filterSpecs.push({ key, label, build, indexFilter, relaxOrder: RELAX_ORDER[key] ?? 2 });

    const asArray = (v) => (v === undefined ? [] : (Array.isArray(v) ? v : [v])).filter(Boolean);

    if (source) {
      addFilter('source', `Source: ${source}`, (p) => { p.push(source); return `source = $${p.length}`; });
    }

    if (location) {
      addFilter('location', `Location: ${location}`, (p) => { p.push(`%${location}%`); return `location ILIKE $${p.length}`; });
    }

    if (company) {
      addFilter('company', `Company: ${company}`, (p) => { p.push(`%${company}%`); return `company_name ILIKE $${p.length}`; });
    }

    // Multi-select facets. Each accepts repeated params
    // (?jobType=full-time&jobType=contract) and OR's within a facet while
    // AND'ing across facets, which is the behaviour a checkbox filter panel
    // implies. Single values still work, so existing callers are unaffected.
    const jobTypes = asArray(jobType);
    if (jobTypes.length) {
      addFilter('jobType', `Employment type: ${jobTypes.join(', ')}`, (p) => {
        // Compare against the normalised expression, not the raw column - the
        // raw values are fragmented across several spellings per type.
        const ph = jobTypes.map((t) => { p.push(t); return `$${p.length}`; });
        return `${JOB_TYPE_SQL} IN (${ph.join(', ')})`;
      });
    }

    // Region: matched against the derived expression rather than a column,
    // because location is free text and jobs.country is mostly empty.
    const regions = asArray(req.query.region);
    if (regions.length) {
      addFilter('region', `Location: ${regions.join(', ')}`, (p) => {
        const ph = regions.map((r) => { p.push(r); return `$${p.length}`; });
        return `${REGION_SQL} IN (${ph.join(', ')})`;
      });
    }

    const workArrangements = asArray(req.query.workArrangement);
    if (workArrangements.length) {
      addFilter('workArrangement', `Workplace: ${workArrangements.join(', ')}`, (p) => {
        const ph = workArrangements.map((w) => { p.push(w); return `$${p.length}`; });
        return `COALESCE(NULLIF(work_arrangement,''),'unknown') IN (${ph.join(', ')})`;
      });
    }

    // Salary bands are USD-equivalent (mixed source currencies converted with
    // static reference rates). Multiple bands OR together.
    const salaryBands = asArray(req.query.salary);
    const salaryConds = salaryBands
      .map((b) => (b === 'not_listed' ? 'salary_min IS NULL' : bandCondition(b)))
      .filter(Boolean);
    if (salaryConds.length) {
      addFilter('salary', `Salary: ${salaryBands.join(', ')}`, () => `(${salaryConds.join(' OR ')})`);
    }

    const EXPERIENCE_SQL = {
      senior: `title ~* '(senior|sr\\.?|lead|head of)'`,
      staff: `title ~* '(staff|principal|distinguished)'`,
      entry: `title ~* '(junior|jr\\.?|entry|intern|graduate)'`,
      mid: `title !~* '(senior|sr\\.?|lead|head of|staff|principal|distinguished|junior|jr\\.?|entry|intern|graduate)'`,
    };
    const EXPERIENCE_LABEL = {
      senior: 'Senior', staff: 'Staff+', entry: 'Entry level', mid: 'Mid level',
    };
    if (EXPERIENCE_SQL[experience]) {
      addFilter('experience', `Experience: ${EXPERIENCE_LABEL[experience]}`,
        () => EXPERIENCE_SQL[experience], false);
    }

    if (excludeTerms.length) {
      addFilter('exclude', `Excluding: ${excludeTerms.join(', ')}`,
        (p) => buildExcludeCondition(excludeTerms, p) || 'TRUE', false);
    }

    /*
     * Kept identifiable rather than folded into the clause: `posted_at >= ...`
     * is neither true nor false against NULL, so undated jobs are silently
     * dropped by this filter (correctly - we cannot claim an unknown-date job
     * falls in the window), and the count of how many were excluded for that
     * reason has to be surfaced, not silent.
     */
    const DATE_INTERVAL = { '24h': '1 day', '3d': '3 days', '7d': '7 days', '30d': '30 days' };
    const DATE_LABEL = {
      '24h': 'Past 24 hours', '3d': 'Past 3 days', '7d': 'Past 7 days', '30d': 'Past 30 days',
      unknown: 'Jobs with no publication date',
    };
    /*
     * A7.11 — `unknown` is a real value here, not a missing one.
     *
     * 4,685 jobs (18.9% of the index, every row himalayas supplies) have no
     * publication date, and A7.7 sorts posted_at DESC NULLS LAST - correct,
     * and at this scale it means they are permanently last and effectively
     * unreachable. This is the one click that reaches them. It is a filter on
     * a known state, not a time window, so it must not also apply one.
     */
    if (datePosted === 'unknown') {
      addFilter('datePosted', DATE_LABEL.unknown, () => 'posted_at IS NULL');
    } else if (datePosted && DATE_INTERVAL[datePosted]) {
      addFilter('datePosted', DATE_LABEL[datePosted],
        () => `posted_at >= CURRENT_TIMESTAMP - INTERVAL '${DATE_INTERVAL[datePosted]}'`);
    }

    const wantRelated = includeRelated === 'true';
    const hasKeywords = keywords.some((k) => k && k.trim());

    /*
     * Rebuilds the whole WHERE from the specs, optionally omitting exactly
     * one. Params are rebuilt with it, because Postgres binds by position and
     * dropping a clause while keeping its parameter is a bind error, not a
     * no-op.
     */
    const compose = ({ skip = null } = {}) => {
      const p = [];
      const parts = ['is_active = true'];
      let dateSql = '';
      for (const f of filterSpecs) {
        if (f.key === skip) continue;
        if (f.key === 'datePosted') { dateSql = ` AND ${f.build(p)}`; continue; }
        parts.push(f.build(p));
      }
      // match_tier ranks exact title matches above title-word above
      // title-or-description. With no keywords every row is tier 1, so the
      // same expression serves the plain feed and the search.
      const useKeywords = hasKeywords && skip !== 'keywords';
      const tier = useKeywords
        ? buildSearchTiering(keywords, p, { scope })
        : { tierCaseExpr: '1' };
      return {
        clause: parts.join(' AND '),
        dateSql,
        tierCaseExpr: tier.tierCaseExpr,
        tierFilter: useKeywords ? (wantRelated ? 'match_tier <= 3' : 'match_tier <= 2') : 'TRUE',
        params: p,
      };
    };

    const base = compose();
    const params = base.params;
    const filterClause = base.clause;
    const dateFilterSql = base.dateSql;
    const tiering = { tierCaseExpr: base.tierCaseExpr };
    const tierFilter = base.tierFilter;
    hasIndexFilter = filterSpecs.some((f) => f.indexFilter) || hasKeywords;

    let jobs = [];
    let total = 0;
    /*
     * A7.9 — stated, not inferred. The ordering guarantee (pages tile one list)
     * holds inside the diversity window; past it the feed is plain ranked
     * order. A client that has to guess which regime it is in will guess wrong.
     */
    let diversityApplied = false;
    let relatedJobs = [];
    let relatedTotal = 0;
    let noExactMatches = false;
    let excludedUnknownDateCount = 0;
    // Always present, null when it does not apply - A7.17's shape rule.
    let emptyReason = null;
    // A7.11 — how many rows the recency sort put behind everything else.
    // Null when sorting by score, where nothing is buried by date.
    let undatedTotal = null;

    /*
     * A7.17 — ONE ranking path.
     *
     * There were three branches inside this endpoint alone (keyword tiering,
     * ranked feed, unranked browse) plus three more elsewhere, each with its
     * own ORDER BY. They disagreed in ways users felt: `datePosted` went
     * through the tiering branch, which returned no `ranking` object at all,
     * and the ranked branch INNER JOINed job_matches - capping the universe at
     * MATCH_STORE_LIMIT (500) BEFORE any filter ran. "Past 24 hours" therefore
     * meant "of your top 500 matches, which are recent": 9 results against an
     * index holding 616.
     *
     * The principle, now enforced in one place: FILTERS apply to the INDEX;
     * RANKING applies to the FILTERED result. The match store is a fast path
     * for the unfiltered feed, never the universe a filter runs inside.
     *
     * LEFT JOIN, so score is a SORT KEY rather than a membership test. An
     * unscored row is ranked last, not excluded - we cannot judge it, which is
     * not the same as it being a bad match.
     */

    /*
     * The floor filters SCORED rows only. Excluding unscored rows would
     * collapse the universe back to the 500 this goal exists to escape, and
     * passing them silently would let a "40% floor" quietly include rows with
     * no score at all - so the response reports how many are unscored and the
     * UI can say so.
     */
    /*
     * One builder for the ranked CTE, used by the page query AND by the
     * empty-state diagnosis. A diagnosis built from its own copy of this would
     * answer a question about a query the user never ran.
     */
    const buildQuery = (v, { skipFloor = false } = {}) => {
      const sp = [...v.params, userId];
      const uIdx = sp.length;
      let floor = '';
      if (rankByScore && minScore > 0 && !skipFloor) {
        sp.push(minScore);
        floor = ` AND (jm.overall_score >= $${sp.length} OR jm.overall_score IS NULL)`;
      }
      return {
        sp,
        floor,
        tierFilter: v.tierFilter,
        cte: `
      WITH ranked AS (
        SELECT ${JOB_COLUMNS.split(',').map((c) => `jobs.${c.trim()}`).join(', ')},
               ${v.tierCaseExpr} AS match_tier,
               jm.overall_score, jm.skills_match_score, jm.experience_match_score,
               jm.location_match_score, jm.salary_match_score
          FROM jobs
          LEFT JOIN job_matches jm
            ON jm.job_id = jobs.id AND jm.user_id = $${uIdx}
         WHERE ${v.clause}${v.dateSql}${floor}
      )`,
      };
    };

    const mainQuery = buildQuery(base);
    const rankedCte = mainQuery.cte;
    const floorSql = mainQuery.floor;

    /*
     * A7.9 — the diversity cap is GONE from SQL.
     *
     * It was `source_rank <= GREATEST(3, CEIL(page*limit/4))`, which made page
     * and limit decide how many rows each source could contribute. Every page
     * was OFFSET into a differently-capped list, and those lists are not nested
     * at the front, so a row entering as the cap widened was inserted above
     * rows already shown and the offset stepped past it. On production, 40 rows
     * read as one page of 40 and as four pages of 10 differed by six jobs that
     * paging could not reach at all.
     *
     * Diversity now happens once, in application code, over a window that is
     * the same for every page - see feedDiversity. It has to be page- and
     * limit-independent or the bug returns in a quieter form: each page would
     * be internally coherent and still disagree with the others.
     */
    const where = `WHERE ${tierFilter}`;
    /*
     * The COUNT deliberately omits the cap. The cap scales with the page, so
     * counting inside it made `total` grow as the user paged - 60 on page 1,
     * 120 on page 2 - and a pagination control cannot render a moving target.
     * Every capped row is reachable by paging, so the count over the filter is
     * the honest number and the cap stays a per-page presentation device.
     */
    const countWhere = `WHERE ${tierFilter}`;

    // A7.20/A7.8 — one declaration of the order, rendered as SQL here and as a
    // comparator below. Written out twice, they drift.
    const orderBy = orderBySql(sort);

    const scoreParams = mainQuery.sp;
    total = await cachedCount(`${rankedCte} SELECT COUNT(*) as count FROM ranked ${countWhere}`, scoreParams);

    /*
     * Diversity applies to the unfiltered, score-ranked feed only - the same
     * condition the SQL cap used. A filtered or recency-sorted list is already
     * the user's own choice of what to see, and reordering it would be us
     * overriding that.
     *
     * The window is a fixed number of ranked rows, deliberately NOT page*limit.
     * If the window grew with the page, page 3 would diversify a longer list
     * than page 1 did, the canonical order would differ between them, and pages
     * would stop tiling one sequence - which is the original defect wearing a
     * different hat. Same window for every page, so every page is a slice of
     * the same list.
     *
     * Past the window, paging continues in plain ranked order. That keeps every
     * row reachable - the honest total already counts them - and confines the
     * ordering guarantee to a stated range rather than pretending it holds
     * everywhere. Stated on the response so the client need not infer it.
     */
    const diversified = !hasIndexFilter && rankByScore;
    const inWindow = diversified && page * limit <= DIVERSITY_WINDOW;

    const fetchLimit = inWindow ? DIVERSITY_WINDOW : limit;
    const fetchOffset = inWindow ? 0 : offset;

    const result = await query(
      `${rankedCte} SELECT * FROM ranked ${where}
        ORDER BY ${orderBy}
        LIMIT $${scoreParams.length + 1} OFFSET $${scoreParams.length + 2}`,
      [...scoreParams, fetchLimit, fetchOffset]
    );
    jobs = result.rows;
    diversityApplied = inWindow;

    /*
     * A7.11 — the same COUNT answers two different questions, so it runs for
     * both. Under a date window it is "how many we could not place in it".
     * Under a recency sort with no window it is "how many this sort has buried
     * behind everything else" - which nothing on screen used to say, and which
     * is 4,685 rows in production.
     */
    if (datePosted || sort === 'recent') {
      /*
       * Counted with the DATE FILTER REMOVED, which is the whole point.
       *
       * The ranked CTE already applies the window, so once a real one is
       * active it has filtered every NULL-dated row out before this COUNT can
       * see them - the metric could not observe the thing it exists to report,
       * and returned 0 for "how many did this window exclude". A7.2's lesson,
       * one table over: a measurement taken downstream of the filter it is
       * measuring reports the filter working perfectly, every time.
       */
      const unknownCte = buildQuery({ ...base, dateSql: '' }).cte;
      const unknownDateResult = await query(
        `${unknownCte} SELECT COUNT(*) as count FROM ranked ${countWhere} AND posted_at IS NULL`,
        scoreParams
      );
      const undated = parseInt(unknownDateResult.rows[0]?.count ?? 0, 10);
      /*
       * A7.11 — `unknown` EXCLUDES nothing. It selects the undated rows.
       *
       * This read `if (datePosted)`, so choosing "Jobs with no publication
       * date" reported all 5,014 of them as excluded from the very filter that
       * had just selected them - and the page duly printed "+5,014 more with
       * unknown publish date (excluded from this filter)" underneath a list of
       * exactly those jobs. A number that contradicts the rows beside it is a
       * fabricated figure on a live surface, Constraint 1, whatever arithmetic
       * produced it.
       *
       * Also guarded on a RECOGNISED window: an unparseable datePosted filters
       * nothing, so it can exclude nothing either.
       */
      const windowFilterApplied = Boolean(datePosted) && datePosted !== 'unknown'
        && Object.prototype.hasOwnProperty.call(DATE_INTERVAL, datePosted);
      if (windowFilterApplied) excludedUnknownDateCount = undated;
      if (sort === 'recent') undatedTotal = undated;
    }

    /*
     * A7.20 — score the page before the order is decided.
     *
     * A7.17 made the index the universe, correctly. The scoring sweep runs
     * periodically, so a job ingested since the last run has no score for this
     * user - and "past 24 hours" selects precisely those rows, which is why it
     * showed 20 unscored of 20 while the default feed showed none.
     *
     * The page only. Twenty rows, not the 24,800 behind them. The rows arrived
     * ordered by a score they did not yet have, so the order is redone here
     * from the same declaration the SQL used - otherwise the newest job, by
     * definition the least likely to have been scored, ranks below every stale
     * one under "Newest first".
     */
    let withheldUnscored = 0;
    const isUnscored = (j) => j.overall_score === null || j.overall_score === undefined;

    if (rankByScore && userId) {
      const needScore = jobs.filter(isUnscored).map((j) => j.id);
      if (needScore.length) {
        const fresh = await scoreJobsForUser(userId, needScore);
        jobs = jobs.map((j) => {
          const s = fresh.get(j.id);
          return s ? { ...j, ...s } : j;
        });
      }

      /*
       * Anything still unscored could not be scored at all. Withheld rather
       * than shown: a user who reached this list by matching must not be
       * handed a row nothing matched. Constraint 1 - the absence is stated,
       * in ranking.withheldUnscored, not implied by a blank.
       */
      const before = jobs.length;
      jobs = jobs.filter((j) => !isUnscored(j));
      withheldUnscored = before - jobs.length;

      jobs.sort(orderFor(sort));
    }

    /*
     * A7.9 — diversify and slice HERE, after on-demand scoring and the sort,
     * not at fetch time.
     *
     * Scoring can change a row's rank: an unscored row comes back from
     * scoreJobsForUser with a score and moves. Diversifying before that meant
     * the page was a slice of an order that was then rearranged underneath it,
     * so pages of 10 and a page of 40 disagreed again - each internally sorted,
     * jointly incoherent. The canonical order has to be FINAL before it is
     * divided into pages.
     *
     * withheldUnscored is counted over the whole window for the same reason:
     * it is the number this ranking dropped, and reporting a per-page share of
     * it would be a different quantity wearing the same name.
     */
    if (diversityApplied) jobs = pageOf(jobs, page, limit);

    const unscored = jobs.filter((j) => j.overall_score === null || j.overall_score === undefined).length;
    ranking = {
      mode: rankByScore ? 'ranked' : 'all',
      sort,
      minScore: rankByScore && minScore > 0 ? minScore : null,
      /*
       * A7.9 — the diversity rule, stated rather than implied. It used to be
       * Boolean(capSql), which said only "something was capped" and could not
       * say what the rule was or whether this page fell under it.
       */
      sourceDiversified: diversityApplied,
      sourceDiversityRule: diversityApplied
        ? { perSourceMax: DIVERSITY_QUOTA, perRows: DIVERSITY_BLOCK, window: DIVERSITY_WINDOW }
        : null,
      // Stated, never implied: a floor cannot judge a row that has no score.
      unscoredInPage: unscored,
      // A7.11 — stated for the same reason, one column over.
      undatedTotal,
      // A7.20 — rows dropped from this page because they could not be scored.
      withheldUnscored,
    };



    /*
     * A7.13 — when the result is empty, name the filter that emptied it.
     *
     * "No jobs match these filters" is true and useless: it names every filter
     * and blames none, so the only move left is to clear all of them. The
     * server can simply count with each one dropped, and after A7.17 there is
     * no 500-row cap left to explain the emptiness away.
     *
     * Every number is a real COUNT against the same builder the page query
     * uses. A suggestion like "try widening the date range" with no count
     * behind it is a guess wearing the clothes of a finding.
     *
     * Costs one query per active filter, and only ever runs on an empty
     * result - the case where the user is stuck and has nothing else to read.
     */
    if (total === 0) {
      const candidates = [
        ...filterSpecs.map((f) => ({ key: f.key, label: f.label, relaxOrder: f.relaxOrder })),
        ...(hasKeywords
          ? [{ key: 'keywords', label: `Search: ${keywords.join(', ')}`, relaxOrder: RELAX_ORDER.keywords }]
          : []),
        ...(rankByScore && minScore > 0
          ? [{ key: 'minScore', label: `Match score above ${Math.round(minScore * 100)}%`, relaxOrder: RELAX_ORDER.minScore }]
          : []),
      ];

      const measured = [];
      for (const c of candidates) {
        const v = compose({ skip: c.key });
        const q = buildQuery(v, { skipFloor: c.key === 'minScore' });
        const r = await query(
          `${q.cte} SELECT COUNT(*) as count FROM ranked WHERE ${q.tierFilter}`,
          q.sp
        );
        measured.push({ ...c, withoutIt: parseInt(r.rows[0]?.count ?? 0, 10) });
      }

      /*
       * NOT simply the largest recovery. Measured on production for
       * figma + Past 24 hours: dropping the keyword recovers 579, dropping the
       * date recovers 11. "Your search term is what emptied this" is true and
       * useless - the user typed figma on purpose, and the advice amounts to
       * telling them to stop looking for the job they want.
       *
       * So candidates are ranked by how reasonable they are to relax first:
       * a score floor or a date window is a refinement, a facet is a choice,
       * and the search term is the intent itself. Largest recovery only breaks
       * ties within the same tier.
       *
       * null when nothing recovers anything - "no single filter is
       * responsible" is a real answer, and naming one anyway would be a
       * fabricated cause.
       */
      const best = measured
        .filter((m) => m.withoutIt > 0)
        .sort((a, b) => (a.relaxOrder - b.relaxOrder) || (b.withoutIt - a.withoutIt))[0] || null;
      emptyReason = {
        filters: measured,
        primary: best ? best.key : null,
      };
    }

    if (hasKeywords && !wantRelated && total === 0) {
      const relatedResult = await query(
        /*
         * The old `${capSql}` interpolation is gone from here, and it had never
         * done anything: this branch needs hasKeywords, hasKeywords forces
         * hasIndexFilter, and hasIndexFilter made capSql the empty string. A
         * dead expression that read like a policy.
         */
        `${rankedCte} SELECT * FROM ranked WHERE match_tier = 3
          ORDER BY ${orderBy} LIMIT $${scoreParams.length + 1}`,
        [...scoreParams, limit]
      );
      relatedJobs = relatedResult.rows;
      relatedTotal = relatedJobs.length;
      noExactMatches = relatedJobs.length > 0;
    }

    const decorate = (list) => list.map((j) => ({ ...sanitizeJob(j), experienceLevel: classifyExperience(j.title) }));

    res.json({
      total,
      page,
      limit,
      /*
       * A7.11 incident — what the server actually did with the paging the
       * caller asked for. Silence here is how a clamped page reads as a real
       * one and a client pages forever into rows it will never be given.
       */
      paging,
      jobs: decorate(jobs),
      noExactMatches,
      relatedJobs: decorate(relatedJobs),
      relatedTotal,
      excludedUnknownDateCount,
      // A7.1 — state how this list was ranked. The floor must never be silent:
      // a user seeing 300 results instead of 23,958 is entitled to know a
      // filter is doing that, and to move it.
      ranking,
      // A7.13 — when total is 0, which filter did it and what it costs.
      // Null when there is nothing to explain, never absent.
      emptyReason,
    });
  } catch (err) {
    /*
     * GOAL 1f — say WHAT failed.
     *
     * This logged `err` and returned one flat message, so a load test could
     * establish that 20 of 30 concurrent requests 500 and could not establish
     * why. Postgres errors carry the part that identifies them - `code`
     * (53300 is too_many_connections, 57014 a cancelled statement), `routine`,
     * and the failing SQL - and none of it survived.
     *
     * Persisted as well as logged: Railway retains logs poorly on a busy
     * service, and this is exactly the moment the evidence is needed. The
     * write is best-effort and must never turn a 500 into a hang.
     */
    const detail = {
      message: err && err.message,
      code: err && err.code,
      routine: err && err.routine,
      severity: err && err.severity,
      stack: err && err.stack,
    };
    console.error('Get jobs error:', JSON.stringify(detail));

    query(
      `INSERT INTO crash_reports (event, message, stack, rss_mb, uptime_seconds)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        `api_error:${(err && err.code) || 'none'}`,
        `GET /api/jobs — ${detail.message || 'unknown'}`,
        detail.stack || null,
        Math.round(process.memoryUsage().rss / 1048576),
        Math.round(process.uptime()),
      ]
    ).catch(() => {});

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
module.exports.resetFeedCountCache = resetFeedCountCache;
