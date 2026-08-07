/*
 * A large ATS source must never hold its whole catalogue in memory.
 *
 * GOAL 1d bounded how many companies are fetched AT ONCE. It did not bound how
 * many postings are RESIDENT: every window's rows were pushed into one array
 * and the whole array handed to the caller, which held it while writing.
 *
 * Measured on a real boot, with per-phase instrumentation rather than a guess:
 *
 *   aggregate:after jobindex    rss=243MB heap=25MB   total=3,740
 *   aggregate:after greenhouse  rss=377MB heap=158MB  total=13,919
 *
 * 10,179 postings with descriptions arriving in one array, against a 500MB
 * budget, on an environment with two users. It scales with the SOURCE, not with
 * usage, so it only ever gets worse.
 *
 * Two hypotheses died before this was measured and are recorded so nobody
 * re-runs them: concurrent source fetches (already sequential since GOAL 1d)
 * and the search-agent scan (this environment has zero active agents).
 */

const ats = require('../services/apis/ats');

/* Enough companies to span several windows. */
const WINDOW = ats.FETCH_WINDOW;

describe('the streaming form never accumulates', () => {
  it('hands over every posting without ever holding them all', async () => {
    const batches = [];
    let maxResident = 0;

    // Rebuilt through the public entry point, so this tests the shipped path.
    const fake = jest.spyOn(require('axios'), 'get').mockImplementation(async () => ({
      data: { jobs: Array.from({ length: 50 }, (_, i) => ({ id: i, title: `Job ${i}`, content: 'x'.repeat(200), location: { name: 'Remote' }, updated_at: null, absolute_url: 'https://example.test' })) },
    }));

    try {
      const res = await ats.fetchGreenhouseJobs(async (batch) => {
        batches.push(batch.length);
        maxResident = Math.max(maxResident, batch.length);
      });

      expect(batches.length).toBeGreaterThan(1);
      const total = batches.reduce((a, b) => a + b, 0);
      expect(res.fetched).toBe(total);

      // The whole point: no single handover is the entire catalogue.
      expect(maxResident).toBeLessThan(total);
      // And a batch is at most one window's worth of companies.
      expect(maxResident).toBeLessThanOrEqual(WINDOW * 50);
    } finally {
      fake.mockRestore();
    }
  });

  it('waits for each batch to be written before fetching the next', async () => {
    /*
     * Without the await, two windows are resident at once and the bound is
     * only half applied - which would read as fixed while still peaking.
     */
    let inFlight = 0;
    let maxInFlight = 0;

    const fake = jest.spyOn(require('axios'), 'get').mockImplementation(async () => ({
      data: { jobs: [{ id: 1, title: 'J', content: 'x', location: { name: 'Remote' }, absolute_url: 'https://example.test' }] },
    }));

    try {
      await ats.fetchGreenhouseJobs(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
      });
      expect(maxInFlight).toBe(1);
    } finally {
      fake.mockRestore();
    }
  });

  it('still returns an array when no consumer is given', async () => {
    // The non-streaming form is what the smaller sources and the tests use;
    // widening this must not have broken it.
    const fake = jest.spyOn(require('axios'), 'get').mockImplementation(async () => ({
      data: { jobs: [{ id: 1, title: 'J', content: 'x', location: { name: 'Remote' }, absolute_url: 'https://example.test' }] },
    }));
    try {
      const rows = await ats.fetchLeverJobs();
      expect(Array.isArray(rows)).toBe(true);
    } finally {
      fake.mockRestore();
    }
  });
});

describe('the aggregator declares which sources stream', () => {
  it('greenhouse, lever and ashby are marked, and nothing else is', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'services', 'jobAggregator.js'), 'utf8'
    );
    const table = src.slice(src.indexOf('const SOURCES'), src.indexOf('];', src.indexOf('const SOURCES')));
    const streaming = [...table.matchAll(/key: '(\w+)'[^}]*streams: true/g)].map((m) => m[1]);
    expect(streaming.sort()).toEqual(['ashby', 'greenhouse', 'lever']);
  });
});
