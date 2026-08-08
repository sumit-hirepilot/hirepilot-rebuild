/*
 * L2 — a profile with nothing in it must not be told numbers.
 *
 * Observed on production as a brand-new account: the Jobs feed rendered a
 * uniform "30%" on every row — the score a zero-skill, zero-experience
 * context earns from location/salary defaults alone — under a banner
 * claiming "Only show matches above 40%". A percentage computed from no
 * information about the person is a fabricated judgement (the A2 principle:
 * a user with no skills is not scanned), and the on-demand feed scorer was
 * the one path without the guard.
 *
 * And the D49a re-score sat at "0 of 1,044 done" for hours because NOTHING
 * CALLS the rescore route - "the caller repeats until complete" was written
 * and the caller never built (the D32 class, one layer up). The scheduler
 * now drives it to completion after each cycle.
 */

jest.mock('../db', () => ({ query: jest.fn() }));

const { query } = require('../db');

function mockContext({ skills = [], earliestStart = null, jobs = [] }) {
  query.mockReset();
  query.mockImplementation((sql) => {
    if (/AS scoreable/.test(sql)) {
      return Promise.resolve({ rows: [{ scoreable: skills.length > 0 || Boolean(earliestStart) }] });
    }
    if (/FROM user_skills/.test(sql)) return Promise.resolve({ rows: skills.map((s) => ({ skill: s })) });
    if (/FROM user_experience/.test(sql)) {
      return Promise.resolve({ rows: [{ earliest_start: earliestStart, latest_end: earliestStart ? '2026-01-01' : null }] });
    }
    if (/FROM user_preferences/.test(sql)) return Promise.resolve({ rows: [] });
    if (/FROM jobs WHERE id = ANY/.test(sql)) return Promise.resolve({ rows: jobs });
    return Promise.resolve({ rows: [] });
  });
}

const JOB = { id: 9, title: 'Product Designer', description: 'Figma work', requirements: '', salary_min: null, salary_max: null, location: 'Remote' };

describe('scoreJobsForUser refuses to invent a judgement about a blank profile', () => {
  it('zero skills and zero experience: nothing scored, nothing written', async () => {
    jest.isolateModules(() => {});
    const { scoreJobsForUser } = require('../services/matchingEngine');
    mockContext({ skills: [], earliestStart: null, jobs: [JOB] });

    const out = await scoreJobsForUser(42, [9]);

    expect(out.size).toBe(0);
    expect(query.mock.calls.some((c) => /INSERT INTO job_matches|upsert/i.test(c[0]))).toBe(false);
  });

  it('one real skill is enough to score again', async () => {
    const { scoreJobsForUser } = require('../services/matchingEngine');
    mockContext({ skills: ['Figma'], earliestStart: null, jobs: [JOB] });

    const out = await scoreJobsForUser(42, [9]);
    expect(out.size).toBe(1);
  });
});

describe('profileScoreable answers the question the feed needs to state', () => {
  it('false for a blank profile, true once skills or experience exist', async () => {
    const { profileScoreable } = require('../services/matchingEngine');

    mockContext({ skills: [], earliestStart: null });
    expect(await profileScoreable(42)).toBe(false);

    mockContext({ skills: ['Figma'], earliestStart: null });
    expect(await profileScoreable(42)).toBe(true);

    mockContext({ skills: [], earliestStart: '2020-01-01' });
    expect(await profileScoreable(42)).toBe(true);
  });
});

describe('the scheduler drives the re-score to completion', () => {
  it('repeats bounded passes until complete, with a runaway cap', async () => {
    const { driveRescoreToCompletion } = require('../services/scheduler');
    const calls = [];
    const fakeRescore = jest.fn(async () => {
      calls.push(1);
      return { complete: calls.length >= 3, scanned: 2000, movedUp: 1, movedDown: 1 };
    });

    const out = await driveRescoreToCompletion(fakeRescore);
    expect(fakeRescore).toHaveBeenCalledTimes(3);
    expect(out.complete).toBe(true);

    // The cap: a rescore that never completes must not hold the cycle forever.
    const never = jest.fn(async () => ({ complete: false, scanned: 2000 }));
    const capped = await driveRescoreToCompletion(never, { maxPasses: 5 });
    expect(never).toHaveBeenCalledTimes(5);
    expect(capped.complete).toBe(false);
  });
});
