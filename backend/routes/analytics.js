const express = require('express');
const { query } = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

router.use(verifyToken);

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
        `SELECT
           COUNT(*) as total_applications,
           COUNT(CASE WHEN status IN ('technical_interview','onsite','offer','hired') THEN 1 END) as responses,
           COUNT(CASE WHEN status = 'hired' THEN 1 END) as hired,
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
        hired: parseInt(totalsResult.rows[0].hired, 10) || 0,
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
