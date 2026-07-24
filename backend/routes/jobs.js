const express = require('express');
const { query } = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// Get all active jobs with pagination
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, search, source } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE is_active = true';
    const params = [];

    if (search) {
      whereClause += ' AND (title ILIKE $' + (params.length + 1) + ' OR description ILIKE $' + (params.length + 2) + ')';
      params.push(`%${search}%`, `%${search}%`);
    }

    if (source) {
      whereClause += ' AND source = $' + (params.length + 1);
      params.push(source);
    }

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) as count FROM jobs ${whereClause}`,
      params
    );

    // Get paginated results
    const result = await query(
      `SELECT id, source, title, company_name, company_url, job_url, location, work_arrangement,
              salary_min, salary_max, job_type, posted_at, created_at
       FROM jobs ${whereClause}
       ORDER BY posted_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    res.json({
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
      jobs: result.rows,
    });
  } catch (err) {
    console.error('Get jobs error:', err);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

// Get specific job
router.get('/:id', async (req, res) => {
  try {
    const result = await query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get job error:', err);
    res.status(500).json({ error: 'Failed to fetch job' });
  }
});

module.exports = router;
