/*
 * The connection pool is sized against what Postgres actually allows.
 *
 * 15 was too small, and it showed as SERVER ERRORS rather than as slowness: at
 * 1,000 concurrent the load test produced 65 HTTP 500s, every one of them
 * `timeout exceeded when trying to connect` out of pg-pool. Requests waited the
 * full connectionTimeoutMillis for a connection that never came free and then
 * failed.
 *
 * The database was never the constraint - `SHOW max_connections` is 100, with
 * 10 in use. The bottleneck was a number chosen conservatively and never
 * checked against the thing it was protecting.
 *
 * The pool must also leave room for a SECOND replica, because the one lever
 * left for the 1,000-concurrent bar is running more than one, and a pool that
 * only fits when there is exactly one replica turns that fix into an outage.
 */

const POSTGRES_MAX_CONNECTIONS = 100;   // measured on the live database
const RESERVED = 10;                    // psql, migrations, the re-score pass

const src = require('fs').readFileSync(
  require('path').join(__dirname, '..', 'db.js'), 'utf8'
);

const poolMax = () => {
  const m = /const POOL_MAX = Number\(process\.env\.PG_POOL_MAX\) \|\| (\d+);/.exec(src);
  return m ? Number(m[1]) : null;
};

describe('the pool fits the database, with room to grow', () => {
  it('is bigger than the 15 that produced 500s', () => {
    expect(poolMax()).toBeGreaterThan(15);
  });

  it('leaves headroom on one replica', () => {
    expect(poolMax()).toBeLessThanOrEqual(POSTGRES_MAX_CONNECTIONS - RESERVED);
  });

  it('still fits when a second replica is added', () => {
    /*
     * This is the constraint that stops the number simply being raised until
     * the errors go away. At 50 two replicas reach exactly 100 and the failure
     * changes from "requests queue" to "Postgres refuses new connections",
     * which is worse and much harder to read from a log.
     */
    expect(poolMax() * 2).toBeLessThanOrEqual(POSTGRES_MAX_CONNECTIONS - RESERVED);
  });

  it('applies to both connection styles, not just the URL one', () => {
    // db.js has a DATABASE_URL branch and a discrete-parameters branch. A pool
    // size set on one of them is a bound that disappears on the other.
    const uses = [...src.matchAll(/max: POOL_MAX,/g)];
    expect(uses).toHaveLength(2);
    expect(src).not.toMatch(/max: 15,/);
  });

  it('keeps the acquire timeout, so a genuinely starved pool still fails fast', () => {
    /*
     * The timeout is not what was wrong - waiting for ever would have been
     * worse. Once 40 connections are all legitimately busy, failing loudly is
     * still the right behaviour.
     */
    expect(src).toMatch(/connectionTimeoutMillis: 10000/);
  });

  it('is overridable without a deploy, for diagnosis', () => {
    expect(src).toMatch(/process\.env\.PG_POOL_MAX/);
  });
});
