const express = require('express');
const { query } = require('../db');
const { verifyToken } = require('../middleware/auth');
const { analyze } = require('../services/rejectionIntelligence');

const router = express.Router();

router.use(verifyToken);

/*
 * Feature 11 — rejection intelligence (D3). Conversion patterns across the
 * caller's SENT applications; the analyzer enforces the 15-application floor
 * and withholds every rate below it. Only rows that reached an employer
 * (submitted, or manually vouched) can carry an outcome, so only those are
 * read. LEFT JOIN on the score: an unscored application is a real state the
 * analyzer buckets as such, never a dropped row.
 */
router.get('/rejections', async (req, res) => {
  try {
    const r = await query(
      `SELECT j.source, j.title, a.status, a.tracker_stage, jm.overall_score
         FROM applications a
         JOIN jobs j ON j.id = a.job_id
         LEFT JOIN job_matches jm ON jm.job_id = a.job_id AND jm.user_id = $1
        WHERE a.user_id = $1 AND (a.status = 'submitted' OR COALESCE(a.is_manual, FALSE) = TRUE)`,
      [req.user.id]
    );
    res.json(analyze(r.rows));
  } catch (err) {
    console.error('GET /analytics/rejections failed:', err.message);
    res.status(500).json({ error: 'Could not compute rejection patterns' });
  }
});

router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;

    const [dailyResult, statusResult, sourceResult, totalsResult] = await Promise.all([
      query(
        `SELECT DATE(applied_at) as day, COUNT(*) as count
         FROM applications
         WHERE user_id = $1 AND applied_at >= CURRENT_DATE - INTERVAL '13 days'
         GROUP BY DATE(applied_at)
         ORDER BY day`,
        [userId]
      ),
      query(
        `SELECT status, COUNT(*) as count FROM applications WHERE user_id = $1 GROUP BY status`,
        [userId]
      ),
      query(
        `SELECT j.source, COUNT(*) as count
         FROM applications a JOIN jobs j ON a.job_id = j.id
         WHERE a.user_id = $1 GROUP BY j.source`,
        [userId]
      ),
      query(
        /*
         * A response is a conversation that moved: tracker_stage interviewing
         * or offer on a row that actually reached the employer. The old
         * version counted statuses (technical_interview, onsite, hired) the
         * live constraints stop anything from writing, so a user with three
         * interviews on the tracker read "0 responses" - a fabricated zero
         * wearing a real query. hired is gone for the same reason: no write
         * path records being hired, and a permanent 0 under that label reads
         * as a fact about the user when it is a fact about the schema.
         */
        `SELECT
           COUNT(*) as total_applications,
           COUNT(CASE WHEN (status = 'submitted' OR is_manual = TRUE)
                       AND tracker_stage IN ('interviewing','offer') THEN 1 END) as responses,
           COUNT(CASE WHEN (status = 'submitted' OR is_manual = TRUE)
                       AND tracker_stage = 'offer' THEN 1 END) as offers,
           COUNT(CASE WHEN submitted_by = 'auto_pilot' THEN 1 END) as auto_applied
         FROM applications WHERE user_id = $1`,
        [userId]
      ),
    ]);

    // Build a complete 14-day series (fill gaps with 0)
    const dailyMap = {};
    dailyResult.rows.forEach((r) => { dailyMap[r.day.toISOString().slice(0, 10)] = parseInt(r.count, 10); });
    const daily = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      daily.push({ date: key, count: dailyMap[key] || 0 });
    }

    const total = parseInt(totalsResult.rows[0].total_applications, 10) || 0;
    const responses = parseInt(totalsResult.rows[0].responses, 10) || 0;
    const responseRate = total > 0 ? Math.round((responses / total) * 100) : 0;

    res.json({
      daily,
      statusBreakdown: statusResult.rows.map((r) => ({ status: r.status, count: parseInt(r.count, 10) })),
      sourceBreakdown: sourceResult.rows.map((r) => ({ source: r.source, count: parseInt(r.count, 10) })),
      totals: {
        totalApplications: total,
        responses,
        offers: parseInt(totalsResult.rows[0].offers, 10) || 0,
        autoApplied: parseInt(totalsResult.rows[0].auto_applied, 10) || 0,
        responseRate,
      },
    });
  } catch (err) {
    console.error('Get analytics error:', err);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

module.exports = router;
