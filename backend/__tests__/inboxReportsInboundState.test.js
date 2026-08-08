/*
 * The inbox hands every user a proxy address and the UI tells them mail sent
 * there "reaches your real inbox either way". On a deployment where
 * INBOUND_MAIL_SECRET is unset, POST /api/inbox/inbound answers 503 and mail
 * sent to that address reaches nobody - verified on production 2026-08-08.
 *
 * The API is the only party that knows whether inbound is configured, so it
 * must say so. A UI cannot render an honest state from a payload that hides
 * the difference between "no mail yet" and "mail cannot arrive".
 */

const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = { id: 42, email: 'nobody@example.com' }; next(); },
}));

const { query } = require('../db');
const inboxRouter = require('../routes/inbox');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/inbox', inboxRouter);
  return a;
}

function mockListQueries() {
  query.mockReset();
  query
    .mockResolvedValueOnce({ rows: [] })                                        // messages
    .mockResolvedValueOnce({ rows: [] })                                        // counts
    .mockResolvedValueOnce({ rows: [{ n: 0 }] })                                // needsReview (feature 12)
    .mockResolvedValueOnce({ rows: [{ proxy_email: 'hp-x@hirepilot-mail.com' }] }); // proxy lookup
}

describe('GET /api/inbox reports whether inbound mail can actually arrive', () => {
  const OLD = process.env.INBOUND_MAIL_SECRET;
  afterEach(() => {
    if (OLD === undefined) delete process.env.INBOUND_MAIL_SECRET;
    else process.env.INBOUND_MAIL_SECRET = OLD;
  });

  it('inboundConfigured false when the inbound secret is unset', async () => {
    delete process.env.INBOUND_MAIL_SECRET;
    mockListQueries();
    const res = await request(app()).get('/api/inbox');
    expect(res.status).toBe(200);
    expect(res.body.inboundConfigured).toBe(false);
  });

  it('inboundConfigured true when the inbound secret is set', async () => {
    process.env.INBOUND_MAIL_SECRET = 'test-secret';
    mockListQueries();
    const res = await request(app()).get('/api/inbox');
    expect(res.status).toBe(200);
    expect(res.body.inboundConfigured).toBe(true);
  });
});
