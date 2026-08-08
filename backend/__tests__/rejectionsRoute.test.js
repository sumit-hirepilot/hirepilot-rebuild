/*
 * Feature 11 — the route feeds the analyzer only what actually reached an
 * employer, scoped to the caller.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = { id: 42 }; next(); },
}));

const { query } = require('../db');
const analyticsRouter = require('../routes/analytics');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/analytics', analyticsRouter);
  return a;
}

describe('GET /api/analytics/rejections', () => {
  beforeEach(() => query.mockReset());

  it('reads only sent-or-manual rows, scoped to the user, with score attached', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app()).get('/api/analytics/rejections');
    expect(res.status).toBe(200);

    const [sql, params] = query.mock.calls[0];
    expect(params).toContain(42);
    expect(sql).toMatch(/status = 'submitted' OR .*is_manual/i);
    expect(sql).toMatch(/JOIN jobs/i);
    expect(sql).toMatch(/job_matches/i);
  });

  it('returns the honest insufficient state for a thin account', async () => {
    query.mockResolvedValueOnce({
      rows: [{ source: 'greenhouse', title: 'X', status: 'submitted', tracker_stage: null, overall_score: null }],
    });
    const res = await request(app()).get('/api/analytics/rejections');
    expect(res.body.sufficient).toBe(false);
    expect(res.body.sentTotal).toBe(1);
    expect(res.body.needed).toBe(15);
    expect(res.body.bySource).toBeNull();
  });
});
