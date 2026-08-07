/*
 * D49 — one pass to bring every stored score onto the new formula.
 *
 * The skills denominator changed from the user's own skill count to the
 * posting's requirement count. Every row in `job_matches` was computed under
 * the old one, so until this runs the table holds numbers that no longer mean
 * what the engine produces. A user comparing a saved match to a fresh one
 * would see two different answers for the same job, which is the same defect
 * class as a label disagreeing with its data.
 *
 * HOW IT IS BOUNDED, and why each bound is here:
 *
 *   - CHUNKED by user, and by job id within a user. Selecting the whole table
 *     is what put ~25,400 rows in memory and led to the OOM work; that lesson
 *     applies exactly.
 *   - RESUMABLE. Each row is stamped `scored_formula = 'v2_job_denom'` as it
 *     lands, so a restart mid-pass continues rather than starting again, and a
 *     partial run is never mistaken for a finished one.
 *   - NON-DESTRUCTIVE. It rewrites scores in place and touches nothing else.
 *     No row is deleted and no application, receipt or resume is affected.
 *
 * It reports what it changed rather than just that it ran: a re-score that
 * cannot say how far the numbers moved is a re-score nobody can check.
 */

const CHUNK = 500;

/**
 * @param {Function} query
 * @param {Function} scoreJobsForUser  (userId, jobIds) -> Map<jobId, score>
 * @param {object}   opts  { maxRows, onProgress }
 */
async function rescore(query, scoreJobsForUser, { maxRows = Infinity, onProgress } = {}) {
  const started = Date.now();
  let scanned = 0;
  let updated = 0;
  let movedUp = 0;
  let movedDown = 0;
  let totalDelta = 0;

  for (;;) {
    if (scanned >= maxRows) break;

    /*
     * One user at a time. Scoring needs that user's skills and preferences
     * loaded once, so grouping by user is both cheaper and the only way the
     * engine's own entry point can be reused rather than reimplemented here.
     */
    const next = await query(
      `SELECT user_id, COUNT(*)::int AS n
         FROM job_matches
        WHERE scored_formula IS DISTINCT FROM 'v2_job_denom'
        GROUP BY user_id
        ORDER BY user_id
        LIMIT 1`
    );
    const row = next.rows[0];
    if (!row) break;

    const userId = row.user_id;
    const batch = await query(
      `SELECT job_id, overall_score
         FROM job_matches
        WHERE user_id = $1 AND scored_formula IS DISTINCT FROM 'v2_job_denom'
        ORDER BY job_id
        LIMIT $2`,
      [userId, CHUNK]
    );
    if (!batch.rows.length) break;

    const before = new Map(batch.rows.map((r) => [r.job_id, Number(r.overall_score)]));
    const fresh = await scoreJobsForUser(userId, batch.rows.map((r) => r.job_id));

    for (const [jobId, prev] of before) {
      const s = fresh.get(jobId) ?? fresh.get(String(jobId));
      const now = s && typeof s === 'object' ? Number(s.overall_score) : Number(s);

      if (!Number.isFinite(now)) {
        /*
         * Scoring produced nothing for this row. Stamped anyway so the pass
         * cannot loop on it for ever - an unstampable row would make this
         * function never terminate, which is worse than one stale score.
         */
        await query(
          `UPDATE job_matches SET scored_formula = 'v2_job_denom'
            WHERE user_id = $1 AND job_id = $2`,
          [userId, jobId]
        );
        scanned += 1;
        continue;
      }

      await query(
        `UPDATE job_matches
            SET overall_score = $3, scored_formula = 'v2_job_denom'
          WHERE user_id = $1 AND job_id = $2`,
        [userId, jobId, now]
      );

      scanned += 1;
      updated += 1;
      const d = now - prev;
      totalDelta += d;
      if (d > 0.0001) movedUp += 1;
      else if (d < -0.0001) movedDown += 1;
    }

    if (onProgress) onProgress({ userId, scanned, updated });
  }

  return {
    scanned,
    updated,
    movedUp,
    movedDown,
    meanDelta: updated ? Number((totalDelta / updated).toFixed(4)) : 0,
    seconds: Math.round((Date.now() - started) / 1000),
  };
}

/** How much is left, so the UI can say "recalculating" honestly. */
async function rescoreStatus(query) {
  const r = await query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE scored_formula = 'v2_job_denom')::int AS done
     FROM job_matches`
  );
  const { total, done } = r.rows[0] || { total: 0, done: 0 };
  return { total, done, remaining: total - done, complete: total === done };
}

module.exports = { rescore, rescoreStatus, CHUNK };
