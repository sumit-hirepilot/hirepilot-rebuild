/*
 * The feed's paging is bounded, and says when it bounded something.
 *
 * `page` and `limit` came off the query string and were used directly, with no
 * ceiling on either. GET /api/jobs?sort=recent&datePosted=7&limit=100&page=250
 * is OFFSET 24,900 over a CTE that ranks the entire 25,418-row index; three of
 * those in succession took the production API down, and it did not come back
 * on its own - it needed a redeploy. I typed those requests, but a user could
 * have: it was a denial-of-service reachable from the URL bar.
 *
 * Same class as everything else this week. An input nobody clicked, so nobody
 * found it.
 *
 * Clamped rather than refused, and stated rather than silently truncated. A
 * response that hands back page 50 while calling it page 250 is the A7.9
 * defect wearing a different hat.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = { id: 42 }; next(); },
  attachUserIfPresent: (req, _res, next) => { req.user = { id: 42 }; next(); },
}));

const { query } = require('../db');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/jobs', require('../routes/jobs'));
  return a;
}

let lastPageQuery;
beforeEach(() => {
  query.mockReset();
  lastPageQuery = null;
  query.mockImplementation((sql, params) => {
    if (/COUNT\(\*\) as count FROM ranked/.test(sql)) return Promise.resolve({ rows: [{ count: 25418 }] });
    if (/SELECT \* FROM ranked/.test(sql)) {
      lastPageQuery = { limit: Number(params[params.length - 2]), offset: Number(params[params.length - 1]) };
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });
});

const get = (qs) => request(app()).get(`/api/jobs?${qs}`);

describe('the feed refuses to run an unbounded scan', () => {
  it('does not send OFFSET 24,900 to the database, whatever the URL says', async () => {
    // The exact request that took production down.
    const res = await get('sort=recent&limit=100&page=250');

    expect(res.status).toBe(200);
    expect(lastPageQuery.offset).toBeLessThanOrEqual(5000);
  });

  it('caps limit so one request cannot ask for the whole index', async () => {
    /*
     * Asserted on what reaches the DATABASE, bounded by the larger of the page
     * limit and A7.9's fixed diversity window - inside the window the route
     * fetches the window and slices, which is deliberate. The invariant is
     * that no request can make the fetch grow without bound, not that the
     * fetch equals the page size.
     */
    await get('sort=recent&limit=100000&page=1');
    expect(lastPageQuery.limit).toBeLessThanOrEqual(200);
  });

  it('says it clamped, rather than calling page 50 page 250', async () => {
    const res = await get('sort=recent&limit=100&page=250');

    expect(res.body.paging.clamped).toBe(true);
    expect(res.body.paging.requestedPage).toBe(250);
    expect(res.body.page).toBe(res.body.paging.maxPage);
    expect(res.body.page).toBeLessThan(250);
  });

  it('says it clamped the limit too', async () => {
    const res = await get('sort=recent&limit=100000');
    expect(res.body.paging.limitClamped).toBe(true);
    expect(res.body.limit).toBe(100);
  });

  it('leaves an ordinary request completely alone', async () => {
    // A bound that also changes normal requests is a different defect.
    const res = await get('sort=recent&limit=20&page=3');

    expect(res.body.paging.clamped).toBe(false);
    expect(res.body.paging.limitClamped).toBe(false);
    expect(res.body.page).toBe(3);
    expect(res.body.limit).toBe(20);
    // Page 3 of 20 sits inside the diversity window, so the route fetches the
    // window from the top and slices - offset 0 is correct here, not a bug.
    expect(lastPageQuery.offset).toBe(0);
  });

  it('survives junk without falling back to an unbounded scan', async () => {
    for (const qs of ['page=abc&limit=xyz', 'page=-5&limit=-100', 'page=1e9&limit=1e9', 'page[]=2&limit[]=3']) {
      await get(`sort=recent&${qs}`);
      expect(lastPageQuery.offset).toBeGreaterThanOrEqual(0);
      expect(lastPageQuery.offset).toBeLessThanOrEqual(5000);
      expect(lastPageQuery.limit).toBeGreaterThanOrEqual(1);
      expect(lastPageQuery.limit).toBeLessThanOrEqual(200);
    }
  });

  it('still reports the honest total, so the bound hides nothing', async () => {
    const res = await get('sort=recent&limit=100&page=250');
    expect(res.body.total).toBe(25418);
  });
});
