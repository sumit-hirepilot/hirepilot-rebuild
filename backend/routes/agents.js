const express = require('express');
const { query } = require('../db');
const { verifyToken } = require('../middleware/auth');
const { runAgent } = require('../services/agentRunner');

const router = express.Router();

router.use(verifyToken);

// List search agents with match counts
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT sa.*, COUNT(am.id) as match_count
       FROM search_agents sa
       LEFT JOIN agent_matches am ON am.agent_id = sa.id
       WHERE sa.user_id = $1
       GROUP BY sa.id
       ORDER BY sa.created_at DESC`,
      [req.user.id]
    );

    res.json({ agents: result.rows });
  } catch (err) {
    console.error('List agents error:', err);
    res.status(500).json({ error: 'Failed to fetch search agents' });
  }
});

// Create a search agent
router.post('/', async (req, res) => {
  try {
    const {
      name, description, queryKeywords, includeKeywords, excludeKeywords,
      jobTypes, workArrangements, preferredLocations, minSalary, maxSalary,
    } = req.body;

    if (!name || !queryKeywords || !queryKeywords.length) {
      return res.status(400).json({ error: 'Name and at least one keyword are required' });
    }

    const result = await query(
      `INSERT INTO search_agents (
         user_id, name, description, query_keywords, include_keywords, exclude_keywords,
         job_types, work_arrangements, preferred_locations, min_salary, max_salary
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        req.user.id, name, description || null, queryKeywords, includeKeywords || [],
        excludeKeywords || [], jobTypes || [], workArrangements || [], preferredLocations || [],
        minSalary || null, maxSalary || null,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create agent error:', err);
    res.status(500).json({ error: 'Failed to create search agent' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, description, isActive, queryKeywords, includeKeywords, excludeKeywords } = req.body;

    const result = await query(
      `UPDATE search_agents SET name = $1, description = $2, is_active = $3,
       query_keywords = $4, include_keywords = $5, exclude_keywords = $6, updated_at = CURRENT_TIMESTAMP
       WHERE id = $7 AND user_id = $8 RETURNING *`,
      [name, description || null, isActive, queryKeywords, includeKeywords || [], excludeKeywords || [], req.params.id, req.user.id]
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Search agent not found' });

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
      `SELECT j.id, j.title, j.company_name, j.location, j.job_url, j.posted_at, am.matched_at
       FROM agent_matches am
       JOIN jobs j ON am.job_id = j.id
       WHERE am.agent_id = $1
       ORDER BY am.matched_at DESC`,
      [req.params.id]
    );

    res.json({ matches: result.rows });
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
