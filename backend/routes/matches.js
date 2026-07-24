const express = require('express');
const { query } = require('../db');
const { verifyToken } = require('../middleware/auth');
const { calculateJobMatch, calculateMatchesForUser } = require('../services/matchingEngine');

const router = express.Router();

// Get user's job matches (sorted by score)
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
      matches: result.rows,
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
