const express = require('express');
const { query } = require('../db');
const { verifyToken } = require('../middleware/auth');
const { runAgent } = require('../services/agentRunner');
const { fixMojibake } = require('../services/apis/textSanitizer');

const router = express.Router();

router.use(verifyToken);

// List search agents with match + applied counts
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT sa.*, COUNT(DISTINCT am.id) as match_count,
              COUNT(DISTINCT a.id) as applied_count
       FROM search_agents sa
       LEFT JOIN agent_matches am ON am.agent_id = sa.id
       LEFT JOIN applications a ON a.job_id = am.job_id AND a.user_id = sa.user_id
       WHERE sa.user_id = $1
       GROUP BY sa.id
       ORDER BY sa.created_at DESC, sa.id DESC`,
      [req.user.id]
    );

    res.json({ agents: result.rows });
  } catch (err) {
    console.error('List agents error:', err);
    res.status(500).json({ error: 'Failed to fetch search agents' });
  }
});

// Get a single search agent
router.get('/:id', async (req, res) => {
  try {
    const result = await query(
      `SELECT sa.*, COUNT(DISTINCT am.id) as match_count,
              COUNT(DISTINCT a.id) as applied_count
       FROM search_agents sa
       LEFT JOIN agent_matches am ON am.agent_id = sa.id
       LEFT JOIN applications a ON a.job_id = am.job_id AND a.user_id = sa.user_id
       WHERE sa.id = $1 AND sa.user_id = $2
       GROUP BY sa.id`,
      [req.params.id, req.user.id]
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Search agent not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get agent error:', err);
    res.status(500).json({ error: 'Failed to fetch search agent' });
  }
});

// Estimate how many currently-active jobs match a draft agent config.
// jobs are marked inactive after 7 days, so this count is a genuine
// approximation of "jobs per week" - not a fabricated number.
router.post('/preview', async (req, res) => {
  try {
    const { queryKeywords = [], remoteOk = true } = req.body;
    if (!queryKeywords.length) return res.json({ estimate: 0 });

    const keywordConditions = queryKeywords
      .map((_, i) => `(title ILIKE $${i + 1} OR description ILIKE $${i + 1})`)
      .join(' OR ');
    const params = queryKeywords.map((k) => `%${k}%`);
    const remoteClause = remoteOk ? '' : `AND work_arrangement != 'remote'`;

    const result = await query(
      `SELECT COUNT(*) as count FROM jobs WHERE is_active = true AND (${keywordConditions}) ${remoteClause}`,
      params
    );

    res.json({ estimate: parseInt(result.rows[0].count, 10) });
  } catch (err) {
    console.error('Preview agent error:', err);
    res.status(500).json({ error: 'Failed to estimate matches' });
  }
});

// Create a search agent
router.post('/', async (req, res) => {
  try {
    const {
      name, description, queryKeywords, includeKeywords, excludeKeywords,
      jobTypes, workArrangements, preferredLocations, minSalary, maxSalary,
      minMatchScore, remoteOk, autoApply,
    } = req.body;

    if (!name || !queryKeywords || !queryKeywords.length) {
      return res.status(400).json({ error: 'Name and at least one keyword are required' });
    }

    const result = await query(
      `INSERT INTO search_agents (
         user_id, name, description, query_keywords, include_keywords, exclude_keywords,
         job_types, work_arrangements, preferred_locations, min_salary, max_salary,
         min_match_score, remote_ok, auto_apply
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [
        req.user.id, name, description || null, queryKeywords, includeKeywords || [],
        excludeKeywords || [], jobTypes || [], workArrangements || [], preferredLocations || [],
        minSalary || null, maxSalary || null, minMatchScore ?? 0.75, remoteOk !== false, !!autoApply,
      ]
    );

    await query(
      `INSERT INTO activity_log (user_id, event_type, metadata)
       VALUES ($1, 'agent_created', $2)`,
      [req.user.id, JSON.stringify({ agent_name: name })]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create agent error:', err);
    res.status(500).json({ error: 'Failed to create search agent' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const existingResult = await query('SELECT * FROM search_agents WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!existingResult.rows.length) return res.status(404).json({ error: 'Search agent not found' });
    const existing = existingResult.rows[0];
    const body = req.body;
    const pick = (key, column) => (body[key] !== undefined ? body[key] : existing[column]);

    const result = await query(
      `UPDATE search_agents SET name = $1, description = $2, is_active = $3,
       query_keywords = $4, include_keywords = $5, exclude_keywords = $6,
       preferred_locations = $7, min_salary = $8, max_salary = $9,
       min_match_score = $10, remote_ok = $11, auto_apply = $12, updated_at = CURRENT_TIMESTAMP
       WHERE id = $13 AND user_id = $14 RETURNING *`,
      [
        pick('name', 'name'), pick('description', 'description'), pick('isActive', 'is_active'),
        pick('queryKeywords', 'query_keywords'), pick('includeKeywords', 'include_keywords'),
        pick('excludeKeywords', 'exclude_keywords'), pick('preferredLocations', 'preferred_locations'),
        pick('minSalary', 'min_salary'), pick('maxSalary', 'max_salary'),
        pick('minMatchScore', 'min_match_score'), pick('remoteOk', 'remote_ok'), pick('autoApply', 'auto_apply'),
        req.params.id, req.user.id,
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update agent error:', err);
    res.status(500).json({ error: 'Failed to update search agent' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await query('DELETE FROM search_agents WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ message: 'Search agent deleted' });
  } catch (err) {
    console.error('Delete agent error:', err);
    res.status(500).json({ error: 'Failed to delete search agent' });
  }
});

// Get matches found by an agent
router.get('/:id/matches', async (req, res) => {
  try {
    const agentCheck = await query('SELECT id FROM search_agents WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!agentCheck.rows.length) return res.status(404).json({ error: 'Search agent not found' });

    const result = await query(
      `SELECT j.id, j.title, j.company_name, j.location, j.description, j.job_url, j.posted_at,
              j.salary_min, j.salary_max, j.work_arrangement, am.matched_at,
              jm.overall_score, jm.skills_match_score, jm.experience_match_score,
              jm.location_match_score, jm.match_details,
              a.id as application_id, a.status as application_status
       FROM agent_matches am
       JOIN jobs j ON am.job_id = j.id
       LEFT JOIN job_matches jm ON jm.job_id = j.id AND jm.user_id = $2
       LEFT JOIN applications a ON a.job_id = j.id AND a.user_id = $2
       WHERE am.agent_id = $1
       ORDER BY jm.overall_score DESC NULLS LAST, am.matched_at DESC NULLS LAST, am.id DESC`,
      [req.params.id, req.user.id]
    );

    const matches = result.rows.map((row) => ({
      ...row,
      title: fixMojibake(row.title),
      company_name: fixMojibake(row.company_name),
      description: fixMojibake(row.description),
    }));

    res.json({ matches });
  } catch (err) {
    console.error('Get agent matches error:', err);
    res.status(500).json({ error: 'Failed to fetch agent matches' });
  }
});

// Run a search agent now: scans active jobs for keyword matches
router.post('/:id/run', async (req, res) => {
  try {
    const agentResult = await query(
      'SELECT * FROM search_agents WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (!agentResult.rows.length) return res.status(404).json({ error: 'Search agent not found' });

    if (!agentResult.rows[0].query_keywords || !agentResult.rows[0].query_keywords.length) {
      return res.status(400).json({ error: 'This agent has no keywords configured' });
    }

    const result = await runAgent(agentResult.rows[0]);

    res.json({ message: 'Agent run complete', ...result });
  } catch (err) {
    console.error('Run agent error:', err);
    res.status(500).json({ error: 'Failed to run search agent' });
  }
});

module.exports = router;
