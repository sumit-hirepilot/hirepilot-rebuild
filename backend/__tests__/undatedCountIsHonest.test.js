/*
 * A7.11 — "Jobs with no publication date" excludes nothing. It selects them.
 *
 * excludedUnknownDateCount was set whenever ANY datePosted value was present,
 * so choosing the unknown-date filter reported all 5,014 undated rows as
 * excluded from the filter that had just selected them. The page then printed
 *
 *     +5,014 more with unknown publish date (excluded from this filter)
 *
 * directly underneath a list of exactly those jobs. Found by clicking the
 * "show them" link on production rather than by reading the code: the number
 * and the rows beside it contradicted each other on screen.
 *
 * A figure that contradicts the rows it sits next to is fabricated data on a
 * live surface - Constraint 1 - whatever arithmetic produced it.
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

const UNDATED = 5014;

beforeEach(() => {
  query.mockReset();
  query.mockImplementation((sql) => {
    if (/COUNT\(\*\) as count FROM ranked .*posted_at IS NULL/s.test(sql)) {
      return Promise.resolve({ rows: [{ count: UNDATED }] });
    }
    if (/COUNT\(\*\) as count FROM ranked/.test(sql)) return Promise.resolve({ rows: [{ count: 25418 }] });
    if (/SELECT \* FROM ranked/.test(sql)) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [] });
  });
});

const get = (qs) => request(app()).get(`/api/jobs?${qs}`);

describe('A7.11 — the undated count says what actually happened', () => {
  it('reports nothing excluded when the filter IS the undated rows', async () => {
    const res = await get('sort=recent&datePosted=unknown');

    expect(res.status).toBe(200);
    expect(res.body.excludedUnknownDateCount).toBe(0);
  });

  it('still reports them excluded under a real date window', async () => {
    // The negative above is only meaningful if the positive still fires.
    const res = await get('sort=recent&datePosted=7d');
    expect(res.body.excludedUnknownDateCount).toBe(UNDATED);
  });

  it('excludes nothing for a window it does not recognise', async () => {
    /*
     * `datePosted=7` is not a value this endpoint accepts - the keys are 24h,
     * 3d, 7d, 30d - so it filters nothing and therefore cannot exclude
     * anything either. It used to claim 5,014 exclusions on a request that
     * had not narrowed the result set at all.
     */
    const res = await get('sort=recent&datePosted=7');
    expect(res.body.excludedUnknownDateCount).toBe(0);
  });

  it('still counts them as buried under a plain recency sort', async () => {
    // Different question, different field: ordered last, not excluded.
    const res = await get('sort=recent');
    expect(res.body.ranking.undatedTotal).toBe(UNDATED);
    expect(res.body.excludedUnknownDateCount).toBe(0);
  });

  it('counts the undated rows OUTSIDE the date filter, or it counts nothing', async () => {
    /*
     * The ranked CTE applies the window. Once a real one is active it has
     * already removed every NULL-dated row, so a COUNT taken through that same
     * CTE cannot see the rows it exists to report and returns 0 - a
     * measurement downstream of the filter it is measuring reports that filter
     * working perfectly, every time.
     *
     * Asserted on the SQL actually sent, because the response looked plausible
     * either way.
     */
    await get('sort=recent&datePosted=7d');

    const undatedCount = query.mock.calls
      .map((c) => c[0])
      .find((sql) => /COUNT\(\*\) as count FROM ranked[\s\S]*posted_at IS NULL/.test(sql));

    expect(undatedCount).toBeDefined();
    expect(undatedCount).not.toMatch(/CURRENT_TIMESTAMP - INTERVAL/);
  });

  it('says nothing about dates when the sort is not about dates', async () => {
    const res = await get('sort=score');
    expect(res.body.ranking.undatedTotal).toBeNull();
    expect(res.body.excludedUnknownDateCount).toBe(0);
  });
});
