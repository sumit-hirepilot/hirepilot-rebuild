/*
 * D52b — the two flags the evidence endpoint returns on a response nobody was
 * checking.
 *
 * `receipt: {frozen: false}` hid a total failure for the product's entire life:
 * the freeze query read `a.resume_id` and `a.ats`, columns of the table it was
 * inserting INTO, so it threw on every submission ever made. The endpoint went
 * on answering 200 and the missing receipts were read as "nobody has submitted
 * yet". Reporting a failure in a field nobody asserts is the same as swallowing
 * it.
 *
 * `verified: false` is the other one, and it carries more: it is the refusal
 * behind "nothing reaches applied without a submission record". It had been
 * proved by hand on production and by no test at all.
 *
 * Both are asserted here, through the real route.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = { id: 7 }; next(); },
  attachUserIfPresent: (_req, _res, next) => next(),
}));

const { query } = require('../db');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/apply', require('../routes/apply'));
  return a;
}

/** A database that answers each statement the endpoint issues. */
function db({ receiptInsertThrows = false } = {}) {
  query.mockImplementation(async (sql) => {
    if (/SELECT id, status FROM applications/i.test(sql)) return { rows: [{ id: 21, status: 'submitting' }] };
    if (/UPDATE applications/i.test(sql) && /RETURNING/i.test(sql)) {
      return { rows: [{ id: 21, status: 'submitted', submitted_at: new Date(), verified_at: new Date(), employer_confirmation_id: 'GH-1' }] };
    }
    if (/FROM applications a/i.test(sql)) {
      return { rows: [{ screening_answers: {}, ats: 'greenhouse', target_form_url: 'https://x.test', resume_id: 3, original_filename: 'cv.pdf', file_data: Buffer.from('pdf') }] };
    }
    if (/INSERT INTO submission_receipts/i.test(sql)) {
      if (receiptInsertThrows) throw new Error('column a.resume_id does not exist');
      return { rows: [{ id: 99, submitted_at: new Date() }] };
    }
    if (/SELECT job_id FROM applications/i.test(sql)) return { rows: [{ job_id: 5 }] };
    return { rows: [] };
  });
}

beforeEach(() => query.mockReset());

describe('verified: false — nothing reaches applied without evidence', () => {
  it('refuses 422 when there is no confirmation id and no success text', async () => {
    db();
    const res = await request(app())
      .post('/api/apply/queue/21/evidence')
      .send({ confirmationId: '', confirmationText: 'Sorry, something went wrong.', finalUrl: 'https://x.test' });

    expect(res.status).toBe(422);
    expect(res.body.verified).toBe(false);
    expect(res.body.status).toBe('failed');
  });

  it('marks the row failed rather than leaving it mid-flight', async () => {
    db();
    await request(app())
      .post('/api/apply/queue/21/evidence')
      .send({ confirmationId: '', confirmationText: 'nope' });

    const update = query.mock.calls.find(([sql]) => /UPDATE applications/i.test(sql) && /status = 'failed'/i.test(sql));
    expect(update).toBeTruthy();
    // The reason has to say what was missing, or nobody can act on it.
    expect(String(update[1][0])).toMatch(/could not verify/i);
  });

  it('writes no receipt for a refused submission', async () => {
    db();
    await request(app())
      .post('/api/apply/queue/21/evidence')
      .send({ confirmationId: '', confirmationText: 'nope' });

    expect(query.mock.calls.filter(([sql]) => /INSERT INTO submission_receipts/i.test(sql))).toHaveLength(0);
  });

  it('accepts a success message alone, with no confirmation id', async () => {
    db();
    const res = await request(app())
      .post('/api/apply/queue/21/evidence')
      .send({ confirmationId: '', confirmationText: 'Thank you for applying. Your application has been received.' });

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
  });
});

describe('receipt: frozen — the flag that hid the defect', () => {
  it('is frozen: true when the receipt is actually written', async () => {
    db();
    const res = await request(app())
      .post('/api/apply/queue/21/evidence')
      .send({ confirmationId: 'GH-SANDBOX-1', confirmationText: 'Thank you for applying.' });

    expect(res.status).toBe(200);
    expect(res.body.receipt).toEqual({ id: 99, frozen: true });
  });

  it('the receipt SELECT reads the tables the columns live on', async () => {
    /*
     * The defect exactly: it selected a.resume_id and a.ats off applications.
     * resume_id belongs to tailored_resumes and ats is the submission_channel.
     */
    db();
    await request(app())
      .post('/api/apply/queue/21/evidence')
      .send({ confirmationId: 'GH-1', confirmationText: 'Thank you for applying.' });

    const sel = query.mock.calls.find(([sql]) => /FROM applications a/i.test(sql) && /submission_receipts/i.test(sql) === false && /original_filename/i.test(sql));
    expect(sel).toBeTruthy();
    expect(sel[0]).not.toMatch(/a\.resume_id/);
    expect(sel[0]).not.toMatch(/a\.ats\b/);
    expect(sel[0]).toMatch(/tailored_resumes/);
    expect(sel[0]).toMatch(/submission_channel/);
  });

  it('reports frozen: false when the write genuinely fails, and still verifies', async () => {
    // A receipt failure must not un-verify a real submission - the employer has
    // it either way - but the caller has to be able to SEE the difference.
    db({ receiptInsertThrows: true });
    const res = await request(app())
      .post('/api/apply/queue/21/evidence')
      .send({ confirmationId: 'GH-1', confirmationText: 'Thank you for applying.' });

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.receipt.frozen).toBe(false);
    expect(res.body.receipt.reason).toMatch(/could not be written/i);
  });
});
