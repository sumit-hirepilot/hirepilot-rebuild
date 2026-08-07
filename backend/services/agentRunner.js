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
  const remoteOk = agent.remote_ok !== false;
  const minMatchScore = agent.min_match_score != null ? Number(agent.min_match_score) : 0.75;

  const remoteClause = remoteOk ? '' : `AND work_arrangement != 'remote'`;

  /*
   * Paged by id, because this selects DESCRIPTIONS and a broad keyword matches
   * most of the index.
   *
   * It was one unbounded SELECT: every active job whose title or description
   * matched, with its full description, in a single resident array. The active
   * corpus is ~17,500 postings carrying ~53MB of description text, so a single
   * agent with a keyword like "design" could pull a large fraction of that into
   * memory at once - and runAllActiveAgents does this once per agent, in a
   * cycle that already peaks.
   *
   * It has never fired in anger only because no account has created a search
   * agent yet, which is not a bound - it is an absence of users. Same shape as
   * the ATS sources: the cost scales with the corpus, not with usage.
   */
  const PAGE = Number(process.env.AGENT_SCAN_PAGE) || 1000;

  let newMatches = 0;
  let scanned = 0;
  let afterId = 0;

  for (;;) {
    const jobsResult = await query(
      `SELECT id, title, description, work_arrangement FROM jobs
        WHERE is_active = true AND id > $${keywordParams.length + 1}
          AND (${keywordConditions}) ${remoteClause}
        ORDER BY id
        LIMIT $${keywordParams.length + 2}`,
      [...keywordParams, afterId, PAGE]
    );
    if (!jobsResult.rows.length) break;

    for (const job of jobsResult.rows) {
      afterId = job.id;
      scanned += 1;
      const text = `${job.title} ${job.description || ''}`.toLowerCase();
      const isExcluded = excludeKeywords.some((k) => text.includes(k.toLowerCase()));
      if (isExcluded) continue;

      const matchedKeywordCount = keywords.filter((k) => text.includes(k.toLowerCase())).length;
      const score = keywords.length ? matchedKeywordCount / keywords.length : 0;
      if (score < minMatchScore) continue;

      const inserted = await query(
        `INSERT INTO agent_matches (agent_id, job_id) VALUES ($1, $2)
         ON CONFLICT (agent_id, job_id) DO NOTHING RETURNING id`,
        [agent.id, job.id]
      );
      if (inserted.rows.length) newMatches++;
    }

    if (jobsResult.rows.length < PAGE) break;
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

  // `scanned` across every page, not the last page's length - which is what
  // `jobsResult.rows.length` would now be, and would under-report by design.
  return { jobsScanned: scanned, newMatches };
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
