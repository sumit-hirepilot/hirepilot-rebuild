/*
 * A7.11 — 4,685 jobs with no publication date must not vanish from the product.
 *
 * Reproduced against production: himalayas reports posted_null 4685 of 4685 -
 * every row it supplies, 18.9% of the whole index. Their pubDate field is not
 * a publish date: eight unrelated companies came back with timestamps inside
 * an 11-minute window on the day we fetched, which is their ingest clock.
 * Filling posted_at from it would fabricate freshness, which is exactly what
 * the null exists to prevent.
 *
 * The backfill option in the goal is closed too: the original posting page
 * returns 403 to a plain server request. Getting past that is circumventing
 * bot protection, which is the line D19 already drew for We Work Remotely.
 *
 * So the remaining requirement stands on its own - "silently dropping a fifth
 * of the index out of a sort is not an option". A7.7 sorts posted_at DESC
 * NULLS LAST, which is correct and, at this scale, means those rows are
 * permanently last and unreachable. They are now counted, stated, and
 * reachable in one click.
 */

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

jest.mock('../db', () => ({ query: jest.fn() }));
const { query } = require('../db');
const jobsRouter = require('../routes/jobs');

function app() {
  const a = express();
  a.use('/api/jobs', jobsRouter);
  return a;
}

const token = jwt.sign({ id: 42, email: 'a@b.c' }, process.env.JWT_SECRET || 'dev-secret');

function mockRows(counts = [7]) {
  query.mockReset();
  let i = 0;
  query.mockImplementation((sql) => {
    if (/SELECT COUNT\(\*\)/.test(sql)) {
      const v = counts[Math.min(i, counts.length - 1)];
      i += 1;
      return Promise.resolve({ rows: [{ count: String(v) }] });
    }
    return Promise.resolve({ rows: [{ id: 1, source: 'himalayas', posted_at: null }] });
  });
}

describe('A7.11 — undated jobs are counted and stated, never silently last', () => {
  it('reports how many rows carry no publication date when sorting by recency', async () => {
    mockRows([120, 33]);
    const res = await request(app())
      .get('/api/jobs?limit=20&sort=recent')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // Not "how many are on this page" - how many the sort has pushed behind
    // everything else across the whole filtered set.
    expect(res.body.ranking.undatedTotal).toBe(33);
  });

  it('keeps the key present when it does not apply', async () => {
    // A7.17's shape rule. Sorting by score does not bury anything by date, so
    // the number is null rather than absent or a fabricated 0.
    mockRows([120]);
    const res = await request(app())
      .get('/api/jobs?limit=20&sort=score')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.ranking).toHaveProperty('undatedTotal');
    expect(res.body.ranking.undatedTotal).toBeNull();
  });

  it('never fabricates a date to make them sortable', async () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'apis', 'himalayas.js'), 'utf8');
    // Their pubDate is an ingest clock. COALESCE-ing posted_at to anything -
    // now(), created_at, pubDate - would invent freshness the source does not
    // support, and D4's timing signal would then be built on it.
    expect(src).toMatch(/posted_at:\s*null/);
    expect(src).not.toMatch(/posted_at:\s*(new Date|Date\.now|job\.pubDate)/);
  });
});

describe('A7.11 — and reachable, in one filter', () => {
  it('accepts datePosted=unknown and asks for exactly the undated rows', async () => {
    mockRows([33]);
    const res = await request(app())
      .get('/api/jobs?limit=20&datePosted=unknown')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    /*
     * Scoped to the PAGE query on purpose. Joining every statement and
     * matching "posted_at IS NULL" anywhere passed before this filter existed
     * at all - the companion undated-count query contains that string, and it
     * runs whenever datePosted is truthy. An assertion satisfied by a
     * different query is not a guard.
     */
    const pageSql = query.mock.calls.map((c) => c[0]).find((q) => /SELECT \* FROM ranked/.test(q));
    expect(pageSql).toBeTruthy();
    expect(pageSql).toMatch(/posted_at IS NULL/);
    // Must not also apply a window - "unknown" is not a time range.
    expect(pageSql).not.toMatch(/posted_at >= CURRENT_TIMESTAMP/);
  });

  it('labels it in plain words for the empty-state diagnosis', async () => {
    mockRows([0, 0, 0]);
    const res = await request(app())
      .get('/api/jobs?limit=20&datePosted=unknown&keywords=zzzz')
      .set('Authorization', `Bearer ${token}`);

    const labels = res.body.emptyReason.filters.map((f) => f.label);
    expect(labels.some((l) => /no publication date/i.test(l))).toBe(true);
  });
});
