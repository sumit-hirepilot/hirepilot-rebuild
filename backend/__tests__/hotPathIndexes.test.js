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

describe('A7.17 — the hot paths are indexed', () => {
  it('indexes the feed filter and its sort key together', () => {
    // WHERE is_active = true ORDER BY posted_at DESC is every unfiltered feed
    // query. Separate single-column indexes do not serve it as well as the
    // composite, and posted_at DESC NULLS LAST is the actual sort (A7.7).
    expect(src).toMatch(/CREATE INDEX IF NOT EXISTS idx_jobs_active_posted\b/);
    expect(src).toMatch(/ON jobs\s*\(is_active, posted_at DESC NULLS LAST\)/);
  });

  it('indexes the partition key of the diversity window', () => {
    // ROW_NUMBER() OVER (PARTITION BY jobs.source ...) sorts the whole set by
    // source without one.
    expect(src).toMatch(/CREATE INDEX IF NOT EXISTS idx_jobs_source\b/);
  });

  it('indexes the join key the ranked feed reads on every row', () => {
    /*
     * LEFT JOIN job_matches jm ON jm.job_id = jobs.id AND jm.user_id = $1.
     * user_id first: it is the equality predicate, job_id is the join column.
     * Reversed, the index cannot serve the user filter.
     */
    expect(src).toMatch(/CREATE INDEX IF NOT EXISTS idx_job_matches_user_job\b/);
    expect(src).toMatch(/ON job_matches\s*\(user_id, job_id\)/);
  });

  it('indexes the score, which is the ranked sort key', () => {
    expect(src).toMatch(/CREATE INDEX IF NOT EXISTS idx_job_matches_user_score\b/);
    expect(src).toMatch(/ON job_matches\s*\(user_id, overall_score DESC NULLS LAST\)/);
  });

  it('adds them without dropping or rewriting anything', () => {
    // No destructive migration. Every one of these is additive and re-runnable.
    // Anchored first: without this the slice below is src.slice(-401, 399) on
    // a missing index, and the whole test passes before the code exists.
    const from = src.indexOf('idx_jobs_active_posted');
    const to = src.indexOf('idx_job_matches_user_score');
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const block = src.slice(from - 400, to + 400);
    expect(block).not.toMatch(/DROP INDEX|DROP TABLE|DROP COLUMN|TRUNCATE/);
    const creates = block.match(/CREATE INDEX(?! IF NOT EXISTS)/g) || [];
    expect(creates).toHaveLength(0);
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
