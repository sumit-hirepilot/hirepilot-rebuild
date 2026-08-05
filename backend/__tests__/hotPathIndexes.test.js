/*
 * A7.17 (perf half) — the index is the universe now, so the universe needs
 * indexes.
 *
 * A7.17 removed the 500-row cap, which was accidentally doing double duty: it
 * bounded the result set AND it kept the query small. With it gone, every
 * ranked feed query scans 24,800 jobs and hash-joins job_matches. Neither
 * table carried a single index - not on is_active, not on posted_at, not on
 * source, and not on the (user_id, job_id) pair the LEFT JOIN keys on.
 *
 * The instruction on this was explicit: if p95 degrades, add indexes - never
 * reinstate the cap. These pin the indexes so a later migration edit cannot
 * quietly drop the thing holding the feed up.
 *
 * runMigrations logs a failed statement and continues, so a CREATE INDEX that
 * fails is indistinguishable from one that worked. Declaring it here is
 * necessary and NOT sufficient - /api/jobs/db-health reads pg_indexes so the
 * claim can be checked against the running database.
 */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'migrations.js'), 'utf8');

describe('A7.17 — one index, and the planner asked for it', () => {
  it('indexes the selective path, which is the one A7.17 unlocked', () => {
    /*
     * Measured on production, not assumed:
     *   unfiltered feed  42.19ms  2 seq scans  indexes used: none
     *   24h filtered      1.47ms  1 seq scan   uses idx_jobs_active_posted
     *
     * posted_at carries DESC NULLS LAST to match A7.7's sort exactly. A plain
     * DESC index does not serve NULLS LAST without a sort step, which is the
     * whole point of having it.
     */
    expect(src).toMatch(/CREATE INDEX IF NOT EXISTS idx_jobs_active_posted\b/);
    expect(src).toMatch(/ON jobs\s*\(is_active, posted_at DESC NULLS LAST\)/);
  });

  it('does not carry indexes no plan names', () => {
    /*
     * Three went in on reasoning and came out on evidence: jobs(source) cannot
     * help a window that already sorts the full scan, and both job_matches
     * indexes lose to a hash join over a 500-row table. On a volume that has
     * filled once and taken production down, an index no plan names is cost
     * with no return.
     *
     * Asserted as "not created", not merely "dropped" - a later edit that
     * re-adds the CREATE alongside the DROP would leave whichever ran last.
     */
    for (const dead of ['idx_jobs_source', 'idx_job_matches_user_job', 'idx_job_matches_user_score']) {
      expect(src).not.toMatch(new RegExp(`CREATE INDEX IF NOT EXISTS ${dead}\\b`));
      expect(src).toMatch(new RegExp(`DROP INDEX IF EXISTS ${dead}\\b`));
    }
  });

  it('reclaims them from databases that already created them', () => {
    // The drop is the deliverable, not the omission: production ran the
    // CREATE before the measurement said otherwise.
    expect(src).toMatch(/DROP INDEX IF EXISTS/);
  });

  it('drops only indexes, never data', () => {
    const from = src.indexOf('idx_jobs_active_posted');
    expect(from).toBeGreaterThan(-1);
    const block = src.slice(from - 1600, from + 900);
    expect(block).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/);
    expect(block).not.toMatch(/CREATE INDEX(?! IF NOT EXISTS)/);
    expect(block).not.toMatch(/DROP INDEX(?! IF EXISTS)/);
  });
});

describe('A7.17 — the claim is checkable against the running database', () => {
  const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'jobs.js'), 'utf8');

  it('exposes the indexes actually present, not the ones we meant to create', () => {
    /*
     * runMigrations swallows a failed statement. Declaring an index proves
     * intent; reading the catalog proves existence. Containment is not
     * existence - same reason A1's constraint check reads pg_constraint.
     *
     * Scoped to the handler and to a FROM clause on purpose. The first version
     * asserted the catalog name appeared anywhere in the file, and the comment
     * above this route contains that name - so mutating the actual query left
     * the guard green. An assertion satisfied by prose is not a guard.
     */
    const start = routes.indexOf("router.get('/db-health'");
    expect(start).toBeGreaterThan(-1);
    const handler = routes.slice(start, routes.indexOf("router.get('/sources'", start));
    expect(handler).toMatch(/FROM pg_indexes\b/);
    expect(handler).toMatch(/tablename IN \('jobs', 'job_matches'\)/);
  });
});
