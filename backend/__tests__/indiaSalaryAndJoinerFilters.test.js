/*
 * Feature 10 — India salary and notice-period filters.
 *
 * Two honest additions, shaped by what the data can actually support:
 *
 * - Salary bands in INR (LPA), converted from mixed source currencies with
 *   the same static reference rates the USD bands use. A user in Bengaluru
 *   thinks in lakhs; making them do FX arithmetic on a USD band is a filter
 *   that exists but does not serve the wedge.
 *
 * - An "immediate joiner" filter. Jobs carry no notice-period FIELD, and
 *   inventing one per row would be fabricated data. What a posting DOES
 *   sometimes carry is the employer's own sentence - "immediate joiners
 *   preferred", "can join within 15 days". The filter matches only explicit
 *   asks, and each matching row returns the posting's own words as the
 *   evidence (the C4 pattern: quote the source sentence, never conclude).
 */

const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = { id: 42 }; next(); },
  attachUserIfPresent: (req, _res, next) => { next(); },
}));

const { query } = require('../db');
const jobsRouter = require('../routes/jobs');
const { resetFeedCountCache } = jobsRouter;

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/jobs', jobsRouter);
  return a;
}

const defaultRows = (sql) => {
  if (/COUNT/i.test(sql) && !/FILTER/i.test(sql)) return Promise.resolve({ rows: [{ count: '1' }] });
  return Promise.resolve({ rows: [] });
};

beforeEach(() => {
  query.mockReset();
  query.mockImplementation(defaultRows);
  if (resetFeedCountCache) resetFeedCountCache();
});

describe('GET /api/jobs?salaryInr=…', () => {
  it('filters on the INR-converted salary with band bounds', async () => {
    const res = await request(app()).get('/api/jobs?salaryInr=10-25&limit=5');
    expect(res.status).toBe(200);

    const feedSql = query.mock.calls.map((c) => c[0]).find((s) => /SELECT/i.test(s) && /is_active = true/.test(s));
    expect(feedSql).toBeTruthy();
    // The condition converts through the same reference rates (USD equivalent
    // divided by the INR rate), and applies the band's bounds in rupees.
    expect(feedSql).toMatch(/0\.012/);
    expect(feedSql).toMatch(/1000000/);
    expect(feedSql).toMatch(/2500000/);
    // Undisclosed pay is never swept into a band.
    expect(feedSql).toMatch(/salary_min IS NOT NULL/);
  });

  it('multiple INR bands OR together', async () => {
    await request(app()).get('/api/jobs?salaryInr=10-25&salaryInr=gt50&limit=5');
    const feedSql = query.mock.calls.map((c) => c[0]).find((s) => /is_active = true/.test(s));
    expect(feedSql).toMatch(/5000000/);
    expect(feedSql).toMatch(/2500000/);
  });
});

describe('GET /api/jobs?joiner=immediate', () => {
  it('matches only explicit immediate-joiner language in the description', async () => {
    const res = await request(app()).get('/api/jobs?joiner=immediate&limit=5');
    expect(res.status).toBe(200);
    const feedSql = query.mock.calls.map((c) => c[0]).find((s) => /is_active = true/.test(s));
    expect(feedSql).toMatch(/immediate/i);
    expect(feedSql).toMatch(/description/);
  });

  it('returns the posting\'s own sentence as joinerNote on matching rows', async () => {
    query.mockImplementation((sql) => {
      if (/is_active = true/.test(sql) && /joiner_snippet/.test(sql)) {
        return Promise.resolve({
          rows: [{
            id: 1, title: 'Product Designer', company_name: 'X', source: 'greenhouse',
            joiner_snippet: 'We are looking for an immediate joiner who can start within 15 days',
            match_tier: 1,
          }],
        });
      }
      return defaultRows(sql);
    });

    const res = await request(app()).get('/api/jobs?joiner=immediate&limit=5');
    expect(res.status).toBe(200);
    expect(res.body.jobs.length).toBe(1);
    expect(res.body.jobs[0].joinerNote).toMatch(/immediate joiner/i);
    // The raw column name does not leak into the payload.
    expect(res.body.jobs[0].joiner_snippet).toBeUndefined();
  });

  it('rows without the ask carry joinerNote null, never a guess', async () => {
    query.mockImplementation((sql) => {
      if (/is_active = true/.test(sql)) {
        return Promise.resolve({
          rows: [{ id: 2, title: 'X', company_name: 'Y', source: 's', joiner_snippet: null, match_tier: 1 }],
        });
      }
      return defaultRows(sql);
    });
    const res = await request(app()).get('/api/jobs?limit=5');
    expect(res.body.jobs[0].joinerNote).toBeNull();
  });
});

describe('GET /api/jobs/facets carries the new groups', () => {
  it('reports INR band counts and the immediate-joiner count', async () => {
    query.mockImplementation((sql) => {
      if (/lt10/.test(sql)) {
        return Promise.resolve({ rows: [{ lt10: 5, '10-25': 7, '25-50': 3, gt50: 1 }] });
      }
      if (/immediate/i.test(sql) && /FILTER|COUNT/i.test(sql)) {
        return Promise.resolve({ rows: [{ immediate: 42 }] });
      }
      if (/not_listed/.test(sql)) {
        return Promise.resolve({ rows: [{ lt50: 1, '50-100': 2, '100-150': 3, '150-200': 4, gt200: 5, not_listed: 6 }] });
      }
      if (/AS entry/.test(sql)) {
        return Promise.resolve({ rows: [{ entry: 1, mid: 2, senior: 3, staff: 4 }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app()).get('/api/jobs/facets');
    expect(res.status).toBe(200);
    expect(res.body.salaryInr).toBeTruthy();
    const values = res.body.salaryInr.map((b) => b.value);
    expect(values).toEqual(expect.arrayContaining(['lt10', '10-25', '25-50', 'gt50']));
    // Labels speak LPA, and say approx - the rates are reference, not live.
    expect(res.body.salaryInr[0].label).toMatch(/₹/);
    expect(res.body.joiner).toEqual({ immediate: 42 });
  });
});
