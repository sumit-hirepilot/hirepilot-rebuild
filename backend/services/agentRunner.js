const { query } = require('../db');

const runAgent = async (agent) => {
  const keywords = agent.query_keywords || [];
  const excludeKeywords = agent.exclude_keywords || [];

  if (!keywords.length) {
    return { jobsScanned: 0, newMatches: 0 };
  }

  const keywordConditions = keywords
    .map((_, i) => `(title ILIKE $${i + 1} OR description ILIKE $${i + 1})`)
    .join(' OR ');
  const keywordParams = keywords.map((k) => `%${k}%`);

  const jobsResult = await query(
    `SELECT id, title, description FROM jobs WHERE is_active = true AND (${keywordConditions})`,
    keywordParams
  );

  let newMatches = 0;
  for (const job of jobsResult.rows) {
    const text = `${job.title} ${job.description || ''}`.toLowerCase();
    const isExcluded = excludeKeywords.some((k) => text.includes(k.toLowerCase()));
    if (isExcluded) continue;

    const inserted = await query(
      `INSERT INTO agent_matches (agent_id, job_id) VALUES ($1, $2)
       ON CONFLICT (agent_id, job_id) DO NOTHING RETURNING id`,
      [agent.id, job.id]
    );
    if (inserted.rows.length) newMatches++;
  }

  await query(
    `UPDATE search_agents SET last_run_at = CURRENT_TIMESTAMP,
     next_run_at = CURRENT_TIMESTAMP + INTERVAL '6 hours' WHERE id = $1`,
    [agent.id]
  );

  if (newMatches > 0) {
    await query(
      `INSERT INTO activity_log (user_id, event_type, metadata)
       VALUES ($1, 'agent_matches_found', $2)`,
      [agent.user_id, JSON.stringify({ agent_name: agent.name, count: newMatches })]
    );
  }

  return { jobsScanned: jobsResult.rows.length, newMatches };
};

const runAllActiveAgents = async () => {
  const agentsResult = await query('SELECT * FROM search_agents WHERE is_active = true', []);
  let totalNewMatches = 0;

  for (const agent of agentsResult.rows) {
    try {
      const result = await runAgent(agent);
      totalNewMatches += result.newMatches;
    } catch (err) {
      console.error(`Error running agent ${agent.id}:`, err.message);
    }
  }

  return { agentsRun: agentsResult.rows.length, totalNewMatches };
};

module.exports = {
  runAgent,
  runAllActiveAgents,
};
