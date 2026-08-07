/*
 * D49 — the skills denominator, the floor, and the one-pass re-score.
 *
 * The formula changed from `matched / userSkills.length` to
 * `matched / max(jobRequiredSkills, 4)`. Measured on 220 live jobs, the old
 * one meant adding a genuine skill LOWERED the score on every job that did not
 * mention it, only 1 of 74 missing skills would have helped, and deleting six
 * of eleven real skills raised the score 166%. The product rewarded telling it
 * less about yourself.
 *
 * These tests pin the three things that must not quietly come undone:
 *   the denominator belongs to the POSTING
 *   the floor stops a thin posting reading 100%
 *   coaching and the engine cannot drift apart on either
 */

jest.mock('../db', () => ({ query: jest.fn() }));
const { query } = require('../db');
const { scoreJobsForUser } = require('../services/matchingEngine');

/*
 * Scored through `scoreJobsForUser` - the entry the feed and the routes
 * actually call - rather than by exporting the pure scorer. Exporting it would
 * put a guard on the wiring census with no cross-file caller, which is the
 * trap fetchWithGuards fell into, and testing the real path is the stronger
 * choice anyway.
 */
async function skillsScoreFor(jobText, userSkills) {
  query.mockImplementation((sql) => {
    if (/FROM user_skills/.test(sql)) return Promise.resolve({ rows: userSkills.map((skill) => ({ skill })) });
    if (/FROM user_experience/.test(sql)) return Promise.resolve({ rows: [{ earliest_start: null, latest_end: null }] });
    if (/FROM user_preferences/.test(sql)) return Promise.resolve({ rows: [{ preferred_locations: null, min_salary: null, max_salary: null }] });
    if (/FROM jobs WHERE id = ANY/.test(sql)) {
      return Promise.resolve({ rows: [{ id: 1, title: '', description: jobText, requirements: '', salary_min: null, salary_max: null, location: null }] });
    }
    return Promise.resolve({ rows: [] });
  });
  const m = await scoreJobsForUser(7, [1]);
  const row = m.get(1) ?? m.get('1');
  return Number(row.skills_match_score);
}
const { coach } = require('../services/scoreCoaching');
const { extractSkills } = require('../services/resumeParser');
const { rescore, rescoreStatus } = require('../services/rescoreIndex');

const engineSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'services', 'matchingEngine.js'), 'utf8');
const coachSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'services', 'scoreCoaching.js'), 'utf8');

describe('the denominator is the posting\'s, not the user\'s', () => {
  it('adding a skill the posting does not want leaves that job untouched', async () => {
    /* The defect D49 exists to remove. */
    const jobText = 'We need Figma and Prototyping for our design system.';
    const few = await skillsScoreFor(jobText, ['Figma']);
    const many = await skillsScoreFor(jobText, ['Figma', 'Rust', 'Kubernetes', 'Terraform']);

    // Three skills added that this posting never mentions. Under the old
    // formula the score fell from 1/1 to 1/4.
    expect(many).toBeGreaterThanOrEqual(few);
  });

  it('matching more of what a posting asks for scores higher', async () => {
    const jobText = 'Figma, Prototyping, User Research, Design Systems required.';
    const one = await skillsScoreFor(jobText, ['Figma']);
    const all = await skillsScoreFor(jobText, ['Figma', 'Prototyping', 'User Research', 'Design Systems']);
    expect(all).toBeGreaterThan(one);
  });
});

