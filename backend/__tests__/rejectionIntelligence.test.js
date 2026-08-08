/*
 * Feature 11 — rejection intelligence (D3).
 *
 * Patterns across a user's SENT applications: conversion by source, by
 * seniority band, by current match-score band. Two honesty rules carry the
 * whole feature:
 *
 * 1. No claim under 15 applications - below that the payload says so with
 *    the real number, and per-group rates are withheld (null, never 0) when
 *    the group itself is thin.
 * 2. Outcomes come only from what the tracker actually recorded. A pending
 *    application is pending, not a failure; a ghosted one is its own state.
 *    Score bands are labelled as TODAY's calculation - score-at-apply was
 *    never instrumented (D1) and cannot be backfilled honestly.
 */

const { analyze, MIN_CLAIM } = require('../services/rejectionIntelligence');

const row = (over = {}) => ({
  source: 'greenhouse', title: 'Senior Product Designer',
  status: 'submitted', tracker_stage: null, overall_score: '0.71',
  ...over,
});

describe('the 15-application floor', () => {
  it('under 15 sent applications: no claims, and the payload says how far off', () => {
    const r = analyze([row(), row(), row()]);
    expect(r.sufficient).toBe(false);
    expect(r.sentTotal).toBe(3);
    expect(r.needed).toBe(MIN_CLAIM);
    // No rates sneak out under the floor.
    expect(r.bySource).toBeNull();
    expect(r.bySeniority).toBeNull();
    expect(r.byScoreBand).toBeNull();
  });

  it('a thin group inside a sufficient set carries null rates, never a fabricated one', () => {
    const rows = [
      ...Array.from({ length: 15 }, () => row({ tracker_stage: 'interviewing' })),
      row({ source: 'lever', tracker_stage: 'rejected' }),
    ];
    const r = analyze(rows);
    expect(r.sufficient).toBe(true);
    const lever = r.bySource.find((g) => g.key === 'lever');
    expect(lever.applications).toBe(1);
    expect(lever.sufficient).toBe(false);
    expect(lever.responseRate).toBeNull();
    const gh = r.bySource.find((g) => g.key === 'greenhouse');
    expect(gh.sufficient).toBe(true);
    expect(gh.responseRate).toBe(100);
  });
});

describe('outcome mapping', () => {
  const rows = [
    ...Array.from({ length: 6 }, () => row({ tracker_stage: 'interviewing' })),
    ...Array.from({ length: 3 }, () => row({ tracker_stage: 'offer' })),
    ...Array.from({ length: 4 }, () => row({ tracker_stage: 'rejected' })),
    ...Array.from({ length: 2 }, () => row({ status: 'rejected', tracker_stage: null })),
    ...Array.from({ length: 3 }, () => row({ tracker_stage: 'ghosted' })),
    ...Array.from({ length: 2 }, () => row({ tracker_stage: null })),
  ];

  it('counts interviewing and offer as responses, both rejection paths as rejections', () => {
    const r = analyze(rows);
    const gh = r.bySource.find((g) => g.key === 'greenhouse');
    expect(gh.applications).toBe(20);
    expect(gh.responses).toBe(9);
    expect(gh.rejections).toBe(6);
    expect(gh.ghosted).toBe(3);
    expect(gh.pending).toBe(2);
    expect(gh.responseRate).toBe(45);
  });

  it('seniority comes from the shared band definition, not a fourth copy', () => {
    const r = analyze([
      ...Array.from({ length: 15 }, () => row({ title: 'Senior Product Designer', tracker_stage: 'rejected' })),
      ...Array.from({ length: 15 }, () => row({ title: 'Staff Designer', tracker_stage: 'interviewing' })),
    ]);
    const senior = r.bySeniority.find((g) => g.key === 'senior');
    const staff = r.bySeniority.find((g) => g.key === 'staff');
    expect(senior.applications).toBe(15);
    expect(senior.responseRate).toBe(0);
    expect(staff.responseRate).toBe(100);
  });

  it('an unscored application lands in unscored, never in a band', () => {
    const r = analyze(Array.from({ length: 15 }, () => row({ overall_score: null })));
    const unscored = r.byScoreBand.find((g) => g.key === 'unscored');
    expect(unscored.applications).toBe(15);
    expect(r.byScoreBand.filter((g) => g.key !== 'unscored').every((g) => g.applications === 0)).toBe(true);
  });

  it('states that score bands are today\'s calculation, not score at apply', () => {
    const r = analyze(Array.from({ length: 15 }, () => row()));
    expect(r.definitions.scoreBand).toMatch(/today|current/i);
  });

  it('a real zero response rate is 0, not null - the floor separates the two', () => {
    const r = analyze(Array.from({ length: 15 }, () => row({ tracker_stage: 'rejected' })));
    const gh = r.bySource.find((g) => g.key === 'greenhouse');
    expect(gh.responseRate).toBe(0);
  });
});
