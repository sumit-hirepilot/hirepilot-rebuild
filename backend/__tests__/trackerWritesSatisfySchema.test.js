/*
 * Tracker manual add and CSV import must write rows the LIVE schema accepts.
 *
 * Reproduced on production 2026-08-08: POST /api/tracker/manual answered 500,
 * and the Railway log carried the cause - `null value in column "external_id"
 * of relation "jobs" violates not-null constraint`. jobs.external_id is
 * NOT NULL in schema.sql; the OLD database predated that, so these inserts
 * worked there and failed only on a database built fresh from the schema.
 * The D50 family: a write path proven only against a table that already
 * tolerated it.
 *
 * The second assertion is not cosmetic. jobs.is_active defaults TRUE, so a
 * fixed insert that stays silent about it drops a user's personal tracker
 * entry into the shared feed as a live job - userLinkedJob.js already sets
 * is_active=false for exactly this reason, and manual entries are the same
 * class of row: a private record, not a posting anyone else can apply to.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = { id: 42, email: 'nobody@example.com' }; next(); },
}));

const { query } = require('../db');
const trackerRouter = require('../routes/tracker');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/tracker', trackerRouter);
  return a;
}

function jobsInsert() {
  return query.mock.calls.find((c) => /INSERT INTO jobs/i.test(c[0]));
}

describe('POST /api/tracker/manual writes a row the live schema accepts', () => {
  beforeEach(() => {
    query.mockReset();
    query
      .mockResolvedValueOnce({ rows: [] })          // no existing job to reuse
      .mockResolvedValueOnce({ rows: [{ id: 55 }] }) // jobs insert
      .mockResolvedValueOnce({ rows: [{ id: 77 }] }); // applications insert
  });

  it('answers 201 with the application id', async () => {
    const res = await request(app()).post('/api/tracker/manual')
      .send({ company: 'Adyen', title: 'Product Designer' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(77);
  });

  it('supplies external_id - the column is NOT NULL on a fresh database', async () => {
    await request(app()).post('/api/tracker/manual')
      .send({ company: 'Adyen', title: 'Product Designer' });
    const insert = jobsInsert();
    expect(insert).toBeTruthy();
    expect(insert[0]).toMatch(/\bexternal_id\b/);
    const externalId = insert[1].find((p) => typeof p === 'string' && /^manual-/.test(p));
    expect(externalId).toBeTruthy();
  });

  it('derives distinct external_ids for distinct entries', async () => {
    await request(app()).post('/api/tracker/manual')
      .send({ company: 'Adyen', title: 'Product Designer' });
    const first = jobsInsert()[1].find((p) => typeof p === 'string' && /^manual-/.test(p));

    query.mockReset();
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 56 }] })
      .mockResolvedValueOnce({ rows: [{ id: 78 }] });
    await request(app()).post('/api/tracker/manual')
      .send({ company: 'Stripe', title: 'Staff Designer' });
    const second = jobsInsert()[1].find((p) => typeof p === 'string' && /^manual-/.test(p));

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });

  it('keeps the personal entry out of the shared feed (is_active false)', async () => {
    await request(app()).post('/api/tracker/manual')
      .send({ company: 'Adyen', title: 'Product Designer' });
    const insert = jobsInsert();
    expect(insert[0]).toMatch(/\bis_active\b/);
    // The value is a literal in the SQL, not a bound param - assert where it
    // actually lives (the "wrong argument" lesson from A1).
    expect(insert[0].replace(/\s+/g, ' ')).toMatch(/is_active\)[\s\S]*FALSE\)/i);
  });

  it('stores an entry with no URL as null, never as an invented URL', async () => {
    // jobs.job_url went nullable for exactly this row ("I applied by email"
    // has no posting URL). The alternative was fabricating one.
    await request(app()).post('/api/tracker/manual')
      .send({ company: 'Adyen', title: 'Product Designer' });
    const insert = jobsInsert();
    const params = insert[1];
    // $4 carries the URL; with none supplied it must be null, and no other
    // param may smuggle in something URL-shaped.
    expect(params).toContain(null);
    expect(params.some((p) => typeof p === 'string' && /^https?:\/\//.test(p))).toBe(false);
  });

  it('does not fabricate a publication date for a job nobody published', async () => {
    await request(app()).post('/api/tracker/manual')
      .send({ company: 'Adyen', title: 'Product Designer' });
    const insert = jobsInsert();
    // posted_at CURRENT_TIMESTAMP claimed the posting went up the moment the
    // user logged it. The publication date is unknown; absence stays absent.
    expect(insert[0]).not.toMatch(/posted_at/i);
  });
});

describe('POST /api/tracker/import writes rows the live schema accepts', () => {
  beforeEach(() => {
    query.mockReset();
    query
      .mockResolvedValueOnce({ rows: [] })           // not already tracked
      .mockResolvedValueOnce({ rows: [{ id: 60 }] }) // jobs insert
      .mockResolvedValueOnce({ rows: [] });          // applications insert
  });

  it('imports a row and reports it', async () => {
    const res = await request(app()).post('/api/tracker/import')
      .send({ rows: [{ company: 'Adyen', title: 'Product Designer' }] });
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
  });

  it('supplies external_id and keeps the row out of the shared feed', async () => {
    await request(app()).post('/api/tracker/import')
      .send({ rows: [{ company: 'Adyen', title: 'Product Designer' }] });
    const insert = jobsInsert();
    expect(insert).toBeTruthy();
    expect(insert[0]).toMatch(/\bexternal_id\b/);
    expect(insert[0]).toMatch(/\bis_active\b/);
    expect(insert[0].replace(/\s+/g, ' ')).toMatch(/is_active\)[\s\S]*FALSE\)/i);
    expect(insert[0]).not.toMatch(/posted_at/i);
    const externalId = insert[1].find((p) => typeof p === 'string' && /^manual-/.test(p));
    expect(externalId).toBeTruthy();
  });
});
