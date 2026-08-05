/*
 * A7.17 — one ranking path, and a response shape that does not vary.
 *
 * Written BEFORE the query changes, deliberately. During A7.15 the `ranking`
 * object was ABSENT on two `datePosted=24h` probes and PRESENT on a retry with
 * identical params, which nearly caused a misdiagnosis: the response looked
 * like a different endpoint depending on which branch served it.
 *
 * A caller cannot write correct code against a shape that changes under it.
 */

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

jest.mock('../db', () => ({ query: jest.fn() }));
const { query } = require('../db');
const jobsRouter = require('../routes/jobs');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/jobs', jobsRouter);
  return a;
}

const token = jwt.sign({ id: 42, email: 'a@b.c' }, process.env.JWT_SECRET || 'dev-secret');

// Every branch issues count-then-page; extra calls resolve empty.
function mockRows() {
  query.mockReset();
  query
    .mockResolvedValueOnce({ rows: [{ count: '616' }] })
    .mockResolvedValueOnce({ rows: [{ id: 1, source: 'greenhouse', title: 'Designer', overall_score: '0.75' }] })
    // Later calls are COUNTs too (unknown-date, related) - a bare [] would
    // make rows[0].count throw and read as a product 500.
    .mockResolvedValue({ rows: [{ count: '0' }] });
}

/** The keys every /api/jobs response must carry, whichever branch served it. */
const REQUIRED = ['total', 'page', 'limit', 'jobs', 'ranking'];

const PARAMS = [
  ['plain ranked feed', 'limit=1'],
  ['date filter', 'limit=1&datePosted=24h'],
  ['keyword search', 'limit=1&keywords=figma'],
  ['keyword + date', 'limit=1&keywords=figma&datePosted=24h'],
  ['explicit unranked', 'limit=1&ranked=0'],
  ['recency sort', 'limit=1&sort=recent'],
  ['with a floor', 'limit=1&minScore=0.6'],
];

describe.each(PARAMS)('A7.17 — response shape is deterministic: %s', (_name, qs) => {
  it('always carries the ranking object', async () => {
    mockRows();
    const res = await request(app()).get(`/api/jobs?${qs}`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    for (const key of REQUIRED) {
      // `ranking` absent on SOME branches is the exact defect this pins.
      expect(Object.keys(res.body)).toContain(key);
    }
    expect(res.body.ranking).toEqual(expect.objectContaining({
      mode: expect.any(String),
      sort: expect.any(String),
    }));
  });

  it('returns an identically shaped response on a repeat call', async () => {
    mockRows();
    const a = await request(app()).get(`/api/jobs?${qs}`).set('Authorization', `Bearer ${token}`);
    mockRows();
    const b = await request(app()).get(`/api/jobs?${qs}`).set('Authorization', `Bearer ${token}`);

    // Shape, not values: the same params must not produce a different schema.
    expect(Object.keys(a.body).sort()).toEqual(Object.keys(b.body).sort());
    expect(Object.keys(a.body.ranking).sort()).toEqual(Object.keys(b.body.ranking).sort());
  });
});
