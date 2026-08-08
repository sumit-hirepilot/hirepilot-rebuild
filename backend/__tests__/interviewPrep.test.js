/*
 * Feature 15 — interview prep (D5): from the ACTUAL JD plus the user's
 * ACTUAL gaps, triggered where the conversation reached interviewing.
 *
 * No LLM is configured for this app, so nothing here generates a "likely
 * question" out of air. Every prep item is a skill the posting itself names,
 * quoted in the posting's own sentence (the C4 pattern), marked as a
 * strength or a gap against the skills the user actually recorded. A JD too
 * thin to read yields "not enough to prepare from", never padding.
 */

const request = require('supertest');
const express = require('express');

const { buildInterviewPrep } = require('../services/interviewPrep');

const JD = 'We need deep command of Figma for daily design work. '
  + 'You will own our Design Systems end to end. '
  + 'Experience with User Research is required. '
  + 'The team ships weekly.';

describe('buildInterviewPrep', () => {
  const job = { id: 9, title: 'Product Designer', company_name: 'Adyen', description: JD, requirements: '' };

  it('marks skills the user has as strengths, each quoting the posting\'s own sentence', () => {
    const prep = buildInterviewPrep({ job, userSkills: ['Figma', 'User Research'] });
    const figma = prep.items.find((i) => i.skill === 'Figma');
    expect(figma).toBeTruthy();
    expect(figma.hasIt).toBe(true);
    expect(figma.quote).toMatch(/deep command of Figma/i);
    // Every quote is the JD's own text, never a composed sentence.
    for (const item of prep.items) {
      expect(JD.toLowerCase()).toContain(item.quote.toLowerCase().slice(0, 40));
    }
  });

  it('marks skills the user has not recorded as gaps, stated not judged', () => {
    const prep = buildInterviewPrep({ job, userSkills: ['Figma'] });
    const ds = prep.items.find((i) => i.skill === 'Design Systems');
    expect(ds.hasIt).toBe(false);
    expect(prep.gaps.map((g) => g.skill)).toContain('Design Systems');
    expect(prep.strengths.map((g) => g.skill)).toContain('Figma');
  });

  it('says when the posting is too thin to prepare from', () => {
    const prep = buildInterviewPrep({ job: { ...job, description: '', requirements: '' }, userSkills: ['Figma'] });
    expect(prep.sufficientJd).toBe(false);
    expect(prep.items).toEqual([]);
  });

  it('never invents a skill the posting does not name', () => {
    const prep = buildInterviewPrep({ job, userSkills: ['Kubernetes'] });
    expect(prep.items.map((i) => i.skill)).not.toContain('Kubernetes');
  });
});

describe('GET /api/applications/:id/interview-prep', () => {
  jest.mock('../db', () => ({ query: jest.fn() }));
  jest.mock('../middleware/auth', () => ({
    verifyToken: (req, _res, next) => { req.user = { id: 42 }; next(); },
  }));
  jest.mock('../services/autoApplyEngine', () => ({ runAutoApplyForUser: jest.fn() }));
  jest.mock('../services/matchingEngine', () => ({ calculateMatchesForUser: jest.fn() }));
  // eslint-disable-next-line global-require
  const { query } = require('../db');
  // eslint-disable-next-line global-require
  const applicationsRouter = require('../routes/applications');

  function app() {
    const a = express();
    a.use(express.json());
    a.use('/api/applications', applicationsRouter);
    return a;
  }

  beforeEach(() => query.mockReset());

  it('prepares from the row\'s own job and the caller\'s own skills', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          id: 31, status: 'submitted', is_manual: false, tracker_stage: 'interviewing',
          title: 'Product Designer', company_name: 'Adyen', description: JD, requirements: '',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ skill: 'Figma' }] });

    const res = await request(app()).get('/api/applications/31/interview-prep');
    expect(res.status).toBe(200);
    expect(res.body.job.company_name).toBe('Adyen');
    expect(res.body.prep.strengths.map((s) => s.skill)).toContain('Figma');
    expect(res.body.prep.gaps.map((s) => s.skill)).toContain('Design Systems');
  });

  it('refuses a draft - there is no interview to prepare for', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 32, status: 'approved', is_manual: false, tracker_stage: null, title: 'X', company_name: 'Y', description: JD }],
    });
    const res = await request(app()).get('/api/applications/32/interview-prep');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/hasn't been sent|not.*sent/i);
  });

  it('404s a row that is not the caller\'s', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app()).get('/api/applications/999/interview-prep');
    expect(res.status).toBe(404);
  });
});
