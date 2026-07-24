const express = require('express');
const { query } = require('../db');
const { verifyToken } = require('../middleware/auth');
const { aggregateJobs } = require('../services/jobAggregator');

const router = express.Router();

let aggregationInFlight = false;

function classifyExperience(title) {
  const t = (title || '').toLowerCase();
  if (/(staff|principal|distinguished)/.test(t)) return 'staff';
  if (/(senior|sr\.?|lead|head of)/.test(t)) return 'senior';
  if (/(junior|jr\.?|entry|intern|graduate)/.test(t)) return 'entry';
  return 'mid';
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

// Status of each live job source
router.get('/sources', async (req, res) => {
  try {
    const result = await query(
      `SELECT source, COUNT(*) as count, MAX(fetched_at) as last_fetched
       FROM jobs WHERE is_active = true GROUP BY source`
    );

    const bySource = {};
    for (const row of result.rows) {
      bySource[row.source] = { count: parseInt(row.count, 10), lastFetched: row.last_fetched };
    }

    const sources = ['remoteok', 'remotive', 'weworkremotely'].map((key) => ({
      source: key,
      count: bySource[key]?.count || 0,
      lastFetched: bySource[key]?.lastFetched || null,
    }));

    res.json({ sources });
  } catch (err) {
    console.error('Get sources error:', err);
    res.status(500).json({ error: 'Failed to fetch source status' });
  }
});

// Get all active jobs with pagination and filters
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, search, source, location, experience } = req.query;
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

    if (location) {
      whereClause += ' AND location ILIKE $' + (params.length + 1);
      params.push(`%${location}%`);
    }

    if (experience === 'senior') {
      whereClause += ` AND title ~* '(senior|sr\\.?|lead|head of)'`;
    } else if (experience === 'staff') {
      whereClause += ` AND title ~* '(staff|principal|distinguished)'`;
    } else if (experience === 'entry') {
      whereClause += ` AND title ~* '(junior|jr\\.?|entry|intern|graduate)'`;
    } else if (experience === 'mid') {
      whereClause += ` AND title !~* '(senior|sr\\.?|lead|head of|staff|principal|distinguished|junior|jr\\.?|entry|intern|graduate)'`;
    }

    const countResult = await query(
      `SELECT COUNT(*) as count FROM jobs ${whereClause}`,
      params
    );

    const result = await query(
      `SELECT id, source, title, company_name, company_url, job_url, location, work_arrangement,
              salary_min, salary_max, job_type, posted_at, created_at
       FROM jobs ${whereClause}
       ORDER BY posted_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    const jobs = result.rows.map((j) => ({ ...j, experienceLevel: classifyExperience(j.title) }));

    res.json({
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
      jobs,
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

    res.json({ ...result.rows[0], experienceLevel: classifyExperience(result.rows[0].title) });
  } catch (err) {
    console.error('Get job error:', err);
    res.status(500).json({ error: 'Failed to fetch job' });
  }
});

module.exports = router;
