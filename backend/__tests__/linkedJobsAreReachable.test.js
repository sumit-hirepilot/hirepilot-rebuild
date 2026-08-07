/*
 * A job the user added by link is reachable by the user who added it.
 *
 * Feature 4a stores it `is_active = false`, which keeps one person's link out
 * of the index served to everyone else - 16 shared queries filter on it. That
 * was right. What it also did was hide the job from its OWNER: nothing listed
 * these rows, so the flow ended at "Added ... Scored 55%" and the job could
 * never be opened, tailored against or queued.
 *
 * Found by Lane B walking 4a's UI on production, not by any test - every unit
 * worked, the 201 was true, and the row was written. Raised as HANDOFF
 * B -> A 1.
 *
 * The two things this must never become:
 *   a second door into the shared index  (scoped to added_by_user_id)
 *   a place where absence is guessed at  (company, date and score may be null)
 */

const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = { id: 42 }; next(); },
  attachUserIfPresent: (req, _res, next) => { req.user = req.user || { id: 42 }; next(); },
}));

const { query } = require('../db');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/jobs', require('../routes/jobs'));
  return a;
}

/** One fully-known row, one with every optional field absent. */
const ROWS = [
  {
    id: 9001,
    title: 'Staff Software Engineer',
    company_name: 'Adyen',
    location: 'Bengaluru',
    job_url: 'https://job-boards.greenhouse.io/adyen/jobs/1',
    posted_at: '2026-08-07T08:05:44.000Z',
    source: 'user_link',
    created_at: '2026-08-07T09:00:00.000Z',
    overall_score: '0.55',
    breakdown: { components: [{ id: 'skills', contribution: 0.22 }] },
  },
  {
    id: 9002,
    title: 'Product Designer',
    company_name: null,          // the page never stated one
    location: null,
    job_url: 'https://careers.example.com/openings/42',
    posted_at: null,             // no real publication date existed
    source: 'user_link',
    created_at: '2026-08-07T09:05:00.000Z',
    overall_score: null,         // scoring failed; the job was kept
    breakdown: null,
  },
];

const listDb = (rows = ROWS) => query.mockImplementation((sql) => {
  if (/COUNT\(\*\)::int AS n FROM jobs/.test(sql)) return Promise.resolve({ rows: [{ n: rows.length }] });
  if (/FROM jobs j/.test(sql)) return Promise.resolve({ rows });
  return Promise.resolve({ rows: [] });
});

beforeEach(() => query.mockReset());

describe('GET /api/jobs/linked returns the caller\'s own linked jobs', () => {
  it('lists them', async () => {
    listDb();
    const res = await request(app()).get('/api/jobs/linked');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.jobs).toHaveLength(2);
    expect(res.body.jobs[0].title).toBe('Staff Software Engineer');
  });

  it('scopes to the caller, so it is not a second door into the index', async () => {
    /*
     * The assertion that matters most. Without the user filter this endpoint
     * hands every user's linked jobs to every other user, and is_active=false
     * would no longer be protecting anything.
     */
    listDb();
    await request(app()).get('/api/jobs/linked');

    const listCall = query.mock.calls.find(([sql]) => /FROM jobs j/.test(sql));
    expect(listCall[0]).toMatch(/added_by_user_id = \$1/);
    expect(listCall[1][0]).toBe(42);

    const countCall = query.mock.calls.find(([sql]) => /COUNT\(\*\)::int AS n FROM jobs/.test(sql));
    expect(countCall[0]).toMatch(/added_by_user_id = \$1/);
    expect(countCall[1]).toContain(42);
  });

  it('carries the score where there is one, with its breakdown', async () => {
    listDb();
    const res = await request(app()).get('/api/jobs/linked');
    expect(res.body.jobs[0].score.overall_score).toBe('0.55');
    expect(res.body.jobs[0].score.breakdown).toBeTruthy();
  });
});

describe('absence is passed through as absence, never guessed', () => {
  it('a company the page did not state stays null and is flagged', async () => {
    listDb();
    const res = await request(app()).get('/api/jobs/linked');
    const unknown = res.body.jobs[1];

    expect(unknown.company_name).toBeNull();
    expect(unknown.companyStated).toBe(false);
    /*
     * Null specifically, not a placeholder standing in for a real name.
     * Asserted with toBeNull rather than `.not.toMatch(...)`: matchers that
     * take a pattern THROW on null, so the first cut of this failed with
     * "Received has value: null" while the code was correct - a test error
     * dressed as a defect.
     */
    expect(typeof unknown.company_name).not.toBe('string');
  });

  it('a missing publication date stays null and is flagged', async () => {
    /*
     * The himalayas trap: filling this from a re-sync timestamp fabricates
     * freshness and poisons every recency sort.
     */
    listDb();
    const res = await request(app()).get('/api/jobs/linked');

    expect(res.body.jobs[1].posted_at).toBeNull();
    expect(res.body.jobs[1].postedAtKnown).toBe(false);
    expect(res.body.jobs[0].postedAtKnown).toBe(true);
  });

  it('an unscored job is null, never zero', async () => {
    // 0% reads as "a terrible match". Null reads as "not scored yet". They are
    // different facts and the client must be able to tell them apart.
    listDb();
    const res = await request(app()).get('/api/jobs/linked');

    expect(res.body.jobs[1].score).toBeNull();
    expect(res.body.jobs[1].score).not.toBe(0);
  });

  it('bounds paging, because every request value is unbounded until proven otherwise', async () => {
    listDb();
    const res = await request(app()).get('/api/jobs/linked?limit=9999&page=99999');
    expect(res.status).toBe(200);
    expect(res.body.limit).toBeLessThanOrEqual(100);
  });
});

describe('a non-numeric :id is a 404, not a 500', () => {
  /*
   * `linked` is deliberately NOT in this list any more: it is a real route
   * now, so it must NOT 404. The first cut included it and failed with a 500
   * from its own handler - the test had outlived the thing it described.
   */
  it.each(['mine', 'saved', 'undefined', 'NaN'])('GET /api/jobs/%s', async (word) => {
    /*
     * Both /mine and /linked returned 500 on production: no such route, so
     * they fell into `/:id` and `WHERE id = 'mine'` made Postgres throw. A 500
     * claims the server is broken and writes a fault into the crash log that
     * never happened.
     */
    query.mockImplementation(() => Promise.reject(new Error('should never reach the database')));
    const res = await request(app()).get(`/api/jobs/${word}`);

    expect(res.status).toBe(404);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects an id past what Postgres can cast, before querying', async () => {
    query.mockImplementation(() => Promise.reject(new Error('should never reach the database')));
    const res = await request(app()).get('/api/jobs/99999999999999');
    expect(res.status).toBe(404);
    expect(query).not.toHaveBeenCalled();
  });

  it('still lets a real numeric id through', async () => {
    query.mockImplementation(() => Promise.resolve({ rows: [] }));
    const res = await request(app()).get('/api/jobs/123');
    // 404 from the handler this time - but the DATABASE was reached, which is
    // what separates "no such job" from "not a job id at all".
    expect(query).toHaveBeenCalled();
    expect(res.status).toBe(404);
  });
});
