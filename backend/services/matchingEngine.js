const { query } = require('../db');
const { extractSkills } = require('./resumeParser');

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Rather than regex-"extracting" a job's required skills from free text
// (fragile: real postings are prose, not "Skills: X, Y, Z" lists, and the
// old approach produced junk single-word fragments like "system" that then
// loose-substring-matched against "Design Systems"), check directly which
// of the user's own real skills are actually mentioned in the job text,
// with word boundaries so "Go" doesn't match inside "Google".
/*
 * D49 — the denominator is the JOB's required skills, not the user's own.
 *
 * It used to be `matchedSkills.length / userSkills.length`: the share of the
 * USER'S skills a job mentions. Measured on 220 live jobs against a real
 * account, that meant:
 *
 *   - adding a genuine skill LOWERED the score on every job not mentioning it
 *     (SQL -0.019, Accessibility -0.023)
 *   - of 74 skills the user lacked, exactly ONE would have raised her score
 *   - deleting six of her eleven real skills raised it; keeping only
 *     "Leadership" was +166%
 *   - 219 of 220 jobs scored between 50% and 69% overall - almost no signal
 *
 * The product rewarded telling it less about yourself, which undercut score
 * coaching and every feature built on the number. Operator took Option B.
 *
 * THE FLOOR is 4, chosen from the measured distribution rather than picked:
 * extracted-skills-per-job has p25 = 4 and median 5, and 15% of jobs carry
 * only 2-3. Without a floor, matching both skills of a two-skill posting reads
 * 100% - a perfect match against a posting we barely parsed. The floor moves
 * the denominator on 15% of jobs and leaves the median case untouched.
 *
 * `matchedSkills` is unchanged: it is what the breakdown displays, and it is
 * still the user's own skills that appear in the posting.
 */
const JOB_SKILLS_FLOOR = 4;

const calculateSkillsScore = (userSkills, jobText) => {
  if (!userSkills.length || !jobText) return { score: 0, matchedSkills: [] };

  const matchedSkills = userSkills.filter((skill) => {
    const pattern = new RegExp(`(?<![a-zA-Z0-9])${escapeRegExp(skill)}(?![a-zA-Z0-9])`, 'i');
    return pattern.test(jobText);
  });

  /*
   * The posting's own requirements, read with the same extractor the job card
   * already shows - so the denominator is a number the user can see for
   * themselves rather than one only the engine knows.
   */
  const jobSkills = extractSkills(jobText);
  const denominator = Math.max(jobSkills.length, JOB_SKILLS_FLOOR);

  return {
    score: Math.min(1, matchedSkills.length / denominator),
    matchedSkills,
    jobSkillCount: jobSkills.length,
  };
};

const EXPERIENCE_PATTERN = /(\d+)\+?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:experience|exp)/i;

const scoreExperience = (userYears, jobText) => {
  const expMatch = jobText?.match(EXPERIENCE_PATTERN);
  const requiredYears = expMatch ? parseInt(expMatch[1], 10) : 3;

  if (requiredYears === 0 || userYears >= requiredYears) return 1.0;
  return Math.max(0.3, userYears / requiredYears);
};

const scoreLocation = (preferredLocations, jobLocation) => {
  if (!preferredLocations || !preferredLocations.length) return 0.7;

  if (preferredLocations.includes('Remote') && jobLocation?.toLowerCase().includes('remote')) {
    return 1.0;
  }

  const matchFound = preferredLocations.some((loc) =>
    jobLocation?.toLowerCase().includes(loc.toLowerCase())
  );

  return matchFound ? 1.0 : 0.6;
};

const scoreSalary = (userMin, userMax, salaryMin, salaryMax) => {
  if (!userMin && !userMax) return 0.7;

  const jobMin = salaryMin || 0;
  const jobMax = salaryMax || jobMin * 1.5;

  if (jobMin >= userMin && jobMax <= userMax) return 1.0;

  const overlap = Math.max(0, Math.min(jobMax, userMax) - Math.max(jobMin, userMin));
  if (overlap > 0) {
    return Math.min(1.0, overlap / (userMax - userMin));
  }

  return Math.max(0.4, jobMax / userMin);
};

