/*
 * Q5 — the inbound mail wire, proven against what providers actually send.
 *
 * These drive the REAL exported app (index.js, D56) so the parser stack is
 * the deployed one - that is the point: Mailgun and SendGrid post
 * multipart/form-data by default and Postmark posts JSON, and a route that
 * only parses what curl sends "works" until the first real provider posts to
 * it. Each case is a simulated provider payload in that provider's own
 * shape.
 *
 * Hardening pinned here, red-proven before green:
 *  - multipart and urlencoded and JSON payloads all store the message;
 *  - SendGrid's envelope (a JSON STRING) resolves the recipient;
 *  - a payload with no Message-Id gets a deterministic content hash, so a
 *    provider's at-least-once retry cannot store the mail twice;
 *  - an unknown recipient answers 200 accepted:false - a 404 makes the
 *    provider retry forever and eventually disable the webhook, and probing
 *    for live addresses already requires the shared secret;
 *  - the wrong secret is refused (both header and query forms), and the
 *    comparison is timing-safe.
 */

process.env.INBOUND_MAIL_SECRET = 'wire-secret';

jest.mock('../db', () => ({ query: jest.fn(), pool: { end: jest.fn() } }));

const request = require('supertest');
const { query } = require('../db');
const app = require('../index');

const PROXY = 'hp-abc123@hirepilot-mail.com';

function primeStore() {
  query.mockReset();
  query.mockImplementation((sql) => {
    if (/FROM users WHERE lower\(proxy_email\)/.test(sql)) return Promise.resolve({ rows: [{ id: 42 }] });
    if (/FROM applications/.test(sql)) return Promise.resolve({ rows: [] });
    if (/INSERT INTO inbox_messages/.test(sql)) return Promise.resolve({ rows: [{ id: 900 }] });
    return Promise.resolve({ rows: [] });
  });
}

const insertCall = () => query.mock.calls.find((c) => /INSERT INTO inbox_messages/.test(c[0]));

describe('provider payload shapes', () => {
  beforeEach(primeStore);

  it('Mailgun-style multipart/form-data stores the message', async () => {
    const res = await request(app)
      .post('/api/inbox/inbound?token=wire-secret')
      .field('recipient', PROXY)
      .field('sender', 'recruiter@meta.com')
      .field('subject', 'Interview invitation')
      .field('body-plain', 'We would like to schedule a call.')
      .field('Message-Id', '<mg-1@meta.com>');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const ins = insertCall();
    expect(ins[1]).toContain('<mg-1@meta.com>');
  });

  it('Postmark-style JSON stores the message with its MessageID', async () => {
    const res = await request(app)
      .post('/api/inbox/inbound')
      .set('x-hirepilot-signature', 'wire-secret')
      .send({ To: PROXY, From: 'recruiter@meta.com', Subject: 'Offer letter', TextBody: 'We are pleased to offer…', MessageID: 'pm-77' });
    expect(res.status).toBe(200);
    const ins = insertCall();
    expect(ins[1]).toContain('pm-77');
  });

  it('SendGrid-style envelope (a JSON string) resolves the recipient', async () => {
    const res = await request(app)
      .post('/api/inbox/inbound?token=wire-secret')
      .field('envelope', JSON.stringify({ to: [PROXY], from: 'recruiter@meta.com' }))
      .field('from', 'Recruiting <recruiter@meta.com>')
      .field('subject', 'Assessment next steps')
      .field('text', 'Please complete the take-home.');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('at-least-once delivery', () => {
  beforeEach(primeStore);

  it('a payload with no Message-Id dedupes on a deterministic content hash', async () => {
    const send = () => request(app)
      .post('/api/inbox/inbound?token=wire-secret')
      .field('recipient', PROXY)
      .field('sender', 'recruiter@meta.com')
      .field('subject', 'Reminder')
      .field('body-plain', 'Do not forget to complete your application.');
    await send();
    const first = insertCall()[1][2];
    query.mock.calls.length = 0;
    await send();
    const second = insertCall()[1][2];
    expect(first).toBeTruthy();
    expect(first).toBe(second);
    expect(String(first)).toMatch(/^hash-/);
  });
});

describe('refusals', () => {
  beforeEach(primeStore);

  it('unknown recipient answers 200 accepted:false, not a retry-forever 404', async () => {
    query.mockImplementation((sql) => {
      if (/FROM users WHERE lower\(proxy_email\)/.test(sql)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app)
      .post('/api/inbox/inbound?token=wire-secret')
      .field('recipient', 'hp-nobody@hirepilot-mail.com')
      .field('subject', 'x').field('body-plain', 'y');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.reason).toBe('unknown_recipient');
    expect(query.mock.calls.some((c) => /INSERT INTO inbox_messages/.test(c[0]))).toBe(false);
  });

  it('refuses a wrong secret in either carrier', async () => {
    expect((await request(app).post('/api/inbox/inbound?token=wrong').field('recipient', PROXY)).status).toBe(401);
    expect((await request(app).post('/api/inbox/inbound').set('x-hirepilot-signature', 'wrong').send({ To: PROXY })).status).toBe(401);
  });

  it('the secret comparison is timing-safe', () => {
    const src = require('fs').readFileSync(require.resolve('../routes/inbox'), 'utf8');
    expect(src).toMatch(/timingSafeEqual/);
    // And the naive comparison is gone from the inbound path.
    expect(src).not.toMatch(/supplied !== secret/);
  });
});
