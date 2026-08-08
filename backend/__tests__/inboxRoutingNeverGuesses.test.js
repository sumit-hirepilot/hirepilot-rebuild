/*
 * Feature 12 — recruiter email routing: matched by evidence, or not at all.
 *
 * The old matcher linked a message to "the newest application whose company
 * name CONTAINS the sender's domain token". Substring containment is a
 * guess: mail from meta.com linked to an application at Metabase, and the
 * stage-advance then moved the WRONG application to interviewing. E1's rule
 * is explicit - unmatched goes to review, never guessed - so:
 *
 *   - a candidate needs REAL evidence: the normalised company name equals
 *     the sender's org token, or the job's own URLs live on the sender's
 *     domain;
 *   - and the evidence must be UNIQUE: two candidates means the human
 *     decides, not the code;
 *   - an unmatched actionable message is surfaced for review, and linking it
 *     is a user action that then applies the same stage rule.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = { id: 42 }; next(); },
}));

const { query } = require('../db');
const inboxRouter = require('../routes/inbox');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/inbox', inboxRouter);
  return a;
}

const OLD_SECRET = process.env.INBOUND_MAIL_SECRET;
beforeAll(() => { process.env.INBOUND_MAIL_SECRET = 's3cret'; });
afterAll(() => {
  if (OLD_SECRET === undefined) delete process.env.INBOUND_MAIL_SECRET;
  else process.env.INBOUND_MAIL_SECRET = OLD_SECRET;
});

/*
 * The inbound handler's queries, in order:
 *   1. user by proxy address
 *   2. the user's candidate applications (with company + urls)
 *   3. INSERT the message
 *   4. (only when linked + decisive) stage UPDATE
 */
function mockInbound({ candidates }) {
  query.mockReset();
  query
    .mockResolvedValueOnce({ rows: [{ id: 42 }] })
    .mockResolvedValueOnce({ rows: candidates })
    .mockResolvedValueOnce({ rows: [{ id: 900 }] })
    .mockResolvedValue({ rows: [] });
}

const send = (from, subject = 'Interview invitation - please schedule a call') =>
  request(app())
    .post('/api/inbox/inbound')
    .set('x-hirepilot-signature', 's3cret')
    .send({ to: 'hp-abc@hirepilot-mail.com', from, subject, 'body-plain': 'We would like to schedule a call.' });

const insertedApplicationId = () => {
  const ins = query.mock.calls.find((c) => /INSERT INTO inbox_messages/i.test(c[0]));
  return ins[1][1]; // (user_id, application_id, ...)
};

describe('POST /api/inbox/inbound matches on evidence, never containment', () => {
  it('links when exactly one application matches the sender org exactly', async () => {
    mockInbound({
      candidates: [
        { id: 7, company_name: 'Meta', job_url: null, company_url: null, status: 'submitted', is_manual: false },
        { id: 8, company_name: 'Stripe', job_url: null, company_url: null, status: 'submitted', is_manual: false },
      ],
    });
    const res = await send('Recruiting <recruiter@meta.com>');
    expect(res.status).toBe(200);
    expect(insertedApplicationId()).toBe(7);
  });

  it('does NOT link a substring cousin - mail from meta.com is not about Metabase', async () => {
    mockInbound({
      candidates: [
        { id: 9, company_name: 'Metabase', job_url: null, company_url: null, status: 'submitted', is_manual: false },
      ],
    });
    await send('Recruiting <recruiter@meta.com>');
    expect(insertedApplicationId()).toBeNull();
    // And no stage moved on a guess.
    expect(query.mock.calls.some((c) => /UPDATE applications/i.test(c[0]))).toBe(false);
  });

  it('links on the job\'s own domain even when the name differs', async () => {
    mockInbound({
      candidates: [
        { id: 11, company_name: 'WhatsApp', job_url: 'https://careers.meta.com/jobs/123', company_url: null, status: 'submitted', is_manual: false },
      ],
    });
    await send('Recruiting <recruiter@meta.com>');
    expect(insertedApplicationId()).toBe(11);
  });

  it('two matching applications: nobody is guessed, the message goes to review', async () => {
    mockInbound({
      candidates: [
        { id: 12, company_name: 'Meta', job_url: null, company_url: null, status: 'submitted', is_manual: false },
        { id: 13, company_name: 'Meta', job_url: null, company_url: null, status: 'submitted', is_manual: false },
      ],
    });
    await send('Recruiting <recruiter@meta.com>');
    expect(insertedApplicationId()).toBeNull();
  });

  it('advances the stage only through the same on-board rule the tracker uses', async () => {
    mockInbound({
      candidates: [
        { id: 14, company_name: 'Meta', job_url: null, company_url: null, status: 'submitted', is_manual: false },
      ],
    });
    await send('Recruiting <recruiter@meta.com>');
    const upd = query.mock.calls.find((c) => /UPDATE applications/i.test(c[0]));
    expect(upd).toBeTruthy();
    expect(upd[0]).toMatch(/tracker_stage/);
    expect(upd[0]).toMatch(/status = 'submitted' OR .*is_manual/i);
    expect(upd[1]).toContain('interviewing');
  });
});

describe('review: linking is the user\'s call', () => {
  it('POST /:id/link attaches the message and applies the stage rule', async () => {
    query.mockReset();
    query
      .mockResolvedValueOnce({ rows: [{ id: 900, category: 'interview', user_id: 42 }] }) // message lookup
      .mockResolvedValueOnce({ rows: [{ id: 7 }] })  // application ownership check
      .mockResolvedValueOnce({ rows: [] })            // message update
      .mockResolvedValue({ rows: [] });               // stage update

    const res = await request(app()).post('/api/inbox/900/link').send({ applicationId: 7 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const msgUpdate = query.mock.calls.find((c) => /UPDATE inbox_messages/i.test(c[0]));
    expect(msgUpdate).toBeTruthy();
    const stageUpdate = query.mock.calls.find((c) => /UPDATE applications/i.test(c[0]));
    expect(stageUpdate[0]).toMatch(/tracker_stage/);
    expect(stageUpdate[1]).toContain('interviewing');
  });

  it('refuses to link someone else\'s application', async () => {
    query.mockReset();
    query
      .mockResolvedValueOnce({ rows: [{ id: 900, category: 'interview', user_id: 42 }] })
      .mockResolvedValueOnce({ rows: [] }); // application not the caller's

    const res = await request(app()).post('/api/inbox/900/link').send({ applicationId: 999 });
    expect(res.status).toBe(404);
    expect(query.mock.calls.some((c) => /UPDATE inbox_messages/i.test(c[0]))).toBe(false);
  });

  it('GET / reports how many actionable messages await review', async () => {
    query.mockReset();
    query
      .mockResolvedValueOnce({ rows: [] })  // messages
      .mockResolvedValueOnce({ rows: [] })  // counts
      .mockResolvedValueOnce({ rows: [{ n: 2 }] }) // needsReview count
      .mockResolvedValueOnce({ rows: [{ proxy_email: 'hp-x@hirepilot-mail.com' }] });
    const res = await request(app()).get('/api/inbox');
    expect(res.status).toBe(200);
    expect(res.body.needsReview).toBe(2);
  });
});
