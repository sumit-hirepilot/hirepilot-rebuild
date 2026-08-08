/*
 * The Progress board wrote and read `status` using a pipeline vocabulary
 * (phone_screen, technical_interview, onsite, hired) that no write path can
 * legally produce any more.
 *
 * Verified on production 2026-08-08, from the live database's own catalogue
 * (db-health, 9/9 claims):
 *   - applications_applied_at_requires_submitted means ANY status other than
 *     'submitted' on a row with applied_at set is rejected - every manual and
 *     every auto-pilot row. PUT /:id/status was a guaranteed 500 for exactly
 *     the rows a user would move.
 *   - a draft with NO applied_at could move to 'phone_screen', after which
 *     analytics counted a "response" for an application never sent.
 *
 * status answers "did this reach the employer, and can we prove it".
 * tracker_stage answers "where has the conversation got to" (tracker.js has
 * said so in its header all along). The board now reads and writes stages.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = { id: 42, email: 'nobody@example.com' }; next(); },
}));
jest.mock('../services/autoApplyEngine', () => ({ runAutoApplyForUser: jest.fn() }));
jest.mock('../services/matchingEngine', () => ({ calculateMatchesForUser: jest.fn() }));

const { query } = require('../db');
const applicationsRouter = require('../routes/applications');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/applications', applicationsRouter);
  return a;
}

describe('PUT /api/applications/:id/status moves the conversation, never the evidence', () => {
  beforeEach(() => {
    query.mockReset();
  });

  it('translates a pipeline word to a tracker_stage write and never touches status', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 7, status: 'submitted', tracker_stage: null, is_manual: false }] }) // row lookup
      .mockResolvedValueOnce({ rows: [{ id: 7, tracker_stage: 'interviewing' }] }) // stage update
      .mockResolvedValueOnce({ rows: [] })  // history
      .mockResolvedValueOnce({ rows: [] }); // activity

    const res = await request(app()).put('/api/applications/7/status').send({ status: 'phone_screen' });

    expect(res.status).toBe(200);
    const update = query.mock.calls.find((c) => /UPDATE applications/i.test(c[0]));
    expect(update).toBeTruthy();
    expect(update[0]).toMatch(/tracker_stage/);
    // The one thing this route must never do again: write the status column.
    expect(update[0]).not.toMatch(/SET[\s\S]*\bstatus\s*=/i);
    // phone_screen, technical_interview and onsite are all conversations in
    // progress; the stage vocabulary has one word for that.
    expect(update[1]).toContain('interviewing');
  });

  it('accepts the canonical stage words directly', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 7, status: 'submitted', tracker_stage: 'applied', is_manual: false }] })
      .mockResolvedValueOnce({ rows: [{ id: 7, tracker_stage: 'ghosted' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app()).put('/api/applications/7/status').send({ status: 'ghosted' });
    expect(res.status).toBe(200);
    const update = query.mock.calls.find((c) => /UPDATE applications/i.test(c[0]));
    expect(update[1]).toContain('ghosted');
  });

  it('refuses to move a row that never reached the employer, with the reason', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 9, status: 'approved', tracker_stage: null, is_manual: false }] });

    const res = await request(app()).put('/api/applications/9/status').send({ status: 'offer' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/not.*sent|hasn't been sent|pipeline/i);
    // And nothing was written.
    expect(query.mock.calls.some((c) => /UPDATE applications/i.test(c[0]))).toBe(false);
  });
});

describe('GET /api/applications buckets board rows by stage', () => {
  beforeEach(() => {
    query.mockReset();
  });

  it('a submitted row in interviewing appears in the interviewing column', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { id: 1, status: 'submitted', tracker_stage: 'interviewing', is_manual: false, title: 'A', company_name: 'X' },
        { id: 2, status: 'submitted', tracker_stage: null, is_manual: false, title: 'B', company_name: 'Y' },
        { id: 3, status: 'submitted', tracker_stage: 'offer', is_manual: true, title: 'C', company_name: 'Z' },
        { id: 4, status: 'approved', tracker_stage: null, is_manual: false, title: 'D', company_name: 'W' },
      ],
    });

    const res = await request(app()).get('/api/applications');
    expect(res.status).toBe(200);
    expect(res.body.kanban.interviewing.map((r) => r.id)).toEqual([1]);
    // No stage yet means sent and waiting - the applied column.
    expect(res.body.kanban.applied.map((r) => r.id)).toEqual([2]);
    expect(res.body.kanban.offer.map((r) => r.id)).toEqual([3]);
    // A draft is not a conversation; it belongs to the queue, not this board.
    const boardIds = Object.values(res.body.kanban).flat().map((r) => r.id);
    expect(boardIds).not.toContain(4);
  });

  it('a stage rejection and a status rejection land in one rejected list, once', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { id: 5, status: 'submitted', tracker_stage: 'rejected', is_manual: false, title: 'A', company_name: 'X' },
        { id: 6, status: 'rejected', tracker_stage: null, is_manual: false, title: 'B', company_name: 'Y' },
      ],
    });

    const res = await request(app()).get('/api/applications');
    const ids = res.body.rejected.map((r) => r.id).sort();
    expect(ids).toEqual([5, 6]);
  });
});

describe('GET /api/applications/stats counts conversations from stages', () => {
  beforeEach(() => {
    query.mockReset();
    query
      .mockResolvedValueOnce({
        rows: [{ total_applications: '4', applied: '2', interviews: '1', offers: '1', days_applying: '2' }],
      })
      .mockResolvedValueOnce({ rows: [{ scanned: '100' }] });
  });

  it('derives interviews and offers from tracker_stage, not from statuses nothing writes', async () => {
    const res = await request(app()).get('/api/applications/stats');
    expect(res.status).toBe(200);
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/tracker_stage/);
    expect(sql).not.toMatch(/technical_interview|onsite|phone_screen|hired/);
  });
});
