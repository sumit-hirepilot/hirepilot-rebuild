/*
 * A7.14 — a source that is not running must not render as a source with no jobs.
 *
 * We Work Remotely sits in the panel as "0 · Publication date unavailable",
 * which is three separate untruths in one line: it is listed under "Live
 * sources" while deliberately not fetched (see the SOURCES comment - the site
 * is behind bot protection and we will not circumvent it); "0" reads as a
 * measured count when nothing was ever measured; and the trailing string is
 * A7.3's vocabulary for a JOB's missing publication date, which says nothing
 * about a SOURCE's last fetch.
 *
 * Same class as A2c: an unmeasured thing rendering as a measured zero. The
 * status has to be derived once, server-side, from whether a fetcher is wired
 * and what the last run did - never inferred in JSX from the row count.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({ query: jest.fn() }));
const { query } = require('../db');
const jobsRouter = require('../routes/jobs');

function app() {
  const a = express();
  a.use('/api/jobs', jobsRouter);
  return a;
}

/** counts, then runs. Both are answered from these two fixtures. */
function mockSources({ counts = [], runs = [] } = {}) {
  query.mockReset();
  query.mockImplementation((sql) => {
    if (/FROM jobs WHERE is_active/.test(sql)) return Promise.resolve({ rows: counts });
    if (/source_ingestion_runs/.test(sql)) return Promise.resolve({ rows: runs });
    return Promise.resolve({ rows: [] });
  });
}

async function sourcesFor(fixture) {
  mockSources(fixture);
  const res = await request(app()).get('/api/jobs/sources');
  expect(res.status).toBe(200);
  const by = {};
  for (const s of res.body.sources) by[s.source] = s;
  return by;
}

describe('A7.14 — status is a property of the fetcher, not of the row count', () => {
  it('reports a deliberately unfetched source as not connected, never as live', async () => {
    const by = await sourcesFor({ counts: [], runs: [] });
    expect(by.weworkremotely).toBeDefined();
    expect(by.weworkremotely.status).toBe('not_connected');
    // The count is meaningless for a source nothing ever fetched. It may be
    // present as 0, but the status must not let a reader treat it as measured.
    expect(by.weworkremotely.status).not.toBe('live');
  });

  it('does not call a source live just because rows exist', async () => {
    // Stale rows from a source that has since started failing is the exact
    // case the count-based dot got backwards.
    const by = await sourcesFor({
      counts: [{ source: 'remoteok', count: '385', last_fetched: new Date().toISOString() }],
      runs: [{ source: 'remoteok', success: false, error_message: 'ETIMEDOUT', duration_ms: 10 }],
    });
    expect(by.remoteok.count).toBe(385);
    expect(by.remoteok.status).toBe('failing');
  });

  it('does not call a source dead just because it currently has no rows', async () => {
    // The inverse: a wired source that ran successfully and matched nothing is
    // working. Zero rows is a real measurement here, unlike weworkremotely.
    const by = await sourcesFor({
      counts: [],
      runs: [{ source: 'remotive', success: true, duration_ms: 120 }],
    });
    expect(by.remotive.count).toBe(0);
    expect(by.remotive.status).toBe('live');
  });

  it('distinguishes never-run from not-connected', async () => {
    // A wired source with no runs yet is pending, not a policy decision.
    const by = await sourcesFor({ counts: [], runs: [] });
    expect(by.remotive.status).toBe('never_run');
    expect(by.weworkremotely.status).toBe('not_connected');
  });
});

describe('A7.14 — the endpoint does not fan out one query per source', () => {
  it('reads success rates in a single query', async () => {
    /*
     * The rates were computed with `await query(...)` inside a for-loop over
     * every source: 13 sequential round trips before the panel can render, and
     * it grows with each source added. Measured against production this
     * endpoint did not return inside 180s.
     */
    mockSources({ counts: [], runs: [] });
    await request(app()).get('/api/jobs/sources');

    const rateQueries = query.mock.calls
      .map((c) => c[0])
      .filter((sql) => /source_ingestion_runs/.test(sql));
    expect(rateQueries.length).toBeLessThanOrEqual(2);
  });
});
