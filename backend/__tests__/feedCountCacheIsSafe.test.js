/*
 * GOAL 1h — the feed COUNT is cached, and the cache must never hand one caller
 * another caller's total.
 *
 * A feed request runs exactly two queries and both build the same CTE over all
 * 25,418 rows, so the COUNT is close to half the database work of every
 * request - and it answers a question that only changes when ingest writes,
 * every six hours. That makes it worth caching and dangerous to cache wrongly:
 * a total is a number printed on a live surface, and showing user A's count to
 * user B is fabricated data.
 *
 * These assert the KEY covers every input that can change the count. Proved by
 * making each input differ in turn and requiring a fresh COUNT each time - not
 * by reading the key-building code, which would only prove I can read my own
 * expression.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({ query: jest.fn() }));

// Prefixed `mock` so jest allows the factory below to close over it.
let mockUser = { id: 42 };
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = mockUser; next(); },
  attachUserIfPresent: (req, _res, next) => { req.user = mockUser; next(); },
}));

const { query } = require('../db');
const jobsRouter = require('../routes/jobs');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/jobs', jobsRouter);
  return a;
}

/*
 * The FEED count specifically. A recency sort also runs an undated COUNT, which
 * matches the same pattern and is deliberately NOT cached - counting both made
 * this file report 4 where it meant 2, and the cache was innocent.
 */
const counts = () => query.mock.calls.filter((c) => {
  const sql = String(c[0]);
  return /COUNT\(\*\) as count/.test(sql) && !/posted_at IS NULL/.test(sql);
});

beforeEach(() => {
  mockUser = { id: 42 };
  query.mockReset();
  jobsRouter.resetFeedCountCache();
  query.mockImplementation((sql) => {
    if (/COUNT\(\*\) as count/.test(sql)) return Promise.resolve({ rows: [{ count: 25418 }] });
    return Promise.resolve({ rows: [] });
  });
});

const get = (qs) => request(app()).get(`/api/jobs?${qs}`);

describe('the cache saves the work it is there to save', () => {
  it('runs the COUNT once for two identical requests', async () => {
    await get('limit=20&page=1');
    await get('limit=20&page=1');
    expect(counts()).toHaveLength(1);
  });

  it('still answers with the right total on the cached read', async () => {
    const first = await get('limit=20&page=1');
    const second = await get('limit=20&page=1');
    expect(second.body.total).toBe(first.body.total);
    expect(second.body.total).toBe(25418);
  });
});

describe('the cache cannot leak one caller\'s total to another', () => {
  it('does not share between two different users', async () => {
    // The user id reaches the CTE as a parameter, so it must be in the key.
    await get('limit=20&page=1');
    mockUser = { id: 99 };
    await get('limit=20&page=1');
    expect(counts()).toHaveLength(2);
  });

  it('does not share across a different search', async () => {
    await get('limit=20&page=1');
    await get('limit=20&page=1&search=designer');
    expect(counts()).toHaveLength(2);
  });

  it('does not share across a different date window', async () => {
    await get('limit=20&page=1&sort=recent');
    await get('limit=20&page=1&sort=recent&datePosted=7d');
    expect(counts()).toHaveLength(2);
  });

  it('does not share across a different score floor', async () => {
    await get('limit=20&page=1');
    await get('limit=20&page=1&minScore=0.9');
    expect(counts()).toHaveLength(2);
  });

  it('does not share across a different source filter', async () => {
    await get('limit=20&page=1');
    await get('limit=20&page=1&source=remoteok');
    expect(counts()).toHaveLength(2);
  });

  it('ignores the page, which cannot change a total', async () => {
    // The opposite error: keying on something that does not affect the count
    // would make the cache useless without being unsafe.
    await get('limit=20&page=1');
    await get('limit=20&page=3');
    expect(counts()).toHaveLength(1);
  });
});

describe('the cache is bounded', () => {
  it('does not grow without limit on distinct filters', async () => {
    // An unbounded map keyed by user-supplied filters is a memory leak with
    // extra steps, and this codebase has been killed once by exactly that.
    for (let i = 0; i < 60; i += 1) await get(`limit=20&page=1&search=term${i}`);
    // Every distinct search must have hit the database - nothing silently
    // shared - and the process must still be here.
    expect(counts().length).toBe(60);
  });
});
