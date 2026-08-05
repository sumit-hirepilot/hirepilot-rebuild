/*
 * A4 — the immutable submission receipt.
 *
 * `screening_answers` on the application row is CURRENT state: later discovery
 * runs rewrite it. A screen rendering it as "what was sent" asserts something
 * it cannot know, which is why this was filed as a Constraint 1 violation and
 * not merely a missing feature. Seeing what left is a user's only defence
 * against a bad automated submission made under their name.
 *
 * The receipt is that assertion made truthfully: copied once at the moment the
 * employer's confirmation is captured, and refused thereafter by the DATABASE.
 * A rule that lives only in application code is one careless UPDATE from being
 * false, so these pin the trigger and the index, not a convention.
 */

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = { id: 7, email: 'a@b.c' }; next(); },
}));

const { query } = require('../db');
const applyRouter = require('../routes/apply');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/apply', applyRouter);
  return a;
}

const MIGRATIONS = fs.readFileSync(
  path.join(__dirname, '..', 'services', 'migrations.js'), 'utf8'
);

describe('A4 — immutability is enforced by the database', () => {
  it('creates the receipts table', () => {
    expect(MIGRATIONS).toMatch(/CREATE TABLE IF NOT EXISTS submission_receipts\b/);
  });

  it('blocks UPDATE and DELETE with a trigger, not a convention', () => {
    // Anchored on the trigger definition itself. A comment promising the table
    // is append-only is not a mechanism.
    expect(MIGRATIONS).toMatch(/CREATE TRIGGER trg_submission_receipts_immutable\b/);
    expect(MIGRATIONS).toMatch(/BEFORE UPDATE OR DELETE ON submission_receipts\b/);
    expect(MIGRATIONS).toMatch(/RAISE EXCEPTION/);
  });

  it('allows only one receipt per application', () => {
    // A re-submit must not be able to replace the first receipt's account of
    // what went out.
    expect(MIGRATIONS).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_submission_receipts_app_unique\b/);
  });

  it('freezes on conflict rather than overwriting', () => {
    const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'apply.js'), 'utf8');
    const block = route.slice(route.indexOf('INSERT INTO submission_receipts'));
    expect(block.slice(0, 800)).toMatch(/ON CONFLICT \(application_id\) DO NOTHING\b/);
    expect(block.slice(0, 800)).not.toMatch(/DO UPDATE\b/);
  });
});

describe('A4 — the receipt is read from the frozen row, never from live values', () => {
  beforeEach(() => query.mockReset());

  it('states that none exists rather than showing current profile values', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app()).get('/api/apply/queue/12/receipt');

    expect(res.status).toBe(404);
    expect(res.body.receipt).toBeNull();
    // The distinction the whole goal exists for.
    expect(res.body.reason).toMatch(/not a record of what was sent/i);
  });

  it('returns the frozen row and says it is immutable', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        id: 3, application_id: 12, submitted_at: '2026-08-05T10:00:00.000Z',
        answers_sent: { 'notice period': '30 days' },
        resume_sha256: 'a'.repeat(64), platform_confirmation_id: 'CONF-1',
      }],
    });

    const res = await request(app()).get('/api/apply/queue/12/receipt');

    expect(res.status).toBe(200);
    expect(res.body.immutable).toBe(true);
    expect(res.body.receipt.answers_sent['notice period']).toBe('30 days');

    // Reads submission_receipts, not applications. Selecting from the
    // application would reproduce the exact defect this replaces.
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/FROM submission_receipts\b/);
    expect(sql).not.toMatch(/FROM applications\b/);
  });

  it('scopes the read to the caller', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await request(app()).get('/api/apply/queue/12/receipt');
    expect(query.mock.calls[0][0]).toMatch(/user_id = \$2/);
    expect(query.mock.calls[0][1]).toEqual([12, 7]);
  });
});

describe('A4 — the receipt records the file by content', () => {
  it('hashes the resume bytes rather than trusting a mutable row id', () => {
    const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'apply.js'), 'utf8');
    // A resume row can be edited or replaced after the fact; the digest of the
    // bytes that were actually attached cannot.
    expect(route).toMatch(/createHash\('sha256'\)/);
    expect(route).toMatch(/resume_sha256\b/);
    // Not pgcrypto: a missing extension must not be why a submission has no
    // receipt.
    expect(route).not.toMatch(/encode\(digest\(/);
  });
});
