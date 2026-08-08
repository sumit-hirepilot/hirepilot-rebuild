/*
 * Feature 14 — the referral finder assembles PATHS, never people.
 *
 * The network module's founding rule (its own header): a fabricated name is
 * not a smaller version of a real one. So a referral path for a job is made
 * of exactly three honest ingredients:
 *   1. contacts the USER already tracked at that company,
 *   2. contact addresses the EMPLOYER published in the posting text,
 *   3. LinkedIn searches into the real index.
 * Each basket may be empty, and an empty basket is stated, never padded.
 */

const request = require('supertest');
const express = require('express');

const { buildReferralPath, extractContactEmails } = require('../services/referralPath');

describe('extractContactEmails (moved from routes/jobs, one definition)', () => {
  it('returns only addresses genuinely present, noise filtered', () => {
    const emails = extractContactEmails(
      'Apply to talent@adyen.com or hiring.manager@adyen.com. Unsubscribe: noreply@adyen.com'
    );
    expect(emails).toEqual(['talent@adyen.com', 'hiring.manager@adyen.com']);
  });

  it('never constructs an address', () => {
    expect(extractContactEmails('Contact our recruiter John Smith at Adyen.')).toEqual([]);
  });
});

describe('buildReferralPath', () => {
  const job = { id: 9, title: 'Product Designer', company_name: 'Adyen', description: 'Reach out: talent@adyen.com' };
  const contacts = [
    { id: 1, company_name: 'Adyen', first_name: 'Priya', last_name: 'K', relationship_type: 'recruiter' },
    { id: 2, company_name: 'Adyen B.V.', first_name: 'Sam', last_name: 'L', relationship_type: 'employee' },
    { id: 3, company_name: 'Stripe', first_name: 'Ola', last_name: 'M', relationship_type: 'employee' },
  ];

  it('surfaces only the user\'s contacts at THAT company, matched exactly, not by substring', () => {
    const r = buildReferralPath({ job, contacts });
    const ids = r.yourContacts.map((c) => c.id);
    expect(ids).toContain(1);
    expect(ids).not.toContain(3);
    // "Adyen B.V." normalises to adyenbv, which is NOT adyen - a legal-suffix
    // cousin is a judgement the user makes, not the code.
    expect(ids).not.toContain(2);
  });

  it('carries the posting\'s own published addresses', () => {
    const r = buildReferralPath({ job, contacts: [] });
    expect(r.postedContacts).toEqual(['talent@adyen.com']);
  });

  it('builds the three LinkedIn searches for a stated company', () => {
    const r = buildReferralPath({ job, contacts: [] });
    expect(r.searches).toHaveLength(3);
    expect(r.searches.every((s) => s.url.startsWith('https://www.linkedin.com/search/results/people/'))).toBe(true);
    expect(r.areIdentifiedPeople).toBe(false);
  });

  it('an unstated company yields no searches and says why, never a guess', () => {
    const r = buildReferralPath({ job: { ...job, company_name: null }, contacts });
    expect(r.searches).toEqual([]);
    expect(r.searchesUnavailableReason).toMatch(/company/i);
    expect(r.yourContacts).toEqual([]);
  });
});

describe('GET /api/network/referral-path/:jobId', () => {
  jest.resetModules();
  jest.mock('../db', () => ({ query: jest.fn() }));
  jest.mock('../middleware/auth', () => ({
    verifyToken: (req, _res, next) => { req.user = { id: 42 }; next(); },
  }));
  // eslint-disable-next-line global-require
  const { query } = require('../db');
  // eslint-disable-next-line global-require
  const networkRouter = require('../routes/network');

  function app() {
    const a = express();
    a.use(express.json());
    a.use('/api/network', networkRouter);
    return a;
  }

  beforeEach(() => query.mockReset());

  it('assembles the path for the caller against a real job row', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 9, title: 'Product Designer', company_name: 'Adyen', description: 'Mail talent@adyen.com' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, company_name: 'Adyen', first_name: 'Priya' }] });

    const res = await request(app()).get('/api/network/referral-path/9');
    expect(res.status).toBe(200);
    expect(res.body.job.title).toBe('Product Designer');
    expect(res.body.yourContacts).toHaveLength(1);
    expect(res.body.postedContacts).toEqual(['talent@adyen.com']);
    expect(res.body.searches).toHaveLength(3);

    // Contacts are the caller's, by parameter.
    const contactsSql = query.mock.calls[1];
    expect(contactsSql[1]).toContain(42);
  });

  it('404s an unknown job and 400s a non-numeric id', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect((await request(app()).get('/api/network/referral-path/999')).status).toBe(404);
    expect((await request(app()).get('/api/network/referral-path/abc')).status).toBe(400);
  });
});