// Everything needed to score this user against any number of jobs, fetched
// once instead of once per job - the previous version re-queried skills,
// experience span, and preferences on every single job, which was fine at
// a few dozen jobs but became ~5 DB round-trips x every active job (tens of
// thousands after the source expansion), taking minutes per user.
const getUserMatchContext = async (userId) => {
  const [skillsResult, experienceResult, preferencesResult] = await Promise.all([
    query('SELECT skill FROM user_skills WHERE user_id = $1', [userId]),
    query(
      `SELECT MIN(start_date) as earliest_start, MAX(COALESCE(end_date, CURRENT_DATE)) as latest_end
       FROM user_experience WHERE user_id = $1 AND start_date IS NOT NULL`,
      [userId]
    ),
    query('SELECT preferred_locations, min_salary, max_salary FROM user_preferences WHERE user_id = $1', [userId]),
  ]);

  const userSkills = skillsResult.rows.map((r) => r.skill);

  const { earliest_start: earliestStart, latest_end: latestEnd } = experienceResult.rows[0] || {};
  const userYears = earliestStart
    ? (new Date(latestEnd) - new Date(earliestStart)) / (1000 * 60 * 60 * 24 * 365.25)
    : 0;

  const prefs = preferencesResult.rows[0] || {};

  return {
    userSkills,
    userYears,
    preferredLocations: prefs.preferred_locations || [],
    minSalary: prefs.min_salary,
    maxSalary: prefs.max_salary,
  };
};

// Pure, in-memory scoring - no DB calls - so it's cheap to run against
// thousands of jobs in a loop.
const scoreJobAgainstContext = (job, context) => {
  const jobText = `${job.title} ${job.description || ''} ${job.requirements || ''}`;

  const { score: skillsScore, matchedSkills } = calculateSkillsScore(context.userSkills, jobText);
  const experienceScore = scoreExperience(context.userYears, jobText);
  const locationScore = scoreLocation(context.preferredLocations, job.location);
  const salaryScore = scoreSalary(context.minSalary, context.maxSalary, job.salary_min, job.salary_max);

  const overallScore = (
    skillsScore * 0.40 +
    experienceScore * 0.30 +
    locationScore * 0.20 +
    salaryScore * 0.10
  );

  return {
    overall_score: Math.min(1.0, Math.max(0, overallScore)),
    skills_match_score: skillsScore,
    experience_match_score: experienceScore,
    location_match_score: locationScore,
    salary_match_score: salaryScore,
    // Only matched_skills is consumed (agents/[id].js). user_skills used to be
    // stored here too, identically on every row for a user, which is the same
    // array duplicated thousands of times for no reader.
    match_details: {
      matched_skills: matchedSkills,
    },
  };
};

// Single-job lookup, kept for callers that only need one score (fetches its
// own context - fine at this scale since it's one job, not thousands).
const calculateJobMatch = async (userId, jobId) => {
  const jobResult = await query(
    'SELECT title, description, requirements, salary_min, salary_max, location FROM jobs WHERE id = $1',
    [jobId]
  );

  if (!jobResult.rows.length) {
    throw new Error('Job not found');
  }

  const context = await getUserMatchContext(userId);
  return scoreJobAgainstContext(jobResult.rows[0], context);
};

const MATCH_THRESHOLD = 0.3;
const UPSERT_CHUNK_SIZE = 500;

// Only the strongest matches are persisted. Previously every job scoring above
// the threshold was stored, which for one user against ~18k active jobs meant
// ~18k rows (23MB) - and that figure is per user, so a handful of accounts
// would have exhausted the 500MB volume on this table alone. Nobody reviews
// 18k matches; the UI pages through the top of the list. Keeping the top N
// preserves everything anyone actually sees.
const MATCH_STORE_LIMIT = Number(process.env.MATCH_STORE_LIMIT) || 500;

// A7.20 — the separate bound for rows scored because a user actually looked at
// them. Larger than the sweep's cap (these are jobs someone browsed, not a
// speculative top-N) and still bounded, at roughly 2.5MB per user by the same
// ratio that made MATCH_STORE_LIMIT necessary.
const ON_DEMAND_STORE_LIMIT = Number(process.env.ON_DEMAND_STORE_LIMIT) || 2000;

