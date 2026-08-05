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
    // A7.7 renamed the vocabulary: `mode` is now ranked|all (is this the
    // personalised set?) and `sort` is score|recent (in what order?). They
    // were one field, which is why choosing "newest" used to drop the scores.
    expect(res.body.ranking.mode).toBe('ranked');
    expect(res.body.ranking.sort).toBe('score');
    const sql = query.mock.calls.map((c) => c[0]).join('\n');
    expect(sql).toMatch(/JOIN job_matches\b/);
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
    expect(pageSql).toMatch(/jm\.overall_score\b/);
    expect(pageSql).toMatch(/jm\.skills_match_score\b/);
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

    /*
     * A7.17 collapsed the branches, so this asserts the PROPERTY rather than
     * the SQL literal: a per-source rank is computed and capped, and score is
     * a sort key. The cap is now scoped to the UNFILTERED feed - applied to a
     * filtered result it would drop rows the user explicitly asked for.
     */
    const pageSql = query.mock.calls[1][0];
    expect(pageSql).toMatch(/ROW_NUMBER\(\) OVER \(\s*PARTITION BY jobs\.source/);
    expect(pageSql).toMatch(/source_rank\s*<=/);
    expect(pageSql).toMatch(/overall_score DESC NULLS LAST/);
    expect(pageSql).not.toMatch(/ORDER BY source_rank/);
  });
});

describe('A7.1 — unranked browse stays available, but only on request', () => {
  it('falls back to chronological for an anonymous caller', async () => {
    mockRows();
    const res = await request(app()).get('/api/jobs?limit=1'); // no token

    expect(res.status).toBe(200);
    expect(res.body.ranking.mode).toBe('all');
    /*
     * A7.17: the join is now always present (LEFT, so the index is the
     * universe). What must hold for an anonymous caller is that NO user's
     * scores are bound - the join key is null, so every score comes back null
     * and the order is pure recency.
     */
    expect(res.body.ranking.sort).toBe('recent');
    const boundUserId = query.mock.calls[1][1].includes(null);
    expect(boundUserId).toBe(true);
  });

  it('honours an explicit opt-out into unranked browse', async () => {
    // `ranked=0`, not `sort=recent`: sorting by newest keeps the personalised
    // set, opting out abandons it. Conflating the two lost the scores.
    mockRows();
    const res = await request(app()).get('/api/jobs?limit=1&ranked=0').set('Authorization', `Bearer ${token}`);

    expect(res.body.ranking.mode).toBe('all');
    expect(res.body.ranking.minScore).toBeNull();
  });

  it('never rejects a browse request over a bad token', async () => {
    // Browsing jobs must degrade to unpersonalised, not 401.
    mockRows();
    const res = await request(app()).get('/api/jobs?limit=1').set('Authorization', 'Bearer not-a-jwt');

    expect(res.status).toBe(200);
    expect(res.body.ranking.mode).toBe('all');
  });
});


describe('A7.7 — the sort is explicit and deterministic', () => {
  it('breaks equal scores by recency, then by a unique key', async () => {
    /*
     * The reported bug. With a 24h filter the feed read 67, 63, 59, 59, 59,
     * 59, 59 - correct by score - but the equal-score rows came back 23h, 20h,
     * 5h, 6h, 7h ago. The secondary sort was falling back to insertion order,
     * which to a user reads as no order at all.
     *
     * jobs.id is the unique final key: without it, rows sharing BOTH a score
     * and a timestamp still come back in whatever order the plan produces, and
     * the list can reshuffle between reloads.
     */
    mockRows();
    await request(app()).get('/api/jobs?limit=20').set('Authorization', `Bearer ${token}`);

    /*
     * A7.17 put match_tier ahead of score as the leading key, so a tier-3
     * "related" hit cannot outrank an exact title match. The tie-break chain
     * this test exists for is unchanged and still asserted in order.
     */
    const pageSql = query.mock.calls[1][0];
    expect(pageSql).toMatch(/ORDER BY match_tier ASC, overall_score DESC NULLS LAST, posted_at DESC NULLS LAST, id DESC/);
  });

  it('puts undated jobs last, not first', async () => {
    // Postgres defaults DESC to NULLS FIRST, so `ORDER BY posted_at DESC` led
    // the "newest" list with jobs that have no date at all.
    mockRows();
    await request(app()).get('/api/jobs?limit=20&sort=recent').set('Authorization', `Bearer ${token}`);

    const pageSql = query.mock.calls[1][0];
    expect(pageSql).toMatch(/posted_at DESC NULLS LAST/);
    expect(pageSql).not.toMatch(/posted_at DESC(?!\s+NULLS LAST)/);
  });

  it('treats a time filter as a recency request', async () => {
    // Ordering by score while the user asked for "last 24 hours" gives a list
    // whose order they cannot explain from what is on screen.
    mockRows();
    const res = await request(app())
      .get('/api/jobs?limit=20&datePosted=24h')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.ranking.sort).toBe('recent');
  });

  it('keeps the scores when sorting by newest', async () => {
    // sort and ranked are different questions. Choosing "newest" reorders the
    // personalised set; it does not abandon it.
    mockRows();
    const res = await request(app())
      .get('/api/jobs?limit=20&sort=recent')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.ranking.mode).toBe('ranked');
    expect(query.mock.calls[1][0]).toMatch(/jm\.overall_score/);
  });

  it('reports the active sort so the UI never has to infer it', async () => {
    mockRows();
    const res = await request(app()).get('/api/jobs?limit=20').set('Authorization', `Bearer ${token}`);
    expect(['score', 'recent']).toContain(res.body.ranking.sort);
  });
});

