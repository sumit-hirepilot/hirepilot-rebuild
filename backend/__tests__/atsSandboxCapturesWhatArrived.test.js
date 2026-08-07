/*
 * The controlled target must record what it RECEIVED, in the shape the form
 * actually sends.
 *
 * The legacy Greenhouse board names every field `job_application[first_name]`,
 * and multer's append-field parses that into a NESTED OBJECT rather than a flat
 * key. A first cut iterated Object.entries(req.body) and called String() on
 * each value, which threw "Cannot convert object to primitive value" on the one
 * nested object and answered 500 - a failure that said nothing about the shape
 * of the payload, on the endpoint whose entire job is to report the payload.
 *
 * Caught by running the real adapter against the real page and posting the real
 * multipart body. No unit test of mine had the bracket names in it, because I
 * wrote both sides from the same wrong assumption.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({ query: jest.fn() }));
const { query } = require('../db');

function app() {
  const a = express();
  a.use('/api/ats-sandbox', require('../routes/atsSandbox'));
  return a;
}

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue({ rows: [{ id: 1, received_at: new Date().toISOString() }] });
});

describe('bracket-named fields survive as leaves', () => {
  it('flattens job_application[...] to plain field names', async () => {
    const res = await request(app())
      .post('/api/ats-sandbox/submit')
      .set('Accept', 'application/json')
      .field('job_application[first_name]', 'Sumit')
      .field('job_application[last_name]', 'Kumar')
      .field('job_application[email]', 'sumit@example.test')
      .field('job_application[phone]', '+91-7676522867');

    expect(res.status).toBe(201);
    expect(res.body.received.fields).toEqual({
      first_name: 'Sumit',
      last_name: 'Kumar',
      email: 'sumit@example.test',
      phone: '+91-7676522867',
    });
  });

  it('keeps doubly-nested answers addressable rather than collapsing them', async () => {
    const res = await request(app())
      .post('/api/ats-sandbox/submit')
      .set('Accept', 'application/json')
      .field('job_application[answers][work_authorised]', 'Yes')
      .field('job_application[answers][notice_period]', '60 days');

    expect(res.status).toBe(201);
    expect(res.body.received.answers).toEqual({
      'answers.work_authorised': 'Yes',
      'answers.notice_period': '60 days',
    });
  });

  it('does not 500 on the shape the real form sends', async () => {
    // The regression itself: one nested object under a single top-level key.
    const res = await request(app())
      .post('/api/ats-sandbox/submit')
      .set('Accept', 'application/json')
      .field('job_application[first_name]', 'Sumit');
    expect(res.status).not.toBe(500);
  });
});

describe('it reports the file it actually received', () => {
  it('records length and sha256 of the bytes, not what the sender claimed', async () => {
    const crypto = require('crypto');
    const bytes = Buffer.from('%PDF-1.4 pretend resume bytes');
    const expected = crypto.createHash('sha256').update(bytes).digest('hex');

    const res = await request(app())
      .post('/api/ats-sandbox/submit')
      .set('Accept', 'application/json')
      .field('job_application[first_name]', 'Sumit')
      .attach('job_application[resume]', bytes, 'resume.pdf');

    expect(res.status).toBe(201);
    expect(res.body.received.file).toMatchObject({
      filename: 'resume.pdf',
      bytes: bytes.length,
      sha256: expected,
    });
  });

  it('says so plainly when no file arrived', async () => {
    const res = await request(app())
      .post('/api/ats-sandbox/submit')
      .set('Accept', 'application/json')
      .field('job_application[first_name]', 'Sumit');
    expect(res.body.received.file).toBeNull();
  });
});

describe('the confirmation is one the product can actually verify', () => {
  it('returns text matching the evidence endpoint\'s success signals', async () => {
    /*
     * The wording has to be something SUCCESS_SIGNALS matches, or the proof
     * would be testing a phrasing the pipeline will never accept.
     */
    const applySrc = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'routes', 'apply.js'), 'utf8'
    );
    const block = applySrc.slice(applySrc.indexOf('const SUCCESS_SIGNALS'), applySrc.indexOf('];', applySrc.indexOf('const SUCCESS_SIGNALS')));
    const signals = [...block.matchAll(/\/(.+?)\/i,/g)].map((m) => new RegExp(m[1], 'i'));
    expect(signals.length).toBeGreaterThan(3);

    const res = await request(app())
      .post('/api/ats-sandbox/submit')
      .set('Accept', 'application/json')
      .field('job_application[first_name]', 'Sumit');

    expect(res.body.confirmationId).toMatch(/^GH-SANDBOX-[0-9A-F]+$/);
    expect(signals.some((re) => re.test(res.body.confirmationText))).toBe(true);
  });
});
