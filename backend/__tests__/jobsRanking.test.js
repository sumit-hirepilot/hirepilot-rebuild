/*
 * A7.1 — the browsable feed must be the same product as the Dashboard.
 *
 * They diverged for one mechanical reason: /api/jobs was unauthenticated, so
 * it could not personalise even in principle and fell back to posted_at DESC,
 * while /api/matches was authenticated and ordered by score. The Jobs page
 * compounded it by sending no Authorization header at all.
 *
 * These pin the properties that stop it recurring: a signed-in caller is
 * ranked by score by default, the floor is applied and reported, and no single
 * source can own a page.
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

function mockRows() {
  query.mockReset();
  // count, then page. Both branches issue exactly these two in order.
  query
    .mockResolvedValueOnce({ rows: [{ count: '12' }] })
    .mockResolvedValueOnce({ rows: [{ id: 1, title: 'Senior Product Designer', source: 'greenhouse', overall_score: '0.75' }] })
    .mockResolvedValue({ rows: [] });
}

describe('A7.1 — a signed-in caller gets the scored feed by default', () => {
  it('ranks by score without being asked to', async () => {
    mockRows();
    const res = await request(app()).get('/api/jobs?limit=1').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.ranking.mode).toBe('score');
    const sql = query.mock.calls.map((c) => c[0]).join('\n');
    expect(sql).toMatch(/JOIN job_matches/);
    expect(sql).not.toMatch(/ORDER BY posted_at DESC\s*\n\s*LIMIT/);
  });

  it('selects the score onto every row, because that is the differentiator', async () => {
    /*
     * Asserting `res.body.jobs[0].overall_score` is defined proves nothing:
     * the fixture row carries that field, and the old code spread the row
     * through untouched, so it passed against the broken build. Assert on the
     * query that actually produces the column.
     */
    mockRows();
    await request(app()).get('/api/jobs?limit=1').set('Authorization', `Bearer ${token}`);

    const pageSql = query.mock.calls[1][0];
    expect(pageSql).toMatch(/jm\.overall_score/);
    expect(pageSql).toMatch(/jm\.skills_match_score/);
  });

  it('applies a floor and states it, never silently', async () => {
    mockRows();
    const res = await request(app()).get('/api/jobs?limit=1&minScore=0.6').set('Authorization', `Bearer ${token}`);

    expect(res.body.ranking.minScore).toBe(0.6);
    const params = query.mock.calls[0][1];
    expect(params).toContain(0.6);
    expect(query.mock.calls[0][0]).toMatch(/overall_score >= \$/);
  });

  it('caps any single source without breaking score order', async () => {
    /*
     * micro1 alone swamped every page of results.
     *
     * The first implementation interleaved by source_rank, which prevented
     * domination but broke the score ordering - the list descended, then
     * jumped back up when the next round began. Capping each source's
     * contribution and ordering by score honours both requirements at once,
     * so this pins BOTH halves: the cap exists, and score is the sort key.
     */
    mockRows();
    await request(app()).get('/api/jobs?limit=20').set('Authorization', `Bearer ${token}`);

    const pageSql = query.mock.calls[1][0];
    expect(pageSql).toMatch(/ROW_NUMBER\(\) OVER \(\s*PARTITION BY jobs\.source/);
    expect(pageSql).toMatch(/WHERE source_rank <=/);
    expect(pageSql).toMatch(/ORDER BY overall_score DESC/);
    expect(pageSql).not.toMatch(/ORDER BY source_rank/);
  });
});

describe('A7.1 — unranked browse stays available, but only on request', () => {
  it('falls back to chronological for an anonymous caller', async () => {
    mockRows();
    const res = await request(app()).get('/api/jobs?limit=1'); // no token

    expect(res.status).toBe(200);
    expect(res.body.ranking.mode).toBe('recent');
    expect(query.mock.calls.map((c) => c[0]).join('\n')).not.toMatch(/JOIN job_matches/);
  });

  it('honours an explicit opt-out into unranked browse', async () => {
    mockRows();
    const res = await request(app()).get('/api/jobs?limit=1&sort=recent').set('Authorization', `Bearer ${token}`);

    expect(res.body.ranking.mode).toBe('recent');
    expect(res.body.ranking.minScore).toBeNull();
  });

  it('never rejects a browse request over a bad token', async () => {
    // Browsing jobs must degrade to unpersonalised, not 401.
    mockRows();
    const res = await request(app()).get('/api/jobs?limit=1').set('Authorization', 'Bearer not-a-jwt');

    expect(res.status).toBe(200);
    expect(res.body.ranking.mode).toBe('recent');
  });
});
