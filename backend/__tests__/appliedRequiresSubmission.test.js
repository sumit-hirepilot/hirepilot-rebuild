/*
 * A1 — an "applied" row must never claim an application nothing sent.
 *
 * Two halves, and both are needed:
 *   - the write path stops minting false rows
 *   - the table refuses them, so the next write path cannot reopen the hole
 *
 * The migration-order assertions are not ceremony. runMigrations catches and
 * logs a failed statement and continues, then prints "Migrations complete", so
 * an ADD CONSTRAINT that fails is indistinguishable from one that worked. The
 * only defence at this level is pinning the order and the predicate.
 */

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = { id: 42, email: 'nobody@example.com' }; next(); },
}));

const { query } = require('../db');
const applicationsRouter = require('../routes/applications');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/applications', applicationsRouter);
  return a;
}

describe('A1 — the write path cannot mint a false "applied"', () => {
  beforeEach(() => {
    query.mockReset();
    query
      .mockResolvedValueOnce({ rows: [{ id: 7, is_active: true, title: 'X', company_name: 'Y' }] }) // job lookup
      .mockResolvedValueOnce({ rows: [] })                                                          // not already applied
      .mockResolvedValueOnce({ rows: [{ id: 99, status: 'approved' }] })                            // insert
      .mockResolvedValueOnce({ rows: [] });                                                         // activity log
  });

  it('queues as approved rather than asserting applied', async () => {
    const res = await request(app()).post('/api/applications').send({ jobId: 7 });

    expect(res.status).toBe(201);
    const insert = query.mock.calls.find((c) => /INSERT INTO applications/.test(c[0]));
    expect(insert).toBeTruthy();
    // Nothing in this process sends anything to an employer, so the row it
    // writes may not claim one was sent.
    expect(insert[0]).not.toMatch(/'applied'/);
    expect(insert[0]).toMatch(/'approved'/);
  });

  it('does not log the event as an application having been sent', async () => {
    await request(app()).post('/api/applications').send({ jobId: 7 });

    const activity = query.mock.calls.find((c) => /activity_log/.test(c[0]));
    expect(activity).toBeTruthy();
    // The event name is a literal in the SQL, not a bound parameter - checking
    // only the params passed against the pre-change file, which is how this
    // assertion first went green on the bug it was meant to catch.
    const sqlAndParams = activity[0] + JSON.stringify(activity[1]);
    expect(sqlAndParams).not.toMatch(/application_sent/);
    expect(sqlAndParams).not.toMatch(/"status":"applied"/);
    expect(activity[0]).toMatch(/application_queued/);
  });
});

describe('A1 / D10a — the rule lives in the table', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'migrations.js'), 'utf8');

  const CONSTRAINT = 'applications_applied_requires_submission';

  it('adds a CHECK constraint binding applied to a submission record', () => {
    expect(src).toContain(CONSTRAINT);
    expect(src).toMatch(/ADD CONSTRAINT\s+applications_applied_requires_submission/);
  });

  it('exempts is_manual rows, and does so NULL-safely', () => {
    // D10: a user logging an application they sent themselves is honestly
    // applied. Relabelling those would be a Constraint 1 violation committed
    // while enforcing Constraint 7. A bare `is_manual = TRUE` would let NULL
    // pass the CHECK as unknown, which is a different hole.
    const body = src.slice(src.indexOf(CONSTRAINT));
    expect(body).toMatch(/COALESCE\(is_manual,\s*FALSE\)\s*=\s*TRUE/);
  });

  it('corrects existing rows BEFORE adding the constraint', () => {
    // ADD CONSTRAINT fails outright against an existing violator, and
    // runMigrations logs the failure and carries on - so the wrong order
    // leaves the hole open while the boot log claims success.
    const correction = src.indexOf("SET status = 'failed'");
    const constraint = src.indexOf(`ADD CONSTRAINT\n         ${CONSTRAINT}`) >= 0
      ? src.indexOf(`ADD CONSTRAINT\n         ${CONSTRAINT}`)
      : src.indexOf(CONSTRAINT, src.indexOf('DO $$'));
    expect(correction).toBeGreaterThan(-1);
    expect(constraint).toBeGreaterThan(-1);
    expect(correction).toBeLessThan(constraint);
  });

  it('accepts every form of evidence the corrective UPDATE leaves behind', () => {
    /*
     * The UPDATE only clears rows lacking employer_confirmation_id AND
     * verified_at. So rows carrying either survive it. If the constraint's
     * evidence set were narrower than that, a survivor would violate it,
     * ADD CONSTRAINT would fail, and the failure would be swallowed.
     */
    const body = src.slice(src.indexOf(CONSTRAINT));
    const clause = body.slice(0, body.indexOf('END $$'));
    expect(clause).toMatch(/employer_confirmation_id IS NOT NULL/);
    expect(clause).toMatch(/verified_at IS NOT NULL/);
  });

  it('guards the ADD so a repeated boot does not throw', () => {
    const body = src.slice(src.indexOf('DO $$'));
    expect(body).toMatch(/pg_constraint/);
    expect(body).toMatch(/IF NOT EXISTS/);
  });
});
