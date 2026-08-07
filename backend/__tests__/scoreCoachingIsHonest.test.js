/*
 * Feature 5 — score coaching, and the one thing it must never do.
 *
 * The skills component is `matched / userSkills.length`: the share of the
 * USER'S skills a job mentions, not the share of the job's needs they meet.
 * So adding a skill raises the score on jobs that mention it and LOWERS it on
 * every job that does not.
 *
 * The obvious implementation — rank the missing skills by how often they
 * appear — therefore recommends things that make the average score worse. The
 * tests below drive exactly that case, because it is the whole reason this is
 * computed rather than counted.
 *
 * Cold start is the normal case: no applications, no outcomes, no history.
 * Everything here works from the feed and the recorded skills alone.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = { id: 42 }; next(); },
}));

const { query } = require('../db');
const { coach, WEIGHTS } = require('../services/scoreCoaching');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/matches', require('../routes/matches'));
  return a;
}

const job = (id, text) => ({
  job_id: id, title: `Job ${id}`, company_name: 'Acme', text,
  experience_match_score: 1, location_match_score: 0.7, salary_match_score: 0.7,
});

beforeEach(() => query.mockReset());

describe('after D49, adding a real skill can never lower the score', () => {
  it('a RARE skill is non-negative, which is the whole point of the change', () => {
    /*
     * This test used to assert the opposite, and was right to: under
     * `matched / userSkills.length` a skill in 3 of 20 jobs helped 3 and hurt
     * 17, netting -0.018. The operator took Option B precisely because a
     * product that penalises telling it the truth is broken.
     *
     * The denominator is now the POSTING's requirement count, so a job that
     * does not mention the skill is untouched.
     */
    const jobs = [
      ...Array.from({ length: 3 }, (_, i) => job(i + 1, 'Figma and Rust systems programming.')),
      ...Array.from({ length: 17 }, (_, i) => job(i + 4, 'Figma and general product design.')),
    ];
    const out = coach(jobs, ['Figma', 'Prototyping', 'Sketch']);
    const rust = out.candidates.find((c) => c.skill === 'Rust');

    expect(rust).toBeTruthy();
    expect(rust.netDelta).toBeGreaterThan(0);
    expect(rust.jobsHurt).toBe(0);
    expect(out.negativeCandidates).toBe(0);
  });

  it('no candidate anywhere hurts a single job', () => {
    /*
     * jobsHurt is kept precisely so this can be asserted. A non-zero value
     * would mean this file and matchingEngine have drifted apart on the
     * denominator, which is the failure that would silently undo D49.
     */
    const jobs = [
      ...Array.from({ length: 6 }, (_, i) => job(i + 1, 'Figma and Kubernetes platform work.')),
      ...Array.from({ length: 4 }, (_, i) => job(i + 7, 'Figma and User Research.')),
    ];
    const out = coach(jobs, ['Figma', 'Prototyping']);

    expect(out.candidates.length).toBeGreaterThan(0);
    for (const c of out.candidates) {
      expect(c.jobsHurt).toBe(0);
      expect(c.netDelta).toBeGreaterThanOrEqual(0);
      expect(c.jobsHelped).toBe(c.appearsInJobs);
    }
  });

  it('is worth more in a job that asks for few other things', () => {
    /*
     * The ordering genuinely differs from frequency now, which it provably did
     * NOT under the old formula - a claim an earlier draft made and had to
     * retract. Being one of four things a posting wants beats being one of
     * nine, so a rarer skill in lean postings can outrank a commoner one.
     */
    const lean = Array.from({ length: 4 }, (_, i) =>
      job(i + 1, 'Figma. Rust.'));                                  // 2 skills -> floored to 4
    const fat = Array.from({ length: 6 }, (_, i) =>
      job(i + 5, 'Figma, Kubernetes, Docker, Terraform, AWS, Python, SQL, React, Vue.'));
    const out = coach([...lean, ...fat], ['Figma', 'Sketch']);

    const rust = out.candidates.find((c) => c.skill === 'Rust');
    const k = out.candidates.find((c) => c.skill === 'Kubernetes');
    expect(rust.appearsInJobs).toBeLessThan(k.appearsInJobs);       // rarer
    expect(rust.netDelta).toBeGreaterThan(k.netDelta);              // and worth more
  });

  it('orders by netDelta', () => {
    const jobs = [
      ...Array.from({ length: 10 }, (_, i) => job(i + 1, 'Figma and Kubernetes.')),
      ...Array.from({ length: 4 }, (_, i) => job(i + 11, 'Figma and Rust.')),
    ];
    const out = coach(jobs, ['Figma', 'Sketch']);
    const d = out.candidates.map((c) => c.netDelta);
    expect(d).toEqual([...d].sort((a, b) => b - a));
  });
});

