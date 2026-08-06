/*
 * A7.18 — approving a draft releases it to be sent. It never marks it applied.
 *
 * POST /api/applications/:id/approve wrote status='applied' directly. An
 * Auto-Pilot draft carries no submitted_at, no verified_at, no confirmation id
 * and is not manual, so that row is precisely what
 * applications_applied_requires_submission refuses - a constraint confirmed
 * present on the production database. The UPDATE could only ever raise, so the
 * button could only ever 500, and the copy beside it promised the thing that
 * could not happen: "approve to actually mark them applied".
 *
 * The constraint was right and the write path had never caught up. D28: applied
 * is a claim about an employer receiving something, not about a user clicking
 * approve. So approval means "this one may be sent", and applied arrives later
 * with a receipt behind it.
 *
 * These assert on the ARGUMENT that carries the value - the status written -
 * not on the response, because the response looked fine while the row was
 * wrong.
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
  a.use('/api/applications', require('../routes/applications'));
  return a;
}

beforeEach(() => query.mockReset());

/** The predicate the production table actually enforces. */
const violatesAppliedRequiresSubmission = (row) => !(
  row.status !== 'applied'
  || (row.is_manual ?? false) === true
  || row.submitted_at != null
  || row.confirmation_captured_at != null
  || row.employer_confirmation_id != null
  || row.verified_at != null
);

describe('A7.18 — a single approve', () => {
  beforeEach(() => {
    query.mockImplementation((sql) => {
      if (/UPDATE applications/.test(sql)) return Promise.resolve({ rows: [{ id: 7, status: 'approved' }] });
      return Promise.resolve({ rows: [] });
    });
  });

  it('writes approved, not applied', async () => {
    const res = await request(app()).post('/api/applications/7/approve').send({});
    expect(res.status).toBe(200);

    const update = query.mock.calls.find((c) => /UPDATE applications/.test(c[0]));
    expect(update[0]).toMatch(/status = 'approved'/);
    expect(update[0]).not.toMatch(/status = 'applied'/);
  });

  it('would not produce a row the table refuses', async () => {
    await request(app()).post('/api/applications/7/approve').send({});
    // The row this endpoint now creates, evaluated against the real predicate.
    const written = { status: 'approved', is_manual: null, submitted_at: null, verified_at: null };
    expect(violatesAppliedRequiresSubmission(written)).toBe(false);
  });

  it('and the OLD behaviour would have - so this test can tell them apart', () => {
    const old = {
      status: 'applied', is_manual: null, submitted_at: null,
      confirmation_captured_at: null, employer_confirmation_id: null, verified_at: null,
    };
    expect(violatesAppliedRequiresSubmission(old)).toBe(true);
  });

  it('records the transition it actually made', async () => {
    await request(app()).post('/api/applications/7/approve').send({});
    const history = query.mock.calls.find((c) => /INSERT INTO application_history/.test(c[0]));
    expect(history[0]).toMatch(/'pending_review', 'approved'/);
  });

  it('still refuses an id that is not the caller\'s pending draft', async () => {
    query.mockImplementation(() => Promise.resolve({ rows: [] }));
    const res = await request(app()).post('/api/applications/7/approve').send({});
    expect(res.status).toBe(404);
  });
});

describe('A7.18 — approving many at once', () => {
  const updateReturns = (ids) => query.mockImplementation((sql) => {
    if (/UPDATE applications/.test(sql)) return Promise.resolve({ rows: ids.map((id) => ({ id })) });
    return Promise.resolve({ rows: [] });
  });

  it('approves every supplied draft in one statement', async () => {
    updateReturns([1, 2, 3]);
    const res = await request(app()).post('/api/applications/approve-bulk').send({ ids: [1, 2, 3] });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
    expect(res.body.approved).toEqual([1, 2, 3]);
  });

  it('uses the same rule as the single approve - approved, never applied', async () => {
    updateReturns([1]);
    await request(app()).post('/api/applications/approve-bulk').send({ ids: [1] });

    const update = query.mock.calls.find((c) => /UPDATE applications/.test(c[0]));
    expect(update[0]).toMatch(/status = 'approved'/);
    expect(update[0]).not.toMatch(/status = 'applied'/);
  });

  it('scopes to the caller and to pending_review in the statement itself', async () => {
    // Not filtered in JS afterwards: a stale id from an unreloaded page must
    // not be able to move someone else's row, or re-approve one already sent.
    updateReturns([1]);
    await request(app()).post('/api/applications/approve-bulk').send({ ids: [1, 999] });

    const update = query.mock.calls.find((c) => /UPDATE applications/.test(c[0]));
    expect(update[0]).toMatch(/user_id = \$1/);
    expect(update[0]).toMatch(/status = 'pending_review'/);
    expect(update[1][0]).toBe(42);
  });

  it('names the ids that did not move rather than leaving them out of the count', async () => {
    updateReturns([1]);
    const res = await request(app()).post('/api/applications/approve-bulk').send({ ids: [1, 2] });

    expect(res.body.count).toBe(1);
    expect(res.body.unchanged).toEqual([2]);
  });

  it('refuses an empty or junk list rather than running an unbounded update', async () => {
    updateReturns([]);
    expect((await request(app()).post('/api/applications/approve-bulk').send({ ids: [] })).status).toBe(400);
    expect((await request(app()).post('/api/applications/approve-bulk').send({ ids: ['x'] })).status).toBe(400);
    expect(query.mock.calls.filter((c) => /UPDATE applications/.test(c[0]))).toHaveLength(0);
  });
});
