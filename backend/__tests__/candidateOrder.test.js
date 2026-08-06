/*
 * A7.8 — the order that decides WHAT GETS APPLIED TO must be deterministic.
 *
 * A7.7 fixed this for the browsable feed: equal scores fell back to insertion
 * order, so the list reshuffled between reloads. The same defect survived on
 * two queries where the consequence is not cosmetic:
 *
 *   apply.js          "apply to all matching" -> ORDER BY overall_score DESC
 *                     LIMIT MAX_BULK
 *   autoApplyEngine   Auto-Pilot's candidates -> ORDER BY jm.overall_score DESC
 *                     LIMIT 50
 *
 * Both cut a ranked list at a limit. With many rows sharing a score - and
 * scores here are a weighted sum of four coarse components, so ties are
 * common - WHICH jobs fall inside the limit is whatever the plan happened to
 * produce. Two identical requests can queue two different sets of employers,
 * and nobody could explain why one job was chosen over another.
 *
 * That is the difference between this and A7.7: there the user saw a list in a
 * strange order, here the product applies to a different company.
 */

const fs = require('fs');
const path = require('path');
const { candidateOrderBySql, CANDIDATE_ORDER } = require('../services/jobOrder');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

describe('A7.8 — one declaration for candidate selection order', () => {
  it('ends on a unique key, so the cut-off is reproducible', () => {
    const sql = candidateOrderBySql();
    expect(sql).toMatch(/job_id DESC$/);
    expect(CANDIDATE_ORDER[0]).toMatch(/overall_score DESC NULLS LAST/);
  });

  it('applies a table alias without changing the order', () => {
    // The two callers alias differently. Prefixing must not silently reorder.
    const plain = candidateOrderBySql().split(',').map((s) => s.trim().split(' ')[0]);
    const aliased = candidateOrderBySql('jm').split(',').map((s) => s.trim().split(' ')[0]);
    expect(aliased).toEqual(plain.map((c) => `jm.${c}`));
  });
});

describe('A7.8 — both selection queries use it', () => {
  it.each([
    ['routes/apply.js', 'apply to all matching'],
    ['services/autoApplyEngine.js', "Auto-Pilot's candidate list"],
    ['routes/matches.js', 'the dashboard match list'],
  ])('%s orders deterministically', (file) => {
    const src = read(file);
    /*
     * Every ORDER BY in these files either delegates to the shared
     * declaration or carries a unique final key of its own.
     *
     * Rewritten from matching "ORDER BY ... overall_score ...", which found
     * nothing once the ordering moved into candidateOrderBySql - the guard
     * failed on the very change it was written to require. Assert the
     * property, not the spelling.
     */
    const orders = src.match(/ORDER BY [^`\n]+/g) || [];
    expect(orders.length).toBeGreaterThan(0);
    for (const o of orders) {
      const delegates = /candidateOrderBySql|orderBySql/.test(o);
      // Any id-shaped column counts: `id`, `job_id`, `concept_id`. The first
      // version listed names, and rejected concept_id because \bid\b does not
      // match inside an underscored word - a guard failing on a correct fix.
      const hasUniqueKey = /\bid\b|\b\w+_id\b|\b(created_at|started_at|submitted_at)\b/.test(o);
      expect(delegates || hasUniqueKey).toBe(true);
    }
  });

  it.each([
    ['routes/apply.js'],
    ['services/autoApplyEngine.js'],
  ])('%s takes the order from the shared declaration', (file) => {
    /*
     * Inside an ORDER BY, not merely somewhere in the file. The first version
     * matched anywhere, and an unused import satisfied it - so replacing the
     * ORDER BY with a hand-written one left the guard green.
     */
    expect(read(file)).toMatch(/ORDER BY \$\{candidateOrderBySql\([^)]*\)\}/);
  });

  it('never lets an unscored row lead a selection', () => {
    // Postgres defaults DESC to NULLS FIRST. These queries filter on
    // `>= minScore` so a NULL cannot pass today - but the ordering must not
    // depend on a WHERE clause somewhere else staying the way it is.
    expect(candidateOrderBySql()).toMatch(/overall_score DESC NULLS LAST/);
  });
});
