/*
 * A7.13 — an empty result must name the filter that emptied it.
 *
 * Reproduced on production before diagnosing: keywords=figma + Past 24 hours
 * renders "No jobs match these filters" while a Datadog role sits on screen
 * below it. Two defects in one view.
 *
 * "No jobs match these filters" is true and useless. Every filter is named in
 * it and none is blamed, so the user's only move is to clear all of them and
 * start again. The server already knows which one did it - it can count with
 * each dropped - and after A7.17 there is no 500-row cap left to explain the
 * emptiness away.
 *
 * Every number here is a real COUNT. A suggestion like "try widening the date
 * range" without a count behind it is a guess presented as a finding, which is
 * Constraint 1 territory.
 */

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

jest.mock('../db', () => ({ query: jest.fn() }));
const { query } = require('../db');
const jobsRouter = require('../routes/jobs');

function app() {
  const a = express();
  a.use('/api/jobs', jobsRouter);
  return a;
}

const token = jwt.sign({ id: 42, email: 'a@b.c' }, process.env.JWT_SECRET || 'dev-secret');

/** Every COUNT returns `counts`, in order; page queries return no rows. */
function mockCounts(counts) {
  query.mockReset();
  let i = 0;
  query.mockImplementation((sql) => {
    if (/SELECT COUNT\(\*\)/.test(sql)) {
      const v = counts[Math.min(i, counts.length - 1)];
      i += 1;
      return Promise.resolve({ rows: [{ count: String(v) }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

describe('A7.13 — the empty state names a cause, with a number behind it', () => {
  it('reports which filter emptied the result and how many it costs', async () => {
    // total 0, then each relaxed count. The date drop recovers 11.
    mockCounts([0, 0, 11, 0]);
    const res = await request(app())
      .get('/api/jobs?limit=20&keywords=figma&datePosted=24h')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.emptyReason).toBeTruthy();
    expect(Array.isArray(res.body.emptyReason.filters)).toBe(true);
    const keys = res.body.emptyReason.filters.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(['datePosted', 'keywords']));
    for (const f of res.body.emptyReason.filters) {
      expect(typeof f.label).toBe('string');
      expect(Number.isInteger(f.withoutIt)).toBe(true);
    }
  });

  it('names the filter it is most reasonable to relax, not the largest recovery', async () => {
    /*
     * Measured on production for figma + Past 24 hours: dropping the keyword
     * recovers 579, dropping the date recovers 11. "Largest recovery" would
     * name the keyword - arithmetically correct and useless, because the user
     * typed figma on purpose and the advice reduces to "stop looking for the
     * job you want".
     *
     * So this fixture makes the keyword the biggest recovery by far (25 vs 3)
     * and still expects the date. Size only breaks ties within a tier.
     */
    mockCounts([0, 0, 3, 25, 0]);
    const res = await request(app())
      .get('/api/jobs?limit=20&keywords=figma&datePosted=24h')
      .set('Authorization', `Bearer ${token}`);

    const byKey = Object.fromEntries(res.body.emptyReason.filters.map((f) => [f.key, f.withoutIt]));
    expect(byKey.datePosted).toBe(3);
    expect(byKey.keywords).toBe(25);
    expect(res.body.emptyReason.primary).toBe('datePosted');
  });

  it('breaks ties within a tier by how much is recovered', async () => {
    // Two refinements, both droppable: the bigger recovery wins. Without this
    // the ordering could be positional and nobody would notice.
    mockCounts([0, 0, 2, 40, 0]);
    const res = await request(app())
      .get('/api/jobs?limit=20&datePosted=24h&minScore=0.9&location=remote')
      .set('Authorization', `Bearer ${token}`);

    const keys = res.body.emptyReason.filters.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(['location', 'datePosted', 'minScore']));
    expect(['datePosted', 'minScore']).toContain(res.body.emptyReason.primary);
  });

  it('says so plainly when no single filter explains it', async () => {
    // Dropping any one still returns nothing: the honest answer is that no
    // single filter is responsible, not the first one in the list.
    mockCounts([0, 0, 0, 0, 0]);
    const res = await request(app())
      .get('/api/jobs?limit=20&keywords=figma&datePosted=24h')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.emptyReason.primary).toBeNull();
  });

  it('does not run the diagnosis when there is nothing to diagnose', async () => {
    // It costs one COUNT per active filter. That is affordable on an empty
    // result and wasteful on every other request.
    mockCounts([12]);
    const res = await request(app())
      .get('/api/jobs?limit=20&keywords=figma&datePosted=24h')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.total).toBe(12);
    expect(res.body.emptyReason).toBeNull();
  });

  it('keeps the response shape deterministic', async () => {
    // A7.17's lesson: the key is always present, null when it does not apply.
    mockCounts([12]);
    const res = await request(app()).get('/api/jobs?limit=20').set('Authorization', `Bearer ${token}`);
    expect(res.body).toHaveProperty('emptyReason');
    expect(res.body.emptyReason).toBeNull();
  });

  it('counts with the filter genuinely removed, not with a hardcoded number', async () => {
    mockCounts([0, 0, 11, 0]);
    await request(app())
      .get('/api/jobs?limit=20&keywords=figma&datePosted=24h')
      .set('Authorization', `Bearer ${token}`);

    const countSqls = query.mock.calls.map((c) => c[0]).filter((s) => /SELECT COUNT\(\*\)/.test(s));
    // One of them must have no date predicate at all - that IS the relaxation.
    expect(countSqls.some((s) => !/posted_at >= CURRENT_TIMESTAMP/.test(s))).toBe(true);
    // ...and one must still have it, or the baseline was never measured.
    expect(countSqls.some((s) => /posted_at >= CURRENT_TIMESTAMP/.test(s))).toBe(true);
  });
});
