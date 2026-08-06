/*
 * A7.20 — every job a user sees carries a score.
 *
 * A7.17 made the index the universe, correctly. Scoring runs periodically, so
 * a job ingested since the last sweep has no score for this user, and the
 * "past 24 hours" filter selects exactly those rows. Measured on production
 * before this: default feed 0 unscored of 20, 24h filter 20 unscored of 20.
 *
 * So the page is scored on the way out: after the filters have chosen the
 * rows, before the order is decided, for the twenty rows on the page and not
 * the 24,800 behind them.
 */

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/matchingEngine', () => ({
  scoreJobsForUser: jest.fn(),
  calculateJobMatch: jest.fn(),
  calculateMatchesForUser: jest.fn(),
}));

const { query } = require('../db');
const { scoreJobsForUser } = require('../services/matchingEngine');
const jobsRouter = require('../routes/jobs');

function app() {
  const a = express();
  a.use('/api/jobs', jobsRouter);
  return a;
}

const token = jwt.sign({ id: 42, email: 'a@b.c' }, process.env.JWT_SECRET || 'dev-secret');

/** Two scored rows, three unscored - the shape the 24h filter produces. */
const PAGE = [
  { id: 1, source: 'greenhouse', title: 'A', posted_at: '2026-08-05T10:00:00Z', overall_score: '0.80', match_tier: 1 },
  { id: 2, source: 'ashby', title: 'B', posted_at: '2026-08-05T11:00:00Z', overall_score: null, match_tier: 1 },
  { id: 3, source: 'lever', title: 'C', posted_at: '2026-08-05T12:00:00Z', overall_score: null, match_tier: 1 },
  { id: 4, source: 'jobicy', title: 'D', posted_at: '2026-08-05T09:00:00Z', overall_score: null, match_tier: 1 },
  { id: 5, source: 'remoteok', title: 'E', posted_at: '2026-08-05T08:00:00Z', overall_score: '0.20', match_tier: 1 },
];

function mockPage(rows = PAGE) {
  query.mockReset();
  query.mockImplementation((sql) => {
    if (/SELECT COUNT\(\*\)/.test(sql)) return Promise.resolve({ rows: [{ count: String(rows.length) }] });
    if (/SELECT \* FROM ranked/.test(sql)) return Promise.resolve({ rows: rows.map((r) => ({ ...r })) });
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => {
  scoreJobsForUser.mockReset();
  scoreJobsForUser.mockImplementation(async (_userId, ids) =>
    new Map(ids.map((id) => [id, { overall_score: 0.5 + id / 100, skills_match_score: 0.5 }]))
  );
});

describe('A7.20 — no ranked page returns an unscored row', () => {
  it.each([
    ['default feed', 'limit=20'],
    ['date filter', 'limit=20&datePosted=24h'],
    ['keyword', 'limit=20&keywords=designer'],
    ['keyword + date', 'limit=20&keywords=designer&datePosted=24h'],
  ])('%s reports unscoredInPage 0', async (_name, qs) => {
    mockPage();
    const res = await request(app()).get(`/api/jobs?${qs}`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.ranking.mode).toBe('ranked');
    expect(res.body.ranking.unscoredInPage).toBe(0);
    for (const j of res.body.jobs) {
      expect(j.overall_score === null || j.overall_score === undefined).toBe(false);
    }
  });

  it('scores only the unscored rows on this page', async () => {
    // 20 rows, not 24,800 - and not the two that already had a score.
    mockPage();
    await request(app()).get('/api/jobs?limit=20').set('Authorization', `Bearer ${token}`);

    expect(scoreJobsForUser).toHaveBeenCalledTimes(1);
    const [, ids] = scoreJobsForUser.mock.calls[0];
    expect([...ids].sort()).toEqual([2, 3, 4]);
  });

  it('does not call the scorer when the page is already scored', async () => {
    mockPage(PAGE.filter((r) => r.overall_score !== null));
    await request(app()).get('/api/jobs?limit=20').set('Authorization', `Bearer ${token}`);
    expect(scoreJobsForUser).not.toHaveBeenCalled();
  });
});

describe('A7.20 — scoring happens before the order is decided', () => {
  it('orders by the new scores, not by the nulls they replaced', async () => {
    /*
     * The rows arrive from SQL ordered by a score they did not have, so
     * unscored rows sat last. If the page were returned in that order, the
     * newest job - by definition the least likely to have been scored - would
     * rank below every stale one.
     */
    mockPage();
    const res = await request(app())
      .get('/api/jobs?limit=20&sort=score')
      .set('Authorization', `Bearer ${token}`);

    const scores = res.body.jobs.map((j) => Number(j.overall_score));
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    // id 4 scored 0.54, above the row that was already stored at 0.20.
    expect(res.body.jobs[res.body.jobs.length - 1].id).toBe(5);
  });
});

describe('A7.20 — a row that cannot be scored is withheld, and said so', () => {
  it('never renders an unscored job in a ranked view', async () => {
    // Constraint 1: absence is stated, not implied. A user who reached this
    // list by matching must not be shown a row nothing matched.
    scoreJobsForUser.mockResolvedValue(new Map([[2, { overall_score: 0.7 }]]));
    mockPage();
    const res = await request(app()).get('/api/jobs?limit=20').set('Authorization', `Bearer ${token}`);

    const ids = res.body.jobs.map((j) => j.id);
    expect(ids).not.toContain(3);
    expect(ids).not.toContain(4);
    expect(res.body.ranking.withheldUnscored).toBe(2);
    expect(res.body.ranking.unscoredInPage).toBe(0);
  });

  it('keeps the field present when nothing was withheld', async () => {
    // A7.17's shape rule: always there, zero when it did not happen.
    mockPage();
    const res = await request(app()).get('/api/jobs?limit=20').set('Authorization', `Bearer ${token}`);
    expect(res.body.ranking).toHaveProperty('withheldUnscored');
    expect(res.body.ranking.withheldUnscored).toBe(0);
  });
});

describe('A7.20 — unranked browse is left alone', () => {
  it('does not score for an anonymous caller', async () => {
    mockPage();
    const res = await request(app()).get('/api/jobs?limit=20');
    expect(res.body.ranking.mode).toBe('all');
    expect(scoreJobsForUser).not.toHaveBeenCalled();
  });

  it('does not score, nor withhold, when the user opted out of ranking', async () => {
    // `ranked=0` is "show me everything indexed, unscored". Withholding rows
    // there would empty the one view whose purpose is to hold everything.
    mockPage();
    const res = await request(app()).get('/api/jobs?limit=20&ranked=0').set('Authorization', `Bearer ${token}`);
    expect(scoreJobsForUser).not.toHaveBeenCalled();
    expect(res.body.jobs).toHaveLength(PAGE.length);
    expect(res.body.ranking.withheldUnscored).toBe(0);
  });
});
