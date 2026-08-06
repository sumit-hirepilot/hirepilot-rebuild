/*
 * A7.9 — pages must be slices of ONE list.
 *
 * Measured on production: 40 rows read as a single page of 40, and as four
 * pages of 10, differed by 6 jobs. Those six were in the page of 40 and in
 * none of the four pages of 10 - not merely reordered, unreachable by paging.
 *
 * Cause: the diversity cap was `source_rank <= GREATEST(3, CEIL(page*limit/4))`,
 * so page and limit also set how many rows each source could contribute. Each
 * page was OFFSET into a differently-capped list, and those lists are not
 * nested at the front - a row entering as the cap widens is inserted ABOVE rows
 * already shown, so the offset steps past it.
 *
 * The guard is the PROPERTY, not the SQL: for a fixed filter, the concatenation
 * of pages 1..N at limit L must equal page 1 at limit N*L, as a set and in
 * order. That is what "coherent pagination" means, it is what failed, and it is
 * independent of how diversity is implemented.
 */

const { diversify, pageOf, BLOCK, QUOTA } = require('../services/feedDiversity');

// Deterministic: no Math.random, so a failure is always reproducible.
const SOURCES = ['remoteok', 'remotive', 'jobicy', 'himalayas', 'weworkremotely'];
const ranked = (n) => Array.from({ length: n }, (_, i) => ({
  id: i + 1,
  // Deliberately lumpy - an even round-robin would pass almost any algorithm.
  source: SOURCES[(i < 30 ? i % 2 : i % SOURCES.length)],
  score: 1 - i / (n * 2),
}));

const ids = (rows) => rows.map((r) => r.id);
const concatPages = (rows, n, limit) =>
  Array.from({ length: n }, (_, i) => pageOf(rows, i + 1, limit)).flat();

describe('A7.9 — the acceptance property', () => {
  const rows = ranked(120);

  it('pages 1..4 at limit 10 equal page 1 at limit 40, in order', () => {
    expect(ids(concatPages(rows, 4, 10))).toEqual(ids(pageOf(rows, 1, 40)));
  });

  it('holds for page sizes that do not divide evenly', () => {
    // 7 is not a factor of anything here, and is not a multiple of BLOCK.
    expect(ids(concatPages(rows, 5, 7))).toEqual(ids(pageOf(rows, 1, 35)));
    expect(ids(concatPages(rows, 3, 13))).toEqual(ids(pageOf(rows, 1, 39)));
  });

  it('holds as a SET too, which is the half that failed on production', () => {
    const paged = new Set(ids(concatPages(rows, 4, 10)));
    const single = new Set(ids(pageOf(rows, 1, 40)));
    expect([...single].filter((id) => !paged.has(id))).toEqual([]);
  });
});

describe('A7.9 — no row is lost, none repeats', () => {
  const rows = ranked(97); // not a multiple of BLOCK or of any page size used

  it('every ranked row appears exactly once across all pages', () => {
    const seen = ids(concatPages(rows, 10, 10));
    expect(seen.slice(0, rows.length).sort((a, b) => a - b)).toEqual(ids(rows).sort((a, b) => a - b));
  });

  it('reorders without adding, dropping or duplicating anything', () => {
    const out = diversify(rows);
    expect(out).toHaveLength(rows.length);
    expect(new Set(ids(out)).size).toBe(rows.length);
  });

  it('emits the tail even when one source owns all of it', () => {
    // The case a strict quota strands forever: reachability beats diversity.
    const lopsided = [
      ...Array.from({ length: 5 }, (_, i) => ({ id: i + 1, source: 'a' })),
      ...Array.from({ length: 40 }, (_, i) => ({ id: i + 100, source: 'b' })),
    ];
    expect(diversify(lopsided)).toHaveLength(45);
  });
});

describe('A7.9 — diversity survives the fix', () => {
  it('gives no source more than the quota in any block of consecutive rows', () => {
    const out = diversify(ranked(200));
    for (let start = 0; start + BLOCK <= out.length; start += BLOCK) {
      const counts = new Map();
      for (const r of out.slice(start, start + BLOCK)) {
        counts.set(r.source, (counts.get(r.source) || 0) + 1);
      }
      // Only whole blocks drawn from a still-diverse remainder are held to it;
      // the tail relaxes deliberately, and that is asserted above.
      const remainingSources = new Set(out.slice(start).map((r) => r.source)).size;
      if (remainingSources >= Math.ceil(BLOCK / QUOTA)) {
        expect(Math.max(...counts.values())).toBeLessThanOrEqual(QUOTA);
      }
    }
  });

  it('does not simply hand back the ranked order unchanged', () => {
    // A no-op would pass every coherence test above.
    const rows = ranked(60);
    expect(ids(diversify(rows))).not.toEqual(ids(rows));
  });
});