describe('every claim traces to the user\'s own feed', () => {
  it('carries the job ids behind each candidate', () => {
    const jobs = Array.from({ length: 5 }, (_, i) => job(i + 1, 'Figma and Kubernetes work.'));
    const out = coach(jobs, ['Figma']);
    const k = out.candidates.find((c) => c.skill === 'Kubernetes');

    expect(k.evidence.length).toBeGreaterThan(0);
    for (const e of k.evidence) {
      expect(jobs.some((j) => j.job_id === e.jobId)).toBe(true);
    }
  });

  it('never suggests a skill that is not written in one of those jobs', () => {
    /*
     * The invention test. Candidates are extracted from the feed text only, so
     * a skill nobody's posting mentions cannot appear however plausible it is
     * for the role.
     */
    const jobs = Array.from({ length: 6 }, (_, i) => job(i + 1, 'Figma and Kubernetes work.'));
    const out = coach(jobs, ['Figma']);
    const corpus = jobs.map((j) => j.text).join(' ').toLowerCase();

    for (const c of out.candidates) {
      expect(corpus).toContain(c.skill.toLowerCase());
    }
  });

  it('never suggests something the user already has', () => {
    const jobs = Array.from({ length: 6 }, (_, i) => job(i + 1, 'Figma and Kubernetes work.'));
    const out = coach(jobs, ['Figma', 'Kubernetes']);
    expect(out.candidates.find((c) => /^(figma|kubernetes)$/i.test(c.skill))).toBeUndefined();
  });
});

describe('it uses the four real weights', () => {
  it('weights are the engine\'s, and sum to 1', () => {
    expect(WEIGHTS).toEqual({ skills: 0.40, experience: 0.30, location: 0.20, salary: 0.10 });
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it('names the component with the most points available, not the lowest score', () => {
    /*
     * Built so the two rules DISAGREE, which the first cut did not - there,
     * skills was both the lowest score and the biggest opportunity, so
     * sorting by either produced 'skills' and the test proved nothing.
     *
     * Here salary is the LOWEST score (0.1) but worth only 0.9 x 0.10 = 0.09
     * points, while skills at 0.5 is worth 0.5 x 0.40 = 0.20. Lowest-score
     * says salary; points-available says skills. Only one of those sends a
     * person to fix the right thing.
     */
    const jobs = Array.from({ length: 4 }, (_, i) => ({
      ...job(i + 1, 'Figma Sketch work.'),
      salary_match_score: 0.1, location_match_score: 1, experience_match_score: 1,
    }));
    const out = coach(jobs, ['Figma', 'Sketch', 'Rust', 'Go']);   // skills 2/4 = 0.5

    const skills = out.components.find((c) => c.id === 'skills');
    const salary = out.components.find((c) => c.id === 'salary');
    expect(salary.score).toBeLessThan(skills.score);              // salary IS the lowest
    expect(skills.pointsAvailable).toBeGreaterThan(salary.pointsAvailable);
    expect(out.biggestGap).toBe('skills');                        // and skills is the answer
  });
});

describe('cold start says what is missing rather than failing', () => {
  it('no scored jobs -> ready:false with a reason', () => {
    const out = coach([], ['Figma']);
    expect(out.ready).toBe(false);
    expect(out.reason).toBe('no_scored_jobs');
    expect(out.detail.length).toBeGreaterThan(20);
  });

  it('no skills recorded -> ready:false, because there is no baseline to move', () => {
    const out = coach([job(1, 'Figma work.')], []);
    expect(out.ready).toBe(false);
    expect(out.reason).toBe('no_skills_recorded');
  });
});

describe('GET /api/matches/coaching, through the real route', () => {
  const dbWith = (jobs, skills) => query.mockImplementation((sql) => {
    if (/FROM job_matches/.test(sql)) return Promise.resolve({ rows: jobs });
    if (/FROM user_skills/.test(sql)) return Promise.resolve({ rows: skills.map((s) => ({ skill: s })) });
    return Promise.resolve({ rows: [] });
  });

  it('answers with the ranked candidates', async () => {
    dbWith(
      [...Array.from({ length: 6 }, (_, i) => job(i + 1, 'Figma and Kubernetes.')),
        ...Array.from({ length: 4 }, (_, i) => job(i + 7, 'Figma only.'))],
      ['Figma', 'Sketch']
    );
    const res = await request(app()).get('/api/matches/coaching');

    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(true);
    expect(res.body.candidates[0].skill).toBe('Kubernetes');
    expect(res.body.candidates[0]).toHaveProperty('jobsHurt');
    expect(res.body).toHaveProperty('howThisWorks');
  });

  it('bounds the sample, because a feed can be 25,000 rows', async () => {
    dbWith([job(1, 'Figma.')], ['Figma']);
    await request(app()).get('/api/matches/coaching');

    const call = query.mock.calls.find(([sql]) => /FROM job_matches/.test(sql));
    expect(call[0]).toMatch(/LIMIT \$2/);
    expect(call[1][1]).toBeLessThanOrEqual(400);
  });

  it('scopes to the caller', async () => {
    dbWith([job(1, 'Figma.')], ['Figma']);
    await request(app()).get('/api/matches/coaching');

    const call = query.mock.calls.find(([sql]) => /FROM job_matches/.test(sql));
    expect(call[0]).toMatch(/m\.user_id = \$1/);
    expect(call[1][0]).toBe(42);
  });

  it('returns 200 with a reason when there is nothing to say yet', async () => {
    // Not an error. "No data yet" is an answer the client should render.
    dbWith([], []);
    const res = await request(app()).get('/api/matches/coaching');
    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(false);
  });
});
