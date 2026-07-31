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

router.get('/', verifyToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, minScore = 0.3 } = req.query;
    const offset = (page - 1) * limit;

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
       ORDER BY jm.overall_score DESC
       LIMIT $3 OFFSET $4`,
      [req.user.id, minScore, limit, offset]
    );

    res.json({
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
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
