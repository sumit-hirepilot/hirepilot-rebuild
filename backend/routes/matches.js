const express = require('express');
const { query } = require('../db');
const { verifyToken } = require('../middleware/auth');
const { calculateJobMatch, calculateMatchesForUser } = require('../services/matchingEngine');
const { fixMojibake } = require('../services/apis/textSanitizer');

const router = express.Router();

// Get user's job matches (sorted by score)

/*
 * Why a job scored what it did (PRD 7.1).
 *
 * The engine already computes and stores four sub-scores; nothing was surfacing
 * them, so a match was a bare percentage the user had no way to argue with. The
 * weights are stated alongside because a 70% built on skills means something
 * different from a 70% built on salary, and a number nobody can interrogate is
 * a number nobody should trust.
 *
 * Weights mirror calculateMatch in services/matchingEngine.js.
 */
const WEIGHTS = [
  ['skills', 'Skills overlap', 'skills_match_score', 0.40],
  ['experience', 'Experience fit', 'experience_match_score', 0.30],
  ['location', 'Location fit', 'location_match_score', 0.20],
  ['salary', 'Salary alignment', 'salary_match_score', 0.10],
];

function breakdownFor(row) {
  const parts = WEIGHTS.map(([id, label, field, weight]) => {
    const score = Number(row[field] ?? 0);
    return {
      id,
      label,
      score,
      weight,
      // How much of the overall score this component actually contributed -
      // the honest answer to "what is carrying this match".
      contribution: Number((score * weight).toFixed(4)),
    };
  });
  const matched = (row.match_details && row.match_details.matched_skills) || [];
  return {
    components: parts,
    matchedSkills: Array.isArray(matched) ? matched.slice(0, 20) : [],
    // The single biggest contributor, for a one-line summary in a card.
    leading: parts.slice().sort((a, b) => b.contribution - a.contribution)[0] || null,
  };
}

/*
 * Score on read when a user has a profile but no stored matches.
 *
 * Scoring used to depend on which page the user came through. onboarding.js
 * recalculates only on its FINAL step, so anyone who abandoned it midway was
 * never scored; resume.js applies parsed skills and never recalculates at all,
 * so uploading a resume from the Resume page - the obvious place to do it -
 * left the feed empty with no explanation. A new user's first impression of
 * the product was an empty feed and no reason for it.
 *
 * Putting it here means no page can forget: any path that gives a user skills
 * results in a scored feed the next time they read it. Returns whether it ran
 * so the caller can say so rather than silently appearing slow.
 */
async function scoreIfNeverScored(userId) {
  const [{ rows: matchRows }, { rows: skillRows }] = await Promise.all([
    query('SELECT 1 FROM job_matches WHERE user_id = $1 LIMIT 1', [userId]),
    query('SELECT 1 FROM user_skills WHERE user_id = $1 LIMIT 1', [userId]),
  ]);
  // Only when there is something to score against. A user with no skills gets
  // the empty state with a reason, not a pointless full-table scan per load.
  if (matchRows.length > 0 || skillRows.length === 0) return false;

  await calculateMatchesForUser(userId);
  return true;
}

router.get('/', verifyToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, minScore = 0.3 } = req.query;
    const offset = (page - 1) * limit;

    let scoredOnRead = false;
    try {
      scoredOnRead = await scoreIfNeverScored(req.user.id);
    } catch (err) {
      // A scoring failure must not blank the feed - fall through and serve
      // whatever is stored, with the flag telling the client it is incomplete.
      console.error('Score-on-read failed:', err.message);
    }

    // Get count
    const countResult = await query(
      `SELECT COUNT(*) as count FROM job_matches
       WHERE user_id = $1 AND overall_score >= $2`,
      [req.user.id, minScore]
    );

    // Get paginated matches with job details
    const result = await query(
      `SELECT jm.id, jm.overall_score, jm.skills_match_score, jm.experience_match_score,
              jm.location_match_score, jm.salary_match_score, jm.match_details,
              j.id as job_id, j.title, j.company_name, j.location, j.salary_min, j.salary_max,
              j.job_url, j.posted_at
       FROM job_matches jm
       JOIN jobs j ON jm.job_id = j.id
       WHERE jm.user_id = $1 AND jm.overall_score >= $2
       -- A7.7: jm.id is the unique final key. Without it, equal-score rows
       -- come back in whatever order the plan produces and the Dashboard
       -- reshuffles between reloads.
       ORDER BY jm.overall_score DESC, j.posted_at DESC NULLS LAST, jm.id DESC
       LIMIT $3 OFFSET $4`,
      [req.user.id, minScore, limit, offset]
    );

    res.json({
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
      // True only when this request itself produced the scores, so the feed can
      // explain a first load that took a moment instead of just being slow.
      scoredOnRead,
      matches: result.rows.map((m) => ({
        ...m,
        title: fixMojibake(m.title),
        company_name: fixMojibake(m.company_name),
        breakdown: breakdownFor(m),
      })),
    });
  } catch (err) {
    console.error('Get matches error:', err);
    res.status(500).json({ error: 'Failed to fetch matches' });
  }
});

// Recalculate all matches for user
router.post('/recalculate', verifyToken, async (req, res) => {
  try {
    const result = await calculateMatchesForUser(req.user.id);

    res.json({
      message: 'Matches recalculated',
      matchesCreated: result.matchesCreated,
    });
  } catch (err) {
    console.error('Recalculate matches error:', err);
    res.status(500).json({ error: 'Failed to recalculate matches' });
  }
});

module.exports = router;