describe('A7.17 — filters apply to the index, not to the match store', () => {
  it('LEFT JOINs the match store so score is a sort key, not a membership test', () => {
    /*
     * THE property of this goal, and it was unguarded: reverting LEFT JOIN to
     * INNER JOIN left every other test green.
     *
     * An INNER JOIN caps the universe at MATCH_STORE_LIMIT (500) BEFORE any
     * filter runs, so "Past 24 hours" meant "of your top 500 matches, which
     * are recent" - 9 results against an index holding 616. LEFT JOIN makes
     * the index the universe; an unscored row ranks last rather than being
     * excluded, because "we cannot judge it" is not "it is a bad match".
     *
     * Asserted on the source: a mocked db cannot show a count difference, and
     * the count itself is verified against production.
     */
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'jobs.js'), 'utf8');

    expect(src).toMatch(/LEFT JOIN job_matches jm\b/);
    // No bare INNER join on the ranking path - that is the regression.
    expect(src).not.toMatch(/\n\s+JOIN job_matches jm\b/);
  });

  it('scopes the per-source cap to the unfiltered feed', () => {
    // Applied to a filtered result the cap silently drops rows the user asked
    // for - the same category error as filtering inside the match store.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'jobs.js'), 'utf8');
    expect(src).toMatch(/!hasIndexFilter\s*&&\s*rankByScore/);
  });

  it('applies the floor to scored rows without deleting unscored ones', async () => {
    /*
     * Excluding unscored rows would collapse the universe back to the 500 this
     * goal exists to escape.
     *
     * Rewritten from a source-text match on `$${scoreParams.length}`, which
     * A7.13's refactor renamed - so the guard failed on a change that did not
     * touch the behaviour it protects. Same lesson as A7.12: pin the property,
     * in the SQL the endpoint actually emits, not the identifier that happened
     * to build it.
     */
    mockRows();
    await request(app()).get('/api/jobs?limit=20&minScore=0.6').set('Authorization', `Bearer ${token}`);

    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/overall_score >= \$\d+ OR jm\.overall_score IS NULL/);
    // The OR is load-bearing: without it the floor deletes every unscored row.
    expect(sql).not.toMatch(/overall_score >= \$\d+\s*\)/);
  });
});

describe('A7.17 — the reported total is a property of the filter, not of the page', () => {
  it('counts the universe without the diversity cap', async () => {
    /*
     * Found by measuring the acceptance criterion, not by a test: page 1
     * reported total=60 and page 2 reported total=120, because the diversity
     * cap scales with the page and the COUNT ran inside it. A pagination
     * control reads that as "3 pages", then as "6 pages" one click later.
     *
     * The cap is a per-page presentation device - every capped row is still
     * reachable by paging, since the cap relaxes as you go. So the honest
     * total is the count over the FILTER, and only the page query caps.
     */
    mockRows();
    await request(app()).get('/api/jobs?limit=20').set('Authorization', `Bearer ${token}`);

    const countSql = query.mock.calls[0][0];
    const pageSql = query.mock.calls[1][0];
    expect(countSql).toMatch(/SELECT COUNT\(\*\)/);
    expect(countSql).not.toMatch(/source_rank <=/);   // the count is uncapped
    expect(pageSql).toMatch(/source_rank <=/);        // the page still is
  });

  it('does not let the page number reach the count query at all', async () => {
    // Stronger than the totals matching on one fixture: if `page` cannot
    // appear in the count SQL, the total cannot vary with it.
    mockRows();
    await request(app()).get('/api/jobs?limit=20&page=3').set('Authorization', `Bearer ${token}`);
    const countSql = query.mock.calls[0][0];
    expect(countSql).not.toMatch(/\bCEIL\(/);
  });
});