describe('A7.9 — the property can fail, so passing it means something', () => {
  /*
   * The old behaviour, in miniature: cap each source at CEIL(page*limit/4),
   * then OFFSET into that capped list. Prove red before trusting green - a
   * property no implementation can fail is not a guard.
   */
  const oldPageOf = (rows, page, limit) => {
    const cap = Math.max(3, Math.ceil((page * limit) / 4));
    const perSource = new Map();
    const capped = rows.filter((r) => {
      const n = (perSource.get(r.source) || 0) + 1;
      perSource.set(r.source, n);
      return n <= cap;
    });
    return capped.slice((page - 1) * limit, page * limit);
  };

  it('the SQL-cap approach fails the same assertion', () => {
    const rows = ranked(120);
    const paged = Array.from({ length: 4 }, (_, i) => oldPageOf(rows, i + 1, 10)).flat();
    const single = oldPageOf(rows, 1, 40);

    expect(ids(paged)).not.toEqual(ids(single));

    // And specifically: rows reachable in one page of 40 that four pages of 10
    // never show. This is the production symptom, reproduced.
    const seen = new Set(ids(paged));
    const unreachable = ids(single).filter((id) => !seen.has(id));
    expect(unreachable.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ *
 * Through GET /api/jobs, because a property proved on a pure function
 * says nothing about whether the route calls it.
 * ------------------------------------------------------------------ */

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = { id: 42 }; next(); },
  attachUserIfPresent: (req, _res, next) => { req.user = { id: 42 }; next(); },
}));

const request = require('supertest');
const express = require('express');
const { query } = require('../db');

const FEED = Array.from({ length: 200 }, (_, i) => ({
  id: i + 1,
  title: `Job ${i + 1}`,
  company_name: `Co ${i % 7}`,
  source: ['remoteok', 'remotive', 'jobicy', 'himalayas'][i < 60 ? i % 2 : i % 4],
  overall_score: 1 - i / 400,
  posted_at: new Date(Date.UTC(2026, 0, 1)).toISOString(),
  is_active: true,
}));

function jobsApp() {
  const a = express();
  a.use(express.json());
  a.use('/api/jobs', require('../routes/jobs'));
  return a;
}

describe('A7.9 — the route, not just the function', () => {
  beforeEach(() => {
  // The feed COUNT is cached; a stale entry makes the next case observe no
  // COUNT query at all. Cleared per case so each test sees its own calls.
  try { require('../routes/jobs').resetFeedCountCache(); } catch (e) { /* not a feed test */ }
    query.mockReset();
    query.mockImplementation((sql, params) => {
      if (/COUNT\(\*\) as count FROM ranked/.test(sql)) {
        return Promise.resolve({ rows: [{ count: FEED.length }] });
      }
      if (/SELECT \* FROM ranked/.test(sql)) {
        // The two trailing params are LIMIT and OFFSET, exactly as sent.
        const lim = Number(params[params.length - 2]);
        const off = Number(params[params.length - 1]);
        return Promise.resolve({ rows: FEED.slice(off, off + lim) });
      }
      return Promise.resolve({ rows: [] });
    });
  });

  const get = (qs) => request(jobsApp()).get(`/api/jobs?${qs}`);

  it('serves pages that tile one list: 4x10 equals 1x40, in order', async () => {
    const pages = [];
    for (let p = 1; p <= 4; p += 1) {
      const res = await get(`page=${p}&limit=10`);
      expect(res.status).toBe(200);
      pages.push(...res.body.jobs.map((j) => j.id));
    }
    const single = await get('page=1&limit=40');
    expect(pages).toEqual(single.body.jobs.map((j) => j.id));
  });

  it('shows every job the single page shows - the production symptom', async () => {
    const seen = new Set();
    for (let p = 1; p <= 4; p += 1) {
      const res = await get(`page=${p}&limit=10`);
      for (const j of res.body.jobs) seen.add(j.id);
    }
    const single = await get('page=1&limit=40');
    const unreachable = single.body.jobs.map((j) => j.id).filter((id) => !seen.has(id));
    expect(unreachable).toEqual([]);
  });

  it('never serves the same job on two pages', async () => {
    const all = [];
    for (let p = 1; p <= 10; p += 1) {
      const res = await get(`page=${p}&limit=10`);
      all.push(...res.body.jobs.map((j) => j.id));
    }
    expect(new Set(all).size).toBe(all.length);
  });

  it('states which regime the page came from rather than leaving it to be inferred', async () => {
    const inside = await get('page=1&limit=10');
    expect(inside.body.ranking.sourceDiversified).toBe(true);
    expect(inside.body.ranking.sourceDiversityRule.perSourceMax).toBeGreaterThan(0);
    expect(inside.body.ranking.sourceDiversityRule.perRows).toBeGreaterThan(0);

    // Past the window the guarantee is plain ranked order, and it says so.
    const outside = await get('page=999&limit=10');
    expect(outside.body.ranking.sourceDiversified).toBe(false);
    expect(outside.body.ranking.sourceDiversityRule).toBeNull();
  });
});
