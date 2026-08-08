/*
 * Analytics counted "responses" as status IN (technical_interview, onsite,
 * offer, hired) - a vocabulary no write path can produce on this database
 * (the CHECK constraints refuse it for every submitted row). So a user with
 * three interviews recorded on the tracker read "0 responses", a fabricated
 * zero wearing a real query.
 *
 * A response is a conversation that moved: tracker_stage interviewing or
 * offer on a row that actually reached the employer.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = { id: 42, email: 'nobody@example.com' }; next(); },
}));

const { query } = require('../db');
const analyticsRouter = require('../routes/analytics');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/analytics', analyticsRouter);
  return a;
}

describe('GET /api/analytics', () => {
  beforeEach(() => {
    query.mockReset();
    query.mockImplementation((sql) => {
      if (/DATE\(applied_at\)/.test(sql)) return Promise.resolve({ rows: [] });
      if (/GROUP BY status/.test(sql)) return Promise.resolve({ rows: [{ status: 'submitted', count: '3' }] });
      if (/GROUP BY j\.source/.test(sql)) return Promise.resolve({ rows: [] });
      return Promise.resolve({
        rows: [{ total_applications: '3', responses: '2', offers: '1', auto_applied: '0' }],
      });
    });
  });

  it('counts responses from tracker_stage, not from statuses nothing writes', async () => {
    const res = await request(app()).get('/api/analytics');
    expect(res.status).toBe(200);

    const totalsSql = query.mock.calls.map((c) => c[0]).find((s) => /responses/.test(s));
    expect(totalsSql).toBeTruthy();
    expect(totalsSql).toMatch(/tracker_stage/);
    expect(totalsSql).not.toMatch(/technical_interview|onsite|hired/);
  });

  it('reports offers, which the tracker records, instead of hired, which nothing does', async () => {
    const res = await request(app()).get('/api/analytics');
    expect(res.body.totals.offers).toBe(1);
    // No write path produces status='hired'; a permanent 0 under that label
    // reads as a fact about the user when it is a fact about the schema.
    expect(res.body.totals.hired).toBeUndefined();
  });
});
