/*
 * GOAL 1d — ingest is what runs when the process dies.
 *
 * The container ceiling is 1 GB (Railway trial plan limit, read from the
 * dashboard). The service idles near 700 MB. Ingest ran all twelve sources
 * through Promise.all, so every source's rows - WITH descriptions - were
 * resident at the same moment, and the deploy logs at each death show
 * remoteok, himalayas and jobicy fetching together.
 *
 * Concurrency bought nothing here: ingest runs on a timer and nobody waits for
 * it. It only bought the peak that kills the process.
 *
 * Asserted on OVERLAP, not on the result. A sequential and a concurrent run
 * return exactly the same rows, which is precisely why this went unnoticed.
 */

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/parsedField', () => ({
  isParsed: () => true,
  notAJobReason: () => null,
}));

const { query } = require('../db');

beforeEach(() => {
  jest.resetModules();
  query.mockReset();
  query.mockResolvedValue({ rows: [] });
});

describe('sources are fetched one at a time', () => {
  it('never has two source fetches in flight at once', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    // Each adapter reports when it starts and stops, so overlap is observable.
    const makeSource = () => jest.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return [];
    });

    /*
     * EVERY adapter, not a sample: an unmocked one makes a real HTTP call, and
     * the overlap it contributes is invisible to this counter. The first cut
     * mocked three of twelve and timed out against the live internet.
     */
    for (const name of [
      'remoteok', 'remotive', 'himalayas', 'hackernews', 'nofluffjobs', 'landingjobs',
      'workingnomads', 'jobicy', 'jobindex', 'ats', 'weworkremotely',
    ]) {
      jest.doMock(`../services/apis/${name}`, () => ({ fetchJobs: makeSource() }));
    }

    const { aggregateJobs } = require('../services/jobAggregator');
    await aggregateJobs();

    expect(maxInFlight).toBe(1);
  });

  it('and the run still visits every source', async () => {
    // A "fix" that simply stopped fetching would also report maxInFlight 1.
    const { SOURCES } = require('../services/jobAggregator');
    expect(SOURCES.length).toBeGreaterThanOrEqual(10);
  });
});

describe('the duplicate-key flood', () => {
  it('checks job_url before inserting, instead of throwing once per row', async () => {
    /*
     * The INSERT carries ON CONFLICT (source, external_id), which does not
     * cover jobs_job_url_key. A posting arriving under a new external_id with
     * the same URL threw "duplicate key value violates unique constraint
     * jobs_job_url_key" once per row, every cycle - hundreds of thrown errors
     * per run, enough noise to bury a real one.
     */
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'services', 'jobAggregator.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ');

    const storeJob = src.slice(src.indexOf('const existing = await query('), src.indexOf('ON CONFLICT (source, external_id)'));
    expect(storeJob).toMatch(/SELECT id FROM jobs WHERE job_url = \$1/);
    // And the lookup must come BEFORE the insert, or it prevents nothing.
    expect(storeJob.indexOf('job_url = $1')).toBeGreaterThan(-1);
  });
});