describe('the floor stops a thin posting reading 100%', () => {
  it('matching both skills of a two-skill posting is not a perfect match', async () => {
    /*
     * The floor is 4, taken from the measured distribution: extracted skills
     * per job has p25 = 4, and 15% of jobs carry only 2-3. Without it,
     * matching a barely-parsed posting reads as a perfect match.
     */
    const jobText = 'Figma and Sketch.';
    expect(extractSkills(jobText).length).toBeLessThan(4);

    const score = await skillsScoreFor(jobText, ['Figma', 'Sketch']);
    expect(score).toBeLessThan(1);
    expect(score).toBeCloseTo(0.5, 5);   // 2 / max(2,4)
  });

  it('a genuinely rich match can still reach 100%', async () => {
    // The floor must not make a real perfect match unreachable.
    const jobText = 'Figma, Prototyping, User Research, Design Systems, Usability Testing.';
    const score = await skillsScoreFor(jobText,
      ['Figma', 'Prototyping', 'User Research', 'Design Systems', 'Usability Testing']);
    expect(score).toBeCloseTo(1, 5);
  });

  it('the score is never above 1', async () => {
    const score = await skillsScoreFor('Figma and Sketch.', ['Figma', 'Sketch']);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe('coaching and the engine cannot drift apart', () => {
  it('both use the same floor', () => {
    /*
     * Two files computing one formula is how they diverge. If these disagree,
     * coaching promises an uplift the engine will not deliver.
     */
    const eng = engineSrc.match(/JOB_SKILLS_FLOOR\s*=\s*(\d+)/);
    const co = coachSrc.match(/JOB_SKILLS_FLOOR\s*=\s*(\d+)/);
    expect(eng).not.toBeNull();
    expect(co).not.toBeNull();
    expect(co[1]).toBe(eng[1]);
  });

  it('coaching never reports a job as hurt, because none can be', () => {
    const job = (id, text) => ({
      job_id: id, title: `J${id}`, company_name: 'A', text,
      experience_match_score: 1, location_match_score: 0.7, salary_match_score: 0.7,
    });
    const jobs = [
      ...Array.from({ length: 3 }, (_, i) => job(i + 1, 'Figma and Rust.')),
      ...Array.from({ length: 17 }, (_, i) => job(i + 4, 'Figma and design work.')),
    ];
    const out = coach(jobs, ['Figma', 'Prototyping', 'Sketch']);
    for (const c of out.candidates) expect(c.jobsHurt).toBe(0);
    expect(out.negativeCandidates).toBe(0);
  });

  it('no longer advertises a threshold that no longer exists', () => {
    // `helpsAbove` was a real threshold under the old denominator. Keeping the
    // name would be a field that disagrees with its data.
    expect(coachSrc).not.toMatch(/helpsAbove:/);
    expect(coachSrc).toMatch(/meanSkillsScore:/);
  });
});

describe('the re-score pass is bounded, resumable and honest', () => {
  const rows = (n, user = 1) => Array.from({ length: n }, (_, i) => ({ job_id: i + 1, user_id: user, overall_score: '0.60' }));

  function fakeDb(pending) {
    let left = [...pending];
    return jest.fn(async (sql, params) => {
      if (/GROUP BY user_id/.test(sql)) {
        return { rows: left.length ? [{ user_id: left[0].user_id, n: left.length }] : [] };
      }
      if (/SELECT job_id, overall_score/.test(sql)) {
        const uid = params[0];
        return { rows: left.filter((r) => r.user_id === uid).slice(0, params[1]) };
      }
      if (/UPDATE job_matches/.test(sql)) {
        left = left.filter((r) => !(r.user_id === params[0] && r.job_id === params[1]));
        return { rows: [] };
      }
      return { rows: [] };
    });
  }

  it('rewrites every pending row and reports how far they moved', async () => {
    const q = fakeDb(rows(5));
    const score = async (_u, ids) => new Map(ids.map((id) => [id, { overall_score: 0.75 }]));
    const out = await rescore(q, score);

    expect(out.scanned).toBe(5);
    expect(out.updated).toBe(5);
    expect(out.movedUp).toBe(5);
    expect(out.movedDown).toBe(0);
    expect(out.meanDelta).toBeCloseTo(0.15, 4);
  });

  it('stamps every row it touches, so a restart resumes instead of repeating', async () => {
    const q = fakeDb(rows(3));
    await rescore(q, async (_u, ids) => new Map(ids.map((id) => [id, { overall_score: 0.7 }])));

    const updates = q.mock.calls.filter(([sql]) => /UPDATE job_matches/.test(sql));
    expect(updates).toHaveLength(3);
    for (const [sql] of updates) expect(sql).toMatch(/scored_formula = 'v2_job_denom'/);
  });

  it('stamps a row even when scoring returns nothing, so it cannot loop for ever', async () => {
    /*
     * Without this the pass re-selects the same unscorable row on every
     * iteration and never terminates - worse than one stale score.
     */
    const q = fakeDb(rows(2));
    const out = await rescore(q, async () => new Map());

    expect(out.scanned).toBe(2);
    expect(out.updated).toBe(0);
    const updates = q.mock.calls.filter(([sql]) => /UPDATE job_matches/.test(sql));
    expect(updates).toHaveLength(2);
    for (const [sql] of updates) expect(sql).not.toMatch(/SET overall_score/);
  });

  it('only ever selects rows not already on the new formula', async () => {
    const q = fakeDb(rows(2));
    await rescore(q, async (_u, ids) => new Map(ids.map((id) => [id, { overall_score: 0.7 }])));
    for (const [sql] of q.mock.calls.filter(([s]) => /SELECT/.test(s))) {
      expect(sql).toMatch(/scored_formula IS DISTINCT FROM 'v2_job_denom'/);
    }
  });

  it('reports remaining work, so the UI can say "recalculating" truthfully', async () => {
    const q = jest.fn(async () => ({ rows: [{ total: 100, done: 40 }] }));
    const st = await rescoreStatus(q);
    expect(st).toEqual({ total: 100, done: 40, remaining: 60, complete: false });
  });
});
