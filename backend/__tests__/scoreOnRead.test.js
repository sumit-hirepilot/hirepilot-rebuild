/*
 * A2 — a user with a profile must never be shown an unscored feed.
 *
 * Scoring used to depend on which page the user arrived through. onboarding.js
 * recalculates only on its final step, so anyone who abandoned onboarding was
 * never scored. resume.js applies parsed skills and never recalculated at all,
 * so uploading a resume from the Resume page produced a profile and an empty
 * feed, with nothing on screen explaining why.
 *
 * These assert the server-side guarantee, because a guarantee that lives in a
 * page can be forgotten by the next page.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/matchingEngine', () => ({
  calculateJobMatch: jest.fn(),
  calculateMatchesForUser: jest.fn().mockResolvedValue({ matchesCreated: 7 }),
}));
// Every route under test is authenticated; the identity is not what is being
// tested, so it is injected rather than exercised.
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = { id: 42 }; next(); },
}));

const { query } = require('../db');
const { calculateMatchesForUser } = require('../services/matchingEngine');
const matchesRouter = require('../routes/matches');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/matches', matchesRouter);
  return a;
}

/*
 * GET /api/matches issues, in order: the has-matches probe, the has-skills
 * probe, then the count and the page. Queued in that order so each test states
 * the database state it is describing.
 */
function dbState({ hasMatches, hasSkills, countAfter = 0, rowsAfter = [] }) {
  query.mockReset();
  query
    .mockResolvedValueOnce({ rows: hasMatches ? [{ '?column?': 1 }] : [] })
    .mockResolvedValueOnce({ rows: hasSkills ? [{ '?column?': 1 }] : [] })
    .mockResolvedValueOnce({ rows: [{ count: String(countAfter) }] })
    .mockResolvedValueOnce({ rows: rowsAfter });
}

beforeEach(() => calculateMatchesForUser.mockClear());

describe('A2 — scoring runs without the client having to ask', () => {
  it('scores a user who has skills but has never been scored', async () => {
    // The abandoned-onboarding and Resume-page users both land here.
    dbState({ hasMatches: false, hasSkills: true, countAfter: 7 });

    const res = await request(app()).get('/api/matches');

    expect(res.status).toBe(200);
    expect(calculateMatchesForUser).toHaveBeenCalledWith(42);
    // The client is told this request produced the scores, so a first load
    // that takes a moment can say what it is doing rather than just be slow.
    expect(res.body.scoredOnRead).toBe(true);
  });

  it('does not rescore a user who already has matches', async () => {
    dbState({ hasMatches: true, hasSkills: true, countAfter: 12 });

    const res = await request(app()).get('/api/matches');

    expect(calculateMatchesForUser).not.toHaveBeenCalled();
    expect(res.body.scoredOnRead).toBe(false);
  });

  it('does not scan the job table for a user with no skills', async () => {
    // Nothing to score against. This user gets the empty state with a reason,
    // not a full recalculation on every feed load.
    dbState({ hasMatches: false, hasSkills: false, countAfter: 0 });

    const res = await request(app()).get('/api/matches');

    expect(calculateMatchesForUser).not.toHaveBeenCalled();
    expect(res.body.scoredOnRead).toBe(false);
  });

  it('still serves the feed when scoring itself fails', async () => {
    // A scoring fault must degrade to "no new scores", never to a blank feed
    // or a 500 - the stored matches are still real.
    calculateMatchesForUser.mockRejectedValueOnce(new Error('engine down'));
    dbState({ hasMatches: false, hasSkills: true, countAfter: 0 });

    const res = await request(app()).get('/api/matches');

    expect(res.status).toBe(200);
    expect(res.body.scoredOnRead).toBe(false);
    expect(Array.isArray(res.body.matches)).toBe(true);
  });
});

describe('A2 — applying a parsed resume scores immediately', () => {
  const resumeRouter = require('../routes/resume');

  function resumeApp() {
    const a = express();
    a.use(express.json());
    a.use('/api/resume', resumeRouter);
    return a;
  }

  it('scores on apply-parsed rather than waiting for the next feed read', async () => {
    query.mockReset();
    query.mockResolvedValue({ rows: [] });

    const res = await request(resumeApp())
      .post('/api/resume/apply-parsed')
      .send({ skills: ['Figma'], experience: [] });

    expect(res.status).toBe(200);
    expect(calculateMatchesForUser).toHaveBeenCalledWith(42);
    expect(res.body.scored).toBe(true);
  });

  it('reports a scoring failure instead of implying the feed is ready', async () => {
    // The skills genuinely were saved, so this must not fail the request - but
    // it must not claim scoring happened either.
    query.mockReset();
    query.mockResolvedValue({ rows: [] });
    calculateMatchesForUser.mockRejectedValueOnce(new Error('engine down'));

    const res = await request(resumeApp())
      .post('/api/resume/apply-parsed')
      .send({ skills: ['Figma'], experience: [] });

    expect(res.status).toBe(200);
    expect(res.body.skillsAdded).toBe(1);
    expect(res.body.scored).toBe(false);
  });
});
