/*
 * Dead branches — a CHECK constraint that is not in the table enforces nothing,
 * however carefully its predicate is written.
 *
 * Both application constraints were asserted by reading migrations.js and
 * regexing it for the constraint text. That proves the statement is WRITTEN.
 * It cannot prove the statement RAN: runMigrations logs a failed statement and
 * continues, so an ADD CONSTRAINT that threw and one that succeeded produce
 * the same output and the same green test. The indexes were already treated
 * this way - declared in a test, then read back from pg_indexes through
 * /api/jobs/db-health because declaring is necessary and not sufficient. The
 * constraints never got the second half.
 *
 * So db-health now reads pg_constraint too, and these tests prove it can tell
 * the difference. A reporter that says "present" whatever the database
 * contains is the same defect one level up.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => { req.user = { id: 42 }; next(); },
  attachUserIfPresent: (req, _res, next) => { req.user = req.user || { id: 42 }; next(); },
}));

const { query } = require('../db');

const BOTH = [
  {
    conname: 'applications_applied_at_requires_submitted',
    def: "CHECK (applied_at IS NULL OR (status)::text = 'submitted'::text)",
  },
  {
    conname: 'applications_applied_requires_submission',
    def: "CHECK ((status)::text <> 'applied'::text OR COALESCE(is_manual, false) = true OR submitted_at IS NOT NULL)",
  },
];

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/jobs', require('../routes/jobs'));
  return a;
}

const withConstraints = (rows) => query.mockImplementation((sql) => {
  if (/FROM pg_constraint/.test(sql)) return Promise.resolve({ rows });
  if (/FROM pg_indexes/.test(sql)) {
    return Promise.resolve({ rows: [{ indexname: 'idx_jobs_active_posted', tablename: 'jobs' }] });
  }
  if (/EXPLAIN/i.test(sql)) return Promise.resolve({ rows: [] });
  return Promise.resolve({ rows: [] });
});

beforeEach(() => query.mockReset());

describe('db-health reads the constraints from the running database', () => {
  it('reports both present when the table actually carries them', async () => {
    withConstraints(BOTH);
    const res = await request(app()).get('/api/jobs/db-health');

    expect(res.status).toBe(200);
    expect(res.body.allConstraintsPresent).toBe(true);
    expect(res.body.expectedConstraints.map((c) => c.name)).toEqual([
      'applications_applied_at_requires_submitted',
      'applications_applied_requires_submission',
    ]);
  });

  it('reports the missing one when a migration silently failed', async () => {
    /*
     * The case that matters, and the one the source-regex tests could never
     * see: the statement is in migrations.js, it threw at boot, and the table
     * has no such constraint. Prove the instrument on a known negative before
     * trusting it to say "present".
     */
    withConstraints([BOTH[0]]);
    const res = await request(app()).get('/api/jobs/db-health');

    expect(res.body.allConstraintsPresent).toBe(false);
    const missing = res.body.expectedConstraints.filter((c) => !c.present);
    expect(missing).toHaveLength(1);
    expect(missing[0].name).toBe('applications_applied_requires_submission');
  });

  it('reports none present on a table that carries no CHECK at all', async () => {
    withConstraints([]);
    const res = await request(app()).get('/api/jobs/db-health');

    expect(res.body.allConstraintsPresent).toBe(false);
    expect(res.body.expectedConstraints.every((c) => !c.present)).toBe(true);
  });

  it('hands back the predicate, not just the name', async () => {
    // A constraint can exist under the right name with a predicate that was
    // edited later. The name alone would not show that.
    withConstraints(BOTH);
    const res = await request(app()).get('/api/jobs/db-health');

    const applied = res.body.expectedConstraints
      .find((c) => c.name === 'applications_applied_requires_submission');
    expect(applied.def).toMatch(/is_manual/);
  });
});