// Batches the upsert into chunks of multi-row INSERT...ON CONFLICT statements
// instead of one round-trip per job - the previous version issued one INSERT
// per matched job, which at thousands of matches was most of the recalculate
// endpoint's latency on its own.
const upsertMatchesBatch = async (userId, rows, { onDemand = false } = {}) => {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK_SIZE);
    const values = [];
    const placeholders = chunk.map((row, idx) => {
      const base = idx * 9;
      values.push(
        userId,
        row.jobId,
        row.overall_score,
        row.skills_match_score,
        row.experience_match_score,
        row.location_match_score,
        row.salary_match_score,
        JSON.stringify(row.match_details),
        onDemand
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`;
    });

    await query(
      `INSERT INTO job_matches (user_id, job_id, overall_score, skills_match_score,
       experience_match_score, location_match_score, salary_match_score, match_details, on_demand)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (user_id, job_id) DO UPDATE SET
       overall_score = EXCLUDED.overall_score,
       skills_match_score = EXCLUDED.skills_match_score,
       experience_match_score = EXCLUDED.experience_match_score,
       location_match_score = EXCLUDED.location_match_score,
       salary_match_score = EXCLUDED.salary_match_score,
       match_details = EXCLUDED.match_details,
       -- Once the periodic sweep claims a row, it stays sweep-owned and the
       -- top-N retention below covers it. Only a row the sweep has never
       -- written stays flagged as on-demand.
       on_demand = (job_matches.on_demand AND EXCLUDED.on_demand),
       calculated_at = CURRENT_TIMESTAMP`,
      values
    );
  }
};

const calculateMatchesForUser = async (userId) => {
  try {
    const context = await getUserMatchContext(userId);

    /*
     * GOAL 1c — read the index in BOUNDED CHUNKS, not all at once.
     *
     * This was a single `SELECT id, title, description, requirements, ...
     * FROM jobs WHERE is_active = true` with no LIMIT. node-postgres buffers a
     * result set completely before handing it back, so every call materialised
     * all ~25,400 active rows in one array - including description and
     * requirements, the two largest columns in the table - and then built a
     * second array from them.
     *
     * That is the first thing found that fits the outages: a crash record of
     * 551 MB RSS at ten seconds of uptime, no crash log (an OOM kill leaves
     * none - the process never runs another instruction), no watchdog recovery
     * (it exits a wedged process; it cannot survive being killed), and
     * recovery only on redeploy. It is reachable from a plain feed read, since
     * scoreIfNeverScored calls this on a user's first /api/matches.
     *
     * Chunked by id, which is indexed and total-ordered, so no row is seen
     * twice or missed as the table changes underneath a long run - OFFSET
     * paging over a live table cannot promise that. Only the survivors are
     * retained, and they are trimmed back to the cap as we go, so peak memory
     * is one chunk plus at most MATCH_STORE_LIMIT rows regardless of index
     * size.
     */
    const CHUNK = Number(process.env.MATCH_SCAN_CHUNK) || 2000;
    const RETAIN = MATCH_STORE_LIMIT * 2; // headroom so a trim cannot drop a row that would have made the cut
    let scored = [];
    let afterId = 0;

    for (;;) {
      const chunk = await query(
        `SELECT id, title, description, requirements, salary_min, salary_max, location
           FROM jobs WHERE is_active = true AND id > $1
          ORDER BY id ASC LIMIT $2`,
        [afterId, CHUNK]
      );
      if (!chunk.rows.length) break;

      for (const job of chunk.rows) {
        const score = scoreJobAgainstContext(job, context);
        if (score.overall_score > MATCH_THRESHOLD) {
          scored.push({ jobId: job.id, ...score });
        }
      }
      afterId = chunk.rows[chunk.rows.length - 1].id;

      // Trim as we go: without this a permissive threshold rebuilds the very
      // unbounded array this change exists to remove.
      if (scored.length > RETAIN) {
        scored.sort((a, b) => b.overall_score - a.overall_score);
        scored = scored.slice(0, RETAIN);
      }
      if (chunk.rows.length < CHUNK) break;
    }

    scored.sort((a, b) => b.overall_score - a.overall_score);
    const matchedRows = scored.slice(0, MATCH_STORE_LIMIT);

    await upsertMatchesBatch(userId, matchedRows);

    // Drop anything that fell out of the top N (or below threshold) on this
    // run, so repeated recalculation converges on the cap instead of
    // accumulating every job the user has ever matched.
    const keepIds = matchedRows.map((r) => r.jobId);
    if (keepIds.length) {
      await query(
        `DELETE FROM job_matches
          WHERE user_id = $1 AND on_demand = false AND NOT (job_id = ANY($2::int[]))`,
        [userId, keepIds]
      );
    } else {
      await query('DELETE FROM job_matches WHERE user_id = $1 AND on_demand = false', [userId]);
    }

    /*
     * A7.20 — on-demand rows are exempt from the top-N cap, because the point
     * of scoring a row on demand is that the user is looking at it and the
     * sweep did not rank it highly enough to store. They still need a bound:
     * this table is per-user, and the volume it sits on has been filled once
     * already. Keep the most recently scored, drop the rest.
     */
    await query(
      `DELETE FROM job_matches
        WHERE user_id = $1 AND on_demand = true
          AND job_id NOT IN (
            SELECT job_id FROM job_matches
             WHERE user_id = $1 AND on_demand = true
             ORDER BY calculated_at DESC
             LIMIT $2
          )`,
      [userId, ON_DEMAND_STORE_LIMIT]
    );

    return {
      matchesCreated: matchedRows.length,
      matchesConsidered: scored.length,
      capped: scored.length > MATCH_STORE_LIMIT,
    };
  } catch (err) {
    console.error('Calculate matches for user error:', err);
    throw err;
  }
};

/*
 * A7.20 — score these jobs for this user, now, and remember the answer.
 *
 * A7.17 made the index the universe, correctly. Scoring runs periodically, so
 * any job ingested since the last sweep has no score for this user - and the
 * "past 24 hours" filter selects exactly those rows, which is why it showed
 * 20 of 20 unscored while the default feed showed none.
 *
 * Persisted, so it is computed once per user per job rather than once per
 * request. Deliberately NOT filtered by MATCH_THRESHOLD: the sweep stores only
 * strong matches, but a row the user is looking at needs a score whatever that
 * score is, and dropping the weak ones would mean re-scoring them on every
 * page view AND leaving them unscored on screen.
 *
 * Returns a Map of jobId -> score. A job that cannot be scored is simply
 * absent, so the caller can withhold it rather than render it unscored.
 */
/*
 * L2 — a blank profile is unscoreable, and an unscoreable profile gets NO
 * numbers. A zero-skill, zero-experience context still earns ~0.30 from the
 * location/salary default weights, and the feed rendered that as "30%
 * match" on every row for a brand-new account - a judgement computed from
 * no information about the person. calculateMatchesForUser had the A2
 * guard; this on-demand path (the feed, from-url) did not.
 */
const contextScoreable = (context) => (context.userSkills.length > 0 || context.userYears > 0);

/**
 * Can this user's profile honestly be scored at all? For the feed to state.
 * One query, and absent evidence of the answer defaults OPEN (scoreable):
 * the real query always returns a row, so the default only exists for test
 * fixtures that predate it - and a false "unscoreable" would silently strip
 * ranking from a real user, which is the worse direction.
 */
const profileScoreable = async (userId) => {
  const r = await query(
    `SELECT (
       EXISTS (SELECT 1 FROM user_skills WHERE user_id = $1)
       OR EXISTS (SELECT 1 FROM user_experience WHERE user_id = $1 AND start_date IS NOT NULL)
     ) AS scoreable`,
    [userId]
  );
  const v = r.rows[0]?.scoreable;
  return v === undefined ? true : Boolean(v);
};

const scoreJobsForUser = async (userId, jobIds) => {
  const ids = [...new Set((jobIds || []).map(Number).filter(Number.isInteger))];
  if (!userId || !ids.length) return new Map();

  const [context, jobsResult] = await Promise.all([
    getUserMatchContext(userId),
    query(
      `SELECT id, title, description, requirements, salary_min, salary_max, location
         FROM jobs WHERE id = ANY($1::int[])`,
      [ids]
    ),
  ]);

  if (!contextScoreable(context)) return new Map();

  const scored = [];
  const out = new Map();
  for (const job of jobsResult.rows) {
    try {
      const score = scoreJobAgainstContext(job, context);
      scored.push({ jobId: job.id, ...score });
      out.set(job.id, score);
    } catch (err) {
      // One unscoreable row must not cost the other nineteen their scores.
      console.error(`A7.20: could not score job ${job.id} for user ${userId}:`, err.message);
    }
  }

  if (scored.length) await upsertMatchesBatch(userId, scored, { onDemand: true });
  return out;
};

module.exports = {
  calculateJobMatch,
  calculateMatchesForUser,
  scoreJobsForUser,
  profileScoreable,
  ON_DEMAND_STORE_LIMIT,
};
