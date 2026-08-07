/*
 * POST /api/resume/apply-parsed must not report an update it did not make.
 *
 * It reads the skills and experience out of the REQUEST - the client posts
 * back what the user confirmed from the parse - and does not re-read the
 * stored resume. Called with neither, it inserted nothing and answered
 * 200 "Profile updated from resume" with skillsAdded: 0.
 *
 * Found by calling it with `{resumeId}`, which it ignores: the response said
 * the profile had been built from the resume, and the profile was empty. The
 * next screen then shows no skills and nothing anywhere says why - the same
 * defect as any label that disagrees with its data, and worse here because the
 * label is the API's own account of what it just did.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = { id: 42 }; next(); },
}));
jest.mock('../services/matchingEngine', () => ({
  calculateMatchesForUser: jest.fn().mockResolvedValue(undefined),
  scoreJobsForUser: jest.fn(),
}));

const { query } = require('../db');

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.user = { id: 42 }; next(); });
  a.use('/api/resume', require('../routes/resume'));
  return a;
}

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue({ rows: [] });
});

describe('it refuses to call doing nothing an update', () => {
  it('an empty body is 400, not a cheerful 200', async () => {
    const res = await request(app()).post('/api/resume/apply-parsed').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nothing to apply/i);
    // The reason has to be actionable, not just a status.
    expect(res.body.detail.length).toBeGreaterThan(40);
  });

  it('a resumeId on its own is 400, because that is what it applies: nothing', async () => {
    const res = await request(app()).post('/api/resume/apply-parsed').send({ resumeId: 1 });

    expect(res.status).toBe(400);
    // And it must not have written anything.
    const writes = query.mock.calls.filter(([sql]) => /INSERT INTO user_skills|INSERT INTO user_experience/.test(sql));
    expect(writes).toHaveLength(0);
  });

  it('real skills still apply, and are counted honestly', async () => {
    const res = await request(app())
      .post('/api/resume/apply-parsed')
      .send({ skills: ['Figma', 'Prototyping'], experience: [] });

    expect(res.status).toBe(200);
    expect(res.body.skillsAdded).toBe(2);

    const writes = query.mock.calls.filter(([sql]) => /INSERT INTO user_skills/.test(sql));
    expect(writes).toHaveLength(2);
    expect(writes.map(([, p]) => p[1])).toEqual(['Figma', 'Prototyping']);
  });

  it('experience alone is enough to be a real call', async () => {
    const res = await request(app())
      .post('/api/resume/apply-parsed')
      .send({ experience: [{ jobTitle: 'Designer', companyName: 'Acme', startDateRaw: '2021' }] });

    expect(res.status).toBe(200);
    expect(res.body.experienceAdded).toBe(1);
  });
});
