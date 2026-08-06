/*
 * GOAL 1g — every table that only ever grows has a retention policy.
 *
 * A full volume stops WRITES - no ingest, no application records, no crash
 * reports - and it does so silently. It has already happened here once, and it
 * is what turned the feed's temp-file spill into SQLSTATE 53100 through five
 * outages.
 *
 * jobs has had a 21-day policy since the first time. Nothing else did.
 * Measured on production: source_ingestion_runs held 6,140 rows and gains one
 * per source per cycle, forever. crash_reports is worse and it is mine - the
 * watchdog writes a memory sample every five minutes, ~288 rows a day, added
 * by the very thing built to diagnose a full disk.
 */

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/parsedField', () => ({ isParsed: () => true, notAJobReason: () => null }));

/*
 * `query` is fetched INSIDE each test, after jest.resetModules().
 *
 * resetModules re-runs the jest.mock factory, so it hands the module under test
 * a brand new jest.fn() while a reference captured at file scope still points
 * at the old one. The first cut of this file did that and saw zero calls -
 * watching one instrument while the code used another.
 */
const ADAPTERS = [
  'remoteok', 'remotive', 'himalayas', 'hackernews', 'nofluffjobs', 'landingjobs',
  'workingnomads', 'jobicy', 'jobindex', 'ats', 'weworkremotely',
];

beforeEach(() => {
  jest.resetModules();
  for (const name of ADAPTERS) {
    jest.doMock(`../services/apis/${name}`, () => ({ fetchJobs: async () => [] }));
  }
});

/** The mock the module under test is actually holding. */
const live = () => require('../db').query;

const runCycle = async () => {
  const q = live();
  q.mockResolvedValue({ rows: [], rowCount: 0 });
  const { aggregateJobs } = require('../services/jobAggregator');
  await aggregateJobs();
  return q.mock.calls.map((c) => c[0]).filter((sql) => /DELETE FROM/i.test(sql));
};

describe('the tables that only grow are pruned', () => {
  it('prunes source_ingestion_runs on an age window', async () => {
    const sql = (await runCycle()).find((q) => /source_ingestion_runs/.test(q));
    expect(sql).toBeDefined();
    expect(sql).toMatch(/created_at < CURRENT_TIMESTAMP - INTERVAL/);
  });

  it('ages out memory samples, which are a trend and not evidence', async () => {
    const sql = (await runCycle()).find((q) => /crash_reports/.test(q) && /event = 'memory'/.test(q));
    expect(sql).toBeDefined();
  });

  it('keeps the most recent crashes whatever their age', async () => {
    /*
     * The reason a process died six weeks ago is still the only record of it.
     * An age-only policy would delete exactly the rows worth keeping.
     */
    const sql = (await runCycle()).find((q) => /crash_reports/.test(q) && /event <> 'memory'/.test(q));
    expect(sql).toBeDefined();
    expect(sql).toMatch(/ORDER BY occurred_at DESC LIMIT/);
  });

  it('never lets retention failure stop the ingest', async () => {
    // Housekeeping is not the job. A failed prune must not cost a cycle.
    const q = live();
    let attempted = false;
    q.mockImplementation((sql) => {
      if (/DELETE FROM (source_ingestion_runs|crash_reports)/.test(sql)) {
        attempted = true;
        return Promise.reject(new Error('permission denied'));
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const { aggregateJobs } = require('../services/jobAggregator');
    await expect(aggregateJobs()).resolves.toBeDefined();
    // And it genuinely tried - otherwise this passes without exercising anything.
    expect(attempted).toBe(true);
  });
});
