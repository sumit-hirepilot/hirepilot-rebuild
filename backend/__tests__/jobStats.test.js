/*
 * G0.1 — the hero counters must be real or honestly absent.
 *
 * These assert the two things that were wrong on the live site: a fabricated
 * "180+" for companies watched directly, and placeholder values a visitor
 * reads as data. The endpoint either returns integers derived from the same
 * rows the feed serves, or it fails loudly enough that the page can say so.
 */

const request = require('supertest');

jest.mock('../db', () => ({ query: jest.fn() }));
const { query } = require('../db');

// The stats route is public, but the router mounts auth middleware for other
// paths, so the app is built the same way index.js builds it.
const express = require('express');
const jobsRouter = require('../routes/jobs');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/jobs', jobsRouter);
  return a;
}

describe('GET /api/jobs/stats', () => {
  beforeEach(() => query.mockReset());

  it('returns real integers, not placeholders', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ jobs: 23130, sources: 13, companies: 4211 }] })
      .mockResolvedValueOnce({ rows: [{ n: 187 }] })
      .mockResolvedValueOnce({ rows: [{ last: '2026-07-31T09:00:00.000Z' }] });

    const res = await request(app()).get('/api/jobs/stats');

    expect(res.status).toBe(200);
    expect(res.body.jobs).toBe(23130);
    expect(res.body.sources).toBe(13);
    // The number the page prints for "companies watched directly". Before this
    // goal the page printed the string "180+" regardless of what this was.
    expect(res.body.directCompanies).toBe(187);
    expect(typeof res.body.directCompanies).toBe('number');
    expect(res.body.lastSyncedAt).toBeTruthy();
  });

  it('counts companies watched directly from ATS sources only', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ jobs: 10, sources: 2, companies: 5 }] })
      .mockResolvedValueOnce({ rows: [{ n: 3 }] })
      .mockResolvedValueOnce({ rows: [{ last: null }] });

    await request(app()).get('/api/jobs/stats');

    // "Watched directly" means we poll that company's own board. A job merely
    // listed on an aggregator does not make its employer a watched company, so
    // the query must be restricted to the three ATS sources.
    const directCall = query.mock.calls[1];
    expect(directCall[1]).toEqual([['greenhouse', 'lever', 'ashby']]);
    expect(directCall[0]).toMatch(/\bsource = ANY\b/);
  });

  it('fails with 503 rather than reporting zero', async () => {
    query.mockRejectedValue(new Error('db down'));

    const res = await request(app()).get('/api/jobs/stats');

    // A zeroed body would be indistinguishable from a genuinely empty index,
    // and the page renders those two states differently - one says "0 jobs",
    // the other says the count is unavailable.
    expect(res.status).toBe(503);
    expect(res.body.jobs).toBeUndefined();
    expect(res.body.error).toMatch(/unavailable/i);
  });
});
